/** T5 — the quantised CDF walk at u in {0, eps, 0.5, 1-eps} (R58, R59, D6, D7). */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { rollAttack, type GameState, type Rng } from "@/engine";
import { mini } from "@/engine/__fixtures__/maps";
import { buildState } from "@/engine/__fixtures__/states";

import { balance } from "./balance";
import { outcomeDist } from "./dp";
import { createOdds } from "./index";
import { cumulativeGrid, sampleOutcome } from "./sample";
import { CDF_QUANTUM, STANDARD_AUGMENT } from "./types";

const EPS = Number.EPSILON;
const ALMOST_ONE = 1 - EPS / 2;

describe("T5 — the walk is pinned at the four boundary draws", () => {
  const dist = outcomeDist(8, 5, STANDARD_AUGMENT);

  it("u = 0 picks the first entry carrying mass: conquer having lost the least", () => {
    expect(sampleOutcome(dist, 0)).toEqual({
      attackerLosses: 0, defenderLosses: 5, conquered: true, unresolved: false,
    });
  });

  it("u = eps picks the same entry as u = 0", () => {
    expect(sampleOutcome(dist, EPS)).toEqual(sampleOutcome(dist, 0));
  });

  it("u = 1 - eps picks the last entry carrying mass: the defender holds losing nothing", () => {
    expect(sampleOutcome(dist, ALMOST_ONE)).toEqual({
      attackerLosses: 8, defenderLosses: 0, conquered: false, unresolved: false,
    });
  });

  it("u = 0.5 picks one fixed, reproducible outcome", () => {
    const first = sampleOutcome(dist, 0.5);
    expect(first).toEqual(sampleOutcome(dist, 0.5));
    expect(first).toMatchInlineSnapshot(`
      {
        "attackerLosses": 3,
        "conquered": true,
        "defenderLosses": 5,
        "unresolved": false,
      }
    `);
  });

  it("the same four draws are pinned on a Balanced Blitz distribution too", () => {
    const bb = balance(dist);
    expect(sampleOutcome(bb, 0).conquered).toBe(true);
    expect(sampleOutcome(bb, EPS)).toEqual(sampleOutcome(bb, 0));
    expect(sampleOutcome(bb, ALMOST_ONE).conquered).toBe(false);
    expect(sampleOutcome(bb, 0.5)).toEqual(sampleOutcome(bb, 0.5));
  });
});

describe("the tie rule and the walk direction (R59)", () => {
  const dist = outcomeDist(4, 3, STANDARD_AUGMENT);
  const grid = cumulativeGrid(dist);

  it("walks forward from index 0, most-favourable-to-attacker first", () => {
    const quantised = grid.map((q) => q / CDF_QUANTUM);
    for (let i = 1; i < quantised.length; i++) {
      expect(quantised[i] as number).toBeGreaterThanOrEqual(quantised[i - 1] as number);
    }
    expect(quantised[quantised.length - 1]).toBeCloseTo(1, 9);
  });

  it("the comparison is `u < cumulative`, so a draw exactly on a boundary falls to the NEXT entry", () => {
    // The first entry's cumulative mass, exactly on the quantised grid.
    const boundary = (grid[0] as number) / CDF_QUANTUM;
    const justBelow = (grid[0] as number - 1) / CDF_QUANTUM;
    expect(sampleOutcome(dist, justBelow).attackerLosses).toBe(0);
    expect(sampleOutcome(dist, boundary).attackerLosses).not.toBe(0);
  });

  it("quantises to the 2^32 grid before comparing, so last-bit drift cannot move the outcome", () => {
    expect(CDF_QUANTUM).toBe(2 ** 32);
    const boundary = (grid[1] as number) / CDF_QUANTUM;
    // A perturbation far below the grid spacing changes nothing.
    const drift = 1 / (CDF_QUANTUM * 1024);
    expect(sampleOutcome(dist, boundary - drift)).toEqual(sampleOutcome(dist, boundary));
  });
});

