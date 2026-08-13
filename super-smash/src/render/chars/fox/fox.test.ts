/**
 * What has to stay true about Fox.
 *
 * Every one of these guards a failure that is *silent* — the fighter goes on
 * looking plausible and slightly wrong, which is the hardest kind of bug to
 * see and the one this whole layer exists to fix. None of them restate a
 * number from `poses.ts`; each measures something you could check by looking,
 * and would have to look at every frame of every move to check by hand.
 */

import { describe, expect, it } from "vitest";
import { fox as def } from "@/fighters/fox";
import { toFloat } from "@/engine/fixed";
import type { MoveSlot } from "@/engine/types";
import { samplePose, type PoseSample } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { resolve, type BoneName } from "../../skeleton";
import { rotationPivot } from "../../characterArt";
import { createMockContext } from "../../mockContext";
import { PROP_STILL, type PropAnim } from "../../rigKit";
import { getCharacterRig } from "..";
import { poses } from "./poses";
import { fx, projectiles } from "./fx";

const rig = getCharacterRig("fox");
const NAMES = Object.keys(poses) as PoseName[];

/* ------------------------------------------------------------- measuring -- */

/**
 * A bone tip in rig units, measured from his feet: +x forward, +y up.
 *
 * `resolve` hands back screen space, which is y-down and has the keyframe's
 * own translation still to be applied by the caller, so both are put back —
 * and the rotation pivot has to be the renderer's rather than `resolve`'s
 * default, or a clip that rotates (up smash does) is measured somewhere the
 * game never draws it.
 */
function tipOf(s: PoseSample, bone: BoneName): { x: number; y: number } {
  const sk = resolve(rig.bones, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
    pivot: rotationPivot(rig),
  });
  return { x: s.offsetX + sk[bone].x1, y: s.offsetY - sk[bone].y1 };
}

/**
 * A bone's *base*, same frame as `tipOf`.
 *
 * Needed because the thighs hang off the hip's base rather than its tip
 * (`attach: 0` in `skeleton.ts`, so that leaning the pelvis swings the legs
 * about it) — measuring a leg's reach from the hip's tip adds the whole
 * one-unit pelvis to it and makes a folded leg look nearly as long as a
 * straight one.
 */
function baseOf(s: PoseSample, bone: BoneName): { x: number; y: number } {
  const sk = resolve(rig.bones, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
    pivot: rotationPivot(rig),
  });
  return { x: s.offsetX + sk[bone].x0, y: s.offsetY - sk[bone].y0 };
}

const LIMB_TIPS: readonly BoneName[] = ["footR", "footL", "handR", "handL", "head"];

/** How far the furthest limb reaches from the pelvis — the pose's extension. */
function extent(s: PoseSample): number {
  const hip = tipOf(s, "hip");
  let worst = 0;
  for (const b of LIMB_TIPS) {
    const p = tipOf(s, b);
    worst = Math.max(worst, Math.hypot(p.x - hip.x, p.y - hip.y));
  }
  return worst;
}

/**
 * Total angular change between two samples, in degrees, over every bone.
 *
 * A bone absent from a sample is at the **rig's rest angle**, not at zero —
 * that is what `resolve` draws. Measuring the gap against zero instead makes
 * an arm that was never posed look like it swung 170°, which is how this
 * measurement first reported that Fox's down tilt had no snap: the real number
 * was fine and the metric was lying by a factor of fifteen.
 */
function travel(a: PoseSample, b: PoseSample): number {
  const names = new Set<BoneName>([
    ...(Object.keys(a.angles) as BoneName[]),
    ...(Object.keys(b.angles) as BoneName[]),
  ]);
  let sum = 0;
  for (const n of names) {
    const rest = rig.bones[n].angle;
    const from = a.angles[n] ?? rest;
    const to = b.angles[n] ?? rest;
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    sum += Math.abs((d * 180) / Math.PI);
  }
  return sum;
}

/** Mean degrees of bone travel per unit of clip time across a span. */
function speed(name: PoseName, from: number, to: number, steps = 12): number {
  const clip = poses[name];
  if (!clip) throw new Error(`no clip ${name}`);
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t0 = from + ((to - from) * i) / steps;
    const t1 = from + ((to - from) * (i + 1)) / steps;
    sum += travel(samplePose(clip, t0), samplePose(clip, t1));
  }
  return sum / (to - from);
}

/* ------------------------------------------------------------------ tests -- */

describe("Fox declares the moves whose shape is the character", () => {
  it("overrides every attack, because every attack he has is a kick", () => {
    // SmashWiki calls seven of these a kick in as many words. The shared
    // library reaches with the arms, so falling through to it on any of them
    // is the bug this file exists to prevent regressing.
    for (const name of ["ftilt", "fsmash", "usmash", "dsmash", "nair", "fair", "bair", "uair", "dair"]) {
      expect(poses[name as PoseName], `${name} fell back to the shared clip`).toBeDefined();
    }
  });

  it("overrides all four specials, so none of them is another fighter's", () => {
    for (const name of ["neutralB", "sideB", "upB", "downB"]) {
      expect(poses[name as PoseName], `${name} is still a shared special`).toBeDefined();
    }
  });
});

