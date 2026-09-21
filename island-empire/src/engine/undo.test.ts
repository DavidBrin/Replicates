import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { serializeState } from "./serialize";
import { END, UNDO, at, buy, move, provinceOf, run, stateFrom, tile } from "./testing/fixtures";

const board = {
  terrain: ["~~~~~~~~~~", "~........~", "~........~", "~........~", "~~~~~~~~~~", "~~~~~~~~~~"],
  owners: ["..........", ".0000.11..", ".0000.11..", "..........", "..........", ".........."],
  objects: ["..........", ".C1...C...", "..1.......", "..........", "..........", ".........."],
  startGold: 40,
};

describe("UNDO (SPEC §3.7, D13, D37)", () => {
  it("replays history minus the last action from the turn-start snapshot", () => {
    const s = stateFrom(board);
    const a = run(s, move(at(2, 1), at(4, 1)));
    const b = run(a, buy("woodwall", at(3, 2)));
    const c = run(b, move(at(4, 1), at(5, 1))); // capture
    expect(c.history).toHaveLength(3);
    const u1 = apply(c, UNDO);
    expect(u1.error).toBeUndefined();
    expect(u1.events).toEqual([{ type: "undone" }]);
    expect(serializeState(u1.state)).toBe(serializeState(b));
    const u2 = apply(u1.state, UNDO).state;
    expect(serializeState(u2)).toBe(serializeState(a));
    const u3 = apply(u2, UNDO).state;
    expect(serializeState(u3)).toBe(serializeState(s));
    expect(apply(u3, UNDO).error).toBe("nothing to undo");
  });

  it("is never recorded in history and END_TURN clears the stack", () => {
    const s = stateFrom(board);
    const a = run(s, move(at(2, 1), at(4, 1)), UNDO, move(at(2, 1), at(3, 1)));
    expect(a.history).toEqual([move(at(2, 1), at(3, 1))]);
    const ended = run(a, END);
    expect(ended.history).toEqual([]);
    expect(apply(ended, UNDO).error).toBe("nothing to undo");
  });

  it("restores gold, provinces and readiness exactly", () => {
    const s = stateFrom(board);
    const spent = run(s, buy("knight1", at(3, 1)), move(at(3, 1), at(5, 2)));
    expect(provinceOf(spent, 1, 1).gold).toBe(30);
    expect(tile(spent, 5, 2).owner).toBe(0);
    const back = run(spent, UNDO, UNDO);
    expect(provinceOf(back, 1, 1).gold).toBe(40);
    expect(tile(back, 5, 2).owner).toBeNull();
    expect(tile(back, 3, 1).unit).toBeNull();
    expect(tile(back, 2, 1).unit?.readyToMove).toBe(true);
  });
});
