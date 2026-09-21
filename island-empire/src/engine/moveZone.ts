/**
 * The move zone of SPEC §3.4 (Antiyoy `MoveZoneDetection.detectMoveZone`,
 * genealogy §2.6, over 4 neighbours): a breadth-first flood of budget
 * `RULES.moveBudget` through the unit's own empty tiles, whose frontier may
 * additionally reach one terminal tile — a capturable foreign tile the unit can
 * beat, an own grass field / grave to clear, an own chest to collect, or an
 * own unit to merge with.
 *
 * Own buildings (except mines and chests, see `blocksUnit`), water, forest,
 * mountain and foreign tiles are never flooded through.
 */
import { blocksUnit, inBounds, isFieldOrGrave, isOwnable, neighbourIndices, tileIndex } from "./grid";
import { canAttack, canMerge } from "./rules";
import { RULES, type GameStateCore, type RuntimeTile, type TileCoord } from "./types";

export interface MoveZone {
  /** Own empty tiles the unit may reposition to (stays ready). */
  reachable: TileCoord[];
  /** Foreign ownable tiles adjacent to the flood that the unit's level beats. */
  capturable: TileCoord[];
  /** Own grass fields / graves the unit may clear. */
  clearable: TileCoord[];
  /** Own units the unit may merge onto (level sum ≤ 4). */
  mergeable: TileCoord[];
  /** Own chest tiles the unit may step onto to collect (+10, stays ready). */
  collectable: TileCoord[];
}

const EMPTY: MoveZone = { reachable: [], capturable: [], clearable: [], mergeable: [], collectable: [] };

/**
 * Classified move zone for the unit at `from`. Empty when there is no unit,
 * the unit is not the active player's, or it has already acted this turn.
 */
export function computeMoveZone(state: GameStateCore, from: TileCoord): MoveZone {
  if (!inBounds(state.width, state.height, from.x, from.y)) return EMPTY;
  const start = tileIndex(state.width, from.x, from.y);
  const origin = state.tiles[start] as RuntimeTile;
  if (origin.unit === null || origin.owner === null) return EMPTY;
  if (origin.owner !== state.activePlayerIndex || !origin.unit.readyToMove) return EMPTY;
  const owner = origin.owner;
  const level = origin.unit.level;

  const zone: MoveZone = { reachable: [], capturable: [], clearable: [], mergeable: [], collectable: [] };
  const visited = new Set<number>([start]);
  // BFS in order of decreasing remaining budget, so the first visit of a tile is its best.
  const queue: Array<{ index: number; budget: number }> = [{ index: start, budget: RULES.moveBudget }];
  while (queue.length > 0) {
    const { index, budget } = queue.shift() as { index: number; budget: number };
    if (budget === 0) continue;
    for (const n of neighbourIndices(state.width, state.height, index)) {
      if (visited.has(n)) continue;
      visited.add(n);
      const t = state.tiles[n] as RuntimeTile;
      if (!isOwnable(t.terrain)) continue;
      const at = { x: t.x, y: t.y };
      if (t.owner !== owner) {
        if (canAttack(state, level, at)) zone.capturable.push(at);
        continue;
      }
      if (t.unit !== null) {
        if (canMerge(level, t.unit.level)) zone.mergeable.push(at);
        continue;
      }
      if (blocksUnit(t.building)) continue;
      if (t.building === "chest") {
        zone.collectable.push(at);
        continue;
      }
      if (isFieldOrGrave(t.terrain)) {
        zone.clearable.push(at);
        continue;
      }
      zone.reachable.push(at);
      queue.push({ index: n, budget: budget - 1 });
    }
  }
  return zone;
}

/** Every destination of the zone as a flat list (SPEC §4 `legalMoveZone`). */
export function legalMoveZone(state: GameStateCore, from: TileCoord): TileCoord[] {
  const z = computeMoveZone(state, from);
  return [...z.reachable, ...z.capturable, ...z.clearable, ...z.mergeable, ...z.collectable];
}
