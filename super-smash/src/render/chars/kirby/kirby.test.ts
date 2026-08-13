/**
 * What has to stay true about Kirby.
 *
 * He is one shape. The torso is 0.65 units long and buried, the elbows are
 * inside the ball, and a pose that reads beautifully on Mario does *nothing*
 * here — so almost every check below asks the same question in a different
 * way: **is this animating something a player can see?** A clip whose work is
 * all in elbow angles passes every generic test in the repository and is a
 * pink circle sitting still for forty-seven frames on screen.
 *
 * None of these restates a number from `poses.ts`. Each measures something you
 * could check by looking, and would have to look at every frame of every move
 * to check by hand.
 */

import { describe, expect, it } from "vitest";
import { kirby as def } from "@/fighters/kirby";
import type { MoveSlot } from "@/engine/types";
import { samplePose, type PoseSample } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { hexToRgb } from "../../rigKit";
import { resolve, type BoneName } from "../../skeleton";
import { rotationPivot } from "../../characterArt";
import { assignmentsTo, callsOf, createMockContext, type MockContext } from "../../mockContext";
import { getCharacterRig } from "..";
import { poses } from "./poses";
import { fx } from "./fx";

const rig = getCharacterRig("kirby");
const NAMES = Object.keys(poses) as PoseName[];

/** Where the middle of the ball sits above his feet, in rig units. */
const BALL_Y = rig.bones.root.length + rig.bones.hip.length + rig.bones.torso.length + rig.bones.head.length;
const BALL_R = rig.headRadius;

/* ------------------------------------------------------------- measuring -- */

function skeletonOf(s: PoseSample) {
  return resolve(rig.bones, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
    pivot: rotationPivot(rig),
  });
}

/** A bone tip in rig units from his feet: +x forward, +y up, translation applied. */
function tipOf(s: PoseSample, bone: BoneName): { x: number; y: number } {
  const sk = skeletonOf(s);
  return { x: s.offsetX + sk[bone].x1, y: s.offsetY - sk[bone].y1 };
}

/** The two boots and the two hands — the only bones with any hope of showing. */
const LIMB_TIPS: readonly BoneName[] = ["footR", "footL", "handR", "handL"];

/**
 * Where the ball is actually drawn, and how big.
 *
 * Taken from the *resolved* head tip rather than from `root + hip + torso +
 * head`, because a keyframe `rotation` swings the whole rig about the pelvis
 * and the ball with it — up to seven tenths of a unit sideways at the rotations
 * in this file. Computing the centre from the bone lengths instead put the
 * circle in the wrong place on every clip that turns, and made the back air's
 * *wind-up* look like it reached further behind him than the dropkick did.
 * `drawFigure` takes the radius from `scale * scaleX`; so does this.
 */
function ballOf(s: PoseSample): { x: number; y: number; r: number } {
  const head = tipOf(s, "head");
  return { x: head.x, y: head.y, r: BALL_R * Math.abs(s.scaleX) };
}

/**
 * How far the furthest limb gets **outside the ball**, in rig units.
 *
 * This is the measurement that matters on this rig and on no other. Two things
 * about it are Kirby-specific. The ball's radius scales with `scaleX`
 * (`drawFigure` takes the head circle from `scale * scaleX`), so a pose that
 * inflates him has to reach further before anything shows — the comparison is
 * against the *drawn* radius, not a constant. And the capsule's own half-width
 * counts: his whole arm is 3.8 units against a 4.45 radius, so the only part of
 * a punch that ever leaves the outline is the thickness of the fist.
 */
function reach(s: PoseSample): number {
  const ball = ballOf(s);
  let worst = -Infinity;
  for (const b of LIMB_TIPS) {
    const p = tipOf(s, b);
    worst = Math.max(worst, Math.hypot(p.x - ball.x, p.y - ball.y) + rig.bones[b].thickness / 2 - ball.r);
  }
  return worst;
}

