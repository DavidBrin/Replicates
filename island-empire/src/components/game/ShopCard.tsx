"use client";

import type { ShopCard as ShopCardData } from "@/game/hud";
import { OUTLINE, UI } from "@/render/palette";
import type { SpriteKey } from "@/render/sprites";
import type { Biome, PlayerColour } from "@/engine/types";

import { SpriteIcon } from "./SpriteIcon";
import { pixelTextSmall } from "./styles";

/**
 * One shop card (SPEC §7, research §6): price in the header, the portrait
 * on green, a label strip. Yellow body = affordable, red body + "MONEY" =
 * unaffordable, green strip = merge-mode BUY, grey = disabled merge.
 */
export function ShopCardButton({
  card,
  colour,
  biome,
  onTap,
}: {
  card: ShopCardData;
  colour: PlayerColour;
  biome: Biome;
  onTap: () => void;
}) {
  const disabled = card.state === "disabled";
  const body =
    card.state === "unaffordable"
      ? UI.unaffordableRed
      : card.state === "active"
        ? UI.buyGreen
        : disabled
          ? UI.disabledGrey
          : UI.cardYellow;
  const strip = card.state === "unaffordable" ? UI.unaffordableRed : card.merge || card.state === "active" ? UI.buyGreen : UI.cardYellow;
  const sprite: SpriteKey = { kind: card.item, colour, biome };
  return (
    <button
      type="button"
      data-testid={`card-${card.item}`}
      data-state={card.state}
      aria-label={`${card.label}, ${card.price} gold, ${card.strip}`}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={disabled ? undefined : onTap}
      className="flex shrink-0 flex-col items-stretch overflow-hidden text-center"
      style={{
        width: 64,
        height: 84,
        background: body,
        border: `3px solid ${OUTLINE}`,
        borderRadius: 6,
        opacity: disabled ? 0.55 : 1,
        boxShadow: card.state === "active" ? `0 0 0 2px #FFFFFF` : "none",
        padding: 0,
      }}
    >
      <span className="flex items-center justify-center gap-1 text-[12px]" style={{ ...pixelTextSmall, height: 16 }}>
        <SpriteIcon sprite={{ kind: "coin" }} size={12} title="gold" />
        {card.price}
      </span>
      <span className="flex flex-1 items-end justify-center" style={{ background: UI.cardGreen, borderTop: `2px solid ${OUTLINE}`, borderBottom: `2px solid ${OUTLINE}` }}>
        <SpriteIcon sprite={sprite} size={36} title={card.label} />
      </span>
      <span className="text-[11px]" style={{ ...pixelTextSmall, background: strip, height: 18, lineHeight: "18px" }}>
        {card.strip}
      </span>
    </button>
  );
}
