# Payments: what Stripe actually wants you to do in 2026

Research lane 3. Fetched live against `docs.stripe.com` and the npm registry in August 2026.
Everything below is what the current docs say, not recollection.

Confidence tags as in `original-site.md`.

---

## 1. Which Stripe API

**Hosted Checkout Sessions, `mode: "payment"`.** Stripe's own comparison page recommends the
Checkout Sessions API for most integrations and says to choose Payment Intents only if you
want to own every part of the checkout. **HIGH**

| Option | Verdict here |
|---|---|
| **Checkout Sessions** | Correct. Line items are built server-side per request from `price_data`, which fits a variable-priced cart of blocks exactly. Stripe hosts the page, so card data never touches us. Gives `checkout.session.completed` and `.expired` webhooks for free. |
| Payment Intents | Wrong unless we want a fully custom on-page card form, which would mean reimplementing amount validation, 3DS handling and error messaging ourselves. |
| Payment Links | Built for a reusable, mostly static no-code page. Not for a cart computed per transaction. |

Package versions confirmed against the registry: `stripe@22.5.0` (server SDK),
`@stripe/stripe-js@9.13.0` (only needed for Elements — a pure hosted-Checkout redirect does
not need it at all). **HIGH**

## 2. The amount must be computed server-side

Stripe states it directly: keep price and availability on the server to prevent customer
manipulation from the client. **HIGH**

The pattern:

1. Client sends only a **selection** — block coordinates. Never a price.
2. Server re-reads current price and availability for exactly those blocks.
3. Server rejects if any block is sold or held by someone else (HTTP 409).
4. Server builds the line items from its own computation.

If a client-supplied amount is trusted anywhere, a user rewrites the request and buys the
whole grid for a cent.

## 3. Webhooks

Stripe recommends handling `checkout.session.completed`,
`checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` when
collecting payments with Checkout. **HIGH** For an inventory-holding marketplace also handle
`checkout.session.expired` (release the hold) and `charge.refunded`.

Signature verification in an App Router route handler uses the **raw body** —
`await req.text()`, never `req.json()`. The App Router hands us the raw `Request` with no
body parser in front of it, so no framework workaround is needed (unlike the Pages Router,
which needed `bodyParser: false`). **HIGH**

```ts
const sig = (await headers()).get("stripe-signature");
const event = stripe.webhooks.constructEvent(
  await req.text(),
  sig!,
  process.env.STRIPE_WEBHOOK_SECRET!,
);
```

Delivery guarantees, quoted from the docs: **HIGH**

- Stripe does **not** guarantee events arrive in the order they were generated.
- An endpoint **may receive the same event more than once**.
- Automatic retries run up to 3 days in live mode with exponential backoff.

Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, which prints
the `whsec_...` signing secret for that session.

## 4. Idempotency, in both directions

- **On create:** pass an `idempotencyKey`. Keys are cached about 24 hours server-side and
  Stripe replays the original response for the same key and parameters. Random UUIDs
  recommended; no personal data in the key. **HIGH**
- **On receive:** the handler must be independently idempotent, because delivery is
  at-least-once and out of order. Store processed `event.id`s and no-op on a repeat. **HIGH**

## 5. Holding inventory while the customer pays

Stripe has no hold primitive. You build it around the session lifecycle: **HIGH**

1. On checkout, validate the blocks are free, mark them held against the new session, then
   create the session.
2. Set an explicit short `expires_at`. Default is 24 hours; the allowed range is **30 minutes
   to 24 hours**. For a live grid you want the minimum.
3. On `checkout.session.completed` (or `async_payment_succeeded`), convert held → sold.
4. On `checkout.session.expired`, release held → available. This is precisely what the event
   exists for.
5. `stripe.checkout.sessions.expire(id)` force-expires early if the user abandons in-app.

Carry the selection through as session `metadata` so the webhook knows what to settle without
a second lookup.

## 6. Paying a third party — Stripe Connect, and why we are not using it yet

For "the page creator earns when someone buys a block on their page", the Stripe-native
answer is Connect with **destination charges**:

```ts
payment_intent_data: {
  application_fee_amount: platformFeeCents,
  transfer_data: { destination: creatorConnectAccountId },
}
```

The full amount transfers to the creator's account and the platform fee is pulled back.
`on_behalf_of` sets the settlement merchant and is **required** when platform and connected
account are in different regions. **HIGH**

