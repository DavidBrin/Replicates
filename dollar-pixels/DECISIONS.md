# Dollar Pixels — Decision Log

Every non-obvious choice, with the reasoning that produced it. Written as the decisions were
made, not reconstructed afterwards — so the later entries include things that shipped wrong
first and were caught in review.

Backed by [`research/original-site.md`](research/original-site.md),
[`research/prior-art-and-rendering.md`](research/prior-art-and-rendering.md),
[`research/payments-stripe.md`](research/payments-stripe.md) and
[`research/persistence-and-vercel.md`](research/persistence-and-vercel.md).

---

## D1 — The grid is 1200 × 1200 pixels, not 1000 × 1000

**Decision.** 400 × 400 blocks of 3 × 3 pixels = 160,000 blocks = 1200 × 1200 pixels,
$160,000 at face value.

**Why.** Two constraints collide and only one number satisfies both.

The first is arithmetic: **1000 is not divisible by 3.** Laying a 3-pixel block grid over the
original's canvas leaves a one-pixel orphan strip on two edges and splits the blocks that
touch them. The brief forbids splitting blocks, so the original's iconic dimension cannot
survive contact with a nine-pixel unit. Something has to change, and it may as well go up,
because the brief also asks for the most pixels that does not degrade the feel.

The second is rendering. A block is 3 CSS pixels wide. Displayed at any scale below 1.0 it
occupies fewer than 3 device pixels, its edges stop landing on device-pixel boundaries, and
the browser resamples it — the block grid visually dissolves into a smear. So the ceiling is
the largest multiple of 3 that still renders at 1:1 inside an ordinary desktop content
column. 1200 fits a 1280-wide viewport with margin. 1500 would force about 0.85 scale there,
turning every 3-pixel block into a 2.55-device-pixel blur.

**Rejected.** *1002 × 1002* — the nearest multiple of 3 to the original, but it buys
faithfulness to a number that is already broken by the block size, and 334 × 334 is an ugly
grid to reason about. *3000 × 3000*, which would restore a literal $1,000,000 face value at
$1 per nine pixels: it cannot be shown at 1:1 on any normal screen, so it would have to be
permanently downscaled, which is exactly the failure mode above. The million-dollar number is
not worth destroying the artefact for.

**Consequence.** The project is not "the million dollar homepage" by value and does not
pretend to be. It is $160,000 of pixels, and the name says dollars, not millions.

---

## D2 — Blocks are the only coordinate system

**Decision.** Everything — ownership, selection, pricing, storage, the API — is addressed in
block coordinates `(bx, by)`. The conversion to pixels lives in exactly one module,
`src/domain/geometry.ts`.

**Why.** "Blocks of nine pixels must not get split" is a constraint that is easy to state and
easy to violate accidentally, in a dozen places, once pixel maths starts leaking into the
renderer, the API and the database independently. Making a partial block *inexpressible in
the type system* is stronger than checking for it. There is no code path that can describe
half a block, so there is no code path that can sell one.

**Consequence.** The canvas renderer converts to pixels once, at paint time. The hit-test
converts back once, on pointer events. Everything between those two points counts blocks.

---

## D3 — Money is integer cents, everywhere

**Decision.** All prices, balances and ledger amounts are integers in cents. No floating
point ever touches a price.

**Why.** Standard, and non-negotiable once a ledger exists: `0.1 + 0.2 !== 0.3`, and a
marketplace that accumulates rounding error across a creator's earnings is a marketplace that
eventually owes someone the wrong amount. The premium page price is `blocks × 50` cents,
which is exact in integers and inexact the moment anyone writes `blocks * 0.5`.

**Consequence.** Formatting for display happens only at the edge, in `domain/money.ts`.

---

## D4 — A private page is unlisted, not access-controlled

**Decision.** $10 flat, at any size. It does not appear in the directory. It is reachable by
anyone holding the link. There is no password, no invite gate, no member list. The creator
gets an allowance of **69 free blocks**.

**Why.** The brief says to share the link and invite friends, and in the same breath that all
sites stay public. Those two things together describe an *unlisted* page, not a private one —
the privacy is in the discovery, not in the access. Building a real access gate would
contradict the explicit instruction that pages stay public, and would add an entire
authorisation surface for a property nobody asked for.

