/**
 * T13 — the perf budgets S1 owns (SPEC §11).
 *
 * Two of T13's six budgets are S1's: `apply` of a 60-action bot turn under
 * 20 ms, and `hashState` on a 100-territory state under 2 ms. The odds-table
 * and `decideTurn` budgets are S2's. The rest here are the same discipline
 * applied to the things the reducer does on every frame, so a quadratic
 * creeping into the graph or the canonical walk shows up as a red test rather
 * than as a stutter.
 *
 * `performance.now` is banned inside the engine proper but allowed in a test
 * file, which is exactly what the layering guard's test-file exemption is for.
 * Budgets are generous multiples of the measured cost, because CI machines are
 * not developer machines; the point is to catch an order of magnitude.
 */
import { describe, expect, it } from "vitest";

import { classicWorld, mini } from "./__fixtures__/maps";
import { fakeOdds, makeDist } from "./__fixtures__/odds";
import { buildState, config, personasFor } from "./__fixtures__/states";
import { reachableOwn } from "./graph";
import { viewFor } from "./fog";
import { canonicalize, hashState } from "./hash";
import { legalActions, legalAttackTargets } from "./legalActions";
import { pcg32, rngFor } from "./prng";
import { apply, createInitialState } from "./reducer";
import { dealTerritories, rollAttack } from "./resolver";
import { reinforcementsFor } from "./rules";
import type { Action, GameState, MapDef, Seat } from "./types";

/** Milliseconds for one call of `run`, averaged over `times`. */
function msPerCall(times: number, run: () => void): number {
  run(); // warm the JIT
  const start = performance.now();
  for (let i = 0; i < times; i++) run();
  return (performance.now() - start) / times;
}

/** A dense, 100-territory-scale board: Classic with six seats and real stacks. */
function bigBoard(): GameState {
  return buildState(classicWorld, {
    seats: 6,
    owners: classicWorld.territories.map((_t, i) => i % 6),
    troops: classicWorld.territories.map((_t, i) => 1 + (i % 17)),
    phase: "attack",
  });
}

describe("T13 — the reducer's budgets", () => {
  it("apply of a 60-action turn stays under 20 ms", () => {
    const state = buildState(classicWorld, {
      seats: 6,
      owners: classicWorld.territories.map((_t, i) => i % 6),
      troops: classicWorld.territories.map(() => 20),
      phase: "draft",
      troopsToPlace: 60,
    });
    const actions: Action[] = [];
    for (let i = 0; i < 60; i++) {
      actions.push({ type: "DRAFT", seat: 0, territory: (i % 7) * 6, count: 1 });
    }
    const ms = msPerCall(20, () => {
      let s = state;
      for (const action of actions) s = apply(s, classicWorld, action).state;
      expect(s.troopsToPlace).toBe(0);
    });
    expect(ms).toBeLessThan(20);
  });

  it("apply of a 60-action battle chain stays under 20 ms", () => {
    const odds = fakeOdds((a, d) => makeDist(a, d, { holdLosing: { [Math.max(0, d - 1)]: 1 } }));
    const base = buildState(classicWorld, {
      seats: 6,
      owners: classicWorld.territories.map((_t, i) => i % 6),
      troops: classicWorld.territories.map(() => 40),
      phase: "attack",
    });
    const ms = msPerCall(10, () => {
      let s = base;
      for (let i = 0; i < 60; i++) {
        const from = (i % 7) * 6;
        const targets = legalAttackTargets(s, classicWorld, from);
        const to = targets[0];
        if (to === undefined) continue;
        const action = rollAttack(
          s,
          classicWorld,
          { from, to, mode: "blitz" },
          pcg32(i, 1),
          odds,
          "trueRandom",
        );
        const result = apply(s, classicWorld, action);
        if (result.error === undefined) s = result.state;
      }
    });
    expect(ms).toBeLessThan(20);
  });

  it("hashState on a 100-territory-scale state stays under 2 ms", () => {
    const state = bigBoard();
    expect(state.territories.length).toBeGreaterThanOrEqual(42);
    const ms = msPerCall(200, () => {
      expect(hashState(state)).toMatch(/^[0-9a-f]{16}$/);
    });
    expect(ms).toBeLessThan(2);
  });

  it("canonicalize on the same state stays under 2 ms", () => {
    const state = bigBoard();
    const ms = msPerCall(200, () => {
      canonicalize(state);
    });
    expect(ms).toBeLessThan(2);
  });
});

