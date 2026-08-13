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
import type { MoveSlot } from "@/engine/types";
import { samplePose, type PoseSample } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { resolve, type BoneName } from "../../skeleton";
import { rotationPivot } from "../../characterArt";
import { createMockContext } from "../../mockContext";
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
      if (!clip) continue;
      const last = clip.keys[clip.keys.length - 1];
      expect(last.t, `${name}'s last key is not a terminator at t=1`).toBe(1);
      const penultimate = clip.keys[clip.keys.length - 2];
      expect(penultimate.t, `${name} has nothing to show before t=1`).toBeLessThanOrEqual(0.98);
    }
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
  });
  return ctx.calls.length;
}

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
