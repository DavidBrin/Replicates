import type { MapDefinition, MapSummary } from "@/engine/types";

/**
 * The seeded campaign levels as challenge-pool entries (D38).
 *
 * The levels are TypeScript literals owned by the content slice
 * (`src/content/levels/index.ts`: `LEVEL_IDS`, `loadLevel(id)`). This module
 * is the only place outside that slice that reads them, and it reads them
 * lazily so a page that never needs a level never bundles one.
 *
 * Ids are prefixed `seed:` so `/api/maps/[id]` can tell a seeded pick from a
 * community row, and so the two id spaces can never collide.
 *
 * The content module is loaded through `import()` inside a try/catch: while
 * the content slice has not landed, the pool is simply the community maps.
 */

export const SEED_PREFIX = "seed:";
export const SEED_AUTHOR = "Island Empire";

interface LevelsModule {
  LEVEL_IDS: readonly string[];
  loadLevel: (id: string) => Promise<MapDefinition> | MapDefinition;
}

const REGISTRY = Symbol.for("island-empire.seededLevels");

interface Registry {
  [REGISTRY]?: Promise<Map<string, MapDefinition>>;
}

async function levelsModule(): Promise<LevelsModule | null> {
  try {
    const mod = (await import("@/content/levels")) as Partial<LevelsModule>;
    if (!Array.isArray(mod.LEVEL_IDS) || typeof mod.loadLevel !== "function") return null;
    return mod as LevelsModule;
  } catch {
    return null;
  }
}

async function loadAll(): Promise<Map<string, MapDefinition>> {
  const levels = new Map<string, MapDefinition>();
  const mod = await levelsModule();
  if (!mod) return levels;
  for (const levelId of mod.LEVEL_IDS) {
    try {
      const map = await mod.loadLevel(levelId);
      levels.set(levelId, { ...map, id: `${SEED_PREFIX}${levelId}` });
    } catch {
      // A level that fails to load is left out of the pool rather than
      // taking the challenges page down with it.
    }
  }
  return levels;
}

/**
 * Every seeded level, keyed by level id, loaded once per process. Failures
 * are not cached so a transient one is retried on the next call.
 */
function allLevels(): Promise<Map<string, MapDefinition>> {
  const registry = globalThis as unknown as Registry;
  const existing = registry[REGISTRY];
  if (existing) return existing;
  const promise = loadAll().catch((error: unknown) => {
    delete registry[REGISTRY];
    throw error;
  });
  registry[REGISTRY] = promise;
  return promise;
}

/** Forget the loaded levels. Tests only. */
export function resetSeededLevelsForTests(): void {
  delete (globalThis as unknown as Registry)[REGISTRY];
}

export function isSeedId(id: string): boolean {
  return id.startsWith(SEED_PREFIX);
}

export function summaryOf(map: MapDefinition, id: string): MapSummary {
  return {
    id,
    name: map.name,
    author: map.author || SEED_AUTHOR,
    width: map.width,
    height: map.height,
    biome: map.biome,
    players: map.players.length,
    // Seeded levels have no row; the epoch keeps them "older than" any save.
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

/** A seeded level by its `seed:<levelId>` id, or `null`. */
export async function getSeededMap(id: string): Promise<MapDefinition | null> {
  if (!isSeedId(id)) return null;
  const levels = await allLevels();
  return levels.get(id.slice(SEED_PREFIX.length)) ?? null;
}

/** The non-tutorial seeded levels — the fixed half of the challenge pool. */
export async function seededChallengePool(): Promise<MapSummary[]> {
  const levels = await allLevels();
  const pool: MapSummary[] = [];
  for (const map of levels.values()) {
    if (map.tutorial.length > 0) continue;
    pool.push(summaryOf(map, map.id!));
  }
  return pool;
}