describe("every clip actually animates", () => {
  it("is never one frozen pose", () => {
    for (const name of NAMES) {
      const clip = poses[name];
      if (!clip) continue;
      expect(clip.keys.length, `${name} has a single key`).toBeGreaterThan(1);
      let moved = 0;
      for (let i = 0; i < 20; i++) {
        moved += travel(samplePose(clip, i / 20), samplePose(clip, (i + 1) / 20));
      }
      // A whole attack that moves less than a right angle in total is a
      // photograph with a tremor.
      expect(moved, `${name} barely moves (${moved.toFixed(0)}°)`).toBeGreaterThan(90);
    }
  });

  it("puts its last visible shape before the terminator, which is never drawn", () => {
    for (const name of NAMES) {
      const clip = poses[name];
      // A loop has no terminator: `t = 1` is `t = 0` again, and a key there
      // would be a duplicate rather than a shape the clip converges towards.
      // Only the one-shot clips have an unsampled last frame to protect.
      if (!clip || clip.loop) continue;
      const last = clip.keys[clip.keys.length - 1];
      expect(last.t, `${name}'s last key is not a terminator at t=1`).toBe(1);
      const penultimate = clip.keys[clip.keys.length - 2];
      expect(penultimate.t, `${name} has nothing to show before t=1`).toBeLessThanOrEqual(0.98);
    }
  });

  it("closes the idle loop instead of terminating it", () => {
    // The wrap span from the last key back to key 0 is a real span that gets
    // drawn, so a key at t = 1 would be both a duplicate of key 0 and a dead
    // stop at the top of every cycle. `period` is what makes the loop a loop:
    // without it `poseTimeFor` has no cycle length to divide by.
    const clip = poses.idle;
    if (!clip) throw new Error("no idle");
    expect(clip.loop, "Fox's idle is not marked as a loop").toBe(true);
    expect(clip.period, "a loop with no period has no cycle length").toBeGreaterThan(0);
    expect(clip.keys[clip.keys.length - 1].t, "the loop has no wrap span").toBeLessThan(1);
  });
});

describe("the strike key is where the clip says it is", () => {
  it("is at full extension on the contact key", () => {
    for (const name of NAMES) {
      const clip = poses[name];
      if (!clip?.strike) continue;
      // Up air is the exception, and it is an honest one: its first hitbox is
      // the *tail* sweep, and the tail is a prop hung off the hip rather than a
      // bone, so limb extension cannot see it. It gets its own check below.
      if (name === "uair") continue;
      // Fire Fox likewise: its `strike` is the *ignition* on frame 20, and the
      // move's greatest extension is deliberately thirty frames later at the
      // launch. Being 89% extended at the moment he catches fire is the shape
      // the move has, not a clip that failed to arrive.
      if (name === "upB") continue;
      const atStrike = extent(samplePose(clip, clip.strike));
      let peak = 0;
      for (let i = 0; i <= 60; i++) peak = Math.max(peak, extent(samplePose(clip, i / 60)));
      // Not "the maximum is exactly at strike" — several of these hold their
      // extension for a while and a couple reach further on the follow-through.
      // What matters is that the frame the hitbox is live on is not a fighter
      // still winding up.
      expect(atStrike / peak, `${name} is only ${((atStrike / peak) * 100) | 0}% extended at contact`)
        .toBeGreaterThan(0.9);
    }
  });

  it("sweeps the tail on up air's first hit, which is what that hit is", () => {
    // "A tail sweep followed by a heel kick." The tail is mounted on `hip` in
    // `rig.ts` precisely so a pose can swing it, so the measurable form of
    // "the tail swept" is that the hip is a long way from where it rests.
    const clip = poses.uair;
    if (!clip?.strike) throw new Error("no uair");
    const hip = clip.keys.find((k) => k.t === clip.strike)?.pose.hip ?? 0;
    expect(Math.abs((hip * 180) / Math.PI), "up air's first hit does not move the tail")
      .toBeGreaterThan(45);
  });

  /**
   * The animation agrees with the frame data about *where* the move happens.
   *
   * This is the one that ties the drawing to `fighters/fox.ts`. A kick whose
   * boot is nowhere near the hitbox it is supposed to be is a fighter swinging
   * at empty air while the opponent takes damage, and nothing else in the
   * project would notice.
   */
  const BUSINESS_END: ReadonlyArray<readonly [PoseName, MoveSlot, BoneName, number]> = [
    ["jab", "jab1", "handR", 0],
    ["ftilt", "ftilt", "footR", 0],
    ["utilt", "utilt", "footR", 0],
    ["dtilt", "dtilt", "footR", 0],
    ["dashAttack", "dashAttack", "footR", 0],
    ["fsmash", "fsmash", "footR", 0],
    ["usmash", "usmash", "footR", 0],
    ["dsmash", "dsmash", "footR", 0],
    ["nair", "nair", "footR", 0],
    ["fair", "fair", "footR", 0],
    ["bair", "bair", "footR", 0],
    ["grab", "grab", "handR", 0],
    ["downB", "downB", "handR", 0],
  ];

  it("puts the striking limb inside the hitbox it is drawing", () => {
    for (const [name, slot, bone, index] of BUSINESS_END) {
      const clip = poses[name];
      const hb = def.moves[slot]?.hitboxes[index];
      if (!clip?.strike || !hb) throw new Error(`missing ${name}/${slot}`);
      const tip = tipOf(samplePose(clip, clip.strike), bone);
      // Fixed-point Q12 in the def; a plain divide is enough for a bound.
      const hx = hb.x / 4096;
      const hy = hb.y / 4096;
      const r = hb.radius / 4096;
      const miss = Math.hypot(tip.x - hx, tip.y - hy);
      // The limb has thickness and the hitbox is a sphere on a bone rather than
      // on a fingertip, so a boot's *tip* is allowed to sit a boot-length
      // outside the sphere's centre-to-centre radius.
      expect(miss, `${name}: ${bone} is ${miss.toFixed(1)} from a hitbox of radius ${r.toFixed(1)}`)
        .toBeLessThan(r + 2.2);
    }
  });
});

