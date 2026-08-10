# Stack reference — social prediction-market app (Next.js, zero-config local + one-click Vercel)

Researched 2026-08-09. Versions below are what `npm view <pkg> version` resolves to on the day of writing; pin exact versions in `package.json` (no carets on the ORM/auth/testing packages — see the "never touch version pins" policy) and re-check before you actually scaffold, since this stack moves fast.

Non-negotiable constraint driving every decision below: **`npm install && npm run dev` must produce a fully working app with zero external accounts, zero `.env` file, zero Docker** — and `vercel deploy` on a fresh import must also just work with zero required env vars. Every "recommended" choice has a fallback path that needs configuration; the fallback is opt-in via env var, never required.

---

## 0. TL;DR decisions

| Concern | Decision | Why |
|---|---|---|
| Framework | Next.js **16.3** (App Router only), React **19.2** | Current stable; Pages Router is maintenance-mode; Turbopack is now the default bundler for `dev` and `build` |
| Language | TypeScript 5.x (`typescript@~5.7` pinned — see note below), strict mode | Next 16's own toolchain still targets TS 5; don't chase `typescript@7` day one |
| Persistence | **Hexagonal `DataStore` port** — in-memory adapter (default, zero-config) + Drizzle/Postgres adapter (opt-in via `DATABASE_URL`) | Only path that is truly zero-config locally *and* on Vercel with no build-time branching |
| ORM (opt-in path) | **Drizzle ORM**, not Prisma | Drizzle has an official, first-party PGlite driver; Prisma's is community-maintained. Same Postgres dialect locally (PGlite) and in prod (Neon) — no schema fork |
| Auth | Custom signed-cookie session (`jose` HS256 JWT) behind an `AuthProvider` port + a "pick a demo user" flow | Auth.js v5 is still `beta` (5.0.0-beta.32) after ~2 years; too much moving-target risk for a demo. Port makes swapping in real Auth.js/Clerk later a small change |
| Realtime chat | **SSE Route Handler + polling fallback**, not WebSockets | Vercel functions can't hold a persistent bidirectional socket; SSE one-way stream is supported with `maxDuration` |
| Styling | Tailwind CSS **v4** (CSS-first `@theme`, no `tailwind.config.js`) + shadcn/ui (Radix primitives) | v4's Oxide engine needs zero PostCSS config; shadcn copies source in, no version-lock risk |
| Charts | **lightweight-charts** for the price-history line/area, hand-rolled SVG sparkline for chip-sized previews | Purpose-built for financial time series, smaller and faster than Recharts/visx for this exact shape, but needs `dynamic(..., { ssr: false })` |
| Unit/property tests | **Vitest 4** + `@fast-check/vitest` | Fast, ESM-native, same Vite pipeline devs already use; fast-check proves pricing invariants beyond example tests |
| E2E | **Playwright 1.62**, driven via `webServer` against `next dev` locally and `next build && next start` in CI | Matches Vercel's production runtime more closely than `next dev` |
| Deploy | Vercel, **no `vercel.json` required** for the default (in-memory) path; a documented **optional** `vercel.json` + env vars for the Postgres path | One-click import must succeed with zero configured env vars |

---

## 1. Next.js 16 / App Router conventions

