/**
 * Choosing a payment provider.
 *
 * The one rule this file exists to enforce: asking for Stripe without the keys
 * to be Stripe is fatal (DECISIONS D11). There is no fallback branch to the
 * mock, because a deploy that boots healthy and quietly hands out pixels for
 * free is found in the accounts, while one that refuses to start is found in
 * the first minute.
 */

import { normalisePaymentProvider } from "@/domain/payment-config";
import type { PaymentProvider } from "@/ports";

import { MockPaymentProvider } from "./mock";
import { StripePaymentProvider } from "./stripe";

export { MockPaymentProvider } from "./mock";
export { StripePaymentProvider } from "./stripe";

export type PaymentEnv = Record<string, string | undefined>;


/**
 * Both are required, though only the secret key is used to build the provider.
 * A deployment that can take money but cannot verify the webhook that settles
 * it charges buyers and never gives them their blocks — the same silent
 * failure D11 is about, one step further along.
 */
const STRIPE_REQUIRED_VARS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;

/**
 * Env is a parameter, not a global read, so tests never mutate `process.env`
 * and the composition root can pass a validated object.
 */
export function createPaymentProvider(env: PaymentEnv = process.env): PaymentProvider {
  // Normalisation lives in `domain/payment-config.ts` so that the root layout,
  // which decides whether to show the play-money banner, reads the variable
  // through the exact same function. Two independent readings of one variable
  // is how a live deployment ended up able to advertise itself as fake.
  const requested = normalisePaymentProvider(env.PAYMENT_PROVIDER) ?? env.PAYMENT_PROVIDER;

  switch (requested) {
    case "mock":
      return new MockPaymentProvider();

    case "stripe": {
      const secretKey = env.STRIPE_SECRET_KEY;
      if (!isSet(secretKey) || !isSet(env.STRIPE_WEBHOOK_SECRET)) {
        const missing = STRIPE_REQUIRED_VARS.filter((name) => !isSet(env[name]));
        throw new Error(
          `PAYMENT_PROVIDER=stripe requires ${missing.join(" and ")}, ` +
            `${missing.length === 1 ? "which is" : "which are"} not set. ` +
            `Refusing to start rather than falling back to fake money (DECISIONS D11).`,
        );
      }
      // Narrowed by the guard above, so no assertion is needed to prove the
      // key is a string.
      return new StripePaymentProvider({ secretKey });
    }

    default:
      throw new Error(
        `Unknown PAYMENT_PROVIDER "${requested}". Expected "mock" or "stripe".`,
      );
  }
}

/** An empty string is a variable someone meant to set and did not. */
function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
