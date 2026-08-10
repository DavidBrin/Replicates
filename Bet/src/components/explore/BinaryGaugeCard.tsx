import { CircularGauge } from "./CircularGauge";
import { ShowcaseButton } from "./ShowcaseButton";

export interface BinaryGaugeCardProps {
  /** Yes-outcome probability, 0..1. */
  yesProbability: number;
}

/** Card variant (b) — SPEC §7.3: Polymarket's signature circular percentage
 * gauge ("21% chance"), the number drawn inside the ring by `CircularGauge`
 * itself, "chance" set beneath per this task's brief. Server-renderable. */
export function BinaryGaugeCard({ yesProbability }: BinaryGaugeCardProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-1">
      <div className="flex flex-col items-center gap-1">
        <CircularGauge value={yesProbability} size={72} strokeWidth={7} />
        <span className="text-xs text-(--text-3)">chance</span>
      </div>
      <div className="flex items-center gap-2">
        <ShowcaseButton tone="yes" label="Yes" size="md" />
        <ShowcaseButton tone="no" label="No" size="md" />
      </div>
    </div>
  );
}
