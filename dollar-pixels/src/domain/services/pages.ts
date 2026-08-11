/**
 * Creating pages, and reading them back as grid snapshots.
 *
 * A page is bought like anything else: an order, then settlement. The slug is
 * checked here at checkout time and again at settlement time, because two
 * people can be paying for the same name at once and only the first to settle
 * can have it.
 */

import type { Order, Page, PageKind, User } from "@/domain/entities";
import {
  gridForSize,
  isPageSize,
  totalBlocks,
  type PageSize,
} from "@/domain/geometry";
import { pagePrice } from "@/domain/pricing";
import { holdExpiryFrom, isExpiredAt } from "@/domain/order";
import { isValidSlug, slugErrorMessage, validateSlug } from "@/domain/slug";
import type { GridSnapshot, SnapshotClaim, SnapshotHold } from "@/domain/snapshot";
import type { CheckoutHandle, Clock, IdGen, PaymentProvider, Store } from "@/ports";
import { fail } from "./errors";

export interface PageDeps {
  readonly store: Store;
  readonly clock: Clock;
  readonly idGen: IdGen;
  readonly payments: PaymentProvider;
  readonly origin: string;
}

export const FLAGSHIP_SLUG = "the-wall";

export interface CreatePageInput {
  readonly slug: string;
  readonly title: string;
  readonly kind: Exclude<PageKind, "flagship">;
  readonly size: PageSize;
  readonly ownerId: string;
}

export interface CreatePageResult {
  readonly order: Order;
  readonly checkout: CheckoutHandle;
}

export async function createPageOrder(
  deps: PageDeps,
  input: CreatePageInput,
): Promise<CreatePageResult> {
  const now = deps.clock.now();

  const slugError = validateSlug(input.slug);
  if (slugError) fail("invalid", slugErrorMessage(slugError));
  if (!isPageSize(input.size)) fail("invalid", "Pick a page size.");

  const title = input.title.replace(/\s+/g, " ").trim();
  if (title.length < 1 || title.length > 60) {
    fail("invalid", "Give the page a title of 60 characters or fewer.");
  }

  const taken = await deps.store.getPageBySlug(input.slug);
  if (taken) fail("conflict", "That page name is already taken.");

  const amountCents = pagePrice(input.kind, input.size);
  const orderId = deps.idGen.next("ord");
  const expiresAt = holdExpiryFrom(now);

  const order = await deps.store.createOrder({
    id: orderId,
    kind: "page",
    pageId: null,
    buyerId: input.ownerId,
    amountCents,
    status: "pending",
    provider: deps.payments.id,
    providerRef: null,
    payload: {
      kind: "page",
      slug: input.slug,
      title,
      pageKind: input.kind,
      size: input.size,
    },
    createdAt: now.toISOString(),
    settledAt: null,
  });

  const blocks = totalBlocks(gridForSize(input.size));
  const checkout = await deps.payments.createCheckout({
    orderId: order.id,
    amountCents,
    lines: [
      {
        label:
          input.kind === "private"
            ? `Unlisted page "${title}"`
            : `Premium page "${title}" — ${blocks.toLocaleString("en-US")} blocks at half price`,
        amountCents,
        quantity: 1,
      },
    ],
    description: `${input.kind} page /${input.slug}`,
    returnUrl: `${deps.origin}/checkout/return?order=${order.id}`,
    cancelUrl: `${deps.origin}/new?cancelled=${order.id}`,
    expiresAt,
  });

  const withRef = await deps.store.setOrderProviderRef(order.id, checkout.ref);
  return { order: withRef ?? order, checkout };
}

/** Is this slug free and legal? Drives the live check on the create form. */
export async function checkSlug(
  store: Store,
  slug: string,
): Promise<{ available: boolean; reason: string | null }> {
  const error = validateSlug(slug);
  if (error) return { available: false, reason: slugErrorMessage(error) };
  const taken = await store.getPageBySlug(slug);
  return taken
    ? { available: false, reason: "That page name is already taken." }
    : { available: true, reason: null };
}

/* -------------------------------------------------------------- snapshot -- */

/**
 * The grid, as the renderer wants it.
 *
 * Claims rather than blocks (DECISIONS D15), and holds stripped of any
 * identity — that someone is mid-purchase is worth showing, who they are is
 * not. Expired holds are filtered here rather than deleted, which is the same
 * read-time rule the store uses (DECISIONS D9).
 */
export async function gridSnapshot(
  deps: { store: Store; clock: Clock },
  slug: string,
): Promise<GridSnapshot> {
  const page = await deps.store.getPageBySlug(slug);
  if (!page) fail("not_found", "No such page.");

  const now = deps.clock.now();
  const dims = gridForSize(page.size);
  const claims = await deps.store.listClaims(page.id);

  const owners = new Map<string, User | undefined>();
  for (const claim of claims) {
    if (!owners.has(claim.ownerId)) {
      owners.set(claim.ownerId, await deps.store.getUser(claim.ownerId));
    }
  }

  const snapshotClaims: SnapshotClaim[] = claims.map((claim) => ({
    id: claim.id,
    rect: claim.rect,
    caption: claim.caption,
    colour: claim.colour,
    tile: claim.tile,
    ownerName: owners.get(claim.ownerId)?.displayName ?? "someone",
    createdAt: claim.createdAt,
  }));

  const holds: SnapshotHold[] = (await deps.store.listHolds(page.id))
    .filter((hold) => !isExpiredAt(hold.expiresAt, now))
    .map((hold) => ({ rect: hold.rect, expiresAt: hold.expiresAt }));

  const soldBlocks = await deps.store.countOwnedBlocks(page.id);

  return {
    slug: page.slug,
    title: page.title,
    kind: page.kind,
    size: page.size,
    wBlocks: dims.wBlocks,
    hBlocks: dims.hBlocks,
    totalBlocks: totalBlocks(dims),
    soldBlocks,
    claims: snapshotClaims,
    holds,
    takenAt: now.toISOString(),
  };
}

/* ---------------------------------------------------------------- guards -- */

export function assertNotFlagship(page: Page): void {
  if (page.kind === "flagship") {
    fail("forbidden", "The wall is not editable.");
  }
}

export function isListed(page: Page): boolean {
  return page.kind !== "private";
}

export { isValidSlug };
