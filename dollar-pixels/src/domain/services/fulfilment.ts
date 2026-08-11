/**
 * Settlement — the one place an order turns into something owned.
 *
 * Both payment providers converge here. The mock provider's "Pay" button and
 * Stripe's `checkout.session.completed` webhook call the same function with
 * the same arguments, which is what makes the fake-money path a rehearsal for
 * the real one rather than a shortcut around it (DECISIONS D10).
 */

import type { Claim, LedgerEntry, Order, Page } from "@/domain/entities";
import { allowanceFor, splitBlockRevenue } from "@/domain/pricing";
import { decideRelease, decideSettle } from "@/domain/order";
import type { Clock, IdGen, PaymentProvider, Store } from "@/ports";
import { fail } from "./errors";

export interface FulfilmentDeps {
  readonly store: Store;
  readonly clock: Clock;
  readonly idGen: IdGen;
  readonly platformFeeBps: number;
  /** Used only to cancel a provider-side session when we release early. */
  readonly payments?: PaymentProvider;
}

export interface SettleResult {
  readonly order: Order;
  readonly claim: Claim | null;
  readonly page: Page | null;
  /** False when the call was an idempotent repeat that changed nothing. */
  readonly changed: boolean;
}

/**
 * Turn a paid order into a claim or a page.
 *
 * Idempotent by contract: settling an order that is already paid by this same
 * `providerRef` succeeds and changes nothing, because webhook delivery is
 * at-least-once. Settling it under a *different* ref throws, because that is
 * not a retry (DECISIONS D17).
 */
export async function settle(
  deps: FulfilmentDeps,
  orderId: string,
  providerRef: string,
): Promise<SettleResult> {
  const now = deps.clock.now();

  return deps.store.transact(async (tx) => {
    const order = await tx.getOrder(orderId);
    if (!order) fail("not_found", "No such order.");

    const decision = decideSettle(order, providerRef);
    if (decision.action === "noop") {
      const claim = order.kind === "blocks" ? await findClaimForOrder(tx, order) : null;
      const page = order.pageId ? ((await tx.getPage(order.pageId)) ?? null) : null;
      return { order, claim, page, changed: false };
    }
    if (decision.action === "reject") {
      switch (decision.reason) {
        case "conflicting-payment":
          fail(
            "conflict",
            "This order was already settled by a different payment.",
            { orderId, providerRef },
          );
          break;
        case "order-expired":
          fail("conflict", "That order expired before it was paid.");
          break;
        case "order-cancelled":
          fail("conflict", "That order was cancelled.");
          break;
      }
    }

    return order.kind === "blocks"
      ? settleBlocks(deps, tx, order, providerRef, now)
      : settlePage(deps, tx, order, providerRef, now);
  });
}

async function settleBlocks(
  deps: FulfilmentDeps,
  tx: Store,
  order: Order,
  providerRef: string,
  now: Date,
): Promise<SettleResult> {
  if (order.payload.kind !== "blocks") {
    fail("internal", "Order kind and payload disagree.");
  }
  const payload = order.payload;

  const page = await tx.getPage(payload.pageId);
  if (!page) fail("not_found", "That page no longer exists.");

  const claim: Claim = {
    id: deps.idGen.next("clm"),
    pageId: page.id,
    ownerId: order.buyerId,
    rect: payload.rect,
    caption: payload.caption,
    colour: payload.colour,
    tile: payload.tile,
    orderId: order.id,
    createdAt: now.toISOString(),
  };

  // The store checks the hold is still ours and unexpired, and that nothing in
  // the rect became owned meanwhile. Both are possible: the hold may have
  // lapsed while the buyer sat on the payment page, and a lapsed hold is
  // exactly what lets a second buyer in.
  const claimed = await tx.claimBlocks(claim, now);
  if (!claimed) {
    fail(
      "unavailable",
      "Those blocks were taken while this payment was in flight. The payment needs refunding.",
      { orderId: order.id },
    );
  }

  const settled = await tx.updateOrderStatus(order.id, "paid", {
    providerRef,
    settledAt: now.toISOString(),
  });
  if (!settled) fail("internal", "Order changed underneath settlement.");

  await tx.appendLedger(
    blockSaleLedger(deps, order, page, now),
  );

  return { order: settled, claim, page, changed: true };
}

