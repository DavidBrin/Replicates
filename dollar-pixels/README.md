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
| [`src/adapters`](src/adapters) | Their implementations: memory + Postgres, mock + Stripe, demo sessions |
| [`src/components/grid`](src/components/grid) | The canvas renderer and its hit-testing |
| [`src/components/buy`](src/components/buy) | Selection panel, tile uploader, the accessible claims list |
| [`src/app`](src/app) | Routes — thin handlers and the screens |
| [`e2e`](e2e) | Playwright specs, including the screenshot capture |
| [`docs/screenshots`](docs/screenshots) | The images in this README |

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Nothing to configure — no keys, no database, no account.
You sign in by typing a name, and you buy blocks with money that does not exist.

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Unit and property tests (vitest) |
| `npm run test:watch` | The same, watching |
| `npm run test:e2e` | Playwright end-to-end, desktop and mobile |
| `npm run test:e2e:ui` | The same, with the Playwright inspector |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

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
                                 memory │ postgres
                                 mock   │ stripe
```

Two rules, enforced by a test rather than by convention
([D19](DECISIONS.md#d19--the-layering-rule-is-a-test-not-a-convention)): `src/domain` may not
import React, Next, an adapter or a route; `src/components` may not import an adapter.

**The two ports that carry the product:**

- **`Store`** — because Vercel's filesystem is read-only and `/tmp` is not shared between
  invocations, so the obvious JSON-file store works locally and then loses purchases in
  production with no error at all. In-memory for development, Postgres for deployment, one
  shared contract test suite for both. [D13](DECISIONS.md#d13--the-store-is-a-port-because-the-obvious-simple-choice-fails-silently-on-vercel)
- **`PaymentProvider`** — because the mock has to be a *rehearsal* for Stripe, not a shortcut
  around it. Both providers converge on one `settle(orderId, ref)`; the only difference is who
  says "paid". Every fake-money test is therefore also a test of the code Stripe will drive.
  [D10](DECISIONS.md#d10--payment-is-a-port-with-two-adapters-and-the-mock-is-not-a-shortcut)

## Turning on real money

1. `npm i` already includes the Stripe SDK.
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

## Deploying

Vercel detects this with no configuration. Point the project root at `dollar-pixels/` and
deploy.

It will run with an entirely empty environment, and **it will forget everything**. The default
store is in-memory, which on Vercel means per-function-instance and gone on the next cold
start. That is a legitimate way to show the thing off; it is not a way to sell anything.

For a deployment that remembers:

```
STORE_DRIVER=postgres
DATABASE_URL=postgres://…      # Vercel's Neon integration injects this
AUTH_SECRET=…                  # openssl rand -base64 32
```

Then apply the schema once: `psql "$DATABASE_URL" -f src/adapters/store/schema.sql`.

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

4. **`PostgresStore` has never been executed against a real database.** It is correct by
   inspection and by a contract suite written to run against it unchanged, but there was no
   Postgres in the build environment. The contract test is deliberately adapter-agnostic so a
   `postgres.test.ts` gated on `DATABASE_URL` can be dropped in. Do that before deploying it.
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

## What this is

A study, not a product, and not affiliated with the original in any way. Everything here —
the code, the copy, the palette, the seeded tenants on the wall — is written from scratch; the
research file records what the 2005 page measured so the lineage is traceable, and that is
where the relationship ends.

Built the way its siblings in this repository were: five parallel research lanes, then a spec
derived from them, then five parallel build slices against a frozen contract, then review.
