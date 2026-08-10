# Bet — Decision Log

Every non-obvious choice made building this project, with the reasoning and the
alternatives rejected. Written as the decisions were made, not reconstructed after.

Research backing each decision lives in `research/` (`kalshi.md`, `polymarket.md`,
`pricing-mechanisms.md`, `social-and-invites.md`, `stack.md`,
`design-tokens-extracted.md`).

---

## D1 — Play money only, never real money

**Decision.** All balances are `Credits`, seeded at 1,000 per demo user. There is no
payment integration, no withdrawal, no KYC, and no path to add one.

**Why.** Real-money prediction markets are a regulated activity (Kalshi is a CFTC-regulated
DCM; Polymarket settled with the CFTC and geofences the US). A demo that even *looks*
like it takes deposits invites a category of problem that has nothing to do with the
engineering being demonstrated. Play money keeps every interesting mechanic — pricing,
settlement, P/L — fully intact.

**Rejected.** Stripe test mode (implies a real-money roadmap), "points redeemable later"
(same problem wearing a hat).

---

## D2 — LMSR as the default pricing engine, not a CLOB

**Decision.** Market-priced bets use Hanson's Logarithmic Market Scoring Rule.
`C(q) = b·ln Σ exp(qᵢ/b)`, `pᵢ = softmax(qᵢ/b)`, trade cost `C(q′) − C(q)`.

**Why.** Kalshi and Polymarket both run central limit order books, which work because
they have thousands of counterparties per market. Bet's markets have **5–50 people**.
A CLOB with six participants is an empty book: you place an order and nothing happens,
which is a dead product. An LMSR market maker always quotes a price and always fills,
with a mathematically bounded subsidy of `b·ln(n)` — for a binary market at `b=72` that's
about 50 credits of worst-case house loss, which the "house" (the group) can absorb
because it isn't real money (D1). This is the standard answer for low-liquidity markets
and is why Gnosis, Augur's early design, and every research prediction market use a
scoring rule rather than a book.

**Rejected.** CLOB (thin-book failure above; still implemented conceptually on the
Explore surface as *display-only* depth). CPMM/FPMM (needs real LPs to seed reserves,
and the liquidity story is worse than LMSR at this scale).

**Consequence.** The `b` parameter must be chosen per market:
`b = max(50, 12 × expectedParticipants)`. Too small and one 20-credit bet swings the
price 30 points; too large and the price never moves for a small group.

---

## D3 — Three pricing strategies behind one interface, not one hardcoded model

