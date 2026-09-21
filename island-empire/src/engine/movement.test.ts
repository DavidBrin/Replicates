import { describe, expect, it } from "vitest";
import { computeMoveZone, legalMoveZone } from "./moveZone";
import { apply } from "./reducer";
import { END, at, move, run, stateFrom, tile } from "./testing/fixtures";

const sorted = (list: { x: number; y: number }[]) => list.map((c) => `${c.x},${c.y}`).sort();

describe("move zone (SPEC §3.4, D2)", () => {
  /** A 1-tile-high corridor 9 long, blue owns it all; unit at the left end. */
  const corridor = {
    terrain: ["~~~~~~~~~~~~", "~..........~", "~..........~", "~~~~~~~~~~~~"],
    owners: ["............", ".0000000000.", ".0000000011.", "............"],
    objects: ["............", ".1..........", ".C.......C..", "............"],
  };

  it("floods 4 steps through own territory", () => {
    const s = stateFrom(corridor);
    const zone = legalMoveZone(s, at(1, 1));
    expect(zone).toContainEqual(at(5, 1)); // 4 steps east
    expect(zone).not.toContainEqual(at(6, 1)); // 5 steps
    expect(zone).toContainEqual(at(4, 2)); // 3 east + 1 south
    expect(zone).not.toContainEqual(at(1, 2)); // own city: never a destination
    expect(zone).not.toContainEqual(at(1, 1));
  });

  it("repositioning keeps the unit ready, so moves chain (D2)", () => {
    let s = stateFrom(corridor);
    s = run(s, move(at(1, 1), at(5, 1)));
    expect(tile(s, 5, 1).unit).toEqual({ level: 1, readyToMove: true });
    s = run(s, move(at(5, 1), at(9, 1)));
    expect(tile(s, 9, 1).unit).toEqual({ level: 1, readyToMove: true });
    expect(tile(s, 1, 1).unit).toBeNull();
    expect(s.history).toHaveLength(2);
  });

  it("is blocked by water, forest and mountain but crosses a bridge", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~", "~.^.T..~", "~.~=~..~", "~......~", "~......~", "~~~~~~~~"],
      owners: ["........", ".0.0.00.", ".0.0.00.", ".000000.", ".11.....", "........"],
      objects: ["........", ".1......", "........", "......C.", ".C......", "........"],
    });
    expect(sorted(legalMoveZone(s, at(1, 1)))).toEqual(["1,2", "1,3", "2,3", "3,3"]); // 4 steps around the water
    const closer = run(s, move(at(1, 1), at(2, 3)));
    const zone = sorted(legalMoveZone(closer, at(2, 3)));
    expect(zone).toContain("3,2"); // the bridge
    expect(zone).toContain("3,1"); // across it
    expect(zone).not.toContain("2,2"); // water
    expect(zone).not.toContain("4,2"); // water
    expect(zone).not.toContain("2,1"); // mountain
    expect(zone).not.toContain("4,1"); // forest
  });

  it("does not pass through own buildings or units except to merge", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~~~~~..~"],
      owners: ["........", ".000000.", ".....11."],
      objects: ["........", ".1W.C1..", ".....C.."],
    });
    const zone = sorted(legalMoveZone(s, at(1, 1)));
    expect(zone).toEqual([]); // the wall seals the corridor
    const s2 = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~~~~~..~"],
      owners: ["........", ".000000.", ".....11."],
      objects: ["........", ".1.1..C.", ".....C.."],
    });
    const zone2 = sorted(legalMoveZone(s2, at(1, 1)));
    expect(zone2).toEqual(["2,1", "3,1"]); // (3,1) is a merge target; nothing beyond it
  });

  it("offers own fields and graves as terminal destinations that end the turn", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~", "~.fg...~", "~......~", "~......~"],
      owners: ["........", ".000000.", ".000000.", ".....11."],
      objects: ["........", ".1......", "......C.", ".....C.."],
    });
    const zone = sorted(legalMoveZone(s, at(1, 1)));
    expect(zone).toContain("2,1"); // the field, adjacent
    expect(zone).toContain("3,1"); // the grave, via (1,2) (2,2) (3,2)
    expect(zone).not.toContain("4,1"); // beyond the terminal grave — fields are not corridors
    const cleared = run(s, move(at(1, 1), at(2, 1)));
    expect(tile(cleared, 2, 1)).toMatchObject({ terrain: "grass", unit: { level: 1, readyToMove: false } });
    expect(apply(cleared, move(at(2, 1), at(3, 1))).error).toBe("unit has already acted this turn");
    const grave = run(s, move(at(1, 1), at(3, 1)));
    expect(tile(grave, 3, 1)).toMatchObject({ terrain: "grass", graveAge: 0, unit: { level: 1, readyToMove: false } });
  });

  it("only offers capturable fringe tiles the unit can beat", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~......~", "~~~~~~~~"],
      owners: ["........", ".0011...", ".0011...", "........"],
      objects: ["........", ".C1.C...", "....2...", "........"],
    });
    // (3,1) is covered by the red city (1); (3,2) by the red L2 (2).
    expect(computeMoveZone(s, at(2, 1)).capturable).toEqual([]);
    const l2 = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~......~", "~~~~~~~~"],
      owners: ["........", ".0011...", ".0011...", "........"],
      objects: ["........", ".C2.C...", "....2...", "........"],
    });
    expect(sorted(computeMoveZone(l2, at(2, 1)).capturable)).toEqual(["3,1"]);
    const l3 = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~......~", "~~~~~~~~"],
      owners: ["........", ".0011...", ".0011...", "........"],
      objects: ["........", ".C3.C...", "....2...", "........"],
    });
    expect(sorted(computeMoveZone(l3, at(2, 1)).capturable)).toEqual(["3,1", "3,2"]);
  });

  it("rejects moves for units that are not the active player's, off-board, or in place", () => {
    const s = stateFrom(corridor);
    expect(apply(s, move(at(1, 1), at(1, 1))).error).toMatch(/own tile/);
    expect(apply(s, move(at(0, 0), at(1, 1))).error).toBe("no unit at unitAt");
    expect(apply(s, move(at(50, 1), at(1, 1))).error).toMatch(/out of bounds/);
    expect(apply(s, move(at(1, 1), at(1, 2))).error).toBe("destination is not reachable");
    const red = run(s, END);
    expect(apply(red, move(at(1, 1), at(2, 1))).error).toBe("unit belongs to another player");
    expect(legalMoveZone(red, at(1, 1))).toEqual([]);
  });

  it("a unit standing on a lone tile can still attack its neighbours", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~......~", "~......~"],
      owners: ["........", ".00..0..", ".00.....", ".11....."],
      objects: ["........", ".C...2..", "........", ".C......"],
    });
    expect(tile(s, 5, 1).provinceId).toBeNull();
    const zone = sorted(legalMoveZone(s, at(5, 1)));
    expect(zone).toEqual(["4,1", "5,2", "6,1"]);
  });
});