/**
 * How far he is committed **toward a particular hitbox**, in rig units.
 *
 * The global `reach` is the wrong question for half his moveset: his boots
 * stick out further at rest than his fist does at the end of a jab, so a punch
 * measured against every limb at once looks like a retraction. What an attack
 * has to be doing is going *that way* — and on this rig it can do that with the
 * limb or with the whole body, which is why the ball's own travel is added in.
 * Kirby's jab genuinely does not break his outline with the fist; it lands
 * because he throws three quarters of a unit of himself behind it.
 */
function commitment(s: PoseSample, ux: number, uy: number): number {
  const ball = ballOf(s);
  let best = -Infinity;
  for (const b of LIMB_TIPS) {
    const p = tipOf(s, b);
    const along = (p.x - ball.x) * ux + (p.y - ball.y) * uy + rig.bones[b].thickness / 2;
    best = Math.max(best, along - ball.r);
  }
  return best + s.offsetX * ux + s.offsetY * uy;
}

/** Total angular change between two samples, in degrees, over every bone. */
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

/** Lowest point of either boot, in rig units below the origin. Positive sinks. */
function sole(s: PoseSample): number {
  const sk = skeletonOf(s);
  let low = -Infinity;
  for (const b of [sk.footL, sk.footR]) {
    low = Math.max(low, b.y0 + b.thickness / 2, b.y1 + b.thickness / 2);
  }
  return low - s.offsetY;
}

/* ------------------------------------------------- the move's own timing -- */

interface Window {
  /** Clip time of the first and last active frame of this window. */
  readonly from: number;
  readonly to: number;
  readonly frames: number;
  /** Unit vector from the ball's centre toward where this window hits. */
  readonly ux: number;
  readonly uy: number;
}

/**
 * A move's active windows, as clip times, one per run of consecutive frames.
 *
 * The union of a move's hitboxes is *not* one window and treating it as one is
 * wrong in both directions: Final Cutter's three are a rising slash, a meteor
 * fourteen frames later and a ground shockwave after that, pointing up, down
 * and forward. Merged, it would demand he hold a rising slash through the fall.
 *
 * The clip-time map is the same arithmetic `poseTimeFor` uses. It is repeated
 * here rather than imported because that function takes a whole `FighterState`;
 * what is wanted is the map from a *frame number as written in
 * `fighters/kirby.ts`* to a clip time, so the assertions can be stated in the
 * units the frame data is in.
 */
function activeWindows(slot: MoveSlot, strike: number): Window[] {
  const m = def.moves[slot];
  if (!m) throw new Error(`no move ${slot}`);
  const boxes = [...m.hitboxes].sort((a, b) => a.startFrame - b.startFrame);
  const first = boxes[0].startFrame - 1;
  const at = (f: number) => strike + ((1 - strike) * (f - first)) / (m.totalFrames - first);

  const runs: { a: number; b: number; xs: number[]; ys: number[] }[] = [];
  for (const hb of boxes) {
    const a = hb.startFrame - 1;
    const b = hb.endFrame - 1;
    const last = runs[runs.length - 1];
    // Adjacent frames alone do not make one window: Final Cutter's meteor ends
    // on frame 49 and its ground shockwave opens on 50, and they point in
    // different directions. Same *place*, touching frames — that is an early
    // and a late hit on one shape, and only that gets merged.
    const samePlace = last && last.xs[0] === hb.x && last.ys[0] === hb.y;
    if (last && samePlace && a <= last.b + 1) {
      last.b = Math.max(last.b, b);
      last.xs.push(hb.x);
      last.ys.push(hb.y);
    } else {
      runs.push({ a, b, xs: [hb.x], ys: [hb.y] });
    }
  }
  return runs.map((r) => {
    const mx = r.xs.reduce((s, v) => s + v, 0) / r.xs.length;
    const my = r.ys.reduce((s, v) => s + v, 0) / r.ys.length;
    // Hitbox coordinates are measured from the feet; the ball's centre is not.
    const dx = mx / 4096;
    const dy = my / 4096 - BALL_Y;
    const len = Math.hypot(dx, dy) || 1;
    return { from: at(r.a), to: at(r.b), frames: r.b - r.a + 1, ux: dx / len, uy: dy / len };
  });
}

