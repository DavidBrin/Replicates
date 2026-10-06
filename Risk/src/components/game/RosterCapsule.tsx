"use client";

/**
 * One roster row (SPEC §7.1).
 *
 * The capsule bleeds off the right edge — *this is the defining layout
 * choice* (D44), not a top bar. The active seat's capsule is filled with the
 * owner colour, extends ~40 px further left, and carries a white chevron tab
 * off the right edge.
 */
import clsx from "clsx";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import type { PlayerColour, Seat, Standing } from "@/engine/types";
import { playerVar } from "@/render/palette";

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";

export interface RosterRow {
  readonly seat: Seat;
  readonly name: string;
  readonly colour: PlayerColour;
  readonly standing: Standing;
  readonly bot: boolean;
  readonly you: boolean;
  readonly active: boolean;
  /** `null` under Fog of War — the roster shows `???` (R73, F52). */
  readonly troops: number | null;
  readonly territories: number | null;
  readonly cards: number;
  /** Online only: a presence dot, and `undefined` offline so none is drawn. */
  readonly online?: boolean;
  readonly missedTurns?: number;
}

export interface RosterCapsuleProps {
  readonly row: RosterRow;
  /** Row height in px; the capsule radius is half of it. */
  readonly height: number;
  readonly balloon?: string | null;
  /**
   * Alliances only (R80): tapping the capsule opens the alliance popover, which the caller renders
   * as `children`. Absent in every other game, so the capsule stays a read-only row.
   */
  readonly onTap?: () => void;
  /** A proposal is in the air with this seat — the badge the capsule carries. */
  readonly allianceBadge?: "proposed" | "allied" | null;
  /** The popover, rendered inside the capsule so it positions against it. */
  readonly children?: ReactNode;
}

/** Under fog both counts read `???` (§7.1). */
function count(value: number | null): string {
  return value === null ? "???" : String(value);
}

export function RosterCapsule({
  row, height, balloon, onTap, allianceBadge = null, children,
}: RosterCapsuleProps) {
  const eliminated = row.standing === "eliminated" || row.standing === "resigned";
  const avatarSize = Math.round(height * 0.79);
  const face = playerVar(row.colour);

  return (
    <div
      data-testid={`roster-row-${row.seat}`}
      {...(onTap
        ? {
          role: "button" as const,
          tabIndex: 0,
          onClick: onTap,
          onKeyDown: (e: ReactKeyboardEvent) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            onTap();
          },
        }
        : {})}
      // The capsule is all glyphs and numerals; the seat's name is the only
      // thing that makes the row readable to anything but an eye.
      aria-label={row.name}
      data-seat={row.seat}
      data-active={row.active ? "true" : "false"}
      data-standing={row.standing}
      className={clsx(
        "pointer-events-auto relative flex items-center justify-end gap-2 pr-3 transition-all duration-200",
        eliminated && "opacity-60 saturate-50",
      )}
      style={{
        height,
        borderRadius: height / 2,
        // The active capsule reaches ~40 px further left and fills with the owner colour.
        marginLeft: row.active ? -40 : 0,
        background: row.active ? face : "rgba(14,18,20,.80)",
        border: `2px solid ${face}`,
        borderRight: "none",
        borderTopRightRadius: 0,
        borderBottomRightRadius: 0,
        color: row.active ? `var(--p-${row.colour}-on)` : "var(--text)",
      }}
    >
      {/* The alliance popover, if the caller opened one. Positioned against this capsule. */}
      {children}

      {/* R80 — a pending offer or a live alliance, as a small glyph on the capsule's left edge. */}
      {allianceBadge ? (
        <span
          data-testid={`roster-alliance-${row.seat}`}
          data-alliance={allianceBadge}
          aria-label={allianceBadge === "allied" ? "Allied" : "Alliance proposed"}
          className="absolute -left-1 top-1 flex items-center justify-center rounded-full font-bold"
          style={{
            width: Math.round(height * 0.26),
            height: Math.round(height * 0.26),
            background: allianceBadge === "allied" ? "var(--ok)" : "var(--gold)",
            color: "var(--text-on-paper)",
            fontSize: Math.round(height * 0.17),
            boxShadow: "var(--sh-chip)",
          }}
        >
          {allianceBadge === "allied" ? "✓" : "!"}
        </span>
      ) : null}

      {/* Chat balloons pop out to the LEFT of the capsule (§7.3). */}
      {balloon ? (
        <div
          data-testid={`roster-balloon-${row.seat}`}
          className="absolute right-full mr-2 whitespace-nowrap rounded-xl px-3 py-1 text-sm font-semibold"
          style={{ background: "var(--paper)", color: "var(--text-on-paper)", boxShadow: "var(--sh-chip)" }}
        >
          {balloon}
        </div>
      ) : null}

      {/* troop silhouette + count, then map-pin + count */}
      <div className="flex flex-col items-end leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="flex items-center gap-1">
          <Icon name="soldier" size={Math.round(height * 0.23)} />
          <span data-testid={`roster-troops-${row.seat}`} style={{ fontSize: Math.round(height * 0.29) }}>
            {count(row.troops)}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <Icon name="map-pin" size={Math.round(height * 0.23)} />
          <span data-testid={`roster-territories-${row.seat}`} style={{ fontSize: Math.round(height * 0.29) }}>
            {count(row.territories)}
          </span>
        </span>
      </div>

      <div className="relative" style={{ width: avatarSize, height: avatarSize }}>
        {/* A tilted cream card tag overlapping the avatar's top-left. */}
        {row.cards > 0 ? (
          <span
            data-testid={`roster-cards-${row.seat}`}
            className="absolute -left-2 -top-2 z-10 flex items-center justify-center font-bold"
            style={{
              width: Math.round(height * 0.31),
              height: Math.round(height * 0.4),
              transform: "rotate(-12deg)",
              background: "var(--paper)",
              color: "var(--text-on-paper)",
              borderRadius: 4,
              boxShadow: "var(--sh-chip)",
              fontSize: Math.round(height * 0.2),
            }}
          >
            {row.cards}
          </span>
        ) : null}

        <Avatar
          colour={row.colour}
          name={row.name}
          size={avatarSize}
          laurel={row.you}
          bot={row.bot}
          eliminated={eliminated}
          you={row.you}
        />

        {/* Presence dot — online games only (F26). */}
        {row.online !== undefined ? (
          <span
            data-testid={`roster-presence-${row.seat}`}
            data-online={row.online ? "true" : "false"}
            className="absolute bottom-0 right-0 rounded-full"
            style={{
              width: 12, height: 12,
              background: row.online ? "var(--ok)" : "var(--disabled)",
              border: "2px solid rgba(0,0,0,.5)",
            }}
          />
        ) : null}
      </div>

      {/* The active seat's white chevron tab, off the right edge. */}
      {row.active ? (
        <span
          data-testid={`roster-active-tab-${row.seat}`}
          className="absolute left-full top-1/2 -translate-y-1/2"
          style={{
            width: 0, height: 0,
            borderTop: "10px solid transparent",
            borderBottom: "10px solid transparent",
            borderLeft: "12px solid #fff",
          }}
        />
      ) : null}
    </div>
  );
}

export default RosterCapsule;
