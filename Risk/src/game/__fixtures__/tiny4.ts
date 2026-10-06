/**
 * S4's own development fixture (SPEC §12, F25): a four-territory, one-region
 * `MapFile` with all six edges, so the HUD, the renderer and the session
 * runner can be built and tested before S3 ships a single board.
 *
 * S3 independently ships `src/content/maps/tiny4.json`. The two are allowed
 * to differ; neither is derived from the other.
 */
import type { MapDef, MapFile } from "@/engine/types";

import { toMapDef } from "../mapLoader";

/**
 * Four quadrants of a 400×300 board, each a chunky 5-vertex polygon, every
 * pair sharing a border — K4, six undirected edges.
 */
export const TINY4_FILE: MapFile = {
  slug: "tiny4",
  name: "Tiny Four",
  tagline: "Four shores, one sea",
  viewBox: "0 0 400 300",
  continents: [
    {
      id: "atoll",
      name: "Atoll",
      bonus: 2,
      color: "#36B0EA",
      territories: ["alpha", "bravo", "charlie", "delta"],
    },
  ],
  territories: [
    {
      id: "alpha",
      name: "Alpha",
      continent: "atoll",
      suit: "infantry",
      adjacent: ["bravo", "charlie", "delta"],
      d: "M 20 20 L 190 20 L 200 90 L 190 140 L 30 130 Z",
      tokenX: 105,
      tokenY: 76,
      labelX: 105,
      labelY: 102,
    },
    {
      id: "bravo",
      name: "Bravo",
      continent: "atoll",
      suit: "cavalry",
      adjacent: ["alpha", "charlie", "delta"],
      d: "M 210 20 L 380 20 L 376 132 L 210 140 L 202 86 Z",
      tokenX: 292,
      tokenY: 78,
      labelX: 292,
      labelY: 104,
    },
    {
      id: "charlie",
      name: "Charlie",
      continent: "atoll",
      suit: "artillery",
      adjacent: ["alpha", "bravo", "delta"],
      d: "M 26 152 L 194 150 L 200 220 L 188 282 L 30 278 Z",
      tokenX: 108,
      tokenY: 212,
      labelX: 108,
      labelY: 238,
    },
    {
      id: "delta",
      name: "Delta",
      continent: "atoll",
      suit: "infantry",
      adjacent: ["alpha", "bravo", "charlie"],
      d: "M 212 150 L 374 148 L 378 280 L 206 282 L 202 216 Z",
      tokenX: 292,
      tokenY: 214,
      labelX: 292,
      labelY: 240,
    },
  ],
  // The one long edge drawn as a dashed route rather than a shared border.
  // It is already a land border too, so the union is idempotent (F45).
  seaLinks: [{ from: "alpha", to: "delta" }],
  modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
};

/** The loaded fixture, built once. */
export const TINY4: MapDef = toMapDef(TINY4_FILE);

/** Territory indices by name, so a test never hard-codes a magic number. */
export const T4 = { alpha: 0, bravo: 1, charlie: 2, delta: 3 } as const;