**Decision.** `PricingEngine` is an interface with `currentPrices` / `quote` / `execute` /
`settle`. Three implementations ship: `lmsr` (default), `fixedOdds` (creator sets the
odds — the brief's "priced in by the users deliberately"), `parimutuel` (pool split).
A registry resolves the engine from `market.pricing.kind`.

**Why.** The brief explicitly asks for both deliberate user pricing *and* Kalshi/Polymarket-
style automatic pricing. That is a strategy pattern, and pretending otherwise would mean
branching on market type in every call site. With the interface, adding CPMM later is a
new file plus a registry entry — no changes to routes, UI, or settlement.

**Consequence.** Every strategy is validated against the **same shared property-test
suite** (§6.5 of SPEC), so a new strategy inherits the invariants rather than needing new
tests written from scratch. This is dependency inversion doing real work: the trade route
depends on the interface, never on LMSR.

---

## D4 — Quotes are recomputed server-side; the client quote is never authoritative

**Decision.** `POST /api/markets/[id]/quote` is a pure preview. `POST .../trades`
re-derives the quote from committed state and executes against *that*, and the client may
send a `maxCost` slippage bound which the server enforces.

**Why.** A client-supplied price is a free-money bug. Two people trading concurrently
must not both get the pre-trade price. This is the single most important correctness rule
in the app.

---

## D5 — Symmetric friendship with directed requests; friend lists are never enumerable

**Decision.** `friendships` stores one row per pair, ordered (`userAId < userBId`).
`friend_requests` is directed with a `pending → accepted | declined | cancelled` machine.
No endpoint anywhere returns another user's friend list.

**Why.** The brief says "works essentially the same way as Instagram, except you can't see
another user's friends." Instagram's *follow* graph is asymmetric, but the property the
brief actually cares about is request→accept plus list privacy. For betting, symmetric is
the right shape: an invite to a private market should require mutual consent, not a
one-way follow. Storing the pair ordered makes "are we friends?" a single primary-key
lookup rather than an OR across two columns.

**Consequence.** Friend-list opacity is enforced in the policy layer as a resource type
(`friendGraph`), not as an ad-hoc check in one route — so a future route can't forget it.

---

## D6 — 404, not 403, for unauthorized reads of private resources

**Decision.** Requesting a market, room, or user you can't see returns `404`.

**Why.** `403` confirms the resource exists, which is an enumeration oracle on a
private-by-default product. If everything is private, the honest answer to "does market
X exist?" from a non-member is "not as far as you're concerned."

---

## D7 — Hexagonal architecture: domain / ports / adapters / app

**Decision.**

```
src/domain/     Pure TypeScript. Pricing engines, market state machine, authz policy,
                money arithmetic, formatters. Zero imports from next/, react, or adapters.
src/ports/      Interfaces only: DataStore, Clock, IdGen, RealtimeChannel, AuthProvider.
src/adapters/   Implementations: in-memory store (default), demo auth, polling channel.
src/app/        Next.js routes — thin. Parse, authorize, call domain, serialize.
src/components/ UI.
```

**Why.** The brief asks for modularity, scalability, dependency inversion and abstract
classes. Concretely that means the pricing math must be testable without a server, the
storage must be swappable without touching routes, and the authorization rule must live
in one place. The domain layer has no framework imports at all, which is what makes the
property tests fast and the engine reusable.

**Enforced by.** A lint rule and a test asserting `src/domain/**` imports nothing from
`next`, `react`, or `src/adapters`.

---

## D8 — In-memory DataStore by default, Postgres adapter as an opt-in port

**Decision.** `DataStore` is a port. The default adapter is in-memory, seeded at boot,
requiring zero configuration. A Postgres adapter is scaffolded behind `DATABASE_URL` but
is **not** implemented in v1 — it's listed in Known Gaps.

**Why.** The requirement is "deployable on Vercel and locally" with a one-shot demo. A
zero-config in-memory store means `npm install && npm run dev` works instantly and
`vercel deploy` works with no database provisioning at all. Prisma+SQLite would break on
Vercel (ephemeral, read-only filesystem); provisioning Neon would add a required setup
step to a demo.

**The honest caveat, stated in the README rather than hidden:** in-memory state on Vercel
is **per-serverless-instance and resets on cold start**. Writes may appear to vanish
between requests hitting different instances. This is correct-by-design for a demo and
fatal for production — hence the port, so the swap is one file.

**Rejected.** Prisma with dual providers (the `datasource.provider` is a fixed literal;
dual-dialect requires schema duplication). Drizzle+PGlite locally / Neon in prod is the
recommended *real* path and is what the Postgres adapter should implement — documented in
Known Gaps rather than half-built.

---

## D9 — Hand-rolled signed-cookie sessions, not Auth.js

**Decision.** A `jose`-signed JWT in an HttpOnly, SameSite=Lax, Secure-in-prod cookie,
issued by a "pick a demo user" screen, behind an `AuthProvider` port.

**Why.** Auth.js v5 has been at `5.0.0-beta.*` for roughly two years; pinning a beta as
the auth foundation of a demo is a liability. The demo needs no passwords, no OAuth
callbacks, and no email. ~60 lines of `jose` gives a correctly-flagged, verifiable
session, and the port means a real provider drops in without touching route code.

**Consequence.** There is no password authentication and anyone can sign in as any demo
user. That is intentional for a demo and is stated plainly in the README — it is the one
place where "security best practices" is deliberately traded for demo ergonomics, and
saying so is better than implying otherwise.

---

## D10 — Chat over polling, behind a RealtimeChannel port

**Decision.** The Room polls `GET /api/markets/[id]/messages` every 4s while the tab is
visible, with optimistic sends keyed by a client-generated `clientId` for idempotency.
The transport sits behind a `RealtimeChannel` interface.

**Why.** Vercel serverless functions cannot hold long-lived WebSocket connections. SSE
works but is bounded by function max-duration and burns an instance per connected client.
For a demo with a handful of concurrent users, 4-second polling is indistinguishable from
realtime, costs nothing, and cannot break. The port means SSE or Ably/Pusher/Supabase is
a swap, not a rewrite.

**Consequence.** Keyset pagination (`before` cursor on `(at, id)`), never offset — offset
pagination double-renders messages when new ones arrive mid-scroll.

---

## D11 — Trade events are chat messages

**Decision.** Executing a trade appends a `kind: "system"` message into the market's Room
("dev bought 40 No @ 29¢").

**Why.** The product thesis is "make the groupchat put their money where their mouth is."
If the trades live in a separate activity tab, the chat is just a chat. Interleaving them
makes the tape *be* the conversation, and it's the single highest-leverage detail
distinguishing Bet from a Polymarket clone with a comment section bolted on.

---

## D12 — Creator-proposes resolution with a dispute window, not an oracle

**Decision.** Creator proposes an outcome → 12-hour dispute window → auto-finalizes if
unchallenged. A dispute escalates to a majority vote of position holders.

**Why.** UMA-style optimistic oracles with bonded disputes are correct for adversarial,
real-money, pseudonymous markets. Friend groups are none of those things — they have
social accountability, which is a stronger enforcement mechanism than a bond. The dispute
window handles honest mistakes; the quorum vote handles bad faith; anything heavier is
ceremony that would never fire.

---

## D13 — Hand-rolled SVG charts, no charting dependency

**Decision.** The price-history chart and card sparklines are hand-written SVG path
generation in the domain layer (pure `(points) => pathString`), with a thin client wrapper
for the hover crosshair.

**Why.** `lightweight-charts` and Recharts are both client-only and would push the market
page into a client component or a dynamic import with a loading shim. The chart needed is
a multi-series line on a fixed 0–100% y-axis — roughly 80 lines of path math that renders
server-side, adds zero KB, and is unit-testable as a pure function.

---

## D14 — Explore is visually separate, scoped, and read-only

**Decision.** `/explore` gets its own token scope (`[data-surface="explore"]`) using
Kalshi's mint `#28cc95` and chrome over Polymarket's dense card grid, and it does not
permit trading.

**Why.** The brief asks for Explore to look "exactly like a mix between Kalshi and
Polymarket," which is a *different* aesthetic from Bet's own. Scoping the tokens means the
two identities can't leak into each other via global CSS. Read-only keeps the surface
honest: those are simulated public markets, not something you can actually take a position
in, and pretending otherwise would be the one genuinely misleading thing in the app.

---

## D15 — Design tokens extracted from the live sites, not eyeballed

**Decision.** Colors and geometry came from evaluating `document.styleSheets` on
kalshi.com and polymarket.com via Playwright (`research/screenshots/*.json`).

**Why.** Guessing "Kalshi green is probably #00d09c" produces a replica that reads as
*almost* right, which is worse than obviously stylized. The real values are
`--brand-primary: #28cc95`, surfaces `#0a0c0f / #13161a / #1b2029`, and — the detail
nobody would guess — Kalshi's semantic "no/down" color is a **hot magenta `#ff409f`**,
not red. Polymarket's grid measured at 346px cards, 16px gaps, 11.2px radius.

**Consequence.** Bet's own palette deliberately diverges (indigo `#7c6cff`) so the two
surfaces are distinguishable at a glance.

---

## D16 — Money as integer cents, never floats

**Decision.** `Credits` is a branded integer type in cents. All arithmetic goes through
`src/domain/money.ts`. Share quantities stay floating-point (they're continuous in LMSR),
but every *money* value crossing a boundary is rounded to integer cents, with rounding
direction chosen so it never favors the trader.

**Why.** `0.1 + 0.2 !== 0.3`. Accumulating float cents over hundreds of trades produces
balances that don't reconcile, and the settlement-conservation invariant would fail for
reasons unrelated to the actual logic.

---

## D17 — Zod at every boundary, one error envelope

**Decision.** Every route handler parses its input with a Zod schema and returns either
`{ data }` or `{ error: { code, message, fields? } }`.

**Why.** Route handlers receive untrusted JSON. Parsing at the boundary means the domain
layer can assume well-formed input and skip defensive checks, and a uniform envelope means
the client has exactly one error path to handle.

---

## D18 — No project-tracking or security-review tooling

**Decision.** No Linear tickets, no `/security-review`, no PR workflow. Work is tracked in
`docs/plan.md` plus the SDD ledger.

**Why.** Explicitly requested: this is a one-shot demo, not a change to live systems.
The subagent-driven development loop (implement → review → fix) is retained because it's
what produces the quality; the process scaffolding around live-code changes is not.
