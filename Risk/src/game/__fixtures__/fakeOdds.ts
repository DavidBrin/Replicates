/**
 * A deterministic stand-in for S2's `createOdds` (SPEC §4.12), so the Blitz
 * readout, the attack limiter and the session runner can be built and tested
 * before `@/engine/odds` lands.
 *
 * The numbers are a smooth, monotone approximation — **never** an oracle.
 * No test here asserts a probability; they assert that the UI renders what
 * the table returns.
 */
import type { DiceAugment, DiceMode, OddsTables, OutcomeDist } from "@/engine/types";

/** The fitted logistic of R43, used here as the whole table rather than its tail. */
function logistic(a: number, d: number, aug: DiceAugment | undefined): number {
  if (d <= 0) return 1;
  if (a <= 0) return 0;
  const bias = 0.86 + 0.14 * (aug?.defendDiceBonus ?? 0) + 0.1 * (aug?.attackDicePenalty ?? 0);
  const z = (a - bias * d) / (0.63 * Math.sqrt(a + d));
  return 1 / (1 + Math.exp(-z));
}

function distribution(a: number, d: number, win: number, stopUntil: number | undefined): OutcomeDist {
  const attackLoss = new Float64Array(a + 1);
  const defendLoss = new Float64Array(d + 1);
  // Spread the win mass over "lost i of a" with a triangular shape, and the
  // loss mass onto the terminal entries. Sums to 1 in both arrays by
  // construction, which is all the UI needs.
  let total = 0;
  for (let i = 0; i < a; i += 1) total += a - i;
  for (let i = 0; i < a; i += 1) attackLoss[i] = (win * (a - i)) / (total || 1);
  attackLoss[a] = 1 - win;
  let dTotal = 0;
  for (let j = 0; j < d; j += 1) dTotal += d - j;
  for (let j = 0; j < d; j += 1) defendLoss[j] = ((1 - win) * (d - j)) / (dTotal || 1);
  defendLoss[d] = win;
  const unresolved = stopUntil !== undefined && stopUntil > 0 ? Math.min(0.2, (1 - win) / 2) : 0;
  return { a, d, attackLoss, defendLoss, unresolved, winChance: win };
}

export interface FakeOddsOptions {
  /** Force every `winChance` to this value, so a test can pin the readout. */
  readonly fixedWinChance?: number;
}

export function createFakeOdds(mode: DiceMode = "balancedBlitz", options: FakeOddsOptions = {}): OddsTables {
  const win = (a: number, d: number, aug?: DiceAugment): number =>
    options.fixedWinChance ?? logistic(a, d, aug);
  return {
    mode,
    winChance: win,
    outcome: (a, d, aug, stopUntil) => distribution(a, d, win(a, d, aug), stopUntil),
    expectedAttackerLoss: (a, d, aug) => Math.min(a, d * (1 - win(a, d, aug)) + d * 0.6),
    certainWin: (a, d, aug) => win(a, d, aug) >= 1 - 1e-9,
  };
}
