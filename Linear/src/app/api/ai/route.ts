/**
 * `POST /api/ai`
 *
 * The one place a model is called. The client never names a vendor and never
 * holds a key — `runAiTask` picks the connector from configuration, and with no
 * key configured that connector is `DisabledConnector`, which answers with a
 * structured "unconfigured" rather than throwing (`ports/ai.ts`).
 *
 * ## Why "no key" is a 200
 *
 * Because it is a *state of the deployment*, not a failure of the request. A
 * fresh clone with no `ANTHROPIC_API_KEY` should render a panel explaining what
 * to set; returning 503 would put that explanation behind an error boundary and
 * make the ordinary case look broken. Every other failure keeps its real status
 * so a retry affordance can tell "try again" from "this will never work".
 *
 * ## Why it is workspace-scoped
 *
 * The prompt is assembled by the caller from content they can see, so the check
 * that matters is that they are a principal of the workspace at all. `can()`
 * with `workspace.view` is that check — and it is what stops this endpoint
 * being an unauthenticated proxy to a paid API, which is the failure mode that
 * costs money rather than privacy.
 */

import { z } from "zod";

import { runAiTask } from "@/adapters/ai";
import {
  accessForWorkspace,
  badRequest,
  forbidden,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
} from "@/components/members/workspace-access";
import { can } from "@/domain/policy";
import { AI_TASKS, type AiFailure } from "@/ports/ai";

const Body = z.object({
  workspaceId: z.string().min(1).max(64),
  task: z.enum(AI_TASKS),
  /** Whatever the screen wants summarised. Capped so one request is one call. */
  input: z.string().trim().min(1).max(24_000),
});

/**
 * The status a failure deserves.
 *
 * `unconfigured` and `refused` are outcomes the UI renders as content;
 * everything else is an error the caller may want to retry, and the status is
 * how it decides.
 */
function statusFor(reason: AiFailure["reason"]): number {
  switch (reason) {
    case "unconfigured":
    case "refused":
      return 200;
    case "rate_limited":
      return 429;
    case "timeout":
      return 504;
    case "invalid_request":
      return 400;
    case "upstream":
      return 502;
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid AI request.", headers);

  const access = await accessForWorkspace(session.user, parsed.data.workspaceId);
  if (!access) return notFoundResponse("workspace", headers);

  if (!can(access.actor, "workspace.view", { kind: "workspace" })) {
    return forbidden("workspace.view", headers);
  }

  const result = await runAiTask(parsed.data.task, parsed.data.input);

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        reason: result.reason,
        message: result.message,
        provider: result.provider,
        retryable: result.retryable,
      },
      { status: statusFor(result.reason), headers },
    );
  }

  return Response.json(
    {
      ok: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    },
    { headers },
  );
}
