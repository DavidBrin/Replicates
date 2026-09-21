import type { SavedSession } from "./session";
import type { SessionConfig } from "./sessionConfig";

/**
 * Autosave: one slot per map source in localStorage, resumed on reload
 * (SPEC §5). Guarded like the other localStorage adapters — private mode
 * or SSR simply means no resume.
 */

const PREFIX = "island-empire:session:v1:";

/** FNV-1a over a string — small, stable, good enough to tell two configs apart. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * The autosave slot for a session. It is keyed by everything that shapes the
 * initial `GameState` — the map, the difficulty and every seat's kind — so
 * the same level on another difficulty, or a regenerated map with a different
 * biome or seat setup, never resumes an incompatible save.
 */
export function sourceKey(config: SessionConfig): string {
  const { source } = config;
  const seats = fnv(JSON.stringify(config.seats.map((s) => [s.index, s.kind, s.aiDifficulty])));
  switch (source.kind) {
    case "campaign":
      return `campaign:${source.levelId}:${config.difficulty}:${seats}`;
    case "custom":
      return `custom:${source.mapId}:${config.difficulty}:${seats}`;
    case "challenge":
      return `challenge:${source.weekKey}:${source.mapId}:${config.difficulty}:${seats}`;
    case "generated":
      return `generated:${source.seed}:${fnv(JSON.stringify(source.map))}:${config.difficulty}:${seats}`;
  }
}

export function loadSaved(key: string): SavedSession | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed?.state?.tiles) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSaved(key: string, saved: SavedSession | null): void {
  try {
    if (saved) window.localStorage.setItem(PREFIX + key, JSON.stringify(saved));
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable — the session still plays, it just will not resume */
  }
}
