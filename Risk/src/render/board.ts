/**
 * The map, as imperative DOM (SPEC §8's eight-step recipe, §10's render loop).
 *
 * *One `<path>` per territory, one CSS variable per owner. That is the whole
 * architecture.* The board is built **once per map** and then painted by diff:
 * a capture is a `data-owner` attribute write and a 240 ms `fill` transition,
 * never a rebuild and never a React render — `GameState` must not go through
 * React's render cycle or a tap visibly lags behind the re-render (§10).
 *
 * No React import, no hex literal: every colour resolves a token from
 * `globals.css`. The two exceptions are `#fff`/`#000` (not colours, light and
 * shade) and the filter `flood-color` presentation attributes, where `var()`
 * is not valid — those carry the token as a `style` fallback alongside.
 */
import type { MapDef } from "@/engine/types";

import { PLAYER_COLOURS } from "./palette";

const SVG_NS = "http://www.w3.org/2000/svg";

/** §8 step 4: the fake slab is the land union pushed down this many map units. */
const WALL_OFFSET = 7;
/** §8 step 2: the line-net tile. 600 px gives ~32 segments on a 1600×900 frame. */
const NET_TILE = 600;
/** Sea routes bow this fraction of the chord, so a long link is not a bare ruler line. */
const ROUTE_BOW = 0.12;

export interface BoardPaint {
  /** `data-owner` value per territory index: a PlayerColour name, or "none" | "neutral" | "unknown". */
  readonly owners: readonly string[];
  /** `data-state` per territory: "idle" | "selected" | "target" | "dimmed". */
  readonly states: readonly string[];
  /** Continents to ring with the perimeter glow, and the accent to use. */
  readonly rings: readonly { readonly continent: number; readonly colour: string }[];
  /** Territories frozen by a blizzard — hatched and never interactive. */
  readonly blizzards: readonly number[];
  /** Colour-vision pattern id per territory, or null (see palette.patternFor). */
  readonly patterns?: readonly (string | null)[];
}

export interface BoardHandle {
  readonly svg: SVGSVGElement;
  paint(next: BoardPaint): void;
  /** The `<path data-territory="i">` for one territory, for hit-testing and tests. */
  pathFor(index: number): SVGPathElement | null;
  destroy(): void;
}

/* ------------------------------------------------------------------ css -- */

const OWNER_KEYS: readonly string[] = [...PLAYER_COLOURS, "none", "neutral", "unknown"];

function ownerRule(key: string): string {
  // "none" / "neutral" / "unknown" have no player palette: they take the flat
  // off-board grey, and `--p-hot` falls back to it so a selected neutral tile
  // still resolves rather than painting `fill: var(--p-hot)` as nothing.
  if (key === "none" || key === "neutral" || key === "unknown") {
    return (
      `.territory[data-owner="${key}"] { --p: var(--land-neutral); ` +
      `--p-dark: var(--land-neutral); --p-hot: var(--land-neutral); }`
    );
  }
  return (
    `.territory[data-owner="${key}"] { --p: var(--p-${key}); ` +
    `--p-dark: var(--p-${key}-dark); --p-hot: var(--p-${key}-hot); }`
  );
}

/**
 * Everything §8's CSS block specifies, scoped to the board so the module is
 * self-contained: the host page need only supply the tokens.
 */
export const BOARD_CSS: string = [
  ".risk-board { display: block; width: 100%; height: 100%; }",
  ".risk-board .ocean { fill: var(--ocean); }",
  ".risk-board .ocean-net { fill: url(#net); }",
  ".risk-board .net-line { stroke: var(--ocean-line); stroke-width: 1; fill: none; }",
  ".risk-board .land-wall { fill: var(--land-wall); }",
  ".risk-board .coast { fill: var(--ocean-glow); }",
  ".risk-board .routes { fill: none; stroke: var(--sea-route); stroke-width: 4;",
  '  stroke-dasharray: 14 12; stroke-linecap: round; }',
  ".risk-board .route-node { fill: #fff; }",
  ".territory { fill: var(--p-dark); stroke: var(--land-outline); stroke-width: 3;",
  "  stroke-linejoin: round; transition: fill 240ms ease-out; cursor: pointer; }",
  ...OWNER_KEYS.map(ownerRule),
  '.territory[data-state="selected"], .territory[data-state="target"] {',
  "  fill: var(--p-hot); stroke: #fff; stroke-width: 4;",
  "  filter: drop-shadow(0 0 10px rgba(255,255,255,.75)); }",
  '.territory[data-state="dimmed"] { filter: brightness(.45) saturate(.6); }',
  // A frozen tile is out of play: hatched, and never a hit-test target (R-blizzard).
  '.territory[data-blizzard="1"] { pointer-events: none; cursor: default; }',
  ".risk-board .overlay { pointer-events: none; }",
].join("\n");

