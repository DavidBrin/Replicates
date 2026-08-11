import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_PROVIDER,
  normalisePaymentProvider,
  paymentIsLive,
} from "@/domain/payment-config";
import { createPaymentProvider } from "@/adapters/payment";

/**
 * One variable, one reading.
 *
 * These exist because there were two readings and they disagreed: the factory
 * normalised case and whitespace, the root layout compared the raw string. So
 * `PAYMENT_PROVIDER=STRIPE` with real keys selected Stripe *and* displayed the
 * play-money banner — a deployment charging real cards while telling everyone
 * their purchases were fake.
 */

describe("normalisation", () => {
  it("defaults to the mock provider when unset or blank", () => {
    expect(normalisePaymentProvider(undefined)).toBe(DEFAULT_PAYMENT_PROVIDER);
    expect(normalisePaymentProvider("")).toBe("mock");
    expect(normalisePaymentProvider("   ")).toBe("mock");
  });

  it("accepts any casing and surrounding whitespace", () => {
    for (const raw of ["stripe", "STRIPE", "Stripe", " stripe ", "\tSTRIPE\n"]) {
      expect(normalisePaymentProvider(raw)).toBe("stripe");
    }
  });

  it("returns null for something it does not recognise", () => {
    expect(normalisePaymentProvider("paypal")).toBeNull();
    expect(normalisePaymentProvider("striped")).toBeNull();
  });
});

describe("the banner and the provider always agree", () => {
  const keys = {
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
  };

  it("reports live for every spelling the factory accepts as Stripe", () => {
    // The regression, stated directly: if the factory builds Stripe from this
    // value, the banner must not claim the money is fake.
    for (const raw of ["stripe", "STRIPE", "Stripe", " stripe "]) {
      const provider = createPaymentProvider({ PAYMENT_PROVIDER: raw, ...keys });
      expect(provider.isLive).toBe(true);
      expect(paymentIsLive(raw)).toBe(true);
    }
  });

  it("reports not-live for every spelling the factory treats as the mock", () => {
    for (const raw of [undefined, "", "  ", "mock", "MOCK"]) {
      const provider = createPaymentProvider({ PAYMENT_PROVIDER: raw });
      expect(provider.isLive).toBe(false);
      expect(paymentIsLive(raw)).toBe(false);
    }
  });

  it("shows the warning for a value that refuses to boot", () => {
    // The factory throws, so nothing serves traffic — but if it somehow did,
    // the safe default is to warn rather than to stay silent about fake money.
    expect(paymentIsLive("paypal")).toBe(false);
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: "paypal" })).toThrow();
  });

  it("still refuses Stripe without keys, whatever the casing", () => {
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: "STRIPE" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
  });
});