Account types: **Express** (Stripe hosts onboarding and KYC, platform controls payouts and
branding) is the normal fit for casual creators; **Standard** gives the creator their own
full Stripe dashboard and relationship with Stripe, at the cost of much heavier onboarding.
Onboarding runs through single-use, minutes-long **Account Links**, and returning to
`return_url` does **not** mean onboarding finished — you must re-check `charges_enabled` via
the API or the `account.updated` webhook. **HIGH**

Two things worth flagging that the docs say plainly: **HIGH**

- The platform is responsible for losses incurred by Express connected accounts and must vet
  who it onboards for fraud.
- **Chargebacks on destination charges are always debited from the platform account**, never
  the creator's, regardless of `on_behalf_of`.

A live note found during this research: Stripe's Express-accounts page now opens with a
deprecation banner steering new integrations to the newer Accounts v2 API and telling
automated agents to ignore the page unless the integration already uses legacy account types.
The charge model (destination charges, application fees) is unchanged; it is the
account-creation surface that moved. **HIGH** — read directly off the page.

### The alternative we chose

Take all payments into one platform account and record what each creator is owed in an
**internal ledger**, paying out manually and out-of-band. Zero Connect integration, zero
onboarding UX.

The honest cost, which is *not* a Stripe recommendation but a real regulatory point: you are
then holding funds earmarked for a third party before disbursing them, which — depending on
volume, jurisdiction and how long funds sit — edges toward money transmission, which is
exactly the surface Connect exists to keep off your books. You also own creator tax reporting
that Connect would otherwise handle. Fine for a demo with fake money; **not** something to
switch to live money on without revisiting. See `DECISIONS.md` D12.

## 7. Test mode and running with no keys at all

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Requires 3DS | `4000 0025 0000 3155` |
| Generic decline | `4000 0000 0000 0002` |
| Insufficient funds | `4000 0000 0000 9995` |

Any future expiry, any CVC, any postcode. Test and live objects are completely separate; keys
are prefixed `sk_test_` / `pk_test_` versus `sk_live_` / `pk_live_`, and webhook signing
secrets are per-endpoint *and* per-mode. **HIGH**

Running with **no** Stripe keys is not a Stripe feature — it is an application design
decision. The pattern is to read the key lazily rather than constructing the client at module
load with a non-null assertion, so an app without secrets does not crash at import time.
`dollar-pixels` goes further and makes the payment provider a port with two adapters; see
`DECISIONS.md` D10.

## 8. Security

- Never client-side: `STRIPE_SECRET_KEY` (`sk_...`), restricted keys (`rk_...`), and
  `STRIPE_WEBHOOK_SECRET` (`whsec_...`). Only the publishable key is designed to be public. **HIGH**
- Hosted Checkout keeps card data off our servers entirely, which keeps us at the lightest
  PCI self-assessment tier. **HIGH**
- **The `NEXT_PUBLIC_` trap:** Next.js inlines any `NEXT_PUBLIC_`-prefixed variable into the
  client bundle at build time. Only the publishable key may ever carry that prefix. **HIGH**
- Mark any module that constructs the Stripe client with `import "server-only"` so a stray
  client import fails the build rather than shipping the secret.

## Citations

- `https://docs.stripe.com/payments/online-payments` — Checkout vs Payment Intents comparison
- `https://docs.stripe.com/checkout/quickstart` — session creation, App Router sample, env layout
- `https://docs.stripe.com/payments/checkout/how-checkout-works` — session lifecycle, `expires_at` 30 min–24 h, PCI
- `https://docs.stripe.com/webhooks` — event set, CLI forwarding, duplicate/ordering guarantees, retries
- `https://docs.stripe.com/webhooks/signature` — raw-body handling per framework
- `https://docs.stripe.com/api/idempotent_requests` — key semantics, 24 h cache
- `https://docs.stripe.com/connect/destination-charges` — `transfer_data`, `application_fee_amount`, `on_behalf_of`, dispute liability
- `https://docs.stripe.com/connect/express-accounts` — Express onboarding, Account Links, Accounts v2 deprecation banner
- `https://docs.stripe.com/testing`, `https://docs.stripe.com/keys`
- `https://github.com/stripe/stripe-node` — official App Router webhook example
- `https://registry.npmjs.org/stripe/latest` → 22.5.0; `https://registry.npmjs.org/@stripe/stripe-js/latest` → 9.13.0
