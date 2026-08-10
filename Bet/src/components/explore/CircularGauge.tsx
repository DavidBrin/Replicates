import { formatProbability } from "@/domain/formatters";
import { cn } from "@/lib/cn";

export interface CircularGaugeProps {
  /** Probability, 0..1. */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Polymarket's signature "21% chance" ring (research/polymarket.md §2.2,
 * §5.4: an SVG circular progress indicator, percentage-of-circumference
 * `stroke-dasharray`, track colored neutral, progress arc colored brand).
 * Arc starts at 12 o'clock and sweeps clockwise — the standard gauge
 * convention this task's brief calls out getting right: an SVG circle's
 * natural start point is 3 o'clock, so the whole `<circle>` is rotated -90°
 * around its own center first, then the *unfilled* remainder of the stroke
 * is pushed off via `strokeDashoffset` (dasharray = full circumference,
 * dashoffset = circumference * (1 - value)) so the drawn arc length is
 * exactly `value` of the circle, starting at the top.
 */
export function CircularGauge({ value, size = 64, strokeWidth = 6, className }: CircularGaugeProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - clamped);
  const center = size / 2;

  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${formatProbability(clamped)} chance`}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular-nums text-[15px] font-semibold text-(--accent)" aria-hidden="true">
          {formatProbability(clamped)}
        </span>
      </span>
    </span>
  );
}
