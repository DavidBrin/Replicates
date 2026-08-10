/**
 * The composition root (G1: "src/lib/ cross-cutting helpers (composition
 * root, ...)"). This is the ONLY module that constructs adapters — every
 * other module (routes, domain services) receives a `DataStore`/`Clock`/
 * `IdGen`/`AuthProvider` from `getContainer()` rather than importing
 * `createMemoryDataStore` or `DemoSessionAuthProvider` directly. Swapping
 * the in-memory store for a real database, or the demo session provider for
 * a real one, touches only this file.
 *
 * Concurrency note (Task 3's disclosed caveat): a bare repo write racing an
 * in-flight `transact` can be lost. This module doesn't itself do any
 * multi-step writes, so it has nothing to wrap in `transact` — but every
 * caller that mutates more than one thing (a trade, a market creation, a
 * friend-request acceptance) MUST route every one of those writes through
 * `store.transact(fn)`, never a bare sequence of repo calls. `seedDataStore`
 * (below) already follows this rule.
 */

import { nanoid } from "nanoid";
import { createMemoryDataStore } from "@/adapters/memory";
import { seedDataStore } from "@/adapters/memory/seed";
import { DemoSessionAuthProvider, SESSION_COOKIE_NAME } from "@/adapters/auth/demo-session";
import type { DataStore } from "@/ports/data-store";
import type { Clock } from "@/ports/clock";
import type { IdGen } from "@/ports/id";
import type { AuthProvider } from "@/ports/auth";
import type { Actor } from "@/domain/authz";
import type { User } from "@/domain/entities";
import { throwApp } from "@/lib/http";

export interface Container {
  readonly store: DataStore;
  readonly clock: Clock;
  readonly idGen: IdGen;
  readonly auth: AuthProvider;
}

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

class NanoIdGen implements IdGen {
  next(prefix: string): string {
    return `${prefix}_${nanoid()}`;
  }
}

/**
 * Promise-memoized singleton, stashed on `globalThis` rather than a plain
 * module-level `let`. This matters more than it looks: Next.js (both
 * webpack and Turbopack) compiles a Server Component's module graph and a
 * Route Handler's module graph as separate "layers" (rsc/ssr vs
 * route-handler), and a module imported from both — `container.ts`, here,
 * imported by `src/app/signin/page.tsx` AND every `app/api/**\/route.ts` —
 * gets bundled and evaluated ONCE PER LAYER even within a single `next dev`
 * process. A plain `let containerPromise` is therefore NOT a real
 * cross-route singleton: verified empirically (see the Task 4 report) —
 * `/signin`'s Server Component and `POST /api/session`'s Route Handler each
 * ended up with their OWN independently-seeded store (different random
 * user ids), so a user id copied off the rendered `/signin` page came back
 * `not_found` from `/api/session`. Keying the memoized promise on
 * `globalThis` (the same trick Prisma's Next.js docs recommend for its
 * client singleton, for the identical reason: it's the one thing every
 * layer's module registry shares within one process) fixes this — verified
 * by re-running the same curl sequence after this change.
 *
 * `getContainer()` is also called from every request concurrently; without
 * memoizing the IN-FLIGHT promise (not just the resolved value), two
 * requests arriving before the first `buildContainer()` resolves would each
 * start their own `createMemoryDataStore()` + `seedDataStore()` run — a
 * race where two requests each seed, exactly what this must avoid. Storing
 * the promise itself (assigned synchronously, before any `await`) closes
 * that window: every caller after the first `getContainer()` invocation
 * awaits the SAME promise, seeded exactly once.
 */
const GLOBAL_CONTAINER_KEY = Symbol.for("bet.container.v1");

interface GlobalWithContainer {
  [GLOBAL_CONTAINER_KEY]?: Promise<Container>;
}

function globalSlot(): GlobalWithContainer {
  return globalThis as GlobalWithContainer;
}

async function buildContainer(): Promise<Container> {
  const clock = new SystemClock();
  const idGen = new NanoIdGen();
  const auth = new DemoSessionAuthProvider();
  const store = createMemoryDataStore();
  await seedDataStore(store, clock, idGen);
  return { store, clock, idGen, auth };
}

