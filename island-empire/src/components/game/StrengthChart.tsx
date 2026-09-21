"use client";

import { OUTLINE, UI, WHITE } from "@/render/palette";
import type { SpriteKey } from "@/render/sprites";

import { useGameState, useSession, useUi } from "./SessionContext";
import { SpriteIcon } from "./SpriteIcon";
import { TOUCH_MIN, panelBorder, pixelInk, pixelText } from "./styles";

/**
 * The HELP! "- Strength -" chart (research `crop-strength-chart.png`):
 * four rows, each knight level → what it beats, drawn from the sprite atlas,
 * and a green OK.
 */
const ROWS: Array<{ level: SpriteKey["kind"]; beats: SpriteKey[] }> = [
  { level: "knight1", beats: [{ kind: "farm" }, { kind: "field" }] },
  { level: "knight2", beats: [{ kind: "knight1", colour: "red" }, { kind: "city", colour: "red" }] },
  { level: "knight3", beats: [{ kind: "knight2", colour: "red" }, { kind: "woodwall", colour: "red" }] },
  { level: "knight4", beats: [{ kind: "knight3", colour: "red" }, { kind: "stoneTower", colour: "red" }] },
];

export function StrengthChart() {
  const session = useSession();
  const state = useGameState();
  const modal = useUi((s) => s.modal);
  if (modal !== "help") return null;
  const me = state.players[session.viewerSeat()]?.colour ?? "blue";
  return (
    <div
      data-testid="help-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Strength chart"
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={() => session.setModal(null)}
    >
      <div className="flex w-full max-w-sm flex-col gap-2 p-4" style={{ background: UI.chartAmber, ...panelBorder }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-center text-xl" style={pixelText}>
          - Strength -
        </h2>
        {ROWS.map((row) => (
          <div key={row.level} className="flex items-center gap-3 px-2" style={{ minHeight: 56 }}>
            <SpriteIcon sprite={{ kind: row.level, colour: me }} size={44} title={row.level} />
            <span className="flex flex-col items-center" aria-label="beats">
              <SpriteIcon sprite={{ kind: "sword" }} size={22} title="attacks" />
              <span aria-hidden className="text-xl leading-none" style={{ ...pixelInk, color: UI.buyGreen, textShadow: `1px 1px 0 ${OUTLINE}` }}>
                ➜
              </span>
            </span>
            {row.beats.map((b, i) => (
              <SpriteIcon key={i} sprite={{ ...b, biome: state.biome }} size={44} title={b.kind} />
            ))}
          </div>
        ))}
        <button
          type="button"
          data-testid="help-ok"
          onClick={() => session.setModal(null)}
          className="mt-2 text-xl"
          style={{ minHeight: TOUCH_MIN, background: UI.buyGreen, color: WHITE, border: `3px solid ${OUTLINE}`, borderRadius: 6, ...pixelText }}
        >
          OK
        </button>
      </div>
    </div>
  );
}
