/**
 * Next 16's renamed `middleware.ts` (research/stack.md §3: the file AND the
 * exported function are renamed — `export function proxy(...)`, not
 * `middleware`). Runs on the Edge runtime, so it can only import
 * Edge-compatible code: `jose` (Web Crypto), never `node:crypto`. That's
 * why this imports `getSecretKey`/`SESSION_COOKIE_NAME` straight from
 * `src/adapters/auth/demo-session.ts` (itself Edge-safe — no store, no
 * `nanoid`) rather than `src/lib/container.ts`, which pulls in the
 * in-memory `DataStore` + seed data and has no business running per-request
 * at the edge.
 *
 * LOCATION: the Task 4 brief says this file lives at the project root,
 * beside `next.config.ts`, and Next's compiled convention-file check
 * (`node_modules/next/dist/lib/constants.js`'s `PROXY_LOCATION_REGEXP`,
 * `(?:src/)?proxy`) does accept either location. Empirically, though,
 * against the installed Next 16.3.0 + Turbopack dev server, a root-level
 * `proxy.ts` was silently never invoked (empty
 * `.next/dev/server/middleware-manifest.json`, no error, no redirect on
 * `/app`) while this exact file under `src/` is picked up and redirects as
 * expected — verified by curling `/app` signed-out against both locations.
 * Filed under this task's report as a deviation from the literal brief
 * text in favor of the toolchain's actual, observed behavior.
 *
 * SECURITY: this is a redirect CONVENIENCE, not the security boundary.
 * It keeps a signed-out visitor from ever seeing a flash of `/app/**`
 * before bouncing to `/signin`, but it must never be the only check —
 * every Route Handler under `/api/**` independently re-verifies the
 * session via `src/lib/container.ts`'s `requireUser`/`getActor`, because
 * Server Actions and direct API calls (curl, a future mobile client, a
 * test) can reach a handler without this proxy ever running for that
 * specific request path. See `container.ts`'s matching comment on
 * `getActor`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { getSecretKey, SESSION_COOKIE_NAME } from "@/adapters/auth/demo-session";

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    try {
      // Pinned to HS256 — see the matching comment in demo-session.ts's
      // verify(); don't rely on jose's internal key-type check alone.
      await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
      return NextResponse.next();
    } catch {
      // Expired/tampered — fall through to the redirect below, same as no
      // cookie at all.
    }
  }

  const signInUrl = new URL("/signin", req.url);
  signInUrl.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/app/:path*"],
};
