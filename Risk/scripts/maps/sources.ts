/**
 * The geodata sources, and the projection that flattens them (D37 Tier 3, D40).
 *
 * Three files, all permissive, all staying in `research/map-data/` and in this
 * pipeline — **none of them ever reaches the client bundle** (D40). What ships
 * is the simplified per-territory JSON this pipeline emits.
 *
 * | file | licence | used for |
 * |---|---|---|
 * | `topojson-atlas/world-atlas-countries-110m.json` | ISC (data: Natural Earth, PD) | every country-level board |
 * | `topojson-atlas/us-atlas-states-10m.json` | ISC (data: US Census, PD) | `usa-states` |
 * | `naturalearth/ne_50m_admin_1_states_provinces.geojson` | public domain | Australia's states |
 *
 * The world atlas carries only `properties.name`, so continent and ISO codes
 * are joined on from `naturalearth/ne_110m_admin_0_countries.geojson` — the same
 * Natural Earth release the atlas was built from, which makes the join exact for
 * 176 of 177 names (`Macedonia` is the one rename, aliased below).
 *
 * Nothing here is Hasbro- or SMG-derived, and the Wikimedia "Risk board" SVG
 * family is deliberately absent: its CC BY-SA tag cannot license board art the
 * uploader never held rights to (D38).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  geoAlbers, geoAlbersUsa, geoAzimuthalEqualArea, geoConicConformal, geoEqualEarth, geoMercator,
  type GeoProjection,
} from "d3-geo";
import { feature } from "topojson-client";

/** The repository root for `Risk/`. `fileURLToPath`, because the checkout path contains a space. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "research", "map-data");

/* ------------------------------------------------------------------ features -- */

export type LonLat = readonly [number, number];
export type LonLatRing = readonly LonLat[];

export interface SourceFeature {
  /** The display name, as the source spells it. */
  readonly name: string;
  /** Continent, from Natural Earth's own `CONTINENT`, or `""` where unjoined. */
  readonly continent: string;
  /** Natural Earth's `SUBREGION`, the most useful grouping hint the data carries. */
  readonly subregion: string;
  readonly iso: string;
  /** Outer rings in lon/lat. Holes are dropped: a territory is land, not a donut. */
  readonly rings: readonly LonLatRing[];
  /** Unsigned planar extent in square degrees — a size ranking, not a real area. */
  readonly extent: number;
}

interface RawGeometry {
  readonly type: string;
  readonly coordinates: unknown;
}

function ringsOf(geometry: RawGeometry | null | undefined): LonLatRing[] {
  if (geometry === null || geometry === undefined) return [];
  const out: LonLatRing[] = [];
  const take = (polygon: unknown): void => {
    // A GeoJSON Polygon is [outer, ...holes]; only the outer ring is land.
    const outer = Array.isArray(polygon) ? polygon[0] : undefined;
    if (!Array.isArray(outer)) return;
    const ring = outer
      .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number")
      .map((p) => [p[0], p[1]] as LonLat);
    if (ring.length >= 4) out.push(ring);
  };
  if (geometry.type === "Polygon") take(geometry.coordinates);
  else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    for (const polygon of geometry.coordinates) take(polygon);
  }
  return out;
}

/** Shoelace over every ring, in degrees². Only ever compared, never reported. */
export function extentOf(rings: readonly LonLatRing[]): number {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j] as LonLat;
      const b = ring[i] as LonLat;
      sum += a[0] * b[1] - b[0] * a[1];
    }
    total += Math.abs(sum) / 2;
  }
  return total;
}

function read(relative: string): unknown {
  return JSON.parse(readFileSync(join(DATA, relative), "utf8")) as unknown;
}

interface PlainFeature {
  readonly properties: Record<string, string | undefined>;
  readonly geometry: RawGeometry;
}

/** One TopoJSON object, decoded to GeoJSON features. `@types/topojson-client` wants its own
 *  `Topology` shape, which neither atlas declares, so the hand-off goes through `unknown`. */
function topoFeatures(relative: string, object: string): PlainFeature[] {
  const topology = read(relative) as Parameters<typeof feature>[0];
  const objects = (topology as unknown as { objects: Record<string, Parameters<typeof feature>[1]> }).objects;
  const target = objects[object];
  if (target === undefined) throw new Error(`${relative} has no object "${object}"`);
  return (feature(topology, target) as unknown as { features: PlainFeature[] }).features;
}

