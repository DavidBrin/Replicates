/**
 * Seeded pseudo-random numbers for the engine (SPEC §4 "The engine contract",
 * rule 1: no `Math.random` — only a seed that lives in `GameState.rng`).
 *
 * mulberry32: a 32-bit generator with a single word of state, good enough for
 * capital placement, AI tie-breaks and map generation, and trivially
 * serialisable (the state IS the seed). Every helper is pure: it takes a seed
 * and returns the value together with the seed to use next, so callers thread
 * the seed through explicitly and the same seed always yields the same draw.
 */

export interface RandomResult {
  /** Uniform in [0, 1). */
  value: number;
  /** The seed to pass to the next call. */
  seed: number;
}

/** Coerces any number to the unsigned 32-bit word mulberry32 works on. */
export function normaliseSeed(seed: number): number {
  return (Number.isFinite(seed) ? seed : 0) >>> 0;
}

/** One mulberry32 step: returns a float in [0, 1) and the advanced seed. */
export function next(seed: number): RandomResult {
  const advanced = (normaliseSeed(seed) + 0x6d2b79f5) >>> 0;
  let t = advanced;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, seed: advanced };
}

/** Integer in [0, maxExclusive); `maxExclusive <= 0` yields 0 without advancing. */
export function nextInt(seed: number, maxExclusive: number): { value: number; seed: number } {
  if (maxExclusive <= 0) return { value: 0, seed: normaliseSeed(seed) };
  const r = next(seed);
  return { value: Math.floor(r.value * maxExclusive), seed: r.seed };
}

/** Integer in [min, maxExclusive). */
export function nextIntRange(
  seed: number,
  min: number,
  maxExclusive: number,
): { value: number; seed: number } {
  const r = nextInt(seed, maxExclusive - min);
  return { value: min + r.value, seed: r.seed };
}

/** True with probability `p`. */
export function chance(seed: number, p: number): { value: boolean; seed: number } {
  const r = next(seed);
  return { value: r.value < p, seed: r.seed };
}

/** A uniformly chosen element, or `undefined` for an empty list. */
export function pick<T>(seed: number, items: readonly T[]): { value: T | undefined; seed: number } {
  if (items.length === 0) return { value: undefined, seed: normaliseSeed(seed) };
  const r = nextInt(seed, items.length);
  return { value: items[r.value], seed: r.seed };
}

/** Fisher–Yates over a copy; the input is never mutated. */
export function shuffle<T>(seed: number, items: readonly T[]): { value: T[]; seed: number } {
  const out = items.slice();
  let s = normaliseSeed(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.seed;
    const j = r.value;
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return { value: out, seed: s };
}

/** Derives an independent seed from a seed and a small integer (per-attempt / per-seat streams). */
export function deriveSeed(seed: number, salt: number): number {
  let h = (normaliseSeed(seed) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
