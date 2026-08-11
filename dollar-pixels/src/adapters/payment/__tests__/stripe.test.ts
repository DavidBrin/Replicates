import { describe, expect, it, vi } from "vitest";

// `server-only` throws on import outside a React Server Component build, which
// is the whole point of the marker. Emptying it here keeps that guard on the
// production path while letting the adapter be unit-tested.
vi.mock("server-only", () => ({}));

import {
  MAX_SESSION_TTL_SECONDS,
  MIN_SESSION_TTL_SECONDS,
  StripePaymentProvider,
  createStripeWebhookVerifier,
  idempotencyKeyFor,
  orderIdFromEvent,
  sessionExpiresAt,
  settlementIntentFor,
} from "@/adapters/payment/stripe";
import type {
  StripeCheckoutSession,
  StripeClient,
  StripeRequestOptions,
  StripeSessionCreateParams,
} from "@/adapters/payment/stripe";
import type { CheckoutInput, Clock } from "@/ports";

/* ---------------------------------------------------------------- fakes -- */

const NOW = new Date("2026-08-10T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const clock: Clock = { now: () => NOW };

interface CreateCall {
  params: StripeSessionCreateParams;
  options: StripeRequestOptions | undefined;
}

interface ConstructCall {
  rawBody: string;
  signature: string;
  webhookSecret: string;
}

function fakeStripe(
  opts: {
    session?: Partial<StripeCheckoutSession>;
    expireError?: unknown;
    constructResult?: unknown;
    constructError?: unknown;
  } = {},
) {
  const createCalls: CreateCall[] = [];
  const expireCalls: string[] = [];
  const constructCalls: ConstructCall[] = [];
  const session: StripeCheckoutSession = {
    id: "cs_test_1",
    url: "https://checkout.stripe.test/c/cs_test_1",
    ...opts.session,
  };

  const client: StripeClient = {
    checkout: {
      sessions: {
        create: (params, options) => {
          createCalls.push({ params, options });
          return Promise.resolve(session);
        },
        expire: (id) => {
          expireCalls.push(id);
          return opts.expireError === undefined
            ? Promise.resolve({ id, status: "expired" })
            : Promise.reject(opts.expireError);
        },
      },
    },
    webhooks: {
      constructEvent: (rawBody, signature, webhookSecret) => {
        constructCalls.push({ rawBody, signature, webhookSecret });
        if (opts.constructError !== undefined) throw opts.constructError;
        return opts.constructResult ?? { id: "evt_1", type: "checkout.session.completed" };
      },
    },
  };

  return { client, createCalls, expireCalls, constructCalls };
}

function input(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    orderId: "ord_abc123",
    amountCents: 900,
    lines: [{ label: "9 blocks on The Wall", amountCents: 100, quantity: 9 }],
    description: "9 blocks (81 pixels) on The Wall",
    returnUrl: "https://example.test/checkout/return?order=ord_abc123",
    cancelUrl: "https://example.test/p/the-wall?cancelled=ord_abc123",
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    ...overrides,
  };
}

function provider(client: StripeClient): StripePaymentProvider {
  return new StripePaymentProvider({ secretKey: "sk_test_fake", client, clock });
}

/* -------------------------------------------------------------- identity -- */

describe("StripePaymentProvider identity", () => {
  it("is the live provider", () => {
    const p = provider(fakeStripe().client);
    expect(p.id).toBe("stripe");
    expect(p.isLive).toBe(true);
  });

  it("constructs without loading the SDK or reaching the network", () => {
    // No client injected: if construction touched `stripe` or the API, a fake
    // key and no network would make this throw.
    expect(() => new StripePaymentProvider({ secretKey: "sk_test_fake" })).not.toThrow();
  });
});

/* ------------------------------------------------------------ line items -- */