describe("the snap is real — this is the whole of what makes him Fox", () => {
  /**
   * He is the fastest fighter in the game and that lives in the animation, not
   * in the attribute table. Concretely: the limb crosses into contact several
   * times faster than it unwinds out of it.
   *
   * Measured rather than asserted — mean bone travel per unit clip time over
   * the span that lands on the strike, against the same measure over the tail
   * of the recovery. A clip eased smoothly end to end scores about 1.0 here,
   * which is the putty this is guarding against.
   */
  it("covers the strike span far faster than the recovery", () => {
    for (const name of NAMES) {
      const clip = poses[name];
      const s = clip?.strike;
      if (!clip || s === undefined || s < 0.08) continue;
      // The fastest window anywhere in the wind-up, not only the one ending on
      // the strike. Fox Illusion snaps out of its coil four frames *before*
      // contact and then holds the streak — the hitbox trails behind him — so
      // measuring only the last seven hundredths would score the one move
      // built entirely out of snap as the least snappy thing he has.
      let approach = 0;
      for (let w = 0; w + 0.07 <= s + 1e-9; w += 0.01) {
        approach = Math.max(approach, speed(name, w, w + 0.07, 6));
      }
      const recovery = speed(name, 0.75, 0.97);
      expect(approach / Math.max(1e-6, recovery), `${name} has no snap`).toBeGreaterThan(3);
    }
  });

  /**
   * The extension has to survive the *whole* active window, not just its first
   * frame.
   *
   * `ease: "out"` is a cubic, so a clip whose next key is far away is already
   * a third of the way into its recovery four frames after contact — and most
   * of Fox's hitboxes are live for longer than that. His dash attack is live
   * for twelve frames and his neutral air for twenty. Cut the hold short and
   * the move connects while the fighter is visibly putting it away, which
   * reads as a hit that should not have landed.
   *
   * The bound below is the same map `poseTimeFor` uses, computed from the
   * move's own hitbox data rather than from anything written in `poses.ts`, so
   * deleting a hold key fails this with the frame it broke on.
   */
  it("stays extended until the last frame its hitbox is live", () => {
    const CHECK: ReadonlyArray<readonly [PoseName, MoveSlot]> = [
      ["ftilt", "ftilt"], ["utilt", "utilt"], ["dtilt", "dtilt"],
      ["dashAttack", "dashAttack"], ["fsmash", "fsmash"], ["usmash", "usmash"],
      ["dsmash", "dsmash"], ["nair", "nair"], ["fair", "fair"], ["bair", "bair"],
      ["uair", "uair"], ["grab", "grab"],
    ];
    for (const [name, slot] of CHECK) {
      const clip = poses[name];
      const move = def.moves[slot];
      if (!clip?.strike || !move) throw new Error(`missing ${name}`);
      const first = Math.min(...move.hitboxes.map((h) => h.startFrame)) - 1;
      const last = Math.max(...move.hitboxes.map((h) => h.endFrame)) - 1;
      const s = clip.strike;
      const endOfActive = s + ((1 - s) * (last - first)) / (move.totalFrames - first);
      const peak = extent(samplePose(clip, s));
      const atEnd = extent(samplePose(clip, endOfActive));
      expect(
        atEnd / peak,
        `${name} is only ${((atEnd / peak) * 100) | 0}% extended on frame ${last + 1}, its last active frame`,
      ).toBeGreaterThan(0.88);
    }
  });

  it("holds the contact shape instead of drifting through it", () => {
    // Everything with a real hold: the shape must still be there a few frames
    // after contact. Fox's neutral air is the extreme case — the weak hitbox
    // is live for seventeen frames and the leg genuinely stays out.
    for (const name of ["ftilt", "fsmash", "dsmash", "nair", "bair", "downB"] as PoseName[]) {
      const clip = poses[name];
      if (!clip?.strike) continue;
      const held = travel(samplePose(clip, clip.strike), samplePose(clip, clip.strike + 0.05));
      expect(held, `${name} drifts ${held.toFixed(0)}° out of its own contact frame`).toBeLessThan(12);
    }
  });
});

describe("his feet stay on the stage", () => {
  /**
   * `offsetY` is absolute: a crouch that drops the body without folding the
   * legs by the same amount puts his boots through the floor. It is invisible
   * in a still — the stage is drawn over them — and obvious in motion, and it
   * is the single easiest thing to get wrong in a pose.
   */
  const GROUNDED: readonly PoseName[] = [
    "jab", "ftilt", "utilt", "dtilt", "dsmash", "grab", "neutralB", "downB", "sideB",
  ];

  it("never sinks a foot below the floor", () => {
    for (const name of GROUNDED) {
      const clip = poses[name];
      if (!clip) continue;
      let lowest = Infinity;
      let at = 0;
      for (let i = 0; i <= 60; i++) {
        const s = samplePose(clip, i / 60);
        for (const b of ["footL", "footR"] as BoneName[]) {
          const y = tipOf(s, b).y;
          if (y < lowest) {
            lowest = y;
            at = i / 60;
          }
        }
      }
      // Six tenths of a unit is the bar because that is roughly what a boot's
      // own thickness hides: at Fox's 11.5-unit height it is about two pixels
      // at match scale, and it is inside the platform the stage draws over
      // him. Deeper than that and a leg is visibly through the floor, which is
      // what this caught in the down smash split, the shine's stance, the down
      // tilt sweep and the Illusion's plant.
      expect(lowest, `${name} puts a boot ${(-lowest).toFixed(2)} below the stage at t=${at.toFixed(2)}`)
        .toBeGreaterThan(-0.6);
    }
  });
});

