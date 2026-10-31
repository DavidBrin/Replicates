/**
 * What Plan 5's mechanics look like (Task 17): a fighter Kirby has swallowed
 * is not drawn, a Final Smash's scene fills the screen, and a reflection or a
 * counter flashes where it happened.
 */

import { describe, expect, it } from "vitest";

import { STRONG_COUNTER_DAMAGE } from "@/engine/counter";
import { fx } from "@/engine/fixed";
import { FOOTSTOOL_GROUND_FRAMES } from "@/engine/footstool";
import type { FighterState } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { blendedPose, clipFrameFor, createPoseBlends } from "./blend";
import { cameraTarget, createCamera, offscreenIndicators } from "./camera";
import { getCharacterRig } from "./characterArt";
import { clipFor } from "./chars/poses";
import { createHudState } from "./hud";
import { createMockContext } from "./mockContext";
import { samplePose, type PoseClip, type PoseSample } from "./poses/clip";
import { poseNameFor, poseTimeFor } from "./poses/timing";
import { render, type RenderState } from "./renderer";
import { resolve, type BoneName, type Rig } from "./skeleton";
import { STRONG_COUNTER_YELLOW, createVfx, stepVfx } from "./vfx";
import { makeDef, makeEvents, makeFighter, makeStage, makeState } from "./testFixtures";

const stage = makeStage();

function renderState(current = makeState()): RenderState {
  return { current, previous: null, stage, fighters: current.fighters.map(() => makeDef()), vfx: createVfx(), hud: createHudState() };
}

describe("a swallowed fighter", () => {
  it("is hidden: it is inside Kirby", () => {
    const state = makeState({ fighters: [makeFighter({ port: 0, action: "inhaleHold" }), makeFighter({ port: 1, action: "swallowed" })] });
    const ctx = createMockContext() as unknown as CanvasRenderingContext2D;
    const { hidden } = render(ctx, renderState(state), null, createCamera(stage), 0);
    expect(hidden).toEqual([false, true]);
  });

  it("gets no magnifying glass: Kirby's shows where it is", () => {
    // Both far off the top of a camera on the stage's middle.
    const fighters = [makeFighter({ port: 0, y: fx(150), action: "inhaleHold" }), makeFighter({ port: 1, y: fx(150), action: "swallowed" })];
    const ports = offscreenIndicators(createCamera(stage), makeState({ fighters }), stage).map((i) => i.port);
    expect(ports).toEqual([0]);
  });
});

describe("a Final Smash's scene", () => {
  it("frames only the fighter using it and the fighters it trapped", () => {
    const fighters = [
      makeFighter({ port: 0, x: fx(-20), action: "special", move: "finalAttack" }),
      makeFighter({ port: 1, x: fx(-5), action: "finalTrapped" }),
      makeFighter({ port: 2, x: fx(150) }),
    ];
    fighters[1].combat.trappedBy = 0;
    const playing = cameraTarget(makeState({ fighters, cinematic: 0 }), stage);
    const not = cameraTarget(makeState({ fighters, cinematic: -1 }), stage);
    expect(playing.zoom).toBeGreaterThan(not.zoom);
    expect(playing.x).toBeLessThan(0);
  });

  it("gives the bystanders it stands still no magnifying glass, and keeps theirs once it is over", () => {
    const fighters = [
      makeFighter({ port: 0, x: fx(-20), action: "special", move: "finalAttack" }),
      makeFighter({ port: 1, x: fx(-5), action: "finalTrapped" }),
      makeFighter({ port: 2, x: fx(150) }),
    ];
    fighters[1].combat.trappedBy = 0;
    const cam = createCamera(stage);
    cam.zoom = 12;
    const during = offscreenIndicators(cam, makeState({ fighters, cinematic: 0 }), stage).map((i) => i.port);
    const after = offscreenIndicators(cam, makeState({ fighters, cinematic: -1 }), stage).map((i) => i.port);
    expect(during).toEqual([]);
    expect(after).toEqual([2]);
  });
});

describe("reflections and counters", () => {
  it("flash where they happened", () => {
    const v = createVfx();
    stepVfx(v, makeEvents({ reflects: [{ port: 0, x: fx(10), y: fx(6) }] }), makeState());
    const reflected = v.particles.length;
    expect(reflected).toBeGreaterThan(0);
    stepVfx(v, makeEvents({ counters: [{ port: 1, x: fx(-10), y: fx(8), damage: fx(5) }] }), makeState());
    expect(v.particles.length).toBeGreaterThan(reflected);
  });

  it("a strong catch, 13% or more, lights its user up yellow; a weaker one does not (SmashWiki \"Counterattack\", \"Marth (SSBU)/Down special\")", () => {
    const yellow = (damage: number) => {
      const v = createVfx();
      const state = makeState({ fighters: [makeFighter({ port: 0, x: fx(-30) }), makeFighter({ port: 1, x: fx(40), action: "special", move: "counterAttack" })] });
      stepVfx(v, makeEvents({ counters: [{ port: 1, x: fx(34), y: fx(8), damage }] }), state);
      return v.particles.filter((p) => p.colour === STRONG_COUNTER_YELLOW);
    };
    expect(yellow(STRONG_COUNTER_DAMAGE - 1)).toHaveLength(0);
    const flash = yellow(STRONG_COUNTER_DAMAGE);
    expect(flash.length).toBeGreaterThan(0);
    // Round the user (port 1, at 40), not at the bubble where it caught.
    const ring = flash.find((p) => p.kind === "ring")!;
    expect(ring.x).toBeCloseTo(40, 0);
    expect(ring.y).toBeGreaterThan(4);
  });
});

