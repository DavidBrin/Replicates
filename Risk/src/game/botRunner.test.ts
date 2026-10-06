/**
 * `createBotDriver` against the **real** engine (SPEC §5.3).
 *
 * The rest of the bot-runner coverage goes through `session.test.ts` and its scripted engine,
 * which is the right seam for pacing, re-entry and hand-off. This file exists for the one thing
 * that seam cannot show: whether the step the driver produces is an action §3's rules actually
 * accept. So it pairs the real `engineApi` with a planner stubbed to a known plan, and asserts the
 * step against `engine.validate`.
 */
import { describe, expect, it } from "vitest";

import { buildState, card } from "@/engine/__fixtures__/states";
import { mini } from "@/engine/__fixtures__/maps";
import type { Card, GameState, OddsTables, Seat } from "@/engine/types";
import type { GameView, TurnPlan } from "@/engine/bots/types";

import { createBotDriver } from "./botRunner";
import { engineApi } from "./engineApi";
import type { BotsApi } from "./pending";

const inf = (id: string): Card => card(id, "infantry", null);
const cav = (id: string): Card => card(id, "cavalry", null);
const art = (id: string): Card => card(id, "artillery", null);

/** The acting bot seat. `buildState` makes seat 0 the human, and a seat with no persona plans nothing. */
const BOT: Seat = 1;

/** A planner that answers one fixed plan, and records how often it was asked. */
function stubBots(plan: Partial<TurnPlan> = {}): BotsApi & { calls: () => number } {
  let calls = 0;
  const full: TurnPlan = {
    cardTrade: null,
    placements: [],
    attacks: [],
    fortify: null,
    done: true,
    ...plan,
  };
  return {
    drawPersonas: (tiers) => tiers.map(() => null),
    makeView: (state) => state as unknown as GameView,
    decideTurn: () => {
      calls += 1;
      return full;
    },
    calls: () => calls,
  };
}

function driverFor(state: GameState, seat: Seat, bots: BotsApi) {
  return createBotDriver({
    engine: engineApi,
    bots,
    odds: {} as OddsTables,
    map: mini,
    seat,
    rng: () => engineApi.rngFor("botRunner-spec", "bot:0", 1),
    grudge: new Float32Array(6),
  });
}

/**
 * Codex round 3, finding 2 — R26's trade-down from an eight-card hand reaches five after one
 * trade and still owes a second (the floor is four). `setsTradedThisTurn === 0` is the gate on
 * R24's *optional* second trade, and applying it to a *forced* one sent the runner to `END_PHASE`,
 * which `validate` refuses with `mustTradeCards` while the trade-down is owed.
 */
describe("the forced second trade (R26)", () => {
  /** Mid-trade-down: the bounce has fired, one set is gone, five cards and a set remain. */
  function midTradeDown(hand: readonly Card[]): GameState {
    return buildState(mini, {
      seats: 3,
      owners: [1, 1, 1, 0, 2, 2],
      currentIndex: 1,
      phase: "draft",
      resumePhase: "attack",
      setsTradedThisTurn: 1,
      troopsToPlace: 4,
      hands: { 1: hand },
    });
  }

  const five = [inf("a4"), cav("v1"), cav("v2"), art("x1"), art("x2")];

  it("trades again instead of trying to end the phase", () => {
    const state = midTradeDown(five);
    expect(engineApi.mustTradeNow(state, BOT)).toBe(true);
    const step = driverFor(state, BOT, stubBots()).next(state);
    expect(step?.kind).toBe("action");
    if (step?.kind !== "action") throw new Error("expected an action step");
    expect(step.action.type).toBe("TRADE_CARDS");
    expect(engineApi.validate(state, mini, step.action)).toBeNull();
  });

  it("and the turn then proceeds: trade, draft, end the phase", () => {
    let s = midTradeDown(five);
    const bots = stubBots();
    const driver = driverFor(s, BOT, bots);
    const kinds: string[] = [];
    for (let guard = 0; guard < 12; guard += 1) {
      const step = driver.next(s);
      if (!step || step.kind !== "action") break;
      const result = engineApi.apply(s, mini, step.action);
      // Every step the driver offers has to be one the rules accept; the wedge was a refusal.
      expect(result.error).toBeUndefined();
      s = result.state;
      kinds.push(step.action.type);
      if (step.action.type === "END_PHASE") break;
    }
    expect(kinds[0]).toBe("TRADE_CARDS");
    expect(kinds).toContain("END_PHASE");
    expect(s.phase).toBe("attack");
    expect(s.setsTradedThisTurn).toBe(2);
    expect(s.seats[BOT]?.cards).toHaveLength(2);
  });

  it("still refuses the OPTIONAL second trade a plan asks for (R24)", () => {
    // Four cards with a set, nothing forced, one set already traded: the plan does not get another.
    const state = buildState(mini, {
      seats: 3,
      owners: [1, 1, 1, 0, 2, 2],
      currentIndex: 1,
      phase: "draft",
      setsTradedThisTurn: 1,
      troopsToPlace: 3,
      hands: { 1: [inf("b1"), inf("b2"), inf("b3"), cav("b4")] },
    });
    expect(engineApi.mustTradeNow(state, BOT)).toBe(false);
    const bots = stubBots({ cardTrade: ["b1", "b2", "b3"] });
    const step = driverFor(state, BOT, bots).next(state);
    if (step?.kind !== "action") throw new Error("expected an action step");
    expect(step.action.type).not.toBe("TRADE_CARDS");
  });

  it("R24's forced trade at turn start is produced without a plan asking for it", () => {
    const state = buildState(mini, {
      seats: 3,
      owners: [1, 1, 1, 0, 2, 2],
      currentIndex: 1,
      phase: "draft",
      troopsToPlace: 3,
      hands: { 1: [inf("c1"), inf("c2"), inf("c3"), cav("c4"), art("c5")] },
    });
    const step = driverFor(state, BOT, stubBots()).next(state);
    if (step?.kind !== "action") throw new Error("expected an action step");
    expect(step.action.type).toBe("TRADE_CARDS");
    expect(engineApi.validate(state, mini, step.action)).toBeNull();
  });
});
