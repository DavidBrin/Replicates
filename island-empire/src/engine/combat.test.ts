import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { defenceNumber } from "./rules";
import { at, buy, move, provinceOf, run, stateFrom, tile } from "./testing/fixtures";

const terrain = ["~~~~~~~~", "~......~", "~......~", "~......~", "~......~", "~~~~~~~~"];

describe("defence number (SPEC §3.2, D4, D5)", () => {
  it("a unit projects its strength onto same-owner 4-neighbours only", () => {
    const s = stateFrom({
      terrain,
      owners: ["........", ".000.11.", ".000.11.", ".000....", "........", "........"],
      objects: ["........", ".C...C..", "..2.....", "........", "........", "........"],
    });
    expect(defenceNumber(s, at(2, 2))).toBe(2); // self
    expect(defenceNumber(s, at(2, 1))).toBe(2); // orthogonal neighbour
    expect(defenceNumber(s, at(1, 2))).toBe(2);
    expect(defenceNumber(s, at(3, 3))).toBe(0); // diagonal: never
    expect(defenceNumber(s, at(1, 1))).toBe(1); // city itself: 1 (unit is diagonal)
    expect(defenceNumber(s, at(2, 3))).toBe(2);
  });

  it("the city projects 1 onto its 4 neighbours", () => {
    const s = stateFrom({ terrain, owners: ["........", ".000.11.", ".000.11.", "........", "........", "........"], objects: ["........", ".C...C..", "........", "........", "........", "........"] });
    expect(defenceNumber(s, at(1, 1))).toBe(1);
    expect(defenceNumber(s, at(2, 1))).toBe(1);
    expect(defenceNumber(s, at(1, 2))).toBe(1);
    expect(defenceNumber(s, at(2, 2))).toBe(0);
  });

  it("walls and towers defend their own tile only", () => {
    const s = stateFrom({ terrain, owners: ["........", ".000.11.", ".000.11.", ".000....", "........", "........"], objects: ["........", ".C...C..", "..W.....", "..S.....", "........", "........"] });
    expect(defenceNumber(s, at(2, 2))).toBe(2);
    expect(defenceNumber(s, at(3, 2))).toBe(0);
    expect(defenceNumber(s, at(2, 3))).toBe(3);
    expect(defenceNumber(s, at(1, 3))).toBe(0);
    expect(defenceNumber(s, at(2, 1))).toBe(1); // city, not the wall below
  });

  it("does not project across an ownership border", () => {
    const s = stateFrom({ terrain, owners: ["........", ".00..11.", ".00..11.", "........", "........", "........"], objects: ["........", ".C...C..", ".....4..", "........", "........", "........"] });
    expect(defenceNumber(s, at(4, 2))).toBe(0); // neutral tile next to red's L4
    expect(defenceNumber(s, at(6, 2))).toBe(4);
  });
});

