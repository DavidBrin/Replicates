# Dollar Pixels — Specification

A replica of the Million Dollar Homepage, rebuilt for 2026, where **$1 buys a block of nine
pixels** instead of one pixel buying one pixel.

This document is the contract the implementation was built against. Decisions and their
reasoning live in [`DECISIONS.md`](DECISIONS.md); the evidence behind them is in
[`research/`](research).

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Pixel** | One cell of the grid at 1:1 zoom. Never sold individually. |
| **Block** | A 3 × 3 square of pixels — **nine pixels, $1**. The atomic unit of everything: ownership, pricing, selection, storage. |
| **Claim** | One purchase. An axis-aligned rectangle of blocks, owned by one person, carrying one caption and optionally one tile image. |
| **Page** | A grid. The site has one flagship page plus any number of user-created ones. |
| **Wall** | The flagship page, `/p/the-wall`. |
| **Tile** | The artwork drawn into a claim's rectangle. |
| **Allowance** | Free blocks a page's creator may claim without paying. |

**The grid is addressed in blocks, never in pixels.** A block coordinate `(bx, by)` maps to
pixel `(bx * 3, by * 3)`. No code outside `src/domain/geometry.ts` performs that conversion.

## 2. Geometry

| Property | Value |
|---|---|
| Pixels per block | 9 (3 × 3) |
| Price per block | $1.00 (100 cents) |
| Flagship grid | **400 × 400 blocks = 1200 × 1200 pixels = 160,000 blocks** |
| Flagship face value | $160,000 |

### Why 1200 and not 1000

The original was 1000 × 1000. **1000 is not divisible by 3** — a 3-pixel block grid laid over
it leaves a one-pixel orphan strip on two edges and splits the blocks on those edges, which
the brief forbids. The canvas dimension must be a multiple of 3, so the original number
cannot survive.

Given it has to change, it should go up: the brief asks for the most pixels that does not
degrade the feel. The ceiling is set by rendering, not by storage. A block is 3 CSS pixels
wide. If the grid is displayed at any scale below 1.0, a block renders at fewer than 3 device
pixels, its edges stop landing on device-pixel boundaries, and the browser resamples — the
block grid visibly dissolves. So the largest sensible grid is the largest multiple of 3 that
still renders at 1:1 inside an ordinary desktop content column.

**1200 is that number.** It fits 1:1 in a 1280-wide viewport with margin, it is exactly
400 blocks, and 400 × 400 = 160,000 is a clean face value. 1500 would force roughly 0.85
scale on a 1280 screen, turning 3-pixel blocks into 2.55-device-pixel smears. See
`DECISIONS.md` D1.

### Page sizes

Pages other than the flagship pick a size at creation. All are square and all are multiples
of 3 pixels by construction.

| Size | Blocks | Pixels | Face value |
|---|---|---|---|
| `small` | 120 × 120 = 14,400 | 360 × 360 | $14,400 |
| `medium` | 240 × 240 = 57,600 | 720 × 720 | $57,600 |
| `full` | 400 × 400 = 160,000 | 1200 × 1200 | $160,000 |

### Zoom

Integer zoom only: **1×, 2×, 4×**. A block is 3, 6 or 12 CSS pixels. Integer factors keep
block edges on whole pixels at every level, so a block is never rendered split.

Below the width at which the grid fits, the canvas is downscaled to fit with
`image-rendering: pixelated`. This is a display accommodation for narrow screens; the *model*
is unaffected and pointer maths is computed from the rendered rectangle, so hit-testing stays
exact. See `DECISIONS.md` D7.

## 3. Pricing

All money is integer **cents**. No floating point ever touches a price.

```
blockPriceCents          = 100                       ($1 per block)
selectionPrice(n)        = n * 100
privatePagePrice         = 1000                      ($10 flat, any size)
premiumPagePrice(size)   = totalBlocks(size) * 50    (blocks × $0.50 — half price)
```

| Size | Private page | Premium page |
|---|---|---|
| `small` | $10 | $7,200 |
| `medium` | $10 | $28,800 |
| `full` | $10 | $80,000 |

A premium page is the whole grid bought at a 50% discount to its $1-per-block face value, and
in exchange **every block sold on it pays the creator**. It earns back its cost at 50% sold
and doubles at 100%. That is the trade the price expresses.

### Where a block payment goes

| Page kind | Block revenue |
|---|---|
| `flagship` | Platform |
| `private` | Platform |
| `premium` | **Creator**, minus `PLATFORM_FEE_BPS` (default `0`) |

