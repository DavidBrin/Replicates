import { describe, expect, it, vi } from "vitest";

import { fx } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { SPRITE_KINDS } from "@/render3d/vfx3d";
import { createCamera, worldToScreen } from "./camera";
import * as characterArt from "./characterArt";
import { createHudState } from "./hud";
import { createMockContext } from "./mockContext";
import { WORLD3D_PARTICLES, drawScene, visualHeight, type OverlayAnchor, type RenderState } from "./renderer";
import { getCharacterRig } from "./chars";
import { makeFighter, makeState, makeStage } from "./testFixtures";
import * as vfx from "./vfx";

vi.mock("./characterArt", async (orig) => ({ ...(await orig<typeof import("./characterArt")>()), drawPortTag: vi.fn() }));
vi.mock("./vfx", async (orig) => {
  const real = await orig<typeof import("./vfx")>();
  return {
    ...real,
    drawDizzyStars: vi.fn(),
    drawFinalSmashAura: vi.fn(),
    drawParticles: vi.fn(real.drawParticles),
  };
});

const dk = FIGHTERS.find((f) => f.id === "donkeyKong")!;
const marth = FIGHTERS.find((f) => f.id === "marth")!;

function stateWith(anchors: readonly (OverlayAnchor | null)[] | undefined, fighters = [
  makeFighter({ port: 0, defId: "donkeyKong", x: fx(-10), action: "shieldBroken", actionFrame: 30 }),
  makeFighter({ port: 1, defId: "marth", x: fx(10), action: "attack", move: "fsmash", actionFrame: 12 }),
]): RenderState {
  return {
    current: makeState({ fighters }),
    previous: null,
    stage: makeStage(),
    fighters: [dk, marth],
    vfx: vfx.createVfx(),
    hud: createHudState(),
    anchors,
  };
}

function particle(kind: vfx.ParticleKind, x: number): vfx.Particle {
  return { kind, x, y: 4, vx: 0.4, vy: 0.2, life: 6, maxLife: 10, size: 1, colour: "#FFEE88", rotation: 0, spin: 0, gravity: 0, drag: 1 };
}

describe("the overlay over the 3D world (Plan 4, MAJOR 5)", () => {
  it("puts port tags, dizzy stars and the Final Smash aura over the model's head bone, not the 2D rig's height", () => {
    vi.clearAllMocks();
    const cam = createCamera();
    const anchors: OverlayAnchor[] = [{ headX: 4, headTop: 26.3 }, { headX: 0.4, headTop: 18.8 }];
    drawScene(createMockContext(), stateWith(anchors), null, cam, 1);
    const tags = vi.mocked(characterArt.drawPortTag).mock.calls;
    expect(tags).toHaveLength(2);
    // DK faces right (+1): his head is 4 units in front of his feet at x = -10.
    const head = worldToScreen(cam, -10 + 4, 26.3 + 1);
    expect(tags[0][1]).toBeCloseTo(head.x, 5);
    expect(tags[0][2]).toBeCloseTo(head.y - 14, 5);
    expect(vi.mocked(vfx.drawDizzyStars).mock.calls[0][3]).toBe(26.3);
    expect(vi.mocked(vfx.drawFinalSmashAura).mock.calls[1][3]).toBe(18.8);
  });

  /** No bake, no anchor: the 2D rig's height stands in, for the tags and stars as for everything else hung on the fighter. */
  it("falls back to the 2D rig's height for a fighter with no anchor", () => {
    vi.clearAllMocks();
    drawScene(createMockContext(), stateWith(undefined), null, createCamera(), 1);
    expect(vi.mocked(vfx.drawDizzyStars).mock.calls[0][3]).toBe(visualHeight(getCharacterRig("donkeyKong")));
  });

  it("reports which fighters a move effect hides, for the 3D layer", () => {
    const kirby = FIGHTERS.find((f) => f.id === "kirby")!;
    const rs: RenderState = {
      ...stateWith([null, null], [
        makeFighter({ port: 0, defId: "donkeyKong", x: fx(-10) }),
        // Kirby's Stone, mid-fall: the stone is drawn instead of him.
        makeFighter({ port: 1, defId: "kirby", x: fx(10), grounded: false, action: "special", move: "downB", actionFrame: 20 }),
      ]),
      fighters: [dk, kirby],
    };
    expect(drawScene(createMockContext(), rs, null, createCamera(), 1)).toEqual({ hidden: [false, true] });
  });
});

/**
 * The Task 18 carry: the sparks and bursts are the 3D layer's sprites
 * (`vfx3d.ts` `SPRITE_KINDS`); drawn again on the overlay, every spark would
 * show twice. The two lists are kept by hand on either side of the three.js
 * line (`render/` never imports three), so they are pinned equal here.
 */
describe("the overlay leaves the 3D layer's particles to it", () => {
  it("names exactly the kinds the 3D layer draws", () => {
    expect([...WORLD3D_PARTICLES].sort()).toEqual([...SPRITE_KINDS].sort());
  });

  it("skips those kinds on the overlay and draws every other particle as before", async () => {
    const real = await vi.importActual<typeof import("./vfx")>("./vfx");
    const cam = createCamera();
    const mixed = real.createVfx();
    mixed.particles.push(particle("spark", 0), particle("burst", 2), particle("dust", 4), particle("ring", 6));
    const skipped = createMockContext();
    real.drawParticles(skipped, mixed, cam, WORLD3D_PARTICLES);
    const rest = real.createVfx();
    rest.particles.push(particle("dust", 4), particle("ring", 6));
    const only = createMockContext();
    real.drawParticles(only, rest, cam);
    expect(skipped.calls).toEqual(only.calls);
    // And without the set, the sparks are drawn: the comparison is not vacuous.
    const all = createMockContext();
    real.drawParticles(all, mixed, cam);
    expect(all.calls.length).toBeGreaterThan(only.calls.length);
  });

  it("is what the overlay passes, with an anchor or without one", () => {
    for (const anchors of [[null, null], undefined]) {
      vi.clearAllMocks();
      drawScene(createMockContext(), stateWith(anchors), null, createCamera(), 1);
      expect(vi.mocked(vfx.drawParticles).mock.calls[0][3]).toBe(WORLD3D_PARTICLES);
    }
  });
});
