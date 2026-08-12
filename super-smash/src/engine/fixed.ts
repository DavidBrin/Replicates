/**
 * Fixed-point arithmetic — the foundation the whole simulation stands on.
 *
 * Rollback netcode requires that two machines stepping the same state with the
 * same inputs produce *bit-identical* results. Plain IEEE-754 `+ - * /` is
 * actually specified precisely enough to be safe for that, but the transcendental
 * functions are not: the spec marks `Math.sin`, `Math.cos`, `Math.pow`, `Math.exp`
 * and friends as *recommended*, not required, so two engines (or two versions of
 * one engine) may legally disagree in the last bits. A launch angle resolved
 * through `Math.cos` is exactly the kind of value that silently diverges after a
 * few hundred frames and surfaces as "the same hit killed on their screen and
 * not on mine".
 *
 * So: every quantity the simulation can branch on is an integer here, scaled by
 * `ONE`, and trigonometry comes from an integer lookup table (below) rather than
 * from `Math`. The numbers stay ordinary JS doubles, but they always hold whole
 * values, and doubles represent integers exactly up to 2^53 — far above anything
 * this game produces. See DECISIONS D3.
 */

/** Fractional bits. 12 gives ~0.00024 resolution, ample for a 500-unit stage. */
export const SHIFT = 12;

/** 1.0 in fixed-point. */
export const ONE = 1 << SHIFT; // 4096

/** Convert a real number to fixed-point. Authoring-time only — never in the sim. */
export function fx(n: number): number {
  return Math.round(n * ONE);
}

/** Convert fixed-point back to a real number. Rendering and display only. */
export function toFloat(n: number): number {
  return n / ONE;
}

/**
 * Multiply two fixed-point values.
 *
 * `a * b` can reach ~2^42 for the magnitudes this game uses (a few hundred
 * units), which is exactly representable as a double, so the intermediate never
 * loses precision before it is scaled back down. `Math.trunc` rather than
 * `Math.floor` so the rounding is symmetric about zero — a fighter drifting left
 * and a fighter drifting right lose the same amount, which `floor` would not do.
 */
export function mul(a: number, b: number): number {
  return Math.trunc((a * b) / ONE);
}

/** Divide two fixed-point values. Truncates toward zero, like `mul`. */
export function div(a: number, b: number): number {
  return Math.trunc((a * ONE) / b);
}

/**
 * An exact rational constant, as `[numerator, denominator]`.
 *
 * Q12 cannot represent most of the decimals the research quotes: `fx(0.65)` is
 * 2662/4096 = 0.649902, `fx(0.8)` is 3277/4096 = 0.800049, `fx(0.4)` is
 * 0.399902. Everywhere those constants merely scale a position or a velocity
 * that is a ten-thousandth off is a rounding error nobody can see. But every
 * formula that ends in `floor(… )` — hitstun, hitlag and shieldstun are all
 * quoted as whole frames — turns that ten-thousandth into a **whole frame** at
 * every exact boundary, and always in the same direction: a constant that is
 * fractionally low loses a frame, one that is fractionally high gains one.
 *
 * So a constant on the path to a floor is carried as the fraction itself and
 * applied with `byRatio`, which multiplies and divides once and therefore
 * truncates once. This bug has now been found three times (0.4 in hitstun,
 * 0.65 in hitlag, 0.8 in shieldstun); the type exists so the fourth is a type
 * error rather than a fourth review finding.
 */
export type Ratio = readonly [numerator: number, denominator: number];

/** Apply an exact rational constant to a fixed-point value, truncating once. */
export function byRatio(a: number, r: Ratio): number {
  return Math.trunc((a * r[0]) / r[1]);
}

/**
 * Apply several exact rational constants as one, truncating **once** at the end.
 *
 * `byRatio(byRatio(v, a), b)` is not the same number as applying `a·b` in one
 * step: each call truncates, and two truncations can land a value on the wrong
 * side of the single `floor` that turns it into a frame count. Shieldstun is
 * where this bites — its published formula has exactly one floor, so every
 * multiplier inside it has to be combined before that floor happens.
 *
 * A concrete case, found by review rather than by testing: Marth's down smash
 * body hit at 8%, charged 22 frames, twice-stale. Truncating per multiplier
 * gives 6 frames of shieldstun; combining first gives 7. One frame is the
 * difference between a move being punishable on shield and not.
 *
 * The products stay small — numerators and denominators here are two-digit
 * integers, and the largest realistic damage is a few hundred in Q12 — so the
 * intermediate is nowhere near the 2^53 exact-integer ceiling.
 */
