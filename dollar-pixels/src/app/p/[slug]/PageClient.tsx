"use client";

/**
 * A page: the grid, what it costs, who owns what, and the way in.
 *
 * The snapshot is refetched after anything that changes it and when the tab
 * regains focus, which is the whole of the freshness strategy — a canvas of
 * 160,000 blocks does not need a socket per viewer to stay honest about what
 * is sold (SPEC §13).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { blocksIn, rectPixelSize, type BlockRect, type GridDims } from "@/domain/geometry";
import { formatCount, formatUsdCompact } from "@/domain/money";
import { rectPrice } from "@/domain/pricing";
import type { PageKind, User } from "@/domain/entities";
import type { GridSnapshot, SnapshotClaim } from "@/domain/snapshot";
import { api, type PageMeta } from "@/lib/api-client";
import { Badge, Button, Callout, Panel, Spinner, Stat } from "@/components/ui";
import { PixelGrid } from "@/components/grid";
import { BuyPanel, ClaimsList, SignInBar } from "@/components/buy";

export interface InitialPage {
  readonly slug: string;
  readonly title: string;
  readonly kind: PageKind;
  readonly wBlocks: number;
  readonly hBlocks: number;
  readonly totalBlocks: number;
  readonly soldBlocks: number;
  readonly ownerName: string | null;
}

export function PageClient({ initial }: { initial: InitialPage }) {
  const slug = initial.slug;

  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [snapshot, setSnapshot] = useState<GridSnapshot | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [selection, setSelection] = useState<BlockRect | null>(null);
  const [active, setActive] = useState<SnapshotClaim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Refetching is a counter, not a function call: everything that invalidates
  // the grid — a free claim, the tab regaining focus — bumps it, and the one
  // effect below is the only place that knows how to load.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    let live = true;
    void Promise.all([api.page(slug), api.grid(slug)])
      .then(([nextMeta, nextSnapshot]) => {
        if (!live) return;
        setMeta(nextMeta);
        setSnapshot(nextSnapshot);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Could not load this page.");
      });
    return () => {
      live = false;
    };
  }, [slug, reloadKey]);

  useEffect(() => {
    let live = true;
    void api
      .me()
      .then((me) => {
        if (live) setUser(me.user);
      })
      .catch(() => {
        if (live) setUser(null);
      });
    return () => {
      live = false;
    };
  }, []);

  // Someone else's purchase settles while this tab sits in the background;
  // coming back to it should not show a grid that is minutes out of date.
  useEffect(() => {
    const onFocus = () => setReloadKey((key) => key + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const sold = snapshot?.soldBlocks ?? initial.soldBlocks;
  const total = snapshot?.totalBlocks ?? initial.totalBlocks;
  const kind = snapshot?.kind ?? initial.kind;
  const title = snapshot?.title ?? initial.title;
  const ownerName = meta?.ownerName ?? initial.ownerName;
  const dims: GridDims = {
    wBlocks: snapshot?.wBlocks ?? initial.wBlocks,
    hBlocks: snapshot?.hBlocks ?? initial.hBlocks,
  };

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Clipboard access is refused often enough — over http, in a locked-down
      // browser — that failing silently would look like a broken button.
      setCopied(false);
      setError("Copying was blocked. The link is in the address bar.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{title}</h1>
          <Badge tone={kind === "premium" ? "premium" : kind === "private" ? "private" : "neutral"}>
            {kind === "flagship" ? "the wall" : kind}
          </Badge>
          {ownerName ? (
            <span className="text-sm text-(--ink-2)">made by {ownerName}</span>
          ) : null}
        </div>

        <dl className="flex flex-wrap gap-6 border border-(--rule) bg-(--panel) px-3 py-2">
          <Stat label="Blocks sold" value={formatCount(sold)} tone="sold" />
          <Stat label="Available" value={formatCount(Math.max(0, total - sold))} tone="open" />
          <Stat label="Grid" value={`${formatCount(dims.wBlocks)} × ${formatCount(dims.hBlocks)}`} />
          <Stat label="Face value" value={formatUsdCompact(total * 100)} tone="money" />
        </dl>

        {kind === "premium" ? (
          <Callout>
            This is a premium page: every block bought here pays{" "}
            {ownerName ?? "its creator"}, not the platform. They bought the grid at half
            its face value and earn a dollar of every block sold on it.
          </Callout>
        ) : null}

        {kind === "private" ? (
          <Callout tone="warn">
            <strong>Unlisted — anyone with the link can see this.</strong> It is kept out
            of the directory and nothing more: there is no password, no invitation and no
            member list, so treat the link as the whole of the privacy.{" "}
            <Button size="sm" variant="secondary" onClick={() => void copyLink()}>
              {copied ? "Link copied" : "Copy link"}
            </Button>
          </Callout>
        ) : null}
      </header>

      {error ? <Callout tone="danger">{error}</Callout> : null}

      {/*
        The panel sits BELOW the grid, not beside it.

        A 384px sidebar left the grid roughly 808px of a 1240px column, so the
        1200px canvas was permanently downscaled and a block never occupied its
        three real pixels — which is the entire justification for the grid being
        1200 wide (DECISIONS D1). Stacking is the only arrangement in which the
        headline claim is actually true on a normal desktop. Side by side
        returns at 2xl, where there is genuinely room for both.
      */}
      <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
        <div className="min-w-0 flex-1">
          {snapshot ? (
            <PixelGrid
              snapshot={snapshot}
              selection={selection}
              onSelectionChange={setSelection}
              onClaimActivate={setActive}
            />
          ) : (
            <p className="flex items-center gap-2 text-sm text-(--ink-2)">
              <Spinner label="Loading the grid" /> Loading the grid…
            </p>
          )}
        </div>

        <div className="flex w-full flex-col gap-3 2xl:w-96 2xl:shrink-0">
          <SignInBar user={user} onChange={setUser} />
          <BuyPanel
            slug={slug}
            dims={dims}
            selection={selection}
            onSelectionChange={setSelection}
            user={user}
            isOwner={meta?.isOwner ?? false}
            allowance={meta?.allowance ?? null}
            onClaimed={reload}
          />
          {active ? <ClaimCard claim={active} onClose={() => setActive(null)} /> : null}
        </div>
      </div>

      <Panel title="Claims on this page">
        <ClaimsList
          claims={snapshot?.claims ?? []}
          onActivate={setActive}
          activeId={active?.id ?? null}
        />
      </Panel>

      <p className="text-sm">
        <Link href="/pages">Every listed page</Link> · <Link href="/new">Make your own</Link>
      </p>
    </div>
  );
}

