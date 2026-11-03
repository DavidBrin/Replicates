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
import { bakeTables } from "@/engine/acmd/bakeTables";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { moveScriptFrame } from "@/engine/acmd/run";
import { toFloat } from "@/engine/fixed";
import { FLIP_FRAMES } from "@/engine/constants";
import { clipFor } from "@/render/chars";
import { airDodgeClipTime } from "@/render/poses/airDodge";
import { rollClipTime, rollTurnTime, spotDodgeClipTime } from "@/render/poses/groundDodgeTime";
import { actionDurationFor, jumpTimingFor, moveTimingFor, poseSpinFor, samplePoseForFighter, type PosedFighter } from "@/render/poses/timing";
import { SKELETONS } from "../skeletons";
import {
  attackClipTime,
  bakeFighter,
  bakesStatus,
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
  it("are every motion statusMotion can name, each once: 62 over the 60 actions, tumbleFall among them", () => {
    const named = new Set<string>();
    for (const action of ACTIONS) {
      for (let charge = -3; charge <= 20; charge++) {
        for (const jumpsUsed of [0, 1, 2, 3]) {
          for (const fastFalling of [false, true]) {
            for (const grounded of [true, false]) {
              for (const dashedOff of [false, true]) named.add(statusMotion({ action, charge, jumpsUsed, fastFalling, grounded, actionFrame: 0, combat: { dashedOff } }));
            }
          }
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
    // Task 17: two motions more, the footstooled's and the crawl's, their own clips.
    // Plan 6, Task 7: one more, the edge slip, and no motion more: it plays the fall's.
    // Task 20: the carry leaves the walk's for two of its own, on the ground and in the air.
    // Task 21: the fall gains the flip off a dash.
    expect(ACTIONS).toHaveLength(60);
    expect(named.size).toBe(62);
    expect(specs.map((s) => s.motion).sort()).toEqual([...named].sort());
    // Plan 5, Task 4b: the helpless fall and its landing bake nothing of their
    // own; they play the fall's and the landing lag's (`MOTION_OF_ACTION`), as
    // the carried plays the grab's (Task 8).
    expect(new Set(specs.map((s) => s.action))).toEqual(new Set(ACTIONS.filter((a) => MOTION_OF_ACTION[a] === undefined)));
    expect(specs.map((s) => s.motion)).toContain("status_tumbleFall");
    for (const s of specs) expect(statusMotion({ ...s, actionFrame: 0, combat: { dashedOff: s.dashedOff } })).toBe(s.motion);
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
        if (!bakesStatus(def, spec)) continue;
        const { clock } = samplers.get(spec.motion)!;
        if (clock.kind !== "once") continue;
        // The flip off a dash (Plan 6, Task 21) is the fall's first FLIP_FRAMES, a part of a state with no length.
        if (spec.motion === "status_fall_flip") {
          expect(clock.frames, def.id).toBe(FLIP_FRAMES);
          continue;
        }
        const twoD = actionDurationFor(posedAt(def.id, spec, 0), jumpTimingFor(def)) ?? OPEN_ENDED_FRAMES;
        expect(clock.frames, `${def.id} ${spec.motion}`).toBe(twoD);
      }
    }
  });

  it("bake the crawl for the one fighter who crawls (Plan 5, Task 17): its own clip, a loop; the others would bake a copy of their crouch", () => {
    for (const def of FIGHTERS) {
      const crawl = statusSamplers(def).get("status_crawl");
      if (def.attributes.canCrawl === true) {
        expect(crawl?.clip, def.id).not.toBe(statusSamplers(def).get("status_crouch")!.clip);
        expect(crawl?.clock, def.id).toEqual({ kind: "loop", frames: 32 });
      } else expect(crawl, def.id).toBeUndefined();
    }
    expect(FIGHTERS.filter((d) => d.attributes.canCrawl === true).map((d) => d.id)).toEqual(["pikachu"]);
    // The stood-on fighter's, every fighter's, once across the footstool's freeze.
    for (const def of FIGHTERS) expect(statusSamplers(def).get("status_footstooled")?.clock, def.id).toEqual({ kind: "once", frames: 30 });
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

describe("the flip off a dash (Plan 6, Task 21)", () => {
  it("bake it for every fighter over FLIP_FRAMES on the flip's own clip, one forward turn by its end", () => {
    for (const def of FIGHTERS) {
      const flip = statusSamplers(def).get("status_fall_flip")!;
      expect(flip.clock, def.id).toEqual({ kind: "once", frames: FLIP_FRAMES });
      expect(flip.clip, def.id).toBe(clipFor(def.id, "fallFlip"));
      expect(sampleAt(flip, FLIP_FRAMES).spin / (2 * Math.PI), def.id).toBeCloseTo((FLIP_FRAMES - 1) / FLIP_FRAMES, 9);
    }
  });
});

describe("Donkey Kong's carry and lift, and the full releases (Plan 6, Task 20)", () => {
  it("bake each full release on a motion of its own, its 47 frames, from the loop frame's pose on through the clip", () => {
    for (const [id, motion] of [["donkeyKong", "special_n_max"], ["samus", "special_n_f_max"]] as const) {
      const def = fighterOf(id);
      const moves = moveSamplers(def);
      const full = moves.get(motion)!;
      const own = moves.get(gameScriptFor(def, "neutralB")!.motion)!;
      expect(full, id).toMatchObject({ slot: "neutralB", clock: { kind: "once", frames: 47 } });
      expect(full.clip).toBe(own.clip);
      const sc = def.moves.neutralB!.specialCharge!;
      // Where the move's own motion stands on the loop frame (the press's first frame of the release)…
      const loopMotionFrame = moveScriptFrame(def, { move: "neutralB", actionFrame: sc.loopFrame })!.state.motionFrame;
      expect(full.time(1), id).toBeCloseTo(own.time(loopMotionFrame), 12);
      // …on through the clip, never back, never holding.
      for (let k = 2; k <= 47; k++) expect(full.time(k), `${id} ${k}`).toBeGreaterThan(full.time(k - 1));
    }
    // Donkey Kong's punch strikes on the motion's frame 19, the script's hit (rubendal `game_specialnmax`).
    const dk = moveSamplers(fighterOf("donkeyKong")).get("special_n_max")!;
    expect(dk.time(19)).toBeCloseTo(dk.clip.strike!, 12);
  });

  it("bake the lift (Donkey Kong's forward throw, `cargo`) on the lift clip, and his carried forward throw on the throw's, as before", () => {
    const dk = fighterOf("donkeyKong");
    const moves = moveSamplers(dk);
    expect(moves.get(gameScriptFor(dk, "fthrow")!.motion)!.clip).toBe(clipFor("donkeyKong", "cargoLift"));
    expect(moves.get(gameScriptFor(dk, "cargoFthrow")!.motion)!.clip).toBe(clipFor("donkeyKong", "fthrow"));
    expect(clipFor("donkeyKong", "cargoLift")).not.toBe(clipFor("donkeyKong", "fthrow"));
  });

  it("bake the carry for Donkey Kong alone, both arms over his head in 3D at its rest", () => {
    for (const def of FIGHTERS) expect(statusSamplers(def).has("status_cargoCarry"), def.id).toBe(def.id === "donkeyKong");
    const dk = fighterOf("donkeyKong");
    const tables = bakeTables([bakeFighter({ def: dk, skeleton: SKELETONS.donkeyKong, scriptBones: referenceScriptBones("donkeyKong") })], "dk");
    const caps = localHurtboxes(dk, { defId: "donkeyKong", action: "cargoCarry", actionFrame: 0, move: null, port: 0, charge: 0, hitstun: 0, jumpsUsed: 0, fastFalling: false, vx: 0, vy: 0, shortHop: false }, 0, tables)!;
    const bones = tables.hurtboxes("donkeyKong")!.map((h) => h.bone);
    const top = (bone: string) => {
      const c = caps[bones.indexOf(bone)];
      return toFloat(Math.max(c.y1, c.y2));
    };
    expect(top("armr")).toBeGreaterThan(top("head"));
    expect(top("arml")).toBeGreaterThan(top("head"));
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

  // Plan 5 final wave 2, ruling R-FW2l (Task 13d re-review 1, N2): a move that plays
  // another's motion may run longer than it (it holds the last frame), never shorter:
  // the motion is baked to the other move's length, and a shorter one would end its
  // animation cut off, with no error.
  it("refuses to bake a move that plays another's motion for fewer frames than that motion runs (ruling R-FW2l)", () => {
    const link = fighterOf("link");
    const withSmashThrow = (totalFrames: number): FighterDef => ({ ...link, moves: { ...link.moves, sideBSmash: { ...link.moves.sideBSmash!, totalFrames } } });
    expect(link.moves.sideBSmash!.totalFrames).toBe(link.moves.sideB!.totalFrames);
    expect(() => moveSamplers(withSmashThrow(link.moves.sideB!.totalFrames - 1))).toThrow(/link sideBSmash plays sideB's motion for 44 frames, shorter than sideB's 45/);
    expect(() => moveSamplers(withSmashThrow(link.moves.sideB!.totalFrames))).not.toThrow();
    expect(() => moveSamplers(withSmashThrow(link.moves.sideB!.totalFrames + 6))).not.toThrow();
  });

  it("bake Link's failed throw on a motion of its own: his throw's clip across its 59 frames, never holding a last pose (Plan 5, Task 17)", () => {
    // The Task 13d fix round played it on the throw's 45 frames and held the last
    // for 46-59; in the game both play one animation, the failed throw's running
    // to its "Animation length 63" (SmashWiki "Link (SSBU)/Side special").
    const link = fighterOf("link");
    const motion = gameScriptFor(link, "sideBFailed")!.motion;
    expect(motion).not.toBe(gameScriptFor(link, "sideB")!.motion);
    const sampler = moveSamplers(link).get(motion)!;
    expect(sampler).toMatchObject({ slot: "sideBFailed", clock: { kind: "script", frames: 59 } });
    // The throw's own clip, played slower, still moving on its last frames.
    expect(sampler.clip).toBe(moveSamplers(link).get(gameScriptFor(link, "sideB")!.motion)!.clip);
    const at = (actionFrame: number) => {
      const f: ClockedFighter = { defId: "link", action: "special", move: "sideBFailed", actionFrame, port: 0, charge: 0, hitstun: 0, jumpsUsed: 0, fastFalling: false, vx: 0, vy: 0, shortHop: false };
      return poseIndexOf(link, f, 0, () => sampler.clock);
    };
    expect(at(44)).toEqual({ motion, frame: 45 });
    expect(at(58)).toEqual({ motion, frame: 59 });
    for (let k = 46; k <= 59; k++) expect(sampler.time(k)).toBeGreaterThan(sampler.time(k - 1));
  });

  it("bake Zero Laser's start on its charge pose until the laser fires on 70, not striking on the charge's 48 (Plan 5, Task 17 fix round 1)", () => {
    // Task 16 fix round 1 gave Zero Laser its 69-frame start, whose 1% charge box
    // from 48 is the move's first: the clip's strike (Samus's firing recoil) landed
    // on the charge. `MoveDef.clipStrike` puts it on the laser.
    const samus = fighterOf("samus");
    const sampler = moveSamplers(samus).get(gameScriptFor(samus, "finalSmash")!.motion)!;
    const strike = sampler.clip.strike!;
    for (let k = 1; k <= 69; k++) expect(sampler.time(k), `frame ${k}`).toBeLessThan(strike);
    expect(sampler.time(70)).toBeCloseTo(strike, 12);
    expect(moveTimingFor(samus, "finalSmash")?.firstActive).toBe(69);
  });

  it("refuses a move that plays the motion of a move it does not have", () => {
    const link = fighterOf("link");
    const rest = { ...link.moves, sideB: undefined };
    expect(() => moveSamplers({ ...link, moves: rest })).toThrow(/link sideBSmash plays sideB's motion, which sideB does not run/);
  });
});