/* ------------------------------------------------------------------ world countries -- */

/** Natural Earth renamed this between the atlas build and the 110m release used for the join. */
const NAME_ALIASES: Record<string, string> = { Macedonia: "North Macedonia" };

let worldCache: SourceFeature[] | null = null;

/**
 * The 177 world countries, with Natural Earth's `CONTINENT` / `SUBREGION` /
 * `ISO_A3` joined on by name.
 */
export function worldCountries(): SourceFeature[] {
  if (worldCache !== null) return worldCache;
  const features = topoFeatures("topojson-atlas/world-atlas-countries-110m.json", "countries");
  const admin0 = read("naturalearth/ne_110m_admin_0_countries.geojson") as {
    features: { properties: Record<string, string> }[];
  };
  const byName = new Map(admin0.features.map((f) => [f.properties.NAME ?? "", f.properties]));

  worldCache = features.map((f) => {
    const name = f.properties.name ?? "";
    const props = byName.get(NAME_ALIASES[name] ?? name) ?? {};
    const rings = ringsOf(f.geometry);
    return {
      name,
      continent: props.CONTINENT ?? "",
      subregion: props.SUBREGION ?? "",
      iso: props.ISO_A3 ?? "",
      rings,
      extent: extentOf(rings),
    };
  });
  return worldCache;
}

/* ------------------------------------------------------------------ us states -- */

let usCache: SourceFeature[] | null = null;

