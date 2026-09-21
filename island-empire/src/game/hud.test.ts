import { describe, expect, it } from "vitest";

import { createInitialState } from "@/engine";
import type { GameState, Province } from "@/engine/types";

import { DEMO_MAP } from "./demoMap";
import { infoFor, shopCards } from "./hud";

function demoState(): GameState {
  return createInitialState(DEMO_MAP, 7);
}

function provinceOf(state: GameState, owner: number): Province {
  const p = Object.values(state.provinces).find((x) => x.owner === owner);
  if (!p) throw new Error("no province");
  return p;
}

describe("shopCards", () => {
  it("shows Knight L1, Woodwall, Stone Tower, Farm with nothing selected", () => {
    const state = demoState();
    const cards = shopCards(state, provinceOf(state, 0), null, null);
    expect(cards.map((c) => c.item)).toEqual(["knight1", "woodwall", "stoneTower", "farm"]);
    expect(cards.map((c) => c.price)).toEqual([10, 5, 15, 14]); // demo province already has one farm: 12 + 2
    expect(cards.every((c) => !c.merge)).toBe(true);
  });

  it("marks cards yellow/affordable or red/MONEY by the province's gold", () => {
    const state = demoState();
    const p = { ...provinceOf(state, 0), gold: 12 };
    const cards = shopCards(state, p, null, null);
    expect(cards.find((c) => c.item === "knight1")).toMatchObject({ state: "affordable", strip: "BUY" });
    expect(cards.find((c) => c.item === "woodwall")).toMatchObject({ state: "affordable", strip: "BUY" });
    expect(cards.find((c) => c.item === "stoneTower")).toMatchObject({ state: "unaffordable", strip: "MONEY" });
    expect(cards.find((c) => c.item === "farm")).toMatchObject({ state: "unaffordable", strip: "MONEY" });
  });

  it("switches to the four knight merge cards when a unit is selected and disables over-cap merges", () => {
    const state = demoState();
    const p = { ...provinceOf(state, 0), gold: 100 };
    const cards = shopCards(state, p, { level: 2 }, null);
    expect(cards.map((c) => c.item)).toEqual(["knight1", "knight2", "knight3", "knight4"]);
    expect(cards.map((c) => c.state)).toEqual(["affordable", "affordable", "disabled", "disabled"]);
    expect(cards.every((c) => c.merge)).toBe(true);
    expect(cards.map((c) => c.price)).toEqual([10, 20, 30, 40]);
  });

  it("flags the active placement card", () => {
    const state = demoState();
    const cards = shopCards(state, { ...provinceOf(state, 0), gold: 50 }, null, "woodwall");
    expect(cards.find((c) => c.item === "woodwall")?.state).toBe("active");
    expect(cards.find((c) => c.item === "knight1")?.state).toBe("affordable");
  });

  it("with no province everything is unaffordable and the farm shows its base price", () => {
    const state = demoState();
    const cards = shopCards(state, null, null, null);
    expect(cards.every((c) => c.state === "unaffordable")).toBe(true);
    expect(cards.find((c) => c.item === "farm")?.price).toBe(12);
  });
});

describe("infoFor", () => {
  it("describes units and buildings and returns null for plain land", () => {
    const state = demoState();
    expect(infoFor(state, { x: 3, y: 4 })).toMatchObject({ title: "KNIGHT LEVEL 1", cost: 10, upkeep: 2, strength: 1 });
    expect(infoFor(state, { x: 4, y: 5 })).toMatchObject({ title: "KNIGHT LEVEL 2", cost: 20, upkeep: 5, strength: 2 });
    expect(infoFor(state, { x: 9, y: 5 })).toMatchObject({ title: "WOODWALL", cost: 5, upkeep: 0, strength: 2 });
    expect(infoFor(state, { x: 2, y: 5 })).toMatchObject({ title: "FARM", cost: 12, income: 5 });
    expect(infoFor(state, { x: 2, y: 4 })).toMatchObject({ title: "CITY", strength: 1 });
    expect(infoFor(state, { x: 8, y: 2 })).toMatchObject({ title: "MINE", income: 8 });
    expect(infoFor(state, { x: 3, y: 6 })).toMatchObject({ title: "STONE TOWER", cost: 15, upkeep: 1, strength: 3 });
    expect(infoFor(state, { x: 4, y: 1 })).toMatchObject({ title: "CHEST", income: 10 });
    expect(infoFor(state, { x: 1, y: 3 })).toBeNull();
    expect(infoFor(state, null)).toBeNull();
  });
});
