/** T5 — the quantised CDF walk at u in {0, eps, 0.5, 1-eps} (R58, R59, D6, D7). */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { balance } from "./balance";
import { outcomeDist } from "./dp";
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
