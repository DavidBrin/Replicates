"use client";

import type { PlayerColour } from "@/engine/types";

import { COLOUR_HEX, colourDisplayName } from "./colours";
import { PixelButton } from "./PixelButton";
import { pixelTextStyle } from "./pixelText";

/**
 * Full-screen hand-off screen the game runner (S2) shows between two human
 * turns in hot-seat play (SPEC §5 "Hot-seat hand-off": "After END_TURN, if
 * the next seat is human and ≥2 human seats are configured... a full-screen
 * 'Player {colour}'s turn — pass the device' overlay"; SPEC §7 `/hotseat`).
 *
 * Prop contract:
 * - `playerName` — the seat's display name: `SeatConfig.name` if the player
 *   renamed it in `/hotseat`, otherwise the colour name.
 * - `colour` — the seat's `PlayerColour`. The panel is painted in this
 *   colour so the outgoing player visually confirms whose turn is next
 *   before physically handing the device over.
 * - `onContinue` — called once, when CONTINUE is tapped. This component is
 *   presentational only: it never dismisses itself or touches game state —
 *   the caller (S2's session runner) is responsible for hiding the overlay
 *   and resuming play.
 *
 * The overlay is opaque and covers the full viewport, so the board
 * underneath stays fully hidden until CONTINUE is tapped.
 */
export interface HandOffOverlayProps {
  playerName: string;
  colour: PlayerColour;
  onContinue: () => void;
}

export function HandOffOverlay({ playerName, colour, onContinue }: HandOffOverlayProps) {
  const hex = COLOUR_HEX[colour];

  return (
    <div
      data-testid="handoff-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Pass the device to ${playerName} (${colourDisplayName(colour)})`}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6"
      style={{ backgroundColor: "#1A1010" }}
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border-4 p-6"
        style={{ backgroundColor: hex, borderColor: "#1A1010" }}
      >
        <p className="text-center text-sm font-bold uppercase" style={pixelTextStyle}>
          Pass the device to
        </p>
        <p
          data-testid="handoff-name"
          className="text-center text-3xl font-bold uppercase"
          style={pixelTextStyle}
        >
          {playerName}
        </p>
        <PixelButton
          type="button"
          variant="green"
          data-testid="handoff-continue"
          onClick={onContinue}
          className="mt-2 w-full text-lg"
        >
          Continue
        </PixelButton>
      </div>
    </div>
  );
}

export default HandOffOverlay;
