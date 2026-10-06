/**
 * Troop chips and territory labels (SPEC §8, and the coordinate contract F40).
 *
 * They are **HTML, not SVG children** — so they get normal text rendering and
 * `-webkit-text-stroke` — but they live **inside the board wrapper**, at raw
 * map coordinates, so pan and zoom move them for free. Each then applies the
 * counter `rotateX(-θ)` and `scale(1/zoom)` that keep it upright and at a
 * fixed screen size; those two numbers are **two CSS variables written once
 * per frame on the layer**, never per token (§10's render loop).
 *
 * Nothing here re-derives a matrix: `camera.toScreen` is called in exactly one
 * place, `labelVisible`'s viewport test.
 */
import { TROOPS_UNKNOWN, type MapDef } from "@/engine/types";

import { counterTransformVars, toScreen, type Camera } from "./camera";
import { PLAYER_COLOURS } from "./palette";

/** §8: a label is hidden when its territory covers less than this on screen. */
export const LABEL_MIN_AREA = 2500;

/** §8.6 label type: 20 px, stepped down one notch on a crowded board. */
export const LABEL_FONT = 20;
export const LABEL_FONT_DENSE = 17;
/** Above this many territories the label type steps down (§8.6's 19–22 px band). */
export const DENSE_TERRITORIES = 50;
/** The greedy pass's one nudge, in screen px. */
export const LABEL_NUDGE = 12;

/** The chip is authored in a 48×56 box with r = 19; everything scales off that. */
const BASE_RADIUS = 19;
const CHIP_VIEW_H = 56;
/** D70: at three digits the circle becomes a stadium this much wider per digit. */
const STADIUM_STEP = 11;
const STADIUM_BASE = 38;

const SVG_NS = "http://www.w3.org/2000/svg";
const SENTINELS: readonly string[] = ["none", "neutral", "unknown"];

export interface TokenPaint {
  readonly owners: readonly string[];       // PlayerColour name | "none" | "neutral" | "unknown"
  readonly troops: readonly number[];       // TROOPS_UNKNOWN (-1) renders "?"
  readonly selected: number | null;
  readonly radius: number;                  // palette.tokenRadius(map.territories.length)
  readonly showLabels: boolean;
  /** The territory under the pointer, if any: its label is always shown. */
  readonly hovered?: number | null;
}

export interface TokenLayerHandle {
  readonly element: HTMLDivElement;
  paint(next: TokenPaint, cam: Camera): void;
  destroy(): void;
}

/* ------------------------------------------------------------ geometry -- */

const NUMBER_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** The `d`'s vertex polygon, in map units. Chunky boards are 12–30 line vertices. */
function polygonArea(d: string): number {
  const numbers = d.match(NUMBER_RE);
  if (!numbers || numbers.length < 6) return 0;
  let twice = 0;
  const count = Math.floor(numbers.length / 2);
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    const xi = Number(numbers[i * 2]);
    const yi = Number(numbers[i * 2 + 1]);
    const xj = Number(numbers[j * 2]);
    const yj = Number(numbers[j * 2 + 1]);
    twice += xi * yj - xj * yi;
  }
  return Math.abs(twice) / 2;
}

// Areas never change for a given map, and `paint` wants all of them every
// frame, so they are computed once per `MapDef` and kept beside it.
const AREAS = new WeakMap<MapDef, readonly number[]>();

function areasOf(map: MapDef): readonly number[] {
  const cached = AREAS.get(map);
  if (cached) return cached;
  const areas = map.territories.map((t) => polygonArea(t.d));
  AREAS.set(map, areas);
  return areas;
}

/** `true` when the territory's on-screen area is at least 2,500 px² (§8). */
export function labelVisible(map: MapDef, index: number, cam: Camera): boolean {
  const area = areasOf(map)[index];
  const territory = map.territories[index];
  if (area === undefined || !territory) return false;
  // Area is a map-unit quantity; the camera scales lengths by `zoom`, so it
  // scales areas by `zoom²`. The tilt foreshortens, which can only shrink it,
  // and §8 wants a cheap test rather than a projected polygon.
  if (area * cam.zoom * cam.zoom < LABEL_MIN_AREA) return false;
  const view = cam.viewport;
  if (!view) return true;
  const [sx, sy] = toScreen(cam, territory.token);
  return sx >= 0 && sy >= 0 && sx <= view.w && sy <= view.h;
}

