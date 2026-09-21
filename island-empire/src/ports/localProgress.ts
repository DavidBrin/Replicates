import type { Difficulty } from "@/engine/types";

/**
 * Campaign progress and challenge medals, per device (SPEC §5, D23, D26).
 * Implemented by `adapters/localStorage/progress.ts`.
 */
export interface LevelProgress {
  /** Difficulties beaten; a star per entry. */
  starsWon: Difficulty[];
  bestTurns: Partial<Record<Difficulty, number>>;
}

export interface Progress {
  /** Keyed by campaign level id, e.g. "01". */
  levels: Record<string, LevelProgress>;
  /** Keyed by "<weekKey>:<mapId>", value = difficulties beaten. */
  challengeMedals: Record<string, Difficulty[]>;
  /** Stable per-device id (uuid) used for challenge records. */
  deviceId: string;
}

export interface ProgressPort {
  read(): Progress;
  recordLevelWin(levelId: string, difficulty: Difficulty, turns: number): Progress;
  recordChallengeWin(weekKey: string, mapId: string, difficulty: Difficulty): Progress;
  reset(): void;
}
