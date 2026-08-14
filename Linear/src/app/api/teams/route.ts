/**
 * `POST /api/teams`
 *
 * Creating a team. `team.create` is a workspace-scoped row whose `ws:member`
 * cell is a predicate (footnote 6) reading `teamCreatePolicy`, which defaults to
 * `anyMember` — so a plain member may create a team in a default workspace and
 * an admin can turn that off later without a code change. The repository makes
 * the creator its admin, which is what stops a member creating a team they
 * cannot then configure.
 */

import { z } from "zod";

import {
  accessForWorkspace,
  badRequest,
  forbidden,
  notFoundResponse,
  sessionForRequest,
  unauthorized,
} from "@/components/members/workspace-access";
import { ESTIMATION_SCALES } from "@/domain/entities";
import { can } from "@/domain/policy";

const Body = z.object({
  workspaceId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(5).optional(),
  description: z.string().max(2_000).nullable().optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  private: z.boolean().optional(),
  triageEnabled: z.boolean().optional(),
  estimationScale: z.enum(ESTIMATION_SCALES).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const session = await sessionForRequest(request);
  if (!session) return unauthorized();
  const { headers } = session;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest("Invalid team.", headers);
  const input = parsed.data;

  const access = await accessForWorkspace(session.user, input.workspaceId);
  if (!access) return notFoundResponse("workspace", headers);

  if (!can(access.actor, "team.create", { kind: "team" })) {
    return forbidden("team.create", headers);
  }
  // A private team is a second decision, and a stricter one: `team.set_private`
  // is not granted to a plain member. Checking it separately means a member who
  // may create teams cannot create one nobody else can see.
  if (input.private === true && !can(access.actor, "team.set_private", { kind: "team" })) {
    return forbidden("team.set_private", headers);
  }

  const team = await access.repos.teams.create(
    {
      workspaceId: access.workspace.id,
      name: input.name,
      ...(input.key === undefined ? {} : { key: input.key }),
      description: input.description ?? null,
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.private === undefined ? {} : { private: input.private }),
      ...(input.triageEnabled === undefined
        ? {}
        : { triageEnabled: input.triageEnabled }),
      ...(input.estimationScale === undefined
        ? {}
        : { estimationScale: input.estimationScale }),
    },
    access.user.id,
  );

  return Response.json({ team }, { status: 201, headers });
}
