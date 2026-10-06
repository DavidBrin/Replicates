/**
 * The projection guard SPEC §8.4 asks for by name: `toMap(toScreen(p)) ≈ p`
 * across the zoom and tilt ranges, because a drifted inverse means a tap
 * landing one territory away from the finger.
 */
import { describe, expect, it } from "vitest";

import {
  boardTransform,
  clampPan,
  counterTransformVars,
  containScale,
  coverScale,
  minZoom,
  MIN_ZOOM_FACTOR,
  createCamera,
  MAX_ZOOM_FACTOR,
  PERSPECTIVE_PX,
  reset,
  stageTransform,
  toMap,
  toScreen,
  zoomAt,
  type Camera,
} from "./camera";

const VIEWPORT = { w: 1600, h: 900 } as const;
const BOARD = { w: 1024, h: 643 } as const;

function base(overrides: Partial<Camera> = {}): Camera {
  return {
    pan: [0, 0],
    zoom: 1,
    tilt: 4,
    viewport: VIEWPORT,
    board: BOARD,
    ...overrides,
  };
}

describe("camera — the single projection", () => {
  it("round-trips every grid point across the zoom and tilt ranges", () => {
    const points: (readonly [number, number])[] = [];
    for (let x = 0; x <= BOARD.w; x += BOARD.w / 4) {
      for (let y = 0; y <= BOARD.h; y += BOARD.h / 4) points.push([x, y] as const);
    }
    const cover = coverScale(base());
    let checked = 0;
    for (const tilt of [0, 4, 18, 30]) {
      for (const zoom of [cover, 1, 2, cover * MAX_ZOOM_FACTOR]) {
        // Centred, then nudged — a pan the clamp would never produce puts the
        // board behind the perspective plane, which is not a camera state the
        // app can reach and not what this guard is about.
        const centred: readonly [number, number] = [
          (VIEWPORT.w - BOARD.w * zoom) / 2,
          (VIEWPORT.h - BOARD.h * zoom) / 2,
        ];
        for (const nudge of [[0, 0], [-200, -80], [150, 60]] as const) {
          const cam = clampPan(
            base({ tilt, zoom, pan: [centred[0] + nudge[0], centred[1] + nudge[1]] as const }),
          );
          for (const p of points) {
            const back = toMap(cam, toScreen(cam, p));
            expect(back[0]).toBeCloseTo(p[0], 6);
            expect(back[1]).toBeCloseTo(p[1], 6);
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(points.length * 4 * 4 * 3);
  });

  it("is the identity at zoom 1, tilt 0, pan 0 (map units are CSS px 1:1)", () => {
    const cam = base({ tilt: 0 });
    expect(toScreen(cam, [137, 402])).toEqual([137, 402]);
  });

  it("coverScale is the larger of the two axis ratios", () => {
    expect(coverScale(base())).toBeCloseTo(Math.max(1600 / 1024, 900 / 643), 10);
    expect(coverScale(base({ board: { w: 3200, h: 1800 } }))).toBeCloseTo(0.5, 10);
    // No board or viewport yet (first frame): a neutral 1, never a divide by zero.
    expect(coverScale({ pan: [0, 0], zoom: 1, tilt: 4 })).toBe(1);
  });

  it("reset centres the board at cover scale", () => {
    const cam = reset(base({ zoom: 3, pan: [999, -999] }));
    expect(cam.zoom).toBeCloseTo(coverScale(base()), 10);
    const left = cam.pan[0];
    const right = VIEWPORT.w - (BOARD.w * cam.zoom + left);
    expect(left).toBeCloseTo(right, 6);
  });

  it("createCamera frames at cover, centred, with the idle tilt", () => {
    const cam = createCamera({ board: BOARD, viewport: VIEWPORT });
    expect(cam.tilt).toBe(4);
    expect(cam.zoom).toBeCloseTo(coverScale(base()), 10);
  });

  it("clampPan never lets the board uncover the viewport", () => {
    const cam = base({ zoom: 2 });
    for (const pan of [[5000, 5000], [-5000, -5000], [0, 0]] as const) {
      const clamped = clampPan({ ...cam, pan: pan as readonly [number, number] });
      const [x, y] = clamped.pan;
      expect(x).toBeLessThanOrEqual(0 + 1e-9);
      expect(y).toBeLessThanOrEqual(0 + 1e-9);
      expect(x + BOARD.w * cam.zoom).toBeGreaterThanOrEqual(VIEWPORT.w - 1e-9);
      expect(y + BOARD.h * cam.zoom).toBeGreaterThanOrEqual(VIEWPORT.h - 1e-9);
    }
  });

  it("zoomAt keeps the pinched map point fixed on screen", () => {
    const start = reset(base());
    const at = [820, 430] as const;
    const before = toMap(start, at);
    const zoomed = zoomAt(start, 1.8, at);
    expect(zoomed.zoom).toBeGreaterThan(start.zoom);
    const after = toMap(zoomed, at);
    expect(after[0]).toBeCloseTo(before[0], 4);
    expect(after[1]).toBeCloseTo(before[1], 4);
  });

  it("zoomAt clamps to 85% of the contain scale and to 4x the cover scale", () => {
    const start = reset(base());
    const cover = coverScale(start);
    // The floor is BELOW cover: the whole board plus a margin, so a territory the HUD covers at
    // the default framing can always be brought into the clear.
    expect(zoomAt(start, 0.1, [800, 450]).zoom).toBeCloseTo(minZoom(start), 10);
    expect(minZoom(start)).toBeCloseTo(containScale(start) * MIN_ZOOM_FACTOR, 10);
    expect(minZoom(start)).toBeLessThan(cover);
    // Zoomed all the way out, the board sits wholly inside the viewport.
    const out = zoomAt(start, 0.1, [800, 450]);
    expect(out.pan[0]).toBeGreaterThanOrEqual(0);
    expect(out.pan[1]).toBeGreaterThanOrEqual(0);
    let cam = start;
    for (let i = 0; i < 12; i += 1) cam = zoomAt(cam, 2, [800, 450]);
    expect(cam.zoom).toBeCloseTo(cover * MAX_ZOOM_FACTOR, 10);
  });

  it("emits the two camera transforms, and nothing else", () => {
    const cam = base({ pan: [-120, 40], zoom: 1.5, tilt: 18 });
    expect(stageTransform(cam)).toBe(`perspective(${PERSPECTIVE_PX}px) rotateX(18deg)`);
    expect(boardTransform(cam)).toBe("translate(-120px, 40px) scale(1.5)");
  });

  it("counterTransformVars is the pair the token layer writes once per frame", () => {
    expect(counterTransformVars(base({ zoom: 2.25, tilt: 18 }))).toEqual({
      "--tilt": "18deg",
      "--zoom": "2.25",
    });
  });
});
