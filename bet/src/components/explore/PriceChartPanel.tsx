"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartSeries } from "@/components/charts/ProbabilityChart";
import { ProbabilityChartInteractive } from "@/components/charts/ProbabilityChartInteractive";
import { cn } from "@/lib/cn";

const TIMEFRAMES = [
  { id: "1D", label: "1D", days: 1 },
  { id: "1W", label: "1W", days: 7 },
  { id: "1M", label: "1M", days: 30 },
  { id: "ALL", label: "ALL", days: null },
] as const;

type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export interface PriceChartPanelProps {
  series: ChartSeries[];
  height?: number;
}

const DEFAULT_WIDTH = 720;

/**
 * `/explore/[id]`'s price history panel (SPEC §3.6): `ProbabilityChart`
 * (`@/components/charts`) over the 90-day series with 1D/1W/1M/ALL toggles
 * that actually filter the plotted points, not just relabel the same chart.
 * Client component: it owns the active-timeframe state and (via
 * `ResizeObserver`) measures its own container so the hand-rolled SVG chart
 * — which needs an explicit pixel width, per Task 8's `ProbabilityChart`
 * API — stays fluid across 390/768/1440px instead of a fixed size.
 */
export function PriceChartPanel({ series, height = 260 }: PriceChartPanelProps) {
  const [timeframe, setTimeframe] = useState<TimeframeId>("ALL");
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setWidth(Math.max(280, Math.floor(measured)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const latestAt = useMemo(() => {
    // Falls back to 0 (not `Date.now()` — impure, and disallowed during
    // render/memo by this project's react-hooks lint rules) for an empty
    // series; the fallback value is never actually used for filtering in
    // that case since there are no points left to filter either way.
    let max = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.at > max) max = p.at;
      }
    }
    return Number.isFinite(max) ? max : 0;
  }, [series]);

  const activeDays = TIMEFRAMES.find((tf) => tf.id === timeframe)?.days ?? null;
  const filteredSeries = useMemo(() => {
    if (activeDays === null) return series;
    const cutoff = latestAt - activeDays * 86_400_000;
    return series.map((s) => ({ ...s, points: s.points.filter((p) => p.at >= cutoff) }));
  }, [series, activeDays, latestAt]);

  return (
    <div>
      <div role="tablist" aria-label="Timeframe" className="mb-2 flex items-center justify-end gap-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.id}
            type="button"
            role="tab"
            aria-selected={timeframe === tf.id}
            onClick={() => setTimeframe(tf.id)}
            className={cn(
              "rounded-(--radius-pill) px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-1)",
              timeframe === tf.id ? "bg-(--accent)/15 text-(--accent)" : "text-(--text-3) hover:text-(--text-1)",
            )}
          >
            {tf.label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="w-full overflow-x-auto">
        <ProbabilityChartInteractive series={filteredSeries} width={width} height={height} />
      </div>
    </div>
  );
}