/** Clip time of each frame of a move's wind-up, up to but excluding contact. */
function windUpTimes(slot: MoveSlot, strike: number): number[] {
  const m = def.moves[slot];
  if (!m) throw new Error(`no move ${slot}`);
  let first = Infinity;
  for (const hb of m.hitboxes) first = Math.min(first, hb.startFrame - 1);
  const out: number[] = [];
  for (let f = 0; f < first; f++) out.push((strike * f) / first);
  return out;
}

/** Every attack whose clip Kirby overrides, paired with the slot it is driven by. */
const ATTACKS: ReadonlyArray<readonly [PoseName, MoveSlot]> = [
  ["jab", "jab1"],
  ["ftilt", "ftilt"],
  ["utilt", "utilt"],
  ["dtilt", "dtilt"],
  ["dashAttack", "dashAttack"],
  ["fsmash", "fsmash"],
  ["usmash", "usmash"],
  ["dsmash", "dsmash"],
  ["nair", "nair"],
  ["fair", "fair"],
  ["bair", "bair"],
  ["uair", "uair"],
  ["dair", "dair"],
  ["sideB", "sideB"],
  ["upB", "upB"],
];

/* ------------------------------------------------------------------ tests -- */

describe("every clip is an animation rather than a photograph", () => {
  /**
   * Bone travel alone is the wrong bar for this fighter, and the idle proves
   * it: his torso is 0.65 units long and buried, so the shared idle's breathing
   * moved nothing a player could see and he stood *perfectly still* for 108
   * frames. A ball breathes by changing size. So the outline is measured too —
   * where the circle is and how big it is — and a clip has to move one or the
   * other.
   */
  it("never holds one pose, or one outline, for a whole move", () => {
    for (const name of NAMES) {
      const clip = poses[name];
      if (!clip) continue;
      expect(clip.keys.length, `${name} has a single key`).toBeGreaterThan(1);
      let bones = 0;
      let outline = 0;
      for (let i = 0; i < 24; i++) {
        const a = samplePose(clip, i / 24);
        const b = samplePose(clip, (i + 1) / 24);
        bones += travel(a, b);
        const ba = ballOf(a);
        const bb = ballOf(b);
        outline += Math.hypot(bb.x - ba.x, bb.y - ba.y) + Math.abs(bb.r - ba.r);
      }
      expect(
        bones > 90 || outline > 0.4,
        `${name} is a photograph: ${bones.toFixed(0)}° of bone travel and ` +
          `${outline.toFixed(2)} units of outline movement`,
      ).toBe(true);
    }
  });

  it("puts its last visible shape before the terminator, which is never drawn", () => {
    for (const name of NAMES) {
      const clip = poses[name];
      if (!clip?.loop) {
        const keys = clip?.keys;
        if (!keys) continue;
        expect(keys[keys.length - 1].t, `${name} has no terminator at t=1`).toBe(1);
        expect(keys[keys.length - 2].t, `${name} shows nothing before t=1`).toBeLessThanOrEqual(0.98);
      }
    }
  });
});

