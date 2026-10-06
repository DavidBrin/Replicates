"use client";

/**
 * `Victory!` (SPEC §7.2) — the board entirely the winner's colour behind, the
 * title at y ≈ 95 with a 5 px outline, a laurel-ringed portrait at (800, 420)
 * r 150, ~24 white five-pointed stars fanning over ~240°, a name plate pill
 * and the subtitle at y ≈ 790. A Max-Rounds win adds the tiebreak line.
 *
 * No full-screen "Defeated!" frame exists in the evidence, so **`Defeated!`
 * mirrors Victory with a desaturated portrait** (D68) — the same component
 * under a `defeated` prop.
 */

import { Avatar } from "@/components/ui/Avatar";
import type { Outcome, PlayerColour } from "@/engine/types";
import { playerVar } from "@/render/palette";

import { at, outlined, Stage } from "./stage";

export interface VictoryOverlayProps {
  readonly name: string;
  readonly colour: PlayerColour;
  /** The mirror: the same frame, desaturated portrait, title `Defeated!`. */
  readonly defeated?: boolean;
  /** `maxRounds` adds the tiebreak line. */
  readonly reason?: Outcome["reason"];
  /** The round the Max-Rounds game ended on. */
  readonly round?: number;
  readonly onDone?: () => void;
}

const STAR_COUNT = 24;

/** A five-pointed star path in a 100×100 box. */
const STAR = "M50 4 62 36 96 38 69 59 78 92 50 72 22 92 31 59 4 38 38 36Z";

export function VictoryOverlay({
  name, colour, defeated = false, reason, round, onDone,
}: VictoryOverlayProps) {
  const title = defeated ? "Defeated!" : "Victory!";
  return (
    <Stage
      testId="victory-overlay"
      label={title}
      scrim={playerVar(colour, "dark")}
      z="var(--z-banner)"
      onBackdropClick={onDone}
    >
      {/* the stars fan over ~240° at 20–60 px, staggered 25 ms (§8 Motion) */}
      <svg
        aria-hidden
        data-testid="victory-stars"
        width="1600"
        height="900"
        viewBox="0 0 1600 900"
        style={{ position: "absolute", inset: 0 }}
      >
        {Array.from({ length: STAR_COUNT }, (_, i) => {
          const t = i / (STAR_COUNT - 1);
          const angle = (-210 + t * 240) * (Math.PI / 180);
          const radius = 300 + (i % 3) * 52;
          const size = 20 + ((i * 37) % 41);
          const cx = 800 + Math.cos(angle) * radius * 1.6;
          const cy = 420 + Math.sin(angle) * radius;
          return (
            <g
              key={i}
              transform={`translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})`}
              opacity=".92"
            >
              <path d={STAR} fill="var(--text)" />
            </g>
          );
        })}
      </svg>

      <div style={{ ...at(800, 95), ...outlined(56), WebkitTextStroke: "5px var(--stroke-dark)" }}>
        {title}
      </div>

      <div style={{ ...at(800, 420), filter: defeated ? "grayscale(1) brightness(.7)" : undefined }}>
        <Avatar colour={colour} name={name} size={300} laurel testId="victory-portrait" />
      </div>

      <div
        data-testid="victory-name"
        style={{
          ...at(800, 648), width: 620, height: 60, borderRadius: 30,
          background: "rgba(14,18,20,.72)", display: "flex", alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={outlined(36, 700)}>{name}</span>
      </div>

      {defeated ? null : (
        <p
          data-testid="victory-subtitle"
          style={{ ...at(800, 790), margin: 0,
            fontFamily: "var(--font-body), system-ui, sans-serif", fontSize: 30,
            /* §7.2 quotes this grey literally. */ color: "#D6DEE2", whiteSpace: "nowrap" }}
        >
          You conquered all your opponents!
        </p>
      )}

      {reason === "maxRounds" ? (
        <p
          data-testid="victory-tiebreak"
          style={{ ...at(800, 838), margin: 0,
            fontFamily: "var(--font-body), system-ui, sans-serif", fontSize: 26,
            color: "var(--text-muted)", whiteSpace: "nowrap" }}
        >
          Most territories at the end of round {round}
        </p>
      ) : null}
    </Stage>
  );
}

export default VictoryOverlay;
