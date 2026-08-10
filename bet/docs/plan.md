# Bet — Implementation Plan

Execution model: subagent-driven development. One implementer per task, a task review
after each, fix loop, then a whole-branch review.

Reference documents (implementers: read only what your brief names):
- `SPEC.md` — product + UI specification (the contract)
- `DECISIONS.md` — why things are the way they are
- `research/pricing-mechanisms.md` — formulas, worked examples, invariants
- `research/social-and-invites.md` — schemas, state machines, authz matrix
- `research/stack.md` — Next.js 16 / Vercel specifics
- `research/design-tokens-extracted.md` — real colors from the live sites
- `research/kalshi.md`, `research/polymarket.md` — UI anatomy

---

## Global Constraints

These bind **every** task. A review that finds a violation of any of these is a
Critical or Important finding.

### G1 — Layering (dependency inversion)
```
src/domain/     pure TS. MUST NOT import from `next`, `react`, `react-dom`,
                `src/adapters/**`, or `src/app/**`. Imports from `src/ports/**` are fine.
src/ports/      interfaces and types ONLY. No runtime logic beyond type guards.
src/adapters/   implements ports. May import domain + ports. MUST NOT import `src/app/**`.
src/app/        Next.js routes/pages. Thin: parse → authorize → call domain → serialize.
src/components/ UI. MUST NOT import `src/adapters/**` directly; data arrives via props
                or via `src/app` server components.
src/lib/        cross-cutting helpers (composition root, fetch client, cn()).
```
There is a test (`src/domain/__tests__/layering.test.ts`, Task 1) that enforces G1 by
scanning imports. Do not weaken it.

### G2 — Money
All money is **integer cents**, branded as `Credits` from `src/domain/money.ts`. Never
use bare `number` for money in a signature. Never use `+`/`-`/`*` directly on money —
use the module's helpers. Rounding at a boundary never favors the trader.

### G3 — Server-authoritative pricing
A client-supplied price, quote, or cost is never trusted. `POST /trades` re-derives the
quote from committed state. See DECISIONS D4.

### G4 — Validation and error envelope
Every route handler validates input with Zod. Every response is exactly
`{ data: T }` or `{ error: { code: string, message: string, fields?: Record<string,string> } }`.
HTTP status matches the error code. Unauthorized reads of private resources return
**404**, never 403 (D6).

### G5 — Authorization
Every route handler calls `can(actor, action, resource)` from `src/domain/authz.ts`
before reading or writing. No route hand-rolls its own membership `if`.

### G6 — Numeric display
Every probability, price, multiplier, credit amount and countdown renders through
`src/domain/formatters.ts` and carries `tabular-nums`. No ad-hoc `toFixed()` in a
component.

### G7 — Design tokens
Colors, spacing, radii come from the CSS custom properties defined in Task 1. No hex
literals in components. Bet's surface uses the `--accent` indigo family; `/explore` uses
the `[data-surface="explore"]` scope with Kalshi's mint. See SPEC §7.

### G8 — Testing
- Domain logic: unit tests, plus property tests (`fast-check`) for the pricing invariants.
- Adapters: run against the shared `DataStore` contract suite.
- Routes: tested by calling the exported handler functions directly with a `Request`.
- Every task leaves `npm run typecheck`, `npm run lint`, and `npm test` green.
- No test asserts nothing. No `expect(true).toBe(true)`. No snapshot-only tests for logic.

### G9 — Accessibility
Focus-visible rings on all interactive elements. Probability never conveyed by color
alone. Buttons are `<button>`, links are `<a>`. Modals trap focus and close on Escape.

### G10 — No real money, ever
No payment code, no deposit/withdraw UI, no wording implying real currency. Balances are
"credits". See DECISIONS D1.

### G11 — Do not run git
Implementers **do not** run `git add`, `git commit`, or any other git command. Tasks run
in overlapping waves against one working tree, and concurrent git invocations corrupt the
index. Write your files, run the tests, report. The controller commits.

---

## Task 1 — Foundations, config, design tokens

**Files:** `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `eslint.config.mjs`,
`vitest.config.mts`, `vitest.setup.ts`, `playwright.config.ts`, `.gitignore`,
`.env.example`, `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/cn.ts`,
`src/domain/money.ts`, `src/domain/formatters.ts`, `src/domain/result.ts`,
`src/domain/__tests__/layering.test.ts` + tests for money/formatters.

1. **Configs.** Next 16.3 App Router, TypeScript strict, path alias `@/*` → `src/*`.
   Tailwind v4 via `@tailwindcss/postcss` (CSS-first, no `tailwind.config.js`).
   Vitest with `jsdom` environment, `vite-tsconfig-paths`, globals enabled.
   Playwright config: `baseURL: http://localhost:3000`, `webServer` running
   `npm run dev`, chromium project, `testDir: e2e`.
2. **`globals.css`.** Tailwind v4 `@import "tailwindcss";` then an `@theme` block
   defining the token scale from SPEC §7.1 verbatim (surfaces, borders, text, accent,
   yes/no, warn), radii (`--radius-card: 12px`, `--radius-input: 8px`,
   `--radius-pill: 999px`), and the Inter font stack with
   `font-feature-settings: "cv01","cv02","cv03","cv04","cv11"`. Dark-first: the tokens
   above are the default on `:root`. Add a `[data-surface="explore"]` scope that
   redefines surfaces/accent to Kalshi's values (`--surface-0:#0a0c0f`,
   `--surface-1:#13161a`, `--surface-2:#1b2029`, `--accent:#28cc95`,
   `--no:#ff409f`) — SPEC §7.3. Base `body` background and color from tokens.
   A `.tnum` utility applying `font-variant-numeric: tabular-nums`.
3. **`money.ts`.** `type Credits = number & { readonly __brand: "Credits" }`.
   Functions: `credits(n: number): Credits` (asserts integer), `fromDecimal(d: number)`,
   `add`, `sub`, `mul(c, factor, rounding)`, `zero`, `compare`, `clamp`, `isNegative`,
   `toDecimal`. Rounding modes `"up" | "down" | "nearest"`; `mul` requires an explicit
   mode. Throws on non-finite or non-integer construction.
4. **`formatters.ts`.** `formatCredits(c)` → `"1,240"`; `formatProbability(p)` → `"72%"`;
   `formatPriceCents(p)` → `"72¢"`; `formatMultiplier(p)` → `"1.39x"` (`1/p`, 2dp,
   `"—"` when `p<=0`); `formatCountdown(msRemaining)` → `"2d"`, `"4h"`, `"12m"`,
   `"closed"`; `formatVolume(c)` → `"1.2K"`, `"4.9M"`; `formatRelativeTime(date, now)`.
   All pure, all take an explicit `now` where time matters (no hidden `Date.now()`).
5. **`result.ts`.** `type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E }`
   with `ok()`, `err()`, `isOk()`, `unwrapOr()`. `AppError` = `{ code, message, fields? }`
   with a `code` union covering `not_found | forbidden | validation | conflict |
   insufficient_balance | market_closed | rate_limited | internal`.
6. **`layering.test.ts`.** Walk `src/domain/**/*.ts`, parse import specifiers with a
   regex, and assert none match `^(next|react|react-dom)` or `@/adapters` or `@/app`.
   Assert the test itself finds at least 3 files (so it can't pass vacuously).
7. **`layout.tsx`.** Root layout, `<html lang="en" className={inter.variable}>`,
   metadata (title `Bet — wanna bet?`, description from the slogan), imports globals.css.
   Use `next/font/local`? No — use `next/font/google` Inter with the variable axis.

**Done when:** `npm run typecheck`, `npm run lint`, `npm test` all pass; `npm run dev`
serves a blank dark page; money and formatter tests cover the rounding edge cases
(0, negative, large, half-way rounding in each mode).

---

## Task 2 — Pricing engines + property tests

**Files:** `src/domain/pricing/types.ts`, `engine.ts`, `lmsr.ts`, `fixed-odds.ts`,
`parimutuel.ts`, `fees.ts`, `registry.ts`, `src/domain/pricing/__tests__/*`.

Read `research/pricing-mechanisms.md` §2, §4, §5, §6, §7 for formulas and worked examples.

1. **`types.ts`** — `OutcomeId`, `MarketState` discriminated union
   (`{kind:"lmsr"; b; q}` | `{kind:"fixedOdds"; openingPrices; escrow}` |
   `{kind:"parimutuel"; rakeBps; pools}`), `Order`
   (`{outcomeId, side:"buy"|"sell", shares?: number, budget?: Credits, maxCost?: Credits}`),
   `Quote` (`{shares, cost: Credits, avgPrice, priceImpact, fee: Credits}`),
   `Payout` (`{userId, amount: Credits}`), `Position`.
2. **`engine.ts`** — the `PricingEngine` interface exactly as SPEC §6.1, plus an
   `abstract class BasePricingEngine` providing shared guards: reject orders on a
   non-open market, reject `shares` and `budget` both set or both unset, reject
   non-positive quantities, enforce `maxCost` slippage, and normalize prices to sum
   to 1. Concrete engines extend it.
3. **`lmsr.ts`** — implement with the **log-sum-exp shift** for stability
   (`m = max(qᵢ/b)`; `C = b·(m + ln Σ exp(qᵢ/b − m))`). Implement
   `sharesForBudget` by closed form for the 2-outcome case and bisection
   (≤60 iterations, 1e-9 tolerance) for n-outcome. `settle` pays 1 credit per winning
   share. Export `lmsrPrices(q, b)` and `lmsrCost(q, b)` for tests.
4. **`fixed-odds.ts`** — creator sets opening probabilities; buying escrows
   `shares × price` and prices do **not** move; `settle` pays winners from escrow and
   returns the unmatched remainder to its stakers. Document the peer-to-peer matching
   rule in a comment.
5. **`parimutuel.ts`** — pools per outcome; `currentPrices` = pool share (implied
   probability); `quote` cost = stake, shares = stake (1:1); `settle` distributes
   `totalPool × (1 − rake)` pro-rata to the winning pool, with the integer-cent
   remainder assigned deterministically (largest-remainder method) so no cents are lost.
6. **`fees.ts`** — `takerFee(contracts, price) = ceilCents(0.07 × C × P × (1−P))` and
   `makerFee = 0.0175 × C × P × (1−P)` (Kalshi's published formulas — see
   `research/kalshi.md`). A market's `feeBps` of 0 disables fees; default for friend
   markets is 0.
7. **`registry.ts`** — `getEngine(kind): PricingEngine`, exhaustive over the union,
   throwing on an unknown kind.
8. **Tests.** A **shared invariant suite** exported as a function
   `runPricingInvariants(name, engine, arbState)` and invoked once per engine, covering
   SPEC §6.5 invariants 1–5 and 7 with `fast-check`. Plus explicit unit tests
   reproducing the **worked numeric examples** from `research/pricing-mechanisms.md`
   §2.6 (2-outcome), §2.7 (3-outcome), §4.2 (parimutuel), §7.1 (fee table) — assert the
   documented numbers to the documented precision.

**Done when:** all engines pass the shared invariant suite; the worked examples match;
`npm test` green. The round-trip-never-profits property must genuinely fail if you flip
the sign of the cost function (verify by trying it, then reverting).

---

## Task 3 — Entities, DataStore port, in-memory adapter

**Files:** `src/domain/entities.ts`, `src/domain/market-state.ts`,
`src/ports/data-store.ts`, `src/ports/clock.ts`, `src/ports/id.ts`,
`src/adapters/memory/*.ts`, `src/adapters/__tests__/data-store-contract.ts`,
`src/adapters/__tests__/memory.test.ts`.

1. **`entities.ts`** — every type from SPEC §4, exactly those field names. Ids are
   branded string types (`UserId`, `MarketId`, …) to prevent cross-assignment.
2. **`market-state.ts`** — the status machine from SPEC §4:
   `canTransition(from, to): boolean`, `assertTradable(market, now)`,
   and `nextStatusForClock(market, now)` (open → closed when `now >= closesAt`).
   Pure, table-driven, fully unit-tested including every illegal transition.
3. **`ports/clock.ts`** — `interface Clock { now(): Date }`. `ports/id.ts` —
   `interface IdGen { next(prefix: string): string }`. Both exist so tests are
   deterministic; the domain never calls `Date.now()` or `nanoid()` directly.
4. **`ports/data-store.ts`** — one interface per aggregate
   (`UserRepo`, `FriendRepo`, `GroupRepo`, `MarketRepo`, `PositionRepo`, `TradeRepo`,
   `MessageRepo`, `InviteRepo`, `NotificationRepo`, `PriceHistoryRepo`) plus a
   `DataStore` aggregating them and a `transact<T>(fn): Promise<T>` for atomic
   multi-repo writes. Methods return `Promise`. Reads that can miss return
   `T | undefined`, never throw.
5. **In-memory adapter** — `Map`-backed, structurally cloning on read so callers can't
   mutate stored state by reference (this is a real bug class — test it).
   `transact` runs the callback against a staged copy and commits atomically on success,
   discarding on throw.
6. **Contract suite** — `runDataStoreContract(name, makeStore)` exercising every method
   including: absent reads return `undefined`; `transact` rolls back on throw; keyset
   message pagination returns stable, non-overlapping pages; friendship stores ordered
   pairs; concurrent-ish balance updates inside `transact` don't interleave.

**Done when:** the in-memory adapter passes the full contract suite, and the mutation-by-
reference test genuinely fails if you return stored objects directly.

---

## Task 4 — Authz policy + auth adapter + composition root

**Files:** `src/domain/authz.ts`, `src/ports/auth.ts`, `src/adapters/auth/demo-session.ts`,
`src/lib/container.ts`, `src/lib/http.ts`, `src/app/api/session/route.ts`,
`src/app/api/me/route.ts`, `src/app/signin/page.tsx`, `proxy.ts`, tests.

1. **`authz.ts`** — `can(actor: Actor, action: Action, resource: Resource, ctx): boolean`
   implementing the matrix in `research/social-and-invites.md` §7.2 exactly. Resource
   union: `market | room | position | invite | friendGraph | group`. Pure — takes the
   membership facts it needs in `ctx`, does no I/O. Exhaustively unit-tested: for each
   resource, one allowed case and one denied case per role (owner / member / invitee /
   stranger).
2. **`ports/auth.ts`** — `interface AuthProvider { createSession(userId): Promise<string>;
   verify(token): Promise<{ userId } | null> }`.
3. **`demo-session.ts`** — `jose` HS256 JWT, 7-day expiry, cookie `bet_session`,
   `httpOnly`, `sameSite: "lax"`, `secure` in production, `path: "/"`. Secret from
   `AUTH_SECRET` env with a documented development fallback constant (and a loud
   `console.warn` when the fallback is used).
4b. **`lib/http.ts`** — `jsonOk(data, init?)`, `jsonErr(error, status?)`,
   `parseBody(req, schema)`, and a `handler()` wrapper that catches thrown `AppError`s
   and unexpected errors (logging the latter, returning `internal` without leaking the
   message). Status mapping: `validation→400, forbidden→403, not_found→404,
   conflict→409, rate_limited→429, insufficient_balance→422, market_closed→409,
   internal→500`. Every later task's routes use this module.

4. **`container.ts`** — the composition root. Builds the singleton `DataStore` (seeded,
   Task 5), `Clock`, `IdGen`, `AuthProvider`, and exposes `getContainer()`. This is the
   **only** module that constructs adapters. Also exports
   `requireUser(req): Promise<User>` and `getActor(req)`.
5. **Routes** — `POST /api/session` `{userId}` → sets cookie; `DELETE` → clears;
   `GET /api/me` → current user, balance, groups. All obey G4.
6. **`proxy.ts`** (Next 16's renamed middleware) — redirect unauthenticated `/app/**`
   requests to `/signin`. Verify the JWT at the edge; re-verify in handlers (never trust
   the edge alone).
7. **`/signin`** — a plain server-rendered grid of seeded demo users as cards; clicking
   one posts to `/api/session` and redirects to `/app`. Styled with Task 1 tokens.

**Done when:** signing in as a demo user sets a cookie and `/app` stops redirecting;
`authz.ts` tests cover every row of the matrix.

---

## Task 5 — Seed data

**Files:** `src/adapters/memory/seed.ts`, `src/adapters/memory/seed-data/*.ts`, tests.

Deterministic (seeded PRNG, no `Math.random()` at module scope — the same seed must
produce byte-identical data so tests and snapshots are stable).

- **12 demo users** with real-feeling handles, display names, avatar colors, 1,000
  credits each. One is the "you" default (`@dev`).
- **3 groups**: `Sunday League` ⚽, `The Roommates` 🏠, `Fantasy 2026` 🏆, with
  overlapping membership so group-switching is meaningful.
- **~10 private markets** across the groups covering every status (`open`, `closed`,
  `resolving`, `resolved`) and every pricing kind (`lmsr` ×6, `fixedOdds` ×2,
  `parimutuel` ×2). Questions must sound like real friend bets, not lorem ipsum:
  e.g. "Will Marcus actually run the 10k on Saturday?", "Does anyone do the dishes
  before Thursday?", "Will Priya's flight be delayed again?".
- **Trade history** generated by *actually executing trades through the pricing engines*
  (not by writing prices directly) so positions, balances, price history and the
  bounded-loss invariant are all internally consistent. Back-date them across ~14 days.
- **Price history** captured after each seeded trade.
- **Chat messages** per market, interleaved with the system trade events, in a voice that
  matches the market. 8–20 messages for busy markets.
- **Friendships + 3 pending friend requests + 2 pending market invites** so those UIs
  have content.
- **~24 public Explore markets** across categories (Politics, Sports, Crypto, Culture,
  Economics, Climate, Tech) with volume, multi-outcome and binary shapes, and 90 days of
  synthetic price history per market (random-walk with drift, clamped to [0.02, 0.98]).

**Done when:** a test asserts the seed is deterministic (two builds deep-equal), that
every seeded market's prices sum to 1, that every user's balance equals
`1000 − Σ trade costs + Σ settled payouts`, and that no seeded market violates the
bounded-loss invariant.

---

## Task 6 — API: users, friends, groups, invites

**Files:** `src/app/api/users/search/route.ts`, `src/app/api/friends/**`,
`src/app/api/groups/**`, `src/app/api/invites/**`, `src/lib/http.ts`, tests.

1. `lib/http.ts` already exists from Task 4 — use `jsonOk` / `jsonErr` / `parseBody` /
   `handler()` from it. Do not create a second HTTP helper module.
2. **`GET /api/users/search?q=`** — min 2 chars, case-insensitive prefix on handle and
   display name, capped at 10 results, excludes self. Returns only
   `{id, handle, displayName, avatarColor, isFriend, hasPendingRequest}` — never emails,
   never friend lists. In-memory token-bucket rate limit (20 req / 10s per user)
   returning `rate_limited`.
3. **Friends** — `GET /api/friends`; `POST /api/friends/requests {toHandle}`;
   `POST /api/friends/requests/[id] {action: accept|decline|cancel}`. Enforce: no
   self-request, no duplicate pending in either direction (return `conflict`), accepting
   creates the ordered friendship row atomically inside `transact`, only the recipient
   may accept/decline, only the sender may cancel.
4. **Groups** — `GET /api/groups` (mine); `POST /api/groups {name, emoji}` (slug
   generated, uniquified); `GET /api/groups/[slug]` (members + markets, 404 for
   non-members per G4/D6); `POST /api/groups/[slug]/members {handle}` (must be a friend
   of the actor; creates an invite, not a direct add).
5. **Invites** — `POST /api/invites {targetType, targetId, inviteeId?|kind:"link"}`;
   `GET /api/invites/[token]` (preview, no auth required, returns only the minimum:
   target name, inviter display name, expiry); `POST /api/invites/[id] {action}`.
   Link tokens: random 32-byte id, only the **hash** stored, DB is the source of truth
   for revocation, 7-day expiry.

**Done when:** each route has handler-level tests covering happy path, unauthorized
(404/403 per G4), and validation failure. Test the rate limiter actually trips.

---

## Task 7 — API: markets, quote, trade, resolve, messages, explore

**Files:** `src/app/api/markets/**`, `src/app/api/explore/route.ts`,
`src/domain/services/trading.ts`, `src/domain/services/resolution.ts`, tests.

1. **`domain/services/trading.ts`** — the trade use-case, pure except for the injected
   `DataStore`. `executeTrade({actor, marketId, order})`:
   authorize → load market → assert tradable at `clock.now()` → assert balance and
   `minStake`/`maxStake` → get engine from registry → `execute` → inside **one
   `transact`**: debit balance, upsert position (recomputing average cost basis),
   append trade, persist new market state, append a price point, append a **system
   chat message** (D11), and create notifications for other participants. Returns the
   realized `Quote`. Enforces `maxCost` slippage (G3).
2. **`resolution.ts`** — `propose`, `dispute`, `vote`, `finalize`. Only the creator may
   propose; only participants may dispute or vote; `finalize` is allowed after the 12h
   window or on a decided vote; settlement runs the engine's `settle` and credits
   payouts inside one `transact`, sets status `resolved` **exactly once** (a second call
   returns `conflict`, never double-pays — test this explicitly).
3. **Routes** — `GET /api/markets/[id]` (market + prices + my position + holders,
   404 for non-members); `POST /api/markets` (wizard payload → market + outcomes +
   invites in one `transact`); `POST /api/markets/[id]/quote`;
   `POST /api/markets/[id]/trades`; `POST /api/markets/[id]/resolve {action, outcomeId?}`;
   `GET /api/markets/[id]/history`; `GET|POST /api/markets/[id]/messages`
   (keyset `?before=`, `limit` capped at 50; POST idempotent on `clientId` — posting the
   same `clientId` twice returns the original message, does not duplicate).
4. **`GET /api/explore`** — public markets grouped by category with trending ordering;
   no auth required; never returns private markets (test this).

**Done when:** trading tests prove: balance conservation across a buy/sell round trip,
rejection when closed, rejection on insufficient balance, slippage bound enforced,
double-settlement rejected, and that a trade creates exactly one system chat message.

---

## Task 8 — UI primitives

**Files:** `src/components/ui/*.tsx` + `src/components/charts/*`, tests for the pure parts.

Build only what the later tasks consume — no speculative components (YAGNI):
`Button` (variants: primary/secondary/ghost/danger/yes/no; sizes sm/md/lg; loading state),
`Card`, `Pill` (the outlined probability chip from SPEC §5.1 — transparent fill, 32%-alpha
border, solid text, tabular), `Avatar` + `AvatarStack`, `Input`, `Textarea`, `Select`,
`Tabs`, `Modal` (focus trap, Escape, scroll lock), `Sheet`, `Toast` + provider,
`Skeleton`, `EmptyState`, `Countdown` (client, ticks once per minute), `Badge`,
`ProgressBar`, `Tooltip`.

**Charts** (D13): `src/domain/chart.ts` — pure path math:
`buildLinePath(points, {width, height, yMin, yMax})` → SVG `d` string;
`buildAreaPath(...)`; `niceTicks(min, max, count)`. Unit-tested with known inputs
(a flat series, a single point, an empty series, a series with equal x values).
`src/components/charts/ProbabilityChart.tsx` — server-renderable SVG, one path per
outcome, y-axis 0–100%, x tick labels, final-point dots; a thin `"use client"` wrapper
adds the hover crosshair.
`src/components/charts/Sparkline.tsx` — 60×20 inline SVG for cards.

All components take `className` and forward refs where a parent would need one. No
component reaches for data — props only (G1).

**Done when:** chart path math is unit-tested; Modal traps focus (tested with
@testing-library/user-event); Button renders as `<button>` and Pill shows the numeral.

---

## Task 9 — App shell + group dashboard

**Files:** `src/app/(app)/layout.tsx`, `src/app/(app)/app/page.tsx`,
`src/app/(app)/app/g/[slug]/page.tsx`, `src/components/app-shell/*`,
`src/components/market/MarketCard.tsx`.

- **TopBar**: logo, **group tabs** (the group names — active tab underlined in
  `--accent`), `+` to create a group, search icon, notification bell with unread count,
  user menu (handle, balance, sign out). Tabs scroll horizontally on narrow screens.
- **SubNav**: `Markets · Members · Leaderboard` + `+ New bet` CTA.
- **Group dashboard**: sectioned grid (`Closing soon`, `Open`, `Awaiting resolution`,
  `Settled`), responsive 1/2/3 columns, `MarketCard` per SPEC §5.1 exactly — avatar
  stack, close countdown, question, up to 3 outcome rows each with label + multiplier +
  probability pill, footer with volume, trader count and message count. Empty state with
  a `Create the first bet` CTA.
- **Right rail** at xl: group leaderboard (net credits), pending invites, recent activity.
- `/app` resolves the user's first group and redirects; if the user has no groups, show
  an onboarding empty state.

Server Components fetch through the container; interactivity is isolated in small client
components. **Done when:** the dashboard renders seeded markets with correct prices and
the tabs switch groups.

---

## Task 10 — Market view: chart, order ticket, positions, Room

**Files:** `src/app/(app)/app/g/[slug]/m/[id]/page.tsx`, `src/components/market/*`,
`src/components/room/*`, `src/lib/api-client.ts`.

- **Header**: back link, question, status badge, close countdown, creator, participant
  avatars.
- **Price panel**: leading probability as a large numeral with a 24h delta chip;
  `ProbabilityChart` with a series per outcome; a legend with each outcome's current
  price and multiplier.
- **OrderTicket** per SPEC §5.2: outcome tabs, Buy/Sell toggle, credit amount input with
  quick chips (10/25/50/Max), debounced (150ms) live quote from `/quote` showing shares,
  avg price, to-win, price impact and fee; submit posts to `/trades` with a `maxCost`
  computed from the displayed quote plus a 2% tolerance; success refreshes and toasts.
  Disabled states carry an explicit reason string.
- **Your position / Holders / Rules / Activity** tabs.
- **Room** per SPEC §5.4: keyset-paginated list, author grouping, system trade events as
  inline chips (not bubbles), optimistic send keyed by `clientId`, 4s polling while the
  document is visible (pause when hidden), composer with `⌘↵`. The transport goes through
  a `RealtimeChannel` port implementation (`src/adapters/realtime/polling.ts`).
- **Resolution UI**: creator sees `Propose outcome`; during the dispute window everyone
  sees the proposal, a countdown and a `Dispute` button; disputed markets show the vote.

**Done when:** placing a trade in the browser moves the price, appears in the Room as a
system message, and updates the balance in the top bar.

---

## Task 11 — Create-bet wizard

**Files:** `src/app/(app)/app/new/page.tsx`, `src/components/wizard/*`,
`src/lib/draft-storage.ts`.

The five steps from SPEC §3.4, with a step indicator, Back/Next, per-step validation
(inline errors, never a bulk dump), and **draft persistence** to `localStorage` on every
change (keyed per user) so refresh never loses work. Step 4 lists friends first as
chips before any typing, then debounced search; non-friends are shown disabled with the
tooltip "add them as a friend first"; a `Copy invite link` action creates a link invite.
Step 5 renders the review with per-section `Edit` jumps that preserve all other steps.
Submit posts once to `/api/markets`, clears the draft, and routes to the new market.

Pricing step: three cards (`Market-priced` default / `Set your own odds` / `Pool`) with a
one-line explanation of each in plain language — no jargon like "LMSR" in the UI, but a
`How pricing works` disclosure that explains it honestly for the curious.

**Done when:** a bet created through the wizard appears on the group dashboard and is
tradable; refreshing mid-wizard restores every field.

---

## Task 12 — Friends, invites, notifications UI

**Files:** `src/app/(app)/app/friends/page.tsx`, `src/app/(app)/app/activity/page.tsx`,
`src/app/invite/[token]/page.tsx`, `src/components/friends/*`.

- **Friends page**: search field, `Friends | Requests | Sent` tabs, user cards with
  Add/Accept/Decline/Cancel actions, optimistic updates with rollback on failure, empty
  states. **Never** renders another user's friend list (D5).
- **Activity page**: notifications grouped by day (friend requests, invites, trades on
  your markets, resolutions), with read/unread state and a `Mark all read` action.
- **Invite landing** `/invite/[token]`: public preview showing what you're being invited
  to and by whom; signed-out users get a sign-in prompt that returns here afterwards.

**Done when:** the full friend-request round trip works between two demo users, and an
invite link opens a working preview.

---

## Task 13 — Explore surface

**Files:** `src/app/explore/**`, `src/components/explore/*`.

Implement SPEC §3.6 and §7.3. `[data-surface="explore"]` on the layout root so the
Kalshi token scope applies. Two-row nav (bar + category strip) + a chip filter row.
Polymarket's dense grid at `repeat(auto-fill, minmax(300px, 1fr))` with 16px gaps —
1/2/3/4 columns responsive. Three card variants: multi-outcome rows with tinted
`Yes`/`No` buttons; binary with the **circular percentage gauge** (SVG arc, "21% chance");
head-to-head sports with two team buttons and scores. Footers show `$X Vol.` and live
badges. Right rail with Trending and volume hub cards.

`/explore/[id]`: read-only detail with the price chart, a display-only order-book depth
table, holders, rules and resolution source. A dismissible banner states plainly that
Explore is a simulated public-markets showcase and trading happens in your groups.
Yes/No buttons on Explore route to a "this is a showcase" tooltip rather than pretending
to trade.

**Done when:** `/explore` visually reads as a Kalshi/Polymarket hybrid at 1440px and
degrades cleanly to mobile, and no private market ever appears there.

---

## Task 14 — Marketing home + E2E + polish

**Files:** `src/app/page.tsx`, `src/components/marketing/*`, `e2e/*.spec.ts`,
`vercel.json` (only if needed), `README.md`.

1. **Home** per SPEC §3.1 — "wanna bet?" hero, the slogan, two CTAs, three feature
   panels, and a live demo card built from real seeded data.
2. **E2E** (Playwright, chromium): (a) sign in → dashboard renders markets;
   (b) open a market → place a trade → price moves, balance drops, system message
   appears in the Room; (c) create a bet through all five wizard steps → it appears on
   the dashboard; (d) send a friend request from one user, accept as another;
   (e) `/explore` renders cards and a detail page; (f) a signed-out `/app` request
   redirects to `/signin`.
3. **README.md** — index of the codebase, local run, Vercel deploy, architecture
   overview, the pricing model explained, testing instructions, and an honest
   **Known gaps** section (in-memory persistence resets on Vercel; no real auth; no
   Postgres adapter; Explore is simulated; no real money).
4. **Polish pass**: loading and error boundaries per route segment, `not-found.tsx`,
   focus rings, responsive check at 390 / 768 / 1440, and `npm run build` clean.

**Done when:** `npm run build` succeeds, all E2E specs pass against the production build,
and the README's instructions work from a clean clone.
