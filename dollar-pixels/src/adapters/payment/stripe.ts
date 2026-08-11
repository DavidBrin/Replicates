/**
 * The real-money provider: hosted Checkout Sessions in `mode: "payment"`
 * (research/payments-stripe.md §1).
 *
 * Two things shape this file more than anything else:
 *
 * - `stripe` is an optionalDependency, so the SDK is imported inside a call
 *   and memoised. An install without the package, or a deployment running the
 *   mock provider, never loads it (research §7).
 * - Confirmation is not here. Both providers settle through the one
 *   `fulfilment.settle(orderId, ref)` (DECISIONS D10); what this module owns of
 *   the webhook is the two pure helpers at the bottom, which the route calls
 *   after it has verified the signature against the raw body.
 */

import "server-only";

import type { CheckoutHandle, CheckoutInput, CheckoutLine, Clock, PaymentProvider } from "@/ports";

/* ------------------------------------------------------------ the seam --- */

/**
 * The slice of the Stripe SDK this adapter touches, restated structurally.
 *
 * Narrow deliberately. It is the seam a fake client is injected through in
 * tests, so no test ever needs a key or the network, and it keeps this
 * module's own types independent of a package that may not be installed.
 */

export interface StripeLineItemParams {
  price_data: {
    currency: string;
    product_data: { name: string };
    unit_amount: number;
  };
  quantity: number;
}

export interface StripeSessionCreateParams {
  mode: "payment";
  line_items: StripeLineItemParams[];
  expires_at: number;
  /**
   * Cards only, and deliberately.
   *
   * Delayed methods — bank debits, transfers — complete a session while
   * `payment_status` is still "unpaid" and settle hours or days later. Our hold
   * lasts 35 minutes, so by the time `async_payment_succeeded` arrived the
   * blocks would be long released and settlement would fail permanently: money
   * taken, nothing delivered, and the webhook retrying for three days against a
   * hold that cannot come back.
   *
   * Refusing those methods up front is the honest fix. Supporting them properly
   * means a hold that outlives the payment, which is a different product
   * decision than the one this grid makes.
   */
  payment_method_types: ["card"];
  metadata: { orderId: string };
  success_url: string;
  cancel_url: string;
}

export interface StripeRequestOptions {
  idempotencyKey?: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export interface StripeClient {
  checkout: {
    sessions: {
      create(
        params: StripeSessionCreateParams,
        options?: StripeRequestOptions,
      ): Promise<StripeCheckoutSession>;
      expire(id: string): Promise<unknown>;
    };
  };
  webhooks: {
    constructEvent(rawBody: string, signature: string, webhookSecret: string): unknown;
  };
}

/**
 * Load the SDK and adapt it to `StripeClient`.
 *
 * The import is a call away from module scope on purpose: importing this file
 * must stay free, because the composition root imports it to decide which
 * provider to build.
 */
export async function loadStripeClient(secretKey: string): Promise<StripeClient> {
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(secretKey);
  return {
    checkout: {
      sessions: {
        create: (params, options) => stripe.checkout.sessions.create(params, options),
        expire: (id) => stripe.checkout.sessions.expire(id),
      },
    },
    webhooks: {
      constructEvent: (rawBody, signature, webhookSecret) =>
        stripe.webhooks.constructEvent(rawBody, signature, webhookSecret),
    },
  };
}

/* --------------------------------------------------------- session shape -- */

/** Prices are cents in one currency throughout (DECISIONS D3). */
const CURRENCY = "usd";

/** Stripe rejects an `expires_at` outside 30 minutes – 24 hours (research §5). */
export const MIN_SESSION_TTL_SECONDS = 30 * 60;
export const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * The session expiry, clamped into Stripe's allowed window.
 *
 * Our hold is exactly 30 minutes (SPEC §5), which lands *on* Stripe's lower
 * bound — so the seconds spent reserving blocks and writing the order would
 * carry the requested timestamp under it and Stripe would reject the whole
 * checkout. Clamping up is the difference between a working checkout and a
 * 400. The upper clamp is there for the page orders, whose expiry a future
 * change could set further out than a day.
 *
 * Clamping to a Stripe hold slightly longer than our own is harmless: our hold
 * is authoritative and expires by being read (DECISIONS D9).
 */
export function sessionExpiresAt(expiresAt: Date, now: Date): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const requested = Math.floor(expiresAt.getTime() / 1000);
  return Math.min(
    Math.max(requested, nowSeconds + MIN_SESSION_TTL_SECONDS),
    nowSeconds + MAX_SESSION_TTL_SECONDS,
  );
}