/** The 50 states plus DC. The island territories carry no land border and are dropped. */
export function usStates(): SourceFeature[] {
  if (usCache !== null) return usCache;
  const skip = new Set(["American Samoa", "Guam", "Commonwealth of the Northern Mariana Islands",
    "Puerto Rico", "United States Virgin Islands"]);
  usCache = topoFeatures("topojson-atlas/us-atlas-states-10m.json", "states")
    .filter((f) => !skip.has(f.properties.name ?? ""))
    .map((f) => {
      const rings = ringsOf(f.geometry);
      return {
        name: f.properties.name ?? "",
        continent: "North America",
        subregion: "Northern America",
        iso: "USA",
        rings,
        extent: extentOf(rings),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return usCache;
}

/* ------------------------------------------------------------------ admin-1 -- */

let admin1Cache: Map<string, SourceFeature[]> | null = null;

/**
 * Natural Earth's admin-1 units for one country. The 50m release covers nine
 * countries only (AU, BR, CA, CN, ID, IN, RU, US, ZA); everything else in this
 * pipeline is split geometrically instead.
 */
export function admin1(country: string): SourceFeature[] {
  if (admin1Cache === null) {
    const data = read("naturalearth/ne_50m_admin_1_states_provinces.geojson") as {
      features: { properties: Record<string, string>; geometry: RawGeometry }[];
    };
    admin1Cache = new Map();
    for (const f of data.features) {
      const admin = f.properties.admin ?? "";
      const rings = ringsOf(f.geometry);
      const list = admin1Cache.get(admin) ?? [];
      list.push({
        name: f.properties.name ?? "",
        continent: "",
        subregion: admin,
        iso: f.properties.iso_3166_2 ?? "",
        rings,
        extent: extentOf(rings),
      });
      admin1Cache.set(admin, list);
    }
  }
  return [...(admin1Cache.get(country) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ projection -- */

export type ProjectionKind =
  | "equalEarth" | "mercator" | "conicConformal" | "albers" | "albersUsa" | "azimuthal";

export type Projector = (point: LonLat) => readonly [number, number] | null;

const PROJECTIONS: Record<ProjectionKind, () => GeoProjection> = {
  equalEarth: geoEqualEarth,
  mercator: geoMercator,
  conicConformal: geoConicConformal,
  albers: geoAlbers,
  // `geoAlbersUsa` insets Alaska and Hawaii, which is exactly what a US board
  // wants; it is a composite projection and so carries no `rotate`.
  albersUsa: geoAlbersUsa as unknown as () => GeoProjection,
  azimuthal: geoAzimuthalEqualArea,
};

/**
 * A projection fitted so the selected features exactly fill the frame, minus
 * `margin` (the §8 coastal halo bleeds ~20–40 px, so the land must not touch
 * the edge).
 *
 * Equal-area for world and regional boards: a Mercator board makes Greenland a
 * continent, which reads as a bug rather than a projection.
 *
 * **The fit is computed here rather than by `projection.fitExtent`.** d3's fit
 * measures a GeoJSON object with its spherical path machinery, which assumes
 * closed rings in a particular winding order and treats a reversed ring as a
 * hole covering the sphere — so after a lon/lat window clip it sized Europe at
 * 16% of the frame and silently emitted a board of empty polygons. Measuring the
 * projected points directly cannot misread the input that way: scale and
 * translate compose as `screen = translate + scale * unit`, so one pass at unit
 * scale gives everything needed.
 */
export function fitProjection(
  kind: ProjectionKind,
  features: readonly SourceFeature[],
  width: number,
  height: number,
  margin: number,
  rotate?: readonly [number, number] | readonly [number, number, number],
): Projector {
  const projection = (PROJECTIONS[kind] ?? geoEqualEarth)();
  if (rotate !== undefined && projection.rotate !== undefined) {
    projection.rotate([rotate[0], rotate[1], rotate[2] ?? 0]);
  }
  projection.scale(1).translate([0, 0]);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;
  for (const f of features) {
    for (const ring of f.rings) {
      for (const point of ring) {
        const out = projection([point[0], point[1]]);
        if (out === null || !Number.isFinite(out[0]) || !Number.isFinite(out[1])) continue;
        seen++;
        minX = Math.min(minX, out[0]);
        minY = Math.min(minY, out[1]);
        maxX = Math.max(maxX, out[0]);
        maxY = Math.max(maxY, out[1]);
      }
    }
  }
  if (seen === 0 || !(maxX > minX) || !(maxY > minY)) {
    throw new Error(`${kind} projected none of the ${features.length} selected features`);
  }

  const frameWidth = width - 2 * margin;
  const frameHeight = height - 2 * margin;
  const scale = Math.min(frameWidth / (maxX - minX), frameHeight / (maxY - minY));
  // Centre whatever the aspect ratio did not consume.
  const translate: [number, number] = [
    margin + (frameWidth - scale * (maxX - minX)) / 2 - scale * minX,
    margin + (frameHeight - scale * (maxY - minY)) / 2 - scale * minY,
  ];
  projection.scale(scale).translate(translate);

  return (point) => {
    const out = projection([point[0], point[1]]);
    return out === null || !Number.isFinite(out[0]) || !Number.isFinite(out[1]) ? null : [out[0], out[1]];
  };
}

/**
 * The quantisation grid, in `viewBox` units.
 *
 * Adjacency is derived by looking for **shared vertices**, which only works if
 * two neighbours name a shared border point with the same number — so every
 * projected coordinate is snapped here, once, before anything reads it. 1/64 of
 * a unit is ~390 m at world scale: far below a 1 px stroke, far above the
 * last-bit disagreement that would break the match. Verified against
 * `topojson.neighbors` over all 177 world countries: 313 of 314 edges derived,
 * zero false positives (the miss is a self-pair in the source).
 */
export const QUANTUM = 64;

export function quantise(n: number): number {
  const v = Math.round(n * QUANTUM) / QUANTUM;
  return Object.is(v, -0) ? 0 : v;
}

/** Project and quantise one feature's rings, dropping anything that collapses. */
export function projectRings(rings: readonly LonLatRing[], project: Projector): [number, number][][] {
  const out: [number, number][][] = [];
  for (const ring of rings) {
    const projected: [number, number][] = [];
    for (const point of ring) {
      const p = project(point);
      if (p === null) continue;
      const q: [number, number] = [quantise(p[0]), quantise(p[1])];
      const last = projected[projected.length - 1];
      if (last === undefined || last[0] !== q[0] || last[1] !== q[1]) projected.push(q);
    }
    // A GeoJSON ring repeats its first point last; drop it so a ring is a
    // vertex list rather than a closed polyline.
    const first = projected[0];
    const end = projected[projected.length - 1];
    if (projected.length > 1 && first !== undefined && end !== undefined && first[0] === end[0] && first[1] === end[1]) {
      projected.pop();
    }
    if (projected.length >= 3) out.push(projected);
  }
  return out;
}
