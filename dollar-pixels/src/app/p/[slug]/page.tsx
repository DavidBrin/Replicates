import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { gridForSize, totalBlocks } from "@/domain/geometry";
import { formatCount } from "@/domain/money";
import { getContainer } from "@/lib/container";
import { PageClient, type InitialPage } from "./PageClient";

/**
 * The server half of a page: metadata, and enough of the header to render
 * before any JavaScript runs.
 *
 * It reads the store through the composition root rather than fetching its own
 * API, because a server component calling back into the same deployment over
 * HTTP is a round trip that buys nothing and breaks on any origin the request
 * headers do not already agree about. The grid itself is loaded by the client,
 * where the refetch-on-focus lives.
 */

export const dynamic = "force-dynamic";

/** Deduped per request, so metadata and the page body cost one read between them. */
const load = cache(async (slug: string): Promise<InitialPage | null> => {
  const c = await getContainer();
  const page = await c.store.getPageBySlug(slug);
  if (!page) return null;

  const dims = gridForSize(page.size);
  const owner = page.ownerId ? await c.store.getUser(page.ownerId) : undefined;

  return {
    slug: page.slug,
    title: page.title,
    kind: page.kind,
    wBlocks: dims.wBlocks,
    hBlocks: dims.hBlocks,
    totalBlocks: totalBlocks(dims),
    soldBlocks: await c.store.countOwnedBlocks(page.id),
    ownerName: owner?.displayName ?? null,
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) return { title: "No such page — Dollar Pixels" };

  const available = page.totalBlocks - page.soldBlocks;
  return {
    title: `${page.title} — Dollar Pixels`,
    description: `${formatCount(page.soldBlocks)} of ${formatCount(page.totalBlocks)} blocks sold, ${formatCount(available)} still available at $1 for nine pixels.`,
    // An unlisted page is world-readable but should not be indexed: keeping it
    // out of the directory means nothing if a crawler puts it in a search
    // result (DECISIONS D4).
    robots: page.kind === "private" ? { index: false, follow: false } : undefined,
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) notFound();

  return <PageClient initial={page} />;
}
