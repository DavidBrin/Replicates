import type { Difficulty } from "@/engine/types";
import type { Progress } from "@/ports/localProgress";

import { LEVEL_IDS, isLevelId } from "./levels";

/**
 * Campaign progression rules (SPEC §2, D27, D28), pure over a `Progress`
 * snapshot so the overworld and the intro screen agree and both are testable
 * without a browser.
 */

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];

/** Stars won on a level: one per difficulty beaten, 0..3. */
export function starsFor(progress: Progress, levelId: string): number {
  const won = progress.levels[levelId]?.starsWon ?? [];
  return DIFFICULTIES.filter((d) => won.includes(d)).length;
}

export function hasStar(progress: Progress, levelId: string, difficulty: Difficulty): boolean {
  return progress.levels[levelId]?.starsWon.includes(difficulty) ?? false;
}

/** Level 01 is always open; level N opens once level N−1 has at least one star. */
export function isUnlocked(progress: Progress, levelId: string): boolean {
  if (!isLevelId(levelId)) return false;
  const i = (LEVEL_IDS as readonly string[]).indexOf(levelId);
  if (i === 0) return true;
  return starsFor(progress, LEVEL_IDS[i - 1]!) >= 1;
}

/** The highest unlocked level id — where a returning player's avatar stands. */
export function furthestUnlocked(progress: Progress): string {
  let furthest: string = LEVEL_IDS[0];
  for (const id of LEVEL_IDS) {
    if (isUnlocked(progress, id)) furthest = id;
    else break;
  }
  return furthest;
}

export function totalStars(progress: Progress): number {
  return LEVEL_IDS.reduce((sum, id) => sum + starsFor(progress, id), 0);
}

export const MAX_STARS = LEVEL_IDS.length * DIFFICULTIES.length;
