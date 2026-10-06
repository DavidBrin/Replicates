/**
 * A PCG32 and a `rngFor` for S4's fixtures, so the session runner has a real
 * deterministic stream before S1's `prng.ts` lands. Same shape as §4.11's
 * contract; S4 never ships this, it only develops against it.
 */
import type { Rng, RngPurpose } from "@/engine/types";

/** FNV-1a over a string, as two u32 halves. */
export function hash64(text: string): readonly [number, number] {
  let hi = 0x811c9dc5;
  let lo = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    hi = Math.imul(hi ^ c, 0x01000193) >>> 0;
    lo = Math.imul(lo + c + i, 0x85ebca6b) >>> 0;
    lo = (lo ^ (lo >>> 13)) >>> 0;
  }
  return [hi >>> 0, lo >>> 0];
}

const MUL_HI = 0x5851f42d;
const MUL_LO = 0x4c957f2d;

/** PCG32 over a 64-bit state held as two u32s; integer ops only. */
export function pcg32(seedHi: number, seedLo: number): Rng {
  let hi = seedHi >>> 0;
  let lo = seedLo >>> 0;

  const step = (): void => {
    // 64-bit multiply-add in 32-bit halves.
    const loLo = Math.imul(lo, MUL_LO) >>> 0;
    const carry = (Math.imul(lo >>> 16, MUL_LO >>> 16) + ((Math.imul(lo & 0xffff, MUL_LO >>> 16) +
      Math.imul(lo >>> 16, MUL_LO & 0xffff)) >>> 16)) >>> 0;
    const newHi = (Math.imul(hi, MUL_LO) + Math.imul(lo, MUL_HI) + carry) >>> 0;
    lo = (loLo + 0x14057b7e) >>> 0;
    hi = (newHi + 0x4f1bbcdd + (lo < loLo ? 1 : 0)) >>> 0;
  };

  return {
    nextU32(): number {
      step();
      const xorshifted = (((hi >>> 13) ^ hi) >>> 0) ^ (lo >>> 27);
      const rot = hi >>> 27;
      return (((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0);
    },
    nextFloat(): number {
      return this.nextU32() / 2 ** 32;
    },
    get state(): readonly [number, number] {
      return [hi, lo];
    },
  };
}

/** Purpose-tagged sub-stream, so adding a draw to one purpose never shifts another. */
export function rngFor(seed: string, purpose: RngPurpose, turn: number): Rng {
  const [hi, lo] = hash64(`${seed}|${purpose}|${turn}`);
  return pcg32(hi, lo);
}

/** Uniform integer in `[0, n)`. */
export function nextInt(rng: Rng, n: number): number {
  return n <= 1 ? 0 : Math.min(n - 1, Math.floor(rng.nextFloat() * n));
}

/** Fisher–Yates, in place, from one stream. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, i + 1);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}