/**
 * The idempotency key for an order's checkout.
 *
 * Derived, not random: Stripe replays the original response for a repeated key
 * with the same parameters (research §4), so a retried or double-submitted
 * checkout returns the *first* session instead of opening a second one against
 * one hold. A random key per attempt would defeat exactly that. Order ids are
 * server-generated and opaque, which satisfies the docs' one rule about key
 * contents — no personal data.
 *
 * A retry late enough that the clamp moves `expires_at` sends different
 * parameters under the same key, which Stripe refuses. That is the safe
 * direction: it fails loudly rather than quietly charging twice.
 */
export function idempotencyKeyFor(orderId: string): string {
  return `dollar-pixels:checkout:${orderId}`;
}

function toLineItem(line: CheckoutLine): StripeLineItemParams {
  return {
    price_data: {
      currency: CURRENCY,
      product_data: { name: line.label },
      // The unit price comes from the server's own pricing. A client-supplied
      // amount is never reachable from here (research §2).
      unit_amount: line.amountCents,
    },
    quantity: line.quantity,
  };
}

function linesTotal(lines: readonly CheckoutLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents * line.quantity, 0);
}

/* -------------------------------------------------------------- provider -- */

export interface StripePaymentProviderDeps {
  readonly secretKey: string;
  /** Injected by tests. Production loads the SDK on first use instead. */
  readonly client?: StripeClient;
  readonly clock?: Clock;
}

const systemClock: Clock = { now: () => new Date() };

export class StripePaymentProvider implements PaymentProvider {
  readonly id = "stripe";
  readonly label = "Stripe";
  readonly isLive = true;

  private readonly secretKey: string;
  private readonly clock: Clock;
  private clientPromise: Promise<StripeClient> | null;

  constructor(deps: StripePaymentProviderDeps) {
    this.secretKey = deps.secretKey;
    this.clock = deps.clock ?? systemClock;
    this.clientPromise = deps.client ? Promise.resolve(deps.client) : null;
  }

