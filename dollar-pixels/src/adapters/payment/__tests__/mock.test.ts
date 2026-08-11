import { describe, expect, it } from "vitest";

import { MockPaymentProvider } from "@/adapters/payment/mock";
import type { CheckoutInput } from "@/ports";

function input(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    orderId: "ord_abc123",
    amountCents: 900,
    lines: [{ label: "9 blocks on The Wall", amountCents: 100, quantity: 9 }],
    description: "9 blocks (81 pixels) on The Wall",
    returnUrl: "https://example.test/checkout/return?order=ord_abc123",
    cancelUrl: "https://example.test/p/the-wall?cancelled=ord_abc123",
    expiresAt: new Date("2026-08-10T12:30:00.000Z"),
    ...overrides,
  };
}

describe("MockPaymentProvider", () => {
  it("identifies itself as fake money", () => {
    const provider = new MockPaymentProvider();
    expect(provider.id).toBe("mock");
    expect(provider.isLive).toBe(false);
    expect(provider.label).toBeTruthy();
  });

  it("redirects to the in-app checkout for the order", async () => {
    const handle = await new MockPaymentProvider().createCheckout(input());

    expect(handle.redirectUrl).toBe("/checkout/mock/ord_abc123");
    expect(handle.ref).toBe("mock_ord_abc123");
  });

  it("derives the handle from the order alone, so it holds no state", async () => {
    const provider = new MockPaymentProvider();

    const first = await provider.createCheckout(input());
    const second = await provider.createCheckout(input());
    const other = await provider.createCheckout(input({ orderId: "ord_zzz" }));

    expect(second).toEqual(first);
    expect(other.ref).toBe("mock_ord_zzz");
  });

  it("ignores everything the order does not need", async () => {
    const provider = new MockPaymentProvider();

    const handle = await provider.createCheckout(
      input({ amountCents: 0, lines: [], returnUrl: "", cancelUrl: "" }),
    );

    expect(handle.redirectUrl).toBe("/checkout/mock/ord_abc123");
  });

  it("expires without throwing, for a known ref or an unknown one", async () => {
    const provider = new MockPaymentProvider();

    await expect(provider.expire("mock_ord_abc123")).resolves.toBeUndefined();
    await expect(provider.expire("nothing-like-a-ref")).resolves.toBeUndefined();
    await expect(provider.expire("")).resolves.toBeUndefined();
  });
});
