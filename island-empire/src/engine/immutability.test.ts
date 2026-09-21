import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { serializeState } from "./serialize";
import type { GameState } from "./types";
import { END, UNDO, at, buy, move, stateFrom } from "./testing/fixtures";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

describe("apply never mutates its input (SPEC §4 rule 4)", () => {
  const spec = {
    terrain: ["~~~~~~~~~", "~.......~", "~.......~", "~.......~", "~~~~~~~~~", "~~~~~~~~~"],
    owners: [".........", ".000.11..", ".000.11..", ".000.....", ".........", "........."],
    objects: [".........", ".C1..C...", "..1......", ".........", ".........", "........."],
    startGold: 30,
  };

  it("works on a deeply frozen state through a whole turn", () => {
    let s: GameState = deepFreeze(stateFrom(spec));
    const actions = [move(at(2, 1), at(3, 1)), buy("knight1", at(2, 3)), move(at(3, 1), at(4, 1)), buy("woodwall", at(1, 3)), UNDO, END, END];
    for (const a of actions) {
      const before = serializeState(s);
      const r = apply(s, a);
      expect(r.error).toBeUndefined();
      expect(serializeState(s)).toBe(before);
      expect(r.state).not.toBe(s);
      s = deepFreeze(r.state);
    }
  });

  it("shares untouched tiles structurally", () => {
    const s = stateFrom(spec);
    const r = apply(s, move(at(2, 1), at(3, 1))).state;
    expect(r.tiles).not.toBe(s.tiles);
    expect(r.tiles[0]).toBe(s.tiles[0]);
    expect(r.tiles[1 * 9 + 2]).not.toBe(s.tiles[1 * 9 + 2]);
    expect(r.provinces["p1-5-1"]).toBe(s.provinces["p1-5-1"]);
  });

  it("returns the very same state object on rejection", () => {
    const s = stateFrom(spec);
    const r = apply(s, move(at(2, 1), at(7, 1)));
    expect(r.error).toBeDefined();
    expect(r.state).toBe(s);
  });
});