/* ------------------------------------------------------------------- tail -- */

/**
 * Paint the tail and hand back its spine, in the prop's own frame.
 *
 * The spine is the run of `ellipse` calls: nine overlapping fur masses from the
 * rump to the white tip, in order, so the last one is the tip and its angle
 * from the base is the thing every test below actually measures. Reading the
 * geometry back out of the recorder is the only way to test a painter — it has
 * no return value and its whole output is drawing calls.
 */
function tailSpine(anim: Partial<PropAnim> = {}): { x: number; y: number }[] {
  const prop = rig.props.find((p) => p.bone === "hip" && p.layer === "behind");
  if (!prop?.draw) throw new Error("Fox has no custom tail on his hip");
  const ctx = createMockContext();
  const brush = {
    ctx,
    mode: "body" as const,
    palette: {},
    rimLocal: 0,
    outline: "#000000",
    fill: () => {},
    line: () => {},
  };
  prop.draw(brush as never, prop, { ...PROP_STILL, ...anim });
  return ctx.calls
    .filter((c) => c.method === "ellipse")
    .map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
}

/** The tip's angle above the horizontal, degrees. Positive is raised. */
function tailAngle(anim: Partial<PropAnim> = {}): number {
  const spine = tailSpine(anim);
  const tip = spine[spine.length - 1];
  // `-x` because the tail runs backwards out of the prop frame, whose `+x` is
  // the way the fighter faces.
  return (Math.atan2(tip.y, -tip.x) * 180) / Math.PI;
}

/** How far the tip is from the rump, in prop units. */
function tailReach(anim: Partial<PropAnim> = {}): number {
  const spine = tailSpine(anim);
  const tip = spine[spine.length - 1];
  return Math.hypot(tip.x, tip.y);
}

