// @vitest-environment node
import { describe, expect, it } from "vitest";

import { airDodgeCharge, airDodgeIntangible, airDodgeOf } from "@/engine/airDodge";
import { BONE_POSE_STRIDE } from "@/engine/acmd/bones";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { clipTimeOfFrame, MOTION_OF_ACTION, OPEN_ENDED_FRAMES, poseIndexOf, statusDuration, statusMotion, type ClockedFighter } from "@/engine/acmd/poseClock";
import { dodgeIntangible, groundDodgeOf, ROLL_BACK, ROLL_FORWARD, rollOf } from "@/engine/groundDodge";
import { STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import type { ActionState, FighterDef } from "@/engine/types";
import { FIGHTERS, getFighter } from "@/fighters";
import { airDodgeClipTime } from "@/render/poses/airDodge";
import { rollClipTime, rollTurnTime, spotDodgeClipTime } from "@/render/poses/groundDodgeTime";
import { actionDurationFor, jumpTimingFor, poseSpinFor, samplePoseForFighter, type PosedFighter } from "@/render/poses/timing";
import { SKELETONS } from "../skeletons";
import {
  attackClipTime,
  bakeFighter,
  fighterPoser,
  motionSamplers,
  moveSamplers,
  poseWorld,
  sampleAt,
  statusMotionSpecs,
  statusSamplers,
  type StatusMotionSpec,
} from "./bake";
import { sideBonePose } from "./fk";
import { referenceScriptBones } from "./roster";

const ACTIONS = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
const DODGES: readonly ActionState[] = ["airDodge", "roll", "spotDodge"];

/** Every `charge` the sim gives each dodge: a stick direction (`airDodgeCharge`), a roll's way, none. */
const SIM_CHARGES: Readonly<Partial<Record<ActionState, readonly number[]>>> = {
  airDodge: [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => airDodgeCharge(x, y))),
  roll: [ROLL_FORWARD, ROLL_BACK],
  spotDodge: [0],
};

const fighterOf = (id: string): FighterDef => getFighter(id)!;

/** A fighter in `spec`'s status on `actionFrame`, as the 2D renderer is handed one. */
function posedAt(id: string, spec: StatusMotionSpec, actionFrame: number): PosedFighter {
  return {
    defId: id,
    action: spec.action,
    actionFrame,
    move: null,
    port: 0,
    charge: spec.charge,
    jumpsUsed: spec.jumpsUsed,
    fastFalling: spec.fastFalling,
    hitstun: 0,
    vx: 0,
    vy: 0,
    shortHop: false,
  };
}

const dodgeSpecs = (): StatusMotionSpec[] => statusMotionSpecs().filter((s) => DODGES.includes(s.action));

/** What the 2D renderer draws on `actionFrame`, before any blend: the sample and the whole-body spin (`renderer.ts`). */
function drawn2d(def: FighterDef, spec: StatusMotionSpec, actionFrame: number) {
  const f = posedAt(def.id, spec, actionFrame);
  const jump = jumpTimingFor(def);
  return { sample: samplePoseForFighter(f, 0, undefined, jump), spin: poseSpinFor(f, 0, undefined, jump) };
}