### Version & headline changes relevant here
- **Next.js 16.3** is current stable (16.2.6 shipped 2026-05-07 as the "16" GA baseline; 16.2/16.3 patch releases followed). Turbopack is the default bundler for both `next dev` and `next build`. React 19.2 is the peer.
- **`middleware.ts` → `proxy.ts`**: Next 16 renames the file and the exported function (`export function proxy(...)` instead of `middleware`). Related `next.config` keys renamed too (`experimental.middlewarePrefetch` → `proxyPrefetch`, `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`). **Use `proxy.ts` from day one** — don't write `middleware.ts` and migrate later.
- **`params`/`searchParams`/`cookies()`/`headers()` are async everywhere** in Server Components, `generateMetadata`, and Route Handlers. This is not optional in 16 — write `await params` from the start.
- **Cache Components / `"use cache"`** is opt-in (`experimental.cacheComponents` or the stable directive depending on point release). For this app: **do not enable it globally**. Apply `"use cache"` narrowly to specific read paths (e.g. a market's resolved-history page) once the demo works, so you don't fight implicit caching semantics while building the pricing engine.

### Server Components vs Client Components
- Default everything to a Server Component. Push `"use client"` down to leaf components that need interactivity: the order ticket form, the chat composer, the price chart (chart libs touch `window`), any component using `useState`/`useEffect`/context.
- Rule of thumb for this app: **pages and layouts are Server Components**; **`OrderTicket`, `ChatPanel`, `PriceChart`, `LiveOddsBadge`** are Client Components fed initial data as props from the server and re-fetch/poll client-side.
- Fetch data for the initial render in the Server Component (via the `DataStore` port, see §2) and pass it down — don't waterfall a client-side fetch for first paint.

### Mutations: Server Actions vs Route Handlers
- **Server Actions** (`"use server"` functions) for form-shaped mutations owned by this app's own UI: placing an order, posting a chat message, resolving a market. They get you progressive enhancement, automatic revalidation hookup, and no hand-rolled fetch/JSON boilerplate.
- **Route Handlers** (`app/api/**/route.ts`) for: (a) anything a non-browser client needs to call (Playwright API-level tests, a future mobile client), (b) SSE streams (Server Actions can't stream), (c) auth callback/session endpoints, (d) webhooks. Both call the same domain/application-layer functions — never duplicate business logic between a Server Action and a Route Handler.
- After a mutation, call `revalidatePath('/markets/[id]')` or, better, tag reads with `revalidateTag('market:123')` at fetch time and `revalidateTag('market:123')` on write — tags survive route shape changes better than paths.

### Streaming, loading/error boundaries
- Every route segment that fetches gets a sibling `loading.tsx` (instant skeleton via Suspense) and `error.tsx` (`"use client"`, receives `error`/`reset`).
- Wrap slow, non-critical subtrees (e.g. "recent trades" sidebar) in `<Suspense fallback={...}>` inside the page itself for granular streaming rather than blocking the whole route on `loading.tsx`.
- Root `app/global-error.tsx` for errors that escape a layout.

### Metadata API
- Static metadata via exported `metadata` objects in `layout.tsx`/`page.tsx`; dynamic per-market OG data via `generateMetadata({ params })` (remember `params` is a Promise in 16) reading the market title/current price for social-share cards.

### Route groups, parallel & intercepting routes
- Route groups: `app/(marketing)/...` for the logged-out landing/browse pages vs `app/(app)/...` for the authenticated trading UI, so each can have its own `layout.tsx` (different nav chrome) without affecting the URL.
- **Intercepting + parallel routes are the right tool for the order ticket modal**: clicking "Trade" on a market card opens `/markets/[id]/trade` as a modal overlaid on the current page (`(.)trade/page.tsx` intercepting convention) while a direct visit/refresh to that URL renders the full page. Layout:
  ```
  app/(app)/markets/[id]/
    page.tsx                 // full market detail page
    @modal/
      (.)trade/page.tsx      // intercepted: renders as modal over page.tsx
      default.tsx            // returns null when no modal is active
    layout.tsx                // renders {children} and {modal} slots
  ```
  `layout.tsx` must declare and render the `modal` parallel-route slot alongside `children`, and `default.tsx` under `@modal` must return `null` so the slot is empty on routes that don't populate it.

---

## 2. Persistence: the `DataStore` port

### The honest constraint
Vercel's function filesystem is **read-only except `/tmp`, and `/tmp` (and any in-memory state) is per-instance and wiped on cold start/scale-to-zero**. A `better-sqlite3` file written under `/tmp` will *appear* to work in a quick manual test and then silently lose data the moment a second invocation lands on a different instance, or the instance recycles. **Do not ship SQLite-on-disk as the default persistence for the Vercel deployment.** This is the single most common way demo apps quietly break in production on this platform — WebSearch turned up multiple 2023–2026 GitHub discussions of people rediscovering this the hard way.

### Options considered
| Option | Works local zero-config | Works on Vercel zero-config | Notes |
|---|---|---|---|
| (a) Prisma + SQLite local / Postgres prod, one schema | Yes locally | **No** — Prisma's `datasource.provider` is a literal, fixed at `generate` time; you cannot point the same generated client at SQLite locally and Postgres in prod without maintaining two schema files (or a template + codegen step) that can drift | Workable but adds a moving part; Prisma's community PGlite adapter (`pglite-prisma-adapter`) is unofficial |
| (b) Drizzle ORM equivalent | Yes, via PGlite (embedded WASM Postgres) | Yes, via Neon/Vercel Postgres — **same `pg` dialect both places**, same schema file | Drizzle ships an **official** `drizzle-orm/pglite` driver; this is the only option where local and prod share one SQL dialect with zero divergence |
| (c) In-memory/seeded store behind a repository interface | Yes — literally nothing to install | Yes — works immediately, no env vars | State doesn't persist across cold starts/instances on Vercel; must be documented as a known gap (see below) |
| (d) libSQL/Turso | Yes (local file or in-memory libSQL) | Yes, with a Turso account + `DATABASE_URL`/auth token — **not zero-config** for one-click deploy | Turso's Feb 2026 "partial sync" is the most architecturally honest fix for the ephemeral-FS problem generally, but it requires an external account, which violates the "one-click, zero external services" requirement for the *default* path. Good candidate for a documented, opt-in third adapter later — not the MVP's two adapters |

### Recommended design
```
src/
  domain/                    # pure business logic, no framework/IO imports
    market.ts                # Market, Position, Order entity types + invariants
    pricing.ts                # LMSR (or chosen) pricing engine — pure functions
    chat.ts
  ports/
    data-store.ts             # interface DataStore { getMarket, listOrders, placeOrder, ... }
    auth-provider.ts          # interface AuthProvider { getSession, createSession, ... }
  adapters/
    data-store/
      memory/
        memory-store.ts       # DEFAULT adapter — in-process Map/array store
        seed.ts                # deterministic seed data (users, markets, starter trades)
      postgres/
        schema.ts              # Drizzle schema (pgTable ...)
        drizzle-store.ts       # implements DataStore against Drizzle
        client.ts              # picks pg (Neon) vs pglite driver based on DATABASE_URL
    auth/
      demo/
        demo-auth-provider.ts # "pick a demo user" + signed JWT cookie
  app/                        # Next.js App Router tree (thin — delegates to domain/ports)
  lib/
    get-data-store.ts          # process-singleton factory: reads env, returns the DataStore
```

`lib/get-data-store.ts` is the one place that branches:
```ts
import type { DataStore } from '@/ports/data-store';
import { createMemoryStore } from '@/adapters/data-store/memory/memory-store';

let cached: DataStore | undefined;

export function getDataStore(): DataStore {
  if (cached) return cached;
  cached = process.env.DATABASE_URL
    ? // dynamic import so the memory-only demo path never pulls in drizzle/pg
      requirePostgresStore()
    : createMemoryStore({ seed: true });
  return cached;
}

function requirePostgresStore(): DataStore {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createDrizzleStore } = require('@/adapters/data-store/postgres/drizzle-store');
  return createDrizzleStore(process.env.DATABASE_URL!);
}
```
Route Handlers, Server Actions, and Server Components all call `getDataStore()` — never import an adapter directly.

### The caveat you must document (README section, verbatim-ish)
> **Known gap: demo data does not persist across Vercel cold starts.** By default this app runs on an in-memory `DataStore` seeded with demo markets/users on boot. On Vercel, each serverless/Fluid-compute instance has its own memory; a scale-to-zero event, a redeploy, or traffic landing on a fresh instance resets state to the seed. This is intentional for a zero-config demo — there is no database to provision. **To get real persistence**, set `DATABASE_URL` to a Postgres connection string (a free Neon project takes ~60 seconds to create) and redeploy; the app automatically switches to the Postgres-backed `DataStore` with the identical Drizzle schema used in local dev via PGlite. No code changes required.

### Local dev with the Postgres path (opt-in)
```
# .env.local (optional — omit entirely for the default in-memory path)
DATABASE_URL=file:./.data/local.pglite   # PGlite embedded Postgres, on-disk, zero install
```
`drizzle.config.ts` and `drizzle-kit push`/`generate` work unchanged against either PGlite locally or Neon in prod because both speak the Postgres wire protocol/dialect.

---

## 3. Auth

### Decision: don't use Auth.js/NextAuth v5 as the default
`next-auth@beta` currently resolves to **`5.0.0-beta.32`** — it has been in beta for roughly two years and is still not GA as of Aug 2026. That's an acceptable risk for a production app willing to track betas, but it's the wrong default for a demo that must "just work" indefinitely with minimal maintenance. Lucia (the other common recommendation) was explicitly deprecated/sunset by its author in favor of "roll your own with a guide," which validates that a small hand-rolled session layer is the mainstream-endorsed path for this exact situation, not a shortcut.

### Recommended: signed-cookie JWT session behind an `AuthProvider` port
- **"Pick a demo user"** landing flow: three or four seeded personas (e.g. "Alice", "Bob", "The House") rendered as buttons; clicking one calls a Server Action that mints a session — no password, no email, no external IdP.
- Session token: JWT (HS256) signed with `jose`, containing `{ sub: userId, iat, exp }`, stored in an **HttpOnly, `Secure` (prod only), `SameSite=Lax`, `Path=/`** cookie named `session`.
  - `Secure` must be conditional on `process.env.NODE_ENV === 'production'` (or check `req.url.startsWith('https')`) — a hardcoded `Secure` flag breaks local HTTP dev.
  - `SameSite=Lax` (not `Strict`) so top-level navigations from external links still carry the cookie; combined with **no state-changing GET requests** (Server Actions/Route Handlers only accept POST for mutations) this is sufficient CSRF defense for a demo — Lax already blocks cross-site POST/fetch from sending the cookie on the classic CSRF vector. If you later add a real IdP, add an explicit CSRF token to any form that must be `SameSite=None` for a redirect-based OAuth flow.
- **Secret**: `AUTH_SECRET` env var; if unset, **generate and cache one in-memory at boot** for the demo path (sessions just won't survive a redeploy, which is consistent with the in-memory data caveat already documented) rather than crashing the app — the whole point is zero required env vars.
- **Verification in `proxy.ts` (Edge runtime)**: use `jose`'s `jwtVerify` (Edge-compatible, unlike `jsonwebtoken` which needs Node crypto). Do the verification in the proxy for route protection (redirect to `/` if no valid session on `/app/**`), and **re-verify inside Route Handlers/Server Actions too** — never trust that the proxy already checked, since Server Actions can be invoked directly and some deployments skip proxy for certain paths.
  ```ts
  // src/adapters/auth/demo/verify-session.ts
  import { jwtVerify, SignJWT } from 'jose';

  const secret = () => new TextEncoder().encode(getAuthSecret());

  export async function verifySession(token: string | undefined) {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, secret());
      return { userId: payload.sub as string };
    } catch {
      return null; // expired/tampered — treat as logged out, don't throw
    }
  }

  export async function createSessionToken(userId: string) {
    return new SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secret());
  }
  ```
- **Edge runtime constraints to respect**: no Node `crypto`/`fs`/`net` in `proxy.ts` (must use Web Crypto via `jose`, which is Edge-safe); no direct DB driver calls in the proxy (`pg`/Neon's HTTP driver is Edge-safe but keep the proxy DB-free anyway — verify the JWT only, load the full user in the Server Component/Route Handler which can run in the Node runtime).
- **`AuthProvider` port** so swapping in Auth.js v5 (once GA) or Clerk later touches only `adapters/auth/*` and the one factory function, not call sites:
  ```ts
  export interface AuthProvider {
    getSession(): Promise<{ userId: string } | null>;
    createSession(userId: string): Promise<void>; // sets cookie
    destroySession(): Promise<void>;
  }
  ```

---

## 4. Realtime chat on Vercel

### Why WebSockets are the wrong default here
Vercel's Node/Edge **Functions execute per-request and terminate**; even with Fluid Compute (which lets one instance serve concurrent requests and stay warm longer), there's no supported way to accept an inbound WebSocket upgrade and hold a long-lived bidirectional socket across serverless invocations the way a persistent server (or a dedicated service like Pusher/Ably/a Durable-Object-style platform) can. Trying to do WebSockets natively on Vercel functions means fighting the platform, not using it — and it's the one thing that would force an external service dependency, violating the zero-external-services constraint.

### What Vercel actually supports for this
- **SSE (Server-Sent Events)** from a Route Handler: one-directional server→client stream over a normal HTTP response, works with Fluid Compute, and is explicitly documented/supported by Vercel (`streaming-functions` docs). Default function duration is **5 minutes**; opt into more via `export const maxDuration = <seconds>` (up to 30 min on Pro/Enterprise, still finite — a chat stream held open that long will always eventually get cut and must reconnect).
- Because HTTP/1.1 has no protocol-level keepalive frame (HTTP/2 does via PING), **send periodic heartbeat/comment lines** (`:\n\n` every ~20s) so idle SSE connections aren't silently dropped by intermediary proxies/load balancers.

### Recommendation for this app's chat
Two-tier: **SSE for "live" delivery, SWR/React Query short-interval polling as the resilience fallback and for the message list's initial/backfill load.** Concretely:
1. New chat messages are written via a Server Action to the `DataStore` (in-memory: an array with a monotonic `seq`; Postgres: a `messages` table with an auto-increment `id`).
2. `GET /api/chat/[roomId]/stream` is an SSE Route Handler that polls the `DataStore` server-side every ~1s for `seq > lastSeenSeq` and pushes new messages as SSE events — this works identically against the in-memory store or Postgres, no LISTEN/NOTIFY or pub/sub infra needed.
3. The client subscribes via `EventSource`; if the connection drops (cold-start recycle, `maxDuration` hit, network blip) it reconnects automatically (native `EventSource` behavior) and on reconnect requests `?since=<lastSeenSeq>` to backfill the gap.
4. SWR polling (`refetchInterval` or manual `setInterval` + `mutate`) on the same endpoint's JSON sibling (`GET /api/chat/[roomId]/messages?since=`) is the fallback used if `EventSource` isn't available/blocked, and is also what drives simpler UI like the market's live price badge (§6) where sub-second latency doesn't matter.

**Concrete SSE Route Handler pattern:**
```ts
// app/api/chat/[roomId]/stream/route.ts
export const runtime = 'nodejs';      // Edge runtime can't easily do timers/backpressure here
export const maxDuration = 60;        // seconds; reconnect cadence keeps this cheap

export async function GET(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const store = getDataStore();
  const url = new URL(req.url);
  let lastSeq = Number(url.searchParams.get('since') ?? 0);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(`:hb\n\n`)), 20_000);
      const poll = setInterval(async () => {
        const messages = await store.listChatMessagesSince(roomId, lastSeq);
        if (messages.length) {
          lastSeq = messages[messages.length - 1].seq;
          send('messages', messages);
        }
      }, 1_000);

      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        clearInterval(poll);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering
    },
  });
}
```

**Concrete SWR polling pattern (fallback / price badge):**
```ts
// hooks/use-market-price.ts
'use client';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useMarketPrice(marketId: string, initialData: MarketPriceDTO) {
  return useSWR<MarketPriceDTO>(`/api/markets/${marketId}/price`, fetcher, {
    fallbackData: initialData,     // server-rendered value, no flash of empty state
    refreshInterval: 2_000,        // 2s poll — cheap against in-memory/PGlite reads
    revalidateOnFocus: true,
    dedupingInterval: 1_000,
  });
}
```

---

## 5. Styling: Tailwind v4 + shadcn/ui for a dark trading UI

### Tailwind v4 setup (CSS-first, no `tailwind.config.js`)
```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  /* design tokens as CSS variables — consumed as bg-market-up, text-market-down, etc. */
  --color-market-up: oklch(0.72 0.19 149);      /* green */
  --color-market-down: oklch(0.63 0.24 25);     /* red */
  --color-surface-0: oklch(0.14 0.01 260);      /* app background, dark-first */
  --color-surface-1: oklch(0.19 0.012 260);     /* card background */
  --color-surface-2: oklch(0.24 0.014 260);     /* raised/hover */
  --color-border-subtle: oklch(0.28 0.01 260);
  --color-accent: oklch(0.7 0.15 250);

  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace; /* prices/odds */

  --radius-pill: 999px;
}

:root {
  color-scheme: dark; /* dark-first product */
}
```
- No `postcss.config.js`/`tailwind.config.js` needed for the base setup — `@tailwindcss/postcss` (or the `@tailwindcss/next` equivalent if using the dedicated Next plugin) auto-detects content; v4's engine scans the project itself.
- Package: `tailwindcss@4` + `@tailwindcss/postcss@4` in `postcss.config.mjs`:
  ```js
  export default { plugins: { '@tailwindcss/postcss': {} } };
  ```
- Dark-first theming: set `color-scheme: dark` and define tokens for dark as the base `@theme` values; if a light mode is wanted later, add a `[data-theme="light"]` block overriding the same custom properties rather than doubling every utility class.

### Component layer: shadcn/ui on Radix primitives
- `npx shadcn@latest init` (use `@canary` only if the `@latest` init fails against Tailwind v4 in your exact version combo — check at scaffold time) — this copies component source into `src/components/ui/`, so there's no shadcn *runtime* dependency/version to track, only the underlying Radix packages (`@radix-ui/react-dialog`, `-tabs`, `-select`, `-tooltip`, `-toast`/`sonner`, etc., or the consolidated `radix-ui` meta-package).
- Use Radix `Dialog` for the order ticket (pairs naturally with the intercepting-route modal from §1 — the intercepted route renders a client component that wraps its content in `<Dialog open onOpenChange={() => router.back()}>`), `Tabs` for Buy/Sell and chart-timeframe switchers, `Tooltip` for odds explainers.
- **Pill chips** (outcome buttons, category tags, YES/NO price chips) are the signature visual element of this UI: `rounded-[var(--radius-pill)]` + `bg-market-up/10 text-market-up border border-market-up/30` (Tailwind v4 lets you reference theme tokens directly as arbitrary values or via generated utility classes if you name the token `--color-*`, which auto-generates `bg-market-up`/`text-market-up`/`border-market-up` utilities).
- `class-variance-authority` (`cva`) for chip/button variant props (`variant: 'up' | 'down' | 'neutral'`, `size: 'sm' | 'md'`), `tailwind-merge`/`clsx` (or the shadcn-standard `cn()` helper combining both) to keep className composition safe.

---

## 6. Charts

Comparison for a **percentage price-history line chart** plus small in-card sparklines:

| Library | Bundle | SSR | Fit for this app |
|---|---|---|---|
| **lightweight-charts** (5.x) | Smallest for financial time series; purpose-built (candles, area, line, price scales, crosshair, time axis handling all included) | Canvas-based — **client-only**, must be dynamically imported | **Recommended for the main market detail chart.** Built by the TradingView team specifically for this problem; handles the "% since open" line + hover crosshair + volume-style overlays with far less code than assembling it from a general charting lib |
| Recharts (3.x) | ~50KB gz for the full package; composable React components | Renders to SVG — SSR-safe out of the box | Good general default, but for a finance-specific line-with-crosshair-and-live-tail chart you end up fighting its animation/update model on frequent (2s poll) data changes |
| visx | ~15KB core, 30–50KB realistic for a full chart | SVG — SSR-safe | Best when you need a fully bespoke visual; steeper D3-flavored API, more code to hand-write the same crosshair/tooltip behavior lightweight-charts gives for free |
| Hand-rolled SVG | Near-zero | Trivially SSR-safe | Right call for the tiny inline sparkline on market list cards (a handful of points, no interaction) — don't pull a whole charting lib in for that |

**Recommendation:** `lightweight-charts` for `PriceChart` (the market detail page's main chart), a ~30-line hand-rolled `<svg><polyline>` sparkline component for market-card previews. Skip Recharts/visx entirely — not needed once these two cover the two shapes.

SSR-safety pattern (required for lightweight-charts, since it touches `window`/`document` at import time):
```tsx
// components/price-chart.tsx
'use client';
import { useEffect, useRef } from 'react';
import { createChart, type IChartApi } from 'lightweight-charts';

export function PriceChart({ points }: { points: { time: number; value: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const chart: IChartApi = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      height: 280,
    });
    const series = chart.addAreaSeries({ lineColor: '#22c55e', topColor: 'rgba(34,197,94,0.25)', bottomColor: 'transparent' });
    series.setData(points.map((p) => ({ time: p.time as any, value: p.value })));
    const onResize = () => chart.applyOptions({ width: containerRef.current!.clientWidth });
    onResize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); chart.remove(); };
  }, [points]);
  return <div ref={containerRef} className="w-full" />;
}
```
Import it in a Server Component via `next/dynamic` with `ssr: false` only if you render it from a Server Component tree directly; since it's already `"use client"`, a plain import also works, `dynamic(..., { ssr: false })` is only strictly required if you need to guarantee zero server-side execution of the module (e.g. if the import itself has side effects at module scope touching `window`) — lightweight-charts' `createChart` call is inside `useEffect` here, so a plain `'use client'` import is sufficient and simpler.

---

## 7. Testing

### Unit + property tests: Vitest 4 + fast-check
- `vitest.config.ts` shares the same path aliases as `tsconfig.json`/Next (use `vite-tsconfig-paths` or mirror `resolve.alias`).
- **Property-test the pricing engine specifically** — this is where fast-check earns its keep over example-based tests alone. For an LMSR-style (or whatever engine is chosen) market maker, encode invariants such as:
  - price is always in `(0, 1)` for any sequence of valid trades,
  - the sum of outcome probabilities is always 1 (within float epsilon),
  - cost function is monotonic in shares bought,
  - selling shares back is the exact inverse of buying (round-trip invariant),
  - the house can never pay out more than it collected plus its bounded subsidy.
  Keep a handful of example tests for known worked cases (e.g. "buying 10 YES shares at 50% moves price to X") and let `fast-check` fuzz the input space (trade sequences, share amounts, market sizes) around them — per the researched guidance, examples anchor correctness on known cases, properties patrol the space between them.
  ```ts
  // src/domain/pricing.property.test.ts
  import { test, fc } from '@fast-check/vitest';
  import { expect } from 'vitest';
  import { priceAfterTrade, MarketState } from './pricing';

  test.prop([fc.array(fc.record({ side: fc.constantFrom('YES', 'NO'), shares: fc.double({ min: 0.01, max: 1000, noNaN: true }) }), { minLength: 1, maxLength: 50 })])(
    'price stays within (0, 1) after any sequence of valid trades',
    (trades) => {
      let state = MarketState.initial();
      for (const t of trades) state = priceAfterTrade(state, t);
      expect(state.priceYes).toBeGreaterThan(0);
      expect(state.priceYes).toBeLessThan(1);
    }
  );
  ```
- Unit-test the `DataStore` adapters against **the same shared contract test suite** (a function `runDataStoreContractTests(getStore: () => DataStore)`) run once against the memory adapter and once against a PGlite-backed Drizzle adapter in CI — this is what catches "memory adapter and Postgres adapter silently drifted in behavior."

### E2E: Playwright
```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  webServer: {
    command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```
- **Locally**, run Playwright against `next dev` for fast iteration (`webServer.command: 'npm run dev'`).
- **In CI**, run against `next build && next start` — this is what actually matches Vercel's production build/runtime behavior (caching semantics, RSC payload shape, `"use cache"` behavior) and is where you'll catch dev-only false positives.
- **API-level tests** hit Route Handlers directly with Playwright's `request` fixture (no browser) for fast coverage of the chat SSE endpoint, order placement, and session auth — reserve full browser E2E for the handful of true user-journey flows (pick demo user → browse market → place order → see chat update).

---

## 8. Vercel deployment

### What makes this repo one-click deployable
- **Zero required environment variables.** `DATABASE_URL` and `AUTH_SECRET` are both optional; absence triggers the in-memory/ephemeral-secret fallback described in §2/§3, not a build or runtime crash. Validate env at startup with a schema that treats both as optional (`zod` `.optional()`), and never `throw` from top-level module scope on a missing var — Next.js build will fail immediately and opaquely if you do.
- **No `vercel.json` required for the default path.** Vercel auto-detects Next.js, picks the correct build command (`next build`) and output, and provisions Functions automatically. Only add `vercel.json` if/when you need to set a non-default `maxDuration` for the chat SSE route or pin a region:
  ```json
  {
    "functions": {
      "app/api/chat/[roomId]/stream/route.ts": { "maxDuration": 60 }
    }
  }
  ```
  Keep this file out of the repo until it's actually needed — an empty/default `vercel.json` adds a maintenance surface for no benefit.
- **Node version**: pin via `"engines": { "node": ">=20.9.0" }` in `package.json` (Next 16's floor) and/or a `.nvmrc`/Vercel project setting for Node 22 (current Vercel default LTS as of 2026) — don't rely on Vercel's platform default silently matching what you tested against locally.
- **Build settings**: default `npm install` / `next build` / `.next` output all work unmodified; no custom `buildCommand`/`outputDirectory` needed.
- **`README.md` "Deploy" section** should state explicitly: *"Deploy button works with zero configuration — the app runs on seeded in-memory data. For persistence across deploys, add a `DATABASE_URL` env var pointing at any Postgres (e.g. a free Neon project) after deploying, then redeploy."* Include a Vercel "Deploy" button (`https://vercel.com/new/clone?repository-url=<repo>`) — no `env` query params on that URL, since none are required.

### Keeping `npm install && npm run dev` sufficient locally
- The in-memory `DataStore` means `npm run dev` needs no database step, no `docker compose up`, no seed script to run separately — seeding happens automatically at first `getDataStore()` call.
- `package.json` scripts:
  ```json
  {
    "scripts": {
      "dev": "next dev",
      "build": "next build",
      "start": "next start",
      "lint": "eslint .",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test",
      "db:generate": "drizzle-kit generate",
      "db:push": "drizzle-kit push"
    }
  }
  ```
  Note `db:*` scripts are **never** in `dev`/`build`/`start` — they're only relevant to someone who opted into the Postgres path.

---

## Directory layout (hexagonal-ish)

```
.
├── e2e/                                # Playwright specs
│   ├── auth.spec.ts
│   ├── trade-flow.spec.ts
│   └── chat.spec.ts
├── src/
│   ├── domain/                         # pure, framework-free business logic
│   │   ├── market.ts
│   │   ├── pricing.ts
│   │   ├── pricing.property.test.ts    # Vitest + fast-check
│   │   ├── order.ts
│   │   └── chat.ts
│   ├── ports/                          # interfaces only — no implementations
│   │   ├── data-store.ts
│   │   ├── data-store.contract-test.ts # shared contract test suite
│   │   └── auth-provider.ts
│   ├── adapters/
│   │   ├── data-store/
│   │   │   ├── memory/
│   │   │   │   ├── memory-store.ts
│   │   │   │   ├── memory-store.test.ts
│   │   │   │   └── seed.ts
│   │   │   └── postgres/
│   │   │       ├── schema.ts           # Drizzle schema
│   │   │       ├── client.ts           # PGlite (local) vs Neon (prod) driver selection
│   │   │       ├── drizzle-store.ts
│   │   │       └── drizzle-store.test.ts
│   │   └── auth/
│   │       └── demo/
│   │           ├── demo-auth-provider.ts
│   │           └── verify-session.ts
│   ├── lib/
│   │   ├── get-data-store.ts
│   │   ├── get-auth-provider.ts
│   │   ├── env.ts                       # zod schema, all fields optional
│   │   └── cn.ts                        # shadcn-style classnames helper
│   ├── components/
│   │   ├── ui/                          # shadcn-generated primitives (button, dialog, tabs, ...)
│   │   ├── price-chart.tsx
│   │   ├── sparkline.tsx
│   │   ├── outcome-chip.tsx
│   │   ├── order-ticket.tsx
│   │   └── chat-panel.tsx
│   ├── hooks/
│   │   ├── use-market-price.ts
│   │   └── use-chat-stream.ts
│   └── app/
│       ├── globals.css
│       ├── layout.tsx
│       ├── page.tsx                     # market list / browse
│       ├── (marketing)/...
│       ├── (app)/
│       │   ├── layout.tsx
│       │   └── markets/
│       │       └── [id]/
│       │           ├── page.tsx
│       │           ├── layout.tsx       # declares {children} + {modal} slots
│       │           ├── loading.tsx
│       │           ├── error.tsx
│       │           └── @modal/
│       │               ├── default.tsx
│       │               └── (.)trade/page.tsx
│       ├── proxy.ts                     # Next 16 name for middleware
│       └── api/
│           ├── chat/[roomId]/stream/route.ts
│           ├── chat/[roomId]/messages/route.ts
│           ├── markets/[id]/price/route.ts
│           └── session/route.ts
├── drizzle.config.ts
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── vercel.json                          # ABSENT by default; add only when a route needs it
├── .env.local.example                   # documents optional vars, none required
└── package.json
```

---

## Config files

### `package.json` (dependency versions as resolved 2026-08-09 — re-verify before scaffolding)
```json
{
  "name": "prediction-market-demo",
  "private": true,
  "engines": { "node": ">=20.9.0" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "next": "16.3.0",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "jose": "6.2.8",
    "zod": "4.4.3",
    "swr": "2.5.0",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "tailwind-merge": "3.6.0",
    "lightweight-charts": "5.2.0",
    "nanoid": "6.0.1",
    "radix-ui": "1.6.7",
    "drizzle-orm": "0.45.2",
    "@electric-sql/pglite": "0.5.4",
    "@neondatabase/serverless": "1.1.0"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "26.2.0",
    "@types/react": "19.2.5",
    "@types/react-dom": "19.2.3",
    "tailwindcss": "4.3.3",
    "@tailwindcss/postcss": "4.3.3",
    "eslint": "10.8.1",
    "eslint-config-next": "16.3.0",
    "drizzle-kit": "0.31.10",
    "vitest": "4.1.10",
    "@fast-check/vitest": "0.4.1",
    "fast-check": "4.9.0",
    "@vitejs/plugin-react": "^4",
    "vite-tsconfig-paths": "^5",
    "@playwright/test": "1.62.1"
  }
}
```
> Note: pin `typescript` to the `5.x` line explicitly (e.g. `5.9.3`) rather than letting it float to the `typescript@7` prerelease `npm view` surfaced — TS 7 (the native Go-ported compiler) is a major toolchain shift; don't take it on for this project without a deliberate decision. This is exactly the kind of version pin to flag rather than silently bump.

### `next.config.ts`
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Cache Components stays OFF by default — opt in per-segment with "use cache" once
  // the pricing engine and data model have stabilized, not before.
};

export default nextConfig;
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `postcss.config.mjs`
```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

### `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'node',       // domain/pricing tests need no DOM; add a jsdom project for component tests if needed
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**'],
  },
});
```

### `playwright.config.ts`
(shown in full in §7)

### `drizzle.config.ts` (only relevant once `DATABASE_URL` is set)
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/adapters/data-store/postgres/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

---

## Sources
- [Next.js 16 blog post](https://nextjs.org/blog/next-16)
- [Next.js May 2026 security release — Vercel changelog](https://vercel.com/changelog/next-js-may-2026-security-release)
- [Next.js 16.2: use cache, Turbopack, Proxy API](https://www.nandann.com/blog/nextjs-16-2-complete-guide)
- [Next.js 16 Migration Guide — Turbopack, Proxy, Cache Components](https://pockit.tools/blog/nextjs-16-migration-guide-turbopack-proxy-cache-components/)
- [Tailwind CSS v4 — What Actually Changed](https://dev.to/malahim_haseeb_981126d794/tailwind-css-v4-what-actually-changed-and-what-it-means-for-your-nextjs-project-472f)
- [Tailwind CSS v4 in 2026: The Definitive Guide](https://www.egnworks.com/blog/tailwind-css-v4-in-2026-why-it-dominates-modern-frontend-styling)
- [Prototyping on Vercel + Next.js Without an External DB: 6 Embedded Databases](https://codenote.net/en/posts/vercel-nextjs-embedded-database-prototyping/)
- [Is SQLite supported in Vercel? — Vercel Knowledge Base](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
- [Bringing SQLite to Vercel Functions with Turso](https://turso.tech/blog/serverless)
- [Vercel Functions can now run up to 30 minutes](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)
- [Vercel Docs — Streaming](https://vercel.com/docs/functions/streaming-functions)
- [Vercel Docs — Configuring Maximum Duration for Functions](https://vercel.com/docs/functions/configuring-functions/duration)
- [Auth.js — Migrating to v5](https://authjs.dev/getting-started/migrating-to-v5)
- [Next.js Session Management — solving NextAuth persistence issues](https://clerk.com/articles/nextjs-session-management-solving-nextauth-persistence-issues)
- [PGlite — ORM and Query Builder Support](https://pglite.dev/docs/orm-support)
- [Drizzle ORM — Connect PGlite](https://orm.drizzle.team/docs/connect-pglite)
- [Drizzle ORM — Get Started with Neon](https://orm.drizzle.team/docs/get-started/neon-new)
- [pglite-prisma-adapter — npm (community-maintained)](https://www.npmjs.com/package/pglite-prisma-adapter)
- [Add official driver adapter for pglite · prisma/prisma#23752](https://github.com/prisma/prisma/issues/23752)
- [Best React Chart Libraries in 2026 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2026/)
- [Recharts vs Chart.js vs Nivo vs visx 2026 — PkgPulse](https://www.pkgpulse.com/guides/recharts-vs-chartjs-vs-nivo-vs-visx-react-charting-2026)
- [shadcn/ui — Installing (Vercel Academy)](https://vercel.com/academy/shadcn-ui/installing-shadcn-ui)
- [@fast-check/vitest — npm](https://www.npmjs.com/package/@fast-check/vitest)
- [Property-Based Testing in JavaScript 2026 — PkgPulse](https://www.pkgpulse.com/guides/property-based-testing-fast-check-javascript-2026)
- [Playwright + Next.js webServer setup examples (vercel/next.js canary example)](https://github.com/vercel/next.js/blob/canary/examples/with-playwright/playwright.config.ts)
- Version numbers cross-checked directly against the npm registry (`npm view <pkg> version`/`dist-tags`) on 2026-08-09.
