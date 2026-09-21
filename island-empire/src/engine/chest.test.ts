import { describe, expect, it } from "vitest";
import { legalMoveZone } from "./moveZone";
import { apply } from "./reducer";
import { legalBuildZone } from "./rules";
import { at, buy, move, provinceOf, stateFrom, tile } from "./testing/fixtures";

/** Blue x1..3 (city (1,1), L1 at (2,1)); a chest at (3,2) and a mine at (3,3) on blue land; red x5..6. */
const board = {
  terrain: ["~~~~~~~~", "~......~", "~......~", "~......~", "~~~~~~~~", "~~~~~~~~"],
  owners: ["........", ".000.11.", ".000.11.", ".000....", "........", "........"],
  objects: ["........", ".C1..C..", "...$....", "...M....", "........", "........"],
  startGold: 10,
};

describe("chests and mines are enterable (SPEC §3.4, D35)", () => {
  it("an own chest is in the move zone; stepping onto it collects +10 and keeps the unit ready", () => {
    const s = stateFrom(board);
    expect(legalMoveZone(s, at(2, 1))).toContainEqual(at(3, 2));
    const r = apply(s, move(at(2, 1), at(3, 2)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 3, 2)).toMatchObject({ building: null, unit: { level: 1, readyToMove: true } });
    expect(provinceOf(r.state, 1, 1).gold).toBe(20);
    expect(r.events).toEqual([
      { type: "moved", from: at(2, 1), to: at(3, 2), player: 0 },
      { type: "chestCollected", at: at(3, 2), amount: 10 },
    ]);
  });

  it("an own mine is walkable and a unit may stand on it", () => {
    const s = stateFrom(board);
    expect(legalMoveZone(s, at(2, 1))).toContainEqual(at(3, 3));
    const r = apply(s, move(at(2, 1), at(3, 3)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 3, 3)).toMatchObject({ building: "mine", unit: { level: 1, readyToMove: true } });
    // and onward from the mine
    expect(legalMoveZone(r.state, at(3, 3))).toContainEqual(at(2, 3));
  });

  it("a knight1 may be bought onto an own chest (collecting it) or an own mine", () => {
    const s = stateFrom(board);
    expect(legalBuildZone(s, "knight1")).toContainEqual(at(3, 2));
    expect(legalBuildZone(s, "knight1")).toContainEqual(at(3, 3));
    expect(legalBuildZone(s, "farm")).not.toContainEqual(at(3, 2));
    expect(legalBuildZone(s, "woodwall")).not.toContainEqual(at(3, 3));
    const r = apply(s, buy("knight1", at(3, 2)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 3, 2)).toMatchObject({ building: null, unit: { level: 1, readyToMove: true } });
    expect(provinceOf(r.state, 1, 1).gold).toBe(10); // −10 +10
    expect(r.events).toContainEqual({ type: "chestCollected", at: at(3, 2), amount: 10 });
    expect(tile(apply(s, buy("knight1", at(3, 3))).state, 3, 3)).toMatchObject({ building: "mine", unit: { level: 1 } });
  });

  it("a foreign chest / mine is captured by moving or buying onto it", () => {
    const s = stateFrom({ ...board, objects: ["........", ".C1..C..", "....$...", "....M...", "........", "........"], startGold: 10 });
    expect(legalMoveZone(s, at(2, 1))).toContainEqual(at(4, 2));
    const grabbed = apply(s, move(at(2, 1), at(4, 2)));
    expect(grabbed.error).toBeUndefined();
    expect(tile(grabbed.state, 4, 2)).toMatchObject({ owner: 0, building: null, provinceId: "p0-1-1" });
    expect(provinceOf(grabbed.state, 1, 1).gold).toBe(20);
    expect(grabbed.events).toContainEqual({ type: "chestCollected", at: at(4, 2), amount: 10 });
    const bought = apply(s, buy("knight1", at(4, 3)));
    expect(bought.error).toBeUndefined();
    expect(tile(bought.state, 4, 3)).toMatchObject({ owner: 0, building: "mine", unit: { level: 1, readyToMove: false } });
    expect(provinceOf(bought.state, 1, 1).gold).toBe(0);
  });
});
