"use client";

/**
 * Elimination / seizure (SPEC §7.2) — the banner `Territory Cards Seized!`
 * plus the `+N` card flight toward the attacker's card chip.
 *
 * The roster row's skull flip is the roster's own business; this component
 * owns only the banner and the flight, so the two can play at once.
 */

import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import type { PlayerColour, Seat } from "@/engine/types";
import { playerVar } from "@/render/palette";

import { at, atTopLeft, outlined, Stage } from "./stage";

export interface EliminationBannerProps {
  /** The seat that was eliminated. */
  readonly seat: Seat;
  /** The seat that took them out and seized the cards. */
  readonly by: Seat;
  /** The eliminated seat's display name. */
  readonly name: string;
  /** The eliminated seat's colour. */
  readonly colour: PlayerColour;
  /** How many cards were seized — the `+N`. */
  readonly cards: number;
  readonly onDone?: () => void;
}

const KEYFRAMES = `
@keyframes risk-seize-fly {
  0%   { transform: translate(0,0) rotate(-8deg) scale(1); opacity: 1 }
  100% { transform: translate(-620px, 300px) rotate(-26deg) scale(.45); opacity: 0 }
}
`;

export function EliminationBanner({
  seat, by, name, colour, cards, onDone,
}: EliminationBannerProps) {
  return (
    <Stage
      testId="elimination-banner"
      label="Territory Cards Seized!"
      scrim="var(--scrim)"
      z="var(--z-banner)"
      onBackdropClick={onDone}
    >
      <style>{KEYFRAMES}</style>

      <div
        data-seat={seat}
        data-by={by}
        style={{
          ...atTopLeft(0, 120), width: "100%", height: 120,
          background: "linear-gradient(var(--chrome-900), var(--chrome-800))",
          borderTop: `4px solid ${playerVar(colour)}`,
          borderBottom: `4px solid ${playerVar(colour)}`,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
        }}
      >
        <Avatar colour={colour} name={name} size={86} eliminated testId="elimination-portrait" />
        <span style={outlined(52)}>Territory Cards Seized!</span>
      </div>

      {/* the +N flight: one card per seized card, on an 80 ms stagger */}
      {Array.from({ length: Math.max(0, cards) }, (_, i) => (
        <div
          key={i}
          data-testid="seized-card"
          style={{
            ...at(900, 400),
            animation: `risk-seize-fly 420ms ease-in ${i * 80}ms both`,
          }}
        >
          <Icon name="card" size={72} />
        </div>
      ))}

      <div
        data-testid="elimination-count"
        style={{ ...at(900, 320), ...outlined(44) }}
      >
        +{cards}
      </div>
    </Stage>
  );
}

export default EliminationBanner;
