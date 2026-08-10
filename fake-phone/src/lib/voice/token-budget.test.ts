// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createVoiceTokenBudget, type VoiceTokenBudget } from "./token-budget";

const TTL_MS = 600_000;
const BUDGET = 800;
const TURN = 400;

function fixedBudget(startAt = 1_000_000) {
  let at = startAt;
  const budget = createVoiceTokenBudget({
    now: () => at,
    newId: (() => {
      let n = 0;
      return () => `reservation-${(n += 1)}`;
    })(),
  });
  return {
    budget,
    expiresAt: startAt + TTL_MS,
    advance: (ms: number): void => void (at += ms),
  };
}

function reserve(
  budget: VoiceTokenBudget,
  expiresAt: number,
  tokens = TURN,
  cap = BUDGET,
  sessionId = "session-1",
) {
  return budget.reserve({ sessionId, expiresAt, tokens, budget: cap });
}

describe("createVoiceTokenBudget", () => {
  it("knows nothing about a session that has never spent", () => {
    const { budget } = fixedBudget();

    expect(budget.spent("session-1")).toBe(0);
  });

  it("counts a reservation as spent before the turn has cost anything", () => {
    // The whole point: an outstanding turn is money already committed, and a
    // concurrent turn must see it that way or it will commit the same money.
    const { budget, expiresAt } = fixedBudget();

    reserve(budget, expiresAt);

    expect(budget.spent("session-1")).toBe(TURN);
  });

  it("reconciles a reservation to what the turn actually cost", () => {
    const { budget, expiresAt } = fixedBudget();

    const reservation = reserve(budget, expiresAt);
    budget.settle(reservation!, 120);

    expect(budget.spent("session-1")).toBe(120);
  });

  it("records an overshoot rather than the reservation it was granted", () => {
    const { budget, expiresAt } = fixedBudget();

    budget.settle(reserve(budget, expiresAt)!, 460);

    expect(budget.spent("session-1")).toBe(460);
  });

  it("never lets a nonsense figure buy budget back", () => {
    const { budget, expiresAt } = fixedBudget();
    const roomy = 5000;

    budget.settle(reserve(budget, expiresAt, TURN, roomy)!, 100);
    budget.settle(reserve(budget, expiresAt, TURN, roomy)!, -1000);
    budget.settle(reserve(budget, expiresAt, TURN, roomy)!, Number.NaN);

    expect(budget.spent("session-1")).toBe(100);
  });

  it("hands the allowance back when a turn fails", () => {
    const { budget, expiresAt } = fixedBudget();

    budget.release(reserve(budget, expiresAt)!);

    expect(budget.spent("session-1")).toBe(0);
  });

  it("refuses a turn the budget cannot cover in full", () => {
    // Half an allowance would buy a line that stops mid-sentence.
    const { budget, expiresAt } = fixedBudget();

    budget.settle(reserve(budget, expiresAt)!, 600);

    expect(reserve(budget, expiresAt)).toBeNull();
    expect(reserve(budget, expiresAt, 300)).toBeNull();
    expect(reserve(budget, expiresAt, 300, 900)).not.toBeNull();
  });

  it("caps overlapping turns at the budget rather than at the budget each", () => {
    // The F2 regression, in the accounting layer: with a read-then-write order
    // these three would each see nothing spent and each take a full allowance.
    const { budget, expiresAt } = fixedBudget();

    const granted = [
      reserve(budget, expiresAt),
      reserve(budget, expiresAt),
      reserve(budget, expiresAt),
    ];

    expect(granted.filter(Boolean)).toHaveLength(2);
    expect(granted[2]).toBeNull();
    expect(budget.spent("session-1")).toBe(BUDGET);
  });

  it("keeps one call's spend away from another's", () => {
    const { budget, expiresAt } = fixedBudget();

    reserve(budget, expiresAt, TURN, BUDGET, "session-1");

    expect(budget.spent("session-2")).toBe(0);
    expect(reserve(budget, expiresAt, TURN, BUDGET, "session-2")).not.toBeNull();
  });

  it("cannot be made to refund the same allowance twice", () => {
    const { budget, expiresAt } = fixedBudget();

    const first = reserve(budget, expiresAt)!;
    reserve(budget, expiresAt);
    budget.release(first);
    budget.release(first);
    budget.settle(first, 400);

    // One outstanding reservation left, and the double release bought nothing.
    expect(budget.spent("session-1")).toBe(TURN);
  });

  it("refuses to reserve anything against a session that has expired", () => {
    const { budget, expiresAt, advance } = fixedBudget();

    advance(TTL_MS + 1);

    expect(reserve(budget, expiresAt)).toBeNull();
  });

  it("forgets a call once its session token could no longer be valid", () => {
    const { budget, expiresAt, advance } = fixedBudget();
    budget.settle(reserve(budget, expiresAt)!, 300);

    advance(TTL_MS + 1);

    expect(budget.spent("session-1")).toBe(0);
  });

  it("refuses a meaningless allowance instead of tracking it", () => {
    const { budget, expiresAt } = fixedBudget();

    expect(reserve(budget, expiresAt, 0)).toBeNull();
    expect(reserve(budget, expiresAt, -50)).toBeNull();
    expect(reserve(budget, expiresAt, Number.NaN)).toBeNull();
    expect(budget.spent("session-1")).toBe(0);
  });

  it("drops everything on reset", () => {
    const { budget, expiresAt } = fixedBudget();
    budget.settle(reserve(budget, expiresAt)!, 200);

    budget.reset();

    expect(budget.spent("session-1")).toBe(0);
  });
});