describe("T13 — the selectors every frame touches", () => {
  it("1,000 legalAttackTargets calls stay under 20 ms", () => {
    const state = bigBoard();
    const ms = msPerCall(5, () => {
      for (let i = 0; i < 1000; i++) legalAttackTargets(state, classicWorld, i % 42);
    });
    expect(ms).toBeLessThan(20);
  });

  it("1,000 reinforcementsFor calls stay under 20 ms", () => {
    const state = bigBoard();
    const ms = msPerCall(5, () => {
      for (let i = 0; i < 1000; i++) reinforcementsFor(state, classicWorld, (i % 6) as Seat);
    });
    expect(ms).toBeLessThan(20);
  });

  it("legalActions over every seat stays under 2 ms", () => {
    const state = bigBoard();
    const ms = msPerCall(100, () => {
      for (let seat = 0; seat < 6; seat++) legalActions(state, classicWorld, seat);
    });
    expect(ms).toBeLessThan(2);
  });

  it("a whole-board fortify reachability search stays under 1 ms", () => {
    const state = buildState(classicWorld, {
      seats: 2,
      owners: classicWorld.territories.map(() => 0),
      troops: classicWorld.territories.map(() => 5),
    });
    const ms = msPerCall(200, () => {
      expect(reachableOwn(state, classicWorld, 0, 0)).toHaveLength(41);
    });
    expect(ms).toBeLessThan(1);
  });

  it("viewFor on the big board stays under 2 ms", () => {
    const state = { ...bigBoard(), rules: { ...bigBoard().rules, fogOfWar: true } };
    const ms = msPerCall(100, () => {
      viewFor(state, classicWorld, 0);
    });
    expect(ms).toBeLessThan(2);
  });
});

describe("T13 — the resolver's budgets", () => {
  it("dealTerritories on Classic stays under 5 ms", () => {
    const cfg = config(classicWorld, 6, { blizzards: true, portals: "stable", capitals: true });
    const ms = msPerCall(50, () => {
      dealTerritories(classicWorld, cfg, personasFor(6), {
        deal: rngFor("perf", "deal", 0),
        turnOrder: rngFor("perf", "turnOrder", 0),
        modifierPlace: rngFor("perf", "modifierPlace", 0),
      });
    });
    expect(ms).toBeLessThan(5);
  });

  it("10,000 PRNG draws stay under 10 ms", () => {
    const ms = msPerCall(10, () => {
      const rng = pcg32(1, 2);
      let acc = 0;
      for (let i = 0; i < 10_000; i++) acc = (acc + rng.nextU32()) >>> 0;
      expect(acc).toBeGreaterThanOrEqual(0);
    });
    expect(ms).toBeLessThan(10);
  });

  it("creating a fresh sub-stream 1,000 times stays under 10 ms", () => {
    const ms = msPerCall(10, () => {
      for (let i = 0; i < 1000; i++) rngFor("perf-seed", "battle", i);
    });
    expect(ms).toBeLessThan(10);
  });

  it("createInitialState on Classic stays under 5 ms", () => {
    const cfg = config(classicWorld, 6);
    const started = dealTerritories(classicWorld, cfg, personasFor(6), {
      deal: rngFor("perf", "deal", 0),
      turnOrder: rngFor("perf", "turnOrder", 0),
      modifierPlace: rngFor("perf", "modifierPlace", 0),
    });
    const ms = msPerCall(100, () => {
      createInitialState(classicWorld, started);
    });
    expect(ms).toBeLessThan(5);
  });

  it("scales from mini to Classic without a surprise, which is the real guard", () => {
    const small: MapDef = mini;
    const smallState = buildState(small, { seats: 3, owners: [0, 1, 2, 0, 1, 2], troops: [3, 3, 3, 3, 3, 3] });
    const smallMs = msPerCall(300, () => hashState(smallState));
    const bigMs = msPerCall(300, () => hashState(bigBoard()));
    // Seven times the territories should not cost a hundred times the work.
    expect(bigMs).toBeLessThan(Math.max(0.5, smallMs * 60));
  });
});