describe("the status motions the bake plays (DISPATCH-NOTES 10.3, ruling R4)", () => {
  it("are every motion statusMotion can name, each once: 57 over the 59 actions, tumbleFall among them", () => {
    const named = new Set<string>();
    for (const action of ACTIONS) {
      for (let charge = -3; charge <= 20; charge++) {
        for (const jumpsUsed of [0, 1, 2, 3]) {
          for (const fastFalling of [false, true]) named.add(statusMotion({ action, charge, jumpsUsed, fastFalling }));
        }
      }
    }
    const specs = statusMotionSpecs();
    // Plan 5, Task 8: two actions more, the carry and the carried, and no motion
    // more: they play the walk's and the grab's (`MOTION_OF_ACTION`; fix round 1,
    // ruling R-T8c: their own motions were byte-identical copies). Task 9: three
    // more, Kirby's mouthful, the swallowed and the spat, and again no motion more:
    // they play the walk's and the tumble's (`MOTION_OF_ACTION`). Task 11: one
    // more, the footstooled, and no motion more: it plays the grab's. Task 12: one
    // more, the crawl, and no motion more: it plays the crouch's. Task 13c's fix
    // round 1: one more, the rebound, and no motion more: it plays the stand's.
    // Task 14: one more, the trapped, and no motion more: it plays the grab's.
    expect(ACTIONS).toHaveLength(59);
    expect(named.size).toBe(57);
    expect(specs.map((s) => s.motion).sort()).toEqual([...named].sort());
    // Plan 5, Task 4b: the helpless fall and its landing bake nothing of their
    // own; they play the fall's and the landing lag's (`MOTION_OF_ACTION`), as
    // the carry and the carried play the walk's and the grab's (Task 8).
    expect(new Set(specs.map((s) => s.action))).toEqual(new Set(ACTIONS.filter((a) => MOTION_OF_ACTION[a] === undefined)));
    expect(specs.map((s) => s.motion)).toContain("status_tumbleFall");
    for (const s of specs) expect(statusMotion(s)).toBe(s.motion);
  });

  it("bake each of the nine dodge motions at a charge the sim gives it, not 0 for all", () => {
    const specs = dodgeSpecs();
    expect(specs.map((s) => s.motion).sort()).toEqual(
      [
        "status_airDodge",
        "status_airDodge_diagDown",
        "status_airDodge_diagUp",
        "status_airDodge_down",
        "status_airDodge_side",
        "status_airDodge_up",
        "status_roll",
        "status_roll_back",
        "status_spotDodge",
      ].sort(),
    );
    for (const s of specs) expect(SIM_CHARGES[s.action]).toContain(s.charge);
  });

  it("stand for every charge the sim gives a dodge: the same length and intangible window, for every fighter", () => {
    const specs = dodgeSpecs();
    for (const def of FIGHTERS) {
      const a = airDodgeOf(def.attributes);
      const g = groundDodgeOf(def.attributes);
      for (const action of DODGES) {
        for (const charge of SIM_CHARGES[action]!) {
          const sim = { action, charge, actionFrame: 0, hitstun: 0, jumpsUsed: 1, fastFalling: false, shortHop: false, vy: 0 };
          const spec = specs.find((s) => s.motion === statusMotion(sim))!;
          const why = `${def.id} ${action} charge ${charge} → ${spec.motion} (baked at ${spec.charge})`;
          expect(statusDuration({ ...sim, charge: spec.charge }, def), why).toBe(statusDuration(sim, def));
          if (action === "airDodge") expect(airDodgeIntangible(a, spec.charge), why).toEqual(airDodgeIntangible(a, charge));
          if (action === "roll") expect(rollOf(g, spec.charge), why).toBe(rollOf(g, charge));
        }
      }
    }
  });
});

describe("the status clocks are each fighter's own (DISPATCH-NOTES 10.1)", () => {
  it("time every fixed-length status at the fighter's own length, as the 2D renderer's actionDurationFor does", () => {
    for (const def of FIGHTERS) {
      const samplers = statusSamplers(def);
      for (const spec of statusMotionSpecs()) {
        const { clock } = samplers.get(spec.motion)!;
        if (clock.kind !== "once") continue;
        const twoD = actionDurationFor(posedAt(def.id, spec, 0), jumpTimingFor(def)) ?? OPEN_ENDED_FRAMES;
        expect(clock.frames, `${def.id} ${spec.motion}`).toBe(twoD);
      }
    }
  });

  it("give the dodges each fighter's own lengths (UltimateFrameData via groundDodge.ts / airDodge.ts)", () => {
    const frames = (id: string, motion: string) => statusSamplers(fighterOf(id)).get(motion)!.clock;
    // https://ultimateframedata.com/mario, /fox: spot dodge 25 and 23 frames.
    expect(frames("mario", "status_spotDodge")).toEqual({ kind: "once", frames: 25 });
    expect(frames("fox", "status_spotDodge")).toEqual({ kind: "once", frames: 23 });
    // Forward and back rolls: Mario 29 / 34, Fox 26 / 32.
    expect([frames("mario", "status_roll").frames, frames("mario", "status_roll_back").frames]).toEqual([29, 34]);
    expect([frames("fox", "status_roll").frames, frames("fox", "status_roll_back").frames]).toEqual([26, 32]);
    // Air dodges, neutral and straight up (P `escape_air_stiff_frame`, `escape_air_slide_u_stiff_frame`).
    expect([frames("mario", "status_airDodge").frames, frames("mario", "status_airDodge_up").frames]).toEqual([52, 115]);
    expect([frames("kirby", "status_airDodge").frames, frames("kirby", "status_airDodge_up").frames]).toEqual([61, 141]);
    expect([frames("fox", "status_airDodge").frames, frames("fox", "status_airDodge_up").frames]).toEqual([38, 75]);
  });

  it("are whole numbers of at least one frame for every motion of every fighter (DISPATCH-NOTES 10.4)", () => {
    for (const def of FIGHTERS) {
      for (const [motion, s] of motionSamplers(def)) {
        expect(Number.isInteger(s.clock.frames) && s.clock.frames >= 1, `${def.id} ${motion}: ${s.clock.frames}`).toBe(true);
      }
    }
  });
});

