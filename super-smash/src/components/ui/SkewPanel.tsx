import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The lean. Roughly twelve degrees, measured off Ultimate's menus.
 *
 * Rectangles are the single most common way a Smash homage goes wrong: the
 * colours can be sampled perfectly and the whole thing still reads as a web
 * page because the panels have right angles. Every panel, tab, banner and
 * button in this app goes through here.
 */
export const SHEAR_DEG = 12;

/**
 * Why a nested counter-skew rather than `clip-path: polygon(...)`.
 *
 * Both draw a parallelogram. Only the skew keeps a *border* — clip-path cuts
 * the border off at the diagonal edges, and the black rules around Ultimate's
 * panels are half of what makes them look printed rather than drawn. The cost
 * is one extra element per panel, and content that must be un-skewed so the
 * type inside stays upright: Ultimate slants the panel, never the words.
 */
function shear(angle: number): CSSProperties {
  return { transform: `skewX(${-angle}deg)` };
}

function unshear(angle: number): CSSProperties {
  return { transform: `skewX(${angle}deg)` };
}

interface ShearedProps {
  /** Degrees of lean. Negative leans the other way, for a matched pair. */
  angle?: number;
  /** Applied to the un-skewed content wrapper, which is where padding wants to go. */
  innerClassName?: string;
  children?: ReactNode;
}

export function SkewPanel({
  angle = SHEAR_DEG,
  className,
  innerClassName,
  style,
  children,
  ...rest
}: ShearedProps & ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("relative", className)} style={{ ...shear(angle), ...style }} {...rest}>
      <div className={cn("h-full w-full", innerClassName)} style={unshear(angle)}>
        {children}
      </div>
    </div>
  );
}

export function SkewButton({
  angle = SHEAR_DEG,
  className,
  innerClassName,
  style,
  children,
  type = "button",
  ...rest
}: ShearedProps & ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "relative transition-transform duration-150 disabled:cursor-not-allowed",
        className,
      )}
      style={{ ...shear(angle), ...style }}
      {...rest}
    >
      <span className={cn("flex h-full w-full items-center justify-center", innerClassName)} style={unshear(angle)}>
        {children}
      </span>
    </button>
  );
}

/**
 * A sheared card whose contents stay sheared.
 *
 * `SkewPanel` un-skews everything inside it, which is right for a panel that
 * holds a paragraph and wrong for one built from full-width bars: an un-skewed
 * bar is a rectangle, and a rectangle inside a parallelogram sticks out of both
 * sloping edges. The player panels and the results plates are stacks of bars,
 * so here the bars lean with the card — as they do in the game — and only the
 * words inside them are straightened, by `Unskew`.
 *
 * Clipping is on by default for the same reason: a bar that runs the full
 * width has to be cut off by the card's edges to end on the slope.
 */
export function SkewCard({
  angle = SHEAR_DEG,
  className,
  style,
  children,
  ...rest
}: { angle?: number; children?: ReactNode } & ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ ...shear(angle), ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Straightens the type inside a `SkewCard`. Ultimate slants plates, not words. */
export function Unskew({
  angle = SHEAR_DEG,
  className,
  style,
  children,
  ...rest
}: { angle?: number; children?: ReactNode } & ComponentPropsWithoutRef<"span">) {
  return (
    <span className={cn("inline-block", className)} style={{ ...unshear(angle), ...style }} {...rest}>
      {children}
    </span>
  );
}

/**
 * Art inside a `SkewCard`: counter-skewed so the drawing is not distorted, and
 * scaled up so the corners the counter-skew leaves empty are covered. The
 * card's own clip does the rest, which is how the portrait ends up masked into
 * a parallelogram rather than squashed into one.
 */
export function SkewArtWell({
  angle = SHEAR_DEG,
  className,
  children,
}: {
  angle?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className="absolute inset-0"
        style={{ transform: `skewX(${angle}deg) scale(1.35)`, transformOrigin: "center" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A sheared strip that only ever holds text — the tab labels, the port tags on
 * the player panels, the series line under a stage name.
 */
export function SkewTag({
  angle = SHEAR_DEG,
  className,
  innerClassName,
  style,
  children,
  ...rest
}: ShearedProps & ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn("inline-block", className)}
      style={{ ...shear(angle), ...style }}
      {...rest}
    >
      <span className={cn("inline-block", innerClassName)} style={unshear(angle)}>
        {children}
      </span>
    </span>
  );
}