**Consequence.** The word "private" in the UI is qualified wherever it appears: the create
page says *unlisted — anyone with the link can see it*. Naming a thing "private" and having
it be world-readable is the kind of gap that gets someone in trouble, so the interface never
lets the label stand alone.

---

## D5 — Premium pages cost blocks × $0.50 and pay the creator every cent of block revenue

**Decision.** `premiumPagePrice = totalBlocks × 50` cents. Every block sold on a premium page
credits its creator, less `PLATFORM_FEE_BPS`, which defaults to **0**.

**Why.** This is the brief's formula, and it is internally coherent: the creator buys the
whole grid at half its $1-per-block face value, and earns it back at 50% sold, doubling at
100%. It is a franchise, priced like one.

The fee defaults to zero because the brief says anyone who buys a block pays the creator, and
that should be literally true out of the box rather than true-minus-a-cut. It is
*configurable* because a platform that can never take a fee is a platform with a business
model hard-coded to zero, and that is a worse default than a knob set to zero.

**Consequence.** A full premium page costs $80,000 against a $10 private page. That gap is
the product distinction, not a pricing bug: a private page buys a canvas, a premium page buys
the revenue from one. The size picker exists partly so that premium is reachable at $7,200
rather than only at $80,000.

---

## D6 — Blocks do not link anywhere

**Decision.** A claim carries a caption and artwork. It carries no URL. Hovering shows the
caption; clicking shows a detail card; nothing navigates off-site.

**Why.** Asked for directly, and the research turns it into a principle rather than a
preference. A 2017 study of the original found 547 of its ~2,816 links fully dead — $342,000
of original pixel spend pointing at nothing — with 489 more redirected elsewhere. The live
site today is a patched mirror whose own HTML records that **1,164 broken outbound links were
silently rewritten to point at archive snapshots**. The thing the original sold is the part
that rotted, and someone has had to quietly maintain it for two decades to keep the artefact
usable.

**Consequence.** Dropping links also drops the entire malicious-redirect surface — no
phishing destination, no link that turns hostile after moderation, no `rel` and target
juggling. The moderation problem shrinks to "is this image acceptable", which is the one the
original also had.

---

## D7 — Integer zoom only; responsive downscale is a display accommodation and is labelled as one

**Decision.** Zoom is 1×, 2× or 4× — a block is 3, 6 or 12 CSS pixels, never anything else.
Below the width where the grid fits, the canvas is scaled to fit with
`image-rendering: pixelated`.

**Why.** Integer factors keep every block edge on a whole pixel, so no block is ever rendered
split. Fractional zoom would resample the exact thing the brief says to protect.

The narrow-screen case is the honest part: a 1200-pixel grid cannot render at 1:1 on a
390-pixel phone, and no amount of architecture changes that. So the canvas downscales to fit,
which *does* soften block edges at that width. This is a display artefact only — the model,
the selection maths and the hit-testing all still operate on whole blocks, computed from the
rendered rectangle, so nothing about a purchase is affected.

**Rejected.** Panning a 1:1 canvas inside a viewport on mobile. It preserves crispness and
destroys the property the original actually had and that the 3D successor lost: the whole
grid visible at once. Legibility of the artefact beats sharpness of a 3-pixel block.

---

## D8 — One canvas and arithmetic, not DOM cells and not WebGL

**Decision.** The grid is a single `<canvas>`, with a second transparent canvas above it for
hover, selection and tooltip overlays. Hit-testing is `getBoundingClientRect()`, correct for
the rendered scale and zoom, divide, floor.

**Why.** 160,000 DOM nodes is not slow, it is impossible — browsers begin visibly lagging
around 5,000, and the self-described most performant DOM grid in existence needs a
`SharedArrayBuffer`, a web worker, DOM node pooling and its own frame scheduler just to
manage a scrolling *list*. Meanwhile a regular grid needs no spatial index at all: regularity
means the coordinate is a division, O(1), exactly.

The overlay split matters more than it looks. Hover fires on every pointer move; repainting
160,000 blocks of artwork on every mouse move would be pathological. Separating the layers
means a pointer move repaints only transparent pixels.

**Rejected.** WebGL and any 3D reinterpretation. A real successor tried it and was measured
at 6 fps on a gaming desktop, broke screen readers and native browser zoom, and lost
whole-grid-at-a-glance. That is three regressions for no gain.

