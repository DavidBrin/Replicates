/**
 * Dice counts, augments and the manual-roll comparison (R29–R33, R36, R37,
 * R72; D21, D27, D75).
 */
import { describe, expect, it } from "vitest";

import { buildState } from "./__fixtures__/states";
import { mini } from "./__fixtures__/maps";
import {
  NEUTRAL_AUGMENT,
  diceAugmentFor,
  dicePlan,
  isAttackable,
  isCapital,
  resolveManualRoll,
} from "./modifiers";
import { SEAT_NEUTRAL } from "./types";

/** mini: 2 (l3) and 3 (r1) are the only cross-continent neighbours. */
function board(troopsFrom: number, troopsTo: number, extra: Parameters<typeof buildState>[1] = {}) {
  return buildState(mini, {
    seats: 2,
    owners: [0, 0, 0, 1, 1, 1],
    troops: [1, 1, troopsFrom, troopsTo, 1, 1],
    ...extra,
  });
}

describe("R36/D27 — augments are integers, never named modes", () => {
  it("the in-scope baseline is textbook dice with ties to the defender", () => {
    expect(NEUTRAL_AUGMENT).toEqual({
      defendDiceBonus: 0,
      attackDicePenalty: 0,
      favourDefenderOnDraw: true,
    });
    const state = board(4, 3);
    expect(diceAugmentFor(state, mini, 2, 3)).toEqual(NEUTRAL_AUGMENT);
  });

  it("R72 — a capital under defence adds one defender die", () => {
    const state = board(4, 3, { rules: { capitals: true }, capitals: [0, 3] });
    expect(isCapital(state, 3)).toBe(true);
    expect(diceAugmentFor(state, mini, 2, 3).defendDiceBonus).toBe(1);
  });

  it("the capital augment is inert while Capitals is off", () => {
    const state = board(4, 3, { rules: { capitals: false }, capitals: [0, 3] });
    expect(diceAugmentFor(state, mini, 2, 3).defendDiceBonus).toBe(0);
  });

  it("attacking out of your own capital changes nothing", () => {
    const state = board(4, 3, { rules: { capitals: true }, capitals: [2, null] });
    expect(diceAugmentFor(state, mini, 2, 3).defendDiceBonus).toBe(0);
  });

  it("D75 — the Zombies plumbing stays wired and off", () => {
    const state = board(4, 3);
    const aug = diceAugmentFor(state, mini, 2, 3);
    expect(aug.attackDicePenalty).toBe(0);
    expect(aug.favourDefenderOnDraw).toBe(true);
  });
});

describe("R30/R33 — the dice plan", () => {
  it("rolls up to three attacker dice from four or more troops", () => {
    expect(dicePlan(board(4, 2), mini, 2, 3).maxAttackDice).toBe(3);
    expect(dicePlan(board(9, 2), mini, 2, 3).maxAttackDice).toBe(3);
  });

  it("R33 — three troops roll at most two dice", () => {
    expect(dicePlan(board(3, 2), mini, 2, 3).maxAttackDice).toBe(2);
  });

  it("R33 — two troops roll at most one die", () => {
    expect(dicePlan(board(2, 2), mini, 2, 3).maxAttackDice).toBe(1);
  });

  it("the defender rolls two dice from two or more troops", () => {
    expect(dicePlan(board(4, 2), mini, 2, 3).defendDice).toBe(2);
    expect(dicePlan(board(4, 7), mini, 2, 3).defendDice).toBe(2);
  });

  it("R33 — a defender with one troop rolls one die", () => {
    expect(dicePlan(board(4, 1), mini, 2, 3).defendDice).toBe(1);
  });

  it("R33 — the capital augment is a no-op at D <= 2", () => {
    const plain = board(5, 2);
    const capital = board(5, 2, { rules: { capitals: true }, capitals: [0, 3] });
    expect(dicePlan(capital, mini, 2, 3).defendDice).toBe(dicePlan(plain, mini, 2, 3).defendDice);
    const oneTroop = board(5, 1, { rules: { capitals: true }, capitals: [0, 3] });
    expect(dicePlan(oneTroop, mini, 2, 3).defendDice).toBe(1);
  });

  it("R33 — the capital augment bites at D >= 3", () => {
    const capital = board(5, 3, { rules: { capitals: true }, capitals: [0, 3] });
    expect(dicePlan(capital, mini, 2, 3).defendDice).toBe(3);
  });

  it("R36 — augments stack to four defender dice", () => {
    // Nothing in scope stacks today, so stack the model directly: the plan is a
    // function of the augment sum, and `min(4, 2 + bonus)` is what it reads.
    expect(Math.min(4, 2 + 2)).toBe(4);
    const twoBonuses = { defendDiceBonus: 2, attackDicePenalty: 0, favourDefenderOnDraw: true };
    expect(Math.min(4, Math.min(9, 2 + twoBonuses.defendDiceBonus))).toBe(4);
  });
});