export function getContainer(): Promise<Container> {
  const slot = globalSlot();
  if (!slot[GLOBAL_CONTAINER_KEY]) {
    slot[GLOBAL_CONTAINER_KEY] = buildContainer();
  }
  return slot[GLOBAL_CONTAINER_KEY];
}

/** Test-only escape hatch — forces the next `getContainer()` call to build
 * (and re-seed) a fresh container. Never called from application code; only
 * from test setup that needs isolation between test files/cases. */
export function resetContainerForTests(): void {
  delete globalSlot()[GLOBAL_CONTAINER_KEY];
}

// ---------------------------------------------------------------------------
// Session helpers — requireUser / getActor
// ---------------------------------------------------------------------------

/**
 * Parses a raw `Cookie` header into a name -> value map. Minimal by design
 * (splits on `;`, trims, `decodeURIComponent`s each value) — this app sets
 * exactly one cookie (`bet_session`) and never needs the full RFC 6265
 * grammar (quoted values, `__Host-`/`__Secure-` prefixes are handled by the
 * browser/`Set-Cookie`, not by this parser).
 */
function parseCookieHeader(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const rawValue = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

/**
 * Extracts the raw session token from a request's `Cookie` header by
 * reading `req.headers` directly rather than `NextRequest.cookies` (which
 * only exists on `NextRequest`). This is deliberate: G8 requires route
 * tests to call exported handlers directly with a plain `Request`, and
 * `requireUser`/`getActor` must behave identically whether invoked from a
 * real Next.js request or a test-constructed one.
 */
export function getSessionToken(req: Request): string | undefined {
  return parseCookieHeader(req.headers.get("cookie"))[SESSION_COOKIE_NAME];
}

/**
 * Resolves the request's `Actor` without throwing: `{ userId }` for a
 * valid, unexpired session; `{ kind: "anonymous" }` for a missing, expired,
 * or tampered one. Use this in routes that behave differently when signed
 * out (e.g. an invite-link preview, `GET /api/explore`) rather than simply
 * rejecting — `authz.ts`'s `can()` already denies every anonymous actor on
 * every resource, so passing this straight into `can()` is always safe.
 *
 * SECURITY: this independently re-verifies the JWT's signature and expiry
 * on every call via `auth.verify()` — it never trusts that `proxy.ts`
 * (Next 16's edge middleware) already validated the cookie. The proxy is a
 * redirect *convenience* only (skip rendering `/app/**` for a request that
 * will immediately bounce to `/signin`); it is not the security boundary,
 * because Server Actions and direct `fetch`/curl calls to a route handler
 * can reach here without ever passing through the proxy for that specific
 * request path. See `proxy.ts`'s matching comment.
 */
export async function getActor(req: Request): Promise<Actor> {
  const token = getSessionToken(req);
  if (!token) return { kind: "anonymous" };
  const { auth } = await getContainer();
  const verified = await auth.verify(token);
  if (!verified) return { kind: "anonymous" };
  return { userId: verified.userId };
}

/**
 * Resolves the request's signed-in `User`. Throws a `forbidden` `AppError`
 * (caught by `lib/http.ts`'s `handler()`, mapped to HTTP 403) when there is
 * no valid session, or when the session's `userId` no longer resolves to a
 * stored user (e.g. seed data was rebuilt). `src/domain/result.ts`'s
 * `ErrorCode` union has no dedicated "unauthenticated" code — `forbidden`
 * is the closest fit in that fixed 7-code set, and every protected route
 * already gets the right status for it via `STATUS_BY_CODE`.
 */
export async function requireUser(req: Request): Promise<User> {
  const actor = await getActor(req);
  if (!("userId" in actor)) {
    return throwApp({ code: "forbidden", message: "Sign in required." });
  }
  const { store } = await getContainer();
  const user = await store.users.findById(actor.userId);
  if (!user) {
    return throwApp({ code: "forbidden", message: "Sign in required." });
  }
  return user;
}
