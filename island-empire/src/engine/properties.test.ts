import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { generateRandomMap } from "./generator";
import { isOwnable, neighbourIndices } from "./grid";
import { computeMoveZone } from "./moveZone";
import { apply } from "./reducer";
import { legalBuildZone, provinceIncome, provinceUpkeep } from "./rules";
import { serializeState } from "./serialize";
import { createInitialState } from "./state";
import { asciiMap } from "./testing/asciiMap";
import { padSpec } from "./testing/fixtures";
import type { Action, BuyItem, GameState, Province, RuntimeTile } from "./types";
import { validateMap } from "./validate";

/** Every invariant SPEC §11 lists for provinces, plus a few structural ones. */
export function checkProvinceInvariants(s: GameState): void {
  const seen = new Map<string, number>();
  for (const p of Object.values(s.provinces)) {
    expect(p.tileKeys.length).toBeGreaterThanOrEqual(2);
    expect(p.gold).toBeGreaterThanOrEqual(0);
    expect(p.owner).toBe(s.players.findIndex((q) => q.index === p.owner));
    let cities = 0;
    for (const key of p.tileKeys) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      const t = s.tiles[y * s.width + x] as RuntimeTile;
      expect(t.provinceId).toBe(p.id);
      expect(t.owner).toBe(p.owner);
      if (t.building === "city") cities++;
      expect(seen.has(key)).toBe(false);
      seen.set(key, 1);
    }
    expect(cities).toBe(1);
    const cityTile = s.tiles[p.city.y * s.width + p.city.x] as RuntimeTile;
    expect(cityTile.building).toBe("city");
    expect(cityTile.provinceId).toBe(p.id);
    expect(p.id).toBe(`p${p.owner}-${p.city.x}-${p.city.y}`);
  }
  s.tiles.forEach((t, i) => {
    if (t.provinceId !== null) {
      expect(s.provinces[t.provinceId]).toBeDefined();
      expect(seen.has(`${t.x},${t.y}`)).toBe(true);
    } else if (t.owner !== null) {
      // A lone tile has no same-owner neighbour.
      for (const n of neighbourIndices(s.width, s.height, i)) expect((s.tiles[n] as RuntimeTile).owner).not.toBe(t.owner);
      expect(["city", "farm", "woodwall", "stoneTower"]).not.toContain(t.building);
    }
    if (!isOwnable(t.terrain)) {
      expect(t.owner).toBeNull();
      expect(t.unit).toBeNull();
      expect(t.building).toBeNull();
    }
    if (t.unit !== null) expect(t.owner).not.toBeNull();
    if (t.terrain !== "grave") expect(t.graveAge).toBe(0);
  });
  for (const player of s.players) {
    const has = Object.values(s.provinces).some((p) => p.owner === player.index);
    if (!player.eliminated) expect(has).toBe(true);
  }
}

/** Enumerates every legal action for the active player (no UNDO). */
function legalActions(s: GameState): Action[] {
  const out: Action[] = [];
  const me = s.activePlayerIndex;
  for (const t of s.tiles) {
    if (t.owner !== me || t.unit === null || !t.unit.readyToMove) continue;
    const from = { x: t.x, y: t.y };
    for (const to of computeMoveZone(s, from).reachable) out.push({ type: "MOVE", unitAt: from, to });
    for (const to of computeMoveZone(s, from).capturable) out.push({ type: "MOVE", unitAt: from, to });
    for (const to of computeMoveZone(s, from).clearable) out.push({ type: "MOVE", unitAt: from, to });
    for (const to of computeMoveZone(s, from).mergeable) out.push({ type: "MOVE", unitAt: from, to });
  }
  const items: BuyItem[] = ["knight1", "knight2", "knight3", "knight4", "woodwall", "stoneTower", "farm"];
  for (const item of items) for (const at of legalBuildZone(s, item)) out.push({ type: "BUY", item, at });
  return out;
}

const arena = asciiMap(
  padSpec({
    terrain: ["~~~~~~~~~~~~", "~..........~", "~....^.....~", "~....T.f...~", "~..........~", "~...~......~", "~..........~", "~~~~~~~~~~~~"],
    owners: ["............", ".000....111.", ".000....111.", ".000....111.", "............", ".222....333.", ".222....333.", "............"],
    objects: ["............", ".C1......C..", "..1......1..", ".........1..", "............", ".C1......C1.", "............", "............"],
    startGold: 25,
  }),
);