describe("the Attack Limiter's unresolved outcomes are sampled last, in a pinned order (R48)", () => {
  const dist = outcomeDist(10, 10, STANDARD_AUGMENT, 6);

  it("has stopped outcomes sorted by attackerLosses then defenderLosses", () => {
    expect(dist.stopped.length).toBeGreaterThan(0);
    for (let i = 1; i < dist.stopped.length; i++) {
      const prev = dist.stopped[i - 1] as { attackerLosses: number; defenderLosses: number };
      const here = dist.stopped[i] as { attackerLosses: number; defenderLosses: number };
      expect(
        here.attackerLosses > prev.attackerLosses
        || (here.attackerLosses === prev.attackerLosses && here.defenderLosses > prev.defenderLosses),
      ).toBe(true);
    }
  });

  it("u = 1 - eps lands on an unresolved outcome when the limiter holds the whole tail", () => {
    // With the attacker floored at 5 it can never be exhausted, so the defender never wins outright:
    // the last mass in the walk is the limiter's.
    const last = sampleOutcome(dist, ALMOST_ONE);
    expect(last.unresolved).toBe(true);
    expect(last.conquered).toBe(false);
    expect(last.attackerLosses).toBeGreaterThanOrEqual(5);
  });

  it("reports real troop losses for an unresolved battle, never a bare flag", () => {
    for (const s of dist.stopped) {
      expect(s.attackerLosses).toBeGreaterThan(0);
      expect(s.defenderLosses).toBeGreaterThanOrEqual(0);
      expect(s.defenderLosses).toBeLessThan(10);
    }
  });
});

describe("totality", () => {
  it("every u in [0,1) resolves to a legal outcome (fast-check)", () => {
    const dists = [
      outcomeDist(1, 1, STANDARD_AUGMENT),
      outcomeDist(3, 2, STANDARD_AUGMENT),
      balance(outcomeDist(12, 9, STANDARD_AUGMENT)),
      outcomeDist(9, 9, STANDARD_AUGMENT, 4),
    ];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: dists.length - 1 }), fc.double({ min: 0, max: ALMOST_ONE, noNaN: true }),
        (i, u) => {
          const dist = dists[i] as (typeof dists)[number];
          const out = sampleOutcome(dist, u);
          expect(out.attackerLosses).toBeGreaterThanOrEqual(0);
          expect(out.attackerLosses).toBeLessThanOrEqual(dist.a);
          expect(out.defenderLosses).toBeGreaterThanOrEqual(0);
          expect(out.defenderLosses).toBeLessThanOrEqual(dist.d);
          if (out.conquered) expect(out.defenderLosses).toBe(dist.d);
          if (out.conquered) expect(out.unresolved).toBe(false);
        }),
      { numRuns: 1000 },
    );
  });

  it("is monotone in u: more probability mass drawn means a worse outcome for the attacker", () => {
    const dist = outcomeDist(20, 15, STANDARD_AUGMENT);
    let previous = -1;
    for (let u = 0; u < 1; u += 0.001) {
      const out = sampleOutcome(dist, u);
      const rank = out.conquered ? out.attackerLosses : dist.a + (dist.d - out.defenderLosses);
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });

  it("a degenerate distribution still resolves", () => {
    expect(sampleOutcome(outcomeDist(5, 0, STANDARD_AUGMENT), 0.5).conquered).toBe(true);
    expect(sampleOutcome(outcomeDist(0, 5, STANDARD_AUGMENT), 0.5).conquered).toBe(false);
  });

  it("clamps an out-of-contract u rather than throwing inside a resolver", () => {
    const dist = outcomeDist(5, 3, STANDARD_AUGMENT);
    expect(sampleOutcome(dist, 1)).toEqual(sampleOutcome(dist, ALMOST_ONE));
    expect(sampleOutcome(dist, -1)).toEqual(sampleOutcome(dist, 0));
    expect(sampleOutcome(dist, Number.NaN)).toEqual(sampleOutcome(dist, 0));
  });
});

