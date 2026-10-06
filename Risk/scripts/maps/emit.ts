/**
 * Writing a `MapFile` to `src/content/maps/<slug>.json`, and reporting what it
 * cost.
 *
 * The files are **committed**, not generated at install time: `build:maps` is
 * the regeneration step, and a reviewer should be able to see a board's graph
 * change in a diff (D36). So the JSON is written pretty-printed with sorted-ish
 * key order, while the **size reported** is the minified length — the number
 * §10's 100 KB ceiling and T7's gate are about (F53).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { MapFile } from "../../src/engine/types";

const ENGINE_MODULE = "./engine.ts";
const engine = (await import(ENGINE_MODULE)) as typeof import("./engine");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const OUT_DIR = join(ROOT, "src", "content", "maps");

/** §10's ceiling, on the minified JSON (F53). */
export const SIZE_LIMIT = 100 * 1024;

export interface MapReport {
  readonly slug: string;
  readonly name: string;
  readonly territories: number;
  readonly continents: number;
  readonly landEdges: number;
  readonly seaLinks: number;
  /** Land ∪ sea — the number T7 counts after `loadMap`'s union (F45). */
  readonly edges: number;
  readonly minVertices: number;
  readonly maxVertices: number;
  readonly bytes: number;
  readonly suits: Readonly<Record<string, number>>;
  readonly bonuses: readonly number[];
  readonly changed: boolean;
}

export function measure(file: MapFile, changed: boolean): MapReport {
  const land = new Set<string>();
  for (const t of file.territories) {
    for (const other of t.adjacent) land.add([t.id, other].sort().join("|"));
  }
  const vertices = file.territories.map((t) => engine.countVertices(t.d));
  const suits: Record<string, number> = { infantry: 0, cavalry: 0, artillery: 0 };
  for (const t of file.territories) suits[t.suit] = (suits[t.suit] ?? 0) + 1;
  return {
    slug: file.slug,
    name: file.name,
    territories: file.territories.length,
    continents: file.continents.length,
    landEdges: land.size,
    seaLinks: file.seaLinks.length,
    edges: land.size + file.seaLinks.length,
    minVertices: vertices.length === 0 ? 0 : Math.min(...vertices),
    maxVertices: vertices.length === 0 ? 0 : Math.max(...vertices),
    bytes: JSON.stringify(file).length,
    suits,
    bonuses: file.continents.map((c) => c.bonus),
    changed,
  };
}

/**
 * Write one map, and report it.
 *
 * Throws on the two faults this side of the fence can see: the 100 KB ceiling
 * and the §8 vertex budget. Everything else — symmetry, dangling references,
 * continent membership, anchors inside their polygons, connectivity, suit
 * balance — is `validateMap`'s job, and `build-maps.ts` runs it by shelling out
 * to the T7 suite once every file is on disk, so there is exactly one validator.
 */
export function writeMap(file: MapFile): MapReport {
  mkdirSync(OUT_DIR, { recursive: true });
  const body = `${JSON.stringify(file, null, 1)}\n`;
  const path = join(OUT_DIR, `${file.slug}.json`);

  let previous: string | null = null;
  try {
    previous = readFileSync(path, "utf8");
  } catch {
    previous = null;
  }
  if (previous !== body) writeFileSync(path, body, "utf8");

  const report = measure(file, previous !== body);
  if (report.bytes > SIZE_LIMIT) {
    throw new Error(`${file.slug}: ${report.bytes} bytes minified exceeds the ${SIZE_LIMIT} byte ceiling (§10 F53)`);
  }
  if (report.maxVertices > 30 || report.minVertices < 3) {
    throw new Error(`${file.slug}: vertices per territory ${report.minVertices}..${report.maxVertices} is outside 3..30 (§8)`);
  }
  return report;
}

/** One aligned line per map. */
export function formatReport(report: MapReport): string {
  const suits = `${report.suits.infantry ?? 0}/${report.suits.cavalry ?? 0}/${report.suits.artillery ?? 0}`;
  return [
    report.slug.padEnd(24),
    `${String(report.territories).padStart(3)}T`,
    `${String(report.continents).padStart(2)}C`,
    `${String(report.edges).padStart(3)}e`,
    `(${String(report.landEdges).padStart(3)} land + ${String(report.seaLinks).padStart(2)} sea)`,
    `v${String(report.minVertices).padStart(2)}-${String(report.maxVertices).padStart(2)}`,
    `suits ${suits.padEnd(9)}`,
    `${(report.bytes / 1024).toFixed(1).padStart(5)} KB`,
    report.changed ? "written" : "unchanged",
  ].join("  ");
}