**Consequence, and a correction.** This decision originally said to correct the hit-test for
device pixel ratio. That is wrong, and the slice implementing it said so rather than
complying: `getBoundingClientRect()` already reports CSS pixels on every device, so applying
a DPR correction double-counts and puts every hit on the wrong block at 2×. DPR belongs in
the canvas backing-store size and the context transform, and nowhere near the hit-test. The
tests pin the corner, midpoint and last pixel at DPR 1 and 2 and assert identical results.

---

## D9 — Holds expire by being read, not by being swept

**Decision.** A hold is a row with an `expiresAt`. Nothing deletes it on a timer. Every read
that asks "is this block available" treats a hold whose `expiresAt` is in the past as absent.

**Why.** It removes a moving part. A background sweeper is a cron job that can fail silently,
a source of races against the settlement path, and one more thing that behaves differently on
a serverless platform where nothing is long-lived. Filtering at read time is exactly as
correct and cannot drift, because there is no second copy of the truth to drift from.

**Consequence.** Stale hold rows accumulate. That is fine at this scale and is cleaned up
opportunistically when a block is next claimed. `checkout.session.expired` from Stripe still
releases holds eagerly when it arrives — but correctness does not depend on it arriving,
which matters because webhook delivery is at-least-once and out of order, never guaranteed.

---

## D10 — Payment is a port with two adapters, and the mock is not a shortcut

**Decision.** A `PaymentProvider` interface with a `mock` adapter (in-app fake checkout, no
keys, no network) and a `stripe` adapter (hosted Checkout Sessions). `PAYMENT_PROVIDER`
selects. **Both settle through the same `fulfilment.settle(orderId, ref)`.**

**Why.** The brief asks for fake money now and a one-switch move to real money later. The
trap in that request is the obvious implementation: let the dev path write the claim directly
and make Stripe a separate route. Then the switch is untested by construction — the code that
runs in production is the code that has never run in development.

Making the mock a second *trigger* for one fulfilment path means every e2e test of fake-money
buying is also a test of the settlement logic Stripe will drive. The only thing that differs
between the two is who says "paid".

**Consequence.** `POST /api/orders/[id]/mock-settle` returns `404` when the provider is
Stripe. The fake-money endpoint cannot exist in a real deployment.

---

## D11 — Selecting `stripe` without keys throws at startup

**Decision.** `PAYMENT_PROVIDER=stripe` with `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`
missing is a fatal error at container construction. It does not warn and continue.

**Why.** The tempting behaviour is to fall back to the mock provider so the app still boots.
That means a production deploy with a typo'd environment variable comes up healthy, serves
traffic, and hands out pixels for free — and every signal says it is fine. A deploy that
refuses to start is a five-minute outage with an obvious cause. A deploy that silently stops
charging is discovered from the accounts.

**Consequence.** The default is `mock`, so nothing has to be configured to run locally. You
opt in to real money explicitly, and the opt-in is checked.

---

## D12 — Creator earnings are an internal ledger, not Stripe Connect

**Decision.** All payments land in one platform account. What each creator is owed is
recorded as ledger entries and shown on their dashboard. Moving the money is out of scope.

**Why.** Connect is the correct Stripe-native answer and the research maps it in full —
Express accounts, destination charges, `application_fee_amount`, Account Links. It is also an
entire onboarding product: KYC per creator, single-use onboarding links, a `charges_enabled`
check that must not be inferred from the user simply returning to your `return_url`, and the
platform carrying fraud liability for its connected accounts and eating every chargeback
regardless of who was paid.

That is a lot of machinery to demonstrate a pricing model, and none of it is what makes this
project interesting.

**Consequence.** This one is flagged rather than filed quietly, because it does not scale
with real money: taking funds earmarked for a third party and holding them before disbursing
edges toward money transmission — which is precisely the regulatory surface Connect exists to
keep off the platform's books — and it moves creator tax reporting onto us. Fine with fake
money and a documented ledger. **Not a thing to switch to live money on without revisiting.**
`README.md` says so in the deployment section, not just here.

---

## D13 — The store is a port, because the obvious simple choice fails silently on Vercel

**Decision.** A `Store` interface with a transaction method. Two adapters: in-memory, held on
`globalThis`, for local dev and tests; Neon Postgres for deployment. `STORE_DRIVER` selects.
One shared contract test suite runs against both.

