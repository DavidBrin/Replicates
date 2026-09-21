"use client";

import { OUTLINE, STONE, UI } from "@/render/palette";

import { useGameState, useSession, useUi } from "./SessionContext";
import { pixelTextSmall } from "./styles";

/** UNDO: a counter-clockwise arrow, greyed when `history` is empty (§3.7). */
export function UndoButton() {
  const session = useSession();
  const state = useGameState();
  const aiPlaying = useUi((s) => s.aiPlaying);
  const disabled = state.history.length === 0 || aiPlaying || !session.isHumanTurn();
  return (
    <button
      type="button"
      data-testid="undo-button"
      aria-label="Undo"
      disabled={disabled}
      onClick={() => session.undo()}
      className="flex shrink-0 flex-col items-center justify-end"
      style={{
        width: 56,
        height: 84,
        background: disabled ? STONE.mid : UI.cardYellow,
        border: `3px solid ${OUTLINE}`,
        borderRadius: 6,
        opacity: disabled ? 0.6 : 1,
        padding: "4px 0",
      }}
    >
      <span
        aria-hidden
        className="mb-1 flex flex-1 items-center text-3xl leading-none"
        style={{ color: disabled ? STONE.dark : STONE.dark, fontWeight: 900, textShadow: "none" }}
      >
        ↶
      </span>
      <span className="text-[11px]" style={pixelTextSmall}>
        UNDO
      </span>
    </button>
  );
}
