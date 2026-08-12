import { describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  addTrauma,
  cameraTarget,
  containsAllFighters,
  createCamera,
  offscreenIndicators,
  screenToWorld,
  updateCamera,
  visibleBounds,
  worldToScreen,
  type Camera,
} from "./camera";
import { makeEvents, makeFighter, makeStage, makeState } from "./testFixtures";

const stage = makeStage();

/** Let the camera settle on its target, as it would over half a second. */
function settle(cam: Camera, state = makeState(), frames = 240): Camera {
  for (let i = 0; i < frames; i++) updateCamera(cam, state, stage, null);
  return cam;
}

describe("framing", () => {
  it("starts centred on the stage", () => {
    const cam = createCamera(stage);
    expect(cam.x).toBeCloseTo(0, 6);
    expect(cam.y).toBeCloseTo((192 + -140) / 2, 4);
  });

  it("contains every live fighter once it has settled", () => {
    const state = makeState({
      fighters: [
        makeFighter({ port: 0, x: fx(-120), y: fx(40) }),
        makeFighter({ port: 1, x: fx(150), y: fx(-30) }),
        makeFighter({ port: 2, x: fx(10), y: fx(90) }),
        makeFighter({ port: 3, x: fx(-40), y: fx(0) }),
      ],
    });
    const cam = settle(createCamera(stage), state);
    expect(containsAllFighters(cam, state)).toBe(true);
  });

  it("zooms out as fighters separate and back in as they cluster", () => {
    const apart = makeState({
      fighters: [makeFighter({ port: 0, x: fx(-200) }), makeFighter({ port: 1, x: fx(200) })],
    });
    const close = makeState({
      fighters: [makeFighter({ port: 0, x: fx(-6) }), makeFighter({ port: 1, x: fx(6) })],
    });
    expect(cameraTarget(apart, stage).zoom).toBeLessThan(cameraTarget(close, stage).zoom);
  });

  it("clamps zoom to the blast zone at one end and to readability at the other", () => {
    const spread = makeState({
      fighters: [
        makeFighter({ port: 0, x: fx(-239), y: fx(190) }),
        makeFighter({ port: 1, x: fx(239), y: fx(-139) }),
      ],
    });
    expect(cameraTarget(spread, stage).zoom).toBeGreaterThanOrEqual(MIN_ZOOM);

    const stacked = makeState({
      fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1 })],
    });
    expect(cameraTarget(stacked, stage).zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("never shows past the blast zone", () => {
    const state = makeState({
      fighters: [makeFighter({ port: 0, x: fx(235), y: fx(180) }), makeFighter({ port: 1, x: fx(230) })],
    });
    const cam = settle(createCamera(stage), state);
    const v = visibleBounds(cam);
    expect(v.right).toBeLessThanOrEqual(toFloat(stage.blastZone.right) + 1);
    expect(v.top).toBeLessThanOrEqual(toFloat(stage.blastZone.top) + 1);
  });

  it("keeps the main platform in shot even when both fighters stand on one spot", () => {
    const state = makeState({
      fighters: [makeFighter({ port: 0, x: 0 }), makeFighter({ port: 1, x: 0 })],
    });
    const target = cameraTarget(state, stage);
    const halfW = VIEW_WIDTH / (2 * target.zoom);
    expect(halfW).toBeGreaterThan(40);
  });

  it("stops framing a dead fighter", () => {
    const alive = makeState({
      fighters: [makeFighter({ port: 0, x: 0 }), makeFighter({ port: 1, x: fx(200), action: "dead" })],
    });
    const both = makeState({
      fighters: [makeFighter({ port: 0, x: 0 }), makeFighter({ port: 1, x: fx(200) })],
    });
    expect(cameraTarget(alive, stage).zoom).toBeGreaterThan(cameraTarget(both, stage).zoom);
  });

  it("falls back to the stage centre when nobody is alive", () => {
    const state = makeState({
      fighters: [makeFighter({ port: 0, action: "dead" }), makeFighter({ port: 1, action: "dead" })],
    });
    const t = cameraTarget(state, stage);
    expect(t.framed).toBe(false);
    expect(t.x).toBeCloseTo(0, 6);
  });

  it("smooths toward the target rather than snapping", () => {
    const cam = createCamera(stage);
    const state = makeState({
      fighters: [makeFighter({ port: 0, x: fx(200) }), makeFighter({ port: 1, x: fx(210) })],
    });
    const target = cameraTarget(state, stage);
    updateCamera(cam, state, stage, null);
    expect(cam.x).not.toBeCloseTo(target.x, 1);
    expect(Math.abs(cam.x)).toBeGreaterThan(0);
    settle(cam, state);
    expect(cam.x).toBeCloseTo(target.x, 1);
  });

  it("pulls back faster than it pushes in", () => {
    const wide = makeState({
      fighters: [makeFighter({ port: 0, x: fx(-220) }), makeFighter({ port: 1, x: fx(220) })],
    });
    const tight = makeState({
      fighters: [makeFighter({ port: 0, x: fx(-5) }), makeFighter({ port: 1, x: fx(5) })],
    });

    const out = createCamera(stage);
    out.zoom = MAX_ZOOM;
    const outBefore = out.zoom;
    updateCamera(out, wide, stage, null);

    const inn = createCamera(stage);
    inn.zoom = MIN_ZOOM;
    const inBefore = inn.zoom;
    updateCamera(inn, tight, stage, null);

    expect(Math.abs(out.zoom - outBefore)).toBeGreaterThan(Math.abs(inn.zoom - inBefore));
  });
});

