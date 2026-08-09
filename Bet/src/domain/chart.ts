/**
 * Pure, framework-free SVG path math for the hand-rolled charts (SPEC §5.3,
 * D13). No React, no DOM — this module lives in `src/domain`, so G1 applies:
 * no imports from `next`, `react`, `react-dom`, `@/adapters` or `@/app`.
 * `src/components/charts/**` calls into this for every coordinate it draws.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

export interface PathOptions {
  width: number;
  height: number;
  yMin: number;
  yMax: number;
  /** Defaults to the min `x` across `points` when omitted. */
  xMin?: number;
  /** Defaults to the max `x` across `points` when omitted. */
  xMax?: number;
}

/** Rounds to 2 decimal places — enough precision for on-screen SVG, small
 * enough to keep path strings short and deterministic across platforms. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Linearly maps `value` from `[domainMin, domainMax]` to `[rangeMin,
 * rangeMax]`. When the domain has zero width (`domainMin === domainMax` —
 * e.g. every point shares one x, or an entire series has one y value) there
 * is no meaningful ratio to compute, so this returns the midpoint of the
 * range instead of dividing by zero: a flat line at mid-height/mid-width
 * rather than `NaN`.
 */
export function scale(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  if (domainMax === domainMin) {
    return (rangeMin + rangeMax) / 2;
  }
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

/** Sorts a copy of `points` by ascending `x` using a stable sort, so callers
 * never have to pre-sort their series and duplicate/out-of-order x values
 * don't produce a path that zig-zags backwards. Ties keep their original
 * relative order. */
function sortedByX(points: ChartPoint[]): ChartPoint[] {
  return [...points].sort((a, b) => a.x - b.x);
}

function resolveXDomain(
  sorted: ChartPoint[],
  opts: PathOptions,
): { xMin: number; xMax: number } {
  const xMin = opts.xMin ?? sorted[0]!.x;
  const xMax = opts.xMax ?? sorted[sorted.length - 1]!.x;
  return { xMin, xMax };
}

/**
 * Builds an SVG `d` string for a line through `points`, scaled into
 * `[0, width] x [height, 0]` (SVG y grows downward, so `yMax` maps to the
 * top and `yMin` to the bottom). Edge cases handled explicitly:
 * - empty `points` → `""` (nothing to draw, not an error).
 * - a single point → a lone `M` command: a valid, degenerate SVG path.
 * - `yMin === yMax` (or an implied `xMin === xMax`) → `scale` returns the
 *   range midpoint, producing a flat line rather than `NaN`.
 * - unsorted or duplicate `x` values → sorted first (stably), so the path
 *   never zig-zags and duplicates simply sit at the same horizontal spot.
 */
export function buildLinePath(points: ChartPoint[], opts: PathOptions): string {
  if (points.length === 0) return "";

  const sorted = sortedByX(points);
  const { xMin, xMax } = resolveXDomain(sorted, opts);

  const toX = (x: number) => round2(scale(x, xMin, xMax, 0, opts.width));
  const toY = (y: number) => round2(scale(y, opts.yMin, opts.yMax, opts.height, 0));

  const [first, ...rest] = sorted;
  const commands = [`M${toX(first!.x)},${toY(first!.y)}`];
  for (const p of rest) {
    commands.push(`L${toX(p.x)},${toY(p.y)}`);
  }
  return commands.join(" ");
}

/**
 * Builds an SVG `d` string for the filled area under a line through
 * `points`: the line path, then down to the `yMin` baseline at the last
 * point's x, back along the baseline to the first point's x, and closed.
 * Shares every edge case behavior with `buildLinePath` (empty → `""`;
 * everything else degrades to a valid, closed shape rather than throwing).
 */
export function buildAreaPath(points: ChartPoint[], opts: PathOptions): string {
  if (points.length === 0) return "";

  const sorted = sortedByX(points);
  const { xMin, xMax } = resolveXDomain(sorted, opts);
  const linePath = buildLinePath(sorted, { ...opts, xMin, xMax });

  const toX = (x: number) => round2(scale(x, xMin, xMax, 0, opts.width));
  const baseY = round2(opts.height);
  const lastX = toX(sorted[sorted.length - 1]!.x);
  const firstX = toX(sorted[0]!.x);

  return `${linePath} L${lastX},${baseY} L${firstX},${baseY} Z`;
}

/**
 * Picks a "nice" round-number tick step (1/2/5 x a power of ten) — the
 * classic Heckbert nice-numbers algorithm. `round` biases the fraction
 * toward the nearest nice value instead of the next one up, which is what
 * you want once you're choosing a *step* rather than bounding a *range*.
 */
function niceNumber(range: number, round: boolean): number {
  if (range === 0) return 0;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/**
 * Returns `count`-ish evenly spaced "nice" tick values spanning at least
 * `[min, max]` — used for chart axis gridlines/labels. `min === max`
 * collapses to a single tick rather than dividing by zero. Ticks are
 * rounded to 10 decimal places to scrub the floating-point noise that
 * `niceNumber`'s repeated division/multiplication can introduce.
 */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  if (count <= 0) return [];
  if (count === 1) return [min, max];

  const step = niceNumber((max - min) / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // Guard against float drift nudging the loop past niceMax by less than a
  // full step (e.g. accumulated error landing at niceMax + 1e-13).
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v * 1e10) / 1e10);
  }
  return ticks;
}
