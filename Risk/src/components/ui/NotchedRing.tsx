"use client";

/**
 * The signature widget (SPEC §7.2): a thick red ring with a **downward
 * triangular notch cut into the bottom**, the value inside in white with a
 * 4 px dark outline.
 *
 * Three call sites, three geometries, one component:
 *  - the count slider's selected value — outer r ≈ 55, stroke ≈ 16;
 *  - the `Received Troops` popup — r 62, stroke 14, with a `Total troops`
 *    caption beneath;
 *  - the card-bonus legend's selection ring around the matching row.
 *
 * The notch is a real cut, not a gap in a dash array: a mask with a white
 * field and a black triangle, so the ring's inner and outer edges both close
 * cleanly around it at any stroke width.
 */
import { useId } from "react";
import clsx from "clsx";

export interface NotchedRingProps {
  /** What sits inside the ring. A number in every SPEC call site. */
  readonly value: string | number;
  /** Outer radius in px (§7.2: 55 in the slider, 62 in Received Troops). */
  readonly radius?: number;
  /** Ring thickness in px (§7.2: 16 in the slider, 14 in Received Troops). */
  readonly stroke?: number;
  /** Optional caption beneath the ring — `Total troops` in Received Troops. */
  readonly label?: string;
  /** Ring colour; the `--danger` family by default. */
  readonly colour?: string;
  readonly testId?: string;
  readonly className?: string;
}

export function NotchedRing({
  value,
  radius = 55,
  stroke = 16,
  label,
  colour = "var(--danger)",
  testId,
  className,
}: NotchedRingProps) {
  const maskId = `notch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const pad = 2;
  const box = (radius + stroke / 2 + pad) * 2;
  const c = box / 2;
  // The notch: a triangle pointing UP into the ring from the bottom edge.
  const half = Math.max(8, radius * 0.26);
  const bottom = c + radius + stroke / 2 + pad;
  const apex = c + radius - stroke / 2 - pad;
  const notch = `${c - half},${bottom} ${c + half},${bottom} ${c},${apex}`;

  return (
    <div
      data-testid={testId ?? "notched-ring"}
      data-value={String(value)}
      className={clsx("inline-flex flex-col items-center", className)}
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden focusable="false">
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x={0} y={0} width={box} height={box} fill="#fff" />
          <polygon data-testid="notched-ring-notch" points={notch} fill="#000" />
        </mask>
        <circle
          data-testid="notched-ring-track"
          cx={c}
          cy={c}
          r={radius - stroke / 2}
          fill="none"
          stroke={colour}
          strokeWidth={stroke}
          mask={`url(#${maskId})`}
        />
        <text
          data-testid="notched-ring-value"
          x={c}
          y={c}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--text)"
          stroke="var(--stroke-dark)"
          strokeWidth={4}
          paintOrder="stroke"
          strokeLinejoin="round"
          fontFamily="var(--font-head)"
          fontWeight={900}
          fontSize={Math.round(radius * 1.05)}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </text>
      </svg>
      {label ? (
        <span
          data-testid="notched-ring-label"
          className="mt-1 font-body text-[clamp(14px,2vw,24px)]"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

export default NotchedRing;
