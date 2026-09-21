import type { MapDefinition } from "@/engine/types";

import { LEVEL_IDS, type LevelId } from "./index";
import level01 from "./level01";
import level02 from "./level02";
import level03 from "./level03";
import level04 from "./level04";
import level05 from "./level05";
import level06 from "./level06";
import level07 from "./level07";
import level08 from "./level08";
import level09 from "./level09";
import level10 from "./level10";
import level11 from "./level11";
import level12 from "./level12";

/**
 * Every level, statically imported — for tests, scripts and server-side
 * tooling only. Pages must go through `loadLevel()` in `./index.ts`, which
 * keeps each level in its own chunk; importing this module from a page
 * would pull all twelve into that page's bundle.
 */
const ALL: Record<LevelId, MapDefinition> = {
  "01": level01,
  "02": level02,
  "03": level03,
  "04": level04,
  "05": level05,
  "06": level06,
  "07": level07,
  "08": level08,
  "09": level09,
  "10": level10,
  "11": level11,
  "12": level12,
};

export function getLevelSync(id: LevelId): MapDefinition {
  return ALL[id];
}

export function allLevelsSync(): Array<{ id: LevelId; map: MapDefinition }> {
  return LEVEL_IDS.map((id) => ({ id, map: ALL[id] }));
}