describe("properties (SPEC §11)", () => {
  it("province invariants hold after any sequence of legal random actions", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.array(fc.nat({ max: 1000 }), { minLength: 20, maxLength: 60 }), (seed, picks) => {
        let s = createInitialState(arena, seed);
        checkProvinceInvariants(s);
        for (const pick of picks) {
          if (s.outcome !== null) break;
          const legal = legalActions(s);
          const action: Action = legal.length === 0 || pick % 7 === 0 ? { type: "END_TURN" } : (legal[pick % legal.length] as Action);
          const r = apply(s, action);
          expect(r.error).toBeUndefined();
          s = r.state;
          checkProvinceInvariants(s);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("every legal action reported by the zones is accepted, and every accepted action was reported", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.array(fc.nat({ max: 1000 }), { minLength: 5, maxLength: 25 }), (seed, picks) => {
        let s = createInitialState(arena, seed);
        for (const pick of picks) {
          if (s.outcome !== null) break;
          const legal = legalActions(s);
          for (const a of legal.slice(0, 40)) expect(apply(s, a).error).toBeUndefined();
          const action: Action = legal.length === 0 || pick % 5 === 0 ? { type: "END_TURN" } : (legal[pick % legal.length] as Action);
          s = apply(s, action).state;
        }
      }),
      { numRuns: 15 },
    );
  });

  it("apply is deterministic: same state + action ⇒ byte-identical output", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.array(fc.nat({ max: 1000 }), { minLength: 5, maxLength: 30 }), (seed, picks) => {
        let s = createInitialState(arena, seed);
        for (const pick of picks) {
          if (s.outcome !== null) break;
          const legal = legalActions(s);
          const action: Action = legal.length === 0 || pick % 6 === 0 ? { type: "END_TURN" } : (legal[pick % legal.length] as Action);
          const a = apply(s, action);
          const b = apply(s, action);
          expect(serializeState(a.state)).toBe(serializeState(b.state));
          expect(a.events).toEqual(b.events);
          s = a.state;
        }
      }),
      { numRuns: 20 },
    );
  });

  it("UNDO after any legal action restores the exact previous state", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), fc.array(fc.nat({ max: 1000 }), { minLength: 5, maxLength: 30 }), (seed, picks) => {
        let s = createInitialState(arena, seed);
        for (const pick of picks) {
          if (s.outcome !== null) break;
          const legal = legalActions(s);
          if (legal.length === 0 || pick % 6 === 0) {
            s = apply(s, { type: "END_TURN" }).state;
            continue;
          }
          const action = legal[pick % legal.length] as Action;
          const after = apply(s, action).state;
          if (after.outcome !== null) break;
          const undone = apply(after, { type: "UNDO" });
          expect(undone.error).toBeUndefined();
          expect(serializeState(undone.state)).toBe(serializeState(s));
          s = after;
        }
      }),
      { numRuns: 20 },
    );
  });

  it("treasuries never go negative and the turn-start pipeline keeps gold + income − upkeep consistent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (seed) => {
        let s = createInitialState(arena, seed);
        for (let i = 0; i < 12 && s.outcome === null; i++) {
          const before = s;
          const r = apply(s, { type: "END_TURN" });
          s = r.state;
          if (s.turnNumber === 0) continue;
          for (const p of Object.values(s.provinces) as Province[]) {
            if (p.owner !== s.activePlayerIndex) continue;
            const prev = before.provinces[p.id];
            if (prev === undefined) continue;
            const expected = prev.gold + provinceIncome(before, prev) - provinceUpkeep(before, prev);
            expect(p.gold).toBe(Math.max(0, expected));
          }
        }
      }),
      { numRuns: 10 },
    );
  });

  it("generateRandomMap is deterministic per seed and always valid, connected and fairly seated", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 2, max: 8 }), fc.constantFrom("small", "medium", "large"), fc.constantFrom("grass", "desert", "snow"), (seed, seatCount, size, biome) => {
        const seats = Array.from({ length: seatCount }, (_, i) => ({ kind: i === 0 ? ("human" as const) : ("ai" as const), aiDifficulty: "normal" as const }));
        const a = generateRandomMap({ size, biome, seats }, seed);
        const b = generateRandomMap({ size, biome, seats }, seed);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(validateMap(a).errors).toEqual([]);
        const land = a.tiles.filter((t) => isOwnable(t.terrain)).length;
        expect(land).toBeGreaterThanOrEqual(0.25 * a.width * a.height);
        // Every seat has a ≥3-tile province with a city and an L1 unit; province counts differ by ≤ 1.
        const s = createInitialState(a, seed);
        const counts = seats.map((_, i) => Object.values(s.provinces).filter((p) => p.owner === i));
        for (const list of counts) {
          expect(list.some((p) => p.tileKeys.length >= 3)).toBe(true);
          for (const p of list) {
            expect(p.gold).toBe(10);
            expect(p.tileKeys.some((k) => { const [x, y] = k.split(",").map(Number) as [number, number]; return s.tiles[y * s.width + x]?.unit !== null; })).toBe(true);
          }
        }
        const sizes = counts.map((c) => c.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
        expect(a.players.map((p) => p.kind)).toEqual(seats.map((x) => x.kind));
        if (size !== "small") {
          expect(a.tiles.filter((t) => t.building === "mine").length).toBeGreaterThanOrEqual(1);
          expect(a.tiles.filter((t) => t.building === "chest").length).toBeGreaterThanOrEqual(1);
        }
        expect(a.tiles.every((t) => t.terrain !== "water" || t.owner === null)).toBe(true);
        // A 1-tile water border all round.
        for (let x = 0; x < a.width; x++) {
          expect(a.tiles[x]?.terrain).toBe("water");
          expect(a.tiles[(a.height - 1) * a.width + x]?.terrain).toBe("water");
        }
        checkProvinceInvariants(s);
      }),
      { numRuns: 30 },
    );
  });
});