export function byRatios(a: number, ratios: readonly Ratio[]): number {
  let num = 1;
  let den = 1;
  for (const [n, d] of ratios) {
    num *= n;
    den *= d;
  }
  return Math.trunc((a * num) / den);
}

export function abs(a: number): number {
  return a < 0 ? -a : a;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Move `v` toward `target` by at most `maxDelta`. The traction/friction primitive. */
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) return Math.min(v + maxDelta, target);
  if (v > target) return Math.max(v - maxDelta, target);
  return v;
}

/* ------------------------------------------------------------ trigonometry -- */

/**
 * Sine table, one entry per tenth of a degree over a full turn.
 *
 * Built once at module load with `Math.sin`. That is not a determinism hole:
 * the table is *quantised to integers* the moment it is built, and the gap
 * between adjacent representable fixed-point values (1/4096) is around 200,000
 * times larger than the worst-case disagreement between two engines' `Math.sin`
 * (a few ULPs of a double). Two engines therefore round to the same integer for
 * every entry. What would be unsafe is calling `Math.sin` *inside* the step
 * function on an arbitrary angle and keeping the raw double; that never happens.
 */
const TRIG_STEPS = 3600;
const SIN_TABLE = new Int32Array(TRIG_STEPS);
for (let i = 0; i < TRIG_STEPS; i++) {
  SIN_TABLE[i] = Math.round(Math.sin((i / TRIG_STEPS) * 2 * Math.PI) * ONE);
}

/** Index into the table from an angle given in fixed-point degrees. */
function tableIndex(degreesFx: number): number {
  // degreesFx is degrees * ONE. Tenths of a degree = degreesFx * 10 / ONE.
  const tenths = Math.trunc((degreesFx * 10) / ONE);
  return ((tenths % TRIG_STEPS) + TRIG_STEPS) % TRIG_STEPS;
}

/** Sine of an angle in fixed-point degrees, returned in fixed-point. */
export function sinDeg(degreesFx: number): number {
  return SIN_TABLE[tableIndex(degreesFx)];
}

/** Cosine of an angle in fixed-point degrees, returned in fixed-point. */
export function cosDeg(degreesFx: number): number {
  return SIN_TABLE[tableIndex(degreesFx + fx(90))];
}

/**
 * Integer square root of a fixed-point value, returned in fixed-point.
 *
 * `Math.sqrt` is correctly rounded per IEEE-754 and would in fact be safe, but
 * routing it through the same integer discipline as everything else means the
 * simulation has exactly one rule — no `Math` in the step function — instead of
 * a rule with an exception someone has to remember.
 */
export function sqrt(aFx: number): number {
  if (aFx <= 0) return 0;
  // sqrt(a/ONE) * ONE  ==  sqrt(a * ONE)
  const n = aFx * ONE;
  let x = Math.floor(Math.sqrt(n)); // seed; refined to the exact integer below
  // Newton refinement, then a correction pass so the result is the exact floor
  // regardless of how the seed rounded.
  for (let i = 0; i < 3; i++) {
    if (x === 0) break;
    x = Math.floor((x + Math.floor(n / x)) / 2);
  }
  while (x > 0 && x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** Magnitude of a fixed-point vector. */
export function magnitude(x: number, y: number): number {
  if (x === 0) return abs(y);
  if (y === 0) return abs(x);
  return sqrt(mul(x, x) + mul(y, y));
}

/* -------------------------------------------------------------------- rng -- */

/**
 * Mulberry32 — a small, fast, seeded PRNG.
 *
 * `Math.random` is unseedable and implementation-defined, so it can never appear
 * in the simulation. This generator's entire state is one 32-bit integer, which
 * lives inside `GameState` and is therefore saved, rolled back and re-simulated
 * exactly like a fighter's position. Two peers that agree on the seed agree on
 * every random outcome — which star-KO plays, which way a Smash Ball drifts —
 * for the whole match.
 */
export function nextRandom(seed: number): { seed: number; value: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { seed: t | 0, value };
}

/** Random integer in `[0, bound)`, advancing the seed. */
export function randomInt(seed: number, bound: number): { seed: number; value: number } {
  const r = nextRandom(seed);
  return { seed: r.seed, value: Math.floor(r.value * bound) };
}
