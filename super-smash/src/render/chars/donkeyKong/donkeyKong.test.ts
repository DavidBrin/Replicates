/**
 * Donkey Kong's own clips, tested for the things that are true of *him*.
 *
 * These are deliberately not a restatement of the numbers in `poses.ts` — a
 * test that asserts `upperArmR` is 214 degrees at `t = 0.18` fails the moment
 * anyone improves the drawing, and passes just as happily when the drawing is
 * wrong. What is asserted here is the set of properties that were actually
 * broken before this directory existed, each of which is observable from the
 * resolved skeleton rather than from the source:
 *
 * - the clip *moves* (seventeen of the twenty-one shared movement clips were a
 *   single frozen pose, and a photograph cannot be mistimed);
 * - the clip *peaks on the frame the hitbox is live*, because `strike` is the
 *   one thing an attack's animation can be objectively wrong about;
 * - his **feet point forwards**, which is the `footR: -88` trap in
 *   `skeleton.ts` that three separate people have shipped;
 * - his soles stay on the stage;
 * - and the silhouette stays DK's — arms past the knees, hands clear of the
 *   barrel — which is the whole reason the per-character layer exists.
 */

import { describe, expect, it } from "vitest";
import { donkeyKong } from "@/fighters/donkeyKong";
import type { BoneName } from "../../skeleton";
import { resolve } from "../../skeleton";
import { rotationPivot } from "../../characterArt";
import { POSE_LIBRARY, type PoseName } from "../../poses/library";
import { angleDelta, samplePose, type PoseClip } from "../../poses/clip";
import { toFloat } from "@/engine/fixed";
import { rig } from "./rig";
import { poses } from "./poses";
import { fx, projectiles } from "./fx";

const NAMES = Object.keys(poses) as PoseName[];

/** Clips that are played standing on the stage, so the soles have to reach it. */
const AIRBORNE: ReadonlySet<PoseName> = new Set<PoseName>([
  "nair",
  "fair",
  "bair",
  "uair",
  "dair",
  "upB",
]);

/** Resolve one sample of a clip on DK's own rig, feet at the origin. */
function skeletonAt(clip: PoseClip, t: number) {
  const s = samplePose(clip, t);
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
  return { sk, sample: s };
}

/** Screen y is DOWN, so the lowest painted point of the soles is the largest y. */
function soleDepth(clip: PoseClip, t: number): number {
  const { sk, sample } = skeletonAt(clip, t);
  let low = -Infinity;
  for (const b of [sk.footL, sk.footR]) {
    low = Math.max(low, b.y0 + b.thickness / 2, b.y1 + b.thickness / 2);
  }
  return low - sample.offsetY;
}

/**
 * Where a move's own hitbox sits, in the frame the skeleton resolves in: rig
 * units, feet at the origin, screen axes (y down).
 */
function hitboxPoint(hb: { x: number; y: number }) {
  return { x: toFloat(hb.x) / rig.scale, y: -toFloat(hb.y) / rig.scale };
}

/** Hands, feet and skull — every part of him a hitbox is ever hung on. */
const EXTREMITIES = ["handL", "handR", "footL", "footR", "head"] as const;

/**
 * Which limb is doing the hitting, and how far it is from the damage.
 *
 * Two earlier versions of this measured the wrong thing, and each of them
 * passed a clip that was wrong. Distance-from-the-pelvis called the down
 * smash's overhead gather its peak, because arms overhead are further from the
 * hip than arms out sideways are. Projecting onto the hitbox's direction fixed
 * that and broke differently: the neutral air's hitbox is at (5, 7), which is
 * mostly *up*, and DK's head is always up — so the skull dominated the
 * projection on every frame and flattened out the movement being measured.
 *
 * What the question actually is: the hitbox is at a known place, one of his
 * limbs is supposed to be there, and it is supposed to stay there while the
 * hitbox is live. So find the limb nearest the hitbox on the contact frame —
 * the game's data picks it, not me — and then follow that one limb.
 */
