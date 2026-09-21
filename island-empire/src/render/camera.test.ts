import { describe, expect, it } from "vitest";

import {
  ZOOM_DESKTOP,
  ZOOM_PHONE,
  clampCamera,
  createCamera,
  ensureVisible,
  panBy,
  screenToTile,
  screenToWorld,
  setViewport,
  visibleTileRange,
  worldToScreen,
  zoomAt,
} from "./camera";

describe("camera", () => {
  it("picks desktop zoom bounds for a wide viewport and phone bounds for a narrow one", () => {
    const desktop = createCamera(6, 6, 1280, 800);
    expect(desktop.tilePx).toBe(ZOOM_DESKTOP.initial);
    expect([desktop.minTilePx, desktop.maxTilePx]).toEqual([48, 160]);
    const phone = createCamera(3, 3, 390, 700);
    expect(phone.tilePx).toBe(ZOOM_PHONE.initial);
    expect([phone.minTilePx, phone.maxTilePx]).toEqual([56, 200]);
    // a map too large to fit opens at the widest zoom allowed
    expect(createCamera(40, 40, 1280, 800).tilePx).toBe(ZOOM_DESKTOP.min);
  });

  it("opens a small map fitted to the viewport, never closer than the default and never below the minimum", () => {
    expect(createCamera(10, 10, 800, 800).tilePx).toBe(80); // fits exactly
    expect(createCamera(12, 10, 430, 760).tilePx).toBe(56); // phone floor
    expect(createCamera(6, 6, 1280, 800).tilePx).toBe(96); // capped at the default
  });

  it("centres the map in the viewport", () => {
    const cam = createCamera(10, 10, 960, 960, 96);
    // 10 tiles × 96 px = exactly the viewport
    expect(cam.x).toBeCloseTo(0);
    expect(cam.y).toBeCloseTo(0);
  });

  it("round-trips world ↔ screen and hit-tests exact integer tiles", () => {
    const cam = { ...createCamera(20, 20, 800, 600, 100), x: 2.5, y: 1.25 };
    const s = worldToScreen(cam, 5, 3);
    expect(s).toEqual({ x: 250, y: 175 });
    const w = screenToWorld(cam, s.x, s.y);
    expect(w.x).toBeCloseTo(5);
    expect(w.y).toBeCloseTo(3);
    expect(screenToTile(cam, 250, 175)).toEqual({ x: 5, y: 3 });
    expect(screenToTile(cam, 349, 274)).toEqual({ x: 5, y: 3 });
    expect(screenToTile(cam, 350, 275)).toEqual({ x: 6, y: 4 });
  });

  it("returns null for a screen point off the map", () => {
    const cam = { ...createCamera(4, 4, 800, 600, 100), x: -1, y: -1 };
    expect(screenToTile(cam, 10, 10)).toBeNull();
    expect(screenToTile(cam, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(screenToTile(cam, 600, 100)).toBeNull();
  });

  it("clamps the pan so at least one tile stays on screen", () => {
    const cam = createCamera(5, 5, 500, 500, 100);
    const far = panBy(cam, -100000, -100000);
    expect(far.x).toBe(4);
    expect(far.y).toBe(4);
    const other = panBy(cam, 100000, 100000);
    expect(other.x).toBe(-(500 / 100 - 1));
    expect(other.y).toBe(-4);
  });

  it("pans in world units scaled by tilePx", () => {
    const cam = { ...createCamera(20, 20, 800, 600, 100), x: 5, y: 5 };
    const moved = panBy(cam, 50, -25);
    expect(moved.x).toBeCloseTo(4.5);
    expect(moved.y).toBeCloseTo(5.25);
  });

  it("zooms continuously about the cursor and stays within bounds", () => {
    const cam = { ...createCamera(40, 40, 800, 600, 100), x: 10, y: 10 };
    const under = screenToWorld(cam, 200, 150);
    const zoomed = zoomAt(cam, 1.5, 200, 150);
    expect(zoomed.tilePx).toBe(150);
    const after = screenToWorld(zoomed, 200, 150);
    expect(after.x).toBeCloseTo(under.x);
    expect(after.y).toBeCloseTo(under.y);
    expect(zoomAt(cam, 100, 0, 0).tilePx).toBe(cam.maxTilePx);
    expect(zoomAt(cam, 0.001, 0, 0).tilePx).toBe(cam.minTilePx);
    const maxed = zoomAt(cam, 100, 0, 0);
    expect(zoomAt(maxed, 1.1, 0, 0)).toBe(maxed); // already at the bound: same object back
  });

  it("re-derives bounds on a viewport change and keeps the clamp", () => {
    const cam = { ...createCamera(10, 10, 1280, 800, 160), x: 9, y: 9 };
    const phone = setViewport(cam, 390, 700);
    expect(phone.minTilePx).toBe(56);
    expect(phone.viewW).toBe(390);
    expect(phone.x).toBeLessThanOrEqual(9);
    expect(clampCamera(phone)).toEqual(phone);
  });

  it("lists only the visible tiles", () => {
    const cam = { ...createCamera(40, 40, 400, 300, 100), x: 3.5, y: 2 };
    expect(visibleTileRange(cam)).toEqual({ x0: 3, y0: 2, x1: 8, y1: 5 });
  });

  it("nudges a tile into view without overshooting the clamp", () => {
    const cam = { ...createCamera(40, 40, 400, 300, 100), x: 0, y: 0 };
    const moved = ensureVisible(cam, { x: 20, y: 20 });
    const s = worldToScreen(moved, 20, 20);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x + 100).toBeLessThanOrEqual(400);
    expect(s.y + 100).toBeLessThanOrEqual(300);
    expect(ensureVisible(cam, { x: 1, y: 1 })).toEqual(cam);
  });
});
