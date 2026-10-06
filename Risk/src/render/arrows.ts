/**
 * The attack arrow and the fortify chevrons (SPEC §8).
 *
 * Deliberately two different languages: the attack is **one continuous white
 * curve with a solid head**, the fortify is **discrete chevrons marching
 * source → destination**, so a glance tells the two apart without reading the
 * HUD. Both are SVG, because they belong to the map's coordinate space.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** §8: the quadratic's control point sits this far off the chord's midpoint. */
export const BOW = 0.22;
/** §8: the triangular head, in map units. */
export const HEAD_SIZE = 22;
/** §8: chevrons march at this pitch along the fortify spline. */
export const CHEVRON_PITCH = 34;

type Pt = readonly [number, number];

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The control point of §8's gently-curved arrow: 22% of the chord, perpendicular. */
function controlPoint(from: Pt, to: Pt): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  if (length === 0) return [mx, my];
  // Left-hand normal, so two arrows between the same pair never overlap in
  // opposite directions: the bow always leans the same way relative to travel.
  return [mx + (-dy / length) * BOW * length, my + (dx / length) * BOW * length];
}

/** A quadratic Bézier with the control point offset ~22% of the chord perpendicular (§8). */
export function attackArrowPath(from: Pt, to: Pt): string {
  const [cx, cy] = controlPoint(from, to);
  return `M ${round(from[0])} ${round(from[1])} Q ${round(cx)} ${round(cy)} ${round(to[0])} ${round(to[1])}`;
}

/** The 22 px triangular head, as a path, oriented along the curve's end tangent. */
export function arrowHeadPath(from: Pt, to: Pt, size: number = HEAD_SIZE): string {
  const control = controlPoint(from, to);
  // A quadratic's tangent at t = 1 is P2 − P1, so the head follows the curve
  // rather than the chord — on a bowed arrow those differ by ~25°.
  let tx = to[0] - control[0];
  let ty = to[1] - control[1];
  const length = Math.hypot(tx, ty);
  if (length === 0) {
    tx = 1;
    ty = 0;
  } else {
    tx /= length;
    ty /= length;
  }
  const bx = to[0] - tx * size;
  const by = to[1] - ty * size;
  const half = size * 0.5;
  const nx = -ty * half;
  const ny = tx * half;
  return (
    `M ${round(to[0])} ${round(to[1])} ` +
    `L ${round(bx + nx)} ${round(by + ny)} ` +
    `L ${round(bx - nx)} ${round(by - ny)} Z`
  );
}

/* ------------------------------------------------------------- fortify -- */

/** Catmull–Rom through the chain, with the endpoints doubled, sampled to a polyline. */
function samplePolyline(points: readonly Pt[], perSpan = 16): Pt[] {
  if (points.length < 2) return [...points];
  const first = points[0] as Pt;
  const last = points[points.length - 1] as Pt;
  const extended: Pt[] = [first, ...points, last];
  const out: Pt[] = [first];
  for (let i = 1; i + 2 < extended.length; i += 1) {
    const p0 = extended[i - 1] as Pt;
    const p1 = extended[i] as Pt;
    const p2 = extended[i + 1] as Pt;
    const p3 = extended[i + 2] as Pt;
    for (let s = 1; s <= perSpan; s += 1) {
      const t = s / perSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] + (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] + (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y] as Pt);
    }
  }
  return out;
}

/** Discrete `›` chevrons at 34 px pitch along a spline through the chain (§8). */
export function fortifyChevrons(
  points: readonly Pt[],
  pitch: number = CHEVRON_PITCH,
): readonly { readonly at: Pt; readonly angle: number }[] {
  if (points.length < 2 || pitch <= 0) return [];
  const poly = samplePolyline(points);
  const out: { readonly at: Pt; readonly angle: number }[] = [];
  let walked = 0;      // arc length consumed so far
  let nextStop = 0;    // the next multiple of `pitch`
  for (let i = 0; i + 1 < poly.length; i += 1) {
    const a = poly[i] as Pt;
    const b = poly[i + 1] as Pt;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const segment = Math.hypot(dx, dy);
    if (segment === 0) continue;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    while (nextStop <= walked + segment + 1e-9) {
      const t = (nextStop - walked) / segment;
      out.push({ at: [a[0] + dx * t, a[1] + dy * t] as Pt, angle });
      nextStop += pitch;
    }
    walked += segment;
  }
  return out;
}