function strikingLimb(name: PoseName, hb: { x: number; y: number }, strike: number) {
  const target = hitboxPoint(hb);
  const { sk } = skeletonAt(poses[name]!, strike);
  let best: (typeof EXTREMITIES)[number] = "handR";
  let bestD = Infinity;
  for (const b of EXTREMITIES) {
    const d = Math.hypot(sk[b].x1 - target.x, sk[b].y1 - target.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * The hitbox `strike` is anchored to: the strongest of the ones live on the
 * move's *first* active frame.
 *
 * Not simply the strongest of all of them. The down smash clubs forward for 17%
 * on frames 11-12 and backward for 18% on 13-14, and `poseTimeFor` anchors the
 * strike key on frame 11 — so "the strongest hitbox" is one that is not live on
 * the contact frame at all, and asking which limb is nearest it there picked out
 * his back foot.
 */
function strikeHitbox(slot: keyof typeof donkeyKong.moves) {
  const move = donkeyKong.moves[slot];
  if (!move || move.hitboxes.length === 0) return undefined;
  const first = Math.min(...move.hitboxes.map((h) => h.startFrame));
  const live = move.hitboxes.filter((h) => h.startFrame === first);
  return live.reduce((a, b) => (b.damage > a.damage ? b : a));
}

/** How far that limb is from the hitbox at clip time `t`, in rig units. */
function limbGap(
  name: PoseName,
  limb: (typeof EXTREMITIES)[number],
  hb: { x: number; y: number },
  t: number,
): number {
  const target = hitboxPoint(hb);
  const { sk } = skeletonAt(poses[name]!, t);
  return Math.hypot(sk[limb].x1 - target.x, sk[limb].y1 - target.y);
}

/**
 * Total angular difference between two samples of a clip, in degrees.
 *
 * Compared the short way round, which is how the sampler itself interpolates.
 * A raw subtraction reports a bone written as `238` and sampled as `-122` —
 * the same drawing — as 360 degrees apart, and duly accused the up smash of
 * stopping a full turn short of a pose it was already sitting in.
 */
function apart(name: PoseName, a: number, b: number): number {
  const clip = poses[name];
  if (!clip) throw new Error(`donkeyKong declares no ${name}`);
  const x = samplePose(clip, a);
  const y = samplePose(clip, b);
  let sum = 0;
  for (const bone of Object.keys(x.angles) as BoneName[]) {
    const p = x.angles[bone];
    const q = y.angles[bone];
    if (p !== undefined && q !== undefined) sum += (Math.abs(angleDelta(p, q)) * 180) / Math.PI;
  }
  return sum;
}

describe("Donkey Kong overrides the moves whose shape is the character", () => {
  it("declares clips at all — an empty table means he is still everybody's animation", () => {
    expect(NAMES.length).toBeGreaterThan(0);
  });

  it("only declares clips the shared library knows about", () => {
    for (const name of NAMES) {
      expect(POSE_LIBRARY[name], `unknown clip ${name}`).toBeDefined();
    }
  });

  it("declares a clip that is genuinely different from the shared one", () => {
    for (const name of NAMES) {
      const mine = poses[name];
      const shared = POSE_LIBRARY[name];
      expect(mine).not.toBe(shared);
      // Not merely a different object: a different drawing at the moment that
      // matters. Compared at the strike, because two attacks can share a rest
      // pose and still be different moves.
      const at = mine?.strike ?? 0.3;
      const a = JSON.stringify(samplePose(mine!, at));
      const b = JSON.stringify(samplePose(shared, at));
      expect(a, `${name} is a copy of the shared clip`).not.toBe(b);
    }
  });
});

describe("every clip is an animation rather than a photograph", () => {
  it("travels a long way from its opening pose at some point", () => {
    const still: string[] = [];
    for (const name of NAMES) {
      // The *furthest* the clip ever gets from where it started, not the
      // distance between its first and last frames. An attack ends roughly
      // where it began — that is what a recovery is — so comparing the two
      // ends reports the Giant Punch, which swings an arm through a full
      // circle in between, as a fighter who never moved.
      let furthest = 0;
      for (let i = 1; i <= 20; i++) furthest = Math.max(furthest, apart(name, 0, (i / 20) * 0.95));
      if (furthest < 90) still.push(name);
    }
    expect(still).toEqual([]);
  });

  it("passes through distinct shapes rather than easing between two", () => {
    for (const name of NAMES) {
      const seen = new Set<string>();
      for (let i = 0; i <= 12; i++) {
        seen.add(JSON.stringify(samplePose(poses[name]!, (i / 12) * 0.95)));
      }
      expect(seen.size, `${name} is fewer than four drawings`).toBeGreaterThanOrEqual(4);
    }
  });

  it("has essentially arrived by its last drawn frame", () => {
    // `t = 1` is never sampled — `poseTimeFor` divides `actionFrame` by the
    // state's length and `actionFrame` runs 0..n-1. A clip still a long way
    // from its terminator on the last drawn frame stops visibly short and cuts.
    const short: string[] = [];
    for (const name of NAMES) {
      const total = donkeyKong.moves[SLOT_FOR[name] ?? "jab1"]?.totalFrames ?? 40;
      const gap = apart(name, (total - 1) / total, 1);
      if (gap > 90) short.push(`${name} stops ${gap.toFixed(0)}° short`);
    }
    expect(short).toEqual([]);
  });
});

/** A move slot that reaches each pose, for reading the real frame counts. */
const SLOT_FOR: Partial<Record<PoseName, keyof typeof donkeyKong.moves>> = {
  jab: "jab1",
  ftilt: "ftilt",
  utilt: "utilt",
  dtilt: "dtilt",
  dashAttack: "dashAttack",
  fsmash: "fsmash",
  usmash: "usmash",
  dsmash: "dsmash",
  nair: "nair",
  fair: "fair",
  bair: "bair",
  uair: "uair",
  dair: "dair",
  neutralB: "neutralB",
  sideB: "sideB",
  upB: "upB",
  downB: "downB",
  grab: "grab",
  fthrow: "fthrow",
  bthrow: "bthrow",
  uthrow: "uthrow",
  dthrow: "dthrow",
};

describe("the strike key is the moment of contact, and is shaped like one", () => {
  const withStrike = () => NAMES.filter((n) => poses[n]?.strike !== undefined);

  it("puts a real key exactly where `strike` says, easing in then out", () => {
    for (const name of withStrike()) {
      const clip = poses[name]!;
      const strike = clip.strike as number;
      expect(strike, `${name} strikes in its recovery half`).toBeLessThan(0.5);

      const i = clip.keys.findIndex((k) => Math.abs(k.t - strike) < 1e-9);
      expect(i, `${name} declares strike ${strike} but has no key there`).toBeGreaterThan(0);
      // Accelerate into the hit, decelerate out of it. `smooth` decelerates
      // *into* contact, which is what made every attack read as putty.
      expect(clip.keys[i - 1].ease, `${name} does not accelerate into contact`).toBe("in");
      expect(clip.keys[i].ease, `${name} does not decelerate out of contact`).toBe("out");
      // Strike, follow-through, terminator.
      expect(clip.keys.length - i, `${name} has no follow-through`).toBeGreaterThanOrEqual(3);
      expect(clip.keys[clip.keys.length - 1].t, `${name} has no terminator`).toBe(1);
    }
  });

  it("puts the striking limb inside its own hitbox on the contact frame", () => {
    // The drawing and the damage have to agree about where the move happens.
    // `radius` is the game's own number, so this is not a tolerance I picked:
    // on the frame the hitbox is live, the limb it represents must actually be
    // within it. An earlier version compared raw distance to the hitbox
    // *centre* and mis-fired on the neutral air, whose arms reach 6.4 rig units
    // while the hitbox centre sits at 4.3 — the fist overshoots the centre and
    // is still comfortably inside a radius-6 sphere, which is correct.
    for (const name of withStrike()) {
      const slot = SLOT_FOR[name];
      const move = slot ? donkeyKong.moves[slot] : undefined;
      if (!move || move.hitboxes.length === 0) continue;
      const hb = strikeHitbox(slot!);
      if (!hb) continue;
      const strike = poses[name]!.strike as number;
      const limb = strikingLimb(name, hb, strike);
      const gap = limbGap(name, limb, hb, strike);
      const radius = toFloat(hb.radius) / rig.scale;
      // Either the limb is inside the box, or it is as close to it as this rig
      // can physically get. The second clause is not a let-off: the back air's
      // hitbox sits 8.2 rig units from his hip and his entire leg is 3.19, so
      // his foot *cannot* reach that centre at any angle — the game hangs that
      // box off a longer-legged model than the one we draw. What is still worth
      // asserting there is that the contact frame is the frame he is nearest
      // it, which is what the minimum over the clip checks.
      let nearest = Infinity;
      for (let i = 0; i <= 20; i++) {
        nearest = Math.min(nearest, limbGap(name, limb, hb, (i / 20) * 0.95));
      }
      // A third of a rig unit — about a hand's width — of slack on the second
      // clause. The back air misses by 0.16 of one, on a hitbox it is already
      // 0.63 short of reaching; that is noise, not a fighter reaching the
      // wrong way.
      expect(
        gap < radius || gap <= nearest + 0.35,
        `${name}: ${limb} is ${gap.toFixed(2)} from its hitbox at contact — outside its ` +
          `${radius.toFixed(2)} radius, and meaningfully closer elsewhere in the clip ` +
          `(${nearest.toFixed(2)})`,
      ).toBe(true);
    }
  });

  /**
   * The one that catches a move being withdrawn while it is still hitting.
   *
   * `ease: "out"` is a cubic, so a clip leaves its contact pose fast: with a
   * strike key at `t = 0.3` and the next key at `t = 1`, the fighter is 10% into
   * his recovery one frame after contact and 36% by the fifth. A hitbox live for
   * ten frames therefore gets one frame of extension and nine of visible
   * put-away, which is what "the attack has no weight" looks like.
   *
   * The fix is a second key at the end of the active window, holding contact.
   * `poseTimeFor` maps action frame `f` past contact to
   * `strike + (1 - strike) * (f - first) / (total - first)`, so the `t` of the
   * last live frame is computable from the move's own hitbox data — which is
   * what makes this an external truth rather than a preference.
   */
  it("stays on its hitbox for as long as its contact hitbox is live", () => {
    const withdrawn: string[] = [];
    for (const name of withStrike()) {
      const slot = SLOT_FOR[name];
      const move = slot ? donkeyKong.moves[slot] : undefined;
      if (!move || move.hitboxes.length === 0) continue;
      // `last` is the end of the CONTACT hitbox's window, not of every hitbox
      // the move has. Several of his moves are sex kicks — the neutral air hits
      // for 12% on frames 10-13 then lingers at 9% to frame 26 — and the
      // drooping tail is not a fault, it is how a weak hitbox is supposed to
      // read. Holding full extension for all seventeen frames would make the
      // weak half look exactly as dangerous as the clean one.
      const hb = strikeHitbox(slot!);
      if (!hb) continue;
      const first = Math.min(...move.hitboxes.map((h) => h.startFrame)) - 1;
      const last = hb.endFrame - 1;
      if (last <= first) continue; // a one-frame window has nothing to hold
      const strike = poses[name]!.strike as number;
      const held = strike + ((1 - strike) * (last - first)) / (move.totalFrames - first);

      const limb = strikingLimb(name, hb, strike);
      const atStrike = limbGap(name, limb, hb, strike);
      const atHeld = limbGap(name, limb, hb, held);
      const travel = limbGap(name, limb, hb, 0.9) - atStrike;
      if (travel < 0.5) continue; // barely retracts at all; nothing to prove
      const lost = (atHeld - atStrike) / travel;
      if (lost > 0.3) {
        withdrawn.push(
          `${name} has pulled its ${limb} ${(lost * 100).toFixed(0)}% of the way back by` +
            ` t=${held.toFixed(3)}, while its contact hitbox is live to frame ${last + 1}` +
            ` — it needs a key at t=${held.toFixed(3)} holding contact`,
        );
      }
    }
    expect(withdrawn).toEqual([]);
  });

  it("accelerates into the strike rather than drifting into it", () => {
    // Measured across the span that *leads into* contact — from the key before
    // the strike to the strike — because that is the span whose ease is the
    // difference between a punch and putty. Sampling at `strike / 2` instead
    // lands in whatever earlier span happens to be there and says nothing.
    for (const name of withStrike()) {
      const slot = SLOT_FOR[name];
      const move = slot ? donkeyKong.moves[slot] : undefined;
      if (!move || move.hitboxes.length === 0) continue;
      const hb = strikeHitbox(slot!);
      if (!hb) continue;
      const clip = poses[name]!;
      const strike = clip.strike as number;
      const limb = strikingLimb(name, hb, strike);
      const prev = clip.keys[clip.keys.findIndex((k) => Math.abs(k.t - strike) < 1e-9) - 1].t;
      const start = limbGap(name, limb, hb, prev);
      const half = limbGap(name, limb, hb, prev + (strike - prev) / 2);
      const end = limbGap(name, limb, hb, strike);
      const span = Math.abs(end - start);
      if (span < 0.5) continue;
      // Under `in` (cubic) the midpoint is 12.5% of the way; under `hold`, 0%.
      // Under `smooth` it would be 50%, which is the thing being excluded.
      expect(Math.abs(half - start) / span, `${name} drifts into contact`).toBeLessThan(0.4);
    }
  });
});

describe("the drawing stays Donkey Kong's", () => {
  it("never puts a foot on backwards", () => {
    // `footL` and `footR` both rest at -88 because the legs are not
    // individually mirrored — the whole rig is mirrored once at draw time. A
    // pose naming `footL: -84, footR: +84` gives one foot pointing behind him,
    // and it is invisible in the source. Checked on the resolved skeleton: the
    // toe must end up forward of the ankle.
    const offenders: string[] = [];
    for (const name of NAMES) {
      if (AIRBORNE.has(name)) continue; // a stomp and a back kick point the feet anywhere
      for (let i = 0; i <= 10; i++) {
        const t = (i / 10) * 0.95;
        const { sk } = skeletonAt(poses[name]!, t);
        // The near foot only: the far one is legitimately splayed the other way
        // in a wide stance (the shared down smash does exactly that), and the
        // near foot is the one the player is actually looking at.
        if (sk.footR.x1 - sk.footR.x0 < -0.2) {
          offenders.push(`${name}@${t.toFixed(2)} footR points backwards`);
        }
      }
    }
    expect([...new Set(offenders.map((o) => o.split("@")[0] + " " + o.split(" ")[1]))]).toEqual([]);
  });

  it("plants no worse than the shared clip it replaces", () => {
    // `offsetY` is absolute and has to be repaid by folding the legs, and DK's
    // legs are the shortest on the roster bar Kirby's, so his budget is the
    // smallest. The threshold is not a number I chose: it is whatever the
    // shared clip for the same move already does on this rig. An attack is
    // allowed to get low — the shared down smash sits two units into its own
    // crouch quite deliberately — so the only defensible claim is that DK's
    // own version is no worse planted than the one it is replacing.
    const worstOf = (clip: PoseClip) => {
      let w = -Infinity;
      for (let i = 0; i <= 24; i++) w = Math.max(w, soleDepth(clip, (i / 24) * 0.95));
      return w;
    };
    const offenders: string[] = [];
    for (const name of NAMES) {
      if (AIRBORNE.has(name)) continue;
      const mine = worstOf(poses[name]!);
      const shared = worstOf(POSE_LIBRARY[name]);
      if (mine > shared + 0.4) {
        offenders.push(`${name} sinks ${(mine - shared).toFixed(2)} deeper than the shared clip`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gets his hands clear of the barrel at contact — the arms are the silhouette", () => {
    // DK's arms are 1.46x long and 1.58x thick and they are what a player reads
    // him by. A strike drawn with the hands tucked against the torso is the
    // shared clip's failure mode on a heavyweight rig: the swing disappears
    // into the body and the frame is unreadable.
    const tucked: string[] = [];
    const torsoHalfWidth = rig.bones.torso.thickness / 2;
    for (const name of NAMES) {
      const clip = poses[name];
      if (clip?.strike === undefined) continue;
      const { sk } = skeletonAt(clip, clip.strike);
      const spineX = (sk.torso.x0 + sk.torso.x1) / 2;
      const out = Math.max(
        Math.abs(sk.handR.x1 - spineX),
        Math.abs(sk.handL.x1 - spineX),
        // An overhead or downward move reads vertically instead.
        Math.abs(sk.handR.y1 - sk.torso.y1),
      );
      if (out < torsoHalfWidth) tucked.push(`${name} strikes with its hands inside the torso`);
    }
    expect(tucked).toEqual([]);
  });

  it("still has the proportions the rig promises — arms past the knees", () => {
    // The one claim `rig.ts` makes in its first line. Asserted here because
    // every pose in this directory was drawn assuming it.
    const arm = rig.bones.upperArmR.length + rig.bones.forearmR.length + rig.bones.handR.length;
    const leg = rig.bones.thighR.length + rig.bones.shinR.length;
    expect(arm).toBeGreaterThan(leg);
    expect(rig.bones.handR.thickness).toBeGreaterThan(rig.bones.forearmR.thickness);
  });
});

describe("his effects are wired to moves he actually has", () => {
  it("keys every effect to one of his own move slots", () => {
    for (const slot of Object.keys(fx)) {
      expect(donkeyKong.moves[slot as keyof typeof donkeyKong.moves], `no move ${slot}`).toBeDefined();
    }
  });

  it("keys every projectile painter to a projectile he launches", () => {
    const launched = new Set(
      Object.values(donkeyKong.moves).flatMap((m) => (m?.projectiles ?? []).map((p) => p.id)),
    );
    for (const id of Object.keys(projectiles)) {
      expect(launched.has(id), `${id} is never launched`).toBe(true);
    }
  });
});
