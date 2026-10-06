/**
 * `TurnPlan` → actions, one at a time (SPEC §5.3).
 *
 * The decision is computed synchronously and in full; the pacing is purely
 * presentational. The driver **re-enters `decideTurn` after every battle**,
 * because an attack chain is adaptive and a call costs microseconds, and it
 * asks for a fresh plan whenever the phase moves on.
 *
 * It owns no timer: `next(state)` is a pure-ish step the session schedules.
 */
import type {
  Action, AttackIntent, GameState, MapDef, OddsTables, Rng, Seat, TerritoryId,
} from "@/engine/types";
import type { TurnPlan } from "@/engine/bots/types";

import type { EngineApi } from "./engineApi";
import type { BotsApi } from "./pending";

export interface BotDriverOptions {
  readonly engine: EngineApi;
  readonly bots: BotsApi;
  readonly odds: OddsTables;
  readonly map: MapDef;
  readonly seat: Seat;
  /** `rngFor(seed, \`bot:${seat}\`, turn)` — a template literal, never a concatenation (F18). */
  readonly rng: () => Rng;
  /** Cross-turn bot memory, carried by the runner (F43). */
  readonly grudge: Float32Array;
}

/** One step: either an already-resolved action, or an attack intent to roll. */
export type BotStep =
  | { readonly kind: "action"; readonly action: Action }
  | { readonly kind: "intent"; readonly intent: AttackIntent; readonly moveIn: "min" | "max" | number };

export interface BotDriver {
  /** The next step for `state`, or `null` when the seat's turn is finished. */
  next(state: GameState): BotStep | null;
  /** How many steps the live plan expects, for `aiStepMs` pacing. */
  size(): number;
  /** Forget the cached plan, so the next `next()` re-enters `decideTurn`. */
  invalidate(): void;
}

/** Placements the plan asked for, clipped to what the seat may actually place. */
function draftSteps(plan: TurnPlan, state: GameState, seat: Seat): Action[] {
  const out: Action[] = [];
  let left = state.troopsToPlace;
  for (const p of plan.placements) {
    if (left <= 0) break;
    const count = Math.min(left, Math.max(1, p.count));
    if (state.territories[p.territory]?.owner !== seat) continue;
    out.push({ type: "DRAFT", seat, territory: p.territory, count });
    left -= count;
  }
  if (left > 0) {
    // Whatever the plan left unplaced goes on the seat's largest stack, so a
    // bot can never stall the game against R17.
    const own = state.territories
      .map((t, i) => ({ i, t }))
      .filter((row) => row.t.owner === seat && !row.t.blizzard)
      .sort((a, b) => b.t.troops - a.t.troops || a.i - b.i);
    const fallback = own[0];
    if (fallback) out.push({ type: "DRAFT", seat, territory: fallback.i as TerritoryId, count: left });
  }
  return out;
}