The fee is basis points, configurable, and defaults to zero so that "anyone who buys a block
pays the creator" is literally true out of the box. The split is computed in
`domain/pricing.ts` and is the only place it exists.

## 4. Page kinds

| | `flagship` | `private` | `premium` |
|---|---|---|---|
| Price | — (seeded) | $10 | blocks × $0.50 |
| Listed in the directory | yes | **no** | yes |
| Reachable by link | yes | yes | yes |
| Publicly viewable | yes | **yes** | yes |
| Creator free-block allowance | — | **69** | 0 |
| Block revenue | platform | platform | creator |

**A private page is unlisted, not access-controlled.** It does not appear in the directory,
it is found only by its link, and the brief is explicit that all sites stay public — so
anyone holding the link sees the same page, and there is no password, no invite gate and no
member list. "Invite your friends" means sharing the URL.

The asymmetry between $10 and $80,000 is deliberate and is the entire distinction between the
two products: a private page buys you a canvas, a premium page buys you the revenue from one.
See `DECISIONS.md` D4.

### Slugs

Lowercase `a–z`, `0–9` and `-`, 3–32 characters, no leading/trailing or doubled hyphens.
A reserved list (`api`, `new`, `pages`, `dashboard`, `checkout`, `the-wall`, …) is rejected.
Slugs are unique across all pages regardless of kind.

## 5. Buying blocks

1. **Select.** Drag on the grid to sweep a rectangle of blocks, or click one block. The
   selection snaps to block boundaries — a partial block cannot be expressed.
2. **Price.** The panel shows `n blocks · n × 9 pixels · $n.00`, computed client-side for
   display and recomputed server-side for the charge.
3. **Decorate.** Give the claim a caption (1–60 characters) and optionally upload an image.
   The image is drawn client-side into a canvas at exactly the selection's pixel dimensions
   and exported as PNG, so a tile is always exactly the size it was paid for. Without an
   image, the buyer picks a solid colour.
4. **Check out.** `POST /api/pages/[slug]/checkout` with the selection, caption and tile.
   The server re-validates availability, **holds** the blocks for 30 minutes, creates an
   order, and returns a redirect URL from the active payment provider.
5. **Settle.** The provider's confirmation converts held → sold, writes the claim, and posts
   ledger entries. Both providers reach this through the *same* fulfilment service.

Rejections: `409` if any block is sold or held by someone else, `422` on a malformed
selection, caption or tile, `402` if the provider declines.

### Rules on a selection

- Rectangular and axis-aligned. Non-rectangular multi-select is out of scope.
- Fully inside the grid.
- Every block free at validation time.
- At most 4,000 blocks in one claim, so a single purchase cannot swallow the flagship grid
  in one request and so a tile stays a sane size.

### Rules on a tile

- PNG, encoded as a `data:` URL.
- Decoded dimensions must equal the selection exactly: `w*3 × h*3` pixels.
- At most 96 KB decoded. Larger is rejected rather than resampled.
- Not animated — the format choice enforces this.
- Validated server-side by decoding the header, never by trusting the declared type.

### What a claim is not

**A claim carries no outbound link.** Hovering shows the caption; clicking an owned block
shows its detail card. Nothing navigates off-site. This is a deliberate departure from the
original — see `DECISIONS.md` D6 and the link-rot findings in `research/original-site.md`.

## 6. Domain model

```
Page      id, slug, title, kind, size, ownerId?, createdAt,
          allowanceTotal, allowanceUsed
Claim     id, pageId, ownerId, rect{bx,by,bw,bh}, caption, colour,
          tile?(data URL), orderId, createdAt
Block     (pageId, bx, by) -> claimId | hold
Hold      (pageId, bx, by) -> orderId, expiresAt
Order     id, kind('blocks'|'page'), pageId, buyerId, amountCents,
          status('pending'|'paid'|'expired'|'cancelled'),
          provider, providerRef?, payload, createdAt, settledAt?
Ledger    id, orderId, pageId, recipientId, amountCents,
          kind('block_sale'|'page_sale'|'platform_fee'), createdAt
User      id, handle, displayName, createdAt
```

`Order.payload` carries the pending claim (rect, caption, colour, tile) or the pending page
(slug, title, kind, size), so settlement needs nothing but the order.

### Order state machine

```
pending ──settle(providerRef)──► paid        (claim written, ledger posted, holds consumed)
   │
   ├─────expire()──────────────► expired     (holds released)
   └─────cancel()──────────────► cancelled   (holds released)
```

