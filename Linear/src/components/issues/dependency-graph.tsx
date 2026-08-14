"use client";

/**
 * The DAG canvas: blockers on the left, arrows pointing at what they block.
 *
 * ## The layout is not computed here
 *
 * Positions arrive as props, already worked out on the server by
 * `domain/services/graph-layout.ts`. Two reasons. The layout is the expensive
 * part and the part worth testing, and neither is helped by living inside a
 * component — on the server it costs the user nothing and it is asserted
 * against directly. And a client that laid out its own graph would draw
 * *something* on first paint and then jump when the real positions arrived,
 * which on a page whose whole point is spatial is worse than waiting.
 *
 * What is left here is genuinely interactive: pan, zoom, and the hover
 * highlight.
 *
 * ## SVG for the edges, HTML for the cards
 *
 * The same split React Flow makes, for the same reason. Edges want stroke
 * markers and sub-pixel geometry; cards want the type scale, the truncation and
 * the hover treatment that every other issue surface in this app already has,
 * and re-implementing those in `<text>` would be a second visual vocabulary to
 * keep in step. So the cards are absolutely positioned anchors over an SVG that
 * draws only lines.
 *
 * ## Every card is a real link
 *
 * `<a href>`, exactly as `view-tabs.tsx` argues: middle-click, ⌘-click, "copy
 * link address" and the back button all have to work. A `<div onClick>` that
 * calls `router.push` looks identical and quietly breaks all four.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  DEPENDENCY_GRAPH_CONFIG,
  type DependencyGraphConfig,
} from "@/config/dependency-graph";
import type { Priority, StateType } from "@/domain/entities";
import {
  connectedPaths,
  type BlockingEdge,
} from "@/domain/services/dependency-graph";
import type { GraphLayout } from "@/domain/services/graph-layout";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";

/** What a card needs. A deliberately smaller shape than `IssueWithRelations`. */
export interface GraphIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly teamKey: string;
  readonly stateName: string;
  readonly stateType: StateType;
  readonly stateColor: string;
  readonly priority: Priority;
  readonly assigneeName: string | null;
  readonly assigneeAvatarColor: string | null;
  readonly assigneeAvatarUrl: string | null;
}

export interface DependencyGraphProps {
  readonly issues: readonly GraphIssue[];
  readonly edges: readonly BlockingEdge[];
  readonly layout: GraphLayout;
  /** Issues that block each other in a loop. Rendered as a warning. */
  readonly cycles: readonly (readonly string[])[];
  /** `/{workspace}/issue` — each card appends its own identifier. */
  readonly issueBasePath: string;
  /** The team this graph is *about*; other teams' issues are marked. */
  readonly teamKey: string;
  readonly config?: DependencyGraphConfig;
}

const ARROW_ID = "dependency-arrow";
const ARROW_CYCLE_ID = "dependency-arrow-cycle";