export function createBotDriver(options: BotDriverOptions): BotDriver {
  const { engine, bots, odds, map, seat, grudge } = options;
  let plan: TurnPlan | null = null;
  let queue: BotStep[] = [];
  let planned = 1;

  const persona = (state: GameState) => state.seats[seat]?.persona ?? null;

  function replan(state: GameState): void {
    const p = persona(state);
    if (!p) {
      plan = null;
      queue = [];
      return;
    }
    const source = p.fogHonest ? engine.viewFor(state, map, seat) : state;
    const view = bots.makeView(source, map, seat, p, grudge);
    plan = bots.decideTurn(view, odds, options.rng());
    queue = [];
  }

  function fill(state: GameState): void {
    if (!plan) replan(state);
    const live = plan;
    if (!live) return;

    if (state.phase === "draft") {
      const mustTrade = engine.mustTradeNow(state, seat);
      const sets = engine.cardSets(state.seats[seat]?.cards ?? []);
      const chosen = live.cardTrade ?? (mustTrade ? sets[0] ?? null : null);
      if (chosen && state.setsTradedThisTurn === 0) {
        const bonus = bonusTerritoryFor(state, seat, chosen);
        queue.push({ kind: "action", action: { type: "TRADE_CARDS", seat, cards: chosen, bonusTerritory: bonus } });
        return; // re-enter once the trade has landed and `troopsToPlace` has grown
      }
      if (state.troopsToPlace > 0) {
        queue.push(...draftSteps(live, state, seat).map((action) => ({ kind: "action" as const, action })));
        return;
      }
      queue.push({ kind: "action", action: { type: "END_PHASE", seat } });
      return;
    }

    if (state.phase === "attack") {
      if (state.pendingMoveIn) {
        const { min, max } = state.pendingMoveIn;
        queue.push({ kind: "action", action: { type: "MOVE_IN", seat, count: max } });
        void min;
        return;
      }
      const attack = live.attacks[0];
      if (attack) {
        const intent: AttackIntent = attack.mode === "manual"
          ? { from: attack.from, to: attack.to, mode: "manual", attackerDice: attack.attackerDice ?? 3 }
          : {
            from: attack.from, to: attack.to, mode: "blitz",
            ...(attack.stopUntil !== undefined ? { stopUntil: attack.stopUntil } : {}),
          };
        queue.push({ kind: "intent", intent, moveIn: attack.moveIn });
        return;
      }
      queue.push({ kind: "action", action: { type: "END_PHASE", seat } });
      return;
    }

    if (state.phase === "fortify") {
      if (live.fortify && !state.fortifyUsed) {
        const { from, to, count } = live.fortify;
        const source = state.territories[from];
        if (source && source.owner === seat && count >= 1 && count <= source.troops - 1
          && engine.legalFortifyMoves(state, map, from).includes(to)) {
          queue.push({ kind: "action", action: { type: "FORTIFY", seat, from, to, count } });
          return;
        }
      }
      queue.push({ kind: "action", action: { type: "END_TURN", seat } });
      return;
    }

    if (state.phase === "claim") {
      const target = claimTarget(state, seat);
      if (target !== null) queue.push({ kind: "action", action: { type: "CLAIM", seat, territory: target } });
      return;
    }

    queue = [];
  }

  return {
    next(state: GameState): BotStep | null {
      if (state.outcome) return null;
      if (state.turnOrder[state.currentIndex] !== seat && state.phase !== "claim") return null;
      if (queue.length === 0) fill(state);
      const step = queue.shift() ?? null;
      planned = Math.max(1, queue.length + 1);
      // A battle, a trade or a phase change invalidates the plan: re-enter.
      if (step && (step.kind === "intent"
        || step.action.type === "TRADE_CARDS"
        || step.action.type === "END_PHASE"
        || step.action.type === "MOVE_IN")) {
        plan = null;
      }
      return step;
    },
    size: () => planned,
    invalidate() {
      plan = null;
      queue = [];
    },
  };
}

/** The +2 territory bonus goes on the first traded card naming a territory we hold (R23). */
function bonusTerritoryFor(
  state: GameState, seat: Seat, cards: readonly [string, string, string],
): TerritoryId | null {
  if (state.territoryBonusLeft <= 0) return null;
  const hand = state.seats[seat]?.cards ?? [];
  for (const id of cards) {
    const card = hand.find((c) => c.id === id);
    if (card?.territory != null && state.territories[card.territory]?.owner === seat) return card.territory;
  }
  return null;
}

/** Claim phase: an unowned non-blizzard tile while any remain, else our own biggest border. */
function claimTarget(state: GameState, seat: Seat): TerritoryId | null {
  const free = state.territories
    .map((t, i) => ({ i, t }))
    .filter((row) => !row.t.blizzard && row.t.owner === -1);
  if (free.length) return (free[0]?.i ?? null) as TerritoryId | null;
  const own = state.territories
    .map((t, i) => ({ i, t }))
    .filter((row) => row.t.owner === seat)
    .sort((a, b) => a.t.troops - b.t.troops || a.i - b.i);
  return (own[0]?.i ?? null) as TerritoryId | null;
}
