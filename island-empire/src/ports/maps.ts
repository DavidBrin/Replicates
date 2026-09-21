import type { MapDefinition, MapSummary } from "@/engine/types";

/** Server-side custom-map repository (SPEC §6). Implemented over Postgres by S4. */
export interface MapsRepository {
  create(map: Omit<MapDefinition, "id">): Promise<{ id: string }>;
  get(id: string): Promise<MapDefinition | null>;
  list(opts: { cursor?: string; limit: number }): Promise<{ maps: MapSummary[]; nextCursor: string | null }>;
  /**
   * Every community map, oldest first — the weekly-challenge pool (D38).
   * Summaries only; a definition is fetched by `get` when a pick is played.
   */
  listAll(): Promise<MapSummary[]>;
}
