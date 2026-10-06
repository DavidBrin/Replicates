import type { MapDef, MapFile } from "@/engine/types";

/**
 * Resolving a `mapSlug` to a loaded `MapDef` in the browser.
 *
 * POLL 3's snapshot carries `mapSlug` and nothing else of the board —
 * `GameState` holds no map, which is why `hashState` never covers the
 * geometry (§4.7) — so the online screen has to load the map itself before it
 * can fold anything.
 *
 * Both halves are S3's: `src/content/maps/index.ts`'s `loadMapFile` and
 * `@/engine/map`'s `loadMap`. They are reached through variable specifiers so
 * this module typechecks and bundles before that slice lands, and a missing
 * one surfaces as a readable status on the screen rather than a blank page.
 * Each becomes a plain static import the moment S3's barrels are there.
 */

const CATALOGUE_SPECIFIER = "@/content/maps";
const ENGINE_MAP_SPECIFIER = "@/engine/map";

const cache = new Map<string, Promise<MapDef>>();

export class MapUnavailableError extends Error {
  constructor(readonly slug: string, cause?: unknown) {
    super(`the map "${slug}" could not be loaded`);
    this.name = "MapUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** The loaded map for `slug`, memoised per tab. */
export function loadMapForSlug(slug: string): Promise<MapDef> {
  const existing = cache.get(slug);
  if (existing) return existing;

  const loading = (async () => {
    try {
      const catalogue = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ CATALOGUE_SPECIFIER
      )) as { loadMapFile(slug: string): Promise<MapFile> };
      const engineMap = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ ENGINE_MAP_SPECIFIER
      )) as { loadMap(file: MapFile): MapDef };
      return engineMap.loadMap(await catalogue.loadMapFile(slug));
    } catch (cause) {
      throw new MapUnavailableError(slug, cause);
    }
  })().catch((error: unknown) => {
    // A transient failure must not be cached forever: the next mount retries.
    cache.delete(slug);
    throw error;
  });

  cache.set(slug, loading);
  return loading;
}