describe("the bake plays each dodge as the 2D renderer draws it (DISPATCH-NOTES 10.2, ruling R5)", () => {
  it("samples every frame of every dodge of every fighter exactly as the 2D renderer does on actionFrame k − 1", () => {
    for (const def of FIGHTERS) {
      const samplers = statusSamplers(def);
      for (const spec of dodgeSpecs()) {
        const s = samplers.get(spec.motion)!;
        for (let k = 1; k <= s.clock.frames; k++) {
          expect(sampleAt(s, k), `${def.id} ${spec.motion} frame ${k}`).toEqual(drawn2d(def, spec, k - 1));
        }
      }
    }
  });

  it("times them with the 2D clip-time functions over the fighter's own intangible frames, the roll's turn with rollTurnTime", () => {
    for (const def of FIGHTERS) {
      const samplers = statusSamplers(def);
      const a = airDodgeOf(def.attributes);
      const g = groundDodgeOf(def.attributes);
      for (const spec of dodgeSpecs()) {
        const s = samplers.get(spec.motion)!;
        const total = s.clock.frames;
        for (let k = 1; k <= total; k++) {
          const at = `${def.id} ${spec.motion} frame ${k}`;
          if (spec.action === "airDodge") {
            expect(s.time(k), at).toBe(airDodgeClipTime(k - 1, total, airDodgeIntangible(a, spec.charge)[1]));
          } else if (spec.action === "spotDodge") {
            expect(s.time(k), at).toBe(spotDodgeClipTime(k - 1, total, ...dodgeIntangible(g.spotDodge)));
          } else {
            expect(s.time(k), at).toBe(rollClipTime(k - 1, total, ...dodgeIntangible(rollOf(g, spec.charge))));
            expect(s.turn?.(k), at).toBe(rollTurnTime(k - 1, total));
          }
        }
      }
    }
  });

  it("never plays a ground dodge linearly (clipTimeOfFrame), and turns a roll at its own rate, not its clip time", () => {
    for (const def of FIGHTERS) {
      const samplers = statusSamplers(def);
      for (const motion of ["status_spotDodge", "status_roll", "status_roll_back"]) {
        const s = samplers.get(motion)!;
        const frames = Array.from({ length: s.clock.frames }, (_, i) => i + 1);
        expect(frames.some((k) => s.time(k) !== clipTimeOfFrame(s.clock, k)), `${def.id} ${motion} plays linearly`).toBe(true);
        if (motion !== "status_spotDodge") {
          expect(frames.some((k) => s.turn!(k) !== s.time(k)), `${def.id} ${motion} turns at its clip time`).toBe(true);
        }
      }
    }
  });

  it.each(["mario", "fox"])("bakes %s's dodge bones where the 2D renderer's pose puts them, on every frame", (id) => {
    const def = fighterOf(id);
    const skeleton = SKELETONS[id];
    const baked = bakeFighter({ def, skeleton, scriptBones: referenceScriptBones(id) });
    const p = fighterPoser(def, skeleton);
    const index = baked.bones.bones.map((b) => p.rig3.byLower.get(b)!);
    const stride = baked.bones.bones.length * BONE_POSE_STRIDE;
    for (const spec of dodgeSpecs()) {
      const m = baked.bones.motions[spec.motion];
      expect(baked.clocks[spec.motion]).toEqual({ kind: "once", frames: statusDuration(posedAt(id, spec, 0), def) });
      for (let k = 1; k <= m.frames; k++) {
        const { sample, spin } = drawn2d(def, spec, k - 1);
        const world = poseWorld(p, sample, spin);
        const want = index.flatMap((bi) => {
          const q = sideBonePose(world[bi]);
          return [q.tx, q.ty, q.m00, q.m01, q.m02, q.m10, q.m11, q.m12];
        });
        expect(Array.from(m.data.subarray((k - 1) * stride, k * stride)), `${id} ${spec.motion} frame ${k}`).toEqual(want);
      }
    }
  });
});

