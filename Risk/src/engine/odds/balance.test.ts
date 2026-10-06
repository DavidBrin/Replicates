/**
 * T4 — Balanced Blitz, bit-exact. **This file is S2's acceptance gate for the stage-3 ordering**
 * (R52, R55, F46, F55).
 *
 * `toBeCloseTo(x, 15)` rather than `toBe`, because `Math.pow` appears twice in the pipeline (R59)
 * and is not bit-identical across JS engines; 15 decimal places is tighter than any plausible
 * engine difference and still asserts every digit that matters.
 */

import { describe, expect, it } from "vitest";

import { balance, balanceStage2Only } from "./balance";
import { outcomeDist } from "./dp";
import { BALANCE_CONFIG, STANDARD_AUGMENT, type DiceAugment } from "./types";

const CAPITAL: DiceAugment = { defendDiceBonus: 1, attackDicePenalty: 0, favourDefenderOnDraw: true };
const pct2 = (x: number): number => Number((x * 100).toFixed(2));
const sum = (a: Float64Array): number => [...a].reduce((x, y) => x + y, 0);

describe("T4 — 30 attackers against a capital held by 15, losing exactly 12", () => {
  const raw = outcomeDist(30, 15, CAPITAL);
  const balanced = balance(raw);

  it("True Random", () => {
    const trueRandom = raw.attackLoss[12] as number;
    expect(trueRandom).toBeCloseTo(0.02221280017072782, 15);
  });

  it("Balanced Blitz", () => {
    const balancedBlitz = balanced.attackLoss[12] as number;
    expect(balancedBlitz).toBeCloseTo(0.0100282888709122, 15);
  });

  it("the defender rolls three dice there, which is what makes it a capital", () => {
    expect(CAPITAL.defendDiceBonus).toBe(1);
    // The same battle on open ground is a different number entirely.
    expect(outcomeDist(30, 15, STANDARD_AUGMENT).attackLoss[12] as number)
      .not.toBeCloseTo(0.02221280017072782, 6);
  });
});

describe("T4 — 49 is the fewest attackers for >=80% Balanced Blitz against 50 defenders (R55)", () => {
  const bb = (a: number): number => pct2(balance(outcomeDist(a, 50, STANDARD_AUGMENT)).winChance);

  it("47 -> 72.03, 48 -> 77.10, 49 -> 82.15, 50 -> 86.35", () => {
    expect(bb(47)).toBe(72.03);
    expect(bb(48)).toBe(77.1);
    expect(bb(49)).toBe(82.15);
    expect(bb(50)).toBe(86.35);
  });

  it("49 is the first A at or above 80%", () => {
    let first = 1;
    while (balance(outcomeDist(first, 50, STANDARD_AUGMENT)).winChance < 0.8) first++;
    expect(first).toBe(49);
  });

  it("R54: a stage-2-only implementation gives ~75.7% at A = 49 and must fail the >=80% gate", () => {
    const stage2 = balanceStage2Only(outcomeDist(49, 50, STANDARD_AUGMENT));
    expect(pct2(stage2)).toBeCloseTo(75.7, 1);
    expect(stage2).toBeLessThan(0.8);
    // The outcome-cutoff stage contributes the remaining ~6.4 points.
    expect(balance(outcomeDist(49, 50, STANDARD_AUGMENT)).winChance - stage2).toBeCloseTo(0.064, 2);
  });
});

describe("T4 — 20 v 15 Balanced Blitz is exactly 100% (R55, R56)", () => {
  it("is exactly 1, not 0.9999999999999999", () => {
    const balanced = balance(outcomeDist(20, 15, STANDARD_AUGMENT));
    expect(balanced.winChance).toBe(1);
    // Stage 1 does NOT do this: the raw win chance is 86.04%, well inside the 5% cutoff band.
    expect(pct2(outcomeDist(20, 15, STANDARD_AUGMENT).winChance)).toBe(86.04);
  });

  it("the defender's outcome entries are all zero once the high tail has eaten them", () => {
    const balanced = balance(outcomeDist(20, 15, STANDARD_AUGMENT));
    for (let j = 0; j < 15; j++) expect(balanced.defendLoss[j] as number).toBe(0);
    expect(balanced.defendLoss[15] as number).toBe(1);
    expect(balanced.attackLoss[20] as number).toBe(0);
  });
});

