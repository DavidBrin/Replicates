import type { SavedSession } from "./session";
import type { MapSource } from "./sessionConfig";

/**
 * Autosave: one slot per map source in localStorage, resumed on reload
 * (SPEC §5). Guarded like the other localStorage adapters — private mode
 * or SSR simply means no resume.
 */

const PREFIX = "island-empire:session:v1:";

export function sourceKey(source: MapSource): string {
  switch (source.kind) {
    case "campaign":
      return `campaign:${source.levelId}`;
    case "custom":
      return `custom:${source.mapId}`;
    case "challenge":
      return `challenge:${source.weekKey}:${source.mapId}`;
    case "generated":
      return `generated:${source.seed}:${source.map.width}x${source.map.height}`;
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