/* ----------------------------------------------------------------- defs -- */

/** A tiny deterministic LCG, so the ocean net is identical on every build. */
function netLines(): string {
  let seed = 0x5173;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const lines: string[] = [];
  // Eight long strokes per tile ≈ 32 across a 1600×900 frame, inside §8's 25–40.
  for (let i = 0; i < 8; i += 1) {
    const x1 = Math.round(next() * NET_TILE * 1.4 - NET_TILE * 0.2);
    const y1 = Math.round(next() * NET_TILE * 1.4 - NET_TILE * 0.2);
    const angle = next() * Math.PI;
    const length = 400 + Math.round(next() * 500);
    const x2 = Math.round(x1 + Math.cos(angle) * length);
    const y2 = Math.round(y1 + Math.sin(angle) * length);
    lines.push(`<line class="net-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  return lines.join("");
}

/**
 * The `<defs>` markup, exported so a test can assert the filter chain.
 *
 * `relief` reads literally as §8 writes it: the offset blur composited `out`
 * **against** `SourceAlpha`, which leaves the halo *outside* the silhouette —
 * a soft rim light above each territory (`dy="-3"`) and a matching shade below
 * (`dy="4"`). That is the extruded-slab read; an inner band would need the
 * operands the other way round.
 */
export function boardDefs(map: MapDef): string {
  const [x, y, w, h] = map.viewBox;
  return [
    "<defs>",
    `<pattern id="net" width="${NET_TILE}" height="${NET_TILE}" patternUnits="userSpaceOnUse">`,
    netLines(),
    "</pattern>",

    '<filter id="coast" x="-25%" y="-25%" width="150%" height="150%">',
    '<feGaussianBlur in="SourceAlpha" stdDeviation="14" result="coastBlur"/>',
    '<feFlood flood-color="#7FE3FF" flood-opacity=".75"',
    ' style="flood-color: var(--ocean-glow, #7FE3FF); flood-opacity: .75" result="coastGlow"/>',
    '<feComposite in="coastGlow" in2="coastBlur" operator="in"/>',
    "</filter>",

    '<filter id="relief" x="-15%" y="-15%" width="130%" height="130%">',
    '<feOffset in="SourceAlpha" dy="-3" result="hiOffset"/>',
    '<feGaussianBlur in="hiOffset" stdDeviation="3" result="hiBlur"/>',
    '<feComposite in="hiBlur" in2="SourceAlpha" operator="out" result="hiMask"/>',
    '<feFlood flood-color="#fff" flood-opacity=".30" result="hiFlood"/>',
    '<feComposite in="hiFlood" in2="hiMask" operator="in" result="highlight"/>',
    '<feOffset in="SourceAlpha" dy="4" result="loOffset"/>',
    '<feGaussianBlur in="loOffset" stdDeviation="4" result="loBlur"/>',
    '<feComposite in="loBlur" in2="SourceAlpha" operator="out" result="loMask"/>',
    '<feFlood flood-color="#000" flood-opacity=".42" result="loFlood"/>',
    '<feComposite in="loFlood" in2="loMask" operator="in" result="shadow"/>',
    '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="highlight"/>',
    '<feMergeNode in="shadow"/></feMerge>',
    "</filter>",

    // The continent ring: blur the *coloured* graphic, then subtract the
    // silhouette. What survives is a glow strictly outside the union — the
    // perimeter, with no internal borders to erase.
    '<filter id="ring" x="-20%" y="-20%" width="140%" height="140%">',
    '<feGaussianBlur in="SourceGraphic" stdDeviation="9" result="ringBlur"/>',
    '<feComposite in="ringBlur" in2="SourceAlpha" operator="out"/>',
    "</filter>",

    // §8's blizzard hatching, reused as the colour-vision pattern style.
    '<pattern id="blizzard" width="14" height="14" patternUnits="userSpaceOnUse"',
    ' patternTransform="rotate(45)">',
    '<rect width="7" height="14" fill="#fff" fill-opacity=".34"/>',
    "</pattern>",
    '<pattern id="cv-dots" width="12" height="12" patternUnits="userSpaceOnUse">',
    '<circle cx="3" cy="3" r="2" fill="#fff" fill-opacity=".12"/>',
    "</pattern>",
    '<pattern id="cv-diagonal" width="10" height="10" patternUnits="userSpaceOnUse"',
    ' patternTransform="rotate(45)">',
    '<rect width="3" height="10" fill="#fff" fill-opacity=".12"/>',
    "</pattern>",
    '<pattern id="cv-cross" width="12" height="12" patternUnits="userSpaceOnUse">',
    '<path d="M0 0 H12 M0 0 V12" stroke="#fff" stroke-opacity=".12" stroke-width="3"/>',
    "</pattern>",

    // The vignette is anchored to the map's own box, origin honoured, so a
    // non-zero `viewBox` origin does not slide the darkening off-centre.
    `<radialGradient id="vignette" gradientUnits="userSpaceOnUse"`,
    ` cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.hypot(w, h) / 2}">`,
    '<stop offset=".55" stop-color="#02161E" stop-opacity="0"/>',
    '<stop offset="1" stop-color="#02161E" stop-opacity=".85"/>',
    "</radialGradient>",
    "</defs>",
  ].join("");
}