/* --------------------------------------------------------------- layer -- */

export interface ArrowLayerHandle {
  readonly element: SVGGElement;
  showAttack(from: Pt, to: Pt): void;
  showFortify(points: readonly Pt[]): void;
  clear(): void;
  destroy(): void;
}

/**
 * The §8 numbers as CSS, so the layer carries its own look: a 1.5 px dark
 * outline means the outline path is drawn 3 px wider than the 8 px body.
 */
export const ARROW_CSS: string = [
  ".risk-arrows { pointer-events: none; }",
  ".risk-arrows .attack-body, .risk-arrows .attack-outline {",
  "  fill: none; stroke-linecap: round; stroke-linejoin: round; }",
  ".risk-arrows .attack-outline { stroke: var(--stroke-dark); stroke-width: 11; }",
  ".risk-arrows .attack-body { stroke: #fff; stroke-width: 8; }",
  ".risk-arrows .attack-head { fill: #fff; stroke: var(--stroke-dark); stroke-width: 1.5;",
  "  stroke-linejoin: round; }",
  ".risk-arrows .chevron { fill: none; stroke: #fff; stroke-width: 7;",
  "  stroke-linecap: round; stroke-linejoin: round; }",
  '.risk-arrows [data-hidden="1"] { display: none; }',
].join("\n");

/** The `›` glyph, ≈22×26 and centred on its own origin (§8). */
const CHEVRON_D = "M -8 -13 L 8 0 L -8 13";

export function createArrowLayer(doc: Document = document): ArrowLayerHandle {
  const element = doc.createElementNS(SVG_NS, "g") as SVGGElement;
  element.setAttribute("class", "risk-arrows");

  const style = doc.createElementNS(SVG_NS, "style");
  style.textContent = ARROW_CSS;
  element.appendChild(style);

  const make = (className: string): SVGPathElement => {
    const node = doc.createElementNS(SVG_NS, "path");
    node.setAttribute("class", className);
    node.setAttribute("data-hidden", "1");
    element.appendChild(node);
    return node;
  };
  const outline = make("attack-outline");
  const body = make("attack-body");
  const head = make("attack-head");

  const chevrons = doc.createElementNS(SVG_NS, "g") as SVGGElement;
  chevrons.setAttribute("class", "chevrons");
  element.appendChild(chevrons);

  const showAttack = (from: Pt, to: Pt): void => {
    const d = attackArrowPath(from, to);
    outline.setAttribute("d", d);
    body.setAttribute("d", d);
    head.setAttribute("d", arrowHeadPath(from, to));
    for (const node of [outline, body, head]) node.removeAttribute("data-hidden");
  };

  const showFortify = (points: readonly Pt[]): void => {
    chevrons.textContent = "";
    for (const { at, angle } of fortifyChevrons(points)) {
      const node = doc.createElementNS(SVG_NS, "path");
      node.setAttribute("class", "chevron");
      node.setAttribute("d", CHEVRON_D);
      node.setAttribute(
        "transform",
        `translate(${round(at[0])} ${round(at[1])}) rotate(${round(angle)})`,
      );
      chevrons.appendChild(node);
    }
  };

  const clear = (): void => {
    for (const node of [outline, body, head]) {
      node.removeAttribute("d");
      node.setAttribute("data-hidden", "1");
    }
    chevrons.textContent = "";
  };

  return {
    element,
    showAttack,
    showFortify,
    clear,
    destroy: () => {
      clear();
      element.remove();
      element.textContent = "";
    },
  };
}
