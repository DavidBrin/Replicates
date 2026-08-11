"use client";

/**
 * The grid widget: two stacked canvases, zoom controls and keyboard selection.
 *
 * Two canvases rather than one because hover fires on every pointer move, and
 * repainting 160,000 blocks of artwork per mouse move is pathological
 * (DECISIONS D8). The artwork layer repaints only when the snapshot, the zoom,
 * the palette or a decoded tile changes; the transparent layer above it carries
 * everything that follows the pointer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";

import {
  ZOOM_LEVELS,
  blocksIn,
  gridPixelHeight,
  gridPixelWidth,
  type BlockRect,
  type GridDims,
  type ZoomLevel,
} from "@/domain/geometry";
import { formatCount } from "@/domain/money";
import type { GridSnapshot, SnapshotClaim } from "@/domain/snapshot";
import { buildClaimIndex } from "@/components/grid/claim-index";
import {
  DEFAULT_THEME,
  paintBase,
  paintOverlay,
  prepareContext,
  readTheme,
  sizeCanvas,
  type GridTheme,
  type OverlayState,
} from "@/components/grid/paint";
import { stepZoom, useGridPointer } from "@/components/grid/use-grid-pointer";

export interface PixelGridProps {
  readonly snapshot: GridSnapshot;
  readonly selection: BlockRect | null;
  readonly onSelectionChange: (rect: BlockRect | null) => void;
  readonly onClaimActivate?: (claim: SnapshotClaim) => void;
  readonly readOnly?: boolean;
  readonly className?: string;
}

export function PixelGrid({
  snapshot,
  selection,
  onSelectionChange,
  onClaimActivate,
  readOnly = false,
  className,
}: PixelGridProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [focused, setFocused] = useState(false);

  const dims: GridDims = useMemo(
    () => ({ wBlocks: snapshot.wBlocks, hBlocks: snapshot.hBlocks }),
    [snapshot.wBlocks, snapshot.hBlocks],
  );
  const index = useMemo(() => buildClaimIndex(snapshot), [snapshot]);

  /* ------------------------------------------------------------ display -- */

  /**
   * Device pixel ratio and the palette are browser state, not React state: they
   * are refreshed by the artwork effect below and read by the overlay effect,
   * which runs immediately after it. Keeping them out of the render pass is
   * what stops the server's HTML disagreeing with the client's first paint, and
   * out of the overlay's hot path is what stops every pointer move forcing a
   * style recalculation via `getComputedStyle`.
   */
  const displayRef = useRef({ dpr: 1, theme: DEFAULT_THEME as GridTheme });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(host);
    setContainerWidth(host.clientWidth);
    return () => observer.disconnect();
  }, []);

  const naturalWidth = gridPixelWidth(dims) * zoom;
  const naturalHeight = gridPixelHeight(dims) * zoom;
  // D7: below the width where the grid fits, it is displayed smaller rather than
  // panned. Purely a display accommodation — hit-testing reads the rendered rect.
  //
  // Measured against the grid at 1x, NOT at the current zoom. Dividing by the
  // zoomed width was the original mistake and it silently made the zoom control
  // do nothing at all: every zoom level was immediately re-fitted to the same
  // container, so the element never changed size on screen. Fitting the 1x
  // width instead means zoom multiplies the rendered size, which is the only
  // thing a zoom control is for.
  const cssScale =
    containerWidth > 0 ? Math.min(1, containerWidth / gridPixelWidth(dims)) : 1;
  const downscaled = cssScale < 1;

  /* -------------------------------------------------------------- tiles -- */

  const tilesRef = useRef(new Map<string, CanvasImageSource>());
  const [tileVersion, setTileVersion] = useState(0);
  const repaintHandle = useRef(0);

  const scheduleRepaint = useCallback(() => {
    // A page with a thousand tiles resolves a thousand times; coalescing to one
    // frame keeps that a single repaint instead of a thousand.
    if (repaintHandle.current !== 0) return;
    repaintHandle.current = requestAnimationFrame(() => {
      repaintHandle.current = 0;
      setTileVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    let live = true;
    const wanted = new Set<string>();
    for (const claim of snapshot.claims) {
      if (!claim.tile) continue;
      wanted.add(claim.id);
      if (tilesRef.current.has(claim.id)) continue;
      const image = new Image();
      image.onload = () => {
        if (!live) return;
        tilesRef.current.set(claim.id, image);
        scheduleRepaint();
      };
      image.onerror = () => {
        // Deliberately nothing. An undecodable tile never enters the map, so
        // the claim keeps its solid colour and one corrupt data URL cannot
        // blank the grid.
      };
      image.src = claim.tile;
    }
    for (const id of [...tilesRef.current.keys()]) {
      if (!wanted.has(id)) tilesRef.current.delete(id);
    }
    return () => {
      live = false;
    };
  }, [snapshot, scheduleRepaint]);

  useEffect(
    () => () => {
      if (repaintHandle.current !== 0) cancelAnimationFrame(repaintHandle.current);
    },
    [],
  );

  /* ----------------------------------------------------------- pointing -- */

  const rectOf = useCallback(
    () => overlayRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  const isAvailableNow = useCallback(
    (bx: number, by: number) => index.isAvailable(bx, by, Date.now()),
    [index],
  );

  const handleActivate = useCallback(
    (bx: number, by: number) => {
      const claim = index.claimAt(bx, by);
      if (claim) onClaimActivate?.(claim);
    },
    [index, onClaimActivate],
  );

  const handleZoomStep = useCallback((delta: 1 | -1) => {
    setZoom((current) => stepZoom(current, delta));
  }, []);

  const pointer = useGridPointer({
    dims,
    zoom,
    rectOf,
    isAvailable: isAvailableNow,
    onSelect: onSelectionChange,
    onActivateBlock: handleActivate,
    onZoomStep: handleZoomStep,
    readOnly,
  });

  /* ----------------------------------------------------------- painting -- */

  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas) return;
    displayRef.current = {
      dpr: window.devicePixelRatio || 1,
      theme: readTheme(hostRef.current),
    };
    const { dpr, theme } = displayRef.current;
    sizeCanvas(canvas, dims, zoom, dpr, cssScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    prepareContext(ctx, zoom, dpr);
    paintBase(ctx, snapshot, tilesRef.current, theme);
    // `tileVersion` is the repaint trigger: the tiles themselves live in a ref
    // so a decode never re-renders the tree.
  }, [snapshot, dims, zoom, cssScale, tileVersion]);

  const activeSelection = pointer.draft ?? selection;
  const hoveredClaim = pointer.hover
    ? (index.claimAt(pointer.hover.bx, pointer.hover.by)?.rect ?? null)
    : null;

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const { dpr, theme } = displayRef.current;
    sizeCanvas(canvas, dims, zoom, dpr, cssScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    prepareContext(ctx, zoom, dpr);
    const state: OverlayState = {
      zoom,
      hover: pointer.hover,
      cursor: focused ? pointer.cursor : null,
      selection: activeSelection,
      blocked: pointer.blocked,
      hoveredClaim,
      // Read per paint rather than memoised: a hold that lapses while the page
      // is open stops being tinted at the next repaint, and the check that
      // decides a purchase runs against Date.now() at selection time anyway.
      holds: index.activeHolds(Date.now()),
    };
    paintOverlay(ctx, state, dims, theme);
  }, [
    dims,
    zoom,
    cssScale,
    index,
    focused,
    hoveredClaim,
    activeSelection,
    pointer.hover,
    pointer.cursor,
    pointer.blocked,
  ]);

  /* --------------------------------------------------------------- copy -- */

  const soldLabel = `${formatCount(snapshot.soldBlocks)} of ${formatCount(
    snapshot.totalBlocks,
  )} blocks sold`;
  const status = describeSelection(activeSelection, pointer.clamped, pointer.blocked);

  // Zoomed in, the grid is deliberately wider than its container, so the
  // viewport scrolls rather than the grid shrinking back to fit. Without this
  // the zoomed canvas is simply clipped and the controls look broken.
  const viewportStyle: CSSProperties = {
    maxWidth: "100%",
    overflow: zoom > 1 ? "auto" : "visible",
  };

  const frameStyle: CSSProperties = {
    position: "relative",
    width: naturalWidth * cssScale,
    height: naturalHeight * cssScale,
    border: `1px solid var(--color-rule, ${DEFAULT_THEME.rule})`,
    outline: focused
      ? `2px solid var(--color-select, ${DEFAULT_THEME.select})`
      : undefined,
    outlineOffset: 2,
  };

  // No width or height here: `sizeCanvas` owns the CSS box, because it is the
  // same function that sizes the backing store and the two must not disagree.
  const layerStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    display: "block",
    // Nearest-neighbour keeps a downscaled block a block rather than a smear.
    imageRendering: "pixelated",
  };

  return (
    <div ref={hostRef} className={className}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={() => handleZoomStep(-1)}
          disabled={zoom === ZOOM_LEVELS[0]}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="tnum" aria-live="polite">
          {zoom}×
        </span>
        <button
          type="button"
          onClick={() => handleZoomStep(1)}
          disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          aria-label="Zoom in"
        >
          +
        </button>
        {downscaled ? (
          <span>Scaled to fit — a block is smaller than three pixels here.</span>
        ) : null}
      </div>

      <div style={viewportStyle}>
      <div
        style={frameStyle}
        tabIndex={0}
        role="group"
        aria-label={`${snapshot.title} grid`}
        aria-describedby={`${snapshot.slug}-grid-help`}
        onKeyDown={pointer.onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <canvas
          ref={baseRef}
          data-testid="grid-base"
          role="img"
          aria-label={`${snapshot.title}: ${soldLabel}.`}
          style={{ ...layerStyle, pointerEvents: "none" }}
        />
        {/*
          The overlay is the one that takes pointer events, so it is the one an
          e2e drag has to target — hence the test id, which is load-bearing
          rather than decorative.
        */}
        <canvas
          ref={overlayRef}
          data-testid="grid-overlay"
          aria-hidden="true"
          style={{
            ...layerStyle,
            touchAction: "none",
            cursor: readOnly ? "default" : "crosshair",
          }}
          onPointerDown={pointer.onPointerDown}
          onPointerMove={pointer.onPointerMove}
          onPointerUp={pointer.onPointerUp}
          onPointerLeave={pointer.onPointerLeave}
        />
      </div>
      </div>

      <p id={`${snapshot.slug}-grid-help`}>
        {readOnly
          ? "Arrow keys move the block cursor. Enter opens the claim under it."
          : "Arrow keys move the block cursor, shift and arrow keys extend the selection, Enter confirms, Escape clears. Plus and minus zoom."}
      </p>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

function describeSelection(
  rect: BlockRect | null,
  clamped: boolean,
  blocked: boolean,
): string {
  if (!rect) return "No blocks selected.";
  const parts = [
    `${rect.bw} × ${rect.bh} blocks selected at ${rect.bx}, ${rect.by} — ${formatCount(
      blocksIn(rect),
    )} blocks.`,
  ];
  if (clamped) parts.push("Trimmed to the 4,000 block maximum for one claim.");
  if (blocked) parts.push("Some of these blocks are already taken.");
  return parts.join(" ");
}