describe("jumps that push off something (Task 17)", () => {
  const facing = (port: number, f: 1 | -1, over = {}) => makeState({ fighters: [makeFighter({ port, facing: f, grounded: false, action: "jump", actionFrame: 0, jumpsUsed: 2, ...over })] });

  it("a wall jump kicks a puff off the wall behind the fighter, thrown away from it", () => {
    for (const f of [1, -1] as const) {
      const v = createVfx();
      stepVfx(v, makeEvents({ jumps: [{ port: 0, x: 0, y: fx(20), from: "wall" }] }), facing(0, f));
      const dust = v.particles.filter((p) => p.kind === "dust");
      expect(dust.length).toBeGreaterThan(0);
      const meanX = dust.reduce((a, p) => a + p.x, 0) / dust.length;
      const meanVx = dust.reduce((a, p) => a + p.vx, 0) / dust.length;
      // Behind (the wall), and thrown the way the jump goes.
      expect(Math.sign(meanX)).toBe(-f);
      expect(Math.sign(meanVx)).toBe(f);
      // In the air, where the wall is, not on a floor below.
      expect(Math.min(...dust.map((p) => p.y))).toBeGreaterThan(20);
    }
  });

  it("a footstool stamps a ring and a puff under the jumper's feet", () => {
    const v = createVfx();
    stepVfx(v, makeEvents({ jumps: [{ port: 0, x: fx(3), y: fx(12), from: "head" }] }), facing(0, 1, { jumpsUsed: 1 }));
    expect(v.particles.some((p) => p.kind === "ring" && Math.abs(p.x - 3) < 0.01)).toBe(true);
    expect(v.particles.some((p) => p.kind === "dust")).toBe(true);
  });

  it("a wall jump or a footstool made with the midair jump spent is not a midair jump: no midair ring as well", () => {
    // The midair jump's ring is 2.4 across, 3 over the feet (`trackGroundFx`).
    const midairRings = (v: ReturnType<typeof createVfx>) => v.particles.filter((p) => p.kind === "ring" && p.size === 2.4);
    for (const from of ["wall", "head"] as const) {
      const v = createVfx();
      stepVfx(v, makeEvents({ jumps: [{ port: 0, x: 0, y: fx(20), from }] }), facing(0, 1));
      expect(midairRings(v)).toHaveLength(0);
      expect(v.particles.filter((p) => p.kind === "ring")).toHaveLength(1);
    }
    // The midair jump itself still rings.
    const v = createVfx();
    stepVfx(v, makeEvents(), facing(0, 1));
    expect(midairRings(v)).toHaveLength(1);
  });
});

describe("a helpless fast fall", () => {
  it("shows the fast-fall star as a fall's does (the Task 4b review's polish item)", () => {
    const stars = (action: "fall" | "specialFall", fastFalling: boolean) => {
      const v = createVfx();
      stepVfx(v, null, makeState({ fighters: [makeFighter({ action, actionFrame: 4, fastFalling, grounded: false })] }));
      return v.particles.filter((p) => p.colour === "#9FA6FF");
    };
    expect(stars("fall", true)).toHaveLength(1);
    expect(stars("specialFall", true)).toHaveLength(1);
    expect(stars("specialFall", false)).toHaveLength(0);
  });
});

/**
 * Heights above the stage, in rig units, as `poses/crouch.test.ts` measures them
 * through `resolve()`: the crown, the soles, and every joint, for a clip at `t`.
 */
function stood(clip: PoseClip, t: number, rig: Rig) {
  const s = samplePose(clip, t);
  const sk = resolve(rig, s.angles, { x: 0, y: -s.offsetY, scale: 1, scaleX: s.scaleX, scaleY: s.scaleY, facing: 1 });
  const sole = Math.min(
    ...(["footR", "footL"] as BoneName[]).flatMap((n) => [-sk[n].y0 - rig[n].thickness / 2, -sk[n].y1 - rig[n].thickness / 2]),
  );
  return { crown: -sk.head.y1, sole, hands: [sk.handR, sk.handL].map((h) => ({ x: h.x1, y: -h.y1 })) };
}

/** A fighter's standing crown and soles, over a whole idle cycle. */
function standing(id: string) {
  const rig = getCharacterRig(id).bones;
  const cycle = Array.from({ length: 12 }, (_, i) => stood(clipFor(id, "idle"), i / 12, rig));
  return { crown: cycle.reduce((a, c) => a + c.crown, 0) / cycle.length, sole: Math.min(...cycle.map((c) => c.sole)) };
}