async function settlePage(
  deps: FulfilmentDeps,
  tx: Store,
  order: Order,
  providerRef: string,
  now: Date,
): Promise<SettleResult> {
  if (order.payload.kind !== "page") {
    fail("internal", "Order kind and payload disagree.");
  }
  const payload = order.payload;

  // Re-check at settlement, not just at checkout: two people can be paying for
  // the same slug at once and only the first to settle may have it.
  const existing = await tx.getPageBySlug(payload.slug);
  if (existing) {
    fail(
      "conflict",
      "That page name was taken while this payment was in flight. The payment needs refunding.",
      { slug: payload.slug },
    );
  }

  const page: Page = {
    id: deps.idGen.next("pag"),
    slug: payload.slug,
    title: payload.title,
    kind: payload.pageKind,
    size: payload.size,
    ownerId: order.buyerId,
    allowanceTotal: allowanceFor(payload.pageKind),
    allowanceUsed: 0,
    createdAt: now.toISOString(),
  };
  const created = await tx.createPage(page);

  const settled = await tx.updateOrderStatus(order.id, "paid", {
    providerRef,
    settledAt: now.toISOString(),
    pageId: created.id,
  });
  if (!settled) fail("internal", "Order changed underneath settlement.");

  if (order.amountCents > 0) {
    await tx.appendLedger([
      {
        id: deps.idGen.next("led"),
        orderId: order.id,
        pageId: created.id,
        recipientId: null,
        amountCents: order.amountCents,
        kind: "page_sale",
        createdAt: now.toISOString(),
      },
    ]);
  }

  return { order: settled, claim: null, page: created, changed: true };
}

/**
 * The ledger for one block sale.
 *
 * Always two entries when a creator is involved, never one net figure: the
 * creator's credit and the platform's fee are separate facts, and a single
 * combined row would make the fee unauditable after the fact.
 */
function blockSaleLedger(
  deps: FulfilmentDeps,
  order: Order,
  page: Page,
  now: Date,
): LedgerEntry[] {
  if (order.amountCents === 0) return [];

  const split = splitBlockRevenue(
    order.amountCents,
    page.kind,
    page.ownerId !== null,
    deps.platformFeeBps,
  );

  const entries: LedgerEntry[] = [];
  const base = {
    orderId: order.id,
    pageId: page.id,
    createdAt: now.toISOString(),
  };

  if (split.creatorCents > 0) {
    entries.push({
      ...base,
      id: deps.idGen.next("led"),
      recipientId: page.ownerId,
      amountCents: split.creatorCents,
      kind: "block_sale",
    });
  }
  if (split.platformCents > 0) {
    entries.push({
      ...base,
      id: deps.idGen.next("led"),
      recipientId: null,
      amountCents: split.platformCents,
      kind: split.creatorCents > 0 ? "platform_fee" : "block_sale",
    });
  }
  return entries;
}

async function findClaimForOrder(tx: Store, order: Order): Promise<Claim | null> {
  if (!order.pageId) return null;
  const claims = await tx.listClaims(order.pageId);
  return claims.find((c) => c.orderId === order.id) ?? null;
}

/* --------------------------------------------------------------- release -- */

/**
 * Give the blocks back.
 *
 * Correctness does not depend on this being called: a hold that is never
 * released still stops counting the moment it expires, because every read
 * filters on expiry (DECISIONS D9). This is the eager path, driven by
 * `checkout.session.expired` or by a buyer cancelling.
 */
export async function release(
  deps: FulfilmentDeps,
  orderId: string,
  to: "expired" | "cancelled",
): Promise<Order> {
  const now = deps.clock.now();

  const order = await deps.store.transact(async (tx) => {
    const found = await tx.getOrder(orderId);
    if (!found) fail("not_found", "No such order.");

    const decision = decideRelease(found, to);
    if (decision.action === "noop") return found;
    if (decision.action === "reject") {
      fail("conflict", "That order is already paid and cannot be released.");
    }

    await tx.releaseHold(found.id);
    const updated = await tx.updateOrderStatus(found.id, to, {
      settledAt: now.toISOString(),
    });
    return updated ?? found;
  });

  // Best effort, outside the transaction: the provider may already have
  // expired the session itself, and a network failure here must not roll back
  // a release we have already committed.
  if (order.providerRef && deps.payments) {
    try {
      await deps.payments.expire(order.providerRef);
    } catch {
      // Contractually best-effort. The provider expires it on its own schedule.
    }
  }

  return order;
}
