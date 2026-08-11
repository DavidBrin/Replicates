/**
 * Buying blocks: validate, hold, create an order, hand back a redirect.
 *
 * The rule this module exists to enforce is that the *server* decides the
 * price. The client sends a rectangle and never an amount; everything about
 * what it costs is recomputed here from the same domain functions the UI used
 * to display it. A client that lies about the price is charged the real one.
 */

import type { BlocksPayload, Order, Page } from "@/domain/entities";
import {
  blocksIn,
  gridForSize,
  isRectInside,
  MAX_SELECTION_BLOCKS,
  type BlockRect,
} from "@/domain/geometry";
import { rectPrice } from "@/domain/pricing";
import { holdExpiryFrom, isExpiredAt } from "@/domain/order";
import {
  artErrorMessage,
  normaliseCaption,
  normaliseColour,
  validateCaption,
  validateColour,
  validateTile,
} from "@/domain/art";
import { rectPixelSize } from "@/domain/geometry";
import type { CheckoutHandle, Clock, IdGen, PaymentProvider, Store } from "@/ports";
import { fail } from "./errors";

export interface CheckoutDeps {
  readonly store: Store;
  readonly clock: Clock;
  readonly idGen: IdGen;
  readonly payments: PaymentProvider;
  /** Absolute origin, e.g. `https://dollar-pixels.vercel.app`. */
  readonly origin: string;
}

export interface BuyBlocksInput {
  readonly slug: string;
  readonly buyerId: string;
  readonly rect: BlockRect;
  readonly caption: string;
  readonly colour: string;
  readonly tile: string | null;
}

export interface BuyBlocksResult {
  readonly order: Order;
  readonly checkout: CheckoutHandle;
}

/**
 * Validate a purchase and put it in front of the payment provider.
 *
 * Order of operations matters. The blocks are held *before* the provider is
 * asked for a session, so a slow provider cannot let a second buyer in
 * underneath the first. If the provider then fails, the hold is released
 * rather than left to time out, so an outage does not freeze the grid for
 * thirty minutes at a time.
 */
export async function buyBlocks(
  deps: CheckoutDeps,
  input: BuyBlocksInput,
): Promise<BuyBlocksResult> {
  const now = deps.clock.now();
  const page = await requirePage(deps.store, input.slug);
  const { rect, caption, colour, tile } = validateClaimInput(page, input);

  await assertHoldsAvailable(deps, input.buyerId, now);

  const amountCents = rectPrice(rect);
  const orderId = deps.idGen.next("ord");
  const expiresAt = holdExpiryFrom(now);

  const payload: BlocksPayload = {
    kind: "blocks",
    pageId: page.id,
    rect,
    caption,
    colour,
    tile,
  };

  const order = await deps.store.transact(async (tx) => {
    const reserved = await tx.reserveBlocks(page.id, rect, orderId, expiresAt, now);
    if (!reserved) {
      fail(
        "unavailable",
        "Some of those blocks have just been taken. Refresh and pick again.",
      );
    }
    return tx.createOrder({
      id: orderId,
      kind: "blocks",
      pageId: page.id,
      buyerId: input.buyerId,
      amountCents,
      status: "pending",
      provider: deps.payments.id,
      providerRef: null,
      payload,
      createdAt: now.toISOString(),
      settledAt: null,
    });
  });

  const blocks = blocksIn(rect);
  const checkout = await withHoldReleasedOnFailure(deps, order.id, () =>
    deps.payments.createCheckout({
      orderId: order.id,
      amountCents,
      lines: [
        {
          label: `${blocks.toLocaleString("en-US")} block${blocks === 1 ? "" : "s"} on ${page.title}`,
          amountCents: 100,
          quantity: blocks,
        },
      ],
      description: `${blocks.toLocaleString("en-US")} blocks (${blocks * 9} pixels) on ${page.title}`,
      returnUrl: `${deps.origin}/checkout/return?order=${order.id}`,
      cancelUrl: `${deps.origin}/p/${page.slug}?cancelled=${order.id}`,
      expiresAt,
    }),
  );

  const withRef = await deps.store.setOrderProviderRef(order.id, checkout.ref);
  return { order: withRef ?? order, checkout };
}

/* --------------------------------------------------------------- free -- */

export interface ClaimFreeInput {
  readonly slug: string;
  readonly buyerId: string;
  readonly rect: BlockRect;
  readonly caption: string;
  readonly colour: string;
  readonly tile: string | null;
}

/**
 * Spend a private page creator's allowance.
 *
 * Deliberately still an order — for zero — so that free blocks travel the same
 * settlement path as paid ones rather than getting a second way to write a
 * claim (DECISIONS D18). The caller settles it immediately.
 */