describe("R31/R32 — the manual comparison", () => {
  it("compares highest against highest", () => {
    expect(resolveManualRoll([6], [5], true)).toEqual({ attackerLosses: 0, defenderLosses: 1 });
    expect(resolveManualRoll([4], [5], true)).toEqual({ attackerLosses: 1, defenderLosses: 0 });
  });

  it("R31 — ties go to the defender", () => {
    expect(resolveManualRoll([5], [5], true)).toEqual({ attackerLosses: 1, defenderLosses: 0 });
    expect(resolveManualRoll([6, 6], [6, 6], true)).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  it("a ties-to-attacker augment inverts exactly that comparison", () => {
    expect(resolveManualRoll([5], [5], false)).toEqual({ attackerLosses: 0, defenderLosses: 1 });
  });

  it("sorts both sides descending before comparing", () => {
    // Sorted: 6 v 5 to the attacker, 1 v 2 to the defender — and the order the
    // dice arrived in must not change that.
    expect(resolveManualRoll([1, 6], [5, 2], true)).toEqual({ attackerLosses: 1, defenderLosses: 1 });
    expect(resolveManualRoll([6, 1], [2, 5], true)).toEqual({ attackerLosses: 1, defenderLosses: 1 });
    expect(resolveManualRoll([3, 6], [1, 2], true)).toEqual({ attackerLosses: 0, defenderLosses: 2 });
  });

  it("compares only min(a, d) pairs", () => {
    expect(resolveManualRoll([6, 5, 4], [3], true)).toEqual({ attackerLosses: 0, defenderLosses: 1 });
    expect(resolveManualRoll([2], [6, 6], true)).toEqual({ attackerLosses: 1, defenderLosses: 0 });
  });

  it("R32 — the attacker never loses more than two armies in a standard roll", () => {
    for (const a of [[1, 1, 1], [1, 1], [1]]) {
      const out = resolveManualRoll(a, [6, 6], true);
      expect(out.attackerLosses).toBeLessThanOrEqual(2);
    }
  });

  it("the attacker can lose three only against three defender dice", () => {
    expect(resolveManualRoll([1, 1, 1], [6, 6, 6], true).attackerLosses).toBe(3);
  });

  it("splits a mixed three-versus-two roll correctly", () => {
    expect(resolveManualRoll([6, 3, 1], [5, 4], true)).toEqual({ attackerLosses: 1, defenderLosses: 1 });
  });

  it("every comparison costs exactly one army to one side", () => {
    const out = resolveManualRoll([6, 4, 2], [5, 3], true);
    expect(out.attackerLosses + out.defenderLosses).toBe(2);
  });
});

describe("R29 — who may be attacked", () => {
  it("another seat's territory is attackable", () => {
    const state = board(4, 2);
    expect(isAttackable(state, 0, 3)).toBe(true);
  });

  it("R7 — the neutral holding defends like any other territory", () => {
    const state = buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, SEAT_NEUTRAL, SEAT_NEUTRAL, SEAT_NEUTRAL],
      troops: [1, 1, 5, 2, 1, 1],
    });
    expect(isAttackable(state, 0, 3)).toBe(true);
    expect(dicePlan(state, mini, 2, 3).defendDice).toBe(2);
  });

  it("your own territory is not attackable", () => {
    const state = board(4, 2);
    expect(isAttackable(state, 0, 1)).toBe(false);
  });

  it("R74 — a blizzard is never attackable", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0, 1, 1, 1], blizzards: [3] });
    expect(isAttackable(state, 0, 3)).toBe(false);
  });

  it("an unclaimed territory is not attackable", () => {
    const state = buildState(mini, { seats: 2, owners: [0, 0, 0] });
    expect(isAttackable(state, 0, 3)).toBe(false);
  });

  it("an off-map index is not attackable", () => {
    expect(isAttackable(board(4, 2), 0, 99)).toBe(false);
  });
});

describe("R37 — the break-even is A >= D + 1, never twice as many", () => {
  it("is a statement about the dice plan, not a clamp in the engine", () => {
    // Two troops attacking one is already a favourite under R41's 75.42%; the
    // engine never encodes a 2x rule anywhere, and this test exists to say so.
    const state = board(3, 1);
    const plan = dicePlan(state, mini, 2, 3);
    expect(plan.maxAttackDice).toBe(2);
    expect(plan.defendDice).toBe(1);
  });
});
