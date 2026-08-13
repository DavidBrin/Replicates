/**
 * Marth's clips, tested on the two things that were actually wrong.
 *
 * The diagnosis this work started from was "the sword does not swing". Nothing
 * in the existing suite could see that: `poses.test.ts` checks the shared
 * library's structure, `chars.test.ts` checks that an override is *reached*, and
 * both were green while every one of his attacks was a generic punch played on
 * a thin rig. A clip can satisfy every structural rule and still be a man
 * standing still holding a sword.
 *
 * So the assertions here are geometric, and there are two of them.
 *
 * **Blade path** — how far the sword's own direction travels between the last
 * wind-up key and the moment of contact. This is the property that separates a
 * swing from a pose change, it is a number, and it is the thing that regressed.
 *
 * **Tipper reach** — where the point of Falchion actually is on the contact
 * frame, in the same world units `fighters/marth.ts` writes its hitboxes in.
 * Marth's whole identity is that the point does markedly more than the rest of
 * the blade; if the drawn point is not on the tipper hitbox then the graphic is
 * lying about the only thing the character is about, and no amount of "it looks
 * fine" catches a unit-conversion slip of 16%.
 *
 * Both are computed through `resolve()` — the renderer's own forward kinematics
 * — rather than by re-deriving the maths here, so a change to the rig or to the
 * bone table moves the test with it.
 */

import { describe, expect, it } from "vitest";

import { marth as def } from "@/fighters/marth";
import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
import { toFloat } from "@/engine/fixed";
import { resolve, type PoseAngles } from "../../skeleton";
import { samplePose, type Keyframe, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { POSE_LIBRARY } from "../../poses/library";
import { poses } from "./poses";
import { rig } from "./rig";
import { fx } from "./fx";
import { drawMoveFx } from "../../specialFx";
import { createCamera } from "../../camera";
import { createMockContext } from "../../mockContext";
import { makeFighter, makeStage } from "../../testFixtures";
import { FIGHTERS } from "@/fighters";

const NAMES = Object.keys(poses) as PoseName[];
const clips = NAMES.map((name) => [name, poses[name] as PoseClip] as const);

/** How long the drawn blade is, in rig units. Read from the rig, not retyped. */
const BLADE = rig.props.find((p) => p.bone === "handR")?.size ?? 0;

/**
 * Where the point of Falchion is, in **world** units above and in front of the
 * fighter's feet, for one keyframe.
 *
 * `resolve` works in screen space (y-down, origin at the feet), so the y flip
 * and the rig-to-world multiply both happen here — which is exactly the pair of
 * conversions that is easy to skip and worth 16% of his reach.
 */
function bladeTip(key: Keyframe): { x: number; y: number } {
  const skeleton = resolve(rig.bones, key.pose, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: key.scaleX ?? 1,
    scaleY: key.scaleY ?? 1,
    facing: 1,
  });
  const hand = skeleton.handR;
  const dx = hand.x1 - hand.x0;
  const dy = hand.y1 - hand.y0;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: (hand.x1 + (dx / len) * BLADE + (key.offsetX ?? 0)) * rig.scale,
    y: (-(hand.y1 + (dy / len) * BLADE) + (key.offsetY ?? 0)) * rig.scale,
  };
}

/**
 * The blade's own direction for a pose, in degrees, 0 straight up and clockwise
 * positive facing right — the convention the clips are authored in.
 *
 * Taken off the resolved hand rather than by summing `hip + torso + upperArmR +
 * forearmR + handR`, so a pose that leaves a bone unnamed picks up that bone's
 * rest angle exactly the way the renderer does.
 */
