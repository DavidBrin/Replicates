/**
 * The map catalogue — hour-one stub (SPEC §4.14). S3 replaces this file with
 * the real slug list and per-slug dynamic imports.
 */
import type { MapFile } from "@/engine/types";

/** Every shipped slug, in picker order. */
export const MAP_SLUGS: readonly string[] = [];

/** Per-slug dynamic import. Rejects on an unknown slug. */
export async function loadMapFile(slug: string): Promise<MapFile> {
  throw new Error(`S3 pending: loadMapFile(${slug})`);
}
