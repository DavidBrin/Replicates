"use client";

/**
 * The pitch, in as few words as it takes.
 *
 * A client component because the live counters come from `api.page`, which is
 * the browser's side of the envelope and cannot run on the server. Everything
 * above the counters is static, so the page reads correctly before they arrive
 * rather than showing a spinner where the idea should be.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { PAGE_SIZES, gridForSize, totalBlocks, type PageSize } from "@/domain/geometry";
import { formatCount, formatUsdCompact } from "@/domain/money";
import { PRIVATE_PAGE_PRICE_CENTS, premiumPagePrice } from "@/domain/pricing";
import { api, type PageMeta } from "@/lib/api-client";
import { Panel, Stat } from "@/components/ui";

const WALL = "the-wall";

export default function Landing() {
  const [wall, setWall] = useState<PageMeta | null>(null);

  useEffect(() => {
    void api
      .page(WALL)
      .then(setWall)
      // A landing page that renders an error because a counter failed is worse
      // than one that renders without the counter.
      .catch(() => setWall(null));
  }, []);

  const smallest: PageSize = "small";

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">A dollar buys nine pixels.</h1>
        <p className="max-w-2xl text-base">
          One grid, sold by the block. A block is three pixels by three pixels — nine
          pixels — and it costs $1. Buy as many as you like in one rectangle, give them a
          caption, and fill them with a colour or an image. What you buy stays bought.
        </p>
        <p className="max-w-2xl text-sm text-(--ink-2)">
          It is a 2026 rebuild of the 2005 Million Dollar Homepage, written from research.
          The wall is 400 × 400 blocks — 1,200 × 1,200 pixels, $160,000 at face value.
        </p>
      </section>

      <Panel title="The wall">
        <div className="flex flex-col gap-3">
          <dl className="flex flex-wrap gap-6">
            <Stat
              label="Blocks sold"
              value={wall ? formatCount(wall.soldBlocks) : "—"}
              tone="sold"
            />
            <Stat
              label="Available"
              value={wall ? formatCount(wall.availableBlocks) : "—"}
              tone="open"
            />
            <Stat
              label="Pixels on the wall"
              value={wall ? formatCount(wall.totalBlocks * 9) : "1,440,000"}
            />
          </dl>
          <p className="text-sm">
            <Link href={`/p/${WALL}`}>Go to the wall</Link> and drag a rectangle to pick
            your blocks.
          </p>
        </div>
      </Panel>

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">What a block is</h2>
        <p className="max-w-2xl text-sm">
          Nine pixels in a 3 × 3 square, and the smallest thing anyone can own here.
          Selections snap to whole blocks, so a block is never split between two owners
          and an image is never half yours. Artwork is redrawn to exactly the pixel size
          you paid for before it is sent, which is why every tile fits.
        </p>
        <p className="max-w-2xl text-sm text-(--ink-2)">
          Blocks carry a caption and artwork. They do not carry a link — nothing on this
          site navigates anywhere else, which is the one part of the original we
          deliberately did not rebuild.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Make your own page</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Panel title="Unlisted page">
            <div className="flex flex-col gap-2 text-sm">
              <p className="tnum text-2xl font-bold">
                {formatUsdCompact(PRIVATE_PAGE_PRICE_CENTS)}
              </p>
              <p>
                A grid of your own at any size, kept out of the directory and shared by
                its link. You get 69 free blocks on it to start with.
              </p>
              <p className="text-(--ink-2)">
                Unlisted, not locked: anyone holding the link can see it. Blocks other
                people buy on it pay the platform.
              </p>
            </div>
          </Panel>

          <Panel title="Premium page">
            <div className="flex flex-col gap-2 text-sm">
              <p className="tnum text-2xl font-bold">
                from {formatUsdCompact(premiumPagePrice(smallest))}
              </p>
              <p>
                The whole grid at half its face value —{" "}
                {formatCount(totalBlocks(gridForSize(smallest)))} blocks for the{" "}
                {PAGE_SIZES[smallest]} × {PAGE_SIZES[smallest]} size, up to{" "}
                {formatUsdCompact(premiumPagePrice("full"))} for the largest. It is listed
                in the directory.
              </p>
              <p className="text-(--ink-2)">
                Every block anyone buys on it pays you. It pays for itself at half sold.
              </p>
            </div>
          </Panel>
        </div>
        <p className="text-sm">
          <Link href="/new">Make a page</Link> · <Link href="/pages">Browse the pages</Link>{" "}
          · <Link href="/dashboard">Your dashboard</Link>
        </p>
      </section>
    </div>
  );
}
