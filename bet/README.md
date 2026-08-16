# Bet

> **wanna bet?**
> *make the groupchat put their money where their mouth is*

A **private, friend-first prediction market**. Kalshi and Polymarket run public markets on
world events; Bet runs *your* markets on *your* people — whether Marcus actually runs the
10k, whether anyone does the dishes before Thursday, whether Priya's flight gets delayed
again. Every bet is private to a group, and every bet carries its own groupchat containing
exactly the people with money on it.

A public **Explore** surface — deliberately styled as a mix of Kalshi and Polymarket —
sits alongside as a separate destination.

**Play money only. No real currency, no payments, no deposits.** See [Decision D1](DECISIONS.md).

---

## Quick start

```bash
pnpm install
pnpm run dev          # http://localhost:3000
```

No database, no environment variables, no external services. The app boots with a fully
seeded world: 12 users, 3 groups, 10 private markets, ~24 public Explore markets, and two
weeks of trade and chat history.

Open <http://localhost:3000>, hit **Start betting**, and pick **@dev** on the sign-in screen.

| Command | What it does |
|---|---|
| `pnpm run dev` | Dev server on :3000 |
| `pnpm run build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm test` | Unit + property + route tests (Vitest) |
| `pnpm run test:e2e` | End-to-end tests (Playwright) |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` | ESLint |

### Deploying to Vercel

```bash
npx vercel        # or push to GitHub and import the repo
```

**Set one environment variable: `AUTH_SECRET`** — any random string of **32 characters or
more**.

```bash
openssl rand -base64 32
```

This is *required* in production. Sessions are signed with it, and the app deliberately
**throws rather than falling back to the development key** when `NODE_ENV=production` —
shipping with a known signing key would let anyone forge a session. Without it, sign-in
returns a 500. Locally you need nothing: the dev fallback applies and warns once.

No database, no other services. **Read the persistence caveat in
[Known gaps](#known-gaps) before treating a deployment as durable.**

---

## What to look at first

1. **`/`** — the hero.
2. **`/app`** — a group dashboard. The **tabs across the top are your groups**; switch
   between Sunday League, The Roommates and Fantasy 2026.
3. **Open a market** — this is the centerpiece. The price chart, a live-quoted order
   ticket, and the Room: a groupchat where **trades appear inline as they happen**, so the
   tape *is* the conversation. Place a trade and watch the price, your balance, your
   position and the chat all move.
4. **`/app/new`** — the five-step create-bet wizard. Step 4 lists your friends as chips
   before you type anything.
5. **`/app/friends`** — Instagram-shaped friend requests, with one deliberate difference:
   you can never see another user's friend list.
6. **`/explore`** — the public surface, a Kalshi × Polymarket hybrid. Read-only by design.

---

## Index

### Documents
| File | Contents |
|---|---|
| [`SPEC.md`](SPEC.md) | Product and UI specification — screens, components, API surface, visual design |
| [`DECISIONS.md`](DECISIONS.md) | 18 engineering decisions with rationale and rejected alternatives |
| [`docs/plan.md`](docs/plan.md) | The 14-task implementation plan and its global constraints |
| [`research/`](research) | Source research: Kalshi, Polymarket, pricing mechanisms, social patterns, stack, extracted design tokens |

### Architecture

Hexagonal, with dependency inversion enforced by a test ([D7](DECISIONS.md)):

```
src/domain/      Pure TypeScript. Zero framework imports — enforced by
                 src/domain/__tests__/layering.test.ts, which resolves relative
                 imports so `../../adapters/x` can't sneak past it. The same test
                 enforces the other half of the rule: no file under src/components
                 may import src/adapters (UI talks to ports, never to an
                 implementation).
  money.ts             Credits as branded integer cents; all money arithmetic
  formatters.ts        Every number the UI displays goes through here
  pricing/             The three market engines behind one interface
  services/            Trade and resolution use-cases
  authz.ts             Pure can(actor, action, resource, ctx)
  market-state.ts      Table-driven status machine
  chart.ts             Pure SVG path math

