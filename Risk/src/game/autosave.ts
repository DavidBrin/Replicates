/**
 * `risk:session:v1:<sourceKey>` — the resumable offline game (SPEC §4.15).
 *
 * The envelope carries the **seed** as well as the state, because a resumed
 * session has to keep drawing from the same sub-streams. It is written after
 * every `END_TURN` and on `visibilitychange → hidden`, and cleared the moment
 * a game ends.
 */
import type { GameConfig } from "@/engine/types";

import { readJson, removeKey, writeJson } from "@/adapters/localStorage/store";

import type { SavedSession } from "./session";
import { sourceKey } from "./sessionConfig";

export const SESSION_KEY_PREFIX = "risk:session:v1:";

export function sessionKey(config: GameConfig): string {
  return `${SESSION_KEY_PREFIX}${sourceKey(config)}`;
}

export function readSaved(config: GameConfig): SavedSession | null {
  const raw = readJson<SavedSession | null>(sessionKey(config), null);
  if (!raw || raw.version !== 1 || !raw.state || !raw.config) return null;
  // A save made under a different seed is a different game, however the key hashed.
  if (raw.config.seed !== undefined && typeof raw.config.seed !== "string") return null;
  return raw;
}

export function writeSaved(config: GameConfig, saved: SavedSession | null): void {
  if (saved === null) {
    removeKey(sessionKey(config));
    return;
  }
  writeJson(sessionKey(config), saved);
}

/** The save/load pair `createSession` takes, bound to one config. */
export function autosaveFor(config: GameConfig): {
  resume: SavedSession | null;
  save: (saved: SavedSession | null) => void;
} {
  return {
    resume: readSaved(config),
    save: (saved) => writeSaved(config, saved),
  };
}

/** Is there a game to resume for this exact configuration? */
export function hasSavedSession(config: GameConfig): boolean {
  return readSaved(config) !== null;
}

/** Every saved offline game on this device, newest first (the Home "Resume" affordance). */
export function listSavedSessions(): readonly { key: string; saved: SavedSession }[] {
  if (typeof window === "undefined") return [];
  const out: { key: string; saved: SavedSession }[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(SESSION_KEY_PREFIX)) continue;
      const saved = readJson<SavedSession | null>(key, null);
      if (saved && saved.version === 1) out.push({ key, saved });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.saved.savedAt - a.saved.savedAt);
}