/** What a click on someone's blocks gets you. Notably, not a link (DECISIONS D6). */
function ClaimCard({ claim, onClose }: { claim: SnapshotClaim; onClose: () => void }) {
  const { width, height } = rectPixelSize(claim.rect);
  return (
    <Panel title="Claim">
      <div className="flex flex-col gap-2">
        <p className="text-base font-bold">{claim.caption}</p>
        <p className="text-sm text-(--ink-2)">Bought by {claim.ownerName}</p>
        <p className="tnum text-sm text-(--ink-2)">
          {formatCount(blocksIn(claim.rect))} blocks ({width} × {height} pixels) at{" "}
          {claim.rect.bx}, {claim.rect.by} — {formatUsdCompact(rectPrice(claim.rect))}
        </p>
        {claim.tile ? (
          // A data URL a few hundred bytes long; the image optimiser has
          // nothing to do here, and its loader cannot take one anyway.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={claim.tile}
            alt={`Artwork for ${claim.caption}`}
            width={width * 4}
            height={height * 4}
            style={{ imageRendering: "pixelated" }}
            className="border border-(--rule)"
          />
        ) : (
          <span
            aria-hidden="true"
            style={{ background: claim.colour }}
            className="block size-10 border border-(--rule)"
          />
        )}
        <p className="text-xs text-(--ink-3)">
          Claims carry a caption and artwork and nothing else — no link, nowhere to click
          through to.
        </p>
        <div>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Panel>
  );
}
