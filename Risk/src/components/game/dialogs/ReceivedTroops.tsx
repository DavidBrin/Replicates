"use client";

/**
 * The draft award popup (SPEC §7.2). One component, three titles:
 * `Received Troops`, the card-trade variant `Troop Bonus!`, and the +2 variant
 * `Territory Card Bonus!`.
 *
 * Owner-coloured turn banner h ≈ 78 across the top, an owner-coloured header
 * pill at y 212–270, the notched ring at (800, 383) outer r 62 / stroke 14,
 * the `Total troops` caption, then the award line.
 */

import { NotchedRing } from "@/components/ui/NotchedRing";
import type { PlayerColour } from "@/engine/types";
import { playerVar } from "@/render/palette";

import { at, atTopLeft, outlined, Stage } from "./stage";

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
  readonly onDone?: () => void;
}

export function ReceivedTroops({
  variant, name, colour, you, total, territories, onDone,
}: ReceivedTroopsProps) {
  const title = TITLES[variant];
  return (
    <Stage testId="received-troops" label={title} onBackdropClick={onDone}>
      <div
        data-testid="received-troops-banner"
        style={{
          ...atTopLeft(0, 0), width: "100%", height: 78,
          background: playerVar(colour), borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <span style={outlined(34, 700)}>{name} turn{you ? " (YOU)" : ""}</span>
      </div>

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
