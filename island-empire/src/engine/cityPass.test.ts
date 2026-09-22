import { describe, expect, it } from "vitest";
import { legalMoveZone } from "./index";
import { computeMoveZone } from "./moveZone";
import { at, stateFrom } from "./testing/fixtures";

/**
 * D42: an own city is a corridor. A knight west of its city in a one-tile
 * pass can reach the tiles east of the city, but the city itself is never a
 * destination and the pass still costs steps.
 */
describe("movement through own cities and farms (D42)", () => {
  const board = {
    terrain: ["~~~~~~~~~", "~^^^^^^^~", "~.......~", "~^^^^^^.~", "~.......~", "~~~~~~~~~"],
    owners: [".........", ".........", ".0000000.", ".........", "......11.", "........."],
    objects: [".........", ".........", ".1.C.....", ".........", "......C1.", "........."],
    startGold: 0,
  };

  it("passes through the city but cannot stop on it", () => {
    const s = stateFrom(board);
    const zone = computeMoveZone(s, at(1, 2));
    const reachable = zone.reachable.map((c) => `${c.x},${c.y}`);
    expect(reachable).toContain("2,2"); // before the city
    expect(reachable).not.toContain("3,2"); // the city itself
    expect(reachable).toContain("4,2"); // just past the city (3 steps)
    expect(reachable).toContain("5,2"); // 4 steps: the budget's last tile
    expect(reachable).not.toContain("6,2"); // 5 steps: out of budget
    expect(legalMoveZone(s, at(1, 2)).map((c) => `${c.x},${c.y}`)).not.toContain("3,2");
  });

  it("passes through an own farm the same way", () => {
    const s = stateFrom({ ...board, objects: [".........", ".........", ".1.F.C...", ".........", "......C1.", "........."] });
    const reachable = computeMoveZone(s, at(1, 2)).reachable.map((c) => `${c.x},${c.y}`);
    expect(reachable).not.toContain("3,2"); // the farm
    expect(reachable).toContain("4,2"); // beyond the farm
    expect(reachable).not.toContain("5,2"); // the city beyond it is not a destination either
    expect(reachable).not.toContain("6,2"); // five steps: out of budget
  });

  it("still blocks on an own wall in the same pass", () => {
    const s = stateFrom({ ...board, objects: [".........", ".........", ".1.W.C...", ".........", "......C1.", "........."] });
    const reachable = computeMoveZone(s, at(1, 2)).reachable.map((c) => `${c.x},${c.y}`);
    expect(reachable).toContain("2,2");
    expect(reachable).not.toContain("4,2");
  });
});