describe("createCheckout line items", () => {
  it("builds them from the input, in cents, in usd", async () => {
    const stripe = fakeStripe();

    await provider(stripe.client).createCheckout(input());

    expect(stripe.createCalls).toHaveLength(1);
    expect(stripe.createCalls[0].params.mode).toBe("payment");
    expect(stripe.createCalls[0].params.line_items).toEqual([
      {
        price_data: {
          currency: "usd",
          product_data: { name: "9 blocks on The Wall" },
          unit_amount: 100,
        },
        quantity: 9,
      },
    ]);
  });

  it("sends a total that matches the order amount", async () => {
    const stripe = fakeStripe();
    const order = input({
      amountCents: 1_500,
      lines: [
        { label: "12 blocks", amountCents: 100, quantity: 12 },
        { label: "Page", amountCents: 300, quantity: 1 },
      ],
    });

    await provider(stripe.client).createCheckout(order);

    const total = stripe.createCalls[0].params.line_items.reduce(
      (sum, item) => sum + item.price_data.unit_amount * item.quantity,
      0,
    );
    expect(total).toBe(order.amountCents);
  });

  it("refuses when the lines do not add up to the order amount", async () => {
    const stripe = fakeStripe();

    await expect(
      provider(stripe.client).createCheckout(input({ amountCents: 100 })),
    ).rejects.toThrow(/900 cents but order ord_abc123 is 100 cents/);
    expect(stripe.createCalls).toHaveLength(0);
  });

  it("passes the return and cancel urls and the order metadata through", async () => {
    const stripe = fakeStripe();
    const order = input();

    await provider(stripe.client).createCheckout(order);

    expect(stripe.createCalls[0].params.success_url).toBe(order.returnUrl);
    expect(stripe.createCalls[0].params.cancel_url).toBe(order.cancelUrl);
    expect(stripe.createCalls[0].params.metadata).toEqual({ orderId: "ord_abc123" });
  });

  it("returns the session url and id as the handle", async () => {
    const stripe = fakeStripe({
      session: { id: "cs_test_xyz", url: "https://checkout.stripe.test/c/cs_test_xyz" },
    });

    const handle = await provider(stripe.client).createCheckout(input());

    expect(handle).toEqual({
      redirectUrl: "https://checkout.stripe.test/c/cs_test_xyz",
      ref: "cs_test_xyz",
    });
  });

  it("throws rather than returning a handle with no url", async () => {
    const stripe = fakeStripe({ session: { id: "cs_test_null", url: null } });

    await expect(provider(stripe.client).createCheckout(input())).rejects.toThrow(
      /cs_test_null.*no redirect URL/,
    );
  });
});

/* --------------------------------------------------------------- expiry -- */

describe("sessionExpiresAt", () => {
  it("keeps a request inside the allowed window untouched", () => {
    const wanted = new Date(NOW.getTime() + 2 * 60 * 60_000);
    expect(sessionExpiresAt(wanted, NOW)).toBe(Math.floor(wanted.getTime() / 1000));
  });

  it("accepts the lower bound exactly", () => {
    const wanted = new Date(NOW.getTime() + MIN_SESSION_TTL_SECONDS * 1000);
    expect(sessionExpiresAt(wanted, NOW)).toBe(NOW_SECONDS + MIN_SESSION_TTL_SECONDS);
  });

  it("clamps up to 30 minutes — Stripe rejects anything sooner (research §5)", () => {
    const wanted = new Date(NOW.getTime() + 5 * 60_000);
    expect(sessionExpiresAt(wanted, NOW)).toBe(NOW_SECONDS + MIN_SESSION_TTL_SECONDS);
  });

  it("clamps an expiry already in the past up to the lower bound", () => {
    const wanted = new Date(NOW.getTime() - 60 * 60_000);
    expect(sessionExpiresAt(wanted, NOW)).toBe(NOW_SECONDS + MIN_SESSION_TTL_SECONDS);
  });

  it("clamps down to 24 hours", () => {
    const wanted = new Date(NOW.getTime() + 72 * 60 * 60_000);
    expect(sessionExpiresAt(wanted, NOW)).toBe(NOW_SECONDS + MAX_SESSION_TTL_SECONDS);
  });

  it("accepts the upper bound exactly", () => {
    const wanted = new Date(NOW.getTime() + MAX_SESSION_TTL_SECONDS * 1000);
    expect(sessionExpiresAt(wanted, NOW)).toBe(NOW_SECONDS + MAX_SESSION_TTL_SECONDS);
  });

  it("is what the session is created with", async () => {
    const stripe = fakeStripe();

    await provider(stripe.client).createCheckout(
      input({ expiresAt: new Date(NOW.getTime() + 60_000) }),
    );

    expect(stripe.createCalls[0].params.expires_at).toBe(
      NOW_SECONDS + MIN_SESSION_TTL_SECONDS,
    );
  });
});

/* ---------------------------------------------------------- idempotency -- */

describe("idempotency", () => {
  it("derives a stable key from the order id", () => {
    expect(idempotencyKeyFor("ord_abc123")).toBe(idempotencyKeyFor("ord_abc123"));
    expect(idempotencyKeyFor("ord_abc123")).not.toBe(idempotencyKeyFor("ord_zzz"));
    expect(idempotencyKeyFor("ord_abc123")).toContain("ord_abc123");
  });

  it("sends the same key when the same order checks out twice", async () => {
    const stripe = fakeStripe();
    const p = provider(stripe.client);

    await p.createCheckout(input());
    await p.createCheckout(input());
    await p.createCheckout(input({ orderId: "ord_other", amountCents: 900 }));

    expect(stripe.createCalls[0].options?.idempotencyKey).toBe(
      idempotencyKeyFor("ord_abc123"),
    );
    expect(stripe.createCalls[1].options?.idempotencyKey).toBe(
      stripe.createCalls[0].options?.idempotencyKey,
    );
    expect(stripe.createCalls[2].options?.idempotencyKey).not.toBe(
      stripe.createCalls[0].options?.idempotencyKey,
    );
  });
});

