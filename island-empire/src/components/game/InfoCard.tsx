"use client";

import { infoFor } from "@/game/hud";
import { tileAt } from "@/game/economy";
import { OUTLINE, PLAYER_HEX, UI, WHITE } from "@/render/palette";

import { useGameState, useUi } from "./SessionContext";
import { SpriteIcon } from "./SpriteIcon";
import { HUD_HEIGHT, pixelInk } from "./styles";

/**
 * "KNIGHT LEVEL N · ◎ cost · pouch upkeep · sword strength" for the tapped
 * unit or building (research §6 `crop-hud-unitcard`), floating above the
 * HUD while something is selected.
 */
export function InfoCard() {
  const state = useGameState();
  const selected = useUi((s) => s.selected);
  const info = infoFor(state, selected);
  if (!info || !selected) return null;
  const tile = tileAt(state, selected);
  const colour = tile?.owner === null || tile?.owner === undefined ? null : (state.players[tile.owner]?.colour ?? null);
  const titleColour = colour ? PLAYER_HEX[colour] : "#337DF8";
  return (
    <div
      data-testid="info-card"
      role="status"
      className="pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 items-stretch"
      style={{ bottom: HUD_HEIGHT + 8, maxWidth: "calc(100vw - 96px)" }}
    >
      <div
        className="flex items-center justify-center"
        style={{ width: 56, background: UI.cardGreen, border: `3px solid ${OUTLINE}`, borderRadius: "6px 0 0 6px" }}
      >
        <SpriteIcon sprite={{ kind: info.sprite, colour, biome: state.biome }} size={40} title={info.title} />
      </div>
      <div
        className="flex flex-col justify-center gap-1 px-3 py-1"
        style={{ background: WHITE, border: `3px solid ${OUTLINE}`, borderLeft: "none", borderRadius: "0 6px 6px 0", minWidth: 150 }}
      >
        <div className="text-sm" style={{ ...pixelInk, color: titleColour, textShadow: `1px 1px 0 ${OUTLINE}` }} data-testid="info-title">
          {info.title}
        </div>
        <div className="flex items-center gap-3 text-sm" style={pixelInk}>
          {info.cost !== null && (
            <span className="flex items-center gap-1" title="cost">
              <SpriteIcon sprite={{ kind: "coin" }} size={16} title="cost" />
              {info.cost}
            </span>
          )}
          {info.upkeep !== null && (
            <span className="flex items-center gap-1" title="upkeep">
              <SpriteIcon sprite={{ kind: "upkeep" }} size={16} title="upkeep" />
              {info.upkeep}
            </span>
          )}
          {info.strength !== null && (
            <span className="flex items-center gap-1" title="strength">
              <SpriteIcon sprite={{ kind: "sword" }} size={16} title="strength" />
              {info.strength}
            </span>
          )}
          {info.income !== null && (
            <span className="flex items-center gap-1" title="income">
              <SpriteIcon sprite={{ kind: "income" }} size={16} title="income" />
              {info.income}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
