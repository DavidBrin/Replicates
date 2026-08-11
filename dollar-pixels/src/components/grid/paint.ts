/**
 * Canvas painting and hit-testing — pure functions, no React, no component state.
 *
 * Everything here works in *grid pixel* units: the caller scales the context by
 * `zoom * devicePixelRatio` once (see `prepareContext`) and then draws as though
 * the grid were 1200x1200. That keeps zoom and retina entirely out of the paint
 * code, which is why these functions are testable against a recording fake
 * instead of a real canvas.
 *
 * The block <-> pixel conversion is never re-derived here; it comes from
 * `@/domain/geometry` (DECISIONS D2).
 */

import {
  BLOCK_PX,
  gridPixelHeight,
  gridPixelWidth,
  pixelToBlock,
  type BlockRect,
  type GridDims,
  type ZoomLevel,
} from "@/domain/geometry";
import type { GridSnapshot } from "@/domain/snapshot";

/* ----------------------------------------------------------------- theme -- */

export interface GridTheme {
  readonly emptyA: string;
  readonly emptyB: string;
  readonly select: string;
  readonly rule: string;
  readonly unavailable: string;
}

/**
 * The SPEC §11 values, duplicated here as a *fallback only*.
 *
 * At runtime the tokens are read off the mounted element so the palette has one
 * home in `globals.css`. jsdom has no cascade, so tests would otherwise paint
 * with empty strings and assert nothing.
 */
export const DEFAULT_THEME: GridTheme = {
  emptyA: "#e1e1e1",
  emptyB: "#d6d6d6",
  select: "#0a7cff",
  rule: "#3d3d3d",
  unavailable: "#c0182b",
};

const THEME_TOKENS: Readonly<Record<keyof GridTheme, string>> = {
  emptyA: "--color-empty-a",
  emptyB: "--color-empty-b",
  select: "--color-select",
  rule: "--color-rule",
  unavailable: "--color-open",
};

/** Resolve the palette from CSS custom properties, falling back per token. */
export function readTheme(el: Element | null): GridTheme {
  if (!el || typeof window === "undefined" || !window.getComputedStyle) {
    return DEFAULT_THEME;
  }
  const style = window.getComputedStyle(el);
  const pick = (key: keyof GridTheme): string => {
    const value = style.getPropertyValue(THEME_TOKENS[key]).trim();
    return value.length > 0 ? value : DEFAULT_THEME[key];
  };
  return {
    emptyA: pick("emptyA"),
    emptyB: pick("emptyB"),
    select: pick("select"),
    rule: pick("rule"),
    unavailable: pick("unavailable"),
  };
}

/* --------------------------------------------------------------- context -- */

/**
 * The slice of `CanvasRenderingContext2D` this module touches.
 *
 * Narrowed deliberately: jsdom implements no canvas at all, so the tests hand in
 * a recording fake, and a fake only has to be honest about the calls that are
 * actually made. A real 2D context is assignable to this.
 */
export interface GridContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export interface BlockPoint {
  readonly bx: number;
  readonly by: number;
}

export interface CanvasSizing {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
}

/**
 * Size a canvas: backing store in device pixels, box in CSS pixels.
 *
 * `cssScale` is the responsive downscale (D7) and deliberately does *not* shrink
 * the backing store — the full-resolution bitmap is what the browser filters
 * down, and `image-rendering: pixelated` keeps that filtering nearest-neighbour.
 */
export function sizeCanvas(
  canvas: HTMLCanvasElement,
  dims: GridDims,
  zoom: ZoomLevel,
  dpr: number,
  cssScale = 1,
): CanvasSizing {
  const wPx = gridPixelWidth(dims) * zoom;
  const hPx = gridPixelHeight(dims) * zoom;
  const sizing: CanvasSizing = {
    cssWidth: wPx * cssScale,
    cssHeight: hPx * cssScale,
    backingWidth: Math.round(wPx * dpr),
    backingHeight: Math.round(hPx * dpr),
  };
  canvas.width = sizing.backingWidth;
  canvas.height = sizing.backingHeight;
  canvas.style.width = `${sizing.cssWidth}px`;
  canvas.style.height = `${sizing.cssHeight}px`;
  return sizing;
}

/** Put the context into grid-pixel units, so paint code never sees zoom or DPR. */
export function prepareContext(ctx: GridContext, zoom: ZoomLevel, dpr: number): void {
  const scale = zoom * dpr;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

/**
 * One CSS pixel expressed in grid-pixel units.
 *
 * Hairlines must not thicken with zoom: at 4x a 1-unit stroke would be a 4px
 * slab covering most of a 12px block.
 */
export function hairline(zoom: ZoomLevel): number {
  return 1 / zoom;
}

/* ------------------------------------------------------------------ base -- */

/** Decoded tiles by claim id. A claim absent from the map draws as solid colour. */
export type TileImages = ReadonlyMap<string, CanvasImageSource>;

function fillRectBlocks(ctx: GridContext, rect: BlockRect): void {
  ctx.fillRect(
    rect.bx * BLOCK_PX,
    rect.by * BLOCK_PX,
    rect.bw * BLOCK_PX,
    rect.bh * BLOCK_PX,
  );
}

/**
 * Paint the artwork layer: empty-grid checker, then every claim.
 *
 * Expensive by design and therefore never called from a pointer handler — it is
 * the whole reason the overlay is a second canvas (DECISIONS D8).
 */
export function paintBase(
  ctx: GridContext,
  snapshot: GridSnapshot,
  images: TileImages,
  theme: GridTheme,
): void {
  const dims: GridDims = { wBlocks: snapshot.wBlocks, hBlocks: snapshot.hBlocks };
  const w = gridPixelWidth(dims);
  const h = gridPixelHeight(dims);

  // One fill for the light tone, then only the dark squares: half the fillRect
  // calls of painting both, and the checker is one square per *block*, so the
  // unit being sold is visible on an untouched grid.
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.emptyA;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = theme.emptyB;
  for (let by = 0; by < dims.hBlocks; by++) {
    for (let bx = (by + 1) % 2; bx < dims.wBlocks; bx += 2) {
      ctx.fillRect(bx * BLOCK_PX, by * BLOCK_PX, BLOCK_PX, BLOCK_PX);
    }
  }

  for (const claim of snapshot.claims) {
    // The colour goes down first even when a tile exists: a PNG may be partly
    // transparent, and a failed decode must still leave the block looking sold.
    ctx.fillStyle = claim.colour;
    fillRectBlocks(ctx, claim.rect);

    const image = images.get(claim.id);
    if (!image) continue;
    // Tiles are authored at exactly the claim's pixel size (D14); any smoothing
    // would resample art that is meant to be seen pixel for pixel.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      claim.rect.bx * BLOCK_PX,
      claim.rect.by * BLOCK_PX,
      claim.rect.bw * BLOCK_PX,
      claim.rect.bh * BLOCK_PX,
    );
  }
}

