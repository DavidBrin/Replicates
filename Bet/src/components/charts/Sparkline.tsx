import { buildAreaPath, buildLinePath } from "@/domain/chart";
import { cn } from "@/lib/cn";

export interface SparklinePoint {
  /** Epoch milliseconds. */
  at: number;
  /** Probability, 0..1. */
  p: number;
}

export interface SparklineProps {
  points: SparklinePoint[];
  /** Defaults to Bet's accent — a CSS variable reference, not a hex
   * literal, so it still redefines correctly under `[data-surface]`. */
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}

/** A tiny 60x20 inline price-history line for market cards (SPEC §5.1).
 * Server-renderable, no axes or interactivity — `ProbabilityChart` is the
 * full version. */
export function Sparkline({
  points,
  color = "var(--accent)",
  width = 60,
  height = 20,
  className,
}: SparklineProps) {
  if (points.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className={cn("overflow-visible", className)}
        aria-hidden="true"
      />
    );
  }

  const ys = points.map((p) => p.p);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const opts = { width, height, yMin, yMax };
  const pathPoints = points.map((p) => ({ x: p.at, y: p.p }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Price history"
      className={cn("overflow-visible", className)}
    >
      <path d={buildAreaPath(pathPoints, opts)} fill={color} fillOpacity={0.12} stroke="none" />
      <path
        d={buildLinePath(pathPoints, opts)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