Settling an already-`paid` order with the same `providerRef` is a **no-op that succeeds** —
webhooks are at-least-once. Settling with a *different* ref is an error. Terminal states
never transition.

## 7. Architecture

Hexagonal, matching its sibling projects. Pure domain in the middle, interfaces at the
boundary, concrete adapters outside, one composition root.

```
src/
  domain/     pure TypeScript, no react/next/adapter imports (enforced by a test)
              geometry · money · pricing · page · claim · order · ledger · art · slug
    services/ checkout · fulfilment · pages · errors
  ports/      Store · Clock · IdGen · AuthProvider · PaymentProvider
  adapters/
    store/    memory (globalThis singleton) · postgres (Neon) · shared contract test
    payment/  mock · stripe
    auth/     demo session (signed cookie)
  lib/        container (composition root) · http (envelope) · api-client · cn
  app/        thin route handlers and pages
  components/ ui · app-shell · grid · buy · directory · dashboard
```

**Rules, enforced by `src/domain/__tests__/layering.test.ts`:**

- `src/domain/**` imports nothing from `next`, `react`, `src/adapters/**` or `src/app/**`.
- `src/components/**` imports nothing from `src/adapters/**`.

Route handlers are thin: parse → authorise → call a service → serialise. No business rule
lives in `src/app`.

### The two ports that carry the brief

**`Store`** exists because Vercel's filesystem is read-only and `/tmp` is not shared across
invocations, so the obvious "just write a JSON file" store works locally and then loses data
silently in production (`research/persistence-and-vercel.md` §1). Two adapters: an in-memory
one held on `globalThis` for local dev and tests, and a Neon Postgres one for deployment,
selected by `STORE_DRIVER`. Both are held to one shared contract test suite.

**`PaymentProvider`** exists because the brief asks for fake money now and a one-switch move
to Stripe later:

```ts
interface PaymentProvider {
  readonly id: string;          // "mock" | "stripe"
  readonly label: string;
  readonly isLive: boolean;     // drives the play-money banner
  createCheckout(input: CheckoutInput): Promise<CheckoutHandle>;  // -> { redirectUrl, ref }
  expire(ref: string): Promise<void>;                             // best-effort
}
```

Note what is *not* on it: there is no `confirm`. A provider that could settle its
own orders would let the fake path diverge from the real one, which is the exact failure
this port exists to prevent.

- **`mock`** redirects to an in-app page with *Pay*, *Cancel* and *Simulate decline*
  buttons. No network, no keys, no account.
- **`stripe`** creates a hosted Checkout Session with server-computed line items and a
  30-minute expiry, and its webhook route verifies the signature against the raw body.

Both converge on **one** `fulfilment.settle(orderId, ref)`. The mock path is not a stub that
shortcuts the real path; it is a second trigger for the same path, which is what makes the
switch trustworthy.

### Selecting a provider

`PAYMENT_PROVIDER` is `mock` (default) or `stripe`. Choosing `stripe` without
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` **throws at startup**. It never silently
falls back to fake money — a production deploy that quietly stops charging is worse than one
that refuses to boot.

## 8. HTTP surface

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/session` | Sign in with a display name |
| `DELETE` | `/api/session` | Sign out |
| `GET` | `/api/me` | Current user |
| `GET` | `/api/pages` | Directory — flagship and premium pages |
| `POST` | `/api/pages` | Create a page; returns a checkout redirect |
| `GET` | `/api/pages/[slug]` | Page metadata and sold/available counts |
| `GET` | `/api/pages/[slug]/grid` | Grid snapshot: claim rectangles, colours, captions, tiles |
| `POST` | `/api/pages/[slug]/checkout` | Buy a selection; returns a checkout redirect |
| `POST` | `/api/pages/[slug]/claim-free` | Spend the creator allowance (no payment) |
| `GET` | `/api/orders/[id]` | Order status |
| `POST` | `/api/orders/[id]/mock-settle` | Mock provider only; `404` under Stripe |
| `POST` | `/api/stripe/webhook` | Stripe events; raw-body signature check |
| `GET` | `/api/dashboard` | Pages owned, earnings balance, ledger entries |

The grid snapshot returns **claims, not blocks** — thousands of rectangles rather than
160,000 cells, which is what makes the payload small (`research/prior-art-and-rendering.md`
§4).

## 9. Rendering the grid

