import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import type { StateType } from "@/domain/entities";

/**
 * The workflow-state glyph.
 *
 * This is not an icon in the ordinary sense — it is a **progress indicator**,
 * and it is the single most recognisable mark in Linear's interface. It is
 * drawn here rather than imported from an icon set because no icon set contains
 * "a ring with a 62.5% pie wedge in it".
 *
 * ## The geometry, and where it comes from
 *
 * Every value below was read off Linear's rendered DOM across three app pages —
 * 33 status-icon instances, all identically constructed
 * (`research/01-visual-design.md` §5.1). A 14×14 box, two concentric circles,
 * and a knockout path for the terminal states:
 *
 * - **Ring** (all states): `cx=7 cy=7 r=6 stroke-width=1.5`. Dashed for
 *   Backlog (`1.4 1.74`, offset `0.65`), solid otherwise (`3.14 0`, offset
 *   `-0.7` — a zero-gap dash array, which is how one component renders both).
 * - **Wedge**: an inner circle whose *stroke* is thick enough to reach the
 *   centre — `r=2 stroke-width=4` — rotated −90° so the arc starts at twelve
 *   o'clock, with `stroke-dasharray = "A 2A"` and
 *   `stroke-dashoffset = A × (1 − progress)`.
 *
 * {@link WEDGE_CIRCUMFERENCE} is `2π × 1.94`, **not** `2π × 2`. The 3% shortfall
 * is deliberate in Linear's own source: at `progress = 1` it leaves a hairline
 * so the wedge never closes into a seamless disc and quietly stops reading as
 * a wedge. Reproducing this at `r = 2` is the difference between a glyph that
 * matches and one that is subtly wrong at high progress.
 *
 * Three implementations of this mark are plausible — an arc `path`, a conic
 * gradient, or this. Linear's bundle actually contains an arc-path variant too,
 * but zero of the 33 captured instances used it; the stroked-circle form is
 * what the product paints, and it animates by tweening a single number.
 *
 * ## Why the terminal glyphs are holes, not white marks
 *
 * Done and Canceled are drawn as a **single `fill-rule="evenodd"` path** — a
 * disc with the check or cross punched out of it, so the row background shows
 * through. Painting a white check on top instead looks identical on one
 * background and breaks on every other: the moment a row hovers, gets selected,
 * or appears on a coloured chip, a hard-coded knockout colour is visibly the
 * wrong grey. This is item 11 on the research lane's list of what clones get
 * wrong.
 *
 * The disc radius is `6.75`, which is not arbitrary: the ring's outer edge sits
 * at `6 + 1.5/2`, and the measured terminal states fill flush to it
 * (`r=3 stroke-width=6` reaches `r=6`, the ring covers `5.25`–`6.75`). One disc
 * of `6.75` paints exactly the union of those two circles.
 */

/**
 * `2π × 1.94` — the wedge's dash period.
 *
 * Exported so a test can assert the constant rather than a rounded literal, and
 * so {@link ProgressDonut} can share the same arithmetic.
 */
export const WEDGE_CIRCUMFERENCE = 2 * Math.PI * 1.94;

/**
 * The check, lifted verbatim from Linear's shipped source.
 *
 * Centreline (3.5, 7.5) → (5.5, 9.5) → (10.5, 4.5), ≈1.9 units thick with round
 * caps and join. It is a filled outline, not a stroke, which is what lets it be
 * unioned with the disc into one even-odd path.
 */
const CHECK_PATH =
  "M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z";

/** The cross, likewise verbatim: two 1.5-unit round-capped strokes at 45°. */
const CROSS_PATH =
  "M3.73657 3.73657C4.05199 3.42114 4.56339 3.42114 4.87881 3.73657L5.93941 4.79716L7 5.85775L9.12117 3.73657C9.4366 3.42114 9.94801 3.42114 10.2634 3.73657C10.5789 4.05199 10.5789 4.56339 10.2634 4.87881L8.14225 7L10.2634 9.12118C10.5789 9.4366 10.5789 9.94801 10.2634 10.2634C9.94801 10.5789 9.4366 10.5789 9.12117 10.2634L7 8.14225L4.87881 10.2634C4.56339 10.5789 4.05199 10.5789 3.73657 10.2634C3.42114 9.94801 3.42114 9.4366 3.73657 9.12118L4.79716 8.06059L5.85775 7L3.73657 4.87881C3.42114 4.56339 3.42114 4.05199 3.73657 3.73657Z";

/**
 * Triage: a horizontal double-headed arrow, knocked out of the disc.
 *
 * **[DEVIATION]** Linear's Triage glyph is described in the research notes but
 * its path was not captured, so this is a reconstruction to the description
 * ("a filled disc with a horizontal double-headed-arrow knockout") rather than
 * a transcription. The arrow spans x 2.9 → 11.1 with a 1.6-unit shaft, which
 * keeps every vertex inside the 6.75 disc and stays legible at 14px — the size
 * at which a finer arrow turns to mush.
 */
