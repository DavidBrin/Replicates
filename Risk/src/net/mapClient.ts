import { loadMapFile } from "@/content/maps";
import { loadMap } from "@/engine/map";
import type { MapDef } from "@/engine/types";

/**
 * Resolving a `mapSlug` to a loaded `MapDef` in the browser.
 *
 * POLL 3's snapshot carries `mapSlug` and nothing else of the board —
 * `GameState` holds no map, which is why `hashState` never covers the
 * geometry (§4.7) — so the online screen has to load the map itself before it
 * can fold anything.
 *
 * Both halves are S3's: `src/content/maps/index.ts`'s `loadMapFile`, which is
 * a per-slug **dynamic** import so no board's geometry lands in the shared
 * bundle (D40, F6), and `@/engine/map`'s `loadMap`, which unions the sea
 * links in (F45). The result is memoised per tab, because the map is
 * immutable and a 42-territory `MapDef` is not free to rebuild.
 */

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
      return loadMap(await loadMapFile(slug));
    } catch (cause) {
      // An unknown slug, or a map the validator refuses: either way the
      // screen says so rather than rendering an empty board.
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
