import { cn } from "@/lib/cn";
import { portColour, portTag } from "@/lib/matchConfig";
import { SHEAR_DEG } from "./SkewPanel";

/**
 * The white hand.
 *
 * Ultimate's character select is navigated by a cartoon glove per port, and
 * the port tag is printed on the back of the hand rather than floating beside
 * it — that is what makes four cursors on one screen legible at a glance.
 *
 * The outline is drawn by the stroke-then-fill trick: the same five shapes are
 * painted twice, first with a fat ink stroke and then filled flat white on
 * top. SVG has no boolean union, and this is how you get one clean silhouette
 * out of overlapping primitives without hand-authoring a single path that
 * would then be impossible to adjust.
 */
export function Cursor({
  port,
  className,
  bob = true,
  showTag = true,
}: {
  port: number;
  className?: string;
  bob?: boolean;
  showTag?: boolean;
}) {
  const colour = portColour(port);

  return (
    <svg
      viewBox="0 0 62 86"
      className={cn("h-full w-full drop-shadow-[0_4px_0_rgb(0_0_0/0.45)]", bob && "anim-cursor-bob", className)}
      role="img"
      aria-label={`${portTag(port)} cursor`}
    >
      <g stroke="var(--panel-ink)" strokeWidth={8} strokeLinejoin="round" fill="#ffffff">
        <HandShapes />
      </g>
      <g fill="#ffffff" stroke="none">
        <HandShapes />
      </g>
      {showTag ? (
        <text
          x="31"
          y="66"
          textAnchor="middle"
          fill={colour}
          stroke="var(--panel-ink)"
          strokeWidth={1.4}
          paintOrder="stroke"
          style={{
            fontFamily: "var(--font-display, sans-serif)",
            fontSize: "20px",
            letterSpacing: "0.02em",
            transform: `skewX(${SHEAR_DEG}deg)`,
            transformOrigin: "31px 60px",
          }}
        >
          {portTag(port)}
        </text>
      ) : null}
    </svg>
  );
}

function HandShapes() {
  return (
    <>
      {/* index finger, extended */}
      <rect x="13" y="6" width="14" height="42" rx="7" />
      {/* palm */}
      <rect x="10" y="34" width="42" height="44" rx="14" />
      {/* thumb, cocked out to the left */}
      <rect x="1" y="42" width="12" height="26" rx="6" transform="rotate(-14 7 55)" />
      {/* two curled knuckles */}
      <rect x="27" y="30" width="13" height="22" rx="6.5" />
      <rect x="38" y="35" width="12" height="18" rx="6" />
    </>
  );
}

/**
 * The lighter cursor that rides the portrait grid: the same hand, no tag,
 * scaled down and tinted to the port that is currently choosing.
 */
export function GridCursor({ port, className }: { port: number; className?: string }) {
  return (
    <span
      className={cn("pointer-events-none absolute -top-3 -left-4 block h-16 w-12", className)}
      style={{ filter: `drop-shadow(0 0 6px ${portColour(port)})` }}
      aria-hidden
    >
      <Cursor port={port} bob showTag={false} />
    </span>
  );
}