/* ---------------------------------------------------------------- build -- */

/** The land union: every territory's `d`, concatenated into one `<path>`. */
function unionPath(map: MapDef): string {
  return map.territories.map((t) => t.d).join(" ");
}

/** Each `seaLinked` pair exactly once — the relation is symmetric (F45). */
function seaPairs(map: MapDef): readonly (readonly [number, number])[] {
  const pairs: (readonly [number, number])[] = [];
  map.territories.forEach((t, i) => {
    for (const j of t.seaLinked) if (j > i) pairs.push([i, j] as const);
  });
  return pairs;
}

function routeMarkup(map: MapDef): string {
  return seaPairs(map)
    .map(([i, j]) => {
      const a = map.territories[i];
      const b = map.territories[j];
      if (!a || !b) return "";
      const [ax, ay] = a.token;
      const [bx, by] = b.token;
      const cx = (ax + bx) / 2 - (by - ay) * ROUTE_BOW;
      const cy = (ay + by) / 2 + (bx - ax) * ROUTE_BOW;
      return (
        `<path class="route" data-route="${i}-${j}" d="M ${ax} ${ay} Q ${cx.toFixed(1)} ` +
        `${cy.toFixed(1)} ${bx} ${by}"/>` +
        `<circle class="route-node" cx="${ax}" cy="${ay}" r="7"/>` +
        `<circle class="route-node" cx="${bx}" cy="${by}" r="7"/>`
      );
    })
    .join("");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Build the board. The child order is §8's eight steps, after the `<defs>`
 * (which carries the `<style>`): ocean · net · coast · wall · territories ·
 * continent-rings · routes · vignette.
 */
export function createBoard(map: MapDef, doc: Document = document): BoardHandle {
  const [vx, vy, vw, vh] = map.viewBox;
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", "risk-board");
  svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const union = escapeAttr(unionPath(map));
  const territoryPaths = map.territories
    .map(
      (t) =>
        `<path class="territory" data-territory="${t.index}" data-owner="none" ` +
        `data-state="idle" d="${escapeAttr(t.d)}"><title>${escapeAttr(t.name)}</title></path>`,
    )
    .join("");

  svg.innerHTML = [
    boardDefs(map),
    `<rect class="ocean" data-layer="ocean" x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>`,
    `<rect class="ocean-net" data-layer="net" x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>`,
    `<path class="coast" data-layer="coast" filter="url(#coast)" d="${union}"/>`,
    `<path class="land-wall" data-layer="wall" transform="translate(0,${WALL_OFFSET})" d="${union}"/>`,
    `<g class="territories" data-layer="territories" filter="url(#relief)">${territoryPaths}` +
      `<g class="overlays"></g></g>`,
    '<g class="continent-rings" data-layer="rings"></g>',
    `<g class="routes" data-layer="routes">${routeMarkup(map)}</g>`,
    `<rect class="vignette" data-layer="vignette" fill="url(#vignette)" pointer-events="none" ` +
      `x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>`,
  ].join("");

  // The `<style>` lives inside `<defs>`, so the eight layers stay the eight
  // element children after it and a test can read the order straight off.
  const defs = svg.querySelector("defs");
  const style = doc.createElementNS(SVG_NS, "style");
  style.textContent = BOARD_CSS;
  defs?.appendChild(style);

  const paths = Array.from(svg.querySelectorAll<SVGPathElement>("path.territory"));
  const overlays = svg.querySelector<SVGGElement>("g.overlays");
  const rings = svg.querySelector<SVGGElement>("g.continent-rings");
  const overlayFor = new Map<number, SVGPathElement>();

  let prev: BoardPaint | null = null;

  const ensureOverlay = (index: number): SVGPathElement | null => {
    const existing = overlayFor.get(index);
    if (existing) return existing;
    const territory = map.territories[index];
    if (!territory || !overlays) return null;
    const node = doc.createElementNS(SVG_NS, "path");
    node.setAttribute("class", "overlay");
    node.setAttribute("data-overlay", String(index));
    node.setAttribute("d", territory.d);
    overlays.appendChild(node);
    overlayFor.set(index, node);
    return node;
  };

  /** Blizzard hatching wins over the colour-vision pattern on the same tile. */
  const overlayFill = (index: number, next: BoardPaint): string | null => {
    if (next.blizzards.includes(index)) return "url(#blizzard)";
    const pattern = next.patterns?.[index];
    return pattern ? `url(#${pattern})` : null;
  };

  const paintRings = (next: BoardPaint): void => {
    if (!rings) return;
    const key = next.rings.map((r) => `${r.continent}:${r.colour}`).join("|");
    const prevKey = prev ? prev.rings.map((r) => `${r.continent}:${r.colour}`).join("|") : null;
    if (key === prevKey) return;
    rings.textContent = "";
    for (const ring of next.rings) {
      const continent = map.continents[ring.continent];
      if (!continent) continue;
      const d = continent.territories
        .map((t) => map.territories[t]?.d ?? "")
        .filter(Boolean)
        .join(" ");
      if (!d) continue;
      const node = doc.createElementNS(SVG_NS, "path");
      node.setAttribute("class", "continent-ring");
      node.setAttribute("data-continent", String(ring.continent));
      node.setAttribute("filter", "url(#ring)");
      node.setAttribute("d", d);
      // `style.fill` rather than the attribute: the accent arrives as
      // `var(--c-na)` and `var()` is not valid in a presentation attribute.
      node.style.fill = ring.colour;
      rings.appendChild(node);
    }
  };

  const paint = (next: BoardPaint): void => {
    for (let i = 0; i < paths.length; i += 1) {
      const path = paths[i];
      if (!path) continue;
      // The built markup already says `none` / `idle`, so the very first paint
      // of an untouched board writes nothing at all.
      const owner = next.owners[i] ?? "none";
      const state = next.states[i] ?? "idle";
      if ((prev ? prev.owners[i] ?? "none" : "none") !== owner) {
        path.setAttribute("data-owner", owner);
      }
      if ((prev ? prev.states[i] ?? "idle" : "idle") !== state) {
        path.setAttribute("data-state", state);
      }

      const frozen = next.blizzards.includes(i);
      if ((prev ? prev.blizzards.includes(i) : false) !== frozen) {
        if (frozen) path.setAttribute("data-blizzard", "1");
        else path.removeAttribute("data-blizzard");
      }

      const fill = overlayFill(i, next);
      const prevFill = prev ? overlayFill(i, prev) : null;
      if (fill !== prevFill) {
        if (fill) {
          const node = ensureOverlay(i);
          node?.setAttribute("fill", fill);
          node?.removeAttribute("display");
        } else overlayFor.get(i)?.setAttribute("display", "none");
      }
    }
    paintRings(next);
    prev = next;
  };

  return {
    svg,
    paint,
    pathFor: (index: number) => paths[index] ?? null,
    destroy: () => {
      svg.remove();
      svg.textContent = "";
      paths.length = 0;
      overlayFor.clear();
      prev = null;
    },
  };
}
