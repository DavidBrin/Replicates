/** The `@/engine/odds` barrel: `createOdds`, the augment helpers, and T13's perf budgets. */

import { describe, expect, it } from "vitest";

import { buildTable, resetCaches } from "./dp";
import { createOdds } from "./index";
import {
  addAugments, augmentKey, BALANCE_CONFIG, CERTAIN_EPS, isStandard, STANDARD_AUGMENT, TABLE_MAX,
  ZOMBIE_DEFENDER_AUGMENT, type DiceAugment,
} from "./types";

const CAPITAL: DiceAugment = { defendDiceBonus: 1, attackDicePenalty: 0, favourDefenderOnDraw: true };
const WALL: DiceAugment = { defendDiceBonus: 1, attackDicePenalty: 0, favourDefenderOnDraw: true };
const pct2 = (x: number): number => Number((x * 100).toFixed(2));

describe("the augment helpers (R36, D27)", () => {
  it("augments STACK: capital + wall gives the defender up to four dice", () => {
    const stacked = addAugments(CAPITAL, WALL);
    expect(stacked.defendDiceBonus).toBe(2);
    expect(stacked.attackDicePenalty).toBe(0);
  });

  it("the tie rule ORs toward the defender", () => {
    expect(addAugments(STANDARD_AUGMENT, ZOMBIE_DEFENDER_AUGMENT).favourDefenderOnDraw).toBe(true);
    expect(addAugments(ZOMBIE_DEFENDER_AUGMENT, ZOMBIE_DEFENDER_AUGMENT).favourDefenderOnDraw).toBe(false);
  });

  it("keys canonically, and `isStandard` recognises only the standard triple", () => {
    expect(augmentKey(STANDARD_AUGMENT)).toBe("0:0:1");
    expect(augmentKey(ZOMBIE_DEFENDER_AUGMENT)).toBe("0:0:0");
    expect(augmentKey(CAPITAL)).toBe("1:0:1");
    expect(isStandard(STANDARD_AUGMENT)).toBe(true);
    expect(isStandard({ ...STANDARD_AUGMENT })).toBe(true);
    expect(isStandard(CAPITAL)).toBe(false);
    expect(isStandard(ZOMBIE_DEFENDER_AUGMENT)).toBe(false);
  });

  it("is associative and commutative in the integer parts", () => {
    const a: DiceAugment = { defendDiceBonus: 1, attackDicePenalty: 1, favourDefenderOnDraw: true };
    const b: DiceAugment = { defendDiceBonus: 1, attackDicePenalty: 0, favourDefenderOnDraw: false };
    expect(addAugments(a, b)).toEqual(addAugments(b, a));
  });
});

