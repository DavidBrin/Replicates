/**
 * 64-bit unsigned arithmetic over pairs of u32s, integer ops only.
 *
 * PCG32 (`prng.ts`) and the canonical state digest (`hash.ts`) both need a
 * 64-bit multiply-add, and both must produce byte-identical results in every
 * JS engine — so no `BigInt`, no floats above 2^53, and nothing that depends
 * on the platform's integer width. A `U64` is `[hi, lo]`, each an unsigned
 * 32-bit word; every function returns a fresh tuple and mutates nothing.
 */

/** `[hi, lo]`, each an unsigned 32-bit word. */
export type U64 = readonly [number, number];

/** `a * b` for two u32s, as a full 64-bit `[hi, lo]`. */
export function mulU32(a: number, b: number): U64 {
  const aLo = a & 0xffff;
  const aHi = a >>> 16;
  const bLo = b & 0xffff;
  const bHi = b >>> 16;
  const lolo = aLo * bLo;
  const lohi = aLo * bHi;
  const hilo = aHi * bLo;
  const hihi = aHi * bHi;
  const mid = (lolo >>> 16) + (lohi & 0xffff) + (hilo & 0xffff);
  const lo = (((mid & 0xffff) << 16) | (lolo & 0xffff)) >>> 0;
  const hi = (hihi + (lohi >>> 16) + (hilo >>> 16) + Math.floor(mid / 0x10000)) >>> 0;
  return [hi, lo];
}

/** `a + b` mod 2^64. */
export function addU64(a: U64, b: U64): U64 {
  const loSum = a[1] + b[1];
  const lo = loSum >>> 0;
  const carry = loSum >= 0x100000000 ? 1 : 0;
  const hi = (a[0] + b[0] + carry) >>> 0;
  return [hi, lo];
}

/** `a * b` mod 2^64. */
export function mulU64(a: U64, b: U64): U64 {
  const low = mulU32(a[1], b[1]);
  const cross = (Math.imul(a[0], b[1]) + Math.imul(a[1], b[0])) >>> 0;
  return [(low[0] + cross) >>> 0, low[1]];
}

/** `a >>> n` for `0 <= n < 64`. */
export function shrU64(a: U64, n: number): U64 {
  if (n === 0) return [a[0], a[1]];
  if (n < 32) return [a[0] >>> n, (((a[0] << (32 - n)) | (a[1] >>> n)) >>> 0)];
  return [0, a[0] >>> (n - 32)];
}

/** `a ^ b`. */
export function xorU64(a: U64, b: U64): U64 {
  return [(a[0] ^ b[0]) >>> 0, (a[1] ^ b[1]) >>> 0];
}

/** Lower-case, zero-padded, 16-character hex. */
export function hexU64(a: U64): string {
  return a[0].toString(16).padStart(8, "0") + a[1].toString(16).padStart(8, "0");
}
