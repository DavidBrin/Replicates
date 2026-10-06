/**
 * PCG32, and the purpose-tagged sub-streams every resolver draws from
 * (SPEC §4.4, §4.11; D4).
 *
 * The engine itself contains no randomness at all (D2): the resolver takes an
 * `Rng` as a parameter and every outcome travels inside an action payload
 * (D3). This file is the only implementation of that parameter, and it is
 * integer-only — PCG32's 64-bit LCG state is held as two u32s and advanced
 * through `u64.ts`, so a replay recorded in one JS engine folds identically in
 * another.
 *
 * `rngFor(seed, purpose, turn)` hashes `seed|purpose|turn` with FNV-1a into a
 * 64-bit PCG seed. That is the determinism keystone: adding or removing a draw
 * inside one purpose can never shift another purpose's sequence, so a bot
 * tuning change cannot move a stored battle (D4).
 */
import { addU64, hexU64, mulU64, shrU64, xorU64, type U64 } from "./u64";
import type { Rng, RngPurpose } from "./types";

/** PCG's LCG multiplier, 6364136223846793005 = 0x5851f42d4c957f2d. */
const PCG_MULT: U64 = [0x5851f42d, 0x4c957f2d];
/** PCG's default stream increment, 1442695040888963407 = 0x14057b7ef767814f. */
const PCG_INC: U64 = [0x14057b7e, 0xf767814f];

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;
/** FNV-1a 32-bit offset basis. */
const FNV_BASIS = 0x811c9dc5;
/** A second, unrelated basis, so the two halves of the 64-bit seed differ. */
const FNV_BASIS_B = 0x9e3779b9;

/** `rotr32`, as PCG's XSH-RR output function needs it. */
function rotr32(x: number, r: number): number {
  return ((x >>> r) | (x << ((32 - r) & 31))) >>> 0;
}

/**
 * PCG32 over a 64-bit state held as two u32s; integer ops only.
 *
 * `nextU32` advances the LCG and emits the XSH-RR permutation of the *previous*
 * state, which is PCG's own order — so the first draw depends on the seed and
 * not on one wasted step.
 */
export function pcg32(seedHi: number, seedLo: number): Rng {
  // Seed the way PCG's own `srandom_r` does: one step, so a low-entropy seed
  // does not hand back a low-entropy first draw.
  let state: U64 = addU64(mulU64(addU64([seedHi >>> 0, seedLo >>> 0], PCG_INC), PCG_MULT), PCG_INC);

  function nextU32(): number {
    const old = state;
    state = addU64(mulU64(old, PCG_MULT), PCG_INC);
    const shifted = xorU64(shrU64(old, 18), old);
    const xorshifted = shrU64(shifted, 27)[1];
    const rot = old[0] >>> 27;
    return rotr32(xorshifted, rot);
  }

  return {
    nextU32,
    nextFloat(): number {
      return nextU32() / 0x100000000;
    },
    get state(): readonly [number, number] {
      return [state[0], state[1]];
    },
  };
}

/** FNV-1a over a string's UTF-16 code units, from an explicit basis. */
function fnv1a32(text: string, basis: number): number {
  let h = basis >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = Math.imul((h ^ (c & 0xff)) >>> 0, FNV_PRIME) >>> 0;
    h = Math.imul((h ^ (c >>> 8)) >>> 0, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** A final avalanche, so two neighbouring keys do not seed neighbouring states. */
function avalanche(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The 64-bit PCG seed `rngFor` derives, exposed so a test can pin it. */
export function seedFor(seed: string, purpose: RngPurpose, index: number): readonly [number, number] {
  const key = `${seed}|${purpose}|${index}`;
  return [avalanche(fnv1a32(key, FNV_BASIS)), avalanche(fnv1a32(key, FNV_BASIS_B))];
}

/**
 * Purpose-tagged sub-stream: `pcg32(hash(seed, purpose, index))` — the determinism keystone (D4).
 *
 * `index` is the **seq of the action being produced** (the session's / the server's `nextSeq`),
 * never `state.turn`: keyed on the turn, every attack within one turn would reuse the stream's
 * first draw. Personas and the opening deal use index 0.
 */
export function rngFor(seed: string, purpose: RngPurpose, index: number): Rng {
  const [hi, lo] = seedFor(seed, purpose, index);
  return pcg32(hi, lo);
}

/** `[0, bound)`, from one `nextU32()`. `bound <= 1` draws nothing and yields 0. */
export function nextBelow(rng: Rng, bound: number): number {
  if (bound <= 1) return 0;
  return Math.min(bound - 1, Math.floor((rng.nextU32() / 0x100000000) * bound));
}

/**
 * `[0, length)`, spending **exactly one draw whatever `length` is** — including
 * 0 and 1, where it returns `-1` and `0` respectively.
 *
 * Every resolver indexes through this rather than `nextBelow`, because a
 * resolver's draw count has to be a function of `(territoryCount, seatCount)`
 * alone (§4.11, D4). A helper that skips the draw for a one-element pool makes
 * the count depend on the board, and that is a replay-breaking change waiting
 * to happen.
 */
export function drawIndex(rng: Rng, length: number): number {
  const u = rng.nextU32();
  if (length <= 0) return -1;
  return Math.min(length - 1, Math.floor((u / 0x100000000) * length));
}

/** A uniform element, or `null` for an empty list. Consumes one draw when `items.length > 1`. */
export function pickOne<T>(rng: Rng, items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[nextBelow(rng, items.length)] as T;
}

/**
 * Fisher–Yates over a copy, `items.length - 1` draws, never mutating the input.
 * The draw count is fixed by the length alone, which is what makes a deal
 * reproducible when a rule above it changes (D4).
 */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextBelow(rng, i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** A 64-bit FNV-1a digest of a string, as 16 hex characters. Used by `hashState`. */
export function fnv1a64Hex(text: string): string {
  // 64-bit FNV-1a: basis 0xcbf29ce484222325, prime 0x100000001b3.
  let h: U64 = [0xcbf29ce4, 0x84222325];
  const prime: U64 = [0x00000100, 0x000001b3];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = mulU64(xorU64(h, [0, c & 0xff]), prime);
    h = mulU64(xorU64(h, [0, c >>> 8]), prime);
  }
  return hexU64(h);
}