/* --------------------------------------------------------------- overlay -- */

export interface OverlayState {
  readonly zoom: ZoomLevel;
  /** Block under the pointer. */
  readonly hover: BlockPoint | null;
  /** Block under the keyboard cursor, drawn even when the pointer is elsewhere. */
  readonly cursor: BlockPoint | null;
  /** The live drag rect if dragging, otherwise the committed selection. */
  readonly selection: BlockRect | null;
  /** Selection covers at least one owned or held block. */
  readonly blocked: boolean;
  /** Outline of the claim under the pointer. */
  readonly hoveredClaim: BlockRect | null;
  /** Unexpired holds, tinted so a buyer sees what checkout would refuse. */
  readonly holds: readonly BlockRect[];
}

const HOLD_ALPHA = 0.38;
const HOVER_ALPHA = 0.3;
const SELECT_ALPHA = 0.22;

/**
 * Paint the interaction layer. Cheap: it clears and redraws a handful of rects,
 * which is what makes repainting on every pointer move affordable.
 */
export function paintOverlay(
  ctx: GridContext,
  state: OverlayState,
  dims: GridDims,
  theme: GridTheme,
): void {
  const w = gridPixelWidth(dims);
  const h = gridPixelHeight(dims);
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = hairline(state.zoom);

  ctx.globalAlpha = HOLD_ALPHA;
  ctx.fillStyle = theme.unavailable;
  for (const hold of state.holds) fillRectBlocks(ctx, hold);
  ctx.globalAlpha = 1;

  if (state.hoveredClaim) {
    ctx.strokeStyle = theme.rule;
    strokeRectBlocks(ctx, state.hoveredClaim, state.zoom);
  }

  if (state.hover) {
    ctx.globalAlpha = HOVER_ALPHA;
    ctx.fillStyle = theme.select;
    fillRectBlocks(ctx, { bx: state.hover.bx, by: state.hover.by, bw: 1, bh: 1 });
    ctx.globalAlpha = 1;
  }

  if (state.cursor) {
    ctx.strokeStyle = theme.rule;
    strokeRectBlocks(
      ctx,
      { bx: state.cursor.bx, by: state.cursor.by, bw: 1, bh: 1 },
      state.zoom,
    );
  }

  if (state.selection) {
    const colour = state.blocked ? theme.unavailable : theme.select;
    ctx.globalAlpha = SELECT_ALPHA;
    ctx.fillStyle = colour;
    fillRectBlocks(ctx, state.selection);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colour;
    strokeRectBlocks(ctx, state.selection, state.zoom);
  }
}

/** Stroke on the inside of the block boundary, so the outline never bleeds. */
function strokeRectBlocks(ctx: GridContext, rect: BlockRect, zoom: ZoomLevel): void {
  const inset = hairline(zoom) / 2;
  ctx.strokeRect(
    rect.bx * BLOCK_PX + inset,
    rect.by * BLOCK_PX + inset,
    rect.bw * BLOCK_PX - inset * 2,
    rect.bh * BLOCK_PX - inset * 2,
  );
}

/* ------------------------------------------------------------- hit-test --- */

/**
 * Client point -> block, in O(1) arithmetic (DECISIONS D8, research §6).
 *
 * `rect` is the *rendered* rectangle, so it already carries the responsive
 * downscale; recovering the scale from it is what keeps the maths exact on a
 * narrow screen. Device pixel ratio is deliberately absent: a client rect is in
 * CSS pixels on every device, and the DPR correction lives entirely in the
 * backing-store size (`sizeCanvas`). Applying it here as well would double-count
 * it and break every retina hit at 2x.
 */
export function hitTest(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  dims: GridDims,
  zoom: ZoomLevel,
): BlockPoint | null {
  const naturalW = gridPixelWidth(dims) * zoom;
  const naturalH = gridPixelHeight(dims) * zoom;
  if (rect.width <= 0 || rect.height <= 0 || naturalW <= 0 || naturalH <= 0) return null;

  const scaleX = rect.width / naturalW;
  const scaleY = rect.height / naturalH;
  // Back to grid pixels: undo the CSS downscale, then undo zoom.
  const x = (clientX - rect.left) / scaleX / zoom;
  const y = (clientY - rect.top) / scaleY / zoom;
  if (x < 0 || y < 0) return null;

  const { bx, by } = pixelToBlock(x, y);
  if (bx < 0 || by < 0 || bx >= dims.wBlocks || by >= dims.hBlocks) return null;
  return { bx, by };
}