**Why.** "Just write a JSON file" is the natural choice for a project this size, and on
Vercel it is a trap with two doors. Writing into the project directory throws `EROFS` —
loud, obvious, fixable. Writing to `/tmp` *appears to work*, and then loses data
intermittently, with no error, because `/tmp` is not shared across invocations and functions
are archived when idle. A marketplace whose ownership records sometimes forget a purchase is
worse than one that will not start.

The `globalThis` singleton is not stylistic either: Fast Refresh re-evaluates modules and
wipes plain module-level state, and in Next 16 a Server Component's module graph and a Route
Handler's are bundled as separate layers, so even a normal singleton is constructed twice.
The sibling project `bet` already hit this and keys its instance off `Symbol.for(...)`; we
inherited the fix rather than rediscovering it.

**Consequence.** The in-memory store is honestly labelled: it is per-instance and resets on
restart. Running the deployed app without `STORE_DRIVER=postgres` is supported, and the
dashboard says so, because a demo that resets is a legitimate thing to want.

---

## D14 — Tiles are PNG data URLs, sized to the purchase exactly

**Decision.** Artwork is drawn client-side into a canvas at exactly the selection's pixel
dimensions, exported as PNG, and stored as a `data:` URL on the claim. Server-side validation
decodes the header and rejects anything whose real dimensions are not `bw*3 × bh*3`, or which
exceeds 96 KB.

**Why.** Tiles here are tiny — a 10 × 10 block claim is 30 × 30 pixels. Blob storage bills
per operation and is built for large, few files; thousands of sub-kilobyte objects pay
request overhead wildly out of proportion to the payload, in both directions. Inline base64
costs a flat 33% and returns ownership and artwork in one query with no extra round trip.

Resizing on the client to the exact purchased size is what makes "the image is the size you
paid for" true by construction rather than by asking nicely — which is how the original had
to do it, as a rule in its terms that a human then enforced.

**Consequence.** Validation decodes the PNG header rather than trusting the declared MIME
type, because the declared type is attacker-controlled. PNG also rules out animation for
free, which the original had to forbid in prose.

---

## D15 — The grid snapshot returns claims, not blocks

**Decision.** `GET /api/pages/[slug]/grid` returns the list of claim rectangles with their
colour, caption and tile. It does not return 160,000 cells.

**Why.** Purchases number in the thousands; cells number in the hundreds of thousands. Every
real implementation surveyed collapses to rectangle-level storage for a *sold* grid — one row
per pixel only appears in free-paint canvases where every cell is independently mutable. The
client expands rectangles into a lookup map once per snapshot, sized to owned blocks rather
than to the grid.

**Consequence.** The payload scales with how much has been sold, not with how big the grid
is, which is the right axis. An empty 400 × 400 page transfers almost nothing.

---

## D16 — There is a claims list, and you can buy from it

**Decision.** Every page renders a keyboard-navigable list of its claims alongside the
canvas, and the buy flow can be driven from it with coordinate inputs instead of a pointer
drag.

**Why.** A canvas is a black box to a screen reader. The original had the same problem and
solved it accidentally, with a separate page listing everyone who had bought pixels — which
existed because the grid image carried no labels, but functioned as the accessible view. We
are doing it deliberately.

Making it *purchasable* rather than merely readable is the part that matters. An accessible
view of a shop you cannot buy from is a brochure.

---

## D17 — Settlement is idempotent, and re-settling with a different reference is an error

**Decision.** `settle(orderId, ref)` on an order already `paid` with the *same* ref succeeds
and does nothing. With a *different* ref it throws. Terminal states never transition.

**Why.** Stripe states plainly that endpoints may receive the same event more than once and
that events are not delivered in the order they were generated. A handler that is not
idempotent will double-write claims and double-credit a creator's ledger the first time a
retry lands.

The different-ref case is separated deliberately: the same order settled by two different
payments is not a duplicate delivery, it is a bug or an attack, and it should be loud rather
than absorbed by the same code path that absorbs retries.

---

## D18 — The free allowance is an order for zero

**Decision.** A private page creator's 69 free blocks are spent by creating an order with
`amountCents: 0` that settles immediately, through the same fulfilment path as a paid one.

**Why.** The alternative is a second write path that creates claims without an order, which
means two places that know how to write a claim, consume holds and post ledger entries —
and only one of them exercised by the payment tests. One path, one set of invariants.

**Consequence.** Free claims appear in the order history at $0, which is also the audit trail
for the allowance.

