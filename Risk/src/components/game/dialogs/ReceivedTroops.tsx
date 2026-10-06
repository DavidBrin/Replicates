"use client";

/**
 * The draft award popup (SPEC §7.2). One component, three titles:
 * `Received Troops`, the card-trade variant `Troop Bonus!`, and the +2 variant
 * `Territory Card Bonus!`.
 *
 * Owner-coloured turn banner h ≈ 78 at the top, an owner-coloured header
 * pill at y 212–270, the notched ring at (800, 383) outer r 62 / stroke 14,
 * the `Total troops` caption, then the award line.
 *
 * The banner is a **centred plate ≈745 wide**, not a full-bleed band:
 * `bt1-0055` measures it at x ≈ 428–1172 with both bottom corners rounded,
 * and a band that reaches the viewport edges reads as a page header instead.
 *
 * `bannerOnly` is the **bot** form (§5.3): an opponent's draft award is not
 * the viewer's news, so a bot's turn shows the turn banner alone — no scrim,
 * no header pill and no ring over a board the viewer is still reading.
 */

import { NotchedRing } from "@/components/ui/NotchedRing";
import type { PlayerColour } from "@/engine/types";
import { playerVar } from "@/render/palette";

import { at, atTopLeft, outlined, Stage, STAGE_H, STAGE_SCALE, STAGE_W } from "./stage";

/** §7.2 / `bt1-0055`: x 428–1172, h 78, both bottom corners r 20. */
const BANNER_W = 744;
const BANNER_H = 78;
const BANNER_X = (1600 - BANNER_W) / 2;

export type ReceivedTroopsVariant = "received" | "troopBonus" | "territoryBonus";

const TITLES: Record<ReceivedTroopsVariant, string> = {
  received: "Received Troops",
  troopBonus: "Troop Bonus!",
  territoryBonus: "Territory Card Bonus!",
};

export interface ReceivedTroopsProps {
  readonly variant: ReceivedTroopsVariant;
  readonly name: string;
  readonly colour: PlayerColour;
  /** The viewer's own turn: the banner reads `… turn (YOU)`. */
  readonly you: boolean;
  /** The number inside the ring. */
  readonly total: number;
  /** The territory count the award line interpolates. */
  readonly territories: number;
  /** A bot's award: the turn banner alone, over an unscrimmed board. */
  readonly bannerOnly?: boolean;
  readonly onDone?: () => void;
}

/** The owner-coloured plate, on its own for a bot and atop the popup for a human. */
function TurnBanner({ name, colour, you }: { name: string; colour: PlayerColour; you: boolean }) {
  return (
    <div
      data-testid="received-troops-banner"
      style={{
        ...atTopLeft(BANNER_X, 0), width: BANNER_W, height: BANNER_H,
        background: playerVar(colour), borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "var(--sh-float)",
      }}
    >
      <span style={outlined(34, 700)}>{name} turn{you ? " (YOU)" : ""}</span>
    </div>
  );
}

export function ReceivedTroops({
  variant, name, colour, you, total, territories, bannerOnly = false, onDone,
}: ReceivedTroopsProps) {
  const title = TITLES[variant];

  // A bot's banner is **not** a dialog: it announces, it never takes focus or
  // swallows a tap meant for the board.
  if (bannerOnly) {
    return (
      <div
        data-testid="received-troops"
        data-banner-only="true"
        role="status"
        aria-label={`${name} turn`}
        style={{
          position: "fixed", inset: 0, zIndex: "var(--z-banner)" as unknown as number,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden", pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "relative", width: STAGE_W, height: STAGE_H, flex: "0 0 auto",
            transform: `scale(${STAGE_SCALE})`, transformOrigin: "center center",
          }}
        >
          <TurnBanner name={name} colour={colour} you={you} />
        </div>
      </div>
    );
  }

  return (
    <Stage testId="received-troops" label={title} onBackdropClick={onDone}>
      <TurnBanner name={name} colour={colour} you={you} />

      <div
        data-testid="received-troops-header"
        style={{
          ...atTopLeft(380, 212), width: 840, height: 58, borderRadius: 10,
          background: playerVar(colour), display: "flex", alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={outlined(36, 700)}>{title}</span>
      </div>

      <div style={at(800, 383)}>
        <NotchedRing value={total} radius={62} stroke={14} colour={playerVar(colour)}
          testId="received-troops-ring" />
      </div>

      <div
        style={{ ...at(800, 487), fontFamily: "var(--font-body), system-ui, sans-serif",
          fontSize: 24, /* §7.2 quotes this grey literally. */ color: "#C9D4D8" }}
      >
        Total troops
      </div>

      <p
        data-testid="received-troops-award"
        style={{ ...at(800, 527), margin: 0, fontFamily: "var(--font-body), system-ui, sans-serif",
          fontSize: 32, color: "var(--text)", whiteSpace: "nowrap" }}
      >
        Troops awarded for occupying&nbsp;<b>{territories} territories</b>
      </p>
    </Stage>
  );
}

export default ReceivedTroops;
