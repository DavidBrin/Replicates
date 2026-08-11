/**
 * How `PAYMENT_PROVIDER` is read — in exactly one place.
 *
 * This existed as two independent readings and they disagreed. The provider
 * factory normalised (`.trim().toLowerCase()`, with a test asserting that
 * `"STRIPE"` selects Stripe); the root layout compared the raw string against
 * `"stripe"` to decide whether to show the play-money banner. So
 * `PAYMENT_PROVIDER=STRIPE` with real keys produced a deployment that charged
 * real cards while displaying "no card is charged, every purchase here is
 * fake" — the single most misleading state this application can be in, reached
 * by a plausible typo.
 *
 * Pure and framework-free so that both the server-only composition root and the
 * root layout can import the same function.
 */

export const PAYMENT_PROVIDERS = ["mock", "stripe"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const DEFAULT_PAYMENT_PROVIDER: PaymentProviderId = "mock";

/** Normalise the raw variable. Returns null for a value we do not recognise. */
export function normalisePaymentProvider(raw: string | undefined): PaymentProviderId | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return DEFAULT_PAYMENT_PROVIDER;
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value)
    ? (value as PaymentProviderId)
    : null;
}

/**
 * Does this configuration charge real cards?
 *
 * An unrecognised value answers **false**, so the play-money banner shows. That
 * is the safe direction: warning about fake money on a real deployment is
 * confusing, whereas staying silent on a fake one is what makes someone believe
 * they spent something. An unrecognised value also refuses to boot in the
 * factory, so the banner is moot — but the two must not disagree about it.
 */
export function paymentIsLive(raw: string | undefined): boolean {
  return normalisePaymentProvider(raw) === "stripe";
}
