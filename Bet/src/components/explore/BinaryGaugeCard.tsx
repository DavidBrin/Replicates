import { CircularGauge } from "./CircularGauge";
import { ShowcaseButton } from "./ShowcaseButton";

export interface BinaryGaugeCardProps {
  /** Yes-outcome probability, 0..1. */
  yesProbability: number;
}

/** Card variant (b) — SPEC §7.3: Polymarket's signature circular percentage
 * gauge ("21% chance"), the number drawn inside the ring by `CircularGauge`
 * itself, "chance" set beneath per this task's brief. Deliberately dense —
 * `size=72`, minimal internal gaps, `size="sm"` buttons (matching the other
 * two variants' default button size) — to land near the 136-184px reference
 * card heights (research/design-tokens-extracted.md) instead of the ~230px+
 * this ran at with `py-1`, `gap-3` and `size="md"` buttons (Task 13 fix
 * round 1). Server-renderable. */
export function BinaryGaugeCard({ yesProbability }: BinaryGaugeCardProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex flex-col items-center gap-0.5">
        <CircularGauge value={yesProbability} size={72} strokeWidth={6} />
        <span className="text-xs leading-none text-(--text-3)">chance</span>
      </div>
      <div className="flex items-center gap-2">
        <ShowcaseButton tone="yes" label="Yes" />
        <ShowcaseButton tone="no" label="No" />
      </div>
    </div>
  );
}