describe("the sphere is doing the work, not the elbows", () => {
  /**
   * The whole reason this file exists.
   *
   * Arm reach is 1.6 + 1.7 + 0.5 off a shoulder a quarter of a unit below the
   * centre of a 4.45 ball, so a *fully extended arm* clears the outline by
   * about four tenths of a unit and every elbow angle short of that animates
   * something nobody can see. What reads on Kirby is a boot outside the
   * silhouette, the ball changing size, the whole body turning, or how far he
   * travels — and an attack has to be doing at least one of them.
   */
  it("gets a limb outside the outline, or moves the whole ball, on every attack", () => {
    for (const [name] of ATTACKS) {
      const clip = poses[name];
      if (!clip) continue;
      let bestReach = -Infinity;
      let bestBody = 0;
      for (let i = 0; i <= 40; i++) {
        const s = samplePose(clip, i / 40);
        bestReach = Math.max(bestReach, reach(s));
        bestBody = Math.max(
          bestBody,
          Math.abs(s.rotation) / 0.35 +
            Math.hypot(s.offsetX, s.offsetY) / 1.2 +
            Math.abs(s.scaleX - 1) / 0.1 +
            Math.abs(s.scaleY - 1) / 0.14,
        );
      }
      const ok = bestReach > 0.35 || bestBody > 1;
      expect(
        ok,
        `${name} does its work inside the ball: best limb reach ${bestReach.toFixed(2)} ` +
          `units outside the outline, whole-body channels ${bestBody.toFixed(2)}`,
      ).toBe(true);
    }
  });

  it("does not fall back to a shared clip for any attack, special or throw", () => {
    for (const [name] of ATTACKS) {
      expect(poses[name], `${name} fell back to the shared clip`).toBeDefined();
    }
    for (const name of ["neutralB", "downB", "grab", "fthrow", "bthrow", "uthrow", "dthrow"]) {
      expect(poses[name as PoseName], `${name} fell back to the shared clip`).toBeDefined();
    }
  });

  /**
   * `spin` turns the rig in the plane of the screen. Every spinning move Kirby
   * has turns about his *vertical* axis instead, and played as `spin` each one
   * ends with his face underneath him — which on a fighter who is one face on
   * one circle reads as a tumbling victim, not an attack. The neutral air
   * shipped as `spin: 1` and was upside down across the middle third of its
   * own hitbox.
   */
  it("uses no whole-body screen-plane spin anywhere", () => {
    for (const name of NAMES) {
      expect(poses[name]?.spin ?? 0, `${name} tips Kirby onto his side with \`spin\``).toBe(0);
    }
  });
});

describe("the contact shape is held for as long as the hitbox is live", () => {
  /**
   * `ease: "out"` is a cubic and a cubic leaves at speed: with the next key at
   * `t = 1`, a fighter is a third of the way into his recovery four frames
   * after contact. Every multi-frame hitbox here names the end of its own
   * active window as a second, identical key. Delete one and this fails with
   * the move and the frame.
   */
  it("is still as committed on the last active frame as on the first", () => {
    const sloppy: string[] = [];
    for (const [name, slot] of ATTACKS) {
      const clip = poses[name];
      if (!clip?.strike) continue;
      for (const w of activeWindows(slot, clip.strike)) {
        if (w.frames < 2) continue;
        const opened = commitment(samplePose(clip, w.from), w.ux, w.uy);
        const closed = commitment(samplePose(clip, w.to), w.ux, w.uy);
        if (closed < opened - 0.25) {
          sloppy.push(
            `${name} has withdrawn ${(opened - closed).toFixed(2)} units by the last of its ` +
              `${w.frames} active frames (t ${w.from.toFixed(3)}→${w.to.toFixed(3)})`,
          );
        }
      }
    }
    // Only the ends of each window, not every frame between them: the neutral
    // air and the down air *alternate* by design — one drawing in four is the
    // edge-on one, pulled in, which is the whole of how a turn about his own
    // axis is expressed on a rig that cannot rotate out of the screen.
    expect(sloppy).toEqual([]);
  });

  /**
   * Only the moves that hit in front of him or behind him, and only along that
   * axis. `scaleY` is Kirby's crouch — it drops where the ball sits without
   * shrinking the circle — so on a downward measurement every wind-up crouch
   * scores as "a boot further outside the outline" and out-reaches its own
   * kick. That is the metric's artefact, not the pose's, and the horizontal
   * axis is immune to it.
   */
  it("is further forward at contact than at any point in the wind-up", () => {
    for (const [name, slot] of ATTACKS) {
      const clip = poses[name];
      if (!clip?.strike) continue;
      // Hammer Flip is exempt and it is the one honest exemption: what reaches
      // the hitbox is a mallet three and a third radii long that the rig has no
      // bone for. Its swing is asserted directly, further down.
      if (name === "sideB") continue;
      const w = activeWindows(slot, clip.strike)[0];
      // Only the moves that genuinely hit sideways. Final Cutter's first hitbox
      // is a foot forward and two units up: it is a rise, and asking whether a
      // rise leans further forward at contact is not a question about it.
      if (Math.abs(w.ux) < 0.6) continue;
      const ux = Math.sign(w.ux);
      const atStrike = commitment(samplePose(clip, w.from), ux, 0);
      let windUpPeak = -Infinity;
      // The *frames* of the wind-up, not twenty samples across it: a clip is
      // continuous and the instant before the strike key is the strike key, so
      // sampling arbitrarily close to it compares the pose with itself.
      for (const t of windUpTimes(slot, clip.strike)) {
        windUpPeak = Math.max(windUpPeak, commitment(samplePose(clip, t), ux, 0));
      }
      expect(
        windUpPeak,
        `${name} is further toward its own hitbox during the wind-up (${windUpPeak.toFixed(2)}) ` +
          `than at contact (${atStrike.toFixed(2)}) — the anticipation is the strike`,
      ).toBeLessThan(atStrike + 0.2);
    }
  });
});

