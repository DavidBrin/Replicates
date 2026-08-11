import type { Metadata } from "next";
import Link from "next/link";

import { gridForSize, totalBlocks } from "@/domain/geometry";
import { formatCount, formatUsdCompact } from "@/domain/money";
import { getContainer } from "@/lib/container";
import { Badge, Panel } from "@/components/ui";

/**
 * The directory.
 *
 * Server-rendered from the store for the same reason the page shell is: this
 * list has no interaction in it, and asking the browser to fetch a list that
 * the server already has produces a flash of nothing for no gain. Unlisted
 * pages are absent because the store never returns them here, not because this
 * file filters them out (DECISIONS D4).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pages — Dollar Pixels",
  description: "Every listed grid: the wall and every premium page, with what is sold.",
};

export default async function Directory() {
  const c = await getContainer();
  const pages = await c.store.listPages({ listedOnly: true });

  const rows = await Promise.all(
    pages.map(async (page) => {
      const dims = gridForSize(page.size);
      return {
        slug: page.slug,
        title: page.title,
        kind: page.kind,
        size: page.size,
        blocks: totalBlocks(dims),
        sold: await c.store.countOwnedBlocks(page.id),
        ownerName: page.ownerId
          ? ((await c.store.getUser(page.ownerId))?.displayName ?? null)
          : null,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Pages</h1>
        <p className="max-w-2xl text-sm text-(--ink-2)">
          The wall and every premium page. Unlisted pages are not here — they are shared
          by their link, and anyone holding one can see the page just the same.
        </p>
      </header>

      <Panel>
        {rows.length === 0 ? (
          <p className="text-sm text-(--ink-2)">
            Nothing is listed yet. <Link href="/new">Make the first one.</Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <caption className="pb-2 text-left text-xs text-(--ink-2)">
                Listed pages, with how much of each has sold.
              </caption>
              <thead>
                <tr className="border-b border-(--rule) text-left">
                  <th scope="col" className="py-1 pr-3">
                    Page
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Kind
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Made by
                  </th>
                  <th scope="col" className="py-1 pr-3">
                    Sold
                  </th>
                  <th scope="col" className="py-1">
                    Face value
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.slug} className="border-b border-(--rule)/30">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      <Link href={`/p/${row.slug}`}>{row.title}</Link>{" "}
                      <span className="text-(--ink-3)">/p/{row.slug}</span>
                    </th>
                    <td className="py-1.5 pr-3">
                      <Badge tone={row.kind === "premium" ? "premium" : "neutral"}>
                        {row.kind === "flagship" ? "the wall" : row.kind}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3">{row.ownerName ?? "the platform"}</td>
                    <td className="tnum py-1.5 pr-3">
                      {formatCount(row.sold)} of {formatCount(row.blocks)}
                    </td>
                    <td className="tnum py-1.5">{formatUsdCompact(row.blocks * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-sm">
        <Link href="/new">Make a page</Link> of your own — unlisted for $10, or premium
        with the block revenue coming to you.
      </p>
    </div>
  );
}