describe("the tail moves on its own, which is most of what makes it a tail", () => {
  /**
   * Round one's tail could only move when a pose moved the hip, so it could not
   * lag, follow through or settle — and a tail that tracks the body rigidly
   * reads as a bolted-on shape rather than as an animal's. Every test here
   * measures the tip's angle out of the recorder, because that is the number a
   * player is actually reading at match scale.
   */
  /** Fox's run, decoded out of the simulation's fixed-point. */
  const RUNNING = toFloat(def.attributes.runSpeed);

  it("streams up and back at a run and hangs when he backs away", () => {
    // `toFloat`, because `anim.vx` is world units per frame and the attribute
    // is the simulation's fixed-point. Feeding the raw value here saturated the
    // clamp, which made every speed above a walk look identical to the test.
    const run = tailAngle({ vx: RUNNING });
    const rest = tailAngle({});
    const backing = tailAngle({ vx: -RUNNING });
    expect(run - rest, "the tail does not lift at a run").toBeGreaterThan(20);
    // Signed, not `Math.abs`: the first version straightened the arc on speed
    // in *either* direction, and backing away lifted the tip above where it
    // rests — a tail being dragged forwards has to hang, not fly.
    expect(rest - backing, "the tail does not drop when he backs away").toBeGreaterThan(20);
  });

  it("is monotone in speed, so a walk is between a stand and a run", () => {
    const at = (v: number) => tailAngle({ vx: RUNNING * v });
    const stops = [-1, -0.5, 0, 0.5, 1].map(at);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i], `the tail is not monotone in speed at step ${i}`).toBeGreaterThan(stops[i - 1]);
    }
  });

  it("straightens as it streams rather than only swinging up", () => {
    // Two different things, and only one of them survives a still frame. A tail
    // rotated up but still curled reads as a raised tail; a *straight* one
    // reads as a tail being dragged, which is the one that says "fast".
    // Measured as a fraction of its own length, so it is about the arc opening
    // out and not about how long the tail happens to be.
    const rest = tailReach({});
    expect(
      (tailReach({ vx: def.attributes.runSpeed }) - rest) / rest,
      "the tail does not open out at a run",
    ).toBeGreaterThan(0.03);
  });

  it("is long enough to leave his outline, which is the point of drawing one", () => {
    // The tail is the biggest single shape he has and the only part of him that
    // breaks the body silhouette in every pose. Its length is not decoration:
    // a short one sits inside the far leg and reads as a lump on his hip, which
    // is what the shared `tailBushy` did and what this replaced.
    const prop = rig.props.find((p) => p.bone === "hip" && p.layer === "behind");
    if (!prop) throw new Error("no tail");
    const units = tailReach({}) * prop.size;
    const legs = rig.bones.thighR.length + rig.bones.shinR.length;
    expect(units, `the tail reaches ${units.toFixed(1)} units — shorter than his own leg`)
      .toBeGreaterThan(legs);
  });

  it("flares up as he falls, because drag has a sign in both axes", () => {
    // `fallSpeed` is downward, so `vy` is negative and the tail is pushed up.
    expect(
      tailAngle({ vy: -def.attributes.fallSpeed, airborne: true }) - tailAngle({}),
      "the tail ignores the direction he is falling",
    ).toBeGreaterThan(4);
  });

  it("sways on its own clock at rest, and settles down while a move is on", () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let f = 0; f < 120; f++) {
      const a = tailAngle({ frame: f });
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    // Visible drift, and nowhere near a wag.
    expect(hi - lo, "the tail is frozen at rest").toBeGreaterThan(6);
    expect(hi - lo, "the tail is wagging").toBeLessThan(30);

    // Damped mid-move: the pose is already swinging the hip and an independent
    // sine on top of that reads as noise.
    //
    // Compared as *ranges over the cycle* rather than frame against frame. The
    // first version of this test measured each frame against frame 0 and went
    // red on frame 0 itself, which was right to: the travelling wave down the
    // chain is not zero at phase zero, so damping it moves the tail even at the
    // instant the root's own sine is at rest. There is no single frame the two
    // curves have to agree on; what has to be true is that one swings less.
    let busyLo = Infinity;
    let busyHi = -Infinity;
    for (let f = 0; f < 120; f++) {
      const a = tailAngle({ frame: f, t: 0.5 });
      busyLo = Math.min(busyLo, a);
      busyHi = Math.max(busyHi, a);
    }
    expect(busyHi - busyLo, "the sway is not damped during a move").toBeLessThan((hi - lo) * 0.6);
  });

  it("is dead still for a portrait, so two stock icons agree", () => {
    // `PROP_STILL` is what a character-select tile and the silhouette check get.
    // A prop that swayed there would make two drawings of the same fighter
    // differ for a reason no reader could see.
    expect(tailSpine(PROP_STILL)).toEqual(tailSpine(PROP_STILL));
    expect(tailAngle(PROP_STILL)).toBe(tailAngle({}));
  });

  /**
   * The units `anim.vx` arrives in, pinned from both ends.
   *
   * `PropAnim` documents world units per frame, and for a while the renderer
   * did not honour that: it passed `f.vx` through untouched, and `f.vx` is
   * fixed-point Q12 because `physics.ts` does `f.x += f.vx` on a fixed-point
   * `x`. A full run reached a painter as 9839 rather than 2.402. This file
   * compensated locally with `toFloat`, which worked and was the wrong shape of
   * fix — every author would have invented a different correction, and the ones
   * who never noticed would have shipped a tail swinging by three thousand
   * radians. The renderer now converts, and the compensation here is gone.
   *
   * So the test is the other way round from how it started. The tail must
   * saturate at the run speed *decoded*, and must barely move when handed the
   * raw fixed-point — because handing it the raw value is precisely the
   * regression, and a `toFloat` restored to `rig.ts` would be the same bug
   * wearing the opposite sign. Neither failure is visible in a still frame.
   */
  it("reads velocity in the world units the renderer promises", () => {
    expect(Number.isInteger(def.attributes.runSpeed), "runSpeed is no longer fixed-point").toBe(true);
    const running = toFloat(def.attributes.runSpeed);
    expect(running).toBeCloseTo(2.402, 3);

    const rest = tailAngle({});
    const decoded = tailAngle({ vx: running });
    expect(decoded - rest, "a full run does not saturate the streaming").toBeGreaterThan(20);

    // Saturated rather than wild, so the raw value cannot be told from a legal
    // fast one by the angle alone — which is why the *decoded* end of this test
    // is the half that carries it.
    const raw = tailAngle({ vx: def.attributes.runSpeed });
    expect(Math.abs(raw - decoded), "the clamp stopped saturating").toBeLessThan(1e-6);
  });
});

/* --------------------------------------------------- the two reach defects -- */