describe("T4 — the stage-2 oracle at p = 1.4 (R51)", () => {
  const power = (w: number, p: number): number => w ** p / (w ** p + (1 - w) ** p);

  it("56.8 -> 59.46, 43.2 -> 40.54, 86.1 -> 92.78", () => {
    expect(pct2(power(0.568, 1.4))).toBe(59.46);
    expect(pct2(power(0.432, 1.4))).toBe(40.54);
    expect(pct2(power(0.861, 1.4))).toBe(92.78);
  });

  it("has its fixed point at w = 0.5 and is monotone", () => {
    expect(power(0.5, BALANCE_CONFIG.winChancePower)).toBe(0.5);
    let previous = 0;
    for (let w = 0.01; w < 1; w += 0.01) {
      const next = power(w, BALANCE_CONFIG.winChancePower);
      expect(next).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it("R56: the break-even does not move between dice modes, because of that fixed point", () => {
    for (const d of [2, 3, 5, 8, 10, 15, 20]) {
      let trMin = 1;
      while (outcomeDist(trMin, d, STANDARD_AUGMENT).winChance < 0.5) trMin++;
      let bbMin = 1;
      while (balance(outcomeDist(bbMin, d, STANDARD_AUGMENT)).winChance < 0.5) bbMin++;
      expect(bbMin).toBe(trMin);
    }
  });
});

describe("T4 — the R56 delta table, within 0.01 pp", () => {
  it.each([
    [3, 3, 47.03, 45.17], [4, 4, 47.65, 46.19], [5, 5, 50.62, 51.01],
    [8, 8, 54.74, 57.68], [10, 10, 56.76, 60.94], [15, 15, 60.52, 66.93],
    [20, 20, 63.34, 71.33], [2, 1, 75.42, 88.9], [3, 2, 65.6, 74.78],
    [5, 4, 63.83, 72.08], [5, 3, 76.94, 90.91], [10, 8, 72.4, 84.74],
    [20, 15, 86.04, 100],
  ])("%i v %i: %f%% true random -> %f%% balanced blitz", (a, d, trueRandom, balancedBlitz) => {
    const raw = outcomeDist(a, d, STANDARD_AUGMENT);
    expect(pct2(raw.winChance)).toBe(trueRandom);
    expect(pct2(balance(raw).winChance)).toBe(balancedBlitz);
  });

  it("favourable attacks gain 8-14 points while marginal underdogs lose ~1.5", () => {
    const delta = (a: number, d: number): number =>
      (balance(outcomeDist(a, d, STANDARD_AUGMENT)).winChance - outcomeDist(a, d, STANDARD_AUGMENT).winChance) * 100;
    expect(delta(3, 3)).toBeCloseTo(-1.86, 1);
    expect(delta(4, 4)).toBeCloseTo(-1.46, 1);
    expect(delta(2, 1)).toBeCloseTo(13.47, 1);
    expect(delta(5, 3)).toBeCloseTo(13.97, 1);
    expect(delta(10, 8)).toBeCloseTo(12.34, 1);
  });
});

describe("the stages, and what each one is and is not allowed to do", () => {
  it("R50 stage 1: a win chance past 95% snaps to certainty — the '5 vs 1 wins 100%' complaint", () => {
    const raw = outcomeDist(5, 1, STANDARD_AUGMENT);
    expect(raw.winChance).toBeGreaterThan(0.95);
    expect(balance(raw).winChance).toBe(1);
  });

  it("R50 stage 1: a win chance at or below 5% snaps to zero, and the defender renormalises", () => {
    const raw = outcomeDist(1, 5, STANDARD_AUGMENT);
    expect(raw.winChance).toBeLessThanOrEqual(0.05);
    const balanced = balance(raw);
    expect(balanced.winChance).toBe(0);
    expect(balanced.attackLoss[1] as number).toBe(1);
    expect(balanced.defendLoss[5] as number).toBe(0);
    expect(sum(balanced.defendLoss)).toBeCloseTo(1, 15);
  });

  it("R53 stage 4 preserves the win chance stages 1-3 set, and makes nothing impossible", () => {
    for (const [a, d] of [[6, 5], [12, 9], [30, 15]] as const) {
      const raw = outcomeDist(a, d, STANDARD_AUGMENT);
      const balanced = balance(raw);
      // Each side's entries sum to its own share of the win chance.
      let wins = 0;
      for (let i = 0; i < a; i++) wins += balanced.attackLoss[i] as number;
      expect(wins).toBeCloseTo(balanced.winChance, 14);
      let holds = 0;
      for (let j = 0; j < d; j++) holds += balanced.defendLoss[j] as number;
      expect(holds).toBeCloseTo(1 - balanced.winChance, 14);
      expect(sum(balanced.attackLoss)).toBeCloseTo(1, 14);
      expect(sum(balanced.defendLoss)).toBeCloseTo(1, 14);
    }
  });

  it("R52 stage 3 makes the extremes genuinely impossible, not merely rare", () => {
    const raw = outcomeDist(12, 9, STANDARD_AUGMENT);
    const balanced = balance(raw);
    // The best outcome for the attacker (conquer losing nothing) was possible and now is not.
    expect(raw.attackLoss[0] as number).toBeGreaterThan(0);
    expect(balanced.attackLoss[0] as number).toBe(0);
    // Likewise the defender's best outcome (hold losing nothing).
    expect(raw.defendLoss[0] as number).toBeGreaterThan(0);
    expect(balanced.defendLoss[0] as number).toBe(0);
  });

  it("never mutates the raw distribution it is handed", () => {
    const raw = outcomeDist(9, 7, STANDARD_AUGMENT);
    const before = [...raw.attackLoss];
    balance(raw);
    expect([...raw.attackLoss]).toEqual(before);
  });

  it("is idempotent in shape: a, d and unresolved pass straight through", () => {
    const raw = outcomeDist(10, 10, STANDARD_AUGMENT, 5);
    const balanced = balance(raw);
    expect(balanced.a).toBe(10);
    expect(balanced.d).toBe(10);
    expect(balanced.unresolved).toBe(raw.unresolved);
    // The limiter's mass passes through untouched; the reshape runs on the resolved conditional.
    expect(sum(balanced.attackLoss) + balanced.unresolved).toBeCloseTo(1, 12);
    expect(balanced.winChance).toBeLessThan(1 - raw.unresolved + 1e-12);
  });

  it("leaves a degenerate battle alone", () => {
    expect(balance(outcomeDist(5, 0, STANDARD_AUGMENT)).winChance).toBe(1);
    expect(balance(outcomeDist(0, 5, STANDARD_AUGMENT)).winChance).toBe(0);
  });

  it("every entry stays a probability", () => {
    for (const [a, d] of [[1, 1], [2, 2], [7, 3], [15, 20], [40, 40]] as const) {
      const balanced = balance(outcomeDist(a, d, STANDARD_AUGMENT));
      for (const p of balanced.attackLoss) expect(p).toBeGreaterThanOrEqual(0);
      for (const p of balanced.defendLoss) expect(p).toBeGreaterThanOrEqual(0);
      expect(balanced.winChance).toBeGreaterThanOrEqual(0);
      expect(balanced.winChance).toBeLessThanOrEqual(1);
    }
  });

  it("the published constants are SMG's defaults (R49, D23)", () => {
    expect(BALANCE_CONFIG).toEqual({
      winChanceCutoff: 0.05, winChancePower: 1.3, outcomeCutoff: 0.1, outcomePower: 1.8,
    });
  });
});