export function DependencyGraph({
  issues,
  edges,
  layout,
  cycles,
  issueBasePath,
  teamKey,
  config = DEPENDENCY_GRAPH_CONFIG,
}: DependencyGraphProps) {
  const [zoom, setZoom] = useState(1);
  const [active, setActive] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(
    () => new Map(issues.map((issue) => [issue.id, issue])),
    [issues],
  );
  const positions = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout],
  );
  const inACycle = useMemo(
    () => new Set(cycles.flat()),
    [cycles],
  );

  /**
   * The chain through the hovered issue.
   *
   * Recomputed only when the hover moves, and `null` the rest of the time so
   * that a graph nobody is pointing at does no work and renders at full
   * contrast.
   */
  const highlight = useMemo(() => {
    if (active === null) return null;
    const { upstream, downstream } = connectedPaths(edges, active);
    return new Set([active, ...upstream, ...downstream]);
  }, [active, edges]);

  const dimmed = useCallback(
    (id: string): boolean => highlight !== null && !highlight.has(id),
    [highlight],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      setZoom((current) =>
        Math.min(
          config.maxZoom,
          Math.max(config.minZoom, Number((current + delta).toFixed(2))),
        ),
      );
    },
    [config.maxZoom, config.minZoom],
  );

  /**
   * Drag to pan, by moving the scroll position rather than a transform.
   *
   * Keeping the pan in `scrollLeft`/`scrollTop` means the scrollbars stay
   * truthful, the keyboard can still scroll the region, and a card that is
   * tabbed to scrolls itself into view for free. A transform-based pan has to
   * reimplement all three.
   */
  const startPan = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Only a drag on the background pans. A drag that starts on a card is the
    // browser's text selection or link drag, and stealing it is worse than not
    // having the gesture.
    if (event.target !== event.currentTarget) return;
    const element = viewport.current;
    if (!element) return;

    const originX = event.clientX;
    const originY = event.clientY;
    const scrollX = element.scrollLeft;
    const scrollY = element.scrollTop;
    element.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent): void => {
      element.scrollLeft = scrollX - (moved.clientX - originX);
      element.scrollTop = scrollY - (moved.clientY - originY);
    };
    const stop = (): void => {
      element.releasePointerCapture(event.pointerId);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="dependency-graph">
      {cycles.length > 0 && (
        <CycleWarning cycles={cycles} byId={byId} basePath={issueBasePath} />
      )}

      <div
        ref={viewport}
        onPointerDown={startPan}
        data-testid="graph-viewport"
        className="relative min-h-0 flex-1 cursor-grab overflow-auto active:cursor-grabbing"
        style={{ minHeight: config.minViewportHeight }}
      >
        <div
          className="relative origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `scale(${zoom})`,
          }}
        >
          <svg
            width={layout.width}
            height={layout.height}
            className="absolute inset-0 overflow-visible"
            aria-hidden
          >
            <defs>
              <Arrowhead id={ARROW_ID} color="var(--border-strong)" />
              <Arrowhead id={ARROW_CYCLE_ID} color="var(--danger)" />
            </defs>
            {layout.edges.map((edge) => {
              const faded = dimmed(edge.from) && dimmed(edge.to);
              return (
                <polyline
                  key={`${edge.from}->${edge.to}`}
                  data-testid="graph-edge"
                  data-reversed={edge.reversed ? "" : undefined}
                  points={edge.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={
                    edge.reversed ? "var(--danger)" : "var(--border-strong)"
                  }
                  strokeWidth={edge.reversed ? 2 : 1.5}
                  // A reversed edge is drawn dashed as well as red. Colour
                  // alone would carry the whole meaning, and roughly one in
                  // twelve men cannot read it.
                  strokeDasharray={edge.reversed ? "5 4" : undefined}
                  markerEnd={`url(#${edge.reversed ? ARROW_CYCLE_ID : ARROW_ID})`}
                  opacity={faded ? 0.15 : 1}
                  className="[transition:opacity_var(--speed-quick)_var(--ease-quad)]"
                />
              );
            })}
          </svg>

          {layout.nodes.map((node) => {
            const issue = byId.get(node.id);
            const position = positions.get(node.id);
            if (!issue || !position) return null;
            return (
              <IssueNode
                key={node.id}
                issue={issue}
                x={position.x}
                y={position.y}
                width={position.width}
                height={position.height}
                foreign={issue.teamKey !== teamKey}
                cyclic={inACycle.has(issue.id)}
                dimmed={dimmed(issue.id)}
                href={`${issueBasePath}/${issue.identifier}`}
                onActivate={setActive}
              />
            );
          })}
        </div>
      </div>

      <ZoomControls
        zoom={zoom}
        config={config}
        onZoom={zoomBy}
        onReset={() => setZoom(1)}
      />
    </div>
  );
}

/* ================================================================= parts = */

function Arrowhead({ id, color }: { readonly id: string; readonly color: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  );
}

interface IssueNodeProps {
  readonly issue: GraphIssue;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly foreign: boolean;
  readonly cyclic: boolean;
  readonly dimmed: boolean;
  readonly href: string;
  readonly onActivate: (id: string | null) => void;
}

