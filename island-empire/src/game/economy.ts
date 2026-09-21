import {
  buyCost,
  farmPrice,
  provinceAt as engineProvinceAt,
  provinceIncome,
  provinceUpkeep,
  provincesOf as engineProvincesOf,
  RULES,
} from "@/engine";
import type { BuyItem, GameState, Province, RuntimeTile, TileCoord, UnitLevel } from "@/engine/types";

/**
 * Thin read-only wrappers over the engine's economy helpers for the HUD
 * (income ⊕, gold ◎, card prices). No rule lives here: every number comes
 * from `src/engine/rules.ts`.
 */

export function tileAt(state: GameState, at: TileCoord): RuntimeTile | null {
  if (at.x < 0 || at.y < 0 || at.x >= state.width || at.y >= state.height) return null;
  return state.tiles[at.y * state.width + at.x] ?? null;
}

export function parseKey(k: string): TileCoord {
  const [x, y] = k.split(",").map(Number);
  return { x: x ?? 0, y: y ?? 0 };
}

/** Income a tile pays its province, for the coin-flight animation. */
export function tileIncome(t: RuntimeTile): number {
  if (t.terrain === "grassField" || t.terrain === "grave") return 0;
  if (t.building === "farm") return RULES.farm.income;
  if (t.building === "mine") return RULES.mine.income;
  return RULES.tileIncome;
}

/** Net income shown as ⊕ in the HUD: income minus upkeep. */
export function provinceNet(state: GameState, p: Province): number {
  return provinceIncome(state, p) - provinceUpkeep(state, p);
}

/** Card price; with no province the farm shows its base price. */
export function itemCost(state: GameState, item: BuyItem, province: Province | null): number {
  if (province) return buyCost(state, province, item);
  if (item === "farm") return RULES.farm.baseCost;
  const level = knightLevelOf(item);
  if (level !== null) return RULES.knight.cost[level];
  return item === "woodwall" ? RULES.woodwall.cost : RULES.stoneTower.cost;
}

export function farmCost(state: GameState, p: Province | null): number {
  return p ? farmPrice(state, p) : RULES.farm.baseCost;
}

export function knightItem(level: UnitLevel): BuyItem {
  return `knight${level}`;
}

export function knightLevelOf(item: BuyItem): UnitLevel | null {
  switch (item) {
    case "knight1":
      return 1;
    case "knight2":
      return 2;
    case "knight3":
      return 3;
    case "knight4":
      return 4;
    default:
      return null;
  }
}

/** Every province of a player, largest first. */
export function provincesOf(state: GameState, player: number): Province[] {
  return [...engineProvincesOf(state, player)].sort((a, b) => b.tileKeys.length - a.tileKeys.length);
}

export function provinceOfTile(state: GameState, at: TileCoord): Province | null {
  return engineProvinceAt(state, at);
}
