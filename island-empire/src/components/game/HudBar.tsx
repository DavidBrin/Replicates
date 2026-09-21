"use client";

import { provinceNet, tileAt } from "@/game/economy";
import { shopCards } from "@/game/hud";
import { OUTLINE, PLAYER_HEX, darken, hudColour } from "@/render/palette";

import { NextDayButton } from "./NextDayButton";
import { useGameState, useSession, useUi } from "./SessionContext";
import { ShopCardButton } from "./ShopCard";
import { SpriteIcon } from "./SpriteIcon";
import { HUD_HEIGHT, pixelText } from "./styles";
import { UndoButton } from "./UndoButton";

/**
 * The bottom bar (SPEC §7): coloured by the acting player, income ⊕ and
 * gold ◎ of the selected province (or the player's largest), the four
 * shop cards, UNDO, NEXT DAY. Fixed height, 44 px+ targets, scrolls
 * horizontally on a narrow phone.
 */
export function HudBar() {
  const session = useSession();
  const state = useGameState();
  const acting = useUi((s) => s.actingPlayer);
  const selected = useUi((s) => s.selected);
  const shopItem = useUi((s) => s.shopItem);
  const colour = state.players[acting]?.colour ?? "blue";
  const province = session.displayProvince();
  const selectedTile = selected ? tileAt(state, selected) : null;
  const ownUnit = selectedTile?.unit && selectedTile.owner === state.activePlayerIndex ? selectedTile.unit : null;
  const cards = shopCards(state, province, ownUnit, shopItem);
  const income = province ? provinceNet(state, province) : 0;
  const gold = province?.gold ?? 0;
  const base = hudColour(colour);
  const accent = darken(PLAYER_HEX[colour], 0.3);

  return (
    <div
      data-testid="hud-bar"
      data-colour={colour}
      role="toolbar"
      aria-label="Game controls"
      className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-2 px-2"
      style={{
        height: HUD_HEIGHT,
        backgroundColor: base,
        backgroundImage: `linear-gradient(45deg, ${accent} 25%, transparent 25%, transparent 75%, ${accent} 75%), linear-gradient(45deg, ${accent} 25%, transparent 25%, transparent 75%, ${accent} 75%)`,
        backgroundSize: "12px 12px",
        backgroundPosition: "0 0, 6px 6px",
        borderTop: `3px solid ${OUTLINE}`,
      }}
    >
      <div className="flex shrink-0 flex-col justify-center gap-1" style={{ minWidth: 72 }}>
        <div className="flex items-center gap-1" data-testid="hud-income" aria-label={`Income ${income}`}>
          <SpriteIcon sprite={{ kind: "income" }} size={24} title="income" />
          <span className="text-lg" style={pixelText}>
            {income}
          </span>
        </div>
        <div className="flex items-center gap-1" data-testid="hud-gold" aria-label={`Gold ${gold}`}>
          <SpriteIcon sprite={{ kind: "coin" }} size={24} title="gold" />
          <span className="text-lg" style={pixelText}>
            {gold}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1" data-testid="shop-cards" data-mode={ownUnit ? "merge" : "shop"}>
        {cards.map((card) => (
          <ShopCardButton
            key={card.item}
            card={card}
            colour={colour}
            biome={state.biome}
            onTap={() => session.tapCard(card.item)}
          />
        ))}
      </div>
      <UndoButton />
      <NextDayButton />
    </div>
  );
}