---

## D19 — The layering rule is a test, not a convention

**Decision.** `src/domain/__tests__/layering.test.ts` walks the source tree, extracts every
import specifier, resolves aliases, and fails if `src/domain/**` reaches into `next`,
`react`, `src/adapters/**` or `src/app/**`, or if `src/components/**` reaches into
`src/adapters/**`.

**Why.** Inherited from `bet`, where it already earns its keep. A layering rule stated in a
README is a rule that decays on the first deadline. A layering rule that fails CI is a rule.

---

## D20 — The palette is a homage with its own values

**Decision.** The design tokens are ours. `research/original-site.md` records what the
original's stylesheet actually measured, so the lineage is traceable, but no asset, no
stylesheet and no wording is copied from it.

**Why.** The point of a replica in this repo is to rebuild the *idea* from research, not to
mirror someone's files. The 2005 furniture — dark grey chrome, a gold nav bar, a green/red
sold-and-available stat box, a light grey checker for unsold space — is what makes it read as
the right thing. The exact bytes are neither needed nor ours.

**Consequence.** Type is a system stack led by Trebuchet MS, the original's face, which ships
on both macOS and Windows — so the period feel costs no web font and no licence question.

---

## D21 — The hold is 35 minutes, not 30

**Decision.** `HOLD_MINUTES = 35`.

**Why.** This one was found by the slice implementing the Stripe adapter, against a spec that
said 30. Stripe requires a Checkout Session's `expires_at` to be at least 30 minutes in the
future **at the moment the session is created** — and we compute that expiry earlier, when the
blocks are reserved, before the network call. At exactly 30, the seconds spent reserving push
the timestamp under the bound and Stripe rejects the entire checkout.

The five minutes of headroom also settle a subtler question: our hold outlives Stripe's
session rather than the other way round, so there is never a window where the blocks are free
while a session is still payable.

**Consequence.** The adapter clamps `expires_at` into Stripe's 30-minute-to-24-hour range
anyway, because a value that is correct in the domain and rejected at the boundary should
fail loudly at the boundary rather than be silently unrepresentable.

---

## D22 — Stripe and the Postgres driver are ordinary dependencies

**Decision.** `stripe` and `@neondatabase/serverless` sit in `dependencies`, not
`optionalDependencies`, even though the default configuration loads neither at runtime.

**Why.** They started as optional, which is the honest description of what they are: with
`PAYMENT_PROVIDER=mock` and `STORE_DRIVER=memory`, neither is ever imported, because both
adapters load their driver through a dynamic `import()` inside the methods that need it.

But a dynamic import with a literal specifier still has to *type-resolve* at build time. Under
`npm install --omit=optional` the build fails on module resolution even though every runtime
path is fine. Trading a few megabytes of unused `node_modules` for a build that cannot fail
that way is not a close call — the brief asks for something deployable, and a deploy that
breaks on an install flag nobody remembers setting is the worst kind of failure to debug.

**Consequence.** The lazy `import()` still earns its keep: it keeps the packages out of the
serverless bundle's execution path, so the mock configuration never pays their startup cost.

---

## D23 — The buy panel goes below the grid, not beside it

**Decision.** The grid gets the full content column, with the buy panel stacked underneath.
Side by side returns only at the `2xl` breakpoint.

**Why.** This one shipped wrong and was caught by driving the app rather than by any test.
The panel was a 384px sidebar, which left the grid about 808px of a 1240px column — so the
1200px canvas was permanently scaled to 0.67 and a block occupied two device pixels instead
of three. Every unit test still passed, because the maths was right; the arrangement was
wrong. The headline claim of D1 — that this grid is the biggest one that still renders 1:1 —
was quietly false on the only screen size it was chosen for.

**Consequence.** There is now an e2e assertion that the canvas measures exactly 1200 CSS
pixels on a desktop viewport. A number that load-bearing should not be re-derivable only by
reading the CSS.

---

## D24 — Zoom multiplies the rendered size; the fit-scale is measured at 1×

**Decision.** The responsive fit-scale is `containerWidth / gridWidthAt1x`, not
`containerWidth / gridWidthAtCurrentZoom`.

**Why.** The second form was what shipped, and it made the zoom control do **nothing at all**.
Every zoom level immediately re-fitted to the same container, so the canvas backing store grew
while the element on screen stayed exactly the same size. Clicking `+` produced a marginally
crisper image and no zoom. Measuring the fit against the 1× width instead means zoom
multiplies what you see, which is the only thing a zoom control is for.

