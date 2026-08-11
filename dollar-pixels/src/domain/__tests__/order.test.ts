import { describe, expect, it } from "vitest";
import {
  HOLD_MINUTES,
  decideRelease,
  decideSettle,
  holdExpiryFrom,
  isExpiredAt,
  isTerminal,
} from "@/domain/order";
import type { Order } from "@/domain/entities";

function order(patch: Partial<Order> = {}): Order {
  return {
    id: "ord_1",
    kind: "blocks",
    pageId: "pag_1",
    buyerId: "usr_1",
    amountCents: 100,
    status: "pending",
    provider: "mock",
    providerRef: null,
    payload: {
      kind: "blocks",
      pageId: "pag_1",
      rect: { bx: 0, by: 0, bw: 1, bh: 1 },
      caption: "hello",
      colour: "#c0182b",
      tile: null,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    settledAt: null,
    ...patch,
  };
}

describe("settling", () => {
  it("settles a pending order", () => {
    expect(decideSettle(order(), "ref_1")).toEqual({ action: "settle" });
  });

  it("is a no-op when the same payment settles it twice", () => {
    // Webhook delivery is at-least-once. Without this a retry writes a second
    // claim and credits the creator twice (DECISIONS D17).
    const paid = order({ status: "paid", providerRef: "ref_1" });
    expect(decideSettle(paid, "ref_1")).toEqual({ action: "noop" });
  });

  it("rejects a second, different payment for the same order", () => {
    // Not a duplicate delivery — a bug or an attack. It must be loud rather
    // than absorbed by the code path that absorbs retries.
    const paid = order({ status: "paid", providerRef: "ref_1" });
    expect(decideSettle(paid, "ref_2")).toEqual({
      action: "reject",
      reason: "conflicting-payment",
    });
  });

  it("refuses to settle an order that already expired or was cancelled", () => {
    expect(decideSettle(order({ status: "expired" }), "ref")).toEqual({
      action: "reject",
      reason: "order-expired",
    });
    expect(decideSettle(order({ status: "cancelled" }), "ref")).toEqual({
      action: "reject",
      reason: "order-cancelled",
    });
  });
});

describe("releasing", () => {
  it("releases a pending order", () => {
    expect(decideRelease(order(), "expired")).toEqual({
      action: "release",
      to: "expired",
    });
  });

  it("refuses to release a paid order", () => {
    // An `expired` event can arrive after a `completed` for the same session,
    // because delivery is not ordered. Releasing here would strip a claim
    // somebody paid for.
    expect(decideRelease(order({ status: "paid" }), "expired")).toEqual({
      action: "reject",
      reason: "already-paid",
    });
  });

  it("is a no-op on an already-released order", () => {
    expect(decideRelease(order({ status: "expired" }), "expired")).toEqual({
      action: "noop",
    });
    expect(decideRelease(order({ status: "cancelled" }), "expired")).toEqual({
      action: "noop",
    });
  });
});

describe("terminal states", () => {
  it("counts paid, expired and cancelled, but not pending", () => {
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("paid")).toBe(true);
    expect(isTerminal("expired")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });
});

describe("hold expiry", () => {
  it("leaves headroom over Stripe's thirty-minute session minimum", () => {
    // Computed when blocks are reserved, checked by Stripe when the session is
    // created moments later. At exactly 30 the intervening seconds put it under
    // the bound and the whole checkout is rejected.
    expect(HOLD_MINUTES).toBeGreaterThan(30);
  });

  it("expires in the future, by the hold window", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(holdExpiryFrom(now).toISOString()).toBe("2026-01-01T00:35:00.000Z");
  });

  it("treats the exact instant of expiry as expired", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(isExpiredAt("2026-01-01T00:00:00.000Z", now)).toBe(true);
    expect(isExpiredAt("2026-01-01T00:00:00.001Z", now)).toBe(false);
    expect(isExpiredAt("2025-12-31T23:59:59.999Z", now)).toBe(true);
  });

  it("treats an unreadable expiry as expired rather than eternal", () => {
    // A hold nobody can reason about must not be able to block a sale forever.
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(isExpiredAt("not a date", now)).toBe(true);
    expect(isExpiredAt("", now)).toBe(true);
  });
});
