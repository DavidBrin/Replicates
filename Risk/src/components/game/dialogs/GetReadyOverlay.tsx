"use client";

/**
 * `Get Ready` (SPEC §7.2) — scrimmed board, owner-coloured radial sunburst,
 * laurel-ringed portrait, name plate pill.
 *
 * Both body strings are verbatim; only the seat number and the colour word are
 * interpolated, and line 1 carries a filled colour disc before the colour.
 */

import { Avatar } from "@/components/ui/Avatar";
import type { PlayerColour } from "@/engine/types";
import { colourName, playerVar } from "@/render/palette";

import { at, outlined, Stage } from "./stage";

export interface GetReadyOverlayProps {
  /** The 1-based seat number shown as "player 2". */
  readonly playerNumber: number;
  readonly name: string;
  readonly colour: PlayerColour;
  /** Dismiss on tap; the session owns the hold. */
  readonly onDone?: () => void;
}

export function GetReadyOverlay({ playerNumber, name, colour, onDone }: GetReadyOverlayProps) {
  return (
    <Stage testId="get-ready" label="Get Ready" onBackdropClick={onDone}>
      {/* the owner-coloured radial sunburst */}
      <div
        aria-hidden
        style={{
          ...at(800, 420),
          width: 1100,
          height: 1100,
          background: `radial-gradient(closest-side, ${playerVar(colour, "dark")}, transparent 70%)`,
          opacity: 0.85,
        }}
      />

      <div style={{ ...at(800, 118), ...outlined(56) }}>Get Ready</div>

      <div style={at(800, 420)}>
        <Avatar colour={colour} name={name} size={300} laurel testId="get-ready-portrait" />
      </div>

      <div
        data-testid="get-ready-name"
        style={{
          ...at(800, 648), minWidth: 620, height: 60, borderRadius: 30,
          background: "rgba(14,18,20,.72)", display: "flex", alignItems: "center",
          justifyContent: "center", padding: "0 30px",
        }}
      >
        <span style={outlined(36, 700)}>{name}</span>
      </div>

      <p
        data-testid="get-ready-line-1"
        style={{
          ...at(800, 740), margin: 0, fontFamily: "var(--font-body), system-ui, sans-serif",
          fontSize: 36, color: "var(--text)", whiteSpace: "nowrap", display: "flex",
          alignItems: "center", gap: 8,
        }}
      >
        You are&nbsp;<b>player {playerNumber}</b>&nbsp;– General of the&nbsp;
        <span
          aria-hidden
          data-testid="get-ready-disc"
          style={{ width: 26, height: 26, borderRadius: "50%", background: playerVar(colour),
            display: "inline-block" }}
        />
        <b>{colourName(colour)}</b>&nbsp;Troops
      </p>

      <p
        data-testid="get-ready-line-2"
        style={{
          ...at(800, 790), margin: 0, fontFamily: "var(--font-body), system-ui, sans-serif",
          fontSize: 24, /* §7.2 quotes this grey literally. */ color: "#C6D2D8",
          whiteSpace: "nowrap",
        }}
      >
        Each turn you will DRAFT &gt; ATTACK &gt; FORTIFY.
      </p>
    </Stage>
  );
}

export default GetReadyOverlay;