describe("the limb carries the move, not the effect painted over it", () => {
  /**
   * Round one's note: "his up smash boot cannot clear his head — the leg chain
   * is shorter than the head bone plus the head radius, so the effect carries
   * the move and the limb does not". It is true of a body held upright and
   * false of the move, which is a somersault: after 135° of body rotation
   * "down the leg" is up and forward, and the boot passes over a head that is
   * now underneath it.
   */
  it("puts the up smash boot clear above his own head", () => {
    const clip = poses.usmash;
    if (!clip?.strike) throw new Error("no usmash");
    const s = samplePose(clip, clip.strike);
    const boot = tipOf(s, "footR");
    const head = tipOf(s, "head");
    const crown = head.y + rig.headRadius;
    expect(boot.y, `the up smash boot is at ${boot.y.toFixed(1)}, his crown at ${crown.toFixed(1)}`)
      .toBeGreaterThan(crown + 1);
    // And it is a somersault, not a fighter reaching: the pelvis has to be
    // above the skull, which is the half of the shape that cannot be faked.
    expect(tipOf(s, "hip").y, "he is not actually inverted").toBeGreaterThan(head.y + 2);
  });

  it("scissors the up smash's legs instead of moving them as one", () => {
    /**
     * A bicycle kick is two legs doing different things — one straight down the
     * body's own axis and the other folded hard into the chest, trading over
     * between the clean hit and the late one. At 26° apart they were parallel,
     * and two parallel limbs at match scale are one fat limb: a review looking
     * at the capture called it a single leg, which is the whole move's read
     * gone.
     *
     * Measured at the **thighs**, which is where the split actually lives. Two
     * earlier versions of this test measured the wrong thing and both scored a
     * visibly scissoring pose as a pair: the angle between the hip-to-boot
     * vectors barely moves when a knee folds (18° on a pose that plainly
     * splits), and neither does the boot's distance from the pelvis, because
     * the 1.7-unit foot bone gives most of it back. What a scissor is, on this
     * rig, is one thigh driving down the body's axis while the other swings
     * forward to the chest — a Z-fold — and the thigh bearings are the one
     * number that says so.
     */
    const clip = poses.usmash;
    if (!clip?.strike) throw new Error("no usmash");
    const thighs = (t: number): number => {
      const s = samplePose(clip, t);
      const dir = (b: BoneName) => {
        const base = baseOf(s, b);
        const tip = tipOf(s, b);
        return Math.atan2(tip.y - base.y, tip.x - base.x);
      };
      let d = ((dir("thighR") - dir("thighL")) * 180) / Math.PI;
      while (d > 180) d -= 360;
      while (d <= -180) d += 360;
      return d;
    };
    const hit = thighs(clip.strike);
    expect(Math.abs(hit), `the up smash's thighs are ${Math.abs(hit).toFixed(0)}° apart — one limb`)
      .toBeGreaterThan(35);
    // And they trade sides between the clean hit and the late one, which is the
    // second half of the pedal rather than the same shape held.
    expect(hit * thighs(0.35), "the same leg leads both halves of the pedal").toBeLessThan(0);
  });

  /**
   * "Fox plants his hands on the ground and does a scorpion kick." Round one
   * could not and said so. The fix was not a longer arm — it was committing to
   * the pitch, which brings the shoulder down to meet the floor.
   */
  it("plants both up tilt hands on the stage", () => {
    const clip = poses.utilt;
    if (!clip?.strike) throw new Error("no utilt");
    const s = samplePose(clip, clip.strike);
    // The hand capsule is 1.75 thick, so its underside is 0.88 below the bone
    // tip: a tip inside a narrow band either side of that height is a palm
    // resting *on* the stage. Both bounds matter and the lower one is the one
    // that is easy to leave too loose — a body dropped far enough to plant the
    // hands drives them straight through the floor instead, and "not more than
    // a hand's depth under" still admits a fighter buried to the wrist.
    const palm = rig.bones.handR.thickness / 2;
    for (const bone of ["handR", "handL"] as BoneName[]) {
      const h = tipOf(s, bone).y;
      expect(h, `${bone} is ${h.toFixed(2)} up — that is a lean, not a plant`).toBeLessThan(palm + 0.3);
      expect(h, `${bone} is ${h.toFixed(2)}, driven through the stage`).toBeGreaterThan(palm - 0.45);
    }
    // Doubled over, not bent: hips above shoulders, muzzle below the hips.
    expect(tipOf(s, "hip").y, "his hips are not the top of him").toBeGreaterThan(tipOf(s, "torso").y);
    expect(tipOf(s, "head").y, "his head is not down by his hands").toBeLessThan(6);
  });
});

/* ------------------------------------------------------------------ stance -- */

describe("the stand is his own and not the roster's", () => {
  /**
   * The pose he is in for most of a match. The shared clip is a person standing
   * upright with their arms hanging; Fox waits in a low forward-leaning ready
   * stance, and since around twenty clips hand off to this one it is also the
   * silhouette everything else departs from.
   */
  it("is low, leaning and carrying the near hand up in front", () => {
    const clip = poses.idle;
    if (!clip) throw new Error("Fox is still on the shared idle");
    let leanest = 0;
    for (let i = 0; i < 24; i++) {
      const s = samplePose(clip, i / 24);
      const head = tipOf(s, "head");
      const hip = tipOf(s, "hip");
      const hand = tipOf(s, "handR");
      // Head forward of the pelvis — the lean, and the whole read.
      leanest = Math.max(leanest, head.x - hip.x);
      expect(head.y, `he stands ${head.y.toFixed(2)} tall at t=${(i / 24).toFixed(2)} — that is the shared clip`)
        .toBeLessThan(10.9);
      // Carried, not hanging: the near hand is in front of the hip rather than
      // beside it, and above the knee.
      expect(hand.x - hip.x, "the near hand hangs at his side").toBeGreaterThan(1.6);
      expect(hand.y, "the near hand has dropped past the knee").toBeGreaterThan(4.2);
    }
    expect(leanest, "he is not leaning forward at all").toBeGreaterThan(0.5);
  });

  it("keeps both boots on the stage through the whole breath", () => {
    // A loop is drawn thousands of times a match, so a foot a tenth of a unit
    // under the stage here is not the transient it would be in an attack.
    const clip = poses.idle;
    if (!clip) throw new Error("no idle");
    for (let i = 0; i < 60; i++) {
      const s = samplePose(clip, i / 60);
      for (const b of ["footL", "footR"] as BoneName[]) {
        const y = tipOf(s, b).y;
        expect(y, `${b} is ${(-y).toFixed(2)} under the stage at t=${(i / 60).toFixed(2)}`)
          .toBeGreaterThan(-0.2);
      }
    }
  });

  it("breathes on beats that do not arrive together", () => {
    /**
     * Two keys give a rise and a fall with every bone turning round at the same
     * instant, which the eye reads as a metronome however small the amplitude
     * is. What stops that is the parts being out of step, so this measures
     * *when* each one reaches its own extreme.
     *
     * Measured on the head's own angle rather than on the height of its tip:
     * the tip is dominated by whatever the chest is doing under it, so a head
     * that is turning entirely independently still peaks a frame after the
     * chest and the height comparison says nothing. The first version of this
     * test asserted on the tip and was satisfiable only by a head that nodded
     * more than twenty degrees a breath — a bob, which is worse than the
     * metronome it was trying to catch.
     */
    const clip = poses.idle;
    if (!clip) throw new Error("no idle");
    expect(clip.keys.length, "a two-key breath is a metronome").toBeGreaterThanOrEqual(4);

    const N = 60;
    const argExtreme = (pick: (s: PoseSample) => number, want: "max" | "min"): number => {
      let best = want === "max" ? -Infinity : Infinity;
      let at = 0;
      for (let i = 0; i < N; i++) {
        const v = pick(samplePose(clip, i / N));
        if (want === "max" ? v > best : v < best) { best = v; at = i; }
      }
      return at;
    };
    const rest = (b: BoneName) => rig.bones[b].angle;
    const chest = argExtreme((s) => tipOf(s, "torso").y, "max");
    const head = argExtreme((s) => s.angles.head ?? rest("head"), "min");
    const arm = argExtreme((s) => s.angles.upperArmR ?? rest("upperArmR"), "min");

    // A tenth of the cycle apart is the bar: closer than that and two bones are
    // turning round on the same beat as far as an eye is concerned.
    expect(Math.abs(chest - head), "the chest and the head turn round together").toBeGreaterThan(N / 10);
    expect(Math.abs(chest - arm), "the chest and the near arm turn round together").toBeGreaterThan(N / 10);
    expect(Math.abs(head - arm), "the head and the near arm turn round together").toBeGreaterThan(N / 10);
  });
});