function bladeAngle(pose: PoseAngles): number {
  const skeleton = resolve(rig.bones, pose, { x: 0, y: 0, scale: 1, facing: 1 });
  const hand = skeleton.handR;
  // Screen space is y-down; atan2(dx, -dy) puts 0 at straight up and turns
  // clockwise, which is the pose library's convention.
  const deg = (Math.atan2(hand.x1 - hand.x0, -(hand.y1 - hand.y0)) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Signed shortest travel from a to b, in degrees. */
function travel(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.abs(d);
}

function strikeIndexOf(clip: PoseClip): number {
  return clip.keys.findIndex((k) => Math.abs(k.t - (clip.strike as number)) < 1e-9);
}

describe("Marth overrides the moves whose shape is the character", () => {
  it("declares clips at all — an empty table means he is still everybody's animation", () => {
    expect(NAMES.length).toBeGreaterThan(0);
  });

  it("names only clips the shared library knows about", () => {
    for (const name of NAMES) expect(POSE_LIBRARY[name], `unknown clip ${name}`).toBeDefined();
  });

  it("covers every move whose silhouette is his rather than the archetype's", () => {
    // The four specials first: there are four special clips in the library and
    // thirty-two specials in the game, so an unoverridden special is literally
    // another fighter's animation.
    for (const name of ["neutralB", "sideB", "upB", "downB"] as PoseName[]) {
      expect(NAMES, `${name} is still the shared clip`).toContain(name);
    }
    for (const name of ["fsmash", "usmash", "dsmash", "jab", "ftilt", "utilt", "dtilt"] as PoseName[]) {
      expect(NAMES, `${name} is still the shared clip`).toContain(name);
    }
    for (const name of ["nair", "fair", "bair", "uair", "dair"] as PoseName[]) {
      expect(NAMES, `${name} is still the shared clip`).toContain(name);
    }
  });
});

describe("every clip is well formed", () => {
  it("keeps keys sorted inside [0, 1]", () => {
    for (const [name, clip] of clips) {
      let last = -1;
      for (const k of clip.keys) {
        expect(k.t, `${name}`).toBeGreaterThanOrEqual(0);
        expect(k.t, `${name}`).toBeLessThanOrEqual(1);
        expect(k.t, `${name} has unsorted keys`).toBeGreaterThan(last);
        last = k.t;
      }
      expect(clip.keys[clip.keys.length - 1].t, `${name} has no terminator`).toBe(1);
    }
  });

  it("puts the strike in the first half, on a key, with a follow-through after it", () => {
    for (const [name, clip] of clips) {
      expect(clip.strike, `${name} declares no strike`).toBeDefined();
      const strike = clip.strike as number;
      expect(strike, name).toBeLessThan(0.5);
      const i = strikeIndexOf(clip);
      expect(i, `${name} declares strike ${strike} but has no key there`).toBeGreaterThan(0);
      expect(clip.keys[i - 1].ease, `${name} does not accelerate into contact`).toBe("in");
      expect(clip.keys.length - i, `${name} has no follow-through`).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The bug three separate people have shipped. Bone angles accumulate down the
   * chain and the legs are *not* individually mirrored — the whole rig is,
   * once, at draw time — so `footR` rests at -88° like `footL` does. A pose that
   * names one positive and the other negative puts one foot on backwards, and
   * it is invisible in a still because the foot is a capsule.
   */
  it("never mirrors one foot against the other", () => {
    for (const [name, clip] of clips) {
      for (const k of clip.keys) {
        const l = k.pose.footL;
        const r = k.pose.footR;
        if (l === undefined || r === undefined) continue;
        expect(Math.sign(l) === Math.sign(r), `${name} at t=${k.t} has one foot backwards`).toBe(true);
      }
    }
  });
});

/**
 * The property the whole exercise was about.
 *
 * The floor is per-clip because two of these moves genuinely are not swings:
 * Shield Breaker became "a single powerful stab" in Brawl and Down Tilt is "a
 * quick crouching sword poke", and in both the travel is in the shoulder rather
 * than in the blade. Those are asserted on *hand* travel instead, below, so that
 * "it barely rotates" cannot quietly become true of the others as well.
 */
const MIN_BLADE_PATH: Partial<Record<PoseName, number>> = {
  fsmash: 120,
  usmash: 100,
  dsmash: 70,
  jab: 60,
  ftilt: 60,
  utilt: 100,
  dashAttack: 60,
  fair: 100,
  bair: 70,
  nair: 40,
  uair: 90,
  dair: 40,
  sideB: 100,
  upB: 90,
};

/** The two that are thrusts, and the shoulder travel that makes them read. */
const MIN_ARM_PATH: Partial<Record<PoseName, number>> = {
  neutralB: 110,
  dtilt: 80,
};

/** Move slot per clip, for the tests that read the real frame data. */
const HELD: Partial<Record<PoseName, MoveSlot>> = {
  fsmash: "fsmash",
  usmash: "usmash",
  dsmash: "dsmash",
  jab: "jab1",
  ftilt: "ftilt",
  utilt: "utilt",
  dtilt: "dtilt",
  dashAttack: "dashAttack",
  fair: "fair",
  bair: "bair",
  nair: "nair",
  uair: "uair",
  dair: "dair",
  sideB: "sideB",
  neutralB: "neutralB",
};

describe("the sword actually swings", () => {
  it("travels a real angular distance into every contact frame", () => {
    for (const [name, floor] of Object.entries(MIN_BLADE_PATH) as [PoseName, number][]) {
      const clip = poses[name] as PoseClip;
      expect(clip, `no clip for ${name}`).toBeDefined();
      const i = strikeIndexOf(clip);
      const path = travel(bladeAngle(clip.keys[i - 1].pose), bladeAngle(clip.keys[i].pose));
      expect(path, `${name}: blade travels only ${path.toFixed(0)}° into contact`).toBeGreaterThanOrEqual(floor);
    }
  });

  /**
   * The extension has to survive the whole active window.
   *
   * `ease: "out"` is a cubic, so a clip with nothing between the strike key and
   * its follow-through leaves the contact pose almost at once: on a five-frame
   * window the fighter is a third of the way into the recovery before the last
   * live frame. For most fighters that is merely hurried. For this one it moves
   * the *tip* — the thing his entire game is spacing around — somewhere the
   * animation has stopped showing, on frames the simulation still hits with.
   *
   * The held key belongs at the clip time the last live frame maps to, which is
   * computed here from the move's own hitbox data rather than typed in, so the
   * test moves if the frame data does.
   */
  it("holds full extension to the last live frame of the window", () => {
    for (const [name, slot] of Object.entries(HELD) as [PoseName, MoveSlot][]) {
      const clip = poses[name] as PoseClip;
      const boxes = def.moves[slot]!.hitboxes.filter((h) => !h.grabbing);
      const firstFrame = Math.min(...boxes.map((h) => h.startFrame));
      // The window the strike key is anchored on, not any later one.
      const window = boxes.filter((h) => h.startFrame === firstFrame);
      const lastFrame = Math.max(...window.map((h) => h.endFrame));
      const total = def.moves[slot]!.totalFrames;
      const s = clip.strike as number;
      const first = firstFrame - 1;
      const want = s + ((1 - s) * (lastFrame - 1 - first)) / (total - first);

      const held = clip.keys.find((k) => Math.abs(k.t - want) < 0.006);
      expect(
        held,
        `${name}: hitbox is live through frame ${lastFrame} (t=${want.toFixed(3)}) but no key holds ` +
          `the extension there — the blade starts retracting while it can still hit`,
      ).toBeDefined();

      // Down air is exempt from the drift bound and only from that: its window
      // holds two *different* sweetspots in two different places — the tip in
      // front on frames 9-13 and the meteor below and behind on frame 11 — so
      // the blade is supposed to be travelling across it, not parked.
      if (name === "dair") continue;
      const i = strikeIndexOf(clip);
      const drift = travel(bladeAngle(clip.keys[i].pose), bladeAngle(held!.pose));
      expect(drift, `${name}: blade has already swung ${drift.toFixed(0)}° by the last live frame`).toBeLessThan(14);
    }
  });

  it("keeps moving once the window has closed rather than freezing", () => {
    for (const name of Object.keys(MIN_BLADE_PATH) as PoseName[]) {
      const clip = poses[name] as PoseClip;
      const i = strikeIndexOf(clip);
      // Past the strike key and any held key: the first key whose blade angle
      // is allowed to have moved on.
      const rest = clip.keys.slice(i + 1);
      const moved = rest.some((k) => travel(bladeAngle(clip.keys[i].pose), bladeAngle(k.pose)) > 8);
      expect(moved, `${name} never leaves its contact pose`).toBe(true);
    }
  });

  it("swings the shoulder on the two moves that are thrusts, not swings", () => {
    for (const [name, floor] of Object.entries(MIN_ARM_PATH) as [PoseName, number][]) {
      const clip = poses[name] as PoseClip;
      const i = strikeIndexOf(clip);
      const from = clip.keys[i - 1].pose.upperArmR;
      const to = clip.keys[i].pose.upperArmR;
      expect(from, `${name} does not name upperArmR at its wind-up`).toBeDefined();
      expect(to, `${name} does not name upperArmR at contact`).toBeDefined();
      const path = travel(((from as number) * 180) / Math.PI, ((to as number) * 180) / Math.PI);
      expect(path, `${name}: shoulder travels only ${path.toFixed(0)}°`).toBeGreaterThanOrEqual(floor);
    }
  });

  /**
   * Not the same as the check above. A clip could travel its 120° between two
   * keys and still be sampled as a still image if the ease dumped all of it into
   * one frame — or, far more likely, if a later edit moved the strike key and
   * left the wind-up where it was. This samples the clip the way `poseTimeFor`
   * would and asks that the blade is somewhere different a third of the way in.
   */
  it("is a different drawing at the start of the wind-up than at contact", () => {
    for (const [name, clip] of clips) {
      const strike = clip.strike as number;
      const early = bladeAngle(samplePose(clip, strike * 0.34).angles);
      const at = bladeAngle(samplePose(clip, strike).angles);
      expect(travel(early, at), `${name} is one frozen pose through its wind-up`).toBeGreaterThan(10);
    }
  });
});

/**
 * Where the point of the blade is when the hitbox that defines this character
 * goes live.
 *
 * Only the moves whose tipper is *out at reach* are listed. Up smash, up tilt
 * and up air put their tip hitbox at y = 16-17 world, which is two-thirds of the
 * way along a raised blade rather than at its end, so a reach assertion there
 * would be asserting the wrong thing — those are checked by blade path alone.
 */
const REACH: Partial<Record<PoseName, MoveSlot>> = {
  fsmash: "fsmash",
  jab: "jab1",
  ftilt: "ftilt",
  dtilt: "dtilt",
  dashAttack: "dashAttack",
  fair: "fair",
  bair: "bair",
  nair: "nair",
  sideB: "sideB",
  neutralB: "neutralB",
  dsmash: "dsmash",
};

describe("the point lands on the tipper", () => {
  it("puts the drawn blade tip within a hitbox radius of the sweetspot it claims", () => {
    const misses: string[] = [];
    for (const [name, slot] of Object.entries(REACH) as [PoseName, MoveSlot][]) {
      const clip = poses[name] as PoseClip;
      const move = def.moves[slot];
      expect(move, `${slot} is not a move Marth has`).toBeDefined();

      // The sweetspot is the lowest-id hitbox in the first live window — the
      // same rule `bestHitbox` and the tipper flash both use.
      const first = Math.min(...move!.hitboxes.map((h) => h.startFrame));
      const live = move!.hitboxes.filter((h) => h.startFrame === first);
      const tip = live.reduce((a, b) => (a.id <= b.id ? a : b));

      const point = bladeTip(clip.keys[strikeIndexOf(clip)]);
      const want = { x: toFloat(tip.x), y: toFloat(tip.y) };
      const miss = Math.hypot(point.x - want.x, point.y - want.y);

      // One hitbox radius: the point has to be *in* the sphere the simulation
      // hits with, not merely pointing at it.
      if (miss > toFloat(tip.radius)) {
        misses.push(
          `${name}: point (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) vs tipper ` +
            `(${want.x.toFixed(1)}, ${want.y.toFixed(1)}) — ${miss.toFixed(1)} off, ` +
            `radius ${toFloat(tip.radius).toFixed(1)}`,
        );
      }
    }
    expect(misses, `the blade does not reach its own sweetspot:\n${misses.join("\n")}`).toEqual([]);
  });
});

describe("the effects are wired to moves that exist", () => {
  it("keys every effect to one of Marth's own moves", () => {
    for (const slot of Object.keys(fx) as MoveSlot[]) {
      expect(def.moves[slot], `fx keyed to ${slot}, which Marth does not have`).toBeDefined();
    }
  });

  /**
   * The tipper flash is derived from the hitbox table rather than authored, so
   * the thing to guard is the derivation: every move it is keyed to must
   * actually have a sweetspot/sourspot pair to distinguish, or the flash is
   * telling the player about a tipper that does not exist.
   */
  it("only claims a tipper on moves that have two hitboxes on the same frames", () => {
    for (const slot of Object.keys(fx) as MoveSlot[]) {
      if (slot === "downB") continue; // the counter flash, not a tipper
      const boxes = def.moves[slot]!.hitboxes;
      const shared = boxes.some((a) =>
        boxes.some((b) => b.id !== a.id && b.startFrame === a.startFrame && b.endFrame === a.endFrame),
      );
      expect(shared, `${slot} has no overlapping hitbox pair to call a tipper`).toBe(true);
    }
  });
});

/**
 * The tipper blooms on the tip, and only on the tip.
 *
 * This is the one thing about Marth a player must be able to read, and it is
 * the one thing geometry alone cannot tell the renderer. Before `struckWith`
 * the flash bloomed on `f.hitlag > 0` — the attacker freezes on *any*
 * connection — so landing the handle looked exactly like landing the point.
 */
describe("the tipper flash knows what actually connected", () => {
  const marth = FIGHTERS.find((f) => f.id === "marth") as FighterDef;
  const cam = createCamera(makeStage());

  /**
   * Paint the forward smash on an active frame.
   *
   * `struckWith` of `undefined` omits the cosmetic state entirely, which is
   * what the animation lab does; `null` supplies it and says nothing has
   * connected, which is what a shielded swing looks like.
   */
  function paint(struckWith: number | null | undefined, hitlag = 0) {
    const ctx = createMockContext();
    const move = marth.moves.fsmash as MoveDef;
    const live = Math.min(...move.hitboxes.map((h) => h.startFrame));
    const f = makeFighter({
      defId: "marth",
      action: "attack",
      move: "fsmash",
      actionFrame: live - 1,
      hitlag,
    });
    drawMoveFx(
      ctx,
      marth,
      f,
      cam,
      14,
      960,
      700,
      struckWith === undefined
        ? undefined
        : {
            lastHit: [
              struckWith === null ? null : { hitboxId: struckWith, frame: 0 },
              null,
              null,
              null,
            ],
            frame: f.actionFrame,
          },
    );
    return ctx;
  }

  /** The largest radius drawn — the flash's size, which is what blooms. */
  const biggest = (ctx: ReturnType<typeof createMockContext>) =>
    Math.max(0, ...ctx.calls.filter((c) => c.method === "arc").map((c) => c.args[2] as number));

  it("blooms bigger when the sweetspot is the box that won", () => {
    const move = marth.moves.fsmash as MoveDef;
    const sweet = Math.min(...move.hitboxes.map((h) => h.id));
    const sour = Math.max(...move.hitboxes.map((h) => h.id));
    // A move with no sourspot cannot express the distinction, and asserting on
    // it would be asserting on nothing.
    expect(sour, "fsmash needs at least two hitboxes to have a tipper").toBeGreaterThan(sweet);
    expect(biggest(paint(sweet))).toBeGreaterThan(biggest(paint(sour)));
  });

  it("does not bloom on a sourspot that froze him just as hard", () => {
    // The old proxy: hitlag is set by any connection, so this is exactly the
    // case that used to bloom and should not.
    const move = marth.moves.fsmash as MoveDef;
    const sour = Math.max(...move.hitboxes.map((h) => h.id));
    expect(biggest(paint(sour, 8))).toBeLessThan(biggest(paint(0, 8)));
  });

  it("falls back to hitlag when nobody supplied the cosmetic state", () => {
    // The animation lab draws effects without a VfxState. A dimmer bloom on
    // every hit is better than a flash that can never bloom at all.
    expect(biggest(paint(undefined, 8))).toBeGreaterThan(biggest(paint(undefined, 0)));
  });

  it("does not bloom on a swing the simulation says connected with nothing", () => {
    // A shield hit freezes the attacker without producing a hit event, so
    // `hitlag` is set and `struckWith` is null. Treating that null like the
    // lab's missing context bloomed a sourspot that had been shielded.
    expect(biggest(paint(null, 8))).toBe(biggest(paint(null, 0)));
    expect(biggest(paint(null, 8))).toBeLessThan(biggest(paint(0, 8)));
  });
});
