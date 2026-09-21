"use client";

import type { Difficulty } from "@/engine/types";
import { OUTLINE, UI } from "@/render/palette";

import { useSession, useUi } from "./SessionContext";
import { SpriteIcon } from "./SpriteIcon";
import { TOUCH_MIN, panelBorder, pixelText } from "./styles";

const STARS: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3 };

/**
 * Victory (stars for the difficulty, Next level / Retry / Menu) or defeat
 * (Retry / Menu) — SPEC §7, research §9 decision.
 */
export function EndModal({
  onRetry,
  onMenu,
  onNextLevel,
}: {
  onRetry: () => void;
  onMenu: () => void;
  onNextLevel?: (() => void) | null;
}) {
  const session = useSession();
  const over = useUi((s) => s.gameOver);
  const tutorial = useUi((s) => s.tutorialStep);
  if (!over || tutorial) return null;
  const stars = STARS[session.config.difficulty];
  const btn = (bg: string) => ({
    minHeight: TOUCH_MIN,
    background: bg,
    border: `3px solid ${OUTLINE}`,
    borderRadius: 6,
    ...pixelText,
  });
  return (
    <div
      data-testid="end-modal"
      data-outcome={over.humanWon ? "victory" : "defeat"}
      role="dialog"
      aria-modal="true"
      aria-label={over.humanWon ? "Victory" : "Defeat"}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4"
    >
      <div className="flex w-full max-w-sm flex-col gap-3 p-5 text-center" style={{ background: UI.woodPanel, ...panelBorder }}>
        <h2 className="text-3xl" style={pixelText}>
          {over.humanWon ? "Victory!" : "Defeat"}
        </h2>
        {over.humanWon && (
          <div className="flex justify-center gap-2" data-testid="end-stars" aria-label={`${stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="motion-safe:animate-[pop_150ms_ease-out_both]"
                style={{ animationDelay: `${i * 150}ms` }}
              >
                <SpriteIcon sprite={{ kind: i < stars ? "star" : "starEmpty" }} size={48} title={i < stars ? "star" : "no star"} />
              </span>
            ))}
          </div>
        )}
        {over.humanWon && onNextLevel && (
          <button type="button" data-testid="end-next" onClick={onNextLevel} className="text-lg" style={btn(UI.buyGreen)}>
            Next level
          </button>
        )}
        <button type="button" data-testid="end-retry" onClick={onRetry} className="text-lg" style={btn(UI.cardYellow)}>
          Retry
        </button>
        <button type="button" data-testid="end-menu" onClick={onMenu} className="text-lg" style={btn(UI.woodPanelLight)}>
          Menu
        </button>
      </div>
    </div>
  );
}
