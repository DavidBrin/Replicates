import { NextResponse, type NextRequest } from "next/server";

import {
  VIEWER_KEY_COOKIE,
  VIEWER_KEY_IDLE_SECONDS,
  decideViewerKey,
} from "@/lib/viewer/session-key";

/**
 * Issue the viewing session key, and nothing else.
 *
 * `src/lib/viewer/session-key.ts` holds the rule; this holds the one thing that
 * can only be done here. A cookie has to be set on the response to the request
 * that did not carry it, and a server component cannot set cookies at all —
 * `cookies()` is read-only outside an action or a route handler, by design. So
 * the first page a visitor loads has nowhere to mint a key except middleware.
 *
 * ## The forwarded request header is the half that is easy to miss
 *
 * Setting the cookie on the *response* means the browser has it for the second
 * request. The first request's server components are already rendering, and
 * `cookies()` reads the request — so on the very page where the key was minted,
 * every reader would see none, and the watch page would fall back to a shared
 * bucket for exactly the visits most likely to be a session's first.
 *
 * `NextResponse.next({ request: { headers } })` replaces the headers the rest
 * of the pipeline sees, so the cookie is written to both sides of the exchange
 * and the minting request already knows its own key.
 *
 * ## Why every request and not just the watch page
 *
 * Because the key's whole job is to group a *sitting*, and the idle gap is the
 * cookie's `Max-Age` refreshed on each response. Scoping this to `/watch` would
 * mean a viewer who spends thirty-one minutes browsing the home grid between
 * two videos gets two sessions — the browsing is exactly the evidence that they
 * never went idle. Static assets are excluded because they are served without
 * running this and would not refresh anything anyway.
 */

export const config = {
  /**
   * Everything except Next's own asset routes and the media path.
   *
   * `/api/media` is excluded deliberately: it serves thousands of segment
   * requests per video, it is the one route whose responses are cached by
   * key, and attaching a per-viewer `Set-Cookie` to a cacheable response is
   * how a CDN ends up handing one viewer's key to everyone. Media requests
   * still *carry* the cookie; they just never issue one.
   */
  matcher: ["/((?!_next/static|_next/image|api/media|favicon.ico).*)"],
};

export function middleware(request: NextRequest): NextResponse {
  const presented = request.cookies.get(VIEWER_KEY_COOKIE)?.value ?? null;
  const decision = decideViewerKey(presented, Date.now());

  const headers = new Headers(request.headers);
  if (decision.minted) {
    // Rewrite the whole `Cookie` header rather than appending: a stale or
    // malformed key is *replaced*, and appending would leave two `yt_vk`
    // pairs whose winner depends on which one a parser reaches first.
    headers.set(
      "cookie",
      withCookie(request.headers.get("cookie"), VIEWER_KEY_COOKIE, decision.key.value),
    );
  }

  const response = NextResponse.next({ request: { headers } });

  /**
   * Written on every request, minted or not — that refresh *is* the idle gap.
   *
   * `response.cookies.set` rather than a hand-built header so that Next owns
   * the encoding. `secure` from the request's protocol, which behind a proxy
   * comes from `x-forwarded-proto`; `NextRequest.nextUrl.protocol` already
   * reflects that, because Next resolves the forwarded scheme when it builds
   * it.
   */
  response.cookies.set({
    name: VIEWER_KEY_COOKIE,
    value: decision.key.value,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: VIEWER_KEY_IDLE_SECONDS,
    secure: request.nextUrl.protocol === "https:",
  });

  return response;
}

/**
 * A `Cookie` header with one pair replaced or appended.
 *
 * Exported for its test rather than inlined: the replace-not-append rule above
 * is the kind of thing that looks obviously right and is worth pinning.
 */
export function withCookie(
  header: string | null,
  name: string,
  value: string,
): string {
  const kept = (header ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0 && pair.split("=")[0]?.trim() !== name);
  kept.push(`${name}=${value}`);
  return kept.join("; ");
}