/* --------------------------------------------------------------------- fx -- */

function paint(slot: MoveSlot, frame: number, total = 40) {
  const ctx = createMockContext();
  const fn = fx[slot];
  if (!fn) throw new Error(`no effect for ${slot}`);
  fn({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    f: { facing: 1, charge: 0 } as never,
    def: def as never,
    cam: { zoom: 12 } as never,
    height: 11,
    x: 800,
    y: 600,
    u: 12,
    frame,
    total,
    t: frame / total,
    dir: 1,
    over: (paint: () => void) => paint(),
  });
  return ctx.calls.length;
}

/**
 * The same, but keeping the two layers apart.
 *
 * `paint` above runs every `over` callback inline, which is right for counting
 * "did this draw anything at all" and blind to the one thing that matters for a
 * move the fighter is *inside*: whether any of it lands in front of him.
 */
function paintLayers(slot: MoveSlot, frame: number, total: number) {
  const ctx = createMockContext();
  const fn = fx[slot];
  if (!fn) throw new Error(`no effect for ${slot}`);
  const queued: (() => void)[] = [];
  fn({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    f: { facing: 1, charge: 0 } as never,
    def: def as never,
    cam: { zoom: 12 } as never,
    height: 11,
    x: 800,
    y: 600,
    u: 12,
    frame,
    total,
    t: frame / total,
    dir: 1,
    over: (p: () => void) => queued.push(p),
  });
  const under = ctx.calls.length;
  for (const p of queued) p();
  return { under, over: ctx.calls.length - under };
}

describe("Fire Fox is a flame he is inside, not one he is standing on", () => {
  /**
   * "Engulfs himself in an aura of flame before launching himself in a fiery
   * tackle." Effects paint under the fighter by default, and that default made
   * a 91-frame move into a fox standing to attention on a small campfire: the
   * aura was a rim of orange around his outline and the comet was a plume
   * leaking out from under his boots, because the body was drawn on top of all
   * of it. `over` is what fixes that, and it is the property to guard — this
   * regresses silently, and it regresses into something that still looks like
   * *an* effect.
   */
  it("paints on both sides of the body through the gather and the flight", () => {
    for (const frame of [8, 15, 30, 55, 70]) {
      const { under, over } = paintLayers("upB", frame, 91);
      expect(under, `nothing behind him on frame ${frame}`).toBeGreaterThan(4);
      expect(over, `nothing in front of him on frame ${frame} — he is beside the fire`)
        .toBeGreaterThan(4);
    }
  });

  it("keeps the trail behind him, where it cannot bury the fighter", () => {
    // The long plume is the half that must *not* move in front: it is nine
    // units of near-opaque flame and it would cover him completely.
    const { under, over } = paintLayers("upB", 40, 91);
    expect(under, "the trail is no longer behind him").toBeGreaterThan(over);
  });
});