/** The pose drawn on frame `frame` for `f`, faded as a match fades it (D42), through `blends`. */
function drawn(blends: ReturnType<typeof createPoseBlends>, f: FighterState, frame: number): PoseSample {
  const name = poseNameFor(f);
  const at = clipFrameFor(blends, f, name, frame);
  return blendedPose(blends, f, name, samplePose(clipFor(f.defId, name), poseTimeFor(name, { ...f, actionFrame: at }, frame)), frame);
}

describe("Pikachu's crawl (Task 17: the Task 12 review's carry)", () => {
  const rig = getCharacterRig("pikachu").bones;
  const clip = clipFor("pikachu", "crawl");

  it("is a clip of his own, a loop, low to the floor with his soles on it", () => {
    expect(poseNameFor({ action: "crawl", move: null, jumpsUsed: 0, fastFalling: false })).toBe("crawl");
    expect(clip).not.toBe(clipFor("pikachu", "crouch"));
    expect(clip.loop).toBe(true);
    const stand = standing("pikachu");
    const cycle = Array.from({ length: 16 }, (_, i) => stood(clip, i / 16, rig));
    for (const c of cycle) {
      expect(c.crown).toBeLessThan(stand.crown * 0.8);
      expect(c.sole).toBeGreaterThan(stand.sole - 0.35);
    }
  });

  it("paddles: the forepaws trade places along the floor across a cycle", () => {
    const cycle = Array.from({ length: 16 }, (_, i) => stood(clip, i / 16, rig));
    const lead = cycle.map((c) => c.hands[0].x - c.hands[1].x);
    expect(Math.max(...lead)).toBeGreaterThan(0.4);
    expect(Math.min(...lead)).toBeLessThan(-0.4);
  });

  it("fades between a crouch and a crawl, where the shared loop restarted on each switch (the Task 12 review)", () => {
    const blends = createPoseBlends();
    // Crouched to the middle of the crouch's breath (frame 42 of its 84).
    let last!: PoseSample;
    for (let frame = 100; frame <= 104; frame++) last = drawn(blends, makeFighter({ defId: "pikachu", action: "crouch", actionFrame: 38 + (frame - 100) }), frame);
    // The crawl starts on frame 105, its `actionFrame` back at 0.
    const first = drawn(blends, makeFighter({ defId: "pikachu", action: "crawl", actionFrame: 0 }), 105);
    // The first frame of the switch is still the pose on screen, not a cut to
    // frame 0 of a loop: every bone the crouch names, the body's offset and squash.
    for (const [bone, angle] of Object.entries(last.angles)) expect(first.angles[bone as BoneName], bone).toBeCloseTo(angle!, 9);
    expect([first.offsetY, first.scaleX, first.scaleY]).toEqual([last.offsetY, last.scaleX, last.scaleY]);
  });
});

describe("stood on (Task 17: the footstool's \"animation of the player bouncing off their head\")", () => {
  // SmashWiki "Footstool Jump" (https://www.ssbwiki.com/Footstool_Jump): a footstool
  // "briefly freezes the opponent while they are in an animation of the player
  // bouncing off their head".
  const at = (frame: number) => frame / FOOTSTOOL_GROUND_FRAMES;

  it("has a clip of its own, not the grab's struggle", () => {
    expect(poseNameFor({ action: "footstooled", move: null, jumpsUsed: 0, fastFalling: false })).toBe("footstooled");
    expect(clipFor("mario", "footstooled")).not.toBe(clipFor("mario", "grabbed"));
  });

  it.each(FIGHTERS.map((d) => d.id))("%s is squashed under the feet that land on it, then stands back up, its soles on the floor", (id) => {
    const rig = getCharacterRig(id).bones;
    const clip = clipFor(id, "footstooled");
    const stand = standing(id);
    expect(stood(clip, at(0), rig).crown).toBeLessThan(stand.crown * 0.88);
    expect(stood(clip, at(FOOTSTOOL_GROUND_FRAMES - 1), rig).crown).toBeGreaterThan(stand.crown * 0.93);
    // As `crouch.test.ts` holds the crouch: within 0.35 of standing. The standing
    // it ends on is the shared clips' own (`crouchEnd`'s last frame), which sits a
    // rig with a stance of its own (Kirby's) a little lower than its idle.
    const shared = stood(clipFor(id, "crouchEnd"), 4 / 5, rig).sole;
    for (let frame = 0; frame < FOOTSTOOL_GROUND_FRAMES; frame++) {
      expect(stood(clip, at(frame), rig).sole, `frame ${frame}`).toBeGreaterThan(Math.min(stand.sole, shared) - 0.35);
    }
  });

  it("arrives at once, as anything done to a fighter does (`blend.ts`: imposed)", () => {
    const blends = createPoseBlends();
    for (let frame = 100; frame <= 104; frame++) drawn(blends, makeFighter({ action: "stand", actionFrame: frame }), frame);
    const f = makeFighter({ action: "footstooled", actionFrame: 0 });
    expect(drawn(blends, f, 105)).toEqual(samplePose(clipFor("mario", "footstooled"), 0));
  });
});
