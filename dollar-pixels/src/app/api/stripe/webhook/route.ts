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

  // First-seen wins. A repeat is acknowledged and dropped before it can write
  // anything — the second half of idempotency, the first half being `settle`
  // itself refusing to act twice.
  const fresh = await c.store.markEventProcessed({
    id,
    provider: "stripe",
    receivedAt: c.clock.now().toISOString(),
  });
  if (!fresh) {
    return NextResponse.json({ ok: true, data: { duplicate: true } });
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

  try {
    if (intent === "settle") {
      await settle(c, orderId, id);
    } else {
      await release(c, orderId, "expired");
    }
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

function readEventEnvelope(event: unknown): { id: string | null; type: string | null } {
  if (typeof event !== "object" || event === null) return { id: null, type: null };
  const record = event as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : null,
    type: typeof record.type === "string" ? record.type : null,
  };
}
