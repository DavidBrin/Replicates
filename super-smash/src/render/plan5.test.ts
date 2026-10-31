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
import { FINAL_LAB } from "@/game/goldenFinalLab";
import { STAGES } from "@/stages";
import { blendedPose, clipFrameFor, createPoseBlends } from "./blend";
import {
  FIGHTER_UNITS,
  SCENE_FIGHTER_UNITS,
  SCENE_MARGIN_Y,
  SCENE_MAX_ZOOM,
  VIEW_HEIGHT,
  cameraTarget,
  createCamera,
  offscreenIndicators,
  updateCamera,
  visibleBounds,
} from "./camera";
import { getCharacterRig } from "./characterArt";
import { clipFor } from "./chars/poses";
import { createHudState, drawHud, sceneHidesDamage } from "./hud";
import { assignmentsTo, callsOf, createMockContext } from "./mockContext";
import { samplePose, type PoseClip, type PoseSample } from "./poses/clip";
import { poseNameFor, poseTimeFor } from "./poses/timing";
import { render, sceneDrawShift, sceneShiftAt, type RenderState } from "./renderer";
import { resolve, type BoneName, type Rig } from "./skeleton";
import { STRONG_COUNTER_YELLOW, createVfx, drawParticles, stepVfx } from "./vfx";
import { WORLD3D_PARTICLES } from "./renderer";
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

  it("takes its port tag with it (the overlay draws nothing of it)", () => {
    // "P2" is written twice for a fighter on screen: its tag, and its damage panel's label.
    const written = (action: FighterState["action"], text: string) => {
      const ctx = createMockContext();
      const state = makeState({ fighters: [makeFighter({ port: 0, action: "inhaleHold" }), makeFighter({ port: 1, action })] });
      render(ctx as unknown as CanvasRenderingContext2D, renderState(state), null, createCamera(stage), 0);
      return callsOf(ctx, "fillText").filter((c) => c.args[0] === text).length;
    };
    expect(written("swallowed", "P2")).toBe(written("stand", "P2") - 1);
    expect(written("swallowed", "P1")).toBe(written("stand", "P1"));
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

  /** The scene's 1v1 as the golden Final Smash lab stages it: Donkey Kong at −30, Mario trapped at −12 where he was caught. */
  function finalLab() {
    const fd = STAGES.find((s) => s.id === "finalDestination")!;
    const state = makeState({ stageId: "finalDestination", fighters: [makeFighter({ port: 0, defId: "donkeyKong" }), makeFighter({ port: 1 })] });
    FINAL_LAB.setup!(state);
    Object.assign(state.fighters[0], { action: "special", move: "finalAttack" });
    Object.assign(state.fighters[1], { action: "finalTrapped" });
    state.fighters[1].combat.trappedBy = 0;
    return { fd, state };
  }

  /** Every framed fighter, feet to `FIGHTER_UNITS` above them, inside the view a target gives. */
  function framed(fd: ReturnType<typeof finalLab>["fd"], target: ReturnType<typeof cameraTarget>, fighters: readonly FighterState[]) {
    const v = visibleBounds({ ...createCamera(fd), x: target.x, y: target.y, zoom: target.zoom });
    return fighters.every((f) => {
      const x = f.x / 4096;
      const y = f.y / 4096;
      return x >= v.left && x <= v.right && y >= v.bottom && y + FIGHTER_UNITS <= v.top;
    });
  }

  it("closes in on a one-on-one: at least 1.4 times the zoom outside it, both fighters in the frame (ruling R-T17c)", () => {
    const { fd, state } = finalLab();
    const scene = cameraTarget({ ...state, cinematic: 0 }, fd);
    const plain = cameraTarget({ ...state, cinematic: -1 }, fd);
    expect(scene.zoom).toBeGreaterThanOrEqual(plain.zoom * 1.4);
    // The lab's pair, 18 apart, is framed by its height, not its width: the
    // close-up's tight side margins leave room across.
    expect(scene.zoom).toBeCloseTo(VIEW_HEIGHT / (SCENE_FIGHTER_UNITS + 2 * SCENE_MARGIN_Y), 9);
    expect(scene.zoom).toBeLessThanOrEqual(SCENE_MAX_ZOOM);
    expect(framed(fd, scene, state.fighters)).toBe(true);
    // Centred on the pair, not on the fighter using it.
    expect(scene.x).toBeCloseTo((-30 + -12) / 2, 1);
  });

  it("keeps a trapped fighter caught far off in the frame, and its own glass", () => {
    const { fd, state } = finalLab();
    Object.assign(state.fighters[1], { x: fx(40) });
    const scene = cameraTarget({ ...state, cinematic: 0 }, fd);
    expect(framed(fd, scene, state.fighters)).toBe(true);
    // A camera still on Donkey Kong alone leaves Mario off screen: the glass is his.
    const cam = { ...createCamera(fd), x: -30, y: 6, zoom: SCENE_MAX_ZOOM };
    expect(offscreenIndicators(cam, { ...state, cinematic: 0 }, fd).map((i) => i.port)).toEqual([1]);
  });

  it("gets there quickly: within a tenth of the close-up's zoom in 30 frames (presentation choice)", () => {
    const { fd, state } = finalLab();
    const cam = createCamera(fd);
    for (let i = 0; i < 120; i++) updateCamera(cam, { ...state, cinematic: -1 }, fd, null);
    const target = cameraTarget({ ...state, cinematic: 0 }, fd).zoom;
    for (let i = 0; i < 30; i++) updateCamera(cam, { ...state, cinematic: 0 }, fd, null);
    expect(cam.zoom).toBeGreaterThan(target * 0.9);
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

describe("a Final Smash's end hit (ruling R-T17j)", () => {
  const fd = STAGES.find((st) => st.id === "finalDestination")!;
  const def = (id: string) => FIGHTERS.find((d) => d.id === id)!;
  const hit = (attacker: number, x: number, y: number) =>
    makeEvents({
      hits: [{ attacker, victim: 1, damage: fx(20), x: fx(x - 1), y: fx(y - 1), contactX: fx(x), contactY: fx(y), knockback: fx(150), angle: fx(40), hitboxId: 0 }],
    });
  /** `user` at −30 in `move`, Mario 10 ahead frozen in its launch's hitlag. */
  function launch(user: string, move: "finalAttack" | "finalEnd" | "fsmash", cinematic = -1) {
    const state = makeState({
      stageId: "finalDestination",
      cinematic,
      fighters: [
        makeFighter({ port: 0, defId: user, x: fx(-30), facing: 1, action: move === "fsmash" ? "attack" : "special", move }),
        makeFighter({ port: 1, x: fx(-20), facing: -1, action: "tumble", hitlag: 30, hitstun: 60 }),
      ],
    });
    state.fighters[1].combat.launchSource = 0;
    return { state, defs: [def(user), def("mario")] };
  }

  it("punches in where it lands, from the move's own data: an end part's hit, no fighter named", () => {
    for (const user of ["donkeyKong", "fox", "kirby", "pikachu", "marth"]) {
      const { state, defs } = launch(user, "finalEnd");
      const cam = createCamera(fd);
      updateCamera(cam, state, fd, hit(0, -21, 9), defs);
      expect(cam.koZoom.active, user).toBe(true);
      expect([cam.koZoom.x, cam.koZoom.y], user).toEqual([-21, 9]);
    }
    // Not a scene's other hits, nor an ordinary move's, nor without the moves to read.
    const notThese = [launch("pikachu", "finalAttack"), launch("marth", "fsmash")];
    for (const { state, defs } of notThese) {
      const cam = createCamera(fd);
      updateCamera(cam, state, fd, hit(0, -21, 9), defs);
      expect(cam.koZoom.active).toBe(false);
    }
    const { state } = launch("marth", "finalEnd");
    const cam = createCamera(fd);
    updateCamera(cam, state, fd, hit(0, -21, 9));
    expect(cam.koZoom.active).toBe(false);
  });

  it("gives Critical Hit's two-frame scene a close-up through Marth's hit freeze: 1.4 times the zoom without it", () => {
    const { state, defs } = launch("marth", "finalEnd");
    const cam = createCamera(fd);
    for (let i = 0; i < 120; i++) updateCamera(cam, state, fd, null, defs);
    const plain = cam.zoom;
    updateCamera(cam, state, fd, hit(0, -21, 9), defs);
    for (let i = 1; i < 30; i++) updateCamera(cam, state, fd, null, defs);
    expect(cam.zoom).toBeGreaterThanOrEqual(plain * 1.4);
  });

  it("keeps the other four's close-up through the launch: no zoom out on contact as the scene ends", () => {
    for (const user of ["donkeyKong", "fox", "kirby", "pikachu"]) {
      const { state, defs } = launch(user, "finalEnd", 0);
      Object.assign(state.fighters[1], { action: "finalTrapped", hitlag: 0, hitstun: 0 });
      state.fighters[1].combat.trappedBy = 0;
      const cam = createCamera(fd);
      for (let i = 0; i < 120; i++) updateCamera(cam, state, fd, null, defs);
      const scene = cam.zoom;
      // Launched: the scene is over (`GameState.cinematic`), Mario frozen in the hitlag.
      const after = launch(user, "finalEnd");
      updateCamera(cam, after.state, fd, hit(0, -21, 9), defs);
      for (let i = 1; i < 15; i++) {
        updateCamera(cam, after.state, fd, null, defs);
        expect(cam.zoom, `${user} ${i}`).toBeGreaterThanOrEqual(scene * 0.97);
      }
    }
  });
});

describe("Team Star Fox's scene (ruling R-T17e)", () => {
  // SmashWiki "Final Smash" (https://www.ssbwiki.com/Final_Smash), Trivia: "In
  // Ultimate, seven Final Smashes remove the damage percentage, either due to the
  // presence of text boxes or pre-rendered cutscenes, these being All-Out Attack,
  // Triple Finish, Team Star Fox, Team Star Wolf, Gigaslash, House of Boom, and
  // Supernova"; only the last four "for the entire duration of the move".
  const def = (id: string) => FIGHTERS.find((d) => d.id === id)!;
  function scene(userId: string, move: "finalSmash" | "finalAttack" | "finalEnd", cinematic: number) {
    const state = makeState({ cinematic, fighters: [makeFighter({ port: 0, defId: userId, action: "special", move }), makeFighter({ port: 1, action: "finalTrapped" })] });
    state.fighters[1].combat.trappedBy = 0;
    return { state, defs: [def(userId), def("mario")] };
  }
  /** Damage panels drawn: each writes its port's tag under the percent. */
  function panels({ state, defs }: ReturnType<typeof scene>): number {
    const ctx = createMockContext();
    drawHud(ctx as unknown as CanvasRenderingContext2D, { state, info: defs.map((d) => ({ def: d, label: d.name, isCpu: false })), hud: createHudState() });
    return callsOf(ctx, "fillText").filter((c) => c.args[0] === "P1" || c.args[0] === "P2").length;
  }

  it("takes the damage percentages off while its scene plays, as data on the move", () => {
    expect(sceneHidesDamage(scene("fox", "finalAttack", 0).state, scene("fox", "finalAttack", 0).defs)).toBe(true);
    expect(panels(scene("fox", "finalAttack", 0))).toBe(0);
    expect(panels(scene("fox", "finalEnd", 0))).toBe(0);
    // Not before the scene (its start part), nor once it is over.
    expect(panels(scene("fox", "finalSmash", -1))).toBe(2);
    expect(panels(scene("fox", "finalAttack", -1))).toBe(2);
  });

  it("leaves them for the other four cinematic Final Smashes", () => {
    for (const id of ["donkeyKong", "marth", "kirby", "pikachu"]) {
      expect(sceneHidesDamage(scene(id, "finalAttack", 0).state, scene(id, "finalAttack", 0).defs), id).toBe(false);
      expect(panels(scene(id, "finalAttack", 0)), id).toBe(2);
    }
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

  it("lights a strong catch's user up brightly: an additive yellow glow on the overlay, full strength at its heart (ruling R-T17f)", () => {
    const flash = (damage: number) => {
      const v = createVfx();
      const state = makeState({ fighters: [makeFighter({ port: 0, x: fx(-30) }), makeFighter({ port: 1, x: fx(40) })] });
      stepVfx(v, makeEvents({ counters: [{ port: 1, x: fx(34), y: fx(8), damage }] }), state);
      const ctx = createMockContext();
      drawParticles(ctx as unknown as CanvasRenderingContext2D, v, createCamera(stage), WORLD3D_PARTICLES);
      return ctx;
    };
    const strong = flash(STRONG_COUNTER_DAMAGE);
    expect(assignmentsTo(strong, "globalCompositeOperation")).toContain("lighter");
    const stops = callsOf(strong, "addColorStop").map((c) => c.args as [number, string]);
    // Its heart: the flash's yellow, nearly opaque, a frame after the catch.
    const heart = stops.find(([offset, colour]) => offset === 0 && colour.startsWith("rgba(255, 225, 74, "));
    expect(heart).toBeDefined();
    expect(Number(heart![1].slice(heart![1].lastIndexOf(",") + 1, -1))).toBeGreaterThan(0.9);
    // A weak catch has none of it.
    expect(assignmentsTo(flash(STRONG_COUNTER_DAMAGE - 1), "globalCompositeOperation")).not.toContain("lighter");
  });

  it("thins its rim away instead of fading it through dark gold over the dark stage (the re-review's N3)", () => {
    const v = createVfx();
    const state = makeState({ fighters: [makeFighter({ port: 0, x: fx(-30) }), makeFighter({ port: 1, x: fx(40) })] });
    stepVfx(v, makeEvents({ counters: [{ port: 1, x: fx(34), y: fx(8), damage: STRONG_COUNTER_DAMAGE }] }), state);
    const rims: { alpha: number; width: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const ctx = createMockContext();
      drawParticles(ctx as unknown as CanvasRenderingContext2D, v, createCamera(stage), WORLD3D_PARTICLES);
      let width = 0;
      for (const c of ctx.calls) {
        if (c.method === "set:lineWidth") width = Number(c.args[0]);
        if (c.method === "set:strokeStyle" && String(c.args[0]).startsWith("rgba(255, 225, 74, ")) {
          const colour = String(c.args[0]);
          rims.push({ alpha: Number(colour.slice(colour.lastIndexOf(",") + 1, -1)), width: NaN });
        }
        if (c.method === "stroke" && rims.length > 0 && Number.isNaN(rims.at(-1)!.width)) rims.at(-1)!.width = width;
      }
      stepVfx(v, makeEvents(), state);
    }
    expect(rims.length).toBeGreaterThan(10);
    const widest = rims[0].width;
    // Opaque while it is wide; by the time it fades it is a hairline.
    for (const rim of rims) {
      if (rim.width > widest * 0.4) expect(rim.alpha).toBe(1);
      if (rim.alpha < 1) expect(rim.width).toBeLessThanOrEqual(widest * 0.4);
    }
    for (let i = 1; i < rims.length; i++) expect(rims[i].width).toBeLessThanOrEqual(rims[i - 1].width);
  });

  it("start where they happened: a reflection's clank and a counter's burst at the event's point", () => {
    const at = (p: { x: number; y: number }, x: number, y: number) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9;
    const v = createVfx();
    // Spawned, not yet aged: `ingestEvents` alone.
    stepVfx(v, makeEvents({ reflects: [{ port: 0, x: fx(10), y: fx(6) }] }), makeState({ fighters: [makeFighter({ port: 0, x: fx(-30) })] }));
    const clank = v.particles.find((p) => p.kind === "clank")!;
    expect(at(clank, 10, 6)).toBe(true);
    const w = createVfx();
    stepVfx(w, makeEvents({ counters: [{ port: 1, x: fx(-10), y: fx(8), damage: fx(5) }] }), makeState({ fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, x: fx(30) })] }));
    // The burst's ring stays where it was spawned; its sparks fly out from there.
    const ring = w.particles.find((p) => p.kind === "ring")!;
    expect(at(ring, -10, 8)).toBe(true);
    const sparks = w.particles.filter((p) => p.kind === "spark");
    expect(sparks.length).toBeGreaterThan(0);
    // One `updateVfx` has run since: x += vx, y += vy, then vy += gravity and both × drag.
    for (const p of sparks) expect(Math.hypot(p.x - p.vx / p.drag + 10, p.y - (p.vy / p.drag - p.gravity) - 8)).toBeLessThan(1e-6);
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
    const glow = flash.find((p) => p.kind === "glow")!;
    expect(glow.x).toBeCloseTo(40, 0);
    expect(glow.y).toBeGreaterThan(4);
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
    expect(v.particles.some((p) => p.kind === "ring" && Math.abs(p.x - 3) < 0.01 && Math.abs(p.y - 12) < 0.01)).toBe(true);
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

  it("suppresses the jumper's midair ring alone: another fighter's midair jump on the same frame still rings", () => {
    const v = createVfx();
    const state = makeState({
      fighters: [
        makeFighter({ port: 0, x: fx(-20), grounded: false, action: "jump", actionFrame: 0, jumpsUsed: 2 }),
        makeFighter({ port: 1, x: fx(30), grounded: false, action: "jump", actionFrame: 0, jumpsUsed: 2 }),
      ],
    });
    stepVfx(v, makeEvents({ jumps: [{ port: 0, x: fx(-20), y: 0, from: "wall" }] }), state);
    const midair = v.particles.filter((p) => p.kind === "ring" && p.size === 2.4);
    expect(midair).toHaveLength(1);
    expect(midair[0].x).toBeCloseTo(30, 9);
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

describe("Jungle Rush's barrage (ruling R-T17d)", () => {
  it("plays clips of Donkey Kong's own that punch in place; every other scene keeps the neutral special's", () => {
    for (const d of FIGHTERS) {
      for (const part of ["finalAttack", "finalEnd"] as const) {
        const clip = clipFor(d.id, part);
        if (d.id === "donkeyKong") expect(clip, `${d.id} ${part}`).not.toBe(clipFor(d.id, "neutralB"));
        else expect(clip, `${d.id} ${part}`).toBe(clipFor(d.id, "neutralB"));
      }
    }
    expect(poseNameFor({ action: "special", move: "finalAttack", jumpsUsed: 0, fastFalling: false })).toBe("finalAttack");
    expect(poseNameFor({ action: "special", move: "finalEnd", jumpsUsed: 0, fastFalling: false })).toBe("finalEnd");
    // In place: no lunge forward, and the spine never dives (the Giant Punch's
    // contact pitches it 62 degrees and carries his chest and arm through Mario).
    for (const part of ["finalAttack", "finalEnd"] as const) {
      for (const k of clipFor("donkeyKong", part).keys) {
        expect(k.offsetX ?? 0, part).toBeLessThanOrEqual(0.2);
        expect(((k.pose.hip ?? 0) + (k.pose.torso ?? 0)) * (180 / Math.PI), part).toBeLessThanOrEqual(36);
      }
    }
  });

  it("draws Donkey Kong back from a fighter trapped closer than his 12 units, and only then (presentation; the sim keeps both where they are)", () => {
    const dk = FIGHTERS.find((d) => d.id === "donkeyKong")!;
    const defs = [dk, FIGHTERS.find((d) => d.id === "mario")!];
    const shift = (gap: number, facing: 1 | -1, cinematic = 0, move: "finalAttack" | "finalEnd" | "finalSmash" = "finalAttack") => {
      const state = makeState({
        cinematic,
        fighters: [
          makeFighter({ port: 0, defId: "donkeyKong", x: fx(-30), facing, action: "special", move }),
          makeFighter({ port: 1, x: fx(-30 + facing * gap), facing: -facing as 1 | -1, action: "finalTrapped" }),
        ],
      });
      state.fighters[1].combat.trappedBy = 0;
      return sceneDrawShift(state, defs);
    };
    // 9 ahead: three units back, the way he faces away; the trapped one stays put.
    expect(shift(9, 1)).toEqual([-3, 0]);
    expect(shift(9, -1)).toEqual([3, 0]);
    // The uppercut keeps 13 (ruling R-T17i).
    expect(shift(8, 1, 0, "finalEnd")).toEqual([-5, 0]);
    // At 12 and beyond: nowhere.
    expect(shift(12, 1)).toEqual([0, 0]);
    expect(shift(18, 1)).toEqual([0, 0]);
    // The start part holds its lunge after the trap: 19 there (ruling R-T17i),
    // with the scene not yet begun (`GameState.cinematic` is the scene's parts').
    expect(shift(9, 1, -1, "finalSmash")).toEqual([-10, 0]);
    expect(shift(9, 1, -1)).toEqual([-3, 0]);
  });

  describe("every cinematic scene keeps its user off the fighter it holds (ruling R-T17i)", () => {
    const def = (id: string) => FIGHTERS.find((d) => d.id === id)!;
    /** Port 0 using `user`'s `move`, facing right at −30; Mario `ahead` of it, set up by `as`. */
    function shiftOf(
      user: string,
      move: "finalSmash" | "finalAttack" | "finalEnd",
      ahead: number,
      as: (mario: FighterState) => void,
      y = 0,
      tops?: readonly (number | null)[],
    ) {
      const state = makeState({
        cinematic: -1,
        fighters: [
          makeFighter({ port: 0, defId: user, x: fx(-30), facing: 1, action: "special", move }),
          makeFighter({ port: 1, x: fx(-30 + ahead), y: fx(y), facing: -1, action: "tumble" }),
        ],
      });
      as(state.fighters[1]);
      return sceneDrawShift(state, [def(user), def("mario")], tops)[0];
    }
    const trapped = (m: FighterState) => {
      m.action = "finalTrapped";
      m.combat.trappedBy = 0;
    };
    const frozen = (m: FighterState) => {
      m.combat.launchSource = 0;
      m.hitlag = 20;
      m.hitstun = 40;
    };
    const flying = (m: FighterState) => {
      m.combat.launchSource = 0;
      m.hitstun = 40;
    };

    it("gives every one of them a gap, in every part, from the probe of their clips at their real trap distances", () => {
      const gaps = Object.fromEntries(
        FIGHTERS.flatMap((d) =>
          Object.entries(d.moves)
            .filter(([, m]) => m?.final?.trap !== undefined || m?.final?.phase === "attack" || m?.final?.phase === "end")
            .map(([slot, m]) => [`${d.id} ${slot}`, m!.final!.sceneGap === undefined ? undefined : m!.final!.sceneGap / 4096]),
        ),
      );
      expect(gaps).toEqual({
        "donkeyKong finalSmash": 19,
        "donkeyKong finalAttack": 12,
        "donkeyKong finalEnd": 13,
        "fox finalSmash": 6,
        "fox finalAttack": 10,
        "fox finalEnd": 9,
        "kirby finalSmash": 8,
        "kirby finalAttack": 8,
        "kirby finalEnd": 9,
        "pikachu finalSmash": 8,
        "pikachu finalAttack": 13,
        "pikachu finalEnd": 15,
        "marth finalSmash": 13,
        "marth finalEnd": 13,
      });
    });

    it("draws the user on, away from a fighter trapped behind it (Marth's dash can carry him past)", () => {
      expect(shiftOf("marth", "finalEnd", -4, trapped)).toBe(9);
      expect(shiftOf("marth", "finalEnd", 4, trapped)).toBe(-9);
      expect(shiftOf("marth", "finalEnd", -14, trapped)).toBe(0);
    });

    it("keeps clear of the fighter its scene launched while the launch's hitlag freezes it, and on as it starts to fly, until it is the gap above (no drawn tops to go by)", () => {
      expect(shiftOf("pikachu", "finalEnd", 8, frozen)).toBe(-7);
      expect(shiftOf("pikachu", "finalEnd", 8, frozen, 30)).toBe(-7);
      expect(shiftOf("pikachu", "finalEnd", 8, flying)).toBe(-7);
      expect(shiftOf("pikachu", "finalEnd", 8, flying, 14)).toBe(-7);
      expect(shiftOf("pikachu", "finalEnd", 8, flying, 15)).toBe(0);
      expect(shiftOf("pikachu", "finalEnd", 8, flying, -15)).toBe(0);
      expect(shiftOf("pikachu", "finalEnd", 16, flying)).toBe(0);
      // Landed: out of hitstun, it is nobody's to keep clear of.
      expect(shiftOf("pikachu", "finalEnd", 8, (m) => ((m.combat.launchSource = 0), (m.action = "stand")))).toBe(0);
    });

    it("keeps clear of it in flight while it is level with the user's drawn body, from the drawn tops the runner hands it: over Donkey Kong's uppercut fist", () => {
      // Mario flying up 25 above, 2 ahead: under the raised fist (44 up), so held, 13 off.
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, 25, [44, 18])).toBe(-11);
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, 43.5, [44, 18])).toBe(-11);
      // Above it, clear.
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, 44, [44, 18])).toBe(0);
      // Below the user: held while the victim's own drawn top reaches its feet.
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, -17.5, [44, 18])).toBe(-11);
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, -18, [44, 18])).toBe(0);
      // With no tops to go by, the gap above or below.
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, 25)).toBe(0);
      expect(shiftOf("donkeyKong", "finalEnd", 2, flying, 12.5)).toBe(-11);
    });

    it("measures between where the two are drawn, between the last step and this one, as this step decides who holds whom", () => {
      const fox = def("fox");
      /** Fox in Team Star Fox's end (gap 9) at −30; Mario `before` and now. */
      const pair = (before: (m: FighterState) => void, now: (m: FighterState) => void) => {
        const make = (as: (m: FighterState) => void) => {
          const state = makeState({
            fighters: [
              makeFighter({ port: 0, defId: "fox", x: fx(-30), facing: 1, action: "special", move: "finalEnd" }),
              makeFighter({ port: 1, x: fx(-28), facing: -1 }),
            ],
          });
          as(state.fighters[1]);
          return state;
        };
        return { previous: make(before), current: make(now), fighters: [fox, def("mario")] };
      };
      // The launch fires: Mario trapped 2 ahead, then 12.8 ahead and 14.5 up, flying.
      const launch = pair(trapped, (m) => {
        flying(m);
        Object.assign(m, { action: "tumble", x: fx(-30 + 12.8), y: fx(14.5) });
      });
      expect(sceneShiftAt(launch, 0)[0]).toBeCloseTo(-7, 9);
      expect(sceneShiftAt(launch, 0.5)[0]).toBeCloseTo(-(9 - 7.4), 3);
      expect(sceneShiftAt(launch, 1)[0]).toBe(0);
      expect(sceneShiftAt({ ...launch, previous: null }, 0)[0]).toBe(0);
      // The trap lands: Mario standing 2 ahead, then trapped there. This step decides.
      const trap = pair(() => {}, trapped);
      expect(sceneShiftAt(trap, 0)[0]).toBe(-7);
    });

    it("but not one launched by somebody else, nor in a start part, whose hits trap and launch nobody", () => {
      expect(shiftOf("pikachu", "finalEnd", 8, (m) => (frozen(m), (m.combat.launchSource = 2)))).toBe(0);
      expect(shiftOf("pikachu", "finalEnd", 8, (m) => (frozen(m), (m.combat.launchSource = 1001)))).toBe(0);
      expect(shiftOf("pikachu", "finalEnd", 8, (m) => (trapped(m), (m.combat.trappedBy = 2)))).toBe(0);
      expect(shiftOf("pikachu", "finalSmash", 4, frozen)).toBe(0);
      expect(shiftOf("pikachu", "finalSmash", 4, trapped)).toBe(-4);
    });

    it("draws nobody else off, and nothing for a part that names no gap: Mario's, Link's and Samus's single parts", () => {
      const state = makeState({
        fighters: [
          makeFighter({ port: 0, defId: "pikachu", x: fx(-30), facing: 1, action: "special", move: "finalEnd" }),
          makeFighter({ port: 1, x: fx(-26), action: "finalTrapped" }),
          makeFighter({ port: 2, defId: "samus", x: fx(40), facing: -1, action: "special", move: "finalSmash" }),
          makeFighter({ port: 3, x: fx(38), facing: 1, action: "tumble" }),
        ],
      });
      state.fighters[1].combat.trappedBy = 0;
      Object.assign(state.fighters[3], { hitlag: 10, hitstun: 30 });
      state.fighters[3].combat.launchSource = 2;
      expect(sceneDrawShift(state, [def("pikachu"), def("mario"), def("samus"), def("mario")])).toEqual([-11, 0, 0, 0]);
    });
  });

  it("draws the overlay there too: Donkey Kong's tag moves back with him", () => {
    const defs = [FIGHTERS.find((d) => d.id === "donkeyKong")!, FIGHTERS.find((d) => d.id === "mario")!];
    const tagX = (held: boolean) => {
      const state = makeState({
        cinematic: held ? 0 : -1,
        fighters: [
          makeFighter({ port: 0, defId: "donkeyKong", x: fx(-30), facing: 1, action: "special", move: "finalAttack", actionFrame: 10 }),
          makeFighter({ port: 1, x: fx(-21), facing: -1, action: held ? "finalTrapped" : "stand", actionFrame: 10 }),
        ],
      });
      state.fighters[1].combat.trappedBy = held ? 0 : -1;
      const ctx = createMockContext();
      const cam = createCamera(stage);
      render(ctx as unknown as CanvasRenderingContext2D, { ...renderState(state), fighters: defs }, null, cam, 0);
      return { x: callsOf(ctx, "fillText").find((c) => c.args[0] === "P1")!.args[1] as number, zoom: cam.zoom };
    };
    const scene = tagX(true);
    const plain = tagX(false);
    expect(scene.x - plain.x).toBeCloseTo(-3 * scene.zoom, 6);
  });

  it("draws the overlay off a flying fighter by the drawn tops it is handed: the tag stays backed off under the uppercut's fist", () => {
    const defs = [FIGHTERS.find((d) => d.id === "donkeyKong")!, FIGHTERS.find((d) => d.id === "mario")!];
    const tagX = (tops?: number[]) => {
      const state = makeState({
        cinematic: -1,
        fighters: [
          makeFighter({ port: 0, defId: "donkeyKong", x: fx(-30), facing: 1, action: "special", move: "finalEnd", actionFrame: 8 }),
          makeFighter({ port: 1, x: fx(-28), y: fx(25), facing: -1, action: "tumble", hitstun: 40 }),
        ],
      });
      state.fighters[1].combat.launchSource = 0;
      const ctx = createMockContext();
      const cam = createCamera(stage);
      render(ctx as unknown as CanvasRenderingContext2D, { ...renderState(state), fighters: defs, ...(tops ? { tops } : {}) }, null, cam, 0);
      return { x: callsOf(ctx, "fillText").find((c) => c.args[0] === "P1")!.args[1] as number, zoom: cam.zoom };
    };
    const held = tagX([44, 18]);
    const plain = tagX();
    expect(held.x - plain.x).toBeCloseTo(-11 * held.zoom, 6);
  });

  it("draws the overlay where the shift is measured between the drawn positions: at the start of a launch's step, still backed off", () => {
    const defs = [FIGHTERS.find((d) => d.id === "fox")!, FIGHTERS.find((d) => d.id === "mario")!];
    const make = (launched: boolean) => {
      const state = makeState({
        fighters: [
          makeFighter({ port: 0, defId: "fox", x: fx(-30), facing: 1, action: "special", move: "finalEnd", actionFrame: 2 }),
          makeFighter({ port: 1, x: fx(launched ? -17.2 : -28), y: fx(launched ? 14.5 : 0), facing: -1, action: launched ? "tumble" : "finalTrapped", hitstun: launched ? 40 : 0 }),
        ],
      });
      state.fighters[1].combat.trappedBy = launched ? -1 : 0;
      state.fighters[1].combat.launchSource = launched ? 0 : -1;
      return state;
    };
    const tagX = (alpha: number) => {
      const ctx = createMockContext();
      const cam = createCamera(stage);
      render(ctx as unknown as CanvasRenderingContext2D, { ...renderState(make(true)), previous: make(false), fighters: defs }, null, cam, alpha);
      return { x: callsOf(ctx, "fillText").find((c) => c.args[0] === "P1")!.args[1] as number, zoom: cam.zoom };
    };
    const start = tagX(0);
    const end = tagX(1);
    expect(start.x - end.x).toBeCloseTo(-7 * start.zoom, 6);
  });
});