describe("createOdds — one table per dice mode (R57, D25)", () => {
  const trueRandom = createOdds("trueRandom");
  const balancedBlitz = createOdds("balancedBlitz");

  it("reports its own mode", () => {
    expect(trueRandom.mode).toBe("trueRandom");
    expect(balancedBlitz.mode).toBe("balancedBlitz");
  });

  it("the two modes disagree by up to 14 points, which is the whole point of D25", () => {
    expect(pct2(trueRandom.winChance(20, 15))).toBe(86.04);
    expect(pct2(balancedBlitz.winChance(20, 15))).toBe(100);
    expect(pct2(trueRandom.winChance(10, 8))).toBe(72.4);
    expect(pct2(balancedBlitz.winChance(10, 8))).toBe(84.74);
  });

  it("defaults the augment to standard play", () => {
    expect(trueRandom.winChance(10, 10)).toBe(trueRandom.winChance(10, 10, STANDARD_AUGMENT));
  });

  it("R57: `certainWin` is `winChance >= 1 - 1e-9`", () => {
    expect(CERTAIN_EPS).toBe(1e-9);
    expect(balancedBlitz.certainWin(20, 15)).toBe(true);
    expect(trueRandom.certainWin(20, 15)).toBe(false);
    // Stage 1 is what creates the lever: past ~95% a Balanced Blitz win is risk-free.
    expect(balancedBlitz.certainWin(5, 1)).toBe(true);
    expect(balancedBlitz.certainWin(3, 3)).toBe(false);
    // A dead defender is certain in both modes.
    expect(trueRandom.certainWin(1, 0)).toBe(true);
  });

  it("R43: never clamps indices above the table", () => {
    // 129 v 381 must not read the clamped 85.65%.
    expect(trueRandom.winChance(129, 381)).toBeLessThan(0.01);
    expect(trueRandom.winChance(TABLE_MAX, TABLE_MAX)).toBeGreaterThan(0.85);
    // Monotone across the table boundary rather than jumping.
    expect(trueRandom.winChance(129, 100)).toBeGreaterThan(trueRandom.winChance(128, 100) - 0.05);
  });

  it("extends the DP on demand above the table for a non-standard augment (F48)", () => {
    // Standard uses the logistic; capital has no fit, so it is the exact DP — and far lower.
    expect(trueRandom.winChance(200, 200, CAPITAL)).toBeLessThan(0.05);
    expect(trueRandom.winChance(200, 200, STANDARD_AUGMENT)).toBeGreaterThan(0.9);
  });

  it("`outcome` returns the mode's own distribution", () => {
    const tr = trueRandom.outcome(30, 15, CAPITAL);
    const bb = balancedBlitz.outcome(30, 15, CAPITAL);
    expect(tr.attackLoss[12] as number).toBeCloseTo(0.02221280017072782, 15);
    expect(bb.attackLoss[12] as number).toBeCloseTo(0.0100282888709122, 15);
    expect(bb.winChance).toBeGreaterThan(tr.winChance);
  });

  it("`outcome` threads `stopUntil` through to the limiter", () => {
    expect(trueRandom.outcome(10, 10, STANDARD_AUGMENT, 6).unresolved).toBeGreaterThan(0);
    expect(trueRandom.outcome(10, 10, STANDARD_AUGMENT).unresolved).toBe(0);
    expect(balancedBlitz.outcome(10, 10, STANDARD_AUGMENT, 6).unresolved).toBeGreaterThan(0);
  });

  it("`expectedAttackerLoss` comes off the mode's distribution, never a constant", () => {
    expect(trueRandom.expectedAttackerLoss(10, 10)).toBeCloseTo(7.3078, 3);
    // Balanced Blitz clusters results near expectation, so the mean cost of a favourite falls.
    expect(balancedBlitz.expectedAttackerLoss(20, 15)).toBeLessThan(trueRandom.expectedAttackerLoss(20, 15));
    expect(trueRandom.expectedAttackerLoss(5, 0)).toBe(0);
  });

  it("memoises: repeated queries are stable and cheap", () => {
    expect(balancedBlitz.winChance(33, 21)).toBe(balancedBlitz.winChance(33, 21));
    expect(balancedBlitz.outcome(33, 21)).toBe(balancedBlitz.outcome(33, 21));
  });

  it("exposes SMG's published balance constants", () => {
    expect(BALANCE_CONFIG.winChanceCutoff).toBe(0.05);
    expect(BALANCE_CONFIG.outcomePower).toBe(1.8);
  });
});

describe("T13 — the odds perf budgets", () => {
  it("builds the single eager standard table in well under 20 ms", () => {
    resetCaches();
    const start = performance.now();
    const table = buildTable(STANDARD_AUGMENT);
    const elapsed = performance.now() - start;
    expect(table.length).toBe((TABLE_MAX + 1) ** 2);
    expect(elapsed).toBeLessThan(20);
  });

  it("builds a lazily requested non-standard augment in under 20 ms too (F49)", () => {
    resetCaches();
    const start = performance.now();
    buildTable(CAPITAL);
    expect(performance.now() - start).toBeLessThan(20);
  });

  it("does 1,000 in-table lookups in under 1 ms", () => {
    const odds = createOdds("trueRandom");
    odds.winChance(1, 1); // warm
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < 1000; i++) acc += odds.winChance(1 + (i % 120), 1 + (i % 97));
    const elapsed = performance.now() - start;
    expect(acc).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1);
  });
});