export async function claimFree(
  deps: CheckoutDeps,
  input: ClaimFreeInput,
): Promise<Order> {
  const now = deps.clock.now();
  const page = await requirePage(deps.store, input.slug);

  if (page.ownerId !== input.buyerId) {
    fail("forbidden", "Only a page's creator can use its free blocks.");
  }
  const { rect, caption, colour, tile } = validateClaimInput(page, input);

  const wanted = blocksIn(rect);
  const remaining = page.allowanceTotal - page.allowanceUsed;
  if (wanted > remaining) {
    fail(
      "invalid",
      remaining === 0
        ? "You have used all of your free blocks."
        : `You have ${remaining} free block${remaining === 1 ? "" : "s"} left.`,
    );
  }

  const orderId = deps.idGen.next("ord");

  return deps.store.transact(async (tx) => {
    const consumed = await tx.consumeAllowance(page.id, wanted);
    if (!consumed) fail("invalid", "You have used all of your free blocks.");

    const reserved = await tx.reserveBlocks(
      page.id,
      rect,
      orderId,
      holdExpiryFrom(now),
      now,
    );
    if (!reserved) {
      fail("unavailable", "Some of those blocks have just been taken.");
    }

    return tx.createOrder({
      id: orderId,
      kind: "blocks",
      pageId: page.id,
      buyerId: input.buyerId,
      amountCents: 0,
      status: "pending",
      provider: "allowance",
      providerRef: null,
      payload: { kind: "blocks", pageId: page.id, rect, caption, colour, tile },
      createdAt: now.toISOString(),
      settledAt: null,
    });
  });
}

/* ------------------------------------------------------------- internals -- */

/**
 * How many rectangles one buyer may have reserved but unpaid at once.
 *
 * Without a cap, a signed-in user can hold the entire grid indefinitely for
 * free. Each checkout takes a fresh 35-minute hold over up to
 * `MAX_SELECTION_BLOCKS` blocks and nothing obliges anyone to pay: roughly
 * forty requests cover a 400x400 page, and re-issuing before the old holds
 * lapse keeps it unbuyable by anyone else forever. Under the mock provider
 * that costs an attacker nothing at all.
 *
 * Six is generous for a person buying a few patches at once and useless as a
 * denial-of-service tool.
 */
export const MAX_OPEN_HOLDS_PER_BUYER = 6;

async function assertHoldsAvailable(
  deps: CheckoutDeps,
  buyerId: string,
  now: Date,
): Promise<void> {
  const orders = await deps.store.listOrdersByBuyer(buyerId);

  let open = 0;
  for (const order of orders) {
    if (order.status !== "pending") continue;
    const hold = await deps.store.getHold(order.id);
    // An expired hold is not holding anything, so it does not count against
    // the buyer — the same read-time rule the store uses (DECISIONS D9).
    if (hold && !isExpiredAt(hold.expiresAt, now)) open++;
  }

  if (open >= MAX_OPEN_HOLDS_PER_BUYER) {
    fail(
      "conflict",
      `You already have ${open} unpaid reservations. Finish or cancel one before starting another.`,
    );
  }
}

async function requirePage(store: Store, slug: string): Promise<Page> {
  const page = await store.getPageBySlug(slug);
  if (!page) fail("not_found", "No such page.");
  return page;
}

interface ValidatedClaim {
  readonly rect: BlockRect;
  readonly caption: string;
  readonly colour: string;
  readonly tile: string | null;
}

function validateClaimInput(
  page: Page,
  input: { rect: BlockRect; caption: string; colour: string; tile: string | null },
): ValidatedClaim {
  const dims = gridForSize(page.size);
  if (!isRectInside(input.rect, dims)) {
    fail("invalid", "That selection is not inside the grid.");
  }
  if (blocksIn(input.rect) > MAX_SELECTION_BLOCKS) {
    fail(
      "invalid",
      `One claim covers at most ${MAX_SELECTION_BLOCKS.toLocaleString("en-US")} blocks.`,
    );
  }

  const caption = normaliseCaption(input.caption);
  const captionError = validateCaption(caption);
  if (captionError) fail("invalid", artErrorMessage(captionError));

  const colour = normaliseColour(input.colour);
  const colourError = validateColour(colour);
  if (colourError) fail("invalid", artErrorMessage(colourError));

  if (input.tile !== null) {
    const tileError = validateTile(input.tile, input.rect);
    if (tileError) {
      fail("invalid", artErrorMessage(tileError, rectPixelSize(input.rect)));
    }
  }

  return { rect: input.rect, caption, colour, tile: input.tile };
}

/**
 * Release the hold if the provider call fails.
 *
 * Without this, a provider outage leaves the selected blocks frozen for the
 * full hold window with no order anyone can pay, which on a busy page is a
 * self-inflicted denial of service.
 */
async function withHoldReleasedOnFailure<T>(
  deps: CheckoutDeps,
  orderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    await deps.store.transact(async (tx) => {
      await tx.releaseHold(orderId);
      await tx.updateOrderStatus(orderId, "cancelled", {
        settledAt: deps.clock.now().toISOString(),
      });
    });
    if (error instanceof Error) {
      fail("payment_failed", `Could not start checkout: ${error.message}`);
    }
    fail("payment_failed", "Could not start checkout.");
  }
}
