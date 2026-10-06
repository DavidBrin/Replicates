"use client";

/**
 * The 1600×900 design space every measured dialog in SPEC §7.2 is quoted in.
 *
 * A dialog lays itself out at the exact pixel coordinates the spec measured,
 * inside an absolutely-positioned 1600×900 container that is uniformly scaled
 * to fit the viewport — so the geometry holds at any size and nothing is
 * stretched. Positions are expressed as percentages of that container (derived
 * from the measured pixels by `pctX` / `pctY`), sizes as plain numbers which
 * the single `scale()` carries.
 */

import type { CSSProperties, ReactNode } from "react";

export const STAGE_W = 1600;
export const STAGE_H = 900;

/**
 * The uniform fit scale, as a CSS expression — a **unitless number**, which
 * is the whole point.
 *
 * This used to read `min(100vw / 1600, 100vh / 900)`. A length divided by a
 * number is a *length*, `min()` of two lengths is a length, and
 * `scale(<length>)` is not valid CSS — so the browser threw the whole
 * `transform` away and **every measured §7.2 dialog rendered at its full
 * 1600×900 design size**, centred and clipped by the viewport. At 1280 px
 * only 160 px was lost off each side, so the centre-anchored controls still
 * worked and nobody noticed; at 412 px the stage sat at x −594 and the
 * outer third of the card fan, the close ✗ at x 75 and the whole bonus
 * legend at x 1320–1565 were off-screen at negative or overflowing `x`.
 *
 * `tan(atan2(a, b))` is the CSS idiom for a ratio of two lengths: `atan2`
 * takes lengths and yields an angle, and `tan` of that angle is the plain
 * number `a / b`. Both arguments are positive here, so the angle is in
 * (0°, 90°) and the identity holds exactly. The width term is capped by the
 * height term the same way `min()` did: `100vh × 16/9` is the width a
 * height-limited 16:9 stage would have.
 */
export const STAGE_SCALE =
  `tan(atan2(min(100vw, 100vh * ${STAGE_W / STAGE_H}), ${STAGE_W}px))`;

/** A measured x in stage pixels, as a percentage of the stage width. */
export function pctX(x: number): string {
  return `${(x / STAGE_W) * 100}%`;
}

/** A measured y in stage pixels, as a percentage of the stage height. */
export function pctY(y: number): string {
  return `${(y / STAGE_H) * 100}%`;
}

/** Absolutely position an element's CENTRE at a measured point. */
export function at(x: number, y: number): CSSProperties {
  return { position: "absolute", left: pctX(x), top: pctY(y), transform: "translate(-50%, -50%)" };
}

/** Absolutely position an element's TOP-LEFT at a measured point. */
export function atTopLeft(x: number, y: number): CSSProperties {
  return { position: "absolute", left: pctX(x), top: pctY(y) };
}

/** A box with a measured centre and a measured size. */
export function box(x: number, y: number, w: number, h: number): CSSProperties {
  return { ...at(x, y), width: w, height: h };
}

export interface StageProps {
  readonly children: ReactNode;
  /** The full-bleed backdrop behind the stage. Defaults to the heavy scrim. */
  readonly scrim?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
  readonly label: string;
  readonly onBackdropClick?: () => void;
  /** Layer: `--z-modal` by default; banners sit on `--z-banner`. */
  readonly z?: string;
}

/**
 * A full-screen modal layer carrying one scaled 1600×900 stage.
 *
 * The scrim is full-bleed (it must reach the viewport edges at any aspect
 * ratio); the stage inside it is letterboxed so the measured geometry is never
 * distorted.
 */
export function Stage({
  children,
  scrim = "var(--scrim-heavy)",
  className,
  style,
  testId,
  label,
  onBackdropClick,
  z = "var(--z-modal)",
}: StageProps) {
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: z as unknown as number,
        background: scrim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...style,
      }}
      onClick={onBackdropClick}
    >
      <div
        style={{
          position: "relative",
          width: STAGE_W,
          height: STAGE_H,
          flex: "0 0 auto",
          transform: `scale(${STAGE_SCALE})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The signature outlined on-board type (globals.css `.on-board-text`). */
export function outlined(px: number, weight = 900): CSSProperties {
  return {
    fontFamily: "var(--font-head), system-ui, sans-serif",
    fontWeight: weight,
    fontSize: px,
    color: "var(--text)",
    paintOrder: "stroke fill",
    WebkitTextStroke: `${Math.max(3, Math.round(px / 14))}px var(--stroke-dark)`,
    textShadow: "0 2px 3px rgba(0,0,0,.55)",
    whiteSpace: "nowrap",
  } as CSSProperties;
}
