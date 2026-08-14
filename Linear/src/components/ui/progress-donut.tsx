import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { WEDGE_CIRCUMFERENCE } from "@/components/ui/icons/status-icon";

/**
 * The sub-issue progress ring.
 *
 * Shown on a parent issue in place of a sub-issue count: `3/7` tells you a
 * number, the donut tells you a *proportion*, and the list is scanned for
 * proportions. Linear renders it beside the identifier on any issue that has
 * children.
 *
 * ## Why it shares the status icon's arithmetic
 *
 * This is deliberately the same construction as {@link StatusIcon}'s progress
 * wedge — a stroked inner circle with `stroke-dasharray "A 2A"` and
 * `stroke-dashoffset A × (1 − p)`, rotated −90° so the fill starts at twelve
 * o'clock — and it imports {@link WEDGE_CIRCUMFERENCE} rather than recomputing
 * it. Two marks that mean "progress" sitting inches apart in the same row must
 * fill identically, and the only way to guarantee that is for them to be the
 * same maths. The `2π × 1.94` shortfall matters here for the same reason it
 * does there: at 100% the wedge keeps a hairline of ring visible instead of
 * collapsing into a plain disc.
 *
 * The ring is drawn at 40% opacity rather than in a second colour, so the donut
 * needs exactly one colour input and reads correctly against any surface.
 */

export interface ProgressDonutProps {
  completed: number;
  total: number;
  size?: number;
  /** Defaults to the completed-state indigo — this measures completion. */
  color?: string;
  /**
   * Accessible name. Defaults to "{completed} of {total} sub-issues completed";
   * override for a different unit (milestones, say).
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function ProgressDonut({
  completed,
  total,
  size = 14,
  color = "var(--status-completed)",
  label,
  className,
  style,
}: ProgressDonutProps) {
  const fraction = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  const percent = Math.round(fraction * 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={cn("shrink-0", className)}
      style={style}
      // A meter, not an image: this is a quantity, and a screen reader user
      // should get the number rather than a description of a shape.
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={completed}
      aria-valuetext={`${percent}%`}
      aria-label={label ?? `${completed} of ${total} sub-issues completed`}
    >
      <circle
        cx={7}
        cy={7}
        r={6}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={0.4}
      />
      <circle
        cx={7}
        cy={7}
        r={2}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={`${WEDGE_CIRCUMFERENCE} ${2 * WEDGE_CIRCUMFERENCE}`}
        strokeDashoffset={WEDGE_CIRCUMFERENCE * (1 - fraction)}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}
