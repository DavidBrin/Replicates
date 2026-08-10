/**
 * A tiny seeded PRNG (mulberry32) plus a handful of pure helpers built on
 * it. This is the ONLY source of randomness anywhere in the seed data —
 * `Math.random()` and `Date.now()` never appear in `seed-data/**` or
 * `seed.ts`. Given the same numeric seed, `mulberry32` produces the exact
 * same infinite stream of floats every time, in every process, forever —
 * that determinism is what makes "build the seed twice, deep-equal" a
 * meaningful test rather than a coin flip.
 *
 * Not a dependency: this is ~10 lines, well below the threshold where
 * pulling in a package (and its own determinism/version-pinning surface)
 * would be worth it for a private demo dataset.
 */

export type Prng = () => number;

/** mulberry32 — a small, fast, well-distributed 32-bit PRNG. Returns a new
 * generator function; each call to that function advances the internal
 * state and returns a float in `[0, 1)`. */
export function mulberry32(seed: number): Prng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in `[min, max)`. */
export function randFloat(rng: Prng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform integer in `[min, max]` (inclusive both ends). */
export function randInt(rng: Prng, min: number, max: number): number {
  return Math.floor(randFloat(rng, min, max + 1));
}

/** Picks one element of a non-empty array uniformly at random. */
export function pick<T>(rng: Prng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new RangeError("pick: items must be non-empty");
  }
  return items[randInt(rng, 0, items.length - 1)]!;
}

/** Standard-normal (mean 0, sd 1) sample via the Box–Muller transform,
 * consuming exactly two draws from `rng` per call. Used for the Explore
 * markets' random-walk noise term (drift + Gaussian noise). */
export function randNormal(rng: Prng): number {
  let u = 0;
  let v = 0;
  // rng() is `[0, 1)`; `Math.log(0)` is -Infinity, so nudge away from 0.
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-uniform sample in `[min, max]` — appropriate for quantities that
 * span orders of magnitude (e.g. Explore market volume, $100K–$50M), where
 * a plain uniform draw would make the top of the range wildly
 * over-represented relative to how such volumes actually distribute. */
export function logUniform(rng: Prng, min: number, max: number): number {
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return Math.exp(randFloat(rng, logMin, logMax));
}

/** Splits `total` across `weights.length` non-negative random shares that
 * sum to exactly `total` (each weight redrawn from `rng`, then
 * normalized) — used to size a market's synthetic trade volume into
 * individual trade costs. */
export function splitByRandomWeights(rng: Prng, total: number, count: number): number[] {
  const raw = Array.from({ length: count }, () => randFloat(rng, 0.2, 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (w / sum) * total);
}
