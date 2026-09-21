"use client";

import type { Difficulty } from "@/engine/types";
import type { LevelProgress, Progress, ProgressPort } from "@/ports/localProgress";

const KEY = "island-empire:progress:v1";

function newDeviceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

function empty(): Progress {
  return { levels: {}, challengeMedals: {}, deviceId: newDeviceId() };
}

function safeRead(): Progress {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
    if (!raw) {
      const fresh = empty();
      safeWrite(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      levels: parsed.levels ?? {},
      challengeMedals: parsed.challengeMedals ?? {},
      deviceId: parsed.deviceId ?? newDeviceId(),
    };
  } catch {
    return empty();
  }
}

function safeWrite(p: Progress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — progress simply does not persist */
  }
}

/** Campaign progress and challenge medals in localStorage. */
export const localProgress: ProgressPort = {
  read: safeRead,
  recordLevelWin(levelId: string, difficulty: Difficulty, turns: number): Progress {
    const p = safeRead();
    const current: LevelProgress = p.levels[levelId] ?? { starsWon: [], bestTurns: {} };
    const starsWon = current.starsWon.includes(difficulty)
      ? current.starsWon
      : [...current.starsWon, difficulty];
    const best = current.bestTurns[difficulty];
    const bestTurns = { ...current.bestTurns, [difficulty]: best === undefined ? turns : Math.min(best, turns) };
    const next = { ...p, levels: { ...p.levels, [levelId]: { starsWon, bestTurns } } };
    safeWrite(next);
    return next;
  },
  recordChallengeWin(weekKey: string, mapId: string, difficulty: Difficulty): Progress {
    const p = safeRead();
    const key = `${weekKey}:${mapId}`;
    const won = p.challengeMedals[key] ?? [];
    const next = {
      ...p,
      challengeMedals: { ...p.challengeMedals, [key]: won.includes(difficulty) ? won : [...won, difficulty] },
    };
    safeWrite(next);
    return next;
  },
  reset() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