/* -------------------------------------------------------- label layout -- */

/** §8.6: one step down on a board with more than 50 territories. */
export function labelFontSize(territoryCount: number): number {
  return territoryCount > DENSE_TERRITORIES ? LABEL_FONT_DENSE : LABEL_FONT;
}

/**
 * A label's box in screen px, without measuring the DOM.
 *
 * The render loop may not read layout (§10), so the box is estimated from the
 * glyph count: Titillium Web 700 averages ≈0.55 em of advance, the line box
 * is ≈1.15 em, and the 3 px outline adds 6 px on each axis.
 */
export function labelBoxSize(text: string, fontSize: number): { readonly w: number; readonly h: number } {
  return { w: text.length * fontSize * 0.55 + 6, h: fontSize * 1.15 + 6 };
}

export interface LabelPlacement {
  /** Screen-px offset applied to the label, on top of the map's own anchor. */
  readonly dy: number;
  /** Still colliding after every candidate: shown only on hover or selection. */
  readonly crowded: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/**
 * The greedy label pass **[ours]**.
 *
 * `research/04 §8.6` records that the original makes no attempt at collision
 * avoidance and its labels simply overlap — which is exactly what the
 * Great Britain / Northern Europe / Western Europe cluster looks like on a
 * 42-territory board. This pass keeps the §8.6 anchor and only moves a label
 * that would be unreadable: 0 → `+12` below → flipped above the token → and,
 * failing all three, marked `crowded`, which hides it until the territory is
 * hovered or selected.
 *
 * It is a pure function of the map, the token radius and the camera's *shape*
 * (zoom and tilt) — pan only translates the board, so the plan is computed
 * about a fixed origin and memoised per zoom/tilt, never recomputed while the
 * player merely pans.
 */
export function planLabels(
  map: MapDef, cam: Pick<Camera, "zoom" | "tilt" | "perspective">, radius: number,
): readonly LabelPlacement[] {
  const font = labelFontSize(map.territories.length);
  const frame: Camera = {
    pan: [0, 0], zoom: cam.zoom, tilt: cam.tilt, origin: [0, 0],
    ...(cam.perspective === undefined ? {} : { perspective: cam.perspective }),
  };
  const tokens: Box[] = map.territories.map((t) => {
    const [x, y] = toScreen(frame, t.token);
    return { x, y, w: radius * 2, h: radius * 2 };
  });
  const anchors = map.territories.map((t) => toScreen(frame, t.label));

  const placed: Box[] = [];
  return map.territories.map((territory, i) => {
    const anchor = anchors[i] as readonly [number, number];
    const token = tokens[i] as Box;
    const { w, h } = labelBoxSize(territory.name, font);
    const boxAt = (dy: number): Box => ({ x: anchor[0], y: anchor[1] + dy, w, h });
    // Below, nudged further below, then mirrored to sit above the token.
    const above = -2 * (anchor[1] - token.y) - LABEL_NUDGE;
    // Text over text is unreadable; text over a chip is what §8.6 already
    // shows the original doing, so a token only *steers* the choice — it
    // never costs a territory its name.
    let clearOfLabels: number | null = null;
    for (const dy of [0, LABEL_NUDGE, above]) {
      const box = boxAt(dy);
      if (placed.some((p) => overlaps(box, p))) continue;
      if (!tokens.some((t, j) => j !== i && overlaps(box, t))) {
        placed.push(box);
        return { dy, crowded: false };
      }
      if (clearOfLabels === null) clearOfLabels = dy;
    }
    if (clearOfLabels !== null) {
      placed.push(boxAt(clearOfLabels));
      return { dy: clearOfLabels, crowded: false };
    }
    return { dy: 0, crowded: true };
  });
}

/* ---------------------------------------------------------------- chip -- */

/** The SVG markup of one chip, per §8's recipe. Exported for the unit test. */
export function tokenSvg(radius: number, digits: number): string {
  const scale = radius / BASE_RADIUS;
  const stadium = digits >= 3;
  const bodyW = stadium ? STADIUM_BASE + STADIUM_STEP * (digits - 1) : STADIUM_BASE;
  const vbW = bodyW + 10;
  const cx = vbW / 2;
  // Body sits 5 units below the face: that 5-unit ledge is the whole "poker
  // chip seen from ~10° above" read.
  const shape = stadium
    ? `<rect class="chip-body" x="5" y="10" width="${bodyW}" height="38" rx="19"/>` +
      `<rect class="chip-face" x="5" y="5" width="${bodyW}" height="38" rx="19"/>`
    : `<circle class="chip-body" cx="${cx}" cy="29" r="19"/>` +
      `<circle class="chip-face" cx="${cx}" cy="24" r="19"/>`;
  return (
    `<svg class="chip" viewBox="0 0 ${vbW} ${CHIP_VIEW_H}" ` +
    `width="${(vbW * scale).toFixed(2)}" height="${(CHIP_VIEW_H * scale).toFixed(2)}" ` +
    `aria-hidden="true" focusable="false">` +
    `<g class="chip-shape">${shape}</g>` +
    `<ellipse class="chip-spec" cx="${cx}" cy="15.5" rx="12" ry="4.5"/>` +
    `</svg>`
  );
}

/**
 * Cap height ≈0.62× the diameter at one digit and ≈0.52× at two, never below
 * 0.42× (§8); Titillium's cap height is ~0.7 em, hence the division.
 */
function numeralSize(radius: number, digits: number): number {
  const cap = digits <= 1 ? 0.62 : digits === 2 ? 0.52 : 0.42;
  return (2 * radius * cap) / 0.7;
}

function digitsOf(troops: number): { readonly text: string; readonly digits: number } {
  if (troops === TROOPS_UNKNOWN) return { text: "?", digits: 1 };
  /*
   * A zero is never a troop count, it is a moment: R62 hands a conquered
   * territory over the instant the defender's last army dies and R63 makes the
   * attacker occupy it with a separate `MOVE_IN`, so between those two actions
   * the tile is owned and empty. The board paints every AI step, which is up to
   * 300 ms (`aiStepMs`), and the counter would spend that frame reading "0" —
   * which is how a production walkthrough came away with a 0-troop Ontario. The
   * board game has no such state, so the chip stays and the numeral goes blank
   * until the armies land. Every other owned tile holds at least one army, which
   * `src/engine/invariants.test.ts` proves action by action.
   */
  if (troops <= 0) return { text: "", digits: 1 };
  const text = String(troops);
  return { text, digits: text.length };
}

/* ----------------------------------------------------------------- css -- */

let instances = 0;

function ownerVars(key: string, gradientId: string): string {
  if (SENTINELS.includes(key)) {
    // No player palette behind the sentinels: a flat off-board grey chip.
    return (
      `.risk-tokens .token[data-owner="${key}"] { --p: var(--land-neutral); ` +
      `--p-light: var(--text-muted); --p-dark: var(--text-dim); ` +
      `--p-wall: var(--chrome-900); --p-face: var(--land-neutral); }`
    );
  }
  return (
    `.risk-tokens .token[data-owner="${key}"] { --p: var(--p-${key}); ` +
    `--p-light: var(--p-${key}-light); --p-dark: var(--p-${key}-dark); ` +
    `--p-wall: var(--p-${key}-wall); --p-face: url(#${gradientId}-${key}); }`
  );
}

function layerCss(gradientId: string): string {
  return [
    ".risk-tokens { position: absolute; left: 0; top: 0; width: 0; height: 0;",
    "  transform-style: preserve-3d; pointer-events: none; }",
    // The verbatim §8 transform. `--x`/`--y` are the territory's raw map
    // coordinates minus the viewBox origin; `--tilt`/`--zoom` come from the
    // camera, once per frame, on the layer above.
    ".risk-tokens .token, .risk-tokens .label {",
    "  position: absolute; left: 0; top: 0; width: 0; height: 0;",
    "  transform: translate3d(var(--x), var(--y), 0)",
    "             rotateX(calc(-1 * var(--tilt))) scale(calc(1 / var(--zoom)));",
    "  transform-style: preserve-3d; }",
    ".risk-tokens .token { z-index: var(--z-tokens); }",
    ".risk-tokens .label { z-index: var(--z-labels); pointer-events: none; }",
    '.risk-tokens[data-labels="0"] .label { display: none; }',
    '.risk-tokens .label[data-hidden="1"] { display: none; }',
    // A label the greedy pass could not place is hidden until its territory
    // is hovered or selected, when it comes back on top of everything.
    '.risk-tokens .label[data-crowded="1"] { display: none; }',
    '.risk-tokens .label[data-crowded="1"][data-reveal="1"] { display: block;',
    "  z-index: var(--z-floaters); }",
    ".risk-tokens .chip { position: absolute; left: 0; top: 0; display: block;",
    "  transform: translate(-50%, -50%); }",
    // `--sh-token` as a filter, so the shadow follows the stadium silhouette.
    ".risk-tokens .chip-shape { filter: drop-shadow(0 3px 2.5px rgba(0,0,0,.45)); }",
    ".risk-tokens .chip-body { fill: var(--p-dark); }",
    ".risk-tokens .chip-face { fill: var(--p-face); stroke: var(--p-wall); stroke-width: 2; }",
    ".risk-tokens .chip-spec { fill: #fff; opacity: .16; }",
    ".risk-tokens .troops { position: absolute; left: 0; top: 0;",
    "  transform: translate(-50%, calc(-50% + var(--face-dy)));",
    "  font-family: var(--font-head), 'Titillium Web', system-ui, sans-serif;",
    "  font-weight: 900; color: #fff; paint-order: stroke fill;",
    "  -webkit-text-stroke: 3px var(--stroke-dark);",
    "  font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap; }",
    ".risk-tokens .label-text { position: absolute; left: 0; top: 0;",
    "  transform: translate(-50%, calc(-50% + var(--label-dy, 0px)));",
    "  font-family: var(--font-head), 'Titillium Web', system-ui, sans-serif;",
    "  font-weight: 700; font-size: var(--label-font, 20px); color: #fff; paint-order: stroke fill;",
    "  -webkit-text-stroke: 3px var(--stroke-dark);",
    "  text-shadow: 0 2px 2px rgba(0,0,0,.6); white-space: nowrap; }",
    ...[...PLAYER_COLOURS, ...SENTINELS].map((key) => ownerVars(key, gradientId)),
  ].join("\n");
}

/**
 * One radial per colour, in the layer's own defs. A single shared gradient
 * cannot work: `stop-color: var(--p-light)` resolves against the *gradient's*
 * ancestors, not the chip's, so the owner has to be baked into the paint
 * server and selected by `--p-face`.
 */
function gradientDefs(doc: Document, gradientId: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", "token-defs");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    "<defs>" +
    PLAYER_COLOURS.map(
      (key) =>
        `<radialGradient id="${gradientId}-${key}" cx="50%" cy="35%" r="72%">` +
        `<stop offset="0" style="stop-color: var(--p-${key}-light)"/>` +
        `<stop offset="1" style="stop-color: var(--p-${key})"/>` +
        "</radialGradient>",
    ).join("") +
    "</defs>";
  return svg;
}

/* --------------------------------------------------------------- layer -- */

export function createTokenLayer(map: MapDef, doc: Document = document): TokenLayerHandle {
  instances += 1;
  const gradientId = `rtf${instances}`;
  const [originX, originY] = map.viewBox;

  const element = doc.createElement("div");
  element.className = "risk-tokens";
  element.setAttribute("data-labels", "1");
  // One step down on a board of more than 50 territories (§8.6).
  element.style.setProperty("--label-font", `${labelFontSize(map.territories.length)}px`);

  const style = doc.createElement("style");
  style.textContent = layerCss(gradientId);
  element.appendChild(style);
  element.appendChild(gradientDefs(doc, gradientId));

  const tokens: HTMLDivElement[] = [];
  const chips: HTMLSpanElement[] = [];
  const numerals: HTMLSpanElement[] = [];
  const labels: HTMLDivElement[] = [];

  for (const territory of map.territories) {
    const token = doc.createElement("div");
    token.className = "token";
    token.setAttribute("data-token", String(territory.index));
    token.setAttribute("data-owner", "none");
    // Raw map coordinates **minus the viewBox origin** — the wrapper is sized
    // to the viewBox with its origin honoured (F40.1).
    token.style.setProperty("--x", `${territory.token[0] - originX}px`);
    token.style.setProperty("--y", `${territory.token[1] - originY}px`);

    const chip = doc.createElement("span");
    chip.className = "chip-holder";
    const numeral = doc.createElement("span");
    numeral.className = "troops";
    token.append(chip, numeral);

    const label = doc.createElement("div");
    label.className = "label";
    label.setAttribute("data-label", String(territory.index));
    label.setAttribute("data-owner", "none");
    label.style.setProperty("--x", `${territory.label[0] - originX}px`);
    label.style.setProperty("--y", `${territory.label[1] - originY}px`);
    const labelText = doc.createElement("span");
    labelText.className = "label-text";
    labelText.textContent = territory.name;
    label.appendChild(labelText);

    element.append(token, label);
    tokens.push(token);
    chips.push(chip);
    numerals.push(numeral);
    labels.push(label);
  }

  let prev: TokenPaint | null = null;
  const shownDigits: number[] = map.territories.map(() => 0);
  const shownText: string[] = map.territories.map(() => "");
  const shownLabel: boolean[] = map.territories.map(() => true);
  const shownCrowded: boolean[] = map.territories.map(() => false);
  const shownDy: number[] = map.territories.map(() => 0);
  const shownReveal: boolean[] = map.territories.map(() => false);

  // The greedy pass is a function of the camera's shape and the chip radius
  // only, so it re-runs on a zoom or a tilt and never on a pan (§10).
  let planKey = "";
  let plan: readonly LabelPlacement[] = map.territories.map(() => ({ dy: 0, crowded: false }));
  const planFor = (cam: Camera, radius: number): readonly LabelPlacement[] => {
    const key = `${cam.zoom.toFixed(3)}|${cam.tilt}|${radius}`;
    if (key !== planKey) {
      plan = planLabels(map, cam, radius);
      planKey = key;
    }
    return plan;
  };

  const writeChip = (index: number, radius: number, digits: number): void => {
    const chip = chips[index];
    const numeral = numerals[index];
    if (!chip || !numeral) return;
    chip.innerHTML = tokenSvg(radius, digits);
    numeral.style.fontSize = `${numeralSize(radius, digits).toFixed(2)}px`;
    // The face sits 4 of 56 viewBox units above the box centre.
    numeral.style.setProperty("--face-dy", `${(-4 * radius) / BASE_RADIUS}px`);
    shownDigits[index] = digits;
  };

  const paint = (next: TokenPaint, cam: Camera): void => {
    // Two variables for the whole layer — §10: never per token.
    const vars = counterTransformVars(cam);
    for (const [name, value] of Object.entries(vars)) element.style.setProperty(name, value);

    if (!prev || prev.showLabels !== next.showLabels) {
      element.setAttribute("data-labels", next.showLabels ? "1" : "0");
    }
    const resized = !prev || prev.radius !== next.radius;
    const placements = planFor(cam, next.radius);
    const hovered = next.hovered ?? null;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      const label = labels[i];
      const numeral = numerals[i];
      if (!token || !label || !numeral) continue;

      const owner = next.owners[i] ?? "none";
      if (!prev || prev.owners[i] !== owner) {
        token.setAttribute("data-owner", owner);
        label.setAttribute("data-owner", owner);
      }

      const { text, digits } = digitsOf(next.troops[i] ?? 0);
      if (resized || digits !== shownDigits[i]) writeChip(i, next.radius, digits);
      if (text !== shownText[i]) {
        numeral.textContent = text;
        shownText[i] = text;
      }

      const selected = next.selected === i;
      if (!prev || (prev.selected === i) !== selected) {
        if (selected) token.setAttribute("data-selected", "1");
        else token.removeAttribute("data-selected");
      }

      const visible = next.showLabels && labelVisible(map, i, cam);
      if (visible !== shownLabel[i]) {
        if (visible) label.removeAttribute("data-hidden");
        else label.setAttribute("data-hidden", "1");
        shownLabel[i] = visible;
      }

      const place = placements[i] ?? { dy: 0, crowded: false };
      if (place.dy !== shownDy[i]) {
        label.style.setProperty("--label-dy", `${place.dy.toFixed(1)}px`);
        shownDy[i] = place.dy;
      }
      if (place.crowded !== shownCrowded[i]) {
        if (place.crowded) label.setAttribute("data-crowded", "1");
        else label.removeAttribute("data-crowded");
        shownCrowded[i] = place.crowded;
      }
      const reveal = selected || hovered === i;
      if (reveal !== shownReveal[i]) {
        if (reveal) label.setAttribute("data-reveal", "1");
        else label.removeAttribute("data-reveal");
        shownReveal[i] = reveal;
      }
    }
    prev = next;
  };

  return {
    element,
    paint,
    destroy: () => {
      element.remove();
      element.textContent = "";
      tokens.length = 0;
      chips.length = 0;
      numerals.length = 0;
      labels.length = 0;
      prev = null;
    },
  };
}
