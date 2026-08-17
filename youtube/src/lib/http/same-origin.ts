import "server-only";

/**
 * Is this state-changing request coming from our own pages?
 *
 * ## Why `SameSite=Lax` is not the whole answer
 *
 * Both cookies this application sets are `SameSite=Lax`, and the usual
 * shorthand is that Lax "stops CSRF". It stops one half of it: a cross-site
 * POST does not *carry* the cookie, so an attacker cannot act as a signed-in
 * viewer. It does nothing about the other half — a cross-site POST is still
 * **delivered**, still runs the handler, and the response's `Set-Cookie` is
 * still applied.
 *
 * `POST /api/history {"action":"pause","paused":true}` needs no session at all
 * and answers with a cookie. So any page on the internet could silently turn
 * off a visitor's watch history with a form submit, and the visitor's only
 * evidence would be that history stopped recording. That is a small harm and a
 * completely free one to prevent.
 *
 * ## What is checked, and in what order
 *
 * `Sec-Fetch-Site` first, because it is set by the browser, cannot be forged by
 * page script, and answers the question directly. `same-origin` and
 * `same-site` pass; `cross-site` fails; `none` — a user typing a URL or opening
 * a bookmark — cannot be a form post from another page and passes.
 *
 * `Origin` second, for anything that does not send the fetch metadata headers.
 * A missing `Origin` on a POST is characteristic of an old browser or a
 * non-browser client (curl, a test, a mobile app); those are not the CSRF
 * threat model, which is specifically *a browser the victim is already using*.
 * Refusing them would break the suite and every scripted client for no security
 * gain, so a missing header is allowed and a **mismatched** one is not.
 *
 * The comparison is on `Origin` against the request's own URL rather than
 * against a configured allowlist, because the deployment's public origin is not
 * something this application is told — it is behind a proxy that rewrites the
 * host — and `x-forwarded-host` is as forgeable as `Origin` itself. Comparing
 * the two headers the *browser* set against each other is the check that does
 * not depend on configuration being right.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site !== "cross-site";

  const origin = request.headers.get("origin");
  if (origin === null) return true;

  try {
    return new URL(origin).host === hostOf(request);
  } catch {
    // An `Origin` that is not a URL is not one we sent.
    return false;
  }
}

/**
 * The host the browser believes it is talking to.
 *
 * `x-forwarded-host` first — behind a proxy the request URL's host is the
 * internal one, and comparing `Origin: https://example.com` against
 * `localhost:3000` would refuse every legitimate request in production.
 */
function hostOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded !== null) return forwarded.split(",")[0]?.trim() ?? "";
  return new URL(request.url).host;
}

/** The 403 for a request that failed {@link isSameOrigin}. */
export function crossOriginRefusal(): Response {
  return Response.json(
    { error: "This endpoint only accepts requests from this site." },
    { status: 403 },
  );
}
