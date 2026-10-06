/**
 * A hand-written `OddsTables` for S1's own tests.
 *
 * The dice MATHS is S2's (R34–R45) and S1 must not import it (§4.2), so
 * `rollAttack`'s tests inject a table whose `outcome()` returns a distribution
 * the test wrote itself. That is what makes the inverse-CDF walk testable at
 * all: with a known distribution, a known `u` has exactly one right answer.
 */
import type { DiceAugment, DiceMode, OddsTables, OutcomeDist } from "../types";

/**
 * A whole-battle distribution built from two sparse maps.
 *
 * - `conquerLosing[i]` — P(the attacker conquers having lost `i`), `i < a`;
 * - `holdLosing[j]`    — P(the defender holds having lost `j`), `j < d`.
 *
 * The two aggregate cells follow: `attackLoss[a]` is the total of
 * `holdLosing`, `defendLoss[d]` the total of `conquerLosing` — which is also
 * `winChance` (R40). They are **totals, not outcomes**, which is exactly why
 * `combinedOutcomes` never walks them (R52, F46).
 */
export function makeDist(
  a: number,
  d: number,
  spec: {
    readonly conquerLosing?: Readonly<Record<number, number>>;
    readonly holdLosing?: Readonly<Record<number, number>>;
    readonly unresolved?: number;
  },
): OutcomeDist {
  const attackLoss = new Float64Array(a + 1);
  const defendLoss = new Float64Array(d + 1);
  let win = 0;
  for (const [key, p] of Object.entries(spec.conquerLosing ?? {})) {
    const i = Number(key);
    if (i >= 0 && i < a) {
      attackLoss[i] = p;
      win += p;
    }
  }
  let lose = 0;
  for (const [key, p] of Object.entries(spec.holdLosing ?? {})) {
    const j = Number(key);
    if (j >= 0 && j < d) {
      defendLoss[j] = p;
      lose += p;
    }
  }
  attackLoss[a] = lose;
  defendLoss[d] = win;
  return { a, d, attackLoss, defendLoss, unresolved: spec.unresolved ?? 0, winChance: win };
}

/** "The attacker always conquers without a scratch" — the simplest table. */
export function cleanSweep(a: number, d: number): OutcomeDist {
  return makeDist(a, d, { conquerLosing: { 0: 1 } });
}

/**
 * An `OddsTables` S1 can call through. `outcome` is injectable; the other three
 * methods are derived from whatever it returns, so a test never has to keep
 * four numbers consistent by hand.
 */
export function fakeOdds(
  outcome: (a: number, d: number, aug?: DiceAugment, stopUntil?: number) => OutcomeDist = cleanSweep,
  mode: DiceMode = "trueRandom",
): OddsTables {
  return {
    mode,
    outcome,
    winChance(a, d, aug) {
      return outcome(a, d, aug).winChance;
    },
    expectedAttackerLoss(a, d, aug) {
      const dist = outcome(a, d, aug);
      let total = 0;
      for (let i = 0; i <= dist.a; i++) total += i * (dist.attackLoss[i] ?? 0);
      return total;
    },
    certainWin(a, d, aug) {
      return outcome(a, d, aug).winChance >= 1 - 1e-9;
    },
  };
}
