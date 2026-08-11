import { describe, expect, it, vi } from "vitest";

// The factory reaches the Stripe adapter, which is marked `server-only`.
vi.mock("server-only", () => ({}));

import { createPaymentProvider } from "@/adapters/payment";

const STRIPE_KEYS = {
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_fake",
};

describe("createPaymentProvider", () => {
  it("defaults to fake money, so nothing has to be configured to run", () => {
    expect(createPaymentProvider({}).id).toBe("mock");
    expect(createPaymentProvider({ PAYMENT_PROVIDER: undefined }).id).toBe("mock");
    expect(createPaymentProvider({ PAYMENT_PROVIDER: "" }).id).toBe("mock");
    expect(createPaymentProvider({ PAYMENT_PROVIDER: "   " }).id).toBe("mock");
  });

  it("takes the environment as an argument rather than reading the global", () => {
    // Nothing in this suite mutates `process.env`; a provider that read it
    // instead of the argument would come back as the default here.
    const provider = createPaymentProvider({ PAYMENT_PROVIDER: "stripe", ...STRIPE_KEYS });
    expect(provider.id).toBe("stripe");
  });

  it("selects the mock explicitly, and it is not live", () => {
    const provider = createPaymentProvider({ PAYMENT_PROVIDER: "mock" });
    expect(provider.id).toBe("mock");
    expect(provider.isLive).toBe(false);
  });

  it("selects stripe when both secrets are present, and it is live", () => {
    const provider = createPaymentProvider({ PAYMENT_PROVIDER: "stripe", ...STRIPE_KEYS });
    expect(provider.id).toBe("stripe");
    expect(provider.isLive).toBe(true);
  });

  it("tolerates case and surrounding whitespace", () => {
    expect(createPaymentProvider({ PAYMENT_PROVIDER: " Mock " }).id).toBe("mock");
    expect(
      createPaymentProvider({ PAYMENT_PROVIDER: "STRIPE", ...STRIPE_KEYS }).id,
    ).toBe("stripe");
  });

  /* The behaviour this file exists for (DECISIONS D11). */

  it("throws naming STRIPE_SECRET_KEY when it is missing", () => {
    expect(() =>
      createPaymentProvider({
        PAYMENT_PROVIDER: "stripe",
        STRIPE_WEBHOOK_SECRET: "whsec_fake",
      }),
    ).toThrow(/STRIPE_SECRET_KEY/);
  });

  it("throws naming STRIPE_WEBHOOK_SECRET when it is missing", () => {
    expect(() =>
      createPaymentProvider({
        PAYMENT_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test_fake",
      }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("names both when both are missing", () => {
    let message = "";
    try {
      createPaymentProvider({ PAYMENT_PROVIDER: "stripe" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it.each([
    ["an empty secret key", { STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "whsec_fake" }],
    ["a blank secret key", { STRIPE_SECRET_KEY: "  ", STRIPE_WEBHOOK_SECRET: "whsec_fake" }],
    ["an empty webhook secret", { STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "" }],
  ])("treats %s as missing", (_label, env) => {
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: "stripe", ...env })).toThrow(
      /DECISIONS D11/,
    );
  });

  it("never falls back to the mock when stripe is misconfigured", () => {
    // Stated as its own case because the tempting bug is a fallback that keeps
    // the app booting — and then serves pixels for free with every signal
    // green (DECISIONS D11).
    for (const env of [
      { PAYMENT_PROVIDER: "stripe" },
      { PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test_fake" },
      { PAYMENT_PROVIDER: "stripe", STRIPE_WEBHOOK_SECRET: "whsec_fake" },
    ]) {
      let provider: unknown = null;
      expect(() => {
        provider = createPaymentProvider(env);
      }).toThrow();
      expect(provider).toBeNull();
    }
  });

  it("throws on an unrecognised provider rather than defaulting", () => {
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: "paypal" })).toThrow(/paypal/);
    expect(() => createPaymentProvider({ PAYMENT_PROVIDER: "strip" })).toThrow(
      /Expected "mock" or "stripe"/,
    );
  });
});