describe("attack (SPEC §3.2 strict-greater, §3.4)", () => {
  const owners = ["........", ".000.11.", ".000.11.", ".000.11.", "........", "........"];

  it("succeeds only when strength > defence", () => {
    // blue x1..3, red x4..6; red city at (4,1) so (4,1) defends at 1 and (4,2) at 1 too.
    const adjacent = ["........", ".000111.", ".000111.", ".000111.", "........", "........"];
    const s = stateFrom({ terrain, owners: adjacent, objects: ["........", ".C.2C...", "...1....", "...1....", "........", "........"] });
    const l1 = apply(s, move(at(3, 2), at(4, 2)));
    expect(l1.error).toBe("attack blocked by defence"); // the city projects onto (4,2)
    const l1far = apply(s, move(at(3, 3), at(4, 3)));
    expect(l1far.error).toBeUndefined(); // (4,3) is two tiles from the city: defence 0
    expect(tile(l1far.state, 4, 3)).toMatchObject({ owner: 0, unit: { level: 1, readyToMove: false } });
    const l2 = apply(s, move(at(3, 1), at(4, 1)));
    expect(l2.error).toBeUndefined();
    expect(tile(l2.state, 4, 1).building).toBeNull();
    expect(l2.events).toContainEqual({ type: "cityDestroyed", provinceId: "p1-4-1", owner: 1, at: at(4, 1) });
  });

  it("names walls in the rejection so the tutorial can react", () => {
    const adjacent = ["........", ".000111.", ".000111.", ".000111.", "........", "........"];
    const s = stateFrom({ terrain, owners: adjacent, objects: ["........", ".C.1.C..", "...W....", "........", "........", "........"] });
    // (3,2) is blue's own wall: the L1 at (3,1) may not walk onto it.
    expect(apply(s, move(at(3, 1), at(3, 2))).error).toBe("destination is not reachable");
    const s2 = stateFrom({ terrain, owners: adjacent, objects: ["........", ".C.1W.C.", "........", "........", "........", "........"] });
    expect(apply(s2, move(at(3, 1), at(4, 1))).error).toBe("attack blocked by wall");
    expect(apply(s2, move(at(3, 1), at(6, 1))).error).toBe("attack blocked by defence");
    expect(apply(s2, move(at(3, 1), at(0, 0))).error).toBe("destination is not passable terrain");
  });

  it("a killed defender vanishes without a grave; capture ends the attacker's turn", () => {
    const adjacent = ["........", ".000111.", ".000111.", ".000111.", "........", "........"];
    const s = stateFrom({ terrain, owners: adjacent, objects: ["........", ".C.2..C.", "....1...", "........", "........", "........"] });
    const r = run(s, move(at(3, 1), at(4, 2)));
    expect(tile(r, 4, 2)).toMatchObject({ owner: 0, terrain: "grass", unit: { level: 2, readyToMove: false } });
    expect(apply(r, move(at(4, 2), at(3, 2))).error).toBe("unit has already acted this turn");
  });

  it("captured farm / wall / tower are destroyed, a chest is collected, a mine survives (D35)", () => {
    const s = stateFrom({
      terrain,
      owners: ["........", ".000111.", ".000111.", ".000111.", "...0....", "........"],
      objects: ["........", ".C.4..C.", "...4F...", "...4M...", "...4$...", "........"],
      startGold: 0,
    });
    const farm = apply(s, move(at(3, 2), at(4, 2)));
    expect(farm.error).toBeUndefined();
    expect(tile(farm.state, 4, 2).building).toBeNull();
    expect(farm.events).toContainEqual({ type: "buildingDestroyed", at: at(4, 2), building: "farm", owner: 1 });

    const mine = apply(s, move(at(3, 3), at(4, 3)));
    expect(mine.error).toBeUndefined();
    expect(tile(mine.state, 4, 3)).toMatchObject({ owner: 0, building: "mine", unit: { level: 4 } });

    const chest = apply(s, move(at(3, 4), at(4, 4)));
    expect(chest.error).toBeUndefined();
    expect(chest.events).toContainEqual({ type: "chestCollected", at: at(4, 4), amount: 10 });
    expect(tile(chest.state, 4, 4)).toMatchObject({ owner: 0, building: null, provinceId: "p0-1-1" });
    expect(provinceOf(chest.state, 1, 1).gold).toBe(10);

    // Walls are player purchases, so a map may only author them on owned land (codex round 3).
    const wall = stateFrom({
      terrain,
      owners: ["........", ".000111.", ".000111.", ".000111.", "........", "........"],
      objects: ["........", ".C.4.C..", "....W...", "........", "........", "........"],
    });
    const r = apply(wall, move(at(3, 1), at(4, 2)));
    expect(r.events).toContainEqual({ type: "buildingDestroyed", at: at(4, 2), building: "woodwall", owner: 1 });
    expect(tile(r.state, 4, 2).building).toBeNull();
  });

  it("attack-buy places the new knight straight onto the captured tile", () => {
    const s = stateFrom({ terrain, owners, objects: ["........", ".C...C..", "........", "........", "........", "........"], startGold: 25 });
    const r = apply(s, buy("knight2", at(4, 2)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 4, 2)).toMatchObject({ owner: 0, unit: { level: 2, readyToMove: false } });
    expect(provinceOf(r.state, 1, 1).gold).toBe(5);
    expect(r.events[0]).toMatchObject({ type: "bought", item: "knight2", cost: 20 });
    expect(r.events).toContainEqual({ type: "captured", at: at(4, 2), from: null, to: 0, attackerFrom: null });
  });
});