  /** Memoised so a busy process builds one SDK client, not one per checkout. */
  private getClient(): Promise<StripeClient> {
    this.clientPromise ??= loadStripeClient(this.secretKey);
    return this.clientPromise;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutHandle> {
    const total = linesTotal(input.lines);
    if (total !== input.amountCents) {
      // The charge and the order must be the same number or the ledger is
      // wrong from the first entry. Refusing beats charging the wrong amount.
      throw new Error(
        `checkout lines total ${total} cents but order ${input.orderId} is ${input.amountCents} cents`,
      );
    }

    const client = await this.getClient();
    const session = await client.checkout.sessions.create(
      {
        mode: "payment",
        line_items: input.lines.map(toLineItem),
        expires_at: sessionExpiresAt(input.expiresAt, this.clock.now()),
        payment_method_types: ["card"],
        // Carried so the webhook settles from the event alone, with no lookup
        // by session id first (research §5).
        metadata: { orderId: input.orderId },
        success_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
      { idempotencyKey: idempotencyKeyFor(input.orderId) },
    );

    if (!session.url) {
      // Hosted Checkout always returns a URL; a null one means the session was
      // created in a mode we do not use, and silently returning "" would send
      // the buyer to our own origin as if it were a payment page.
      throw new Error(
        `Stripe session ${session.id} for order ${input.orderId} has no redirect URL`,
      );
    }

    return { redirectUrl: session.url, ref: session.id };
  }

  async expire(ref: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.checkout.sessions.expire(ref);
    } catch (error) {
      // Best-effort by contract. A session that is unknown or no longer open
      // is already in the state this call wanted, so it is not a failure.
      // Anything else — auth, network, a Stripe outage — stays loud, and the
      // hold releases on its own anyway (DECISIONS D9).
      if (isSessionAlreadyGone(error)) return;
      throw error;
    }
  }
}

/**
 * Stripe gives the "already expired" case no stable error code, so the message
 * is the only signal for it; the codes cover the unknown-session case, which
 * does have one.
 */
const GONE_ERROR_CODES = new Set(["resource_missing", "checkout_session_not_open"]);
const GONE_MESSAGE_FRAGMENTS = [
  "no such checkout.session",
  "only expire a session",
  "already expired",
];

function isSessionAlreadyGone(error: unknown): boolean {
  if (readProp(error, "statusCode") === 404) return true;

  const code = readProp(error, "code");
  if (typeof code === "string" && GONE_ERROR_CODES.has(code)) return true;

  const message = readProp(error, "message");
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  return GONE_MESSAGE_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/* ------------------------------------------------------------- webhooks -- */

/**
 * Signature verification, behind an interface.
 *
 * Kept out of the route so the route stays thin and this stays unit-testable,
 * but kept out of `PaymentProvider` too: only the Stripe path has a signature,
 * and only the route has the raw body it must be checked against
 * (research §3 — `req.text()`, never `req.json()`).
 */
export interface StripeWebhookVerifier {
  construct(rawBody: string, signature: string): Promise<unknown>;
}

export function createStripeWebhookVerifier(
  secretKey: string,
  webhookSecret: string,
  client?: StripeClient,
): StripeWebhookVerifier {
  let pending: Promise<StripeClient> | null = client ? Promise.resolve(client) : null;
  return {
    construct(rawBody, signature) {
      pending ??= loadStripeClient(secretKey);
      // Throws on a bad or missing signature. The route turns that into a 400
      // — an unverified body is not an event and must never reach fulfilment.
      return pending.then((stripe) =>
        stripe.webhooks.constructEvent(rawBody, signature, webhookSecret),
      );
    },
  };
}

export type SettlementIntent = "settle" | "release" | "ignore";

/**
 * What an event type means for an order (research §3).
 *
 * The `async_payment_*` pair exists because delayed payment methods finish
 * long after the buyer has been redirected away, so `completed` is not always
 * the moment money arrives. `expired` is the event that releases inventory —
 * it is the whole reason the hold model works.
 *
 * Everything else is ignored rather than rejected: Stripe sends whatever the
 * endpoint is subscribed to, and an unknown type is not an error. `charge.
 * refunded` falls here too — the ledger has no reversal path yet (SPEC §13),
 * so pretending to handle it would be worse than not.
 */
export function settlementIntentFor(eventType: string): SettlementIntent {
  switch (eventType) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return "settle";
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      return "release";
    default:
      return "ignore";
  }
}

/**
 * The order id a `checkout.session.*` event carries in its metadata.
 *
 * Defensive about shape on purpose: the argument is whatever `constructEvent`
 * returned, and a handler that throws on an unexpected body answers 500, which
 * makes Stripe retry that same unreadable event with backoff for three days
 * (research §3). Returning null lets the route answer 200 and move on.
 */
export function orderIdFromEvent(event: unknown): string | null {
  const orderId = readProp(
    readProp(readProp(readProp(event, "data"), "object"), "metadata"),
    "orderId",
  );
  return typeof orderId === "string" && orderId.length > 0 ? orderId : null;
}

function readProp(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}
