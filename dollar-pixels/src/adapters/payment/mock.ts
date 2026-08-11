/**
 * The fake-money provider.
 *
 * It is not a shortcut around settlement — it is a second trigger for the same
 * `fulfilment.settle(orderId, ref)` Stripe drives (DECISIONS D10). So there is
 * nothing here but a redirect to an in-app page and a reference to remember it
 * by: no keys, no account, no network call, and no state of its own. The order
 * in the store already holds everything a checkout knows.
 */

import type { CheckoutHandle, CheckoutInput, PaymentProvider } from "@/ports";

export class MockPaymentProvider implements PaymentProvider {
  readonly id = "mock";
  readonly label = "Play money";
  readonly isLive = false;

  /**
   * The redirect is a relative in-app route (SPEC §10), so the buyer never
   * leaves the origin and this path can be exercised with no network at all.
   * The order id is server-generated and opaque, so it goes into the path as
   * it stands.
   */
  createCheckout(input: CheckoutInput): Promise<CheckoutHandle> {
    return Promise.resolve({
      redirectUrl: `/checkout/mock/${input.orderId}`,
      ref: `mock_${input.orderId}`,
    });
  }

  /**
   * There is no remote session to cancel, and the hold is released by the
   * order's own lifecycle — holds expire by being read (DECISIONS D9). Never
   * throwing is what the port asks of every provider; for this one it is free.
   * A field rather than a method so the ignored `ref` need not be named while
   * callers still get the port's signature.
   */
  readonly expire: PaymentProvider["expire"] = () => Promise.resolve();
}
