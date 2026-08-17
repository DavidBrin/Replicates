import { z } from "zod";

import { database } from "@/adapters/db";
import { clearHistory } from "@/adapters/repositories/history";
import { currentViewerId } from "@/lib/auth/guard";
import { requestIsSecure } from "@/lib/auth/session";
import { historyPausedCookie } from "@/lib/viewer/history-pause";
import { crossOriginRefusal, isSameOrigin } from "@/lib/http/same-origin";

/**
 * The two history controls that were rendered and inert.
 *
 * Both said so — "Clearing history is not wired up yet — nothing was deleted",
 * "Pausing history is not wired up yet — recording is unchanged" — which was
 * honest and still a pair of dead buttons. Neither could have been wired up
 * before `POST /api/watch` existed, because there was nothing recording to
 * pause and nothing but the seed to clear.
 *
 * ## Why they share a route and not a verb
 *
 * They are two actions on one noun, and they differ in kind: `clear` is a
 * destructive database write scoped to an account, `pause` is a preference
 * carried in a cookie that applies to the browser. Splitting them across two
 * files would put the account-scoped one and the browser-scoped one where
 * nothing shows they are the same control panel — and the thing most worth
 * making obvious about them is that **pausing does not delete and clearing does
 * not pause**. Two adjacent branches say that better than two files.
 *
 * ## Clear requires an account; pause does not
 *
 * `watch_events.user_id` is nullable — a signed-out watch is recorded against
 * the viewing key — so a signed-out viewer genuinely has recording to pause and
 * genuinely has no history row keyed to them to delete. `clear` therefore 401s
 * where `pause` does not, and that asymmetry is the schema's, not a shortcut.
 */

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clear") }),
  z.object({ action: z.literal("pause"), paused: z.boolean() }),
]);

export async function POST(request: Request): Promise<Response> {
  /**
   * The one endpoint here that needs no session, so `SameSite=Lax` protects
   * nothing on it.
   *
   * `pause` deliberately requires no account — a signed-out viewer's watches
   * are recorded and are just as pausable — and it answers with a `Set-Cookie`.
   * A cross-site POST is not *sent* a Lax cookie but is still delivered and its
   * response's cookies are still applied, so without this any page on the
   * internet could silently switch off a visitor's watch history.
   */
  if (!isSameOrigin(request)) return crossOriginRefusal();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Expected clear, or pause with a boolean.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.action === "pause") {
    // No account needed and nothing written to the database: the preference is
    // a property of this browser, and it takes effect on the next report.
    return Response.json(
      { paused: parsed.data.paused },
      {
        headers: {
          "Set-Cookie": historyPausedCookie({
            paused: parsed.data.paused,
            secure: requestIsSecure(request),
          }),
        },
      },
    );
  }

  const viewerId = await currentViewerId(request);
  if (viewerId === null) {
    return Response.json(
      { error: "Sign in to clear your watch history." },
      { status: 401 },
    );
  }

  const cleared = await clearHistory(await database(), viewerId);
  // The counts come back so the confirmation can say what happened rather than
  // "done" — a destructive action that reports nothing is one the viewer has to
  // go and check.
  return Response.json(cleared);
}