**Consequence.** A zoomed grid is deliberately wider than its container and the frame scrolls,
rather than shrinking back to fit — otherwise the fix would just re-introduce the bug with
extra steps. The e2e now asserts that zooming in exactly doubles the rendered width, which is
also a check that the factor stayed an integer (D7).

---

## D25 — The e2e suite runs on one worker

**Decision.** `fullyParallel: false`, `workers: 1`, and the Playwright port is configurable.

**Why.** Both halves were found the hard way. Every test drives one dev server backed by one
in-memory store, so the suite shares a single mutable world — the wall, the slug namespace,
the seeded claims. Run in parallel, tests reserve each other's blocks and race each other's
sign-ins, and a *different* test fails on each run. That is the worst failure mode available:
it reads as a flaky product rather than a flaky harness, and it invites someone to add a retry
instead of finding out why.

The port matters for the same reason. This package is one of several sibling Next apps in the
repository, and a stray `next dev` from one of the others holding :3000 is not hypothetical —
it happened during this build. With a fixed port and `reuseExistingServer`, Playwright attaches
to *that* server and runs the suite against a different application entirely, which produces a
result that is meaningless whichever colour it comes out.

**Consequence.** The whole suite still runs in well under a minute, so nothing was traded away.

---

## D26 — `PAYMENT_PROVIDER` is read through one function

**Decision.** `domain/payment-config.ts` owns the normalisation. The provider factory and the
root layout both call it.

**Why.** They used to read the same variable two different ways. The factory normalised —
`.trim().toLowerCase()`, with its own test asserting that `"STRIPE"` selects Stripe. The
layout compared the raw string to `"stripe"` to decide whether to show the play-money banner.

So `PAYMENT_PROVIDER=STRIPE` with real keys produced a deployment that **charged real cards
while displaying "no card is charged, every purchase here is fake"**. That is the most
misleading state this application can occupy, and it was reachable by a plausible typo rather
than by anything exotic. Found in security review, not by any test — both halves were
individually correct and tested.

**Consequence.** An unrecognised value answers "not live", so the warning shows. That is the
safe direction: the factory refuses to boot on it anyway, and of the two possible mistakes,
staying silent about fake money is the one that costs someone something.

---

## D27 — A webhook event is marked processed *after* the work, not before

**Decision.** `markEventProcessed` runs once settlement has succeeded. Duplicate protection
rests on `settle` being idempotent (D17), not on the dedupe record.

**Why.** Marking first is the obvious shape and it is a trap. If settlement then failed for
any transient reason — a database blip, a function timeout — the route asked Stripe to retry,
Stripe redelivered the *same event id*, the dedupe swallowed it, and `settle` was never called
again. An order the buyer had already paid for would sit `pending` forever, its blocks
eventually released to someone else, with nothing in the system left to notice.

The guard was protecting against acting twice so eagerly that it could prevent ever acting
once.

**Consequence.** Two deliveries can now race past the check, which is fine and was always the
real design: `settle` on an order already paid by the same reference is a no-op. The record is
an audit trail and a cheap short-circuit, not the thing correctness rests on.

---

## D28 — A completed Checkout Session is not necessarily a paid one

**Decision.** `checkout.session.completed` only settles when `payment_status` is not
`"unpaid"`.

**Why.** Delayed payment methods — bank debits, transfers — fire `checkout.session.completed`
immediately with `payment_status: "unpaid"`, and resolve later as `async_payment_succeeded` or
`async_payment_failed`. Settling on the first event hands over the blocks before the money
exists, and the failure path cannot undo it: releasing a `paid` order is refused by design
(D17), so the eventual `async_payment_failed` is acknowledged and does nothing. The buyer
keeps the pixels for free.

Nothing restricts `payment_method_types`, so this depends only on what the operator has
enabled in their Stripe dashboard — not on anything visible in this repository.

**Consequence.** A missing or unreadable `payment_status` is treated as paid. A shape change
in the event should not silently stop every settlement; that failure would be total and
invisible, where the case being guarded against is rare and self-corrects on the async event.

---

## D29 — One buyer may hold six unpaid reservations, not unlimited

**Decision.** `MAX_OPEN_HOLDS_PER_BUYER = 6`, counting only holds that have not expired.

