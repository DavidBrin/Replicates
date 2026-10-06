"use client";

/**
 * One 3D rounded-cube die (SPEC §7.2): ~150 px per face, body `#E02030` lit /
 * `#B01525` shaded, cream `#F5F0E8` pips. Three of these sit on a white radial
 * burst in the Blitz view, and the same cube is thrown onto the board for a
 * manual roll.
 *
 * The three literal hexes are quoted by §7.2 and have no token in globals.css.
 */

import clsx from "clsx";

const LIT = "#E02030"; // §7.2 die body, lit face
const SHADE = "#B01525"; // §7.2 die body, shaded faces
const PIP = "#F5F0E8"; // §7.2 cream pips

/** Pip layout on a 100×100 face, by value. */
const PIPS: Record<number, readonly (readonly [number, number])[]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
};

export interface DiceCubeProps {
  /** The face value, 1–6. */
  readonly pips: number;
  /** Face size in stage pixels; ~150 in the Blitz view. */
  readonly size?: number;
  /** Degrees of lazy in-plane rotation, for the scattered look. */
  readonly rotate?: number;
  /** Tumble before settling (the manual-roll path). */
  readonly tumbling?: boolean;
  /** Stagger, in ms, for the three-dice throw. */
  readonly delayMs?: number;
  readonly className?: string;
  readonly testId?: string;
}

const KEYFRAMES = `
@keyframes risk-dice-tumble {
  0%   { transform: rotate3d(1,1,.4, 0deg)   scale(.7) }
  45%  { transform: rotate3d(1,1,.4, 520deg) scale(1.06) }
  80%  { transform: rotate3d(1,1,.4, 880deg) scale(.98) }
  100% { transform: rotate3d(1,1,.4, 900deg) scale(1) }
}
`;

export function DiceCube({
  pips, size = 150, rotate = 0, tumbling = false, delayMs = 0, className, testId,
}: DiceCubeProps) {
  const value = PIPS[pips] ? pips : 1;
  const dots = PIPS[value] ?? [];
  const depth = size * 0.17;
  const total = size + depth;

  return (
    <span
      data-testid={testId ?? "dice-cube"}
      data-pips={value}
      className={clsx("dice-cube", className)}
      style={{
        display: "inline-block",
        lineHeight: 0,
        transform: `rotate(${rotate}deg)`,
        animation: tumbling
          ? `risk-dice-tumble 900ms cubic-bezier(.2,.7,.3,1) ${delayMs}ms both`
          : undefined,
      }}
    >
      {tumbling ? <style>{KEYFRAMES}</style> : null}
      <svg
        width={total}
        height={total}
        viewBox={`0 0 ${100 + 17} ${100 + 17}`}
        role="img"
        aria-label={`Die showing ${value}`}
      >
        {/* the two shaded faces of the extruded cube */}
        <path
          d={`M8 ${17 + 4} L${8 + 9} 4 H${92 + 9} L${92} ${17 + 4} Z`}
          fill={SHADE}
          opacity=".95"
        />
        <path
          d={`M${92} ${17 + 4} L${92 + 9} 4 V${88} L${92} ${96} Z`}
          fill={SHADE}
        />
        {/* the lit front face */}
        <rect x="8" y={17 + 4} width="84" height="75" rx="14" fill={LIT} />
        <g fill={PIP}>
          {dots.map(([cx, cy], i) => (
            <circle key={i} cx={8 + (cx / 100) * 84} cy={21 + (cy / 100) * 75} r="7.4" />
          ))}
        </g>
      </svg>
    </span>
  );
}

export default DiceCube;
