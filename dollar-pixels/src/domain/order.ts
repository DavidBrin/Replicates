/**
 * The order state machine.
 *
 * The idempotency rules here are the ones that stop a retried webhook from
 * writing a claim twice and crediting a creator twice. Stripe states plainly
 * that an endpoint may receive the same event more than once and that events
 * are not delivered in order, so "settle" has to be safe to call again — but
 * only with the same payment behind it (DECISIONS D17).
 */

import type { Order, OrderStatus } from "./entities";

export const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "paid",
  "expired",
  "cancelled",
]);

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** How the caller should treat a `settle` on an order in its current state. */
export type SettleDecision =
  | { readonly action: "settle" }
  /** Already done, by this same payment. Succeed and change nothing. */
  | { readonly action: "noop" }
  | { readonly action: "reject"; readonly reason: SettleRejection };

export type SettleRejection =
  /** Already paid, but by a *different* payment. A bug or an attack, not a retry. */
  | "conflicting-payment"
  | "order-expired"
  | "order-cancelled";

export function decideSettle(order: Order, providerRef: string): SettleDecision {
  switch (order.status) {
    case "pending":
      return { action: "settle" };
    case "paid":
      return order.providerRef === providerRef
        ? { action: "noop" }
        : { action: "reject", reason: "conflicting-payment" };
    case "expired":
      return { action: "reject", reason: "order-expired" };
    case "cancelled":
      return { action: "reject", reason: "order-cancelled" };
  }
}

export type ReleaseDecision =
  | { readonly action: "release"; readonly to: "expired" | "cancelled" }
  | { readonly action: "noop" }
  | { readonly action: "reject"; readonly reason: "already-paid" };

/**
 * Releasing a paid order is refused rather than absorbed.
 *
 * A `checkout.session.expired` arriving after a `completed` for the same
 * session is possible given out-of-order delivery, and quietly releasing the
 * blocks would strip a claim someone paid for.
 */
export function decideRelease(
  order: Order,
  to: "expired" | "cancelled",
): ReleaseDecision {
  switch (order.status) {
    case "pending":
      return { action: "release", to };
    case "paid":
      return { action: "reject", reason: "already-paid" };
    case "expired":
    case "cancelled":
      return { action: "noop" };
  }
}

/**
 * How long a selection is held while its buyer pays.
 *
 * 35 and not 30 on purpose. Stripe requires a Checkout Session's `expires_at`
 * to be at least 30 minutes in the future *at the moment the session is
 * created*, and we compute this expiry earlier — when the blocks are reserved,
 * before the network call. At exactly 30 the seconds spent reserving push the
 * timestamp under the bound and Stripe rejects the whole checkout. The five
 * minutes of headroom also keep our hold authoritative rather than Stripe's,
 * so the blocks are never free while the session is still payable.
 */
export const HOLD_MINUTES = 35;

export function holdExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60_000);
}

export function isExpiredAt(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  // An unparseable expiry is treated as expired: a hold nobody can reason
  // about must not be able to block a sale forever.
  return Number.isNaN(t) || t <= now.getTime();
}