describe("projection", () => {
  it("puts the camera centre at the middle of the frame", () => {
    const cam = createCamera(stage);
    cam.x = 20;
    cam.y = 30;
    const p = worldToScreen(cam, 20, 30);
    expect(p.x).toBeCloseTo(VIEW_WIDTH / 2, 6);
    expect(p.y).toBeCloseTo(VIEW_HEIGHT / 2, 6);
  });

  it("flips y: up in the world is up on the screen", () => {
    const cam = createCamera(stage);
    const low = worldToScreen(cam, 0, 0);
    const high = worldToScreen(cam, 0, 50);
    expect(high.y).toBeLessThan(low.y);
  });

  it("round-trips through screen space", () => {
    const cam = createCamera(stage);
    cam.x = -37;
    cam.y = 12;
    cam.zoom = 7.3;
    const w = screenToWorld(cam, 640, 300);
    const s = worldToScreen(cam, w.x, w.y);
    expect(s.x).toBeCloseTo(640, 6);
    expect(s.y).toBeCloseTo(300, 6);
  });
});

describe("trauma", () => {
  it("squares, so the shake is violent and then simply over", () => {
    const cam = createCamera(stage);
    addTrauma(cam, 1);
    const state = makeState();

    updateCamera(cam, state, stage, null);
    const strong = Math.hypot(cam.shakeX, cam.shakeY);
    const strongTrauma = cam.trauma;

    // Halve the trauma; the shake should fall to about a quarter, not a half.
    cam.trauma = strongTrauma / 2;
    updateCamera(cam, state, stage, null);
    const weak = Math.hypot(cam.shakeX, cam.shakeY);

    expect(weak).toBeLessThan(strong);
    // Amplitudes are random per frame, so compare the envelopes.
    const ratio = (cam.trauma * cam.trauma) / (strongTrauma * strongTrauma);
    expect(ratio).toBeLessThan(0.3);
  });

  it("decays to exactly zero, and the shake with it", () => {
    const cam = createCamera(stage);
    addTrauma(cam, 1);
    settle(cam, makeState(), 200);
    expect(cam.trauma).toBe(0);
    expect(cam.shakeX).toBe(0);
    expect(cam.shakeY).toBe(0);
    expect(cam.shakeAngle).toBe(0);
  });

  it("saturates at one no matter how many hits land at once", () => {
    const cam = createCamera(stage);
    for (let i = 0; i < 20; i++) addTrauma(cam, 0.4);
    expect(cam.trauma).toBe(1);
  });

  it("shakes harder for a kill move than for a jab", () => {
    const jab = createCamera(stage);
    const kill = createCamera(stage);
    const state = makeState();
    updateCamera(jab, state, stage, makeEvents({
      hits: [{ attacker: 0, victim: 1, damage: fx(2), x: 0, y: 0, knockback: fx(20) }],
    }));
    updateCamera(kill, state, stage, makeEvents({
      hits: [{ attacker: 0, victim: 1, damage: fx(18), x: 0, y: 0, knockback: fx(180) }],
    }));
    expect(kill.trauma).toBeGreaterThan(jab.trauma);
  });
});

