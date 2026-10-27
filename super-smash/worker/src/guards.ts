/**
 * What the Worker turns away before doing any work: a page on another site
 * asking for TURN credentials, and an address asking too often.
 *
 * Neither is authentication. A script sends whatever headers it likes, so the
 * origin check only stops another site's pages from spending this account's
 * relay on their visitors' behalf (they could not read the answer anyway: no
 * CORS header is ever sent). The rate limit holds a scripted client to a
 * human's pace. What actually bounds the cost of TURN is the account's billing
 * setup (D54).
 */

export interface GuardEnv {
  /** Optional: wrangler.jsonc binds it, and the Worker serves everyone without it. */
  readonly RATE_LIMITER?: RateLimit;
}

export type GuardedRoute = "ice" | "room";

/** The answer for a request turned away, or null to serve it. Never with a CORS header. */
export async function refusal(env: GuardEnv, request: Request, route: GuardedRoute): Promise<Response | null> {
  if (route === "ice" && !fromThisSite(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!(await withinRateLimit(env, request))) return Response.json({ error: "too many requests" }, { status: 429 });
  return null;
}

/**
 * A browser says where a fetch came from: `Sec-Fetch-Site` on every current
 * one, `Origin` on older ones. Neither header means no page sent it (curl,
 * the online e2e's relay precheck), and that is served: this is hygiene.
 */
function fromThisSite(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("Origin");
  if (origin !== null) return origin === new URL(request.url).origin;
  return true;
}

/**
 * One budget per address, shared by `/api/ice` and the room sockets. Fails
 * open: a limiter that cannot answer must never take the game down with it.
 */
async function withinRateLimit(env: GuardEnv, request: Request): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!env.RATE_LIMITER || ip === null) return true;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    return success;
  } catch (error) {
    // The name alone: a message could carry the address.
    console.warn(`rate limiter unavailable (${error instanceof Error ? error.name : typeof error}); serving the request`);
    return true;
  }
}
