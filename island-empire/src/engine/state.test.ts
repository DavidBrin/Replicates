import { describe, expect, it } from "vitest";
import { createInitialState } from "./state";
import { asciiMap } from "./testing/asciiMap";
import { padSpec, provinceOf, stateFrom, tile } from "./testing/fixtures";

/** Blue has two provinces (cities at (1,1) and (5,1)); red one; green one. */
const spec = {
  terrain: ["~~~~~~~~~~", "~........~", "~........~", "~........~", "~~~~~~~~~~", "~~~~~~~~~~"],
  owners: ["..........", ".00.00.11.", ".00.00.11.", ".22.......", "..........", ".........."],
  objects: ["..........", ".C1.C..C1.", "..........", ".C1.......", "..........", ".........."],
  startGold: 13,
  players: { 1: { aiDifficulty: "hard" as const } },
};

describe("createInitialState (SPEC §3.5, §3.8, D14)", () => {
  it("gives startGold to the first province (lowest y,x city) and 0 to the rest", () => {
    const s = stateFrom(spec);
    expect(provinceOf(s, 1, 1).gold).toBe(13);
    expect(provinceOf(s, 5, 1).gold).toBe(0);
    expect(provinceOf(s, 1, 3).gold).toBe(13);
  });

  it("gives every province startGold when startGoldPerProvince is set", () => {
    const s = stateFrom({ ...spec, startGoldPerProvince: true });
    expect(provinceOf(s, 1, 1).gold).toBe(13);
    expect(provinceOf(s, 5, 1).gold).toBe(13);
  });

  it("scales AI seats' gold by the map's difficulty table, rounded to nearest", () => {
    const table = { easy: { aiStartGoldMultiplier: 0.5 }, normal: { aiStartGoldMultiplier: 1 }, hard: { aiStartGoldMultiplier: 1.5 } };
    const map = asciiMap(padSpec({ ...spec, difficulty: table }));
    const easy = createInitialState(map, 1, { difficulty: "easy" });
    expect(provinceOf(easy, 1, 1).gold).toBe(13); // human: never scaled
    expect(provinceOf(easy, 7, 1).gold).toBe(7); // 6.5 → 7
    expect(provinceOf(easy, 1, 3).gold).toBe(7);
    const hard = createInitialState(map, 1, { difficulty: "hard" });
    expect(provinceOf(hard, 7, 1).gold).toBe(20); // 19.5 → 20
    // Without a session difficulty the seat's own aiDifficulty decides.
    const own = createInitialState(map, 1);
    expect(provinceOf(own, 7, 1).gold).toBe(20); // red is authored hard
    expect(provinceOf(own, 1, 3).gold).toBe(13); // green defaults to normal
    expect(own.players[1]?.aiDifficulty).toBe("hard");
    expect(own.players[2]?.aiDifficulty).toBe("normal");
    // No table on the map → the default RULES multipliers apply.
    const bare = createInitialState(asciiMap(padSpec(spec)), 1, { difficulty: "easy" });
    expect(provinceOf(bare, 1, 3).gold).toBe(7);
  });

  it("applies the seats override for kind and difficulty", () => {
    const map = asciiMap(padSpec(spec));
    const s = createInitialState(map, 1, { seats: [{ kind: "ai", aiDifficulty: "easy" }, { kind: "human" }, { kind: "ai", aiDifficulty: "hard" }] });
    expect(s.players.map((p) => [p.kind, p.aiDifficulty])).toEqual([["ai", "easy"], ["human", null], ["ai", "hard"]]);
    expect(provinceOf(s, 1, 1).gold).toBe(7); // now an easy AI: 13 × 0.5 → 6.5 → 7
    expect(provinceOf(s, 7, 1).gold).toBe(13); // now human
  });

  it("readies only seat 0's units, starts on turn 0 with a snapshot and the given seed", () => {
    const s = stateFrom(spec, 99);
    expect(tile(s, 2, 1).unit).toEqual({ level: 1, readyToMove: true });
    expect(tile(s, 8, 1).unit).toEqual({ level: 1, readyToMove: false });
    expect(tile(s, 2, 3).unit).toEqual({ level: 1, readyToMove: false });
    expect(s.turnNumber).toBe(0);
    expect(s.activePlayerIndex).toBe(0);
    expect(s.rng.seed).toBe(99);
    expect(s.history).toEqual([]);
    expect(s.outcome).toBeNull();
    expect(s.turnStart).toEqual({ ...s, history: undefined, turnStart: undefined });
    expect(s.players.every((p) => !p.eliminated)).toBe(true);
  });

  it("assigns province ids from the city tile and links every tile to its province", () => {
    const s = stateFrom(spec);
    expect(Object.keys(s.provinces).sort()).toEqual(["p0-1-1", "p0-4-1", "p1-7-1", "p2-1-3"]);
    for (const p of Object.values(s.provinces)) {
      for (const key of p.tileKeys) {
        const [x, y] = key.split(",").map(Number) as [number, number];
        expect(tile(s, x, y).provinceId).toBe(p.id);
        expect(tile(s, x, y).owner).toBe(p.owner);
      }
      expect(tile(s, p.city.x, p.city.y).building).toBe("city");
    }
  });

  it("places a city in a city-less second province and clears buildings from lone tiles", () => {
    const s = stateFrom({
      ...spec,
      owners: ["..........", ".00.00.11.", ".00.00.11.", ".22...0...", "..........", ".........."],
      objects: ["..........", ".C1....C1.", "..........", ".C1.......", "..........", ".........."],
    });
    const second = provinceOf(s, 4, 1);
    expect(tile(s, second.city.x, second.city.y).building).toBe("city");
    expect(tile(s, 6, 3).provinceId).toBeNull();
  });

  it("throws on an invalid map or an empty seat without override", () => {
    const map = asciiMap(padSpec(spec));
    expect(() => createInitialState({ ...map, width: 3 }, 1)).toThrow(/invalid map/);
    const empty = { ...map, players: map.players.map((p, i) => (i === 1 ? { ...p, kind: "empty" as const } : p)) };
    expect(() => createInitialState(empty, 1)).toThrow(/seat 1 is empty/);
    expect(createInitialState(empty, 1, { seats: [{ kind: "human" }, { kind: "ai" }, { kind: "ai" }] }).players[1]?.kind).toBe("ai");
  });
});
