import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { aiTakeTurn } from "./ai";
import { generateRandomMap } from "./generator";
import { apply } from "./reducer";
import { createInitialState } from "./state";
import { asciiMap } from "./testing/asciiMap";
import type { GameState } from "./types";

/** 40×40, 8 seats: a red/blue chequer of 2-wide vertical stripes so every capture re-floods and splits. */
function bigMap() {
  const w = 40;
  const h = 40;
  const terrain: string[] = [];
  const owners: string[] = [];
  const objects: string[] = [];
  for (let y = 0; y < h; y++) {
    let t = "";
    let o = "";
    let b = "";
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      t += border ? "~" : ".";
      if (border) {
        o += ".";
        b += ".";
        continue;
      }
      const seat = y < 20 ? Math.floor((x - 1) / 10) : 4 + Math.floor((x - 1) / 10);
      o += String(Math.min(7, seat));
      b += (x - 1) % 10 === 5 && (y === 5 || y === 25) ? "C" : y === 1 && x === 1 ? "4" : ".";
    }
    terrain.push(t);
    owners.push(o);
    objects.push(b);
  }
  // Give seat 0 a wall of L4 knights along x = 10 so captures into seat 1 are possible for 200 moves.
  const withUnits = objects.map((row, y) => (y >= 1 && y <= 38 && y !== 5 ? row.slice(0, 10) + "4" + row.slice(11) : row));
  return asciiMap({ terrain, owners, objects: withUnits, startGold: 0, players: { 0: { startGold: 100_000 } } });
}

function time(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("performance budgets (SPEC §11)", () => {
  it("200 captures with province re-flood on a 40×40 8-seat map < 200 ms", () => {
    const map = bigMap();
    let s = createInitialState(map, 1);
    // Seat 0's 18 L4s at (10, y) each capture (x + 1, y) per turn, marching east through seat 1's land.
    const xs = new Map<number, number>();
    for (let y = 1; y <= 19; y++) if (y !== 5) xs.set(y, 10);
    let count = 0;
    const ms = time(() => {
      for (let cycle = 0; cycle < 14 && count < 200; cycle++) {
        for (const [y, x] of xs) {
          if (count >= 200) break;
          const r = apply(s, { type: "MOVE", unitAt: { x, y }, to: { x: x + 1, y } });
          if (r.error !== undefined) continue;
          s = r.state;
          xs.set(y, x + 1);
          count++;
        }
        let guard = 0;
        do {
          s = apply(s, { type: "END_TURN" }).state;
          guard++;
        } while (s.activePlayerIndex !== 0 && guard < 10 && s.outcome === null);
      }
    });
    expect(count).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThan(200);
  });

  it("UNDO of a 30-action turn < 20 ms", () => {
    const map = bigMap();
    let s: GameState = createInitialState(map, 1);
    for (let y = 1; y <= 19; y++) {
      if (y === 5) continue;
      s = apply(s, { type: "MOVE", unitAt: { x: 10, y }, to: { x: 11, y } }).state;
    }
    for (let x = 2; x <= 9; x++) for (const y of [7, 9]) s = apply(s, { type: "BUY", item: "knight1", at: { x, y } }).state;
    expect(s.history.length).toBe(34);
    const ms = time(() => {
      const r = apply(s, { type: "UNDO" });
      expect(r.error).toBeUndefined();
    });
    expect(ms).toBeLessThan(20);
  });

  it("aiTakeTurn on a 26×26 map < 100 ms", () => {
    const map = generateRandomMap({ size: "large", biome: "grass", seats: [{ kind: "ai" }, { kind: "ai" }, { kind: "ai" }, { kind: "ai" }] }, 11);
    let s = createInitialState(map, 11);
    // Warm up a few turns so provinces have gold and targets.
    let seed = 11;
    for (let i = 0; i < 8; i++) {
      const r = aiTakeTurn(s, s.activePlayerIndex, seed);
      seed = r.nextSeed;
      for (const a of r.actions) s = apply(s, a).state;
    }
    const ms = time(() => {
      aiTakeTurn(s, s.activePlayerIndex, seed);
    });
    expect(ms).toBeLessThan(100);
  });

  it("generateRandomMap large completes quickly", () => {
    const ms = time(() => {
      generateRandomMap({ size: "large", biome: "snow", seats: Array.from({ length: 8 }, () => ({ kind: "ai" as const })) }, 5);
    });
    expect(ms).toBeLessThan(250);
  });
});
