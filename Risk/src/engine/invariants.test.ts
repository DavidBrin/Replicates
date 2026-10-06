/**
 * Board invariants over a real, engine-driven bot-vs-bot game.
 *
 * `properties.test.ts` fuzzes single actions; this drives the **whole loop** —
 * `decideTurn` → `rollAttack`/`drawCard` → `apply` — and re-asserts after every
 * action. It exists because a production walkthrough showed a territory
 * rendering **0 troops** right after a bot's turn, which no single-action test
 * could reproduce: the offending state is three actions deep into an attack
 * chain.
 *
 * The one legitimate 0 is `pendingMoveIn.to`: R62 hands the territory over the
 * instant the defender's last army dies and R63 makes the attacker occupy it
 * with a separate `MOVE_IN`, so between those two actions the tile is owned and
 * empty by design. Every other owned tile — including the 2-seat neutral
 * holding — must hold at least one army.
 */
import { describe, expect, it } from "vitest";

import { drawPersonas, decideTurn, makeView } from "./bots";
import type { TurnPlan } from "./bots/types";
import { createOdds } from "./odds";
import { classicWorld } from "./__fixtures__/maps";
import { config } from "./__fixtures__/states";
import { cardSets, mustTradeNow } from "./cards";
import { legalFortifyMoves } from "./legalActions";
import { rngFor } from "./prng";
import { apply, createInitialState } from "./reducer";
import { dealTerritories, drawCard, rollAttack } from "./resolver";
import {
  SEAT_NONE,
  type Action, type GameConfig, type GameState, type MapDef, type OddsTables, type Seat,
  type TerritoryId,
} from "./types";

/**
 * Every owned, non-blizzard territory holds at least one army.
 *
 * Returns the offending indices rather than asserting, so a failure can name
 * the action that produced it.
 */
export function emptyOwnedTerritories(state: GameState): readonly TerritoryId[] {
  const out: TerritoryId[] = [];
  for (let i = 0; i < state.territories.length; i++) {
    const cell = state.territories[i];
    if (cell === undefined || cell.blizzard || cell.owner === SEAT_NONE) continue;
    // R62/R63 — owned and empty until the move-in lands. The only legal 0.
    if (state.pendingMoveIn?.to === i) continue;
    if (cell.troops < 1) out.push(i);
  }
  return out;
}

interface Driver {
  readonly state: GameState;
  readonly log: readonly string[];
  /** One action; `null` once the game is over. */
  step(): Action | null;
}

/**
 * The session runner's bot loop, reduced to what the engine needs.
 *
 * Deliberately mirrors `src/game/botRunner.ts` + `src/game/session.ts`,
 * including the shared RNG rule: every resolver sub-stream is indexed by the
 * **seq of the action being produced**, never by `state.turn`.
 */
