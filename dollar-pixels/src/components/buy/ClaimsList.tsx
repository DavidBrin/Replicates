"use client";

/**
 * The canvas, as a table.
 *
 * A canvas is a black box to a screen reader, so every page carries the same
 * information in a form that is readable and keyboard-navigable (DECISIONS
 * D16). This is the *reading* half; the buying half is the coordinate form in
 * `BuyPanel`, because what a claims list cannot give you is a way to choose
 * blocks nobody has bought yet.
 *
 * Rows are paged rather than all rendered: a well-sold page has thousands of
 * claims, and a table of thousands of rows is slow to render and worse to
 * navigate one row at a time.
 */

import { useState } from "react";
import { blocksIn, type BlockRect } from "@/domain/geometry";
import { formatCount, formatUsdCompact } from "@/domain/money";
import { rectPrice } from "@/domain/pricing";
import type { SnapshotClaim } from "@/domain/snapshot";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 100;

export interface ClaimsListProps {
  readonly claims: readonly SnapshotClaim[];
  /** Row activation — the page shows the claim's detail card. */
  readonly onActivate?: (claim: SnapshotClaim) => void;
  readonly activeId?: string | null;
  readonly className?: string;
}

function describeRect(rect: BlockRect): string {
  return `${rect.bw} × ${rect.bh} at ${rect.bx}, ${rect.by}`;
}

export function ClaimsList({ claims, onActivate, activeId, className }: ClaimsListProps) {
  const [shown, setShown] = useState(PAGE_SIZE);

  // Newest first, and the store hands them over oldest first.
  //
  // With the wall seeded to a few hundred claims and the list capped at 100, an
  // oldest-first order buries a purchase the moment it settles: the buyer comes
  // back from checkout, looks for what they just bought, and it is on a page of
  // the list they have to ask for. The most recent claim is the one somebody is
  // most likely to be looking for.
  const ordered = [...claims].reverse();
  const visible = ordered.slice(0, shown);

  if (claims.length === 0) {
    return (
      <p className={cn("text-sm text-(--ink-2)", className)}>
        Nothing has been bought on this page yet. Every block is available.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="pb-2 text-left text-xs text-(--ink-2)">
            Every claim on this page, most recent first. The same
            information the grid shows, without needing to see it.
          </caption>
          <thead>
            <tr className="border-b border-(--rule) text-left">
              <th scope="col" className="py-1 pr-3">
                Caption
              </th>
              <th scope="col" className="py-1 pr-3">
                Bought by
              </th>
              <th scope="col" className="py-1 pr-3">
                Blocks
              </th>
              <th scope="col" className="py-1 pr-3">
                Position
              </th>
              <th scope="col" className="py-1">
                Paid
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((claim) => (
              <tr
                key={claim.id}
                aria-current={claim.id === activeId ? "true" : undefined}
                className={cn(
                  "border-b border-(--rule)/30",
                  claim.id === activeId && "bg-(--panel-2)",
                )}
              >
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  <span
                    aria-hidden="true"
                    style={{ background: claim.colour }}
                    className="mr-1.5 inline-block size-3 border border-(--rule) align-middle"
                  />
                  {onActivate ? (
                    <button
                      type="button"
                      onClick={() => onActivate(claim)}
                      className="text-(--link) underline"
                    >
                      {claim.caption}
                    </button>
                  ) : (
                    claim.caption
                  )}
                </th>
                <td className="py-1 pr-3">{claim.ownerName}</td>
                <td className="tnum py-1 pr-3">{formatCount(blocksIn(claim.rect))}</td>
                <td className="tnum py-1 pr-3">{describeRect(claim.rect)}</td>
                <td className="tnum py-1">{formatUsdCompact(rectPrice(claim.rect))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p role="status" className="tnum text-xs text-(--ink-2)">
        Showing {formatCount(visible.length)} of {formatCount(claims.length)} claims.
      </p>

      {shown < claims.length ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
          >
            Show {formatCount(Math.min(PAGE_SIZE, claims.length - shown))} more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
