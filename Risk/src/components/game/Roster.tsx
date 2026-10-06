"use client";

/**
 * The player roster: a vertical stack of capsules flush to the right edge,
 * bleeding off-screen (SPEC §7.1, D44).
 *
 * Landscape it is 13 %W with rows `clamp(64px, 10.7vh, 104px)`; under 820 px
 * the rows drop the territory line; in portrait the parent turns it into a
 * horizontal strip (§8 Responsive) by passing `orientation="horizontal"`.
 */
import clsx from "clsx";
import type { ReactNode } from "react";

import { RosterCapsule, type RosterRow } from "./RosterCapsule";

export interface RosterProps {
  readonly rows: readonly RosterRow[];
  readonly balloons?: Readonly<Record<number, string>>;
  readonly orientation?: "vertical" | "horizontal";
  /** Row height in px; defaults to the measured 96. */
  readonly rowHeight?: number;
  /**
   * Alliances only (R80): what tapping a capsule does, per seat. `undefined` — the default and
   * every non-alliance game — leaves the row inert, exactly as it was.
   */
  readonly onTapSeat?: (seat: number) => void;
  /** The alliance badge a capsule carries, per seat. */
  readonly allianceBadges?: Readonly<Record<number, "proposed" | "allied" | null>>;
  /** The popover for one seat, rendered inside that capsule. */
  readonly popoverFor?: (seat: number) => ReactNode;
}

export function Roster({
  rows, balloons = {}, orientation = "vertical", rowHeight = 96,
  onTapSeat, allianceBadges = {}, popoverFor,
}: RosterProps) {
  const extras = (seat: number) => ({
    ...(onTapSeat ? { onTap: () => onTapSeat(seat) } : {}),
    allianceBadge: allianceBadges[seat] ?? null,
    children: popoverFor?.(seat) ?? null,
  });

  if (orientation === "horizontal") {
    return (
      <div
        data-testid="roster"
        data-orientation="horizontal"
        className="pointer-events-none flex w-full gap-2 overflow-x-auto px-2 py-1"
        style={{ zIndex: "var(--z-hud)" }}
      >
        {rows.map((row) => (
          <RosterCapsule
            key={row.seat}
            row={row}
            height={Math.min(rowHeight, 64)}
            balloon={balloons[row.seat] ?? null}
            {...extras(row.seat)}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid="roster"
      data-orientation="vertical"
      className={clsx(
        "pointer-events-none absolute right-0 flex flex-col items-end justify-center",
        "top-1/2 -translate-y-1/2",
      )}
      style={{
        // Row pitch ≈ 125 at row height 96: the gap is the difference.
        gap: Math.round(rowHeight * 0.3),
        width: "13%",
        minWidth: 180,
        zIndex: "var(--z-hud)",
      }}
    >
      {rows.map((row) => (
        <RosterCapsule
          key={row.seat}
          row={row}
          height={rowHeight}
          balloon={balloons[row.seat] ?? null}
          {...extras(row.seat)}
        />
      ))}
    </div>
  );
}

export default Roster;
