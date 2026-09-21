import { describe, expect, it } from "vitest";
import { RULES } from "./types";
import { farmPrice, provinceIncome, provinceUpkeep } from "./rules";
import { apply } from "./reducer";
import { END, at, buy, fullRound, provinceOf, run, stateFrom, tile } from "./testing/fixtures";

/** Blue owns a 3×3 block with a city; red owns a 2-tile province far away. */
const base = {
  terrain: ["~~~~~~~~", "~......~", "~......~", "~......~", "~......~", "~~~~~~~~"],
  owners: ["........", ".000....", ".000....", ".000....", ".....11.", "........"],
  objects: ["........", ".C......", "........", "........", ".....C..", "........"],
};

describe("economy (SPEC §3.2)", () => {
  it("counts +1 per plain tile, 0 for fields and graves, 5 for a farm, 8 for a mine", () => {
    const s = stateFrom({
      ...base,
      terrain: ["~~~~~~~~", "~......~", "~fg....~", "~......~", "~......~", "~~~~~~~~"],
      objects: ["........", ".C......", "...F....", ".M......", ".....C..", "........"],
    });
    const p = provinceOf(s, 1, 1);
    // 9 tiles: field 0 + grave 0 + farm 5 + mine 8 + 5 plain (incl. city) = 18
    expect(provinceIncome(s, p)).toBe(18);
  });

  it("charges knight upkeep 2/5/12/30 and 1 for a stone tower, 0 for a woodwall", () => {
    const s = stateFrom({ ...base, objects: ["........", ".C1.....", ".2W.....", ".34S....", ".....C..", "........"] });
    const p = provinceOf(s, 1, 1);
    expect(provinceUpkeep(s, p)).toBe(2 + 5 + 12 + 30 + RULES.stoneTower.upkeep);
  });

  it("escalates the farm price by 2 per farm already in the province", () => {
    let s = stateFrom({ ...base, startGold: 100 });
    const p0 = provinceOf(s, 1, 1);
    expect(farmPrice(s, p0)).toBe(12);
    s = run(s, buy("farm", at(2, 2)));
    expect(farmPrice(s, provinceOf(s, 1, 1))).toBe(14);
    expect(provinceOf(s, 1, 1).gold).toBe(88);
    s = run(s, buy("farm", at(3, 2)));
    expect(provinceOf(s, 1, 1).gold).toBe(88 - 14);
    expect(farmPrice(s, provinceOf(s, 1, 1))).toBe(16);
  });

  it("pays no income on day 1 (D36) and gold + income − upkeep from the second day", () => {
    let s = stateFrom({ ...base, startGold: 1 });
    // Red's day-1 turn start: no income.
    s = run(s, END);
    expect(provinceOf(s, 5, 4).gold).toBe(1);
    // Blue's second turn start: +9 income.
    s = run(s, END);
    expect(s.turnNumber).toBe(1);
    expect(provinceOf(s, 1, 1).gold).toBe(1 + 9);
  });

  it("emits income and upkeepPaid events at the city", () => {
    const s = run(stateFrom({ ...base, startGold: 5, objects: ["........", ".C1.....", "........", "........", ".....C..", "........"] }), END);
    const r = apply(s, END);
    expect(r.state.turnNumber).toBe(1);
    const city = at(1, 1);
    expect(r.events).toContainEqual({ type: "turnStarted", player: 0, turnNumber: 1 });
    expect(r.events).toContainEqual({ type: "income", provinceId: "p0-1-1", amount: 9, city });
    expect(r.events).toContainEqual({ type: "upkeepPaid", provinceId: "p0-1-1", amount: 2, city });
    expect(provinceOf(r.state, 1, 1).gold).toBe(5 + 9 - 2);
  });

  it("bankruptcy: units die into graves, buildings survive, gold floors at 0", () => {
    let s = stateFrom({ ...base, startGold: 0, objects: ["........", ".C4.....", ".W......", "........", ".....C..", "........"] });
    s = fullRound(s); // income 9, upkeep 30 → −21
    expect(provinceOf(s, 1, 1).gold).toBe(0);
    expect(tile(s, 2, 1).unit).toBeNull();
    expect(tile(s, 2, 1).terrain).toBe("grave");
    expect(tile(s, 2, 1).graveAge).toBe(0);
    expect(tile(s, 1, 2).building).toBe("woodwall");
  });

  it("a province exactly at zero after upkeep is not bankrupt", () => {
    let s = stateFrom({ ...base, startGold: 0, objects: ["........", ".C......", "...3....", "........", ".....C..", "........"] });
    // 9 income − 12 upkeep = −3 → bankrupt with 0 gold
    const broke = fullRound(s);
    expect(tile(broke, 3, 2).unit).toBeNull();
    expect(tile(broke, 3, 2).terrain).toBe("grave");
    s = stateFrom({ ...base, startGold: 3, objects: ["........", ".C......", "...3....", "........", ".....C..", "........"] });
    const fine = fullRound(s);
    expect(tile(fine, 3, 2).unit).toEqual({ level: 3, readyToMove: true });
    expect(provinceOf(fine, 1, 1).gold).toBe(0);
  });
});
