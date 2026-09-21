import type { TileCoord } from "@/engine/types";

/**
 * The camera: continuous zoom, pan with a clamp, world↔screen (SPEC §8).
 *
 * World units are tiles: `x`/`y` are the world coordinates of the viewport's
 * top-left corner, `tilePx` the screen pixels per tile. Everything is in CSS
 * pixels; the renderer multiplies by the device pixel ratio when it paints.
 */

export interface Camera {
  x: number;
  y: number;
  tilePx: number;
  /** Viewport size in CSS px. */
  viewW: number;
  viewH: number;
  /** Map size in tiles, for the clamp. */
  mapW: number;
  mapH: number;
  minTilePx: number;
  maxTilePx: number;
}

export const ZOOM_DESKTOP = { min: 48, max: 160, initial: 96 };
export const ZOOM_PHONE = { min: 56, max: 200, initial: 128 };

export function zoomBoundsFor(viewW: number): { min: number; max: number; initial: number } {
  return viewW < 600 ? ZOOM_PHONE : ZOOM_DESKTOP;
}

export function createCamera(
  mapW: number,
  mapH: number,
  viewW: number,
  viewH: number,
  tilePx?: number,
): Camera {
  const z = zoomBoundsFor(viewW);
  // Open no closer than the default, and no closer than "whole map fits"
  // when the map is small enough — a 12-tile island should not open at
  // three tiles across a phone.
  const fit = Math.min(viewW / Math.max(1, mapW), viewH / Math.max(1, mapH));
  const initial = Math.min(z.max, Math.max(z.min, Math.min(z.initial, fit)));
  const cam: Camera = {
    x: 0,
    y: 0,
    tilePx: tilePx ?? initial,
    viewW,
    viewH,
    mapW,
    mapH,
    minTilePx: z.min,
    maxTilePx: z.max,
  };
  return centreOnMap(cam);
}

/** Centre the map in the viewport (initial framing, and after a resize). */
export function centreOnMap(cam: Camera): Camera {
  const visibleW = cam.viewW / cam.tilePx;
  const visibleH = cam.viewH / cam.tilePx;
  return clampCamera({
    ...cam,
    x: cam.mapW / 2 - visibleW / 2,
    y: cam.mapH / 2 - visibleH / 2,
  });
}

/** Keep at least one tile on screen in each axis (SPEC §8). */
export function clampCamera(cam: Camera): Camera {
  const visibleW = cam.viewW / cam.tilePx;
  const visibleH = cam.viewH / cam.tilePx;
  const minX = -(visibleW - 1);
  const maxX = cam.mapW - 1;
  const minY = -(visibleH - 1);
  const maxY = cam.mapH - 1;
  return {
    ...cam,
    x: Math.min(maxX, Math.max(minX, cam.x)),
    y: Math.min(maxY, Math.max(minY, cam.y)),
  };
}

export function setViewport(cam: Camera, viewW: number, viewH: number): Camera {
  const z = zoomBoundsFor(viewW);
  const tilePx = Math.min(z.max, Math.max(z.min, cam.tilePx));
  return clampCamera({ ...cam, viewW, viewH, minTilePx: z.min, maxTilePx: z.max, tilePx });
}

export function panBy(cam: Camera, dxPx: number, dyPx: number): Camera {
  return clampCamera({ ...cam, x: cam.x - dxPx / cam.tilePx, y: cam.y - dyPx / cam.tilePx });
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const next = Math.min(cam.maxTilePx, Math.max(cam.minTilePx, cam.tilePx * factor));
  if (next === cam.tilePx) return cam;
  const wx = cam.x + sx / cam.tilePx;
  const wy = cam.y + sy / cam.tilePx;
  return clampCamera({ ...cam, tilePx: next, x: wx - sx / next, y: wy - sy / next });
}

export function setZoom(cam: Camera, tilePx: number): Camera {
  return zoomAt(cam, tilePx / cam.tilePx, cam.viewW / 2, cam.viewH / 2);
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.tilePx, y: (wy - cam.y) * cam.tilePx };
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: cam.x + sx / cam.tilePx, y: cam.y + sy / cam.tilePx };
}

/** Exact integer tile under a screen point, or null when off the map. */
export function screenToTile(cam: Camera, sx: number, sy: number): TileCoord | null {
  const w = screenToWorld(cam, sx, sy);
  const x = Math.floor(w.x);
  const y = Math.floor(w.y);
  if (x < 0 || y < 0 || x >= cam.mapW || y >= cam.mapH) return null;
  return { x, y };
}

/** Screen rectangle of a tile, in CSS px. */
export function tileRect(cam: Camera, t: TileCoord): { x: number; y: number; size: number } {
  const p = worldToScreen(cam, t.x, t.y);
  return { x: p.x, y: p.y, size: cam.tilePx };
}

/** Tiles whose rectangles intersect the viewport. */
export function visibleTileRange(cam: Camera): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.max(0, Math.floor(cam.x)),
    y0: Math.max(0, Math.floor(cam.y)),
    x1: Math.min(cam.mapW - 1, Math.ceil(cam.x + cam.viewW / cam.tilePx)),
    y1: Math.min(cam.mapH - 1, Math.ceil(cam.y + cam.viewH / cam.tilePx)),
  };
}

/** Nudge so a tile is comfortably inside the view (AI action highlight). */
export function ensureVisible(cam: Camera, t: TileCoord, marginTiles = 1): Camera {
  const visibleW = cam.viewW / cam.tilePx;
  const visibleH = cam.viewH / cam.tilePx;
  let { x, y } = cam;
  if (t.x < x + marginTiles) x = t.x - marginTiles;
  if (t.x + 1 > x + visibleW - marginTiles) x = t.x + 1 - visibleW + marginTiles;
  if (t.y < y + marginTiles) y = t.y - marginTiles;
  if (t.y + 1 > y + visibleH - marginTiles) y = t.y + 1 - visibleH + marginTiles;
  return clampCamera({ ...cam, x, y });
}

export function cameraEquals(a: Camera, b: Camera): boolean {
  return (
    a.x === b.x && a.y === b.y && a.tilePx === b.tilePx && a.viewW === b.viewW && a.viewH === b.viewH
  );
}
