import { cn } from "@/lib/cn";

export interface PlayMoneyBannerProps {
  /** True only when the active payment provider really charges cards. */
  live: boolean;
  className?: string;
}

/**
 * The strip that stops someone believing they spent money.
 *
 * Loud on purpose. The mock provider's checkout looks and behaves exactly like
 * the real one — that is the point of it settling through the same fulfilment
 * path (DECISIONS D10) — so nothing inside the buying flow itself distinguishes
 * fake money from real. This banner is the distinction, and it sits above the
 * masthead on every screen rather than being a line of small print on the
 * checkout page someone can scroll past.
 *
 * Renders nothing when the provider is live: a "no card is charged" notice on
 * a deployment that does charge cards would be worse than no notice at all.
 */
export function PlayMoneyBanner({ live, className }: PlayMoneyBannerProps) {
  if (live) return null;

  return (
    <aside
      aria-label="Play money notice"
      className={cn(
        "border-b-2 border-(--rule) bg-(--open) px-4 py-2 text-center text-sm text-(--panel-2)",
        className,
      )}
    >
      <strong className="tracking-wide uppercase">Play money</strong>{" "}
      <span>
        — no card is charged and no payment details are collected. Every purchase here is
        fake, settles instantly, and buys nothing real.
      </span>
    </aside>
  );
}
