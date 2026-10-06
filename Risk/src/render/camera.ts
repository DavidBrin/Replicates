/**
 * The camera, and **the only projection** (SPEC §8's coordinate contract, F40).
 *
 * Three files project points — `render/tokens.ts`, `render/camera.ts` and
 * `game/input.ts` — and two of them must agree with the third to the pixel,
 * so `toScreen` / `toMap` live here and nothing re-derives a matrix.
 *
 * The camera language is exactly two transforms:
 *
 *   `#stage`  `perspective(1400px) rotateX(θ)`   — origin `50% 55%`
 *   `#board`  `translate(pan) scale(zoom)`       — the wrapper tokens sit inside
 *
 * Map units are CSS pixels 1:1 before the camera, and the wrapper is sized to
 * the map's own `viewBox` with its **origin honoured**: a `viewBox` of
 * `"0 8 1024 643"` means a 1024×643 wrapper whose content is offset by
 * `(0, −8)`, never a 1024×651 one.
 */

export const PERSPECTIVE_PX = 1400;
export const TILT_IDLE = 4;
export const TILT_BATTLE = 18;
export const MAX_ZOOM_FACTOR = 4;

export interface Camera {
  pan: readonly [number, number];
  zoom: number;
  /** Degrees of `rotateX` on the stage. */
  tilt: number;
  // ---- S4 additions, all defaulted; the published triple above is enough to project ----
  /** Viewport size in CSS px. */
  viewport?: { readonly w: number; readonly h: number };
  /** Board size in map units, from the map's `viewBox`. */
  board?: { readonly w: number; readonly h: number };
  /** The stage's `transform-origin`, in CSS px. Defaults to `(50%, 55%)` of the viewport. */
  origin?: readonly [number, number];
  /** The `perspective()` distance. */
  perspective?: number;
}

function originOf(cam: Camera): readonly [number, number] {
  if (cam.origin) return cam.origin;
  const w = cam.viewport?.w ?? 0;
  const h = cam.viewport?.h ?? 0;
  return [w / 2, h * 0.55];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** map units → client (screen) px, through pan, zoom and the tilt. */
export function toScreen(cam: Camera, pt: readonly [number, number]): readonly [number, number] {
  const [px, py] = cam.pan;
  const wx = px + cam.zoom * pt[0];
  const wy = py + cam.zoom * pt[1];
  const [ox, oy] = originOf(cam);
  const dx = wx - ox;
  const dy = wy - oy;
  const t = rad(cam.tilt);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const d = cam.perspective ?? PERSPECTIVE_PX;
  const zr = dy * sin;
  const scale = d / (d - zr);
  return [ox + dx * scale, oy + dy * cos * scale];
}

/** The exact inverse: client px → map units. */
export function toMap(cam: Camera, pt: readonly [number, number]): readonly [number, number] {
  const [ox, oy] = originOf(cam);
  const sx = pt[0] - ox;
  const sy = pt[1] - oy;
  const t = rad(cam.tilt);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const d = cam.perspective ?? PERSPECTIVE_PX;
  // sy = dy·cos·d / (d − dy·sin)  ⇒  dy = sy·d / (d·cos + sy·sin)
  const denominator = d * cos + sy * sin;
  const dy = denominator === 0 ? 0 : (sy * d) / denominator;
  const scale = d / (d - dy * sin);
  const dx = scale === 0 ? 0 : sx / scale;
  const wx = ox + dx;
  const wy = oy + dy;
  const [panX, panY] = cam.pan;
  return [(wx - panX) / cam.zoom, (wy - panY) / cam.zoom];
}

/** The smallest zoom at which the board still covers the viewport (§8.5). */
export function coverScale(cam: Camera): number {
  const board = cam.board;
  const view = cam.viewport;
  if (!board || !view || board.w <= 0 || board.h <= 0) return 1;
  return Math.max(view.w / board.w, view.h / board.h);
}

/** Clamp pan so the board always covers the viewport — the ocean never runs out. */
export function clampPan(cam: Camera): Camera {
  const board = cam.board;
  const view = cam.viewport;
  if (!board || !view) return cam;
  const w = board.w * cam.zoom;
  const h = board.h * cam.zoom;
  const minX = Math.min(0, view.w - w);
  const maxX = Math.max(0, view.w - w);
  const minY = Math.min(0, view.h - h);
  const maxY = Math.max(0, view.h - h);
  const [x, y] = cam.pan;
  return {
    ...cam,
    pan: [
      Math.min(Math.max(x, minX), maxX),
      Math.min(Math.max(y, minY), maxY),
    ] as const,
  };
}

export interface CreateCameraOptions {
  readonly board: { readonly w: number; readonly h: number };
  readonly viewport: { readonly w: number; readonly h: number };
  readonly tilt?: number;
}

/** A camera framed at cover scale, centred. */
export function createCamera(options: CreateCameraOptions): Camera {
  const base: Camera = {
    pan: [0, 0],
    zoom: 1,
    tilt: options.tilt ?? TILT_IDLE,
    board: options.board,
    viewport: options.viewport,
  };
  return reset(base);
}

/** `0` resets to cover, centred (§9). */
export function reset(cam: Camera): Camera {
  const zoom = coverScale(cam);
  const view = cam.viewport ?? { w: 0, h: 0 };
  const board = cam.board ?? { w: 0, h: 0 };
  return clampPan({
    ...cam,
    zoom,
    pan: [(view.w - board.w * zoom) / 2, (view.h - board.h * zoom) / 2] as const,
  });
}

export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return clampPan({ ...cam, pan: [cam.pan[0] + dx, cam.pan[1] + dy] as const });
}

/** Zoom about a fixed screen point, so a pinch keeps the pinched map point still. */
export function zoomAt(cam: Camera, factor: number, at: readonly [number, number]): Camera {
  const min = coverScale(cam);
  const next = Math.min(min * MAX_ZOOM_FACTOR, Math.max(min, cam.zoom * factor));
  if (next === cam.zoom) return cam;
  const before = toMap(cam, at);
  const scaled: Camera = { ...cam, zoom: next };
  const after = toMap(scaled, at);
  return clampPan({
    ...scaled,
    pan: [
      scaled.pan[0] + (after[0] - before[0]) * next,
      scaled.pan[1] + (after[1] - before[1]) * next,
    ] as const,
  });
}

export function withViewport(cam: Camera, viewport: { w: number; h: number }): Camera {
  const next: Camera = { ...cam, viewport };
  return next.zoom < coverScale(next) ? reset(next) : clampPan(next);
}

export function withTilt(cam: Camera, tilt: number): Camera {
  return { ...cam, tilt };
}

/** The `#stage` transform string. */
export function stageTransform(cam: Camera): string {
  return `perspective(${cam.perspective ?? PERSPECTIVE_PX}px) rotateX(${cam.tilt}deg)`;
}

/** The `#board` transform string. */
export function boardTransform(cam: Camera): string {
  return `translate(${cam.pan[0]}px, ${cam.pan[1]}px) scale(${cam.zoom})`;
}

/**
 * Tokens and labels sit **inside** the wrapper, so they pan and zoom for
 * free; these two variables are what keeps them upright and screen-sized.
 * The camera writes them once per frame, never per token (§10).
 */
export function counterTransformVars(cam: Camera): Record<string, string> {
  return { "--tilt": `${cam.tilt}deg`, "--zoom": String(cam.zoom) };
}
