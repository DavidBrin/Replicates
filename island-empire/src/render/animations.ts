import type { PlayerColour, TileCoord, UnitLevel } from "@/engine/types";

/**
 * Cosmetic, time-based effects driven by `EngineEvent`s (SPEC §8 animation
 * list). None of this enters `GameState`; the session enqueues, the renderer
 * draws whatever is in flight at `now`, and expired items are pruned.
 */

export const DURATION = {
  slide: 150,
  flash: 200,
  coin: 400,
  coinStagger: 40,
  float: 600,
  banner: 1100,
  bankrupt: 300,
  graveFade: 400,
  crumble: 250,
  shieldPop: 100,
  washFade: 100,
  starPop: 150,
} as const;

export type Anim =
  | { type: "slide"; from: TileCoord; to: TileCoord; level: UnitLevel; colour: PlayerColour; start: number; duration: number }
  | { type: "flash"; at: TileCoord; colour: PlayerColour; start: number; duration: number }
  | { type: "coin"; from: TileCoord; to: TileCoord; start: number; duration: number }
  | { type: "float"; at: TileCoord; text: string; colour: string; start: number; duration: number }
  | { type: "fade"; at: TileCoord; kind: "bankrupt" | "grave" | "unit"; colour: PlayerColour | null; level: UnitLevel | null; start: number; duration: number }
  | { type: "crumble"; at: TileCoord; colour: PlayerColour; start: number; duration: number };

export interface AnimState {
  items: Anim[];
  /** When true every enqueue completes instantly (reduced motion / e2e). */
  skip: boolean;
}

export function createAnimState(skip = false): AnimState {
  return { items: [], skip };
}

export function enqueue(anims: AnimState, item: Anim): void {
  if (anims.skip) return;
  anims.items.push(item);
}

/** Drop finished items; returns whether anything is still in flight. */
export function pruneAnims(anims: AnimState, now: number): boolean {
  anims.items = anims.items.filter((a) => now < a.start + a.duration);
  return anims.items.length > 0;
}

export function animsActive(anims: AnimState): boolean {
  return anims.items.length > 0;
}

/** Longest remaining time, so the session can wait for the queue to drain. */
export function animsRemaining(anims: AnimState, now: number): number {
  let max = 0;
  for (const a of anims.items) max = Math.max(max, a.start + a.duration - now);
  return max;
}

export function progress(a: Anim, now: number): number {
  return Math.min(1, Math.max(0, (now - a.start) / a.duration));
}