One `<canvas>`. No DOM node per cell — at 160,000 cells that is not slow, it is impossible
(`research/prior-art-and-rendering.md` §6).

- **Paint:** fill the background checker, then draw each claim's rectangle — solid colour, or
  the tile image drawn at exact pixel size with smoothing disabled.
- **Hit-test:** O(1) arithmetic. Take `getBoundingClientRect()`, correct for the rendered
  scale and zoom, divide by block size, floor. No spatial index, because a regular grid does
  not need one.

  **Device pixel ratio must not appear in the hit-test.** `getBoundingClientRect()` reports
  CSS pixels on every device; DPR affects only the size of the backing store. Correcting for
  it here would double-count and put every hit on the wrong block on a retina screen. DPR
  belongs in canvas sizing and in the context transform, and nowhere else.
- **Claim lookup:** one `Map` from packed block index to claim, built once per snapshot,
  sized to the number of *owned* blocks rather than the grid.
- **Overlays:** the hover highlight, the drag selection rectangle and the tooltip are drawn
  on a second, transparent canvas on top, so a pointer move never repaints the artwork layer.
- **Accessibility:** the canvas carries a text alternative and the page offers a
  keyboard-navigable **claims list** with the same information, because a canvas alone is
  unreachable by screen reader. Buying is possible from the list without pointer drag.

## 10. Screens

| Route | What it is |
|---|---|
| `/` | Landing: the pitch, live sold/available counters, a link to the wall and the directory |
| `/p/[slug]` | A page: header, stats, the grid, the buy panel, the claims list |
| `/pages` | Directory of listed pages |
| `/new` | Create a private or premium page — size picker, live price, slug check |
| `/dashboard` | Your pages, your claims, your earnings ledger |
| `/checkout/mock/[orderId]` | The fake-money checkout (mock provider only) |
| `/checkout/return` | Post-payment landing for both providers; polls order status |

## 11. Visual design

A homage to the 2005 original, not a pixel copy of it. Every value below is our own; the
research file records what the original measured so the lineage is traceable.

```
--color-ground        #8f8f8f   page background
--color-chrome        #5a5a5a   header and footer bars
--color-panel         #e4e4e4   content panels
--color-panel-2       #f4f4f4   raised panel
--color-rule          #3d3d3d   hairlines and the grid frame
--color-gold          #d9ab22   nav bar
--color-gold-dim      #b8901a   nav bar hover
--color-ink           #1b1b1b   primary text
--color-ink-2         #4d4d4d   secondary text
--color-ink-3         #7a7a7a   muted text
--color-link          #000099   links
--color-sold          #1f9d2f   the "sold" figure
--color-open          #c0182b   the "available" figure
--color-empty-a       #e1e1e1   grid checker light
--color-empty-b       #d6d6d6   grid checker dark
--color-select        #0a7cff   selection rectangle
```

Type is a system sans stack led by Trebuchet MS, the original's face, which is present on
both macOS and Windows and needs no web font. Numbers use tabular figures throughout via a
`.tnum` utility. The header carries a wordmark, a tagline, and a sold/available stat box in
green and red — the original's furniture, redrawn.

No raw hex literals in components; everything comes from the token block in `globals.css`.

## 12. Testing

- **Unit** (`vitest`, co-located `*.test.ts`): geometry and rect maths, pricing including the
  creator split, the order state machine and its idempotency, slug rules, tile validation,
  hold expiry at read time, ledger balances, the layering guard.
- **Store contract** (`src/adapters/store/__tests__/contract.ts`): one suite run against
  every `Store` implementation, so a second adapter inherits the coverage.
- **Property** (`fast-check`): block ⇄ pixel conversion round-trips; a selection's price is
  always `9 pixels ↔ 100 cents` per block; concurrent claims on overlapping rectangles never
  both succeed.
- **E2E** (`playwright`, `e2e/*.spec.ts`): buy blocks with fake money end to end, hold and
  release, create a private page and spend its allowance, create a premium page and see the
  creator credited, the directory, and the accessibility list path.
- **Screenshots**: `CAPTURE=1 npx playwright test screenshots`, writing to `docs/screenshots/`.

## 13. Out of scope

Real payouts to creators (the ledger records what is owed; moving money needs Stripe Connect
and the regulatory review in `research/payments-stripe.md` §6). Passwords and email. Image
moderation beyond format validation. Resale of blocks. Realtime multi-user updates — the grid
refetches on settle and on focus, and the research shows a 1-second cache is what a
million-cell canvas actually needs, not a websocket per viewer.
