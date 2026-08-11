import { getContainer, requireUser } from "@/lib/container";
import { handler, ok } from "@/lib/http";

/**
 * Your pages, your claims, and what you are owed.
 *
 * The balance is what the ledger says, not what has been paid out — nothing
 * pays anyone yet. `README.md` and DECISIONS D12 say so plainly, and so does
 * the screen this feeds.
 */
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = await requireUser();
  const c = await getContainer();

  const [pages, claims, ledger, balanceCents, orders] = await Promise.all([
    c.store.listPagesByOwner(user.id),
    c.store.listClaimsByOwner(user.id),
    c.store.listLedgerFor(user.id),
    c.store.balanceFor(user.id),
    c.store.listOrdersByBuyer(user.id),
  ]);

  const pageRows = await Promise.all(
    pages.map(async (page) => ({
      slug: page.slug,
      title: page.title,
      kind: page.kind,
      size: page.size,
      soldBlocks: await c.store.countOwnedBlocks(page.id),
      allowanceTotal: page.allowanceTotal,
      allowanceUsed: page.allowanceUsed,
    })),
  );

  // The page a claim sits on is what makes it findable again, so resolve the
  // slug rather than handing the client an opaque page id.
  const slugs = new Map<string, string>();
  for (const claim of claims) {
    if (!slugs.has(claim.pageId)) {
      const page = await c.store.getPage(claim.pageId);
      if (page) slugs.set(claim.pageId, page.slug);
    }
  }

  return ok({
    user,
    pages: pageRows,
    claims: claims.map((claim) => ({
      id: claim.id,
      pageSlug: slugs.get(claim.pageId) ?? null,
      rect: claim.rect,
      caption: claim.caption,
      colour: claim.colour,
      createdAt: claim.createdAt,
    })),
    earnings: {
      balanceCents,
      entries: ledger.map((entry) => ({
        id: entry.id,
        amountCents: entry.amountCents,
        kind: entry.kind,
        createdAt: entry.createdAt,
      })),
    },
    orders: orders.map((order) => ({
      id: order.id,
      kind: order.kind,
      status: order.status,
      amountCents: order.amountCents,
      createdAt: order.createdAt,
    })),
  });
});