describe("a move's clip time (DECISIONS D34, in motion frames)", () => {
  it("lands the clip's strike key on the script's first active motion frame, and plays linearly without one", () => {
    expect(attackClipTime(0.4, 6, 20, 1)).toBe(0);
    expect(attackClipTime(0.4, 6, 20, 6)).toBe(0.4);
    expect(attackClipTime(0.4, 6, 20, 21)).toBe(1);
    expect(attackClipTime(undefined, 6, 20, 11)).toBe(0.5);
    // A box live on the first frame has no wind-up to stretch.
    expect(attackClipTime(0.4, 1, 20, 11)).toBe(0.5);
  });
});

describe("the move motions the bake plays (Plan 5, Task 13d)", () => {
  it("bake the Super Missile on its own motion, its 57 frames, and Link's smash throw on none: it plays his throw's", () => {
    const samus = fighterOf("samus");
    const link = fighterOf("link");
    const own = gameScriptFor(samus, "sideBSmash")!.motion;
    expect(own).not.toBe(gameScriptFor(samus, "sideB")!.motion);
    const samusMoves = moveSamplers(samus);
    expect(samusMoves.get(own)).toMatchObject({ slot: "sideBSmash", clock: { kind: "script", frames: 57 } });
    expect(samusMoves.get(gameScriptFor(samus, "sideB")!.motion)).toMatchObject({ slot: "sideB", clock: { kind: "script", frames: 54 } });
    // `MoveDef.motionOf`: the smash throw runs the throw's motion, on the same clock.
    expect(gameScriptFor(link, "sideBSmash")!.motion).toBe(gameScriptFor(link, "sideB")!.motion);
    const linkMoves = moveSamplers(link);
    expect([...linkMoves.values()].map((m) => m.slot)).not.toContain("sideBSmash");
    expect(linkMoves.get(gameScriptFor(link, "sideB")!.motion)).toMatchObject({ slot: "sideB", clock: { kind: "script", frames: 45 } });
  });

  it("bake Link's failed throw on none either: it plays his throw's 45 frames and holds the last past them (fix round 1)", () => {
    const link = fighterOf("link");
    const motion = gameScriptFor(link, "sideB")!.motion;
    expect(gameScriptFor(link, "sideBFailed")!.motion).toBe(motion);
    expect([...moveSamplers(link).values()].map((m) => m.slot)).not.toContain("sideBFailed");
    const clock = moveSamplers(link).get(motion)!.clock;
    const at = (actionFrame: number) => {
      const f: ClockedFighter = { defId: "link", action: "special", move: "sideBFailed", actionFrame, port: 0, charge: 0, hitstun: 0, jumpsUsed: 0, fastFalling: false, vx: 0, vy: 0, shortHop: false };
      return poseIndexOf(link, f, 0, () => clock);
    };
    expect(at(30)).toEqual({ motion, frame: 31 });
    expect(at(44)).toEqual({ motion, frame: 45 });
    expect(at(58)).toEqual({ motion, frame: 45 });
  });

  it("refuses a move that plays the motion of a move it does not have", () => {
    const link = fighterOf("link");
    const rest = { ...link.moves, sideB: undefined };
    expect(() => moveSamplers({ ...link, moves: rest })).toThrow(/link sideBSmash plays sideB's motion, which sideB does not run/);
  });
});
