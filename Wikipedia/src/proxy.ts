import { NextResponse, type NextRequest } from "next/server";

/**
 * Catch a malformed percent-encoded path (e.g. `/wiki/%25`, where `%25`
 * decodes to the literal `%`, which is not itself valid percent-encoding —
 * or `/wiki/foo%2`, an incomplete escape) before Next's own router gets to
 * it.
 *
 * Named `proxy.ts` rather than `middleware.ts`: Next 16.3 deprecates the
 * middleware file convention in favour of this one and says so on every
 * boot. The export is `proxy`, the config is unchanged, and the behaviour
 * is identical.
 *
 * ## Why this has to live here
 *
 * `src/lib/registry.ts`'s `safeDecode` already guards every application-code
 * `decodeURIComponent` call against exactly this input. That's not the bug.
 * Verified empirically (`next build && next start`, then
 * `curl -i '/wiki/%25'`): the request never reaches `src/app/wiki/[slug]/page.tsx`
 * at all. Next 16.3.0's own router decodes the path segment a second time
 * while matching the dynamic route — internally, before any application
 * code runs — and that throws a raw, uncaught `URIError`
 * ("failed to decode param"), which Next turns into a bare 500 with no
 * app-rendered body. There is no application code on the call stack to
 * patch; `proxy.ts` is the earliest point in the request pipeline this app
 * controls, running before route matching.
 *
 * ## Why a redirect, not a rewrite
 *
 * A `NextResponse.rewrite()` to a clean slug fixes `/wiki/%25` (the
 * `x-middleware-rewrite` header carries the new target, and route matching
 * follows it) but *not* `/wiki/foo%2` (an incomplete escape, invalid on the
 * very first decode): verified empirically that Next's downstream route
 * matching still throws "failed to decode param" after a rewrite in that
 * case, even though the rewritten target itself has no percent sign — it
 * appears to still touch the original raw path for that specific failure
 * mode. A redirect sends the browser a fresh request for the clean URL
 * instead, which sidesteps that entirely: verified empirically that both
 * `/wiki/%25` and `/wiki/foo%2` resolve to a 307 pointing at the clean slug,
 * which then 404s normally.
 *
 * The fix: try decoding the pathname twice here — once for what Next's own
 * first pass does, once more to reproduce the second pass that actually
 * throws — in a try/catch. On failure, redirect to a slug that is
 * guaranteed to look up as missing (it contains no percent sign, so
 * re-decoding it during route matching can't fail the same way) — the
 * existing `/wiki/[slug]/not-found.tsx` boundary (`notFound()` in
 * `page.tsx`) then renders the same Wikipedia-style "page does not exist"
 * screen every other unregistered slug gets, with a real HTTP 404.
 */
// Scoped to `/wiki/:path*`: it's the only dynamic route with the
// double-decode hazard (see the module comment). Matching every route, as
// the previous `/((?!_next/static|...).*)` pattern did, ran this on static
// assets and other pages too — e.g. a request for `/images/foo%25.png`
// would fail the same double-decode check and get redirected into the
// wiki 404 instead of being served (or 404ing) as a static asset.
export const config = {
  matcher: ["/wiki/:path*"],
};

const MALFORMED_SLUG_TARGET = "/wiki/Malformed_percent_encoding";

export function proxy(request: NextRequest): NextResponse {
  try {
    // `request.nextUrl.pathname` arrives still percent-encoded (one level),
    // e.g. `/wiki/%25`. Next's own dynamic-route matcher decodes a param
    // twice while resolving it (verified empirically — see the module
    // comment), so the failure this guards against only shows up on a
    // *second* decode: `/wiki/%25` -> `/wiki/%` (fine) -> decode `%` again
    // (throws). Decoding once here is exactly Next's own first pass; the
    // second is what has to be tried to reproduce the crash before it
    // happens for real, further down the pipeline. An incomplete escape
    // like `/wiki/foo%2` throws on the very first decode, which this same
    // try/catch also catches.
    decodeURIComponent(decodeURIComponent(request.nextUrl.pathname));
  } catch {
    return NextResponse.redirect(new URL(MALFORMED_SLUG_TARGET, request.url), 307);
  }

  return NextResponse.next();
}
