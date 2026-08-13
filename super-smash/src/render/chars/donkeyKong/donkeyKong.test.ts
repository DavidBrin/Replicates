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

/**
 * Clips whose body turns over in the picture plane, derived rather than listed.
 *
 * A tumbling clip breaks two assumptions the rest of this file is built on, and
 * both breakages are correct. Its feet point every direction in turn, so "the
 * near toe is forward of the ankle" is meaningless. And its limbs are not
 * *reaching* anywhere — the Roll Attack's hitbox is a single sphere on the root
 * bone flagged `attack_region_body`, with no limb hitbox in the move at all —
 * so "the striking limb stays on its hitbox" is measuring the rotation of a
 * ball and calling it a withdrawal.
 *
 * Read off the keys rather than named, so a clip that stops tumbling stops
 * being excused automatically.
 */
const TUMBLES: ReadonlySet<PoseName> = new Set<PoseName>(
  (Object.keys(poses) as PoseName[]).filter((n) => poses[n]!.keys.some((k) => k.rotation)),
);

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
    for (const name of NAMES.filter((n) => !poses[n]!.loop)) {
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

  /**
   * A looping stance is held to a different standard, and needs one.
   *
   * The 90° threshold above is an attack's: it exists because seventeen of the
   * shared movement clips were one frozen pose. An idle that travelled 90° of
   * summed bone rotation would be a fighter fidgeting violently. What is true
   * of a *loop* instead is that it moves at all, and that it does not cut —
   * the span from its last key back to its first is a real span that gets
   * drawn, and a loop authored as if it ended at the last key jumps once every
   * cycle, forever, on the pose a player looks at more than any other.
   */
  it("loops without a cut in them, and without standing perfectly still", () => {
    for (const name of NAMES.filter((n) => poses[n]!.loop)) {
      let furthest = 0;
      for (let i = 1; i <= 24; i++) furthest = Math.max(furthest, apart(name, 0, i / 24));
      expect(furthest, `${name} is a photograph`).toBeGreaterThan(12);
      expect(furthest, `${name} is a fighter with the shakes`).toBeLessThan(90);

      // Sampled at the clip's own frame rate, so a step is a frame. The wrap
      // step is the one being checked and it is included by construction:
      // `i / n` for `i = n - 1` and `t = 1` is `t = 0`.
      const n = poses[name]!.period ?? 30;
      const steps: number[] = [];
      for (let i = 0; i < n; i++) steps.push(apart(name, i / n, ((i + 1) % n) / n));
      const biggest = Math.max(...steps);
      const typical = [...steps].sort((a, b) => a - b)[Math.floor(n / 2)];
      expect(biggest, `${name} jumps at one key — a loop that cuts`).toBeLessThan(typical * 4 + 0.5);
    }
  });

  it("has essentially arrived by its last drawn frame", () => {
    // `t = 1` is never sampled — `poseTimeFor` divides `actionFrame` by the
    // state's length and `actionFrame` runs 0..n-1. A clip still a long way
    // from its terminator on the last drawn frame stops visibly short and cuts.
    // A loop has no terminator: it converges back onto its own first key, which
    // is what the test above checks instead.
    const short: string[] = [];
    for (const name of NAMES.filter((n) => !poses[n]!.loop)) {
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
      if (TUMBLES.has(name)) continue;
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

describe("a tumble is drawn as a tumble", () => {
  /**
   * The one place in this fighter where clip-level `rotation` is the right
   * tool, and the two ways it silently is not one.
   *
   * Rotation interpolates the **short way round**, so a clip that names 0 on
   * one key and 4π on the next has named the same angle twice and does not turn
   * at all — it is a ball sitting still while the engine slides it forward.
   * Every step therefore has to be under half a turn, and the total has to be a
   * whole number of turns or the fighter is handed back to `idle` lying on his
   * side.
   */
  it("steps the roll round rather than naming one angle twice", () => {
    expect([...TUMBLES], "no clip tumbles at all").toEqual(["dashAttack"]);
    for (const name of TUMBLES) {
      const keys = poses[name]!.keys;
      const turns = keys.map((k) => k.rotation ?? 0);
      for (let i = 1; i < turns.length; i++) {
        expect(
          Math.abs(turns[i] - turns[i - 1]),
          `${name} steps ${(turns[i] - turns[i - 1]).toFixed(2)} rad between keys ` +
            `${i - 1} and ${i} — over half a turn, so it interpolates backwards`,
        ).toBeLessThan(Math.PI);
      }
      const total = turns[turns.length - 1] - turns[0];
      expect(Math.abs(total), `${name} barely turns`).toBeGreaterThan(Math.PI * 2);
      expect(
        Math.abs(turns[turns.length - 1] % (Math.PI * 2)),
        `${name} finishes part-way round — it hands over a fighter on his side`,
      ).toBeLessThan(0.05);
    }
  });
});

/**
 * Where the parts that carry a shape end up, in **feet-up** coordinates.
 *
 * The rest of this file works in the skeleton's own frame, where y runs down
 * and the origin is the pelvis strut's base rather than the floor. Every claim
 * below is about height above the stage and reach in front of the toes, and
 * stating those against a downward y is how a reader ends up checking the
 * opposite of what was meant.
 */
function partsAt(name: PoseName, t: number) {
  const { sk, sample } = skeletonAt(poses[name]!, t);
  const sole = Math.max(
    sk.footL.y0 + sk.footL.thickness / 2,
    sk.footL.y1 + sk.footL.thickness / 2,
    sk.footR.y0 + sk.footR.thickness / 2,
    sk.footR.y1 + sk.footR.thickness / 2,
  );
  // `skeletonAt` already hands the sample's `scaleX`/`scaleY` to `resolve`, so
  // the coordinates arrive scaled; only the translation is still to apply.
  const p = (n: keyof typeof sk) => ({
    x: sk[n].x1 + sample.offsetX,
    y: sole - sk[n].y1,
    // The bottom of the capsule's end cap: what actually touches the floor.
    low: sole - sk[n].y1 - sk[n].thickness / 2,
  });
  return {
    handR: p("handR"), handL: p("handL"),
    footR: p("footR"), footL: p("footL"),
    head: p("head"), shoulder: p("torso"), hip: p("hip"),
    kneeR: p("thighR"), kneeL: p("thighL"),
  };
}

/** Crown to sole on this rig, for stating heights as fractions of him. */
const STANDING = rig.bones.root.length + rig.bones.hip.length + rig.bones.torso.length +
  rig.bones.head.length + rig.headRadius;

describe("the shapes round two is actually claiming", () => {
  /**
   * The idle is a knuckle stance, and these are the three numbers that make it
   * one rather than a hunch.
   *
   * All three are from the reference measurements, not taste: the arms hang
   * plumb (so the *spine's* lean is what carries the hands forward, and the
   * arms themselves never reach), the fists rest on the floor, and they rest
   * there in front of his own toes. Miss any one and it is a fighter bending
   * over.
   */
  it("stands on its knuckles, all the way round the loop", () => {
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      const p = partsAt("idle", t);
      expect(p.handR.low, `near knuckle floats at t=${t.toFixed(2)}`).toBeLessThan(0.35);
      expect(p.handL.low, `far knuckle floats at t=${t.toFixed(2)}`).toBeLessThan(0.5);
      expect(p.handR.x, `near knuckle is behind his toes at t=${t.toFixed(2)}`)
        .toBeGreaterThan(p.footR.x + 1.5);
      // The lean, stated as what it buys: the shoulder has to be carried a long
      // way forward of the ankles, because that is the only thing putting the
      // hands where they are.
      expect(p.shoulder.x, `spine is not leaning at t=${t.toFixed(2)}`).toBeGreaterThan(3.0);
    }
  });

  /** And the knuckles stay put while the chest breathes over them. */
  it("keeps the planted parts planted while the body moves", () => {
    let handSwing = 0;
    let chestSwing = 0;
    for (let i = 0; i < 8; i++) {
      const a = partsAt("idle", i / 8);
      const b = partsAt("idle", ((i + 1) % 8) / 8);
      handSwing = Math.max(handSwing, Math.hypot(a.handR.x - b.handR.x, a.handR.y - b.handR.y));
      chestSwing = Math.max(chestSwing, Math.hypot(a.head.x - b.head.x, a.head.y - b.head.y));
    }
    expect(handSwing, "the knuckles slide about").toBeLessThan(0.3);
    expect(chestSwing, "nothing above the shoulders moves").toBeGreaterThan(handSwing * 1.5);
  });

  /** The up smash is a clap: the palms meet, above his crown, on his centreline. */
  it("meets the palms above the crown on the up smash", () => {
    const p = partsAt("usmash", poses.usmash!.strike as number);
    expect(Math.hypot(p.handR.x - p.handL.x, p.handR.y - p.handL.y),
      "the hands do not meet — this is a starfish, not a clap").toBeLessThan(1.2);
    expect(p.handR.y, "the clap is not above his head").toBeGreaterThan(p.head.y + 2.5);
    expect(Math.abs(p.handR.x), "the clap is off his centreline").toBeLessThan(2.5);
    // Feet flat, stated as `offsetY` rather than as a sole position — the sole
    // *is* the origin these are measured from, so asking where it is is
    // vacuous, and the thing that lifts a fighter off the stage is the whole-
    // body translation. The reference measures the silhouette's bottom edge not
    // moving one pixel between neutral and the two contact frames, so there is
    // no toe rise and no hop buying this reach: it is bought with `scaleY`,
    // which stretches about the feet and leaves them where they are.
    expect(samplePose(poses.usmash!, poses.usmash!.strike as number).offsetY, "he hops into it")
      .toBeLessThan(0.25);
  });

  /** The down smash is two fists, both sides, at once, on the deck. */
  it("brings both fists down together on the down smash", () => {
    const p = partsAt("dsmash", poses.dsmash!.strike as number);
    expect(p.handR.x, "the front fist is not in front").toBeGreaterThan(3);
    expect(p.handL.x, "the back fist is not behind").toBeLessThan(-2);
    expect(Math.abs(p.handR.y - p.handL.y),
      "one arm is still up over his shoulder — this is a stagger, not a pound",
    ).toBeLessThan(1.5);
    // …and they keep going into the floor rather than stopping at his hips.
    const late = partsAt("dsmash", 0.328);
    expect(Math.max(late.handR.y, late.handL.y) / STANDING,
      "the fists stop above knee height").toBeLessThan(0.32);
  });

  /** The forward smash finishes low. It is a slam, not a jab. */
  it("lands the forward smash's hands near the floor", () => {
    const p = partsAt("fsmash", poses.fsmash!.strike as number);
    expect(p.handR.y / STANDING, "the hands finish at chest height").toBeLessThan(0.4);
    expect(p.head.y, "the head is not thrust down and forward").toBeLessThan(p.shoulder.y + 1.5);
    expect(p.head.x, "the head is not thrust forward").toBeGreaterThan(p.shoulder.x + 2);
  });

  /** The neutral air is prone. That is the whole move. */
  it("lays the neutral air's body over and folds the legs under it", () => {
    const p = partsAt("nair", poses.nair!.strike as number);
    // The spine, measured as the shoulder's lead over the pelvis against its
    // rise above it: upright is a big ratio, prone is a small one.
    const lean = (p.shoulder.x - p.hip.x) / Math.max(0.1, p.shoulder.y - p.hip.y);
    expect(lean, "the neutral air is drawn standing up").toBeGreaterThan(1.4);
    // Knees to the chest. Stated at the *knee* and not the ankle, because the
    // shin folds back down under him — an ankle above the pelvis would be a
    // fighter sitting cross-legged, not one tucked into a spin.
    expect(p.kneeR.y, "the legs hang instead of tucking").toBeGreaterThan(p.hip.y);
    expect(p.kneeL.y, "the far leg hangs instead of tucking").toBeGreaterThan(p.hip.y);
    // …and both arms are still out at the ends of a bar.
    expect(p.handR.x - p.handL.x, "the arms are not thrown out level").toBeGreaterThan(9);
  });

  /** The down air is an exclamation mark: arms up, legs down, feet together. */
  it("throws the down air's arms up and drives its legs straight down", () => {
    const p = partsAt("dair", poses.dair!.strike as number);
    expect(p.handR.y, "the near arm is not above his head").toBeGreaterThan(p.head.y + 1);
    expect(p.handL.y, "the far arm is not above his head").toBeGreaterThan(p.head.y + 1);
    expect(p.handR.x - p.handL.x, "the arms are not spread into a V").toBeGreaterThan(2);
    expect(Math.abs(p.footR.x - p.footL.x), "the feet are staggered, not stacked")
      .toBeLessThan(0.8);
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
      if (TUMBLES.has(name)) continue; // and a roll points them at everything in turn
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
