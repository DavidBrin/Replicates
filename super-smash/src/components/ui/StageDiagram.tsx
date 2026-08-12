import { cn } from "@/lib/cn";
import type { MenuStage, StageForm } from "@/lib/matchConfig";

/**
 * Ultimate's stage thumbnails are photographs, and a photograph of a stage
 * this project draws procedurally would be a photograph of something that does
 * not exist. A diagram of the actual `StageDef` geometry is both honest and
 * more useful: it is the platform layout you are about to play on, read
 * straight out of the data the simulation will use.
 */

const VIEW_W = 160;
const VIEW_H = 100;
/** Where the main platform's walking surface sits in the frame. */
const BASELINE = 70;

interface StageDiagramProps {
  stage: MenuStage;
  form: StageForm;
  className?: string;
  /** Muted for a thumbnail, saturated for the preview. */
  emphasis?: "thumb" | "preview";
  /**
   * `false` hides the diagram from assistive technology. Inside a button that
   * already names the stage, a described image only adds a second, longer
   * reading of the same thing to the button's accessible name.
   */
  labelled?: boolean;
}

export function StageDiagram({
  stage,
  form,
  className,
  emphasis = "thumb",
  labelled = true,
}: StageDiagramProps) {
  const platforms = stage.forms[form].platforms;
  if (platforms.length === 0) return null;

  /**
   * The frame is computed from the layout itself, not from an absolute scale.
   *
   * That is what lets one component draw a stage whether its geometry arrives
   * in plain units or as Q12 fixed-point integers — every number below is a
   * ratio of another number from the same definition, so a factor of 4096
   * applied to all of them cancels. Scaling to the blast zone instead would
   * render every stage as a speck in a mostly-empty rectangle; the blast-zone
   * figures are reported as text in the preview.
   */
  const halfSpan = Math.max(...platforms.map((p) => Math.abs(p.x) + p.halfWidth));
  const topY = Math.max(0, ...platforms.map((p) => p.y));
  const scaleX = (VIEW_W * 0.8) / (2 * halfSpan);
  const scaleY = topY > 0 ? (BASELINE - 14) / topY : scaleX;
  const scale = Math.min(scaleX, scaleY);

  const toX = (x: number) => VIEW_W / 2 + x * scale;
  const toY = (y: number) => BASELINE - y * scale;

  const main = platforms.reduce((best, p) => (p.halfWidth > best.halfWidth ? p : best), platforms[0]);
  const line = "var(--smash-yellow)";
  const slab = emphasis === "preview" ? "#1b1e24" : "#20242b";
  const softCount = platforms.filter((p) => p.soft).length;
  const gradientId = `sky-${stage.id}-${form}-${emphasis}`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={cn("block h-full w-full", className)}
      role={labelled ? "img" : undefined}
      aria-label={
        labelled ? `${stage.name} layout: ${softCount} soft platform${softCount === 1 ? "" : "s"}` : undefined
      }
      aria-hidden={labelled ? undefined : true}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b3550" />
          <stop offset="100%" stopColor="#131720" />
        </linearGradient>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${gradientId})`} />

      {/* The horizon marks the walking surface across the whole frame, so
          layouts of different widths can be compared at a glance. */}
      <line x1="0" y1={BASELINE} x2={VIEW_W} y2={BASELINE} stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />

      {platforms.map((p, i) => {
        const left = toX(p.x - p.halfWidth);
        const right = toX(p.x + p.halfWidth);
        const y = toY(p.y);
        const width = right - left;

        if (p.soft) {
          return (
            <g key={`soft-${i}`}>
              {p.motion ? (
                // The sweep track, drawn faintly: a moving platform changes how
                // a stage plays more than its resting position does.
                <line
                  x1={left - p.motion.amplitude * scale}
                  y1={y + 1.5}
                  x2={right + p.motion.amplitude * scale}
                  y2={y + 1.5}
                  stroke={line}
                  strokeOpacity={0.25}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              ) : null}
              <rect x={left} y={y} width={width} height={3.5} rx={1.5} fill={line} fillOpacity={0.85} />
            </g>
          );
        }

        return (
          <g key={`solid-${i}`}>
            <path
              d={`M ${left} ${y} H ${right} L ${right - 4} ${VIEW_H} H ${left + 4} Z`}
              fill={slab}
              stroke="var(--panel-ink)"
              strokeWidth={1.5}
            />
            <rect x={left} y={y - 1.5} width={width} height={3} fill={line} />
            {p.ledges ? (
              <>
                <circle cx={left + 1.5} cy={y + 4} r={2} fill={line} fillOpacity={0.7} />
                <circle cx={right - 1.5} cy={y + 4} r={2} fill={line} fillOpacity={0.7} />
              </>
            ) : null}
          </g>
        );
      })}

      {/* Spawn marks, so the diagram says where a match actually begins. */}
      {[-0.55, -0.2, 0.2, 0.55].map((t, i) => (
        <rect
          key={`spawn-${i}`}
          x={toX(main.x + main.halfWidth * t) - 1}
          y={toY(main.y) - 7}
          width={2}
          height={5}
          fill="#ffffff"
          fillOpacity={0.25}
        />
      ))}
    </svg>
  );
}
