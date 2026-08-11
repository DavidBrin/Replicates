import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  createStripeWebhookVerifier,
  orderIdFromEvent,
  settlementIntentFor,
} from "@/adapters/payment/stripe";
import { release, settle } from "@/domain/services/fulfilment";
import { isAppError } from "@/domain/services/errors";
import { getContainer } from "@/lib/container";

/**
 * Stripe's side of settlement.
 *
 * Three things this route has to get right, all of them from
 * research/payments-stripe.md §3 and §4:
 *
 *   1. Verify the signature over the RAW body. `req.text()`, never
 *      `req.json()` — the App Router hands us the unparsed request, so no
 *      framework workaround is needed, but parsing it first would destroy the
 *      bytes the signature covers.
 *   2. Be idempotent. Delivery is at-least-once, so the event id is recorded
 *      and a repeat is acknowledged without being acted on.
 *   3. Acknowledge anything it cannot use. Returning an error to Stripe for an
 *      event we simply do not care about earns days of retries.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const c = await getContainer();

  // The route exists unconditionally so that a misconfigured deployment gets a
  // clear answer rather than a 404 that looks like a routing bug.
  if (!c.payments.isLive) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Stripe is not enabled." } },
      { status: 404 },
    );
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    // Unreachable if the container built, since it fails fast on exactly this
    // (DECISIONS D11). Kept because this route reads the environment directly.
    return NextResponse.json(
      { ok: false, error: { code: "misconfigured", message: "Stripe is not configured." } },
      { status: 500 },
    );
  }

  const signature = (await headers()).get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid", message: "Missing signature." } },
      { status: 400 },
    );
  }

  const raw = await req.text();

  let event: unknown;
  try {
    const verifier = await createStripeWebhookVerifier(secretKey, webhookSecret);
    event = await verifier.construct(raw, signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: { code: "invalid", message: `Webhook error: ${message}` } },
      { status: 400 },
    );
  }

  const { id, type } = readEventEnvelope(event);
  if (!id || !type) {
    return NextResponse.json({ ok: true, data: { ignored: true } });
  }

  const intent = settlementIntentFor(type);
  if (intent === "ignore") {
    return NextResponse.json({ ok: true, data: { ignored: true } });
  }

  const orderId = orderIdFromEvent(event);
  if (!orderId) {
    // A Checkout Session of ours always carries the order id in metadata. One
    // that does not is not ours to act on, and retrying will not change that.
    return NextResponse.json({ ok: true, data: { ignored: true } });
  }

  // A `completed` session is not necessarily a *paid* one. Delayed payment
  // methods — bank debits, transfers — fire `checkout.session.completed` while
  // `payment_status` is still "unpaid", and resolve later as
  // `async_payment_succeeded` or `async_payment_failed`. Settling on the first
  // event would hand over the blocks and then be unable to take them back,
  // because releasing a paid order is refused by design (DECISIONS D17).
  if (intent === "settle" && !isPaidSession(event)) {
    return NextResponse.json({ ok: true, data: { awaitingPayment: true } });
  }

  try {
    if (intent === "settle") {
      await settle(c, orderId, id);
    } else {
      await release(c, orderId, "expired");
    }

    // Recorded only after the work succeeded, and deliberately not before.
    //
    // Marking first reads as the obvious idempotency guard and is a trap: if
    // settlement then fails for any transient reason — a database blip, a
    // function timeout — Stripe's retry redelivers the same event id, the
    // dedupe swallows it, and an order the buyer has already paid for stays
    // `pending` forever with nothing left to notice it.
    //
    // Nothing is lost by moving it: `settle` is idempotent on its own
    // (DECISIONS D17), so a duplicate that races past this line is a no-op
    // rather than a second claim. The record is an audit trail and a cheap
    // short-circuit, not the thing correctness rests on.
    await c.store.markEventProcessed({
      id,
      provider: "stripe",
      receivedAt: c.clock.now().toISOString(),
    });
  } catch (error) {
    if (isAppError(error) && error.code === "conflict") {
      // An out-of-order delivery — an `expired` arriving after a `completed`
      // for the same session. Acknowledge it; retrying would never succeed.
      console.warn("[dollar-pixels] stripe webhook conflict", { orderId, type, message: error.message });
      return NextResponse.json({ ok: true, data: { conflict: true } });
    }
    console.error("[dollar-pixels] stripe webhook failed", { orderId, type, error });
    // A real failure — ask Stripe to retry.
    return NextResponse.json(
      { ok: false, error: { code: "internal", message: "Could not process event." } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, data: { handled: type } });
}

/**
 * Has this session's money actually arrived?
 *
 * `payment_status` is `"paid"`, `"unpaid"` or `"no_payment_required"`. Only an
 * unpaid one is refused: a zero-amount session legitimately requires no
 * payment, and a missing field is treated as paid so that a shape change in the
 * event does not quietly stop every settlement — that failure would be silent
 * and total, whereas the delayed-payment case this guards against is rare and
 * self-corrects when `async_payment_succeeded` arrives.
 */
function isPaidSession(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const data = (event as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return true;
  const object = (data as { object?: unknown }).object;
  if (typeof object !== "object" || object === null) return true;
  const status = (object as { payment_status?: unknown }).payment_status;
  return status !== "unpaid";
}

function readEventEnvelope(event: unknown): { id: string | null; type: string | null } {
  if (typeof event !== "object" || event === null) return { id: null, type: null };
  const record = event as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : null,
    type: typeof record.type === "string" ? record.type : null,
  };
}
