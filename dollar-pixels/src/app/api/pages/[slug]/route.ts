import { AppError } from "@/domain/services/errors";
import { gridForSize, totalBlocks } from "@/domain/geometry";
import { getActor, getContainer } from "@/lib/container";
import { handler, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Page metadata and counts. Public for every kind — unlisted is not private. */
export const GET = handler(
  async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const c = await getContainer();

    const page = await c.store.getPageBySlug(slug);
    if (!page) throw new AppError("not_found", "No such page.");

    const dims = gridForSize(page.size);
    const total = totalBlocks(dims);
    const sold = await c.store.countOwnedBlocks(page.id);
    const owner = page.ownerId ? await c.store.getUser(page.ownerId) : undefined;

    const actor = await getActor();
    const isOwner = actor.kind === "user" && actor.user.id === page.ownerId;

    return ok({
      slug: page.slug,
      title: page.title,
      kind: page.kind,
      size: page.size,
      wBlocks: dims.wBlocks,
      hBlocks: dims.hBlocks,
      totalBlocks: total,
      soldBlocks: sold,
      availableBlocks: total - sold,
      ownerName: owner?.displayName ?? null,
      createdAt: page.createdAt,
      // Only the owner is told about the allowance — it is not a fact about
      // the page so much as a fact about their account on it.
      allowance: isOwner
        ? { total: page.allowanceTotal, used: page.allowanceUsed }
        : null,
      isOwner,
    });
  },
);
