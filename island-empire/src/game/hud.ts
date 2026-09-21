import { RULES } from "@/engine/types";
import type { BuyItem, GameState, Province, RuntimeTile, TileCoord, UnitLevel } from "@/engine/types";

import { itemCost, knightLevelOf, tileAt } from "./economy";

/**
 * Pure HUD logic (SPEC §3.5, §7, D10): which four cards show, what each
 * costs, and whether it is affordable — so the React bar is only markup.
 */

export type CardState = "affordable" | "unaffordable" | "disabled" | "active";

export interface ShopCard {
  item: BuyItem;
  label: string;
  price: number;
  state: CardState;
  /** Shown on the label strip: BUY, MONEY. */
  strip: "BUY" | "MONEY";
  /** Merge mode: the card sits over a selected unit. */
  merge: boolean;
}

export const DEFAULT_CARDS: BuyItem[] = ["knight1", "woodwall", "stoneTower", "farm"];
export const MERGE_CARDS: BuyItem[] = ["knight1", "knight2", "knight3", "knight4"];

export function itemLabel(item: BuyItem): string {
  const level = knightLevelOf(item);
  if (level !== null) return `KNIGHT L${level}`;
  if (item === "woodwall") return "WOODWALL";
  if (item === "stoneTower") return "STONE TOWER";
  return "FARM";
}

export function shopCards(
  state: GameState,
  province: Province | null,
  selectedUnit: { level: UnitLevel } | null,
  activeItem: BuyItem | null,
): ShopCard[] {
  const merge = selectedUnit !== null;
  const items = merge ? MERGE_CARDS : DEFAULT_CARDS;
  const gold = province?.gold ?? 0;
  return items.map((item) => {
    const price = itemCost(state, item, province);
    const level = knightLevelOf(item);
    const affordable = gold >= price;
    let cardState: CardState = affordable ? "affordable" : "unaffordable";
    if (merge && level !== null && selectedUnit && selectedUnit.level + level > RULES.maxUnitLevel) cardState = "disabled";
    if (!merge && activeItem === item) cardState = "active";
    return {
      item,
      label: itemLabel(item),
      price,
      state: cardState,
      strip: affordable ? "BUY" : "MONEY",
      merge,
    };
  });
}

export interface InfoCardData {
  title: string;
  cost: number | null;
  upkeep: number | null;
  strength: number | null;
  income: number | null;
  sprite: BuyItem | "city" | "mine" | "chest";
  level: UnitLevel | null;
}

/** The info card for a tapped unit or building, or null for plain land. */
export function infoFor(state: GameState, at: TileCoord | null): InfoCardData | null {
  if (!at) return null;
  const t: RuntimeTile | null = tileAt(state, at);
  if (!t) return null;
  if (t.unit) {
    const l = t.unit.level;
    return {
      title: `KNIGHT LEVEL ${l}`,
      cost: RULES.knight.cost[l],
      upkeep: RULES.knight.upkeep[l],
      strength: l,
      income: null,
      sprite: `knight${l}`,
      level: l,
    };
  }
  switch (t.building) {
    case "woodwall":
      return { title: "WOODWALL", cost: RULES.woodwall.cost, upkeep: RULES.woodwall.upkeep, strength: RULES.woodwall.strength, income: null, sprite: "woodwall", level: null };
    case "stoneTower":
      return { title: "STONE TOWER", cost: RULES.stoneTower.cost, upkeep: RULES.stoneTower.upkeep, strength: RULES.stoneTower.strength, income: null, sprite: "stoneTower", level: null };
    case "farm":
      return { title: "FARM", cost: RULES.farm.baseCost, upkeep: 0, strength: 0, income: RULES.farm.income, sprite: "farm", level: null };
    case "city":
      return { title: "CITY", cost: null, upkeep: 0, strength: RULES.city.strength, income: null, sprite: "city", level: null };
    case "mine":
      return { title: "MINE", cost: null, upkeep: 0, strength: 0, income: RULES.mine.income, sprite: "mine", level: null };
    case "chest":
      return { title: "CHEST", cost: null, upkeep: null, strength: null, income: RULES.chest.bonus, sprite: "chest", level: null };
    default:
      return null;
  }
}
