/** `LocalProgressPort` over `risk:progress:v1` (SPEC §4.16). */
import type { LocalProgress, LocalProgressPort, MapRecord } from "@/ports/localProgress";

import { newId, readJson, writeJson } from "./store";

export const PROGRESS_KEY = "risk:progress:v1";

function blank(): LocalProgress {
  return { maps: {}, deviceId: newId() };
}

function normalise(raw: Partial<LocalProgress> | null): LocalProgress {
  const maps: Record<string, MapRecord> = {};
  const source = raw && typeof raw.maps === "object" && raw.maps ? raw.maps : {};
  for (const [slug, record] of Object.entries(source)) {
    if (!record || typeof record !== "object") continue;
    maps[slug] = {
      played: Number(record.played) || 0,
      won: Number(record.won) || 0,
      lastSeats: Number(record.lastSeats) || 0,
    };
  }
  return { maps, deviceId: typeof raw?.deviceId === "string" && raw.deviceId ? raw.deviceId : newId() };
}

export function createProgressAdapter(): LocalProgressPort {
  return {
    read(): LocalProgress {
      const stored = readJson<Partial<LocalProgress> | null>(PROGRESS_KEY, null);
      if (!stored) {
        const fresh = blank();
        writeJson(PROGRESS_KEY, fresh);
        return fresh;
      }
      return normalise(stored);
    },
    recordResult(mapSlug: string, won: boolean): void {
      const current = this.read();
      const prior = current.maps[mapSlug] ?? { played: 0, won: 0, lastSeats: 0 };
      const next: LocalProgress = {
        ...current,
        maps: {
          ...current.maps,
          [mapSlug]: { played: prior.played + 1, won: prior.won + (won ? 1 : 0), lastSeats: prior.lastSeats },
        },
      };
      writeJson(PROGRESS_KEY, next);
    },
  };
}

/** An in-memory port for tests. */
export function createMemoryProgress(initial?: LocalProgress): LocalProgressPort {
  let value = initial ?? blank();
  return {
    read: () => value,
    recordResult(mapSlug, won) {
      const prior = value.maps[mapSlug] ?? { played: 0, won: 0, lastSeats: 0 };
      value = {
        ...value,
        maps: { ...value.maps, [mapSlug]: { ...prior, played: prior.played + 1, won: prior.won + (won ? 1 : 0) } },
      };
    },
  };
}
