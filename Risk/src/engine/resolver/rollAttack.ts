/**
 * `rollAttack` — the only place a battle's outcome is decided (R29–R33, R46,
 * R48, R58, R59, R61; D6, D7).
 *
 * Two modes, two draw counts, both fixed and both asserted by a test (D4):
 *
 * - **manual** — exactly `attackerDice + defendDice` `nextU32()` draws, each
 *   mapped to 1..6, returned sorted descending. **Always True Random**,
 *   whatever `rules.diceMode` says (R61), because the manual roll "functions
 *   identically to the original board game". The reducer derives the losses
 *   from the dice (R31); the action carries the dice, not the losses.
 * - **blitz** — exactly **one** `nextFloat()` (R58, D6), inverse-CDF over the
 *   whole-battle distribution `odds.outcome(a, d, aug, stopUntil)`. A battle
 *   costs one draw however long it "lasts", which is also the only sampling
 *   method Balanced Blitz supports at all, since BB reshapes a whole-battle
 *   distribution rather than individual dice.
 *
 * A **neutral defender is rolled by this same code path with no special case**
 * (R7, F17).
 *
 * ## How `OddsTables.outcome` is consumed — the contract S2 writes against
 *
 * The walk reads the combined array of R52, and nothing else:
 *
 * ```
 * combined = [ attackLoss[0], …, attackLoss[A-1],      // attacker conquers, having lost i
 *              defendLoss[D-1], …, defendLoss[0] ]     // defender holds, having lost j
 * ```
 *
 * length `A + D`, index 0 most favourable to the attacker. **The two aggregate
 * cells `attackLoss[A]` and `defendLoss[D]` are totals and are never walked**
 * — including them would double-count mass (R52, F46).
 *
 * - landing at index `i < A`  -> conquest: `attackerLosses = i`, `defenderLosses = D`;
 * - landing at index `A + k`  -> the defender held, having lost `j = D - 1 - k`:
 *   `defenderLosses = j`, and `attackerLosses` is every troop the attacker
 *   committed — `A` with no limiter, or `(A + 1) - stopUntil` with one (R48).
 *   `unresolved` is then true exactly when that is fewer than `A`.
 *
 * So with a `stopUntil`, S2's `defendLoss[j < D]` must mean "the battle ended
 * with the defender alive, having lost `j`" — the truncated distribution's
 * stopped outcomes live there, and `unresolved` is their total. `dist.unresolved`
 * is read only to cross-check; the walk never needs a slot for it.
 *
 * ## The quantised CDF walk, written out (R59, D7)
 *
 * `Math.pow` appears twice in the Balanced Blitz pipeline and is not
 * bit-identical across JS engines, so the comparison — not the maths — is
 * quantised onto a `2^32` grid:
 *
 * ```ts
 * const u  = rng.nextFloat();              // one draw, [0,1)
 * const qU = Math.round(u * 2 ** 32);      // === the underlying nextU32()
 * let cum = 0;
 * for (let k = 0; k < combined.length; k++) {
 *   cum += combined[k];
 *   if (qU < Math.round(cum * 2 ** 32)) return k;   // `u < cum`, direction pinned
 * }
 * return lastIndexWithMass;                // float residue, never a wrap
 * ```
 *
 * The direction (low index first) and the strict `<` are pinned and tested at
 * `u ∈ {0, ε, 0.5, 1 − ε}`.
 */
import { diceAugmentFor, dicePlan } from "../modifiers";
import type {
  Action,
  AttackIntent,
  DiceMode,
  GameState,
  MapDef,
  OddsTables,
  OutcomeDist,
  Rng,
} from "../types";

/** The grid every branch-deciding float is rounded onto before comparison (R59, D7). */
export const QUANTISATION = 2 ** 32;

/** `Math.round(x * 2**32)`, the one quantiser (D7). */
export function quantise(x: number): number {
  return Math.round(x * QUANTISATION);
}

/** R52's combined array: attacker-favourable first, aggregates excluded (F46). */
export function combinedOutcomes(dist: OutcomeDist): number[] {
  const out: number[] = [];
  for (let i = 0; i < dist.a; i++) out.push(dist.attackLoss[i] ?? 0);
  for (let j = dist.d - 1; j >= 0; j--) out.push(dist.defendLoss[j] ?? 0);
  return out;
}

/**
 * The quantised inverse-CDF walk (R59, D7). Returns the index into
 * `combined`, or `-1` when the distribution carries no mass at all.
 */
export function walkCdf(combined: readonly number[], u: number): number {
  const qU = quantise(u);
  let cum = 0;
  let lastWithMass = -1;
  for (let k = 0; k < combined.length; k++) {
    const p = combined[k] as number;
    if (p > 0) lastWithMass = k;
    cum += p;
    if (qU < quantise(cum)) return k;
  }
  return lastWithMass;
}

/** One die from one `nextU32()` draw, uniform over 1..6. */
function rollDie(rng: Rng): number {
  return 1 + Math.min(5, Math.floor((rng.nextU32() / QUANTISATION) * 6));
}

export function rollAttack(
  state: GameState,
  map: MapDef,
  intent: AttackIntent,
  rng: Rng,
  odds: OddsTables,
  diceMode: DiceMode,
): Extract<Action, { type: "ATTACK" }> {
  const seat = state.turnOrder[state.currentIndex] ?? 0;
  const plan = dicePlan(state, map, intent.from, intent.to);

  if (intent.mode === "manual") {
    // R61 — a manual roll is always True Random, whatever `diceMode` says.
    void diceMode;
    const attackCount = Math.max(1, Math.min(intent.attackerDice, plan.maxAttackDice));
    const attackerDice: number[] = [];
    for (let i = 0; i < attackCount; i++) attackerDice.push(rollDie(rng));
    const defenderDice: number[] = [];
    for (let i = 0; i < plan.defendDice; i++) defenderDice.push(rollDie(rng));
    return {
      type: "ATTACK",
      seat,
      from: intent.from,
      to: intent.to,
      mode: "manual",
      attackerDice: attackerDice.sort((x, y) => y - x),
      defenderDice: defenderDice.sort((x, y) => y - x),
    };
  }

  // R38 — `A` excludes the army that must stay behind.
  const sourceTroops = state.territories[intent.from]?.troops ?? 0;
  const targetTroops = state.territories[intent.to]?.troops ?? 0;
  const a = Math.max(0, sourceTroops - 1);
  const d = Math.max(0, targetTroops);
  const aug = diceAugmentFor(state, map, intent.from, intent.to);
  const dist = odds.outcome(a, d, aug, intent.stopUntil);
  const combined = combinedOutcomes(dist);

  // R58 — exactly one draw, however long the battle "lasts".
  const u = rng.nextFloat();
  const at = walkCdf(combined, u);

  const committed = intent.stopUntil === undefined ? a : Math.max(0, Math.min(a, a + 1 - intent.stopUntil));

  let attackerLosses: number;
  let defenderLosses: number;
  if (at < 0) {
    // A distribution with no mass can only mean a battle with nothing to fight
    // over; treat it as a no-op rather than inventing an outcome.
    attackerLosses = 0;
    defenderLosses = 0;
  } else if (at < dist.a) {
    attackerLosses = at;
    defenderLosses = d;
  } else {
    defenderLosses = dist.d - 1 - (at - dist.a);
    attackerLosses = committed;
  }

  const base = {
    type: "ATTACK",
    seat,
    from: intent.from,
    to: intent.to,
    mode: "blitz",
    attackerLosses,
    defenderLosses,
  } as const;
  return intent.stopUntil === undefined ? base : { ...base, stopUntil: intent.stopUntil };
}