src/ports/       Interfaces only — DataStore, Clock, IdGen, AuthProvider, RealtimeChannel
src/adapters/    memory/ (the default store + seed), auth/ (JWT sessions), realtime/ (polling)
src/app/         Next.js App Router — routes are thin: parse → authorize → domain → serialize
src/components/  ui/ primitives · market/ · room/ · order/ · wizard/ · friends/ · explore/ · app-shell/
src/lib/         container.ts (the composition root), http.ts (envelope), api-client.ts
```

### Pricing engines

Three strategies implement one `PricingEngine` interface and are selected per market
([D2](DECISIONS.md), [D3](DECISIONS.md)):

| Kind | UI name | Mechanism |
|---|---|---|
| `lmsr` *(default)* | Market-priced | Hanson's LMSR: `C(q) = b·ln Σ exp(qᵢ/b)`, price = softmax, bounded loss `b·ln n` |
| `fixedOdds` | Set your own odds | Creator fixes opening probabilities; stakes escrow peer-to-peer |
| `parimutuel` | Pool | Stakes pool per outcome; winners split pro-rata, largest-remainder to the cent |

**Why LMSR rather than an order book:** Kalshi and Polymarket run CLOBs because they have
thousands of counterparties. A CLOB with six friends is an empty book — you place an order
and nothing happens. LMSR always quotes and always fills.

All three run against the **same property-test suite**: prices sum to 1, cost is convex,
round trips never profit the trader, LMSR's house loss stays within `b·ln n`, settlement
conserves money, and quotes are deterministic.

### API

```
POST/DELETE /api/session          GET  /api/me            GET /api/users/search
GET  /api/friends                 POST /api/friends/requests      POST /api/friends/requests/[id]
GET/POST /api/groups              GET  /api/groups/[slug]         POST /api/groups/[slug]/members
POST /api/invites                 GET/POST /api/invites/[id]
POST /api/markets                 GET  /api/markets/[id]
POST /api/markets/[id]/quote      POST /api/markets/[id]/trades
POST /api/markets/[id]/resolve    GET  /api/markets/[id]/history
GET/POST /api/markets/[id]/messages
GET  /api/explore                 GET/POST /api/notifications
```

That is the complete surface — every `route.ts` under `src/app/api`, with exactly the
methods each one exports. Notably there is **no** `GET /api/markets`: every screen that
lists markets is a Server Component reading through the container directly, so no
list-markets endpoint was ever needed.

Every response is `{ data }` or `{ error: { code, message, fields? } }`. Every input is
Zod-parsed. Every handler calls `can()` before touching data. Unauthorized reads of private
resources return **404, not 403** — a 403 confirms the resource exists ([D6](DECISIONS.md)).

---

## Testing

```bash
pnpm test          # ~664 unit, property and route-handler tests
pnpm run test:e2e  # Playwright end-to-end
```

- **Property tests** (`fast-check`) guard the pricing invariants. They're written to fail
  under mutation: flipping the sign of the LMSR cost function makes them go red, and that
  was verified rather than assumed — the first version of the round-trip property *didn't*
  catch it (an `Math.abs` was masking the flip), so the property was strengthened.
- **Contract tests** run the in-memory adapter against the shared `DataStore` suite, so a
  second adapter inherits the same coverage.
- **Route tests** call the exported handlers directly with a `Request`.
- Every screen was also driven in a real browser during development; several bugs were
  found only that way (see [Development notes](#development-notes)).

---

## Known gaps

Honest list. Nothing here is hidden behind a happy path.

**Persistence**
- **The default store is in-memory.** It's seeded at boot and requires no configuration,
  which is what makes `pnpm install && pnpm run dev` and one-click Vercel deploys work.
  **On Vercel this means state is per-serverless-instance and resets on cold start** —
  writes can appear to vanish between requests hitting different instances. Correct for a
  demo, fatal for production. A `DataStore` port exists precisely so a Postgres adapter is
  one file; **that adapter is not implemented.** The recommended real path (Drizzle +
  PGlite locally, Neon in production) is written up in `research/stack.md`.

**Auth**
- **There are no passwords.** Sign-in is "pick a demo user", and anyone can sign in as
  anyone. Sessions themselves are real — HS256-signed, HttpOnly, SameSite=Lax, algorithm
  pinned — but the identity check is deliberately absent for demo ergonomics
  ([D9](DECISIONS.md)). An `AuthProvider` port is where a real provider drops in.
- **`AUTH_SECRET` (32+ chars) is required in production** — see
  [Deploying to Vercel](#deploying-to-vercel). The app throws rather than signing with the
  known development key. Sessions also do not survive a redeploy if the secret changes.

**Product**
- **Explore is simulated and read-only.** Those are generated markets, not real ones, and
  the Yes/No buttons say so rather than pretending to trade ([D14](DECISIONS.md)).
- **No background job flips a market to `closed` when its close time passes.** Status
  self-heals whenever the market is next touched. This can only make a status *chip* look
  stale — trading is gated on `closesAt` directly, so a trade can never succeed after
  close.
- **Realtime is 4-second polling**, behind a `RealtimeChannel` port. Vercel's serverless
  functions can't hold WebSockets; SSE or a hosted provider would swap in at that port
  ([D10](DECISIONS.md)).
- **Resolution disputes are majority-vote among position holders** with a 12h window. No
  bonding, no escalation beyond the group ([D12](DECISIONS.md)).
- Group *membership* grants read access to every market in that group. A market that must
  be hidden from part of a group is created outside any group and gated by participant and
  invite rows instead.

**Not built**
- Market editing after creation; leaving a group; deleting an account; image uploads;
  push notifications; mobile apps; i18n; a public market-creation flow.
- `Tabs` uses native tab order rather than the full ARIA roving-tabindex pattern.
- **The parimutuel rake is burned, not collected.** `ParimutuelEngine.settle` pays out
  `totalPool × (1 − rakeBps/10000)` and credits the difference to *nobody* — no house
  account, no `Payout` row — so those credits leave the economy. This is inert today:
  every seeded and wizard-created parimutuel market has `rakeBps = 0`, and nothing in the
  UI or API can set it otherwise, so `Σ payouts === totalPool` in practice. Introducing a
  non-zero rake without first deciding who receives it would be a real money leak. Written
  up in full at the top of `ParimutuelEngine.settle`.

---

## Development notes

Built by a team of subagents working from `docs/plan.md`: one implementer per task, an
independent reviewer after each, a fix loop, and a scoped re-review per round. Progress was
tracked in a ledger so the work survived context loss.

The reviews earned their keep. A sample of what they caught that tests alone did not:

- The layering guard could be bypassed by a **relative** import (`../../adapters/x`) — the
  rule protecting the architecture was itself unenforced.
- The in-memory store committed transactions by **replacing whole tables**, so any write
  landing outside an in-flight transaction was silently discarded.
- Friend-request `decline`/`cancel` wrote outside a transaction while `accept` wrote inside
  one, so a concurrent accept+cancel could leave a friendship with no accepted request.
- Session JWTs weren't pinned to an algorithm.
- The group leaderboard showed **every member losing**, because open positions were valued
  at zero.
- Average cost rendered **100× too small** — cents divided by cents.
- Explore's cards were all the same height because the grid lacked `items-start`, so CSS
  Grid stretch pinned every card to its tallest sibling.

The last three were found by *looking at the rendered page*, not by running tests — which
is the argument for driving the real thing rather than trusting a green suite.

A final review before merge found three more, all of which had survived every green run:

- **A pending invitee could read a private market's holders and their exact stakes.**
  `authz.ts` had the right policy for reading a position — and no route called it, because
  `GET /api/markets/[id]` hand-rolled the check instead. The policy branch was dead code
  while the hole was live.
- **The `RealtimeChannel` port didn't exist where this README said it did.** The interface
  lived *inside* the polling adapter and the Room imported the adapter directly, so the
  architecture the docs described was true on paper and false in the import graph. The
  layering test only scanned `src/domain`, so nothing caught it. It now scans
  `src/components` too — and that extension was verified by adding a violating import and
  watching the test go red before reverting it.
- **Average cost could display an impossible price** (over 100¢ for a contract that settles
  at 100¢), because it divided the running `costBasis` residual — re-rounded on every
  partial sell — by an ever-smaller share count. It is now derived from the trade ledger.

The same pass deleted a batch of exports that had no consumers at all (`ProgressBar`,
`Sheet`, `isOk`/`unwrapOr`, `getMarket`/`getHistory`, the id-prefix category helpers,
`niceTicks`), each verified unused before removal.
