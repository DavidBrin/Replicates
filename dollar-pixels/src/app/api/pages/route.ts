import { AppError } from "@/domain/services/errors";
import { createPageOrder } from "@/domain/services/pages";
import { getContainer, requireUser } from "@/lib/container";
import { handler, ok, originOf, readJson } from "@/lib/http";
import { createPageSchema, firstIssue } from "@/lib/schemas";
import { isPageSize } from "@/domain/geometry";
import { pagePrice } from "@/domain/pricing";

/** The directory. Unlisted pages are absent by construction (DECISIONS D4). */
export const GET = handler(async () => {
  const c = await getContainer();
  const pages = await c.store.listPages({ listedOnly: true });

  const rows = await Promise.all(
    pages.map(async (page) => ({
      slug: page.slug,
      title: page.title,
      kind: page.kind,
      size: page.size,
      createdAt: page.createdAt,
      soldBlocks: await c.store.countOwnedBlocks(page.id),
      ownerName: page.ownerId
        ? ((await c.store.getUser(page.ownerId))?.displayName ?? null)
        : null,
    })),
  );

  return ok({ pages: rows });
});

export const POST = handler(async (req: Request) => {
  const parsed = createPageSchema.safeParse(await readJson(req));
  if (!parsed.success) throw new AppError("invalid", firstIssue(parsed.error));

  const { slug, title, kind, size } = parsed.data;
  if (!isPageSize(size)) throw new AppError("invalid", "Pick a page size.");

  const user = await requireUser();
  const c = await getContainer();

  const { order, checkout } = await createPageOrder(
    { ...c, origin: originOf(req) },
    { slug, title, kind, size, ownerId: user.id },
  );

  return ok({
    orderId: order.id,
    amountCents: order.amountCents,
    // Echoed so the client can show what it is about to be charged without
    // recomputing it — but note the charge itself came from the server.
    quotedCents: pagePrice(kind, size),
    redirectUrl: checkout.redirectUrl,
  });
});
