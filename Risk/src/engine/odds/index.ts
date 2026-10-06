/**
 * `@/engine/odds` — hour-one stub (SPEC §4.12). S2 replaces this file; the
 * types are the published contract from `../types`.
 */
import type { DiceMode, OddsTables } from "../types";

export type { DiceAugment, OddsTables, OutcomeDist } from "../types";

/** One table per dice mode; the standard augment is eager, the rest lazy (D22, D24). */
export const createOdds: (mode: DiceMode) => OddsTables = () => {
  throw new Error("S2 pending: createOdds");
};