function driveBots(map: MapDef, seats: number, seed: string, odds: OddsTables): Driver {
  const base = config(map, seats, { aiDifficulty: "hard" }, seed);
  // `config` makes seat 0 a human; a bot-vs-bot game needs a persona for every seat.
  const cfg: GameConfig = {
    ...base,
    seats: base.seats.map((s) => ({ ...s, kind: "bot" as const, tier: "hard" as const })),
  };
  const personas = drawPersonas(
    cfg.seats.map((s) => s.tier),
    rngFor(seed, "personaAssign", 0),
    rngFor(seed, "personaJitter", 0),
  );
  const started = dealTerritories(map, cfg, personas, {
    deal: rngFor(seed, "deal", 0),
    turnOrder: rngFor(seed, "turnOrder", 0),
    modifierPlace: rngFor(seed, "modifierPlace", 0),
  });
  let state = createInitialState(map, started);
  // Every seat is a bot here: `config` makes seat 0 human, so convert it.
  const log: string[] = [];
  let nextSeq = 1;

  const personaOf = (seat: Seat) => state.seats[seat]?.persona ?? personas[seat] ?? null;

  function plan(seat: Seat): TurnPlan | null {
    const persona = personaOf(seat);
    if (!persona) return null;
    return decideTurn(makeView(state, map, seat, persona), odds, rngFor(seed, `bot:${seat}`, nextSeq));
  }

  function next(): Action | null {
    if (state.outcome) return null;
    const seat = state.turnOrder[state.currentIndex] as Seat;
    const live = plan(seat);
    if (!live) return null;

    if (state.phase === "draft") {
      const chosen = live.cardTrade ?? (mustTradeNow(state, seat) ? cardSets(state.seats[seat]?.cards ?? [])[0] ?? null : null);
      if (chosen && state.setsTradedThisTurn === 0) {
        return { type: "TRADE_CARDS", seat, cards: chosen, bonusTerritory: null };
      }
      const placement = live.placements.find((p) => state.territories[p.territory]?.owner === seat);
      if (state.troopsToPlace > 0) {
        const territory = placement?.territory
          ?? (state.territories.findIndex((t) => t.owner === seat && !t.blizzard) as TerritoryId);
        const count = Math.min(state.troopsToPlace, Math.max(1, placement?.count ?? state.troopsToPlace));
        return { type: "DRAFT", seat, territory, count };
      }
      return { type: "END_PHASE", seat };
    }

    if (state.phase === "attack") {
      const pending = state.pendingMoveIn;
      if (pending) {
        const want = live.attacks[0]?.moveIn ?? "max";
        const raw = want === "max" ? pending.max : want === "min" ? pending.min : want;
        return { type: "MOVE_IN", seat, count: Math.max(pending.min, Math.min(pending.max, raw)) };
      }
      const attack = live.attacks[0];
      if (attack) {
        return rollAttack(
          state, map,
          attack.mode === "manual"
            ? { from: attack.from, to: attack.to, mode: "manual", attackerDice: attack.attackerDice ?? 3 }
            : {
              from: attack.from, to: attack.to, mode: "blitz",
              ...(attack.stopUntil === undefined ? {} : { stopUntil: attack.stopUntil }),
            },
          rngFor(seed, "battle", nextSeq), odds, state.rules.diceMode,
        );
      }
      return { type: "END_PHASE", seat };
    }

    if (state.phase === "fortify") {
      const move = live.fortify;
      const source = move ? state.territories[move.from] : undefined;
      if (move && !state.fortifyUsed && source && source.owner === seat
        && move.count >= 1 && move.count <= source.troops - 1
        && legalFortifyMoves(state, map, move.from).includes(move.to)) {
        return { type: "FORTIFY", seat, from: move.from, to: move.to, count: move.count };
      }
      if (state.conqueredThisTurn) {
        return drawCard(state, map, seat, rngFor(seed, "cardDeck", nextSeq));
      }
      return { type: "END_TURN", seat };
    }

    return { type: "END_TURN", seat };
  }

  return {
    get state() {
      return state;
    },
    log,
    step() {
      const action = next();
      if (action === null) return null;
      const result = apply(state, map, action);
      if (result.error) {
        // A refused action is itself a finding worth the failure message.
        log.push(`REFUSED ${action.type}: ${result.error.code} ${result.error.message}`);
        // Unblock the loop the way the runner does, so one refusal is not the end.
        const fallback = apply(state, map, { type: "END_TURN", seat: action.seat as Seat });
        if (fallback.error) return null;
        state = fallback.state;
        nextSeq += 1;
        log.push("END_TURN (recovery)");
        return { type: "END_TURN", seat: action.seat } as Action;
      }
      state = result.state;
      nextSeq += 1;
      log.push(action.type);
      return action;
    },
  };
}

describe("every owned territory holds at least one army, action after action", () => {
  it("holds across a 200-action bot-vs-bot game on the classic map (3 seats)", () => {
    const odds = createOdds("trueRandom");
    const driver = driveBots(classicWorld, 3, "invariant-seed-1", odds);
    expect(emptyOwnedTerritories(driver.state)).toEqual([]);

    for (let n = 0; n < 200; n++) {
      const action = driver.step();
      if (action === null) break;
      const empty = emptyOwnedTerritories(driver.state);
      expect(
        empty,
        `after action ${String(n)} (${action.type}); recent: ${driver.log.slice(-6).join(" -> ")}`,
      ).toEqual([]);
    }
    expect(driver.log.filter((l) => l.startsWith("REFUSED"))).toEqual([]);
    // The game has to actually get somewhere for the sweep above to mean anything.
    expect(driver.log.length).toBeGreaterThan(150);
    expect(driver.log.filter((l) => l === "ATTACK").length).toBeGreaterThan(10);
    expect(driver.log.filter((l) => l === "MOVE_IN").length).toBeGreaterThan(5);
  });

  it("holds across several seeds and seat counts", () => {
    const odds = createOdds("balancedBlitz");
    for (const [seats, seed] of [[2, "inv-a"], [3, "inv-b"], [4, "inv-c"], [6, "inv-d"]] as const) {
      const driver = driveBots(classicWorld, seats, seed, odds);
      for (let n = 0; n < 120; n++) {
        if (driver.step() === null) break;
        expect(
          emptyOwnedTerritories(driver.state),
          `${String(seats)} seats / ${seed}: ${driver.log.slice(-6).join(" -> ")}`,
        ).toEqual([]);
      }
    }
  });

  it("the one legal empty tile is the conquered one awaiting its MOVE_IN (R62, R63)", () => {
    const odds = createOdds("trueRandom");
    const driver = driveBots(classicWorld, 3, "invariant-seed-1", odds);
    let sawPending = false;
    for (let n = 0; n < 200; n++) {
      if (driver.step() === null) break;
      const pending = driver.state.pendingMoveIn;
      if (pending === null) continue;
      sawPending = true;
      const tile = driver.state.territories[pending.to];
      // Owned by the attacker, and the move-in range always offers a legal count.
      expect(tile?.owner).toBe(driver.state.turnOrder[driver.state.currentIndex]);
      expect(pending.min).toBeGreaterThanOrEqual(1);
      expect(pending.max).toBeGreaterThanOrEqual(pending.min);
    }
    expect(sawPending).toBe(true);
  });
});