**Why.** Each checkout takes a fresh 35-minute hold over up to 4,000 blocks, and nothing
obliges anyone to pay. With no cap, one signed-in user can cover a 400 × 400 page in about
forty requests and keep re-issuing before the old holds lapse — the entire grid, permanently
unbuyable by anyone else, at no cost whatsoever under the mock provider. A denial of
availability on the only thing the product does.

**Consequence.** The count uses the same read-time expiry rule as everything else (D9), so the
cap frees itself as holds lapse and a settled order stops counting immediately. Six is
generous for a person buying a few patches at once and useless as an attack.

---

## D30 — A free claim is created and settled in one transaction

**Decision.** The `claim-free` route wraps `claimFree` and `settle` in a single
`store.transact`.

**Why.** They were two sequential calls, and the gap between them leaked. `claimFree`
increments `allowanceUsed` and takes a hold; settlement writes the claim. An interruption in
between — a timeout, a deploy — left the allowance spent with no claim to show for it, and
nothing could give it back: the hold expires on its own, but no code path decrements
`allowanceUsed`, and nothing ever calls `release` on an allowance order. Free blocks would
simply evaporate from a creator's 69.

**Consequence.** Nested `transact` joins the outer transaction rather than opening a new one —
a property the store contract already guaranteed and tested — so this needed no new store
method, only the two halves put inside the same boundary.

---

## D31 — SQLite is the local store; Postgres is for deployment only

**Decision.** Three drivers. `sqlite` (the default) writes a file under `.data/` via Node's
built-in `node:sqlite`. `postgres` is for Vercel. `memory` is what the test suite runs against.

**Why.** The in-memory default made the local demo forget every purchase on restart, which is
a poor way to show someone a marketplace. SQLite fixes that with **no dependency at all** —
`node:sqlite` ships with Node 26, so there is no package to install, no native build to fail,
and no migration step: the schema is applied when the file is opened.

It is deliberately not the deployment answer. On Vercel the filesystem is read-only and `/tmp`
is not shared between invocations, so a SQLite file there works in testing and then loses data
silently (`research/persistence-and-vercel.md` §1). That is the exact failure D13 exists to
avoid, and adding a third driver does not change it.

**Consequence.** The unit suite pins `STORE_DRIVER=memory` in `vitest.config.mts`, because a
suite that opened the demo database would carry rows between runs and fail differently on a
second `npm test`. SQLite is exercised on purpose against a temp file, by its own contract run.

---

## D32 — The order row is written before the hold that points at it

**Decision.** `buyBlocks` and `claimFree` insert the order first, then reserve the blocks,
inside one transaction.

**Why.** They did it the other way round, and it was broken everywhere it mattered.
`holds.order_id` is a foreign key onto `orders(id)` in both real schemas and neither declares
it deferrable, so reserving before the order exists raises a constraint violation at statement
time. **Every block purchase would have failed on Postgres**, and `seedFlagship` was worse — it
reserved against order ids it never inserted at all, so the container build would have rejected
at boot, before serving one request, and `getContainer` memoises the *rejected promise*, so
that instance would have returned 500 forever.

None of it was visible. The in-memory store enforces no foreign keys, so 400-odd tests passed.
The shared contract suite could not catch it either: it seeds an order and *then* reserves,
which is the opposite order from every production caller. Adding SQLite is what surfaced it —
it failed on the first request.

**Consequence.** There is now a regression suite that runs the buy path, the free-claim path
and the refused-reservation rollback against SQLite specifically, because exercising the
*service* against a constraint-enforcing store is the only thing that would have caught this.
The README's claim that the Postgres adapter was "correct by inspection" was wrong, and this is
what wrong looks like.

---

## D33 — Checkout Sessions accept cards only

**Decision.** `payment_method_types: ["card"]`.

**Why.** D28 stopped settling an unpaid `completed` session — correct, and on its own it turned
a rare over-delivery into a guaranteed non-delivery. Delayed methods resolve hours or days
later, and our hold lasts 35 minutes, so by the time `async_payment_succeeded` arrived the
blocks would be long released and settlement would fail permanently: money taken, nothing
delivered, and Stripe retrying for three days against a hold that cannot come back.

Refusing those methods up front is the honest fix. Supporting them properly needs a hold that
outlives the payment, which is a different product than a live grid where blocks must not sit
frozen for days.
