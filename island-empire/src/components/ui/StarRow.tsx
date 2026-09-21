import clsx from "clsx";

/**
 * Up to `max` stars, `count` of them lit gold — a level's stars on the
 * overworld and the intro screen (one per difficulty beaten, D27).
 */
export interface StarRowProps {
  count: number;
  max?: number;
  /** Pixel size of one star. */
  size?: number;
  className?: string;
  /** Pop-in animation for freshly earned stars. */
  animate?: boolean;
}

export function Star({ lit, size = 20, delay = 0, animate = false }: { lit: boolean; size?: number; delay?: number; animate?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={clsx(animate && lit && "ie-pop")}
      style={{ animationDelay: `${delay}ms`, display: "block" }}
      shapeRendering="crispEdges"
    >
      <polygon
        points="10,1 12.6,7 19,7.6 14.2,12 15.7,18.6 10,15.2 4.3,18.6 5.8,12 1,7.6 7.4,7"
        fill={lit ? "var(--ie-gold, #FED942)" : "var(--ie-grey, #595959)"}
        stroke="var(--ie-ink, #1A1010)"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {lit && <rect x={8} y={5} width={2} height={2} fill="#fff" opacity={0.9} />}
    </svg>
  );
}

export function StarRow({ count, max = 3, size = 20, className, animate = false }: StarRowProps) {
  const lit = Math.max(0, Math.min(max, Math.floor(count)));
  return (
    <div
      className={clsx("inline-flex items-center gap-0.5", className)}
      role="img"
      aria-label={`${lit} of ${max} stars`}
      data-testid="star-row"
      data-stars={lit}
    >
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} lit={i < lit} size={size} delay={i * 150} animate={animate} />
      ))}
    </div>
  );
}

export default StarRow;