describe("the KO punch-in", () => {
  const koEvents = makeEvents({ kos: [{ port: 1, x: fx(200), y: fx(150), kind: "blast" }] });

  it("fires on a stock-ending hit", () => {
    const cam = createCamera(stage);
    const state = makeState({
      fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, stocks: 1 })],
    });
    updateCamera(cam, state, stage, koEvents);
    expect(cam.koZoom.active).toBe(true);
    expect(cam.timeScale).toBeLessThan(1);
  });

  it("does not fire when the victim still has stocks left", () => {
    const cam = createCamera(stage);
    const state = makeState({
      fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, stocks: 3 })],
    });
    updateCamera(cam, state, stage, koEvents);
    expect(cam.koZoom.active).toBe(false);
    expect(cam.timeScale).toBe(1);
  });

  it("releases and restores normal time", () => {
    const cam = createCamera(stage);
    const state = makeState({
      fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, stocks: 1 })],
    });
    updateCamera(cam, state, stage, koEvents);
    settle(cam, state, 120);
    expect(cam.koZoom.active).toBe(false);
    expect(cam.timeScale).toBe(1);
  });
});

describe("the magnifying glass", () => {
  function offscreenState() {
    return makeState({
      fighters: [
        makeFighter({ port: 0, x: 0, y: 0 }),
        makeFighter({ port: 1, x: fx(-6), y: fx(0) }),
        makeFighter({ port: 2, x: fx(220), y: fx(180) }),
      ],
    });
  }

  it("marks a fighter past the view but inside the blast zone", () => {
    const state = offscreenState();
    const cam = createCamera(stage);
    cam.zoom = MAX_ZOOM;
    cam.x = 0;
    cam.y = 0;
    const inds = offscreenIndicators(cam, state, stage);
    expect(inds.map((i) => i.port)).toEqual([2]);
  });

  it("pins the indicator inside the frame and points it at the fighter", () => {
    const state = offscreenState();
    const cam = createCamera(stage);
    cam.zoom = MAX_ZOOM;
    const [ind] = offscreenIndicators(cam, state, stage);
    expect(ind.x).toBeGreaterThanOrEqual(0);
    expect(ind.x).toBeLessThanOrEqual(VIEW_WIDTH);
    expect(ind.y).toBeGreaterThanOrEqual(0);
    expect(ind.y).toBeLessThanOrEqual(VIEW_HEIGHT);
    // Up and to the right, so a screen-space bearing in the fourth quadrant.
    expect(Math.cos(ind.angle)).toBeGreaterThan(0);
    expect(Math.sin(ind.angle)).toBeLessThan(0);
  });

  it("shrinks the further out the fighter is", () => {
    const near = makeState({ fighters: [makeFighter({ port: 0, x: fx(120) })] });
    const far = makeState({ fighters: [makeFighter({ port: 0, x: fx(238) })] });
    const cam = createCamera(stage);
    cam.zoom = MAX_ZOOM;
    cam.x = 0;
    const a = offscreenIndicators(cam, near, stage)[0];
    const b = offscreenIndicators(cam, far, stage)[0];
    expect(b.scale).toBeLessThan(a.scale);
  });

  it("says nothing about a fighter already past the blast zone — they are KO'd", () => {
    const state = makeState({ fighters: [makeFighter({ port: 0, x: fx(400) })] });
    const cam = createCamera(stage);
    cam.zoom = MAX_ZOOM;
    expect(offscreenIndicators(cam, state, stage)).toHaveLength(0);
  });

  it("says nothing about a fighter that is on screen", () => {
    const state = makeState({ fighters: [makeFighter({ port: 0, x: 0, y: 0 })] });
    const cam = settle(createCamera(stage), state);
    expect(offscreenIndicators(cam, state, stage)).toHaveLength(0);
  });
});