/*
 * The walk has exactly ONE implementation (codex round 2, findings 8 and 16b).
 *
 * `rollAttack` (S1) and `sampleOutcome` (S2) both resolve a battle from one `u` over R52's combined
 * array plus R48's stopped tail. They used to carry two copies of that walk and the copies
 * disagreed: S2 credited a resolved defender-hold with all of `A`, which is what the DP's
 * `defendLoss[j < D]` means, while S1 credited `(A + 1) - stopUntil`, the limiter's committed count.
 * These tests drive S1's resolver against the REAL DP, so a future divergence has to fail here.
 */
describe("rollAttack and sampleOutcome agree, against the real DP", () => {
  /** An `Rng` whose single blitz draw is exactly `u`. */
  function fixedU(u: number): Rng {
    return { nextU32: () => Math.round(u * 2 ** 32), nextFloat: () => u, state: [0, 0] };
  }

  const odds = createOdds("trueRandom");

  /** Seat 0 holds `source` troops on territory 2, seat 1 holds `target` on the adjacent 3. */
  function board(source: number, target: number): GameState {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      troops: [1, 1, source, target, 1, 1],
      phase: "attack",
    });
  }

  function blitz(
    source: number, target: number, u: number, stopUntil?: number,
  ): { attackerLosses: number; defenderLosses: number } {
    const action = rollAttack(
      board(source, target), mini,
      { from: 2, to: 3, mode: "blitz", ...(stopUntil === undefined ? {} : { stopUntil }) },
      fixedU(u), odds, "trueRandom",
    );
    if (action.mode !== "blitz") throw new Error("expected a blitz");
    return { attackerLosses: action.attackerLosses, defenderLosses: action.defenderLosses };
  }

  it("R48 — a RESOLVED hold under a limiter costs the attacker all of A, not the committed count", () => {
    // A = 4, D = 2, stopUntil = 2. The real DP leaves mass on `defendLoss[0]`: from A = 2 the
    // attacker can lose both armies in one round, so it reaches zero without ever sitting at or
    // below the limiter's floor. That cell therefore means "wiped out" — 4 — where the old
    // `(A + 1) - stopUntil` arithmetic said 3.
    const dist = outcomeDist(4, 2, STANDARD_AUGMENT, 2);
    expect(dist.defendLoss[0] as number).toBeGreaterThan(0);
    expect(dist.unresolved).toBeGreaterThan(0);

    // u = 0.80 lands on `defendLoss[0]`: past the three conquest cells (cumulative about 0.726)
    // and short of the stopped tail (about 0.857).
    expect(blitz(5, 2, 0.8, 2)).toEqual({ attackerLosses: 4, defenderLosses: 0 });
    // The tail itself still reports the DP's own recorded losses, not `A`.
    expect(blitz(5, 2, 0.95, 2)).toEqual({ attackerLosses: 3, defenderLosses: 1 });
  });

  it("resolves every u to exactly what sampleOutcome says, limiter or not", () => {
    const cases: readonly (readonly [number, number, number | undefined])[] = [
      [5, 2, 2], [7, 4, 2], [7, 4, 3], [10, 6, 4], [5, 3, undefined], [9, 9, undefined],
    ];
    for (const [source, target, stopUntil] of cases) {
      const a = source - 1;
      const dist = outcomeDist(a, target, STANDARD_AUGMENT, stopUntil);
      for (let n = 0; n <= 400; n++) {
        const u = n / 401;
        const mine = blitz(source, target, u, stopUntil);
        const theirs = sampleOutcome(dist, u);
        expect(mine).toEqual({
          attackerLosses: theirs.attackerLosses,
          defenderLosses: theirs.defenderLosses,
        });
        // Whatever the walk says, the reducer has to be able to apply it (R63).
        expect(mine.attackerLosses).toBeLessThanOrEqual(a);
        expect(mine.defenderLosses).toBeLessThanOrEqual(target);
      }
    }
  });
});