function IssueNode({
  issue,
  x,
  y,
  width,
  height,
  foreign,
  cyclic,
  dimmed,
  href,
  onActivate,
}: IssueNodeProps) {
  return (
    <a
      href={href}
      data-testid={`graph-node-${issue.identifier}`}
      // `board-card.tsx` carries the same attribute for the same reason: the
      // identifier is what a human recognises, the id is what an API call
      // needs, and a surface that shows issues should expose both.
      data-issue-id={issue.id}
      data-foreign={foreign ? "" : undefined}
      data-cyclic={cyclic ? "" : undefined}
      // Focus highlights the same chain hover does, so the keyboard gets the
      // feature rather than a version of the page with the feature missing.
      onMouseEnter={() => onActivate(issue.id)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(issue.id)}
      onBlur={() => onActivate(null)}
      style={{ left: x, top: y, width, height }}
      className={cn(
        "absolute flex flex-col justify-center gap-1 rounded-[var(--radius-lg)] border px-3",
        "bg-[var(--bg-elevated)] no-underline outline-none",
        "[transition:opacity_var(--speed-quick)_var(--ease-quad),border-color_var(--speed-quick)_var(--ease-quad)]",
        cyclic ? "border-[var(--danger)]" : "border-subtle hover:border-default",
        "focus-visible:[box-shadow:0_0_0_2px_var(--border-focus)]",
        // A dimmed card is still readable and still clickable — this is a
        // contrast cue, not a filter. Hiding the rest of the graph on hover
        // would make the pointer destroy the context it is being used to
        // explore.
        dimmed ? "opacity-30" : "opacity-100",
      )}
    >
      <div className="flex items-center gap-1.5 text-mini text-tertiary">
        <StatusIcon
          type={issue.stateType}
          color={issue.stateColor}
          label={issue.stateName}
          size={12}
        />
        <span className="tabular-nums">{issue.identifier}</span>
        {foreign && (
          <span
            className="rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-1"
            title={`In team ${issue.teamKey}`}
          >
            {issue.teamKey}
          </span>
        )}
        <span className="flex-1" />
        <PriorityIcon priority={issue.priority} size={12} muted decorative />
        {issue.assigneeName !== null && (
          <Avatar
            id={issue.id}
            name={issue.assigneeName}
            src={issue.assigneeAvatarUrl}
            color={issue.assigneeAvatarColor}
            size={16}
            decorative
          />
        )}
      </div>
      <span className="truncate text-small text-primary">{issue.title}</span>
    </a>
  );
}

function CycleWarning({
  cycles,
  byId,
  basePath,
}: {
  readonly cycles: readonly (readonly string[])[];
  readonly byId: ReadonlyMap<string, GraphIssue>;
  readonly basePath: string;
}) {
  return (
    <div
      role="status"
      data-testid="graph-cycle-warning"
      className={cn(
        "mx-4 mt-3 rounded-[var(--radius-lg)] border px-3 py-2 text-small",
        "border-[var(--danger)] text-primary",
      )}
    >
      <p className="[font-weight:var(--weight-medium)]">
        {cycles.length === 1
          ? "These issues block each other"
          : `${cycles.length} sets of issues block each other`}
      </p>
      <p className="mt-0.5 text-tertiary">
        Nothing in a loop can start. Remove one of the blocking relations to
        break it.
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {cycles.map((cycle) => (
          <li key={cycle.join("-")} className="flex flex-wrap items-center gap-1">
            {cycle.map((id, index) => {
              const issue = byId.get(id);
              if (!issue) return null;
              return (
                <span key={id} className="flex items-center gap-1">
                  {index > 0 && <span className="text-tertiary">→</span>}
                  <a
                    href={`${basePath}/${issue.identifier}`}
                    className="text-accent tabular-nums no-underline hover:underline"
                  >
                    {issue.identifier}
                  </a>
                </span>
              );
            })}
            <span className="text-tertiary">→ …</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ZoomControls({
  zoom,
  config,
  onZoom,
  onReset,
}: {
  readonly zoom: number;
  readonly config: DependencyGraphConfig;
  readonly onZoom: (delta: number) => void;
  readonly onReset: () => void;
}) {
  const button =
    "flex h-6 w-6 items-center justify-center rounded-[var(--radius-md)] text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-subtle px-4 py-2">
      <button
        type="button"
        className={button}
        onClick={() => onZoom(-config.zoomStep)}
        disabled={zoom <= config.minZoom}
        aria-label="Zoom out"
        data-testid="graph-zoom-out"
      >
        −
      </button>
      <button
        type="button"
        className="rounded-[var(--radius-md)] px-1.5 text-mini text-tertiary tabular-nums hover:bg-[var(--bg-hover)] hover:text-primary"
        onClick={onReset}
        aria-label="Reset zoom"
        data-testid="graph-zoom-reset"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className={button}
        onClick={() => onZoom(config.zoomStep)}
        disabled={zoom >= config.maxZoom}
        aria-label="Zoom in"
        data-testid="graph-zoom-in"
      >
        +
      </button>
    </div>
  );
}
