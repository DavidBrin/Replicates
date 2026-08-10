"use client";

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { scale } from "@/domain/chart";
import { formatProbability } from "@/domain/formatters";
import { cn } from "@/lib/cn";
import { ProbabilityChart } from "./ProbabilityChart";
import type { ProbabilityChartProps } from "./ProbabilityChart";

/**
 * Thin client wrapper around `ProbabilityChart` (SPEC §5.3: "interactivity
 * is a thin client wrapper") that adds a hover crosshair with a value
 * readout. The base chart stays server-renderable; only this layer needs a
 * client boundary, for pointer state.
 */
export function ProbabilityChartInteractive({
  series,
  width,
  height,
  className,
}: ProbabilityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const reference = series.find((s) => s.points.length > 0);
  const sortedReference = reference ? [...reference.points].sort((a, b) => a.at - b.at) : [];

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!containerRef.current || sortedReference.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const xMin = sortedReference[0]!.at;
    const xMax = sortedReference[sortedReference.length - 1]!.at;
    const t = rect.width === 0 ? 0 : px / rect.width;
    const value = xMin + t * (xMax - xMin);

    let nearest = 0;
    let nearestDist = Infinity;
    sortedReference.forEach((pt, i) => {
      const dist = Math.abs(pt.at - value);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  }

  function onPointerLeave() {
    setHoverIndex(null);
  }

  const hoverAt = hoverIndex !== null ? sortedReference[hoverIndex]?.at : undefined;
  const xMin = sortedReference[0]?.at;
  const xMax = sortedReference[sortedReference.length - 1]?.at;
  const crosshairX =
    hoverAt !== undefined && xMin !== undefined && xMax !== undefined
      ? scale(hoverAt, xMin, xMax, 0, width)
      : null;

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      style={{ width, height }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <ProbabilityChart series={series} width={width} height={height} />
      {crosshairX !== null ? (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-(--border-2)"
            style={{ left: crosshairX }}
          />
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-(--radius-input) border border-(--border) bg-(--surface-3) px-2 py-1 text-xs whitespace-nowrap text-(--text-1) shadow-lg"
            style={{ left: Math.min(Math.max(crosshairX, 40), width - 40) }}
          >
            {series
              .filter((s) => s.points.length > 0)
              .map((s) => {
                const pt = [...s.points].sort((a, b) => a.at - b.at)[hoverIndex ?? 0];
                if (!pt) return null;
                return (
                  <div key={s.outcomeId} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-(--text-2)">{s.label}</span>
                    <span className="tabular-nums">{formatProbability(pt.p)}</span>
                  </div>
                );
              })}
          </div>
        </>
      ) : null}
    </div>
  );
}