describe("both boots reach the floor, and stay on it", () => {
  /**
   * The rig's rest angles are the roster's, and the splay that separates his
   * two boots lives in `STANCE` — so the thing to check is that the stance he
   * actually stands in plants *both* of them, at the same depth, far enough
   * apart to be two feet rather than one.
   */
  it("plants both boots level in the idle, with daylight between them", () => {
    const s = samplePose(poses.idle!, 0);
    const sk = skeletonOf(s);
    const depthR = Math.max(sk.footR.y0, sk.footR.y1);
    const depthL = Math.max(sk.footL.y0, sk.footL.y1);
    expect(Math.abs(depthR - depthL), "one boot is planted deeper than the other").toBeLessThan(0.2);
    const gap = Math.abs(sk.footR.x0 - sk.footL.x0);
    expect(gap, "the near boot eclipses the far one — he has one foot").toBeGreaterThan(1.2);
  });

  it("keeps every grounded clip's soles within a boot's depth of the standing plant", () => {
    const planted = sole(samplePose(poses.idle!, 0));
    const offenders: string[] = [];
    // The aerials and the throws leave the ground on purpose; these are the
    // clips a player watches him perform standing on a stage.
    for (const name of ["idle", "jab", "ftilt", "utilt", "dtilt", "fsmash", "usmash", "dsmash", "grab"] as PoseName[]) {
      const clip = poses[name];
      if (!clip) continue;
      for (let i = 0; i <= 30; i++) {
        const d = sole(samplePose(clip, i / 30)) - planted;
        if (d > 0.8) {
          offenders.push(`${name} sinks ${d.toFixed(2)} at t=${(i / 30).toFixed(2)}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------- the effects -- */

function paint(slot: MoveSlot, frame: number, charge = 0): MockContext {
  const ctx = createMockContext();
  const fn = fx[slot];
  if (!fn) throw new Error(`no effect for ${slot}`);
  const total = def.moves[slot]?.totalFrames ?? 40;
  fn({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    f: { facing: 1, charge } as never,
    def: def as never,
    cam: { zoom: 12 } as never,
    height: 7.6,
    x: 800,
    y: 600,
    u: 12,
    frame,
    total,
    t: frame / total,
    dir: 1,
  });
  return ctx;
}

const drew = (slot: MoveSlot, frame: number): number => paint(slot, frame).calls.length;

describe("the effects paint on the frames they claim and not otherwise", () => {
  /**
   * The hammer is not a bone — nothing in the rig produces it, so the only
   * thing keeping it in step with the animation is this gate. It shipped
   * ungated: a mallet hung in the air beside a Kirby who had not raised his
   * arms, and swung *backwards* through the first fourteen frames of the move.
   */
  it("does not draw the hammer before Kirby has drawn it", () => {
    for (const f of [0, 3, 6, 8]) {
      expect(drew("sideB", f), `hammer on screen at frame ${f}, before he reaches for it`).toBe(0);
    }
    expect(drew("sideB", 16), "no hammer while it is cocked").toBeGreaterThan(5);
    expect(drew("sideB", 26), "no hammer on the contact frame").toBeGreaterThan(5);
    expect(drew("sideB", 27), "no hammer on the second active frame").toBeGreaterThan(5);
    expect(drew("sideB", 50), "hammer still out long after the swing").toBe(0);
  });

  it("only flames the hammer when it is charged, because only a charged one burns", () => {
    expect(paint("sideB", 26, 0).calls.length).toBeLessThan(paint("sideB", 26, 40).calls.length);
  });

  /**
   * The swing itself, read back off the one `rotate` the effect issues.
   *
   * This is where the forward extension of Hammer Flip lives — the pose cannot
   * carry it, because his arms are 3.8 units long against a 4.45 radius and the
   * mallet is neither of those. The claim is the same one made of every other
   * move: it arrives at the hitbox on the frame the hitbox is live, and it is
   * still there on the next one.
   */
  it("swings the hammer onto the hitbox and holds it there for both active frames", () => {
    const angleAt = (frame: number): number => {
      const spins = callsOf(paint("sideB", frame), "rotate");
      expect(spins.length, `no hammer drawn on frame ${frame}`).toBe(1);
      return (Number(spins[0].args[0]) * 180) / Math.PI;
    };
    const hb = def.moves.sideB!.hitboxes[0];
    // Where the hitbox is, as an angle from straight up through the ball's
    // centre — the same convention the effect's own arc is authored in.
    const aim = (Math.atan2(hb.x / 4096, hb.y / 4096 - BALL_Y) * 180) / Math.PI;

    expect(angleAt(16), "the hammer is not cocked behind him before the swing").toBeLessThan(0);
    expect(angleAt(20), "the swing does not travel").toBeGreaterThan(angleAt(16));
    expect(
      Math.abs(angleAt(26) - aim),
      `the hammer is ${angleAt(26).toFixed(0)}° from vertical at contact, and the hitbox is at ${aim.toFixed(0)}°`,
    ).toBeLessThan(25);
    expect(angleAt(27), "the hammer has begun to lift on the second active frame").toBeCloseTo(angleAt(26), 6);
  });

  it("holds the Inhale mouth open across the whole suction window", () => {
    expect(drew("neutralB", 1), "mouth open before the move starts").toBe(0);
    for (const f of [12, 24, 36, 44]) {
      expect(drew("neutralB", f), `mouth shut on frame ${f}, inside the suction window`).toBeGreaterThan(10);
    }
    expect(drew("neutralB", 60), "mouth still open after the move ended").toBe(0);
  });

  it("replaces Kirby with the rock for exactly the armour window", () => {
    const armour = def.moves.downB?.superArmourFrames;
    expect(armour, "Stone has no armour window to key off").toBeDefined();
    const [from, to] = armour!;
    expect(paint("downB", from - 1).calls.length, "rock before the transformation").toBe(0);
    for (const f of [from, Math.round((from + to) / 2), to]) {
      const out = fx.downB!({
        ctx: paint("downB", f) as unknown as CanvasRenderingContext2D,
        f: { facing: 1, charge: 0 } as never,
        def: def as never,
        cam: { zoom: 12 } as never,
        height: 7.6,
        x: 800,
        y: 600,
        u: 12,
        frame: f,
        total: 60,
        t: 0,
        dir: 1,
      });
      expect(out && "hideFigure" in out ? out.hideFigure : false, `Kirby is drawn as well as the rock on frame ${f}`).toBe(true);
    }
    expect(paint("downB", to + 1).calls.length, "still a rock after the armour ended").toBe(0);
  });

  it("burns for the dash attack's own hitbox frames and no longer", () => {
    expect(drew("dashAttack", 2), "alight before he starts moving").toBe(0);
    expect(drew("dashAttack", 20), "no flame mid-Burning").toBeGreaterThan(5);
    expect(drew("dashAttack", 45), "still burning after the move ended").toBe(0);
  });

  it("screws the drill only while the drill is hitting", () => {
    expect(drew("dair", 5), "corkscrew before the first hit").toBe(0);
    expect(drew("dair", 25), "no corkscrew mid-drill").toBeGreaterThan(5);
    expect(drew("dair", 48), "corkscrew after the last hit").toBe(0);
  });

  /**
   * The corkscrew paints *under* the figure, so a ring drawn less than a radius
   * below his middle is covered by the ball and does not exist. Four of the six
   * were, and the drill was a smudge at his ankles.
   */
  it("draws the corkscrew below the ball, where it can be seen", () => {
    const ctx = paint("dair", 25);
    const ballCy = 600 - 5.28 * 0.78 * 12;
    const ballR = 4.45 * 0.78 * 12;
    const rings = ctx.calls.filter((c) => c.method === "ellipse");
    expect(rings.length, "no corkscrew rings at all").toBeGreaterThan(3);
    const highest = Math.min(...rings.map((c) => Number(c.args[1])));
    expect(highest, "the top ring is inside the ball and invisible").toBeGreaterThanOrEqual(ballCy + ballR * 0.9);
  });
});

describe("nothing an effect paints disappears into the rim", () => {
  /**
   * The trap this guards, in one sentence: **the figure is drawn twice, once
   * inflated in the outline colour, and an effect painting near that colour is
   * drawn straight onto a band of itself.**
   *
   * The Inhale mouth shipped as `#5A1030` against an outline of `#5A2038` —
   * eighteen units apart — and the half of it that cleared the ball was
   * invisible. It is not a props-only rule: everything in `fx.ts` is painted
   * next to the silhouette and judged against it rather than against the sky.
   *
   * Stone is exempt and only Stone: it returns `hideFigure`, so there is no rim
   * on screen for its greys to vanish into.
   */
  const OUTLINE = hexToRgb(def.palette.outline);

  function distanceFromRim(colour: unknown): number | null {
    if (typeof colour !== "string") return null;
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(colour);
    const rgb = m
      ? ([Number(m[1]), Number(m[2]), Number(m[3])] as const)
      : colour.startsWith("#")
        ? hexToRgb(colour)
        : null;
    if (!rgb) return null;
    return Math.hypot(rgb[0] - OUTLINE[0], rgb[1] - OUTLINE[1], rgb[2] - OUTLINE[2]);
  }

  it("keeps every painted colour clear of the outline colour", () => {
    const offenders: string[] = [];
    for (const slot of Object.keys(fx) as MoveSlot[]) {
      if (slot === "downB") continue;
      const total = def.moves[slot]?.totalFrames ?? 60;
      for (let frame = 0; frame <= total; frame += 2) {
        const ctx = paint(slot, frame, 40);
        for (const prop of ["fillStyle", "strokeStyle"]) {
          for (const colour of assignmentsTo(ctx, prop)) {
            const d = distanceFromRim(colour);
            if (d !== null && d < 45) {
              offenders.push(`${slot} paints ${String(colour)} — ${d.toFixed(0)} from the rim`);
            }
          }
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