describe("the Reflector is a field he is inside", () => {
  it("puts its front face and its device over the fighter", () => {
    // Same failure as Fire Fox and the same fix: drawn only underneath, the
    // hexagon is a decal on the background — the fighter's own colours are
    // untouched and nothing says he is *in* anything. The front face tints him
    // and the device's star flare sits on his chest, and both are in front.
    for (const frame of [4, 10, 20]) {
      const { under, over } = paintLayers("downB", frame, 45);
      expect(under, `no field behind him on frame ${frame}`).toBeGreaterThan(4);
      expect(over, `nothing over him on frame ${frame} — the field is a backdrop`)
        .toBeGreaterThan(4);
    }
  });

  it("holds still instead of spinning", () => {
    /**
     * The first version rotated the hexagon 0.18 rad a frame and counter-rotated
     * an inner one. The real field snaps on and holds, and that is a
     * readability property rather than a stylistic one: the graphic's whole job
     * is to say "this is up for exactly these frames", and a field that churns
     * says it is doing something continuous.
     *
     * Measured off the vertices the polygon actually emits, so it catches a
     * rotation reintroduced anywhere — the fill, either rim, or a new layer.
     */
    const verticesAt = (frame: number) => {
      const ctx = createMockContext();
      const fn = fx.downB;
      if (!fn) throw new Error("no downB");
      fn({
        ctx: ctx as unknown as CanvasRenderingContext2D,
        f: { facing: 1, charge: 0 } as never,
        def: def as never,
        cam: { zoom: 12 } as never,
        height: 11,
        x: 800,
        y: 600,
        u: 12,
        frame,
        total: 45,
        t: frame / 45,
        dir: 1,
        // Deliberately dropped rather than run. The device's star flare is
        // drawn in the over-layer and its two spikes point straight up and
        // straight down, so running it hands this measurement a vertex at -90°
        // whatever the hexagon is doing — which is how the first version of
        // this test passed against a flat-top field.
        over: () => {},
      });
      // `lineTo`/`moveTo` as bearings from the field's own centre, so only the
      // *orientation* is compared and not the size.
      return ctx.calls
        .filter((c) => c.method === "lineTo" || c.method === "moveTo")
        .map((c) => {
          const dx = (c.args[0] as number) - 800;
          const dy = (c.args[1] as number) - (600 - 12 * 5.5);
          return Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
        });
    };
    const a = verticesAt(8);
    const b = verticesAt(17);
    expect(a.length, "the hexagon emits no vertices").toBeGreaterThan(6);
    expect(b, "the Reflector is turning during its own hold").toEqual(a);
    // And pointy-top: a vertex straight up, so the left and right edges are
    // vertical. A flat-top hexagon is a different shape at a glance and this
    // one is his logo.
    expect(a, "the hexagon is not pointy-top").toContain(-90);
  });
});

describe("the effects paint on the frames the move is live and not otherwise", () => {
  it("draws Fire Fox's flame across the gather, the ignition and the flight", () => {
    expect(paint("upB", 2, 91), "flame before the gather starts").toBe(0);
    expect(paint("upB", 12, 91), "no flame while it gathers").toBeGreaterThan(10);
    expect(paint("upB", 21, 91), "no ignition burst").toBeGreaterThan(10);
    expect(paint("upB", 55, 91), "no comet during the flight").toBeGreaterThan(10);
    expect(paint("upB", 88, 91), "flame still burning after the move ended").toBe(0);
  });

  it("draws the Illusion trail only while the engine is actually moving him", () => {
    // `momentum` in `fighters/fox.ts` launches him on frame 18 and carries him
    // eight frames. A trail outside that is a smear with nothing behind it.
    expect(paint("sideB", 10, 55), "trail before he moves").toBe(0);
    expect(paint("sideB", 20, 55), "no trail while he travels").toBeGreaterThan(10);
    expect(paint("sideB", 45, 55), "trail still there long after he stopped").toBe(0);
  });

  it("draws the Blaster's pistol while it is out, and nothing before the draw", () => {
    expect(paint("neutralB", 2, 36), "pistol drawn before he reaches for it").toBe(0);
    expect(paint("neutralB", 12, 36), "no pistol on the firing frame").toBeGreaterThan(5);
    expect(paint("neutralB", 34, 36), "pistol still out after he holsters it").toBe(0);
  });

  it("shows the Reflector for the frames it reflects", () => {
    expect(paint("downB", 6, 36), "no shine while it is up").toBeGreaterThan(5);
  });
});

describe("the Blaster bolt is his own graphic", () => {
  it("has a painter, so it is not the roster's default energy ball", () => {
    // Keyed by the projectile's def id, and a typo here is silent: the bolt
    // simply falls through to `paintEnergy` and looks like Samus's.
    const launched = new Set(
      Object.values(def.moves).flatMap((m) => (m?.projectiles ?? []).map((p) => p.id)),
    );
    expect(launched.has("blaster")).toBe(true);
    expect(projectiles.blaster).toBeDefined();
  });

  it("draws something, and draws it longer than it is tall", () => {
    const ctx = createMockContext();
    projectiles.blaster({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      u: 12,
      age: 4,
      dir: 1,
      heading: 0,
      charge: 1,
      returning: false,
      frame: 40,
    });
    expect(ctx.calls.length).toBeGreaterThan(5);
    // A laser is a laser because of its aspect ratio. Every ellipse it paints
    // has to be wider along its heading than across it, or it is a ball.
    const ellipses = ctx.calls.filter((c) => c.method === "ellipse");
    expect(ellipses.length).toBeGreaterThan(0);
    for (const e of ellipses) {
      const [, , rx, ry] = e.args as number[];
      expect(rx, "the bolt is not elongated along its heading").toBeGreaterThan(ry * 2);
    }
  });
});

describe("the silhouette is his", () => {
  it("keeps the three shapes that leave his outline", () => {
    // Ears, muzzle and tail are the read. Each is a prop that breaks the body
    // outline, and losing any of them turns him back into a generic biped.
    const bones = rig.props.map((p) => p.bone);
    expect(bones.filter((b) => b === "head").length, "no head props — ears or muzzle missing")
      .toBeGreaterThanOrEqual(2);
    expect(rig.props.some((p) => p.bone === "hip" && p.layer === "behind"), "no tail").toBe(true);
  });

  it("wears the white jacket on his torso, which is the identifying mark", () => {
    // `fighters/fox.ts` says in as many words that the fur is pulled toward
    // tan-gold so he is not mistaken for Samus and that the jacket is what
    // identifies him. The rig used to have that exactly inverted — jacket
    // white on his legs, fur on his torso.
    expect(rig.boneColour.torso).toBe("secondary");
    expect(rig.boneColour.head).toBe("primary");
    expect(rig.boneColour.thighR).not.toBe("secondary");
  });
});
