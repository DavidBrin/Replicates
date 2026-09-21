import "server-only";

import type { MapDefinition } from "@/engine/types";
import { mapsRepository } from "@/adapters/db/mapsRepository";

import { ensureReady } from "./boot";
import { getSeededMap, isSeedId } from "./seededLevels";

/**
 * A map by id, wherever it lives: `seed:<levelId>` is a bundled campaign
 * level, anything else is a `maps` row. Used by `GET /api/maps/[id]` and the
 * `/maps/[id]` share page, so the two agree on what an id means.
 */
export async function resolveMap(id: string): Promise<MapDefinition | null> {
  if (isSeedId(id)) return getSeededMap(id);
  await ensureReady();
  return mapsRepository().get(id);
}
