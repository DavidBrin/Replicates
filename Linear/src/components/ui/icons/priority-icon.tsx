import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { PRIORITY_LABELS, type Priority } from "@/domain/entities";

/**
 * The priority glyph.
 *
 * A 16×16 box of pure fills — no strokes anywhere — transcribed from Linear's
 * shipped React source and cross-checked against the rendered DOM, which agree
 * on every coordinate (`research/01-visual-design.md` §5.2).
 *
 * ## Why 16 and not 14
 *
 * Status icons render at 14px and priority icons at 16px, side by side in the
 * same list row. That looks like an inconsistency and is not: the bar glyph's
 * ink is concentrated at the bottom of its box while the status ring fills its
 * box edge to edge, so matching the *boxes* makes the bars read a size smaller
 * than the ring. Linear ships `_iconSmall { 14px }` and `_iconNormal { 16px }`
 * and uses the small one only for the status ring. Unifying them is item 7 on
 * the research lane's list of what clones get wrong, so {@link PriorityIcon}
 * defaults to 16 while {@link StatusIcon} defaults to 14.
 *
 * ## The three glyph families
 *
 * - **Bars** (High/Medium/Low) share one grid: width 3, `rx` 1, x at 1.5 / 6.5
 *   / 11.5 — a 5px pitch with a 2px gap — all bottom-aligned to y = 14, heights
 *   6 / 9 / 12. Unfilled bars are *the same rect at `fill-opacity: 0.4`*, not a
 *   separate grey and not an outline. **Low dims two bars, not one.**
 * - **No priority** is three 1.5-unit dashes centred on y = 8 at the same three
 *   x positions, the whole group at `opacity: 0.9`. Not short bars — dashes.
 * - **Urgent** is a single even-odd path: a 14×14 rounded square inset 1 on
 *   every side, with the exclamation punched *out* of it. Same reasoning as the
 *   status glyph's terminal states — a hole survives a background change, a
 *   painted-on white mark does not.
 *
 * ## Two correct colours for Urgent
 *
 * Linear renders Urgent orange in pickers, menus and badges, and **muted grey
 * inside a dense list** — its own component takes a `muted` prop and the live
 * issue list uses it. Both are right; {@link PriorityIconProps.muted} picks.
 *
 * The orange is `#ff7235` (`--priority-urgent-bg`), and getting there is a
 * trap: Linear defines `orangeBase` twice. `#f2994a` is the *label palette*
 * swatch of that name; `#ff7235` is the theme token, and the Urgent icon
 * references the theme token. (`#fc7840` is the marketing orange and Linear's
 * default Triage colour; `#d9730d`, widely repeated online, appears nowhere in
 * Linear's source.)
 */

/** `[x, y, height]` for the three bars. Width 3, `rx` 1, bottom edge at y=14. */
const BARS: readonly (readonly [number, number, number])[] = [
  [1.5, 8, 6],
  [6.5, 5, 9],
  [11.5, 2, 12],
];

/**
 * How many of the three bars are painted solid, per priority.
 *
 * The remainder render at `fill-opacity: 0.4`. Low is the one worth stating
 * explicitly: **one solid bar, two dimmed**.
 */
const SOLID_BARS: Readonly<Partial<Record<Priority, number>>> = {
  2: 3, // High
  3: 2, // Medium
  4: 1, // Low
};

/** Urgent, verbatim: rounded square (1,1)→(15,15) with the `!` knocked out. */
const URGENT_PATH =
  "M3 1C1.91067 1 1 1.91067 1 3V13C1 14.0893 1.91067 15 3 15H13C14.0893 15 15 14.0893 15 13V3C15 1.91067 14.0893 1 13 1H3ZM7 4L9 4L8.75391 8.99836H7.25L7 4ZM9 11C9 11.5523 8.55228 12 8 12C7.44772 12 7 11.5523 7 11C7 10.4477 7.44772 10 8 10C8.55228 10 9 10.4477 9 11Z";

export interface PriorityIconProps {
  priority: Priority;
  /**
   * Render Urgent in the muted icon grey rather than orange.
   *
   * Correct inside a dense issue list, where a column of orange squares
   * out-shouts the titles. Leave it off in pickers, menus and detail rails.
   * Has no effect on the other four glyphs, which always take the ambient
   * icon colour.
   */
  muted?: boolean;
  /** Override the ambient colour. Rarely needed; the token is nearly always right. */
  color?: string;
  size?: number;
  /** Accessible name. Defaults to `PRIORITY_LABELS[priority]`. */
  label?: string;
  /** Drop out of the accessibility tree — correct beside a visible text label. */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PriorityIcon({
  priority,
  muted = false,
  color,
  size = 16,
  label,
  decorative = false,
  className,
  style,
}: PriorityIconProps) {
  const fill =
    color ??
    (priority === 1 && !muted
      ? "var(--priority-urgent-bg)"
      : "var(--priority-icon)");

  const a11y = decorative
    ? ({ "aria-hidden": true, focusable: false } as const)
    : ({ role: "img", "aria-label": label ?? PRIORITY_LABELS[priority] } as const);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={fill}
      className={cn("shrink-0", className)}
      style={style}
      data-priority={priority}
      {...a11y}
    >
      {priority === 1 ? (
        <path fillRule="evenodd" d={URGENT_PATH} />
      ) : priority === 0 ? (
        /* Three dashes, not three short bars: same x grid and width, 1.5 tall,
           centred on the box's midline, the group at 0.9 opacity. */
        <g opacity={0.9}>
          {BARS.map(([x]) => (
            <rect key={x} x={x} y={7.25} width={3} height={1.5} rx={0.5} />
          ))}
        </g>
      ) : (
        BARS.map(([x, y, height], index) => (
          <rect
            key={x}
            x={x}
            y={y}
            width={3}
            height={height}
            rx={1}
            fillOpacity={index < (SOLID_BARS[priority] ?? 0) ? undefined : 0.4}
          />
        ))
      )}
    </svg>
  );
}
