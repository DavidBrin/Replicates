import Link from "next/link";
import { formatCount } from "@/domain/money";
import { cn } from "@/lib/cn";

export interface SiteHeaderProps {
  /** Blocks sold. Rendered with `total`, or not at all. */
  sold?: number;
  /** Blocks on the grid. */
  total?: number;
  className?: string;
}

/**
 * The masthead: wordmark, tagline, and the sold/available stat box pinned to
 * the right — the 2005 furniture, redrawn (research/original-site.md §2).
 *
 * The stat box needs both figures because "available" is derived, and a box
 * showing one number and a blank is worse furniture than no box. Counts are in
 * *blocks*, the only unit the product addresses the grid in (DECISIONS D2).
 */
export function SiteHeader({ sold, total, className }: SiteHeaderProps) {
  const showStats = typeof sold === "number" && typeof total === "number";
  const available = showStats ? Math.max(0, total - sold) : 0;

  return (
    <header className={cn("border-b border-(--rule) bg-(--chrome)", className)}>
      <div className="mx-auto flex w-full max-w-(--layout-max) flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <Link
          href="/"
          className="text-xl leading-none font-bold tracking-widest text-(--panel-2) uppercase no-underline hover:no-underline"
        >
          Dollar Pixels
        </Link>

        <p className="text-sm text-(--panel)">$1 buys nine pixels</p>

        {showStats ? (
          <dl className="ml-auto flex items-center gap-4 border border-(--rule) bg-(--ink) px-3 py-1.5">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[11px] tracking-wide text-(--ink-3) uppercase">Sold</dt>
              <dd data-tone="sold" className="tnum text-sm font-bold text-(--sold)">
                {formatCount(sold)}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[11px] tracking-wide text-(--ink-3) uppercase">
                Available
              </dt>
              <dd data-tone="open" className="tnum text-sm font-bold text-(--open)">
                {formatCount(available)}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </header>
  );
}
