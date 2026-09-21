import type { MapDefinition } from "@/engine/types";

import { DEMO_MAP } from "./demoMap";
import type { MapSource } from "./sessionConfig";

/**
 * Resolves a `MapSource` to a `MapDefinition` (SPEC §5).
 *
 * Campaign levels come from S3's loader through a per-id dynamic import so
 * one level's tiles never ship with another's page; while that module is
 * absent in development the built-in demo map stands in. Custom and
 * challenge maps come from S4's `GET /api/maps/[id]`.
 */

interface LevelsModule {
  loadLevel?: (id: string) => Promise<MapDefinition>;
  LEVEL_IDS?: readonly string[];
}

export async function loadCampaignLevel(levelId: string): Promise<{ map: MapDefinition; demo: boolean }> {
  try {
    const mod = (await import("@/content/levels")) as LevelsModule;
    if (mod.loadLevel) return { map: await mod.loadLevel(levelId), demo: false };
  } catch {
    /* content loader not present yet — fall through */
  }
  return { map: DEMO_MAP, demo: true };
}

export async function loadCustomMap(mapId: string): Promise<MapDefinition> {
  const res = await fetch(`/api/maps/${encodeURIComponent(mapId)}`);
  if (!res.ok) throw new Error(res.status === 404 ? "Map not found" : `Could not load map (${res.status})`);
  return (await res.json()) as MapDefinition;
}

export async function loadMapForSource(source: MapSource): Promise<{ map: MapDefinition; demo: boolean }> {
  switch (source.kind) {
    case "campaign":
      return loadCampaignLevel(source.levelId);
    case "custom":
    case "challenge":
      return { map: await loadCustomMap(source.mapId), demo: false };
    case "generated":
      return { map: source.map, demo: false };
  }
}
