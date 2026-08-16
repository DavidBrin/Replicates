# Dollar Pixels

> **$1 buys nine pixels**

A rebuild of [the Million Dollar Homepage](https://milliondollarhomepage.com), the 2005 page
that sold a million pixels at a dollar each. This one sells them in **blocks of nine** — a
3 × 3 square for a dollar — on a 1200 × 1200 grid of 160,000 blocks, with two things the
original did not have: **you can make your own page**, and **the blocks do not link anywhere**.

Play money by default. Real money is one environment variable away, and the fake path and the
real path settle through the same code, so the switch is not a leap of faith.

---

## Index

| Path | What's in it |
|---|---|
| [`SPEC.md`](SPEC.md) | The contract this was built against — geometry, pricing, page kinds, the HTTP surface |
| [`DECISIONS.md`](DECISIONS.md) | Every non-obvious choice and why, including the ones that were wrong first |
| [`research/original-site.md`](research/original-site.md) | What the 2005 original actually was, measured from the live page and archives |
| [`research/prior-art-and-rendering.md`](research/prior-art-and-rendering.md) | Every clone we could find, r/place's architecture, and how to render 160,000 clickable cells |
| [`research/payments-stripe.md`](research/payments-stripe.md) | Current Stripe practice, fetched from the docs — Checkout, webhooks, idempotency, Connect |
| [`research/persistence-and-vercel.md`](research/persistence-and-vercel.md) | What survives on Vercel, and the storage choice that silently does not |
| [`src/domain`](src/domain) | Pure logic: geometry, money, pricing, the order state machine, tile validation |
| [`src/domain/services`](src/domain/services) | Checkout, settlement, pages, seeding — everything that changes state |
| [`src/ports`](src/ports) | The five interfaces: `Store`, `PaymentProvider`, `Clock`, `IdGen`, `AuthProvider` |
| [`src/adapters`](src/adapters) | Their implementations: SQLite + Postgres + memory, mock + Stripe, demo sessions |
| [`src/components/grid`](src/components/grid) | The canvas renderer and its hit-testing |
| [`src/components/buy`](src/components/buy) | Selection panel, tile uploader, the accessible claims list |
| [`src/app`](src/app) | Routes — thin handlers and the screens |
| [`e2e`](e2e) | Playwright specs, including the screenshot capture |
| [`docs/screenshots`](docs/screenshots) | The images in this README |

## Quick start

```bash
pnpm install
pnpm run dev
```

Open <http://localhost:3000>. Nothing to configure — no keys, no database server, no account.
You sign in by typing a name, and you buy blocks with money that does not exist.

**What you buy stays bought.** The demo writes to a SQLite file at `.data/dollar-pixels.db`
through Node's built-in `node:sqlite`, so there is nothing to install and nothing to migrate —
the schema is applied when the file is opened. Delete the file to reset the wall.

| Command | What it does |
|---|---|
| `pnpm run dev` | Development server on :3000 |
| `pnpm run build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm test` | Unit and property tests (vitest) |
| `pnpm run test:watch` | The same, watching |
| `pnpm run test:e2e` | Playwright end-to-end, desktop and mobile |
| `pnpm run test:e2e:ui` | The same, with the Playwright inspector |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run lint` | ESLint |

Screenshots are captured, not taken by hand:

```bash
CAPTURE=1 npx playwright test screenshots --project=desktop-chrome
```

## What you can do

**Buy blocks.** Drag a rectangle on the grid. It snaps to whole blocks, because a partial
block cannot be expressed anywhere in the codebase. Give it a caption and either a colour or
an image — the image is resized in the browser to exactly the pixel size you are paying for,
so a tile is never the wrong size. One dollar per block, computed on the server.

**Make a page.** Two kinds, and the difference between them is who gets paid:

| | Unlisted page | Premium page |
|---|---|---|
| Price | **$10** flat, any size | **blocks × $0.50** — the grid at half price |
| In the directory | no — link only | yes |
| Free blocks for you | **69** | none |
| When someone buys a block | the platform is paid | **you are paid** |

A premium page pays for itself at 50% sold and doubles at 100%. That is what the half-price
formula buys. Sizes are 120 × 120, 240 × 240 or 400 × 400 blocks, so a premium page costs
$7,200, $28,800 or $80,000.

**"Unlisted" means unlisted, not private.** It is absent from the directory and reachable by
anyone holding the link. There is no password and no invite gate — the brief was explicit
that pages stay public, and the interface never lets the word "private" stand on its own.

## Two things that are deliberately not like the original

**The grid is 1200 × 1200, not 1000 × 1000.** 1000 is not divisible by 3, so a nine-pixel
block laid over the original's canvas splits on two edges. Given the number had to change, it
went up to the largest multiple of 3 that still renders at 1:1 inside a normal desktop column
— below 1.0 scale a 3-pixel block stops landing on device-pixel boundaries and the grid
dissolves. [D1](DECISIONS.md#d1--the-grid-is-1200--1200-pixels-not-1000--1000).

**Blocks do not link anywhere.** A 2017 study found 547 of the original's ~2,816 links fully
dead — $342,000 of pixel spend pointing at nothing. The page served today is a patched
mirror whose own HTML records that 1,164 broken links were rewritten to point at archive
snapshots. The thing it sold is the part that rotted. Here a claim carries a caption and
artwork, and nothing navigates off-site.
[D6](DECISIONS.md#d6--blocks-do-not-link-anywhere).

## Architecture

Ports and adapters, with a pure core and one composition root.

```
   src/app  ──────────────►  src/domain/services  ──────────►  src/domain
   (routes, screens)         (checkout, settlement)            (pure logic)
        │                            │
        │                            ▼
        │                        src/ports          ◄── interfaces only
        │                            ▲
        └── src/components           │
            (canvas, panels)    src/adapters
                            sqlite │ postgres │ memory
                            mock   │ stripe
```

Two rules, enforced by a test rather than by convention
([D19](DECISIONS.md#d19--the-layering-rule-is-a-test-not-a-convention)): `src/domain` may not
import React, Next, an adapter or a route; `src/components` may not import an adapter.

**The two ports that carry the product:**

- **`Store`** — because Vercel's filesystem is read-only and `/tmp` is not shared between
  invocations, so the obvious JSON-file store works locally and then loses purchases in
  production with no error at all. SQLite for the local demo, Postgres for deployment,
  in-memory for tests — one shared contract suite held against all three. [D13](DECISIONS.md#d13--the-store-is-a-port-because-the-obvious-simple-choice-fails-silently-on-vercel)
- **`PaymentProvider`** — because the mock has to be a *rehearsal* for Stripe, not a shortcut
  around it. Both providers converge on one `settle(orderId, ref)`; the only difference is who
  says "paid". Every fake-money test is therefore also a test of the code Stripe will drive.
  [D10](DECISIONS.md#d10--payment-is-a-port-with-two-adapters-and-the-mock-is-not-a-shortcut)

## Turning on real money

1. `pnpm install` already includes the Stripe SDK.
2. Set the environment:
   ```
   PAYMENT_PROVIDER=stripe
   STRIPE_SECRET_KEY=sk_test_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   ```
3. Point a webhook at `POST /api/stripe/webhook` for `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and
   `checkout.session.expired`. Locally:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
4. Test with `4242 4242 4242 4242`, any future expiry, any CVC.

**`PAYMENT_PROVIDER=stripe` without both secrets is a fatal startup error.** It does not warn
and fall back, because a deployment that boots healthy and quietly hands out pixels for free
is discovered from the accounts, while one that refuses to start is discovered in a minute.
[D11](DECISIONS.md#d11--selecting-stripe-without-keys-throws-at-startup).

The play-money banner is driven by the same variable, and defaults to *showing*. A misspelt
variable warns you about fake money on a real deployment, which is a confusing mistake — the
other way round is the one that makes someone think they spent something.

## Storage: three drivers, and why the demo one cannot be the deployed one

| `STORE_DRIVER` | Where it puts things | Use it for |
|---|---|---|
| `sqlite` *(default)* | a file at `SQLITE_PATH`, default `.data/dollar-pixels.db` | **local demo** — survives restarts, no install, no migration |
| `postgres` | `DATABASE_URL` | **deployment** — the only one that works on Vercel |
| `memory` | the process | the test suite |

**SQLite is not a deployment option, and the reason is specific.** Vercel Functions run on a
read-only filesystem with a writable `/tmp` that is *not shared between invocations*. A SQLite
file there fails in two ways: writing into the project directory throws `EROFS` outright, and
writing to `/tmp` appears to work and then loses data intermittently with no error at all,
because the next request can land on a different instance. A marketplace that sometimes forgets
a purchase is worse than one that refuses to start.

An unrecognised `STORE_DRIVER` now throws rather than quietly falling back — a misspelt
`Postgres` used to boot on the in-memory adapter and forget every sale on each cold start.

## Deploying to Vercel

Vercel detects this with no configuration. Point the project root at `dollar-pixels/`.

**1. Create the database.** In your Vercel project, *Storage → Create → Neon* (any Postgres
works; Neon is the first-party integration and has a free tier). Attaching it injects
`DATABASE_URL` into the project automatically — you do not have to copy it by hand.

**2. Apply the schema, once.** There is no migration runner; the DDL is idempotent and
committed:

```bash
psql "$DATABASE_URL" -f src/adapters/store/schema.sql
```

Pull the URL locally with `vercel env pull .env.local` if you need it in a shell.

**3. Set the environment variables** (*Settings → Environment Variables*):

| Variable | Value | Why |
|---|---|---|
| `STORE_DRIVER` | `postgres` | **Required.** Without it the deployment runs on the in-memory store and forgets everything on each cold start. |
| `DATABASE_URL` | injected by the integration | Required by `STORE_DRIVER=postgres`; the app refuses to start without it. |
| `AUTH_SECRET` | `openssl rand -base64 32` | **Set this.** Unset, a random secret is generated per process, so sessions break across instances and on every cold start. |
| `PAYMENT_PROVIDER` | `mock`, or `stripe` for real money | Defaults to `mock`. |
| `PLATFORM_FEE_BPS` | `0` | Optional. Basis points of block sales the platform keeps on premium pages. |

**4. Only if you want real money** — see *Turning on real money* above:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` / `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook endpoint you create |

Then add a Stripe webhook pointing at `https://<your-domain>/api/stripe/webhook` for
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed` and `checkout.session.expired`.

`PAYMENT_PROVIDER=stripe` without both secrets is a fatal startup error, by design.

**A caveat worth reading before you take money.** The Postgres adapter now has a regression
suite run against SQLite for the constraint behaviour it shares, but it has still never been
executed against a real Postgres server. The contract suite is written to run against it
unchanged — add a `postgres.test.ts` gated on `DATABASE_URL` and point it at a scratch database
before trusting it with anything.

## Known gaps

**Money**

1. **Nothing pays creators out.** The ledger records what a premium page's creator is owed and
   the dashboard shows it; moving the money needs Stripe Connect. That is a deliberate scope
   cut with a real edge to it — holding funds earmarked for a third party before disbursing
   them is the regulatory surface Connect exists to keep off a platform's books, so this is
   not a thing to point at live money without revisiting.
   [D12](DECISIONS.md#d12--creator-earnings-are-an-internal-ledger-not-stripe-connect)
2. **Refunds are not handled.** `charge.refunded` is acknowledged and ignored. If a settled
   payment is refunded, the claim stays on the grid.
3. **A payment that settles onto blocks someone else took is refused, loudly, and the refund
   is manual.** The window is small — it needs a hold to lapse mid-payment — but it is real,
   and the error says so rather than overwriting the other buyer.

**Storage**

4. **`PostgresStore` has never been executed against a real database.** SQLite now covers the
   constraint behaviour the two share — and immediately found a bug that would have taken the
   Postgres deployment down at boot (D32) — but the adapter's own SQL has still never run. The
   contract test is adapter-agnostic so a `postgres.test.ts` gated on `DATABASE_URL` drops in
   unchanged. Do that before deploying it.
5. **Transactional serializability is not part of the `Store` contract.** The memory adapter
   serialises transactions through a mutex; Postgres at READ COMMITTED would need explicit row
   locks to match. No current service depends on the difference, but the port does not say so.

**Product**

6. **No moderation beyond format.** Tiles are checked for being a real PNG of exactly the
   right size, and nothing looks at what is in them. The original had a human doing this.
7. **No resale, no editing a claim after it is bought, no realtime.** The grid refetches on
   settle and on focus rather than holding a socket open per viewer.
8. **Sign-in is a name.** Anyone can be anyone by typing their name, and the interface says so.
   Nothing valuable is behind it — every page is public by design.

## Development notes

414 unit and property tests, 30 e2e across desktop and mobile. All green, and that is
precisely the point of this section: **the most important bugs in the project were invisible
to every one of them.**

Two were found by driving the app in a browser and measuring it:

1. **The grid was never actually 1:1.** The buy panel was a 384px sidebar, leaving the
   1200px canvas about 808px of column — so it rendered at 0.67 scale and a block occupied
   two device pixels instead of three. Every unit test passed, because the arithmetic was
   right; the *arrangement* was wrong, and the arrangement is the entire justification for
   the grid being 1200 wide. Found by measuring the rendered canvas in a real browser.
   [D23](DECISIONS.md#d23--the-buy-panel-goes-below-the-grid-not-beside-it)
2. **The zoom control did nothing.** The responsive fit-scale was measured against the
   *zoomed* width, so every zoom level was immediately re-fitted to the same container: the
   backing store grew, the thing on screen did not move. Clicking `+` produced a slightly
   crisper image and no zoom.
   [D24](DECISIONS.md#d24--zoom-multiplies-the-rendered-size-the-fit-scale-is-measured-at-1)

Both are now pinned by e2e assertions on the measured canvas width, because a number that
load-bearing should not be verifiable only by reading the CSS.

A third was a harness bug wearing a product bug's clothes: the e2e suite ran in parallel
against one dev server holding one in-memory store, so tests reserved each other's blocks and
a different one failed on every run.
[D25](DECISIONS.md#d25--the-e2e-suite-runs-on-one-worker)

Independent review found five more, all of them in the money path and none of them visible to
a passing suite, because in each case both halves were individually correct:

3. **A live deployment could advertise itself as play money.** The provider factory normalised
   `PAYMENT_PROVIDER` and the layout compared the raw string, so `PAYMENT_PROVIDER=STRIPE`
   charged real cards while displaying "no card is charged". Both readings were tested; only
   the disagreement between them was the bug.
   [D26](DECISIONS.md#d26--payment_provider-is-read-through-one-function)
4. **A transient failure stranded a paid order forever.** The webhook recorded an event as
   processed *before* settling it, so if settlement failed, Stripe's retry was swallowed by
   the dedupe and the order stayed `pending` with the buyer already charged.
   [D27](DECISIONS.md#d27--a-webhook-event-is-marked-processed-after-the-work-not-before)
5. **A completed session was assumed to be a paid one.** Delayed payment methods complete
   while still unpaid; the eventual failure could not take the blocks back, because releasing
   a paid order is refused by design.
   [D28](DECISIONS.md#d28--a-completed-checkout-session-is-not-necessarily-a-paid-one)
6. **One user could hold the whole grid, free, forever.** No cap on concurrent unpaid
   reservations.
   [D29](DECISIONS.md#d29--one-buyer-may-hold-six-unpaid-reservations-not-unlimited)
7. **Free blocks could evaporate.** The allowance was spent in one transaction and the claim
   written in another, and nothing anywhere decrements `allowanceUsed`.
   [D30](DECISIONS.md#d30--a-free-claim-is-created-and-settled-in-one-transaction)

**The independent codex review did not run.** It fails before reaching the diff — the CLI
sends a tool with an empty description and its Linear integration's OAuth grant has expired.
Five invocations failed identically, so this is an environment fault rather than anything
about the code, but it means the outside opinion on this diff came from Claude reviewers on
separate correctness and security lenses, not from a second model. Worth re-running once the
CLI is working.

## What this is

A study, not a product, and not affiliated with the original in any way. Everything here —
the code, the copy, the palette, the invented tenants seeded onto the wall — is written from
scratch; the research file records what the 2005 page measured so the lineage is traceable,
and that is where the relationship ends.

Built the way its siblings in this repository were: five parallel research lanes, then a spec
derived from them, then five parallel build slices against a frozen contract, then review.
