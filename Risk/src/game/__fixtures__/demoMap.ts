/**
 * A generated grid board, so S4 can develop and smoke-test the renderer and
 * the HUD against something that reads like a real map before S3 ships one.
 *
 * Chunky rectangles on a 1600×900 viewBox, grouped into vertical regions,
 * four-connected plus one long sea link per region pair. Deterministic from
 * `(cols, rows)` alone — no RNG, no geometry library.
 */
import type { MapFile } from "@/engine/types";

const NAMES = [
  "Ashford", "Barrow", "Calder", "Dunmere", "Elmcross", "Fenwick", "Garrow", "Holt",
  "Ironvale", "Jarsk", "Kestrel", "Lowmoor", "Marrow", "Northgate", "Orley", "Pellon",
  "Quarry", "Ridgeway", "Sablefen", "Thornwick", "Upwood", "Varden", "Westmere", "Yarrow",
];

const REGION_NAMES = [
  "Northmarch", "Midlands", "Southreach", "Farshore", "Eastholm", "Westmarch",
  "Highreach", "Lowshore", "Stormfell", "Sunvale", "Coldwater",
];
const REGION_COLOURS = ["#36B0EA", "#DA3A4F", "#5FBF2A", "#9B4AE8", "#E08A24", "#F0C33A"];

export interface DemoMapOptions {
  readonly slug?: string;
  readonly name?: string;
  readonly cols?: number;
  readonly rows?: number;
}

/** Build a `MapFile` of `cols × rows` territories in `cols` vertical regions. */
export function buildDemoMap(options: DemoMapOptions = {}): MapFile {
  const cols = options.cols ?? 4;
  const rows = options.rows ?? 3;
  const W = 1600;
  const H = 900;
  const padX = 80;
  const padY = 70;
  const gap = 18;
  const cellW = (W - padX * 2 - gap * (cols - 1)) / cols;
  const cellH = (H - padY * 2 - gap * (rows - 1)) / rows;

  // Ids carry the column index, not the region name, so a board wider than
  // the name list still has unique slugs.
  const id = (c: number, r: number) => `t${c}-${r + 1}`;
  const regionId = (c: number) => `region-${c}`;

  const territories: MapFile["territories"][number][] = [];
  let n = 0;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const x = padX + c * (cellW + gap);
      const y = padY + r * (cellH + gap);
      // A five-vertex chunky polygon: a rectangle with one angled corner, so
      // the silhouette is not a perfect grid and the relief filter has work.
      const nick = 18 + ((c + r) % 3) * 10;
      const d = [
        `M ${x.toFixed(1)} ${(y + nick).toFixed(1)}`,
        `L ${(x + nick).toFixed(1)} ${y.toFixed(1)}`,
        `L ${(x + cellW).toFixed(1)} ${y.toFixed(1)}`,
        `L ${(x + cellW).toFixed(1)} ${(y + cellH - nick).toFixed(1)}`,
        `L ${(x + cellW - nick).toFixed(1)} ${(y + cellH).toFixed(1)}`,
        `L ${x.toFixed(1)} ${(y + cellH).toFixed(1)}`,
        "Z",
      ].join(" ");
      const adjacent: string[] = [];
      if (r > 0) adjacent.push(id(c, r - 1));
      if (r < rows - 1) adjacent.push(id(c, r + 1));
      if (c > 0) adjacent.push(id(c - 1, r));
      if (c < cols - 1) adjacent.push(id(c + 1, r));
      territories.push({
        id: id(c, r),
        name: NAMES[n % NAMES.length] as string,
        continent: regionId(c),
        suit: (["infantry", "cavalry", "artillery"] as const)[n % 3] as "infantry",
        adjacent,
        d,
        tokenX: Math.round(x + cellW / 2),
        tokenY: Math.round(y + cellH / 2 - 10),
        labelX: Math.round(x + cellW / 2),
        labelY: Math.round(y + cellH / 2 + 16),
      });
      n += 1;
    }
  }

  const continents: MapFile["continents"] = Array.from({ length: cols }, (_, c) => ({
    id: regionId(c),
    name: REGION_NAMES[c % REGION_NAMES.length] as string,
    bonus: 2 + (c % 3),
    color: REGION_COLOURS[c % REGION_COLOURS.length] as string,
    territories: Array.from({ length: rows }, (_, r) => id(c, r)),
  }));

  // One long route per region boundary: top of a column to the bottom of the
  // next but one, so the dashed routes actually cross open water.
  const seaLinks: { from: string; to: string }[] = [];
  for (let c = 0; c + 2 < cols; c += 1) {
    seaLinks.push({ from: id(c, 0), to: id(c + 2, rows - 1) });
  }
  if (cols >= 2) seaLinks.push({ from: id(0, rows - 1), to: id(cols - 1, 0) });

  return {
    slug: options.slug ?? "demo-grid",
    name: options.name ?? "Demo Grid",
    tagline: "A generated board for development",
    viewBox: `0 0 ${W} ${H}`,
    continents,
    territories,
    seaLinks,
    modifierSlots: { blizzards: 2, portals: 3, capitals: 6 },
  };
}

export const DEMO_MAP_FILE: MapFile = buildDemoMap();
