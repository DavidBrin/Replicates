"use client";

/**
 * The continent-bonus legend (SPEC §7.2), one badge per continent at its
 * centroid: a radial donut progress ring outer r ≈ 36 / thickness ≈ 7, a dark
 * track, a white arc **from 12 o'clock clockwise**, `+N` inside at 30 px, a
 * dark name plate below and a `3/9 (33%)` caption.
 *
 * It is an absolutely-positioned overlay INSIDE the board wrapper, so it takes
 * raw map coordinates and lets the parent's camera transform carry it (§8, the
 * coordinate contract). Each badge applies the same counter `rotateX(-θ)` and
 * `scale(1/zoom)` the troop tokens do, reading the two variables the camera
 * writes on the wrapper once per frame — so it stays upright and screen-sized
 * while its anchor pans and zooms with the land under it. `origin` is the
 * map's `viewBox` origin, subtracted exactly as the token layer does.
 */

import clsx from "clsx";

export interface ContinentLegendEntry {
  readonly name: string;
  readonly bonus: number;
  readonly held: number;
  readonly total: number;
  /** The continent's centroid, in map units. */
  readonly at: { readonly x: number; readonly y: number };
  /** The continent accent, e.g. `continentVar(index)`. */
  readonly colour: string;
}

export interface ContinentLegendProps {
  readonly entries: readonly ContinentLegendEntry[];
  readonly className?: string;
  /** The map's `viewBox` origin; `[0, 0]` when the legend is not inside a board wrapper. */
  readonly origin?: readonly [number, number];
}

const OUTER = 36;
const THICK = 7;
const R = OUTER - THICK / 2;
const C = 2 * Math.PI * R;

export function ContinentLegend({ entries, className, origin = [0, 0] }: ContinentLegendProps) {
  return (
    <div
      data-testid="continent-legend"
      className={clsx("continent-legend", className)}
      style={{ position: "absolute", inset: 0, pointerEvents: "none",
        zIndex: "var(--z-labels)" as unknown as number }}
    >
      {entries.map((entry) => {
        const pct = entry.total > 0 ? Math.round((entry.held / entry.total) * 100) : 0;
        const dash = (pct / 100) * C;
        return (
          <div
            key={entry.name}
            data-testid={`continent-legend-${entry.name}`}
            style={{
              position: "absolute",
              left: entry.at.x - origin[0],
              top: entry.at.y - origin[1],
              width: 0,
              height: 0,
              // The token layer's counter-transform, verbatim (render/tokens.ts).
              transform: "rotateX(calc(-1 * var(--tilt, 0deg))) scale(calc(1 / var(--zoom, 1)))",
              transformStyle: "preserve-3d",
            }}
          >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <svg width={OUTER * 2} height={OUTER * 2} viewBox={`0 0 ${OUTER * 2} ${OUTER * 2}`}
              aria-hidden>
              <circle cx={OUTER} cy={OUTER} r={R} fill="rgba(0,0,0,.72)" />
              <circle
                cx={OUTER} cy={OUTER} r={R} fill="none"
                stroke="rgba(0,0,0,.55)" strokeWidth={THICK}
              />
              <circle
                data-testid="continent-arc"
                data-percent={pct}
                cx={OUTER} cy={OUTER} r={R} fill="none"
                stroke="var(--text)" strokeWidth={THICK} strokeLinecap="butt"
                strokeDasharray={`${dash} ${C - dash}`}
                /* from 12 o'clock, clockwise */
                transform={`rotate(-90 ${OUTER} ${OUTER})`}
              />
              <text
                x={OUTER} y={OUTER} textAnchor="middle" dominantBaseline="central"
                fill="var(--text)" fontFamily="var(--font-head)" fontWeight={900} fontSize={30}
                stroke="var(--stroke-dark)" strokeWidth={3} paintOrder="stroke"
                strokeLinejoin="round"
              >
                +{entry.bonus}
              </text>
            </svg>
            <span
              style={{
                marginTop: -6,
                borderRadius: 8,
                border: `2px solid ${entry.colour}`,
                background: "rgba(8,14,18,.88)",
                padding: "4px 14px",
                fontFamily: "var(--font-head), system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 22,
                color: "var(--text)",
                whiteSpace: "nowrap",
              }}
            >
              {entry.name}
            </span>
            <span
              data-testid={`continent-caption-${entry.name}`}
              style={{ fontFamily: "var(--font-body), system-ui, sans-serif", fontSize: 16,
                color: "var(--text-muted)", whiteSpace: "nowrap" }}
            >
              {entry.held}/{entry.total} ({pct}%)
            </span>
          </div>
          </div>
        );
      })}
    </div>
  );
}

export default ContinentLegend;