const TRIAGE_PATH =
  "M2.9 7L5.3 4.6V6.2H8.7V4.6L11.1 7L8.7 9.4V7.8H5.3V9.4Z";

/** A full circle of radius 6.75 centred in the 14-unit box, as path data. */
const DISC_PATH = "M0.25 7A6.75 6.75 0 1 1 13.75 7A6.75 6.75 0 1 1 0.25 7Z";

/**
 * The default colour per state type, as a `var()` reference.
 *
 * Backlog and Todo deliberately share one grey: in Linear the two are told
 * apart by the *glyph* (dashed ring versus solid ring), never by colour. A
 * clone that tints them differently loses the distinction the shape is making.
 */
const STATE_COLOR_VAR: Readonly<Record<StateType, string>> = {
  triage: "var(--status-triage)",
  backlog: "var(--status-backlog)",
  unstarted: "var(--status-todo)",
  started: "var(--status-started)",
  completed: "var(--status-completed)",
  canceled: "var(--status-canceled)",
};

/** Fallback accessible names, used when the caller has no state name to hand. */
const STATE_LABEL: Readonly<Record<StateType, string>> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  canceled: "Canceled",
};

export interface StatusIconProps {
  /** The state's *type*. The type drives the glyph; the name never does. */
  type: StateType;
  /**
   * Override the colour with the state's own `color` column.
   *
   * A team may recolour its states, and the picker shows the stored hex. When
   * omitted the glyph falls back to the semantic token for its type, which is
   * what the seeded default workflow uses.
   */
  color?: string;
  /**
   * How far through the started group this state sits, 0–1.
   *
   * Ignored for every type except `started`. Linear derives it from the state's
   * position among its team's started states — see {@link startedStateProgress},
   * which is the rule, not a guess. The 0.5 default is what a single-started-state
   * workflow produces.
   */
  progress?: number;
  /** Rendered size in CSS pixels. 14 is the measured size in every list row. */
  size?: number;
  /**
   * Accessible name. Pass the state's display name ("In Review") where one
   * exists; the type's generic label is used otherwise.
   */
  label?: string;
  /**
   * Drop the glyph out of the accessibility tree.
   *
   * Correct whenever the icon sits beside a visible text label — a status chip
   * reading "○ Todo" should announce once, not twice.
   */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Linear's rule for a started state's wedge fill.
 *
 * Transcribed from the shipped source (`research/01-visual-design.md` §5.1).
 * The special cases for one and two started states are not simplifications of
 * the general formula — with two states the general form would give ⅓ and ⅔,
 * where Linear ships ½ and ¾. A workflow of "In Progress" + "In Review" is the
 * common case, so getting this wrong is visible in most workspaces.
 *
 * @param index Zero-based position among the team's started states, ordered by
 * `position`.
 * @param count How many started states the team has.
 */
export function startedStateProgress(index: number, count: number): number {
  if (count <= 1) return 0.5;
  if (count === 2) return index === 0 ? 0.5 : 0.75;
  return (1 / (count + 1)) * (index + 1);
}

export function StatusIcon({
  type,
  color,
  progress = 0.5,
  size = 14,
  label,
  decorative = false,
  className,
  style,
}: StatusIconProps) {
  const stroke = color ?? STATE_COLOR_VAR[type];
  const terminal = type === "completed" || type === "canceled" || type === "triage";
  const accessibleName = label ?? STATE_LABEL[type];

  const a11y = decorative
    ? ({ "aria-hidden": true, focusable: false } as const)
    : ({ role: "img", "aria-label": accessibleName } as const);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={cn("shrink-0", className)}
      style={style}
      data-status-type={type}
      {...a11y}
    >
      {terminal ? (
        /* One path, one hole. `evenodd` turns the inner glyph into a genuine
           cut-out so whatever surface is behind the icon shows through it. */
        <path
          fill={stroke}
          fillRule="evenodd"
          d={`${DISC_PATH} ${
            type === "completed"
              ? CHECK_PATH
              : type === "canceled"
                ? CROSS_PATH
                : TRIAGE_PATH
          }`}
        />
      ) : (
        <>
          <circle
            cx={7}
            cy={7}
            r={6}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            /* Period π at circumference 2π·6 = exactly 12 dashes around the
               ring; the 0.65 offset centres the first one at twelve o'clock. */
            strokeDasharray={type === "backlog" ? "1.4 1.74" : "3.14 0"}
            strokeDashoffset={type === "backlog" ? 0.65 : -0.7}
          />
          <circle
            cx={7}
            cy={7}
            r={2}
            fill="none"
            stroke={stroke}
            strokeWidth={4}
            strokeDasharray={`${WEDGE_CIRCUMFERENCE} ${2 * WEDGE_CIRCUMFERENCE}`}
            strokeDashoffset={
              WEDGE_CIRCUMFERENCE *
              (1 - (type === "started" ? clamp01(progress) : 0))
            }
            transform="rotate(-90 7 7)"
          />
        </>
      )}
    </svg>
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
