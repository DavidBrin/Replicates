import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { END, at, buy, move, provinceOf, run, stateFrom, tile } from "./testing/fixtures";

const terrain = ["~~~~~~~~", "~......~", "~......~", "~~~~~~~~"];
const owners = ["........", ".0000.1.", ".0000.1.", "........"];

describe("merge (SPEC §3.4, §3.5)", () => {
  it("sums levels up to 4 and rejects beyond", () => {
    const s = stateFrom({ terrain, owners, objects: ["........", ".C12..C.", "..3.....", "........"] });
    const merged = run(s, move(at(2, 1), at(3, 1)));
    expect(tile(merged, 3, 1).unit).toEqual({ level: 3, readyToMove: true });
    expect(tile(merged, 2, 1).unit).toBeNull();
    const tooBig = apply(merged, move(at(3, 1), at(2, 2)));
    expect(tooBig.error).toBe("merge would exceed level 4");
    const s2 = stateFrom({ terrain, owners, objects: ["........", ".C22..C.", "........", "........"] });
    expect(tile(run(s2, move(at(2, 1), at(3, 1))), 3, 1).unit?.level).toBe(4);
  });

  it("the merged unit stays ready only if both sources were ready", () => {
    // A unit that attacked (spent) merged into by a ready one → spent.
    const s = stateFrom({ terrain, owners, objects: ["........", ".C1.1.C.", "........", "........"] });
    const spent = run(s, move(at(4, 1), at(5, 1))); // captures the neutral tile, spends the unit
    expect(tile(spent, 5, 1).unit?.readyToMove).toBe(false);
    const merged = run(spent, move(at(2, 1), at(5, 1)));
    expect(tile(merged, 5, 1).unit).toEqual({ level: 2, readyToMove: false });
    // Both ready → merged unit ready.
    const fresh = run(s, move(at(2, 1), at(4, 1)));
    expect(tile(fresh, 4, 1).unit).toEqual({ level: 2, readyToMove: true });
  });

  it("buy-merge: the bought unit counts as ready, so readiness follows the selected unit", () => {
    const s = stateFrom({ terrain, owners, objects: ["........", ".C1.1.C.", "........", "........"], startGold: 50 });
    const ready = run(s, buy("knight2", at(2, 1)));
    expect(tile(ready, 2, 1).unit).toEqual({ level: 3, readyToMove: true });
    expect(provinceOf(ready, 1, 1).gold).toBe(30);
    const spent = run(s, move(at(4, 1), at(5, 1)), buy("knight1", at(5, 1)));
    expect(tile(spent, 5, 1).unit).toEqual({ level: 2, readyToMove: false });
    expect(apply(ready, buy("knight2", at(2, 1))).error).toBe("merge would exceed level 4");
    expect(apply(ready, buy("knight1", at(2, 1))).error).toBeUndefined();
  });

  it("emits moved + merged events with the new level", () => {
    const s = stateFrom({ terrain, owners, objects: ["........", ".C1.1.C.", "........", "........"] });
    const r = apply(s, move(at(2, 1), at(4, 1)));
    expect(r.events).toEqual([
      { type: "moved", from: at(2, 1), to: at(4, 1), player: 0 },
      { type: "merged", at: at(4, 1), newLevel: 2 },
    ]);
  });

  it("a merged unit may attack this turn when both parts were ready", () => {
    const s = stateFrom({ terrain, owners, objects: ["........", ".C1.1.C.", "......2.", "........"] });
    const merged = run(s, move(at(2, 1), at(4, 1)));
    // red's city (6,1) is defended by the L2 at (6,2): needs 3 → the L2 cannot take it, but can take (5,1)
    const r = apply(merged, move(at(4, 1), at(6, 1)));
    expect(r.error).toBe("attack blocked by defence");
    const captured = run(merged, move(at(4, 1), at(5, 1)));
    expect(tile(captured, 5, 1).owner).toBe(0);
    void END;
  });
});
