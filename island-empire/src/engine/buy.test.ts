import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { legalBuildZone } from "./rules";
import { END, at, buy, move, provinceOf, run, stateFrom, tile } from "./testing/fixtures";

const sorted = (list: { x: number; y: number }[]) => list.map((c) => `${c.x},${c.y}`).sort();

/** Blue: x1..3 with the city at (1,1); a bridge at (2,3); red at x5..6. */
const board = {
  terrain: ["~~~~~~~~", "~......~", "~......~", "~.=....~", "~~~~~~~~", "~~~~~~~~"],
  owners: ["........", ".000.11.", ".000.11.", ".000....", "........", "........"],
  objects: ["........", ".C...C..", "........", "........", "........", "........"],
  startGold: 30,
};

describe("BUY (SPEC §3.4, §3.5, D10, D11)", () => {
  it("places a knight1 peacefully (ready), spending from the tile's province", () => {
    const r = apply(stateFrom(board), buy("knight1", at(2, 2)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 2, 2).unit).toEqual({ level: 1, readyToMove: true });
    expect(provinceOf(r.state, 1, 1).gold).toBe(20);
    expect(r.events).toEqual([{ type: "bought", item: "knight1", at: at(2, 2), cost: 10, provinceId: "p0-1-1" }]);
  });

  it("any knight level may be placed directly on an empty own tile at 10 gold per level (D41)", () => {
    const s = stateFrom({ ...board, startGold: 40 });
    expect(legalBuildZone(s, "knight2")).toContainEqual(at(2, 2));
    const r = apply(s, buy("knight2", at(2, 2)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 2, 2)).toMatchObject({ unit: { level: 2, readyToMove: true } });
    expect(provinceOf(r.state, 1, 1).gold).toBe(20);
    expect(apply(s, buy("knight4", at(2, 2))).error).toBeUndefined();
  });

  it("rejects unaffordable, occupied and foreign placements with clear errors", () => {
    const s = stateFrom({ ...board, startGold: 4 });
    expect(apply(s, buy("woodwall", at(2, 2))).error).toBe("not enough gold");
    const rich = stateFrom(board);
    expect(apply(rich, buy("farm", at(1, 1))).error).toBe("tile is not free to build on");
    expect(apply(rich, buy("farm", at(4, 2))).error).toBe("buildings can only be placed on own tiles");
    expect(apply(rich, buy("farm", at(0, 0))).error).toBe("cannot build on this terrain");
    expect(apply(rich, buy("knight1", at(6, 2))).error).toBe("target is not adjacent to a province that can pay");
  });

  it("walls may stand on a bridge but a farm may not", () => {
    const s = stateFrom(board);
    expect(apply(s, buy("woodwall", at(2, 3))).error).toBeUndefined();
    expect(apply(s, buy("farm", at(2, 3))).error).toBe("tile is not free to build on");
  });

  it("a knight1 bought onto an own field clears it and is spent", () => {
    const s = stateFrom({ ...board, terrain: ["~~~~~~~~", "~......~", "~.f....~", "~.=....~", "~~~~~~~~", "~~~~~~~~"] });
    const r = apply(s, buy("knight1", at(2, 2)));
    expect(r.error).toBeUndefined();
    expect(tile(r.state, 2, 2)).toMatchObject({ terrain: "grass", unit: { level: 1, readyToMove: false } });
    expect(r.events).toContainEqual({ type: "fieldCleared", at: at(2, 2) });
  });

  it("attack-buy is paid by the richest adjacent province that can afford it (D11)", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~~", "~.......~", "~.......~", "~.......~", "~~~~~~~~~", "~~~~~~~~~"],
      owners: [".........", ".00.00.1.", ".00.00.1.", ".........", ".........", "........."],
      objects: [".........", ".C..C..C.", ".........", ".........", ".........", "........."],
      startGold: 15,
    });
    // Left province has 15 gold, right province 0; (3,1) touches both.
    const r = apply(s, buy("knight1", at(3, 1)));
    expect(r.error).toBeUndefined();
    expect(r.events[0]).toMatchObject({ type: "bought", provinceId: "p0-1-1", cost: 10 });
    // The capture unites both provinces; the merged treasury is 5.
    expect(provinceOf(r.state, 3, 1).gold).toBe(5);
    expect(r.events).toContainEqual({ type: "provinceMerged", survivingId: "p0-1-1", absorbedIds: ["p0-4-1"] });
    // Too expensive for either → rejected before anything changes.
    expect(apply(s, buy("knight2", at(3, 1))).error).toBe("not enough gold");
  });

  it("legalBuildZone lists peaceful, attack-buy and merge-buy targets by card", () => {
    const s = stateFrom({ ...board, objects: ["........", ".C1..C..", "........", "........", "........", "........"], startGold: 30 });
    const k1 = sorted(legalBuildZone(s, "knight1"));
    expect(k1).toContain("2,2"); // empty own tile
    expect(k1).toContain("2,1"); // merge onto the L1
    expect(k1).toContain("4,1"); // neutral, defence 0, adjacent to the province
    expect(k1).not.toContain("5,2"); // red, covered by the red city
    expect(k1).not.toContain("1,1");
    const k2 = sorted(legalBuildZone(s, "knight2"));
    expect(k2).toContain("2,2"); // peaceful L2 placement (D41)
    expect(k2).toContain("2,1"); // merge → L3
    expect(k2).toContain("4,1"); // attack-buy
    const k4 = legalBuildZone(s, "knight4");
    expect(sorted(k4)).not.toContain("2,1"); // 1 + 4 > 4
    expect(k4).toEqual([]); // 40 > 30 gold
    const farm = sorted(legalBuildZone(s, "farm"));
    expect(farm).toContain("2,2");
    expect(farm).not.toContain("2,3"); // bridge
    expect(sorted(legalBuildZone(s, "woodwall"))).toContain("2,3");
    const red = run(s, END);
    expect(legalBuildZone(red, "knight1")).not.toContainEqual(at(2, 2));
  });

  it("a bought knight may act in the same turn", () => {
    const s = stateFrom(board);
    const r = run(s, buy("knight1", at(3, 2)), move(at(3, 2), at(4, 2)));
    expect(tile(r, 4, 2)).toMatchObject({ owner: 0, unit: { level: 1, readyToMove: false } });
  });
});
