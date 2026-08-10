import type { Outcome } from "@/domain/entities";
import { Pill } from "@/components/ui/Pill";
import { ShowcaseButton } from "./ShowcaseButton";

export interface HeadToHeadCardProps {
  outcomes: readonly Outcome[];
  prices: Record<string, number>;
}

/** Card variant (c) — SPEC §7.3: "head-to-head sports with two team buttons
 * and scores" (research/polymarket.md §2.3's `team-N-logo`/`team-N-name`
 * grid areas, reskinned trading-button-per-team). This domain model has no
 * live score/period field (SPEC §4 defines none), so rather than fabricate
 * a fake score this shows what the data actually supports: each team's
 * colored initial badge (`Outcome.color`, seeded per market — not a design
 * token, applied via inline style like `Avatar` does), name, live
 * probability, and a full-width team-colored action button per side.
 * Server-renderable. */
export function HeadToHeadCard({ outcomes, prices }: HeadToHeadCardProps) {
  return (
    <div className="flex flex-col gap-2">
      {outcomes.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-(--surface-0)"
              style={{ backgroundColor: o.color }}
              aria-hidden="true"
            >
              {o.label.charAt(0)}
            </span>
            <span className="truncate text-sm text-(--text-1)">{o.label}</span>
          </div>
          <Pill value={prices[o.id] ?? 0} />
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2">
        {outcomes.map((o) => (
          <ShowcaseButton key={o.id} tone="team" teamColor={o.color} label={o.label} className="flex-1" />
        ))}
      </div>
    </div>
  );
}
