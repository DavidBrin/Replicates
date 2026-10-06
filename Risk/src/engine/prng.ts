import type { Rng, RngPurpose } from "./types";

function pending(name: string): never {
  throw new Error(`S1 pending: ${name}`);
}

/** PCG32 over a 64-bit state held as two u32s; integer ops only (Math.imul, >>> 0). */
export const pcg32: (seedHi: number, seedLo: number) => Rng = () => pending("pcg32");

/** Purpose-tagged sub-stream: pcg32(hash(seed, purpose, turn)). The determinism keystone (D4). */
export const rngFor: (seed: string, purpose: RngPurpose, turn: number) => Rng = () => pending("rngFor");
