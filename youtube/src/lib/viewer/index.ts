import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, resolveSession } from "@/lib/auth/session";
import type { Viewer } from "@/domain/recommender";

import { VIEWER_KEY_COOKIE, parseViewerKey } from "./session-key";

export {
  VIEWER_KEY_COOKIE,
  VIEWER_KEY_IDLE_SECONDS,
  VIEWER_KEY_MAX_AGE_MS,
  decideViewerKey,
  mintViewerKey,
  parseViewerKey,
  viewerKeyCookie,
  type ViewerKey,
  type ViewerKeyDecision,
} from "./session-key";

/**
 * Who is watching, for every surface that asks the recommender a question.
 *
 * Four pages built this object by hand and all four agreed on the same wrong
 * fallback — `sessionKey: token ?? "anonymous"` — each carrying a comment
 * explaining that nothing issued a session cookie yet. Something does now
 * (`src/middleware.ts`), so this exists to make sure that fix lands in all four
 * places rather than in whichever one is edited next.
 *
 * ## The fallback is a per-request constant, not a shared bucket
 *
 * `"anonymous"` was a single grouping key for every signed-out visitor in the
 * world. It was harmless only because nothing wrote watch events; the moment
 * anything did, every video watched by anyone would co-visit with every other
 * one, and the graph would say that a chess opening is strongly related to a
 * cake recipe with high confidence.
 *
 * The middleware means a request without a key is now nearly unreachable — it
 * needs a client that drops `Set-Cookie` — so what matters is only that the
 * fallback cannot merge two viewers. A random value per request cannot: it
 * matches nothing already stored, so every read returns empty and the caller
 * falls back to the cold-start path, which is the honest answer for a viewer
 * whose history we are unable to identify. The **write** path refuses outright
 * rather than using this (see `api/watch/route.ts`), because a graph built from
 * one-video sessions is worse than no graph.
 */
export async function currentViewer(): Promise<Viewer> {
  const jar = await cookies();
  const session = await resolveSession(jar.get(SESSION_COOKIE)?.value ?? null);
  const key = parseViewerKey(jar.get(VIEWER_KEY_COOKIE)?.value ?? null);

  return {
    userId: session?.userId ?? null,
    sessionKey: key?.value ?? unidentifiedSessionKey(),
  };
}

/**
 * A key that is guaranteed to match nothing.
 *
 * Prefixed so that one turning up in a query plan or a log is recognisable as
 * "this request had no viewer key" rather than looking like a real session that
 * happens to have no rows.
 */
function unidentifiedSessionKey(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (const byte of bytes) suffix += byte.toString(16).padStart(2, "0");
  return `unidentified.${suffix}`;
}