/* --------------------------------------------------------------- expire -- */

describe("expire", () => {
  it("expires the session by ref", async () => {
    const stripe = fakeStripe();

    await provider(stripe.client).expire("cs_test_1");

    expect(stripe.expireCalls).toEqual(["cs_test_1"]);
  });

  it.each([
    ["an unknown session (404)", { statusCode: 404, message: "No such checkout.session: cs_x" }],
    ["a missing resource code", { code: "resource_missing", message: "No such checkout.session" }],
    [
      "a session that is no longer open",
      { code: "checkout_session_not_open", message: "You may only expire a Session that is in the open state" },
    ],
    ["an already expired session", { message: "That session is already expired" }],
  ])("swallows %s", async (_label, error) => {
    const stripe = fakeStripe({ expireError: error });

    await expect(provider(stripe.client).expire("cs_test_1")).resolves.toBeUndefined();
  });

  it("still raises a fault that is not about the session being gone", async () => {
    const stripe = fakeStripe({
      expireError: Object.assign(new Error("Invalid API key provided"), {
        statusCode: 401,
        code: "api_key_invalid",
      }),
    });

    await expect(provider(stripe.client).expire("cs_test_1")).rejects.toThrow(
      /Invalid API key/,
    );
  });
});

/* ------------------------------------------------------ settlement intent -- */

describe("settlementIntentFor", () => {
  it.each([
    ["checkout.session.completed", "settle"],
    ["checkout.session.async_payment_succeeded", "settle"],
    ["checkout.session.expired", "release"],
    ["checkout.session.async_payment_failed", "release"],
  ])("maps %s to %s", (eventType, intent) => {
    expect(settlementIntentFor(eventType)).toBe(intent);
  });

  it.each([
    "charge.refunded",
    "payment_intent.succeeded",
    "checkout.session.completed.v2",
    "checkout.session.",
    "invoice.paid",
    "",
  ])("ignores %s", (eventType) => {
    expect(settlementIntentFor(eventType)).toBe("ignore");
  });

  it("is case sensitive, because Stripe event types are", () => {
    expect(settlementIntentFor("CHECKOUT.SESSION.COMPLETED")).toBe("ignore");
  });
});

/* ------------------------------------------------------ orderIdFromEvent -- */

describe("orderIdFromEvent", () => {
  it("reads the order id out of the session metadata", () => {
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_1", metadata: { orderId: "ord_abc123" } } },
    };

    expect(orderIdFromEvent(event)).toBe("ord_abc123");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "checkout.session.completed"],
    ["a number", 7],
    ["an array", []],
    ["an event with no data", { id: "evt_1" }],
    ["data with no object", { data: {} }],
    ["an object with no metadata", { data: { object: { id: "cs_test_1" } } }],
    ["null metadata", { data: { object: { metadata: null } } }],
    ["metadata without an orderId", { data: { object: { metadata: { pageId: "pg_1" } } } }],
    ["a non-string orderId", { data: { object: { metadata: { orderId: 12 } } } }],
    ["an empty orderId", { data: { object: { metadata: { orderId: "" } } } }],
  ])("returns null for %s", (_label, event) => {
    expect(orderIdFromEvent(event)).toBeNull();
  });

  it("reads only the order id, ignoring the rest of the metadata", () => {
    const event = {
      data: { object: { metadata: { orderId: "ord_1", pageId: "pg_1", rect: "0,0,3,3" } } },
    };

    expect(orderIdFromEvent(event)).toBe("ord_1");
  });
});

/* -------------------------------------------------------------- verifier -- */

describe("createStripeWebhookVerifier", () => {
  it("verifies the raw body against the endpoint secret", async () => {
    const stripe = fakeStripe({ constructResult: { id: "evt_9" } });
    const verifier = createStripeWebhookVerifier("sk_test_fake", "whsec_fake", stripe.client);

    const event = await verifier.construct("{\"id\":\"evt_9\"}", "t=1,v1=abc");

    expect(event).toEqual({ id: "evt_9" });
    expect(stripe.constructCalls).toEqual([
      { rawBody: "{\"id\":\"evt_9\"}", signature: "t=1,v1=abc", webhookSecret: "whsec_fake" },
    ]);
  });

  it("rejects when the signature does not verify", async () => {
    const stripe = fakeStripe({
      constructError: new Error("No signatures found matching the expected signature"),
    });
    const verifier = createStripeWebhookVerifier("sk_test_fake", "whsec_fake", stripe.client);

    await expect(verifier.construct("{}", "bad")).rejects.toThrow(/No signatures found/);
  });
});
