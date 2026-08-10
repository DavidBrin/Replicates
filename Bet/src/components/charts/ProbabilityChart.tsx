import { buildLinePath, scale } from "@/domain/chart";
import { cn } from "@/lib/cn";

export interface ChartSeriesPoint {
  /** Epoch milliseconds. */
  at: number;
  /** Probability, 0..1. */
  p: number;
}

export interface ChartSeries {
  outcomeId: string;
  label: string;
  /** Outcome color (Outcome.color, SPEC §4) — runtime data, not a design
   * token, so it flows straight into the SVG `stroke`/`fill` attributes. */
  color: string;
  points: ChartSeriesPoint[];
}

export interface ProbabilityChartProps {
  series: ChartSeries[];
  width: number;
  height: number;
  className?: string;
}

const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const dateLabelFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function xExtent(series: ChartSeries[]): { xMin: number; xMax: number } | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const s of series) {
    for (const pt of s.points) {
      if (pt.at < xMin) xMin = pt.at;
      if (pt.at > xMax) xMax = pt.at;
    }
  }
  return Number.isFinite(xMin) && Number.isFinite(xMax) ? { xMin, xMax } : null;
}

/**
 * Hand-rolled SVG price-history chart (SPEC §5.3, D13) — no chart
 * dependency. One `<path>` per outcome over a fixed 0–100% y-axis, grid
 * lines at 0/25/50/75/100%, x tick labels, and a final-point dot per
 * series (matching Kalshi's chart). Server-renderable; `className`
 * forwards through. `ProbabilityChartInteractive` layers the hover
 * crosshair on top of this same markup for client trees.
 */
export function ProbabilityChart({ series, width, height, className }: ProbabilityChartProps) {
  const extent = xExtent(series);
  const chartOpts = extent
    ? { width, height, yMin: 0, yMax: 1, xMin: extent.xMin, xMax: extent.xMax }
    : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Probability history"
      className={cn("overflow-visible", className)}
    >
      {GRID_FRACTIONS.map((f) => {
        const y = height * (1 - f);
        return (
          <g key={f}>
            <line
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={0}
              y={y - 2}
              fontSize={10}
              fill="var(--text-3)"
              className="tabular-nums"
            >
              {Math.round(f * 100)}%
            </text>
          </g>
        );
      })}

      {chartOpts
        ? [0, 1 / 3, 2 / 3, 1].map((f) => {
            const at = chartOpts.xMin + f * (chartOpts.xMax - chartOpts.xMin);
            const x = width * f;
            return (
              <text
                key={f}
                x={Math.min(Math.max(x, 0), width - 24)}
                y={height + 12}
                fontSize={10}
                fill="var(--text-3)"
              >
                {dateLabelFormat.format(new Date(at))}
              </text>
            );
          })
        : null}

      {chartOpts
        ? series.map((s) => {
            if (s.points.length === 0) return null;
            const d = buildLinePath(
              s.points.map((pt) => ({ x: pt.at, y: pt.p })),
              chartOpts,
            );
            const finalPoint = [...s.points].sort((a, b) => a.at - b.at)[s.points.length - 1]!;
            return (
              <g key={s.outcomeId}>
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={scale(finalPoint.at, chartOpts.xMin, chartOpts.xMax, 0, width)}
                  cy={scale(finalPoint.p, 0, 1, height, 0)}
                  r={3}
                  fill={s.color}
                  stroke="var(--surface-2)"
                  strokeWidth={1.5}
                />
              </g>
            );
          })
        : null}
    </svg>
  );
}
