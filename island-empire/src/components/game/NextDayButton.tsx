"use client";

import { OUTLINE, UI, WATER, WOOD } from "@/render/palette";

import { useSession, useUi } from "./SessionContext";
import { pixelTextSmall } from "./styles";

/** NEXT DAY: yellow-bordered wood button with the blue arrow (research §6). */
export function NextDayButton() {
  const session = useSession();
  const aiPlaying = useUi((s) => s.aiPlaying);
  const gameOver = useUi((s) => s.gameOver);
  const handOff = useUi((s) => s.handOff);
  const disabled = aiPlaying || !!gameOver || !!handOff;
  return (
    <button
      type="button"
      data-testid="next-day-button"
      aria-label="Next day"
      disabled={disabled}
      onClick={() => session.endTurn()}
      className="flex shrink-0 flex-col items-center justify-end"
      style={{
        width: 72,
        height: 84,
        background: WOOD.mid,
        border: `3px solid ${disabled ? OUTLINE : UI.cardYellow}`,
        outline: `2px solid ${OUTLINE}`,
        borderRadius: 6,
        opacity: disabled ? 0.55 : 1,
        padding: "4px 0",
      }}
    >
      <span
        aria-hidden
        className="flex flex-1 items-center text-4xl leading-none"
        style={{ color: WATER.fill, fontWeight: 900, textShadow: `2px 2px 0 ${OUTLINE}` }}
      >
        ➜
      </span>
      <span className="text-[11px]" style={pixelTextSmall}>
        NEXT DAY
      </span>
    </button>
  );
}
