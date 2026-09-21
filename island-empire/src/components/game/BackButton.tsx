"use client";

import { OUTLINE, UI } from "@/render/palette";

import { useSession, useUi } from "./SessionContext";
import { HUD_HEIGHT, pixelInk } from "./styles";

/** "<" bottom-left while anything is selected (SPEC §7, §9). */
export function BackButton() {
  const session = useSession();
  const selected = useUi((s) => s.selected);
  const shopItem = useUi((s) => s.shopItem);
  if (!selected && !shopItem) return null;
  return (
    <button
      type="button"
      data-testid="back-button"
      aria-label="Deselect"
      onClick={() => session.deselect()}
      className="absolute left-2 z-10 flex items-center justify-center text-3xl"
      style={{
        bottom: `calc(${HUD_HEIGHT + 8}px + env(safe-area-inset-bottom, 0px))`,
        width: 56,
        height: 56,
        background: UI.cardCream,
        border: `3px solid ${OUTLINE}`,
        borderRadius: 6,
        ...pixelInk,
      }}
    >
      {"<"}
    </button>
  );
}
