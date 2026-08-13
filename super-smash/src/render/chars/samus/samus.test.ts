/**
 * What has to stay true about Samus, checked against the drawing rather than
 * against the numbers that produced it.
 *
 * Every assertion here is a *property a viewer could see*: that a clip moves,
 * that a raised leg is outside her own silhouette rather than behind it, that
 * the charge ball grows with the charge, that a projectile painter puts ink on
 * the canvas. Restating the pose table would pass forever and catch nothing —
 * the failures this file exists for are the ones where the numbers are exactly
 * as written and the picture is still wrong.
 */

import { describe, expect, it } from "vitest";

import { samus } from "@/fighters/samus";
import type { MoveSlot } from "@/engine/types";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import { getCharacterRig, rotationPivot } from "../../characterArt";
import { samplePose, type PoseClip } from "../../poses/clip";
import { resolve, type Skeleton } from "../../skeleton";
import { poses } from "./poses";
import { fx, projectiles } from "./fx";

const rig = getCharacterRig("samus");

/* ------------------------------------------------------------- geometry -- */

/** The skeleton a clip draws at normalised time `t`, in rig units, y down. */
function skeletonAt(clip: PoseClip, t: number): Skeleton {
  const s = samplePose(clip, t);
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

/**
 * Clip time for a move frame, the way `poseTimeFor` computes it.
 *
 * Duplicated here on purpose: the point of the timing assertions below is that
 * a key sits on a particular *frame*, and importing the renderer's mapping is
 * what makes a test agree with a bug.
 */
function timeOfFrame(slot: TimedSlot, frame: number): number {
  const move = samus.moves[slot];
  if (!move) throw new Error(`samus has no ${slot}`);
  const clip = poses[POSE_OF[slot]];
  if (!clip) throw new Error(`no clip for ${slot}`);
  const strike = clip.strike;
  const total = move.totalFrames;
  const first = Math.min(...move.hitboxes.map((h) => h.startFrame)) - 1;
  if (strike === undefined || !(first > 0) || first >= total) return frame / total;
  return frame <= first
    ? (strike * frame) / first
    : Math.min(1, strike + ((1 - strike) * (frame - first)) / (total - first));
}

const POSE_OF = {
  jab1: "jab",
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
  upB: "upB",
  grab: "grab",
} as const;

type TimedSlot = keyof typeof POSE_OF;

/** How far the drawing moves between two clip times, summed over every bone. */
function travel(clip: PoseClip, a: number, b: number): number {
  const p = skeletonAt(clip, a);
  const q = skeletonAt(clip, b);
  let d = 0;
  for (const name of Object.keys(p) as (keyof Skeleton)[]) {
    d += Math.hypot(p[name].x1 - q[name].x1, p[name].y1 - q[name].y1);
  }
  return d;
}

/* ------------------------------------------------------ a clip must move -- */

describe("the clips are animations and not photographs", () => {
  const MOVED: (keyof typeof poses)[] = [
    "neutralB", "sideB", "upB", "downB",
    "fsmash", "usmash", "dsmash",
    "nair", "fair", "bair", "uair", "dair",
    "jab", "ftilt", "utilt", "dtilt", "dashAttack", "grab", "uthrow",
  ];

  it.each(MOVED)("%s changes shape across its own length", (name) => {
    const clip = poses[name];
    expect(clip).toBeDefined();
    // Ten samples across the part of the clip that is actually drawn: a clip
    // whose every frame is within a rig unit of the frame before it is a
    // fighter standing still, whatever its key table says.
    let most = 0;
    for (let i = 1; i < 10; i++) most = Math.max(most, travel(clip!, 0, i / 12));
    expect(most).toBeGreaterThan(4);
  });
});

/* --------------------------------------------- the turn that is not a spin -- */

describe("spinning moves turn without falling over", () => {
  /**
   * `spin` is a screen-plane rotation: it cartwheels the rig. Three of her
   * moves turn about her *long* axis instead, which no rig with one plane can
   * do, and all three carry it in `scaleX` — wide face-on, narrow edge-on.
   * `spin` on any of them puts her on her side in the middle of the move.
   */
  it.each(["nair", "uair", "upB"] as const)("%s declares no spin", (name) => {
    expect(poses[name]?.spin).toBeUndefined();
  });

  it.each(["nair", "uair", "upB"] as const)("%s goes edge-on and back", (name) => {
    const clip = poses[name]!;
    const widths = clip.keys.map((k) => k.scaleX ?? 1);
    const narrow = Math.min(...widths);
    const wide = Math.max(...widths);
    // Half a turn has to be a real collapse. At 0.7 it reads as a fighter
    // being squashed; at a third it reads as a fighter side-on.
    expect(narrow).toBeLessThan(0.45);
    expect(wide).toBeGreaterThan(0.95);
    // And it has to come back — a fighter who ends the move flat is a bug.
    expect(clip.keys[clip.keys.length - 1].scaleX ?? 1).toBeGreaterThan(0.9);
  });

  it("nair walks the kicking leg a whole turn round the hip", () => {
    // Authored 90° at a time, because `lerpAngle` takes the short way between
    // any pair of keys and cannot express more than half a revolution in one
    // span. The test is on the drawing: the ankle has to visit in front of,
    // below and behind the hip.
    const clip = poses.nair!;
    const at = (f: number) => {
      const sk = skeletonAt(clip, timeOfFrame("nair", f));
      return { dx: sk.footR.x0 - sk.hip.x0, dy: sk.footR.y0 - sk.hip.y0 };
    };
    expect(at(7).dx).toBeGreaterThan(2);
    expect(at(11).dy).toBeGreaterThan(1.5);
    expect(at(15).dx).toBeLessThan(-1.5);
  });
});

/* ---------------------------------------------- a raised leg has to be seen -- */

describe("up air is visible", () => {
  /**
   * Thigh plus shin is 4.1 rig units from a pelvis at 4.2, so a leg raised
   * straight up reaches y ≈ 8.3 — below the centre of her own head — and lands
   * inside a torso capsule 4.5 units wide, where it is drawn behind it and
   * never seen. The whole move was an orange lozenge with nothing sticking out
   * of it until the torso was arched back far enough to clear the legs.
   */
  it("puts the kicking foot clear of the torso and above the pelvis", () => {
    const clip = poses.uair!;
    for (const frame of [4, 10, 16]) {
      const sk = skeletonAt(clip, timeOfFrame("uair", frame));
      const forward = sk.footR.x0 - sk.hip.x0;
      const up = sk.hip.y0 - sk.footR.y0;
      expect(forward).toBeGreaterThan(2.0);
      expect(up).toBeGreaterThan(1.5);
      // Clear of the torso capsule, not merely in front of the hip joint.
      expect(sk.footR.x0).toBeGreaterThan(sk.torso.x1 + sk.torso.thickness / 2);
    }
  });
});

/* ------------------------------------------------- extension holds the window -- */

describe("the extension lasts as long as the hitbox does", () => {
  /**
   * A cubic `out` off the strike key is 36% of the way home five frames later,
   * so a move whose hitbox is live for five frames got one frame of extension
   * and four of visibly putting it away. Every attack below has a key on the
   * last frame of its active window; delete it and the number in the failure
   * message is the frame that stopped being drawn at full extension.
   */
  // `dsmash` and `usmash` are deliberately absent: a legsweep that hits in
  // front on frame 9 and behind on frame 17, and an arc that fires five times
  // between 11 and 27, are moves whose *whole* active window is travel. They
  // get their own checks below.
  const HELD: TimedSlot[] = [
    "jab1", "ftilt", "utilt", "dtilt", "dashAttack",
    "fsmash", "bair", "uair", "dair", "grab", "nair",
  ];

  it.each(HELD)("%s is still extended on its last active frame", (slot) => {
    const move = samus.moves[slot]!;
    const clip = poses[POSE_OF[slot]]!;
    const first = Math.min(...move.hitboxes.map((h) => h.startFrame)) - 1;
    const last = Math.max(...move.hitboxes.map((h) => h.endFrame)) - 1;
    if (last <= first) return;
    const strikeSkeleton = skeletonAt(clip, timeOfFrame(slot, first));
    const lastSkeleton = skeletonAt(clip, timeOfFrame(slot, last));
    let moved = 0;
    for (const name of Object.keys(strikeSkeleton) as (keyof Skeleton)[]) {
      moved = Math.max(
        moved,
        Math.hypot(
          strikeSkeleton[name].x1 - lastSkeleton[name].x1,
          strikeSkeleton[name].y1 - lastSkeleton[name].y1,
        ),
      );
    }
    // A hold, not a freeze: the pose may drift a unit, it may not go home.
    expect(
      moved,
      `${slot} frame ${last} has already travelled ${moved.toFixed(2)} units out of its extension`,
    ).toBeLessThan(1.6);
  });

  it("dsmash sweeps in front on frame 9 and behind on frame 17", () => {
    const clip = poses.dsmash!;
    const at = (f: number) => {
      const sk = skeletonAt(clip, timeOfFrame("dsmash", f));
      return sk.footR.x1 - sk.hip.x0;
    };
    // Both sweeps out, on their own frames and on opposite sides — the thing
    // the shared split-kick clip loses, and the reason the move edgeguards.
    expect(at(8)).toBeGreaterThan(3);
    expect(at(9)).toBeGreaterThan(3);
    expect(at(16)).toBeLessThan(-3);
    expect(at(17)).toBeLessThan(-3);
  });

  it("usmash walks the cannon from in front to behind across its five blasts", () => {
    const clip = poses.usmash!;
    const muzzle = (f: number) => {
      const sk = skeletonAt(clip, timeOfFrame("usmash", f));
      return { x: sk.forearmR.x1, y: sk.forearmR.y1 };
    };
    // Frames 11, 19 and 27 are the first, third and fifth hitboxes, and
    // `fx.ts` puts its blasts on exactly those. The arm has to be under them:
    // before this the sweep reached the back of the arc on frame 35.
    const a = muzzle(11);
    const b = muzzle(19);
    const c = muzzle(27);
    expect(a.x).toBeGreaterThan(1);
    expect(b.y).toBeLessThan(a.y);
    expect(c.x).toBeLessThan(b.x);
  });
});

/* ------------------------------------------------------------ what is painted -- */

/** A canvas that records whether anything was ever committed to it. */
function recordingContext(): { ctx: CanvasRenderingContext2D; drawn: () => number } {
  let calls = 0;
  const noop = () => {
    calls++;
  };
  const gradient = { addColorStop: () => {} };
  const ctx = {
    canvas: { width: 800, height: 600 },
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    bezierCurveTo: () => {},
    quadraticCurveTo: () => {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, drawn: () => calls };
}

function fxAt(slot: MoveSlot, frame: number, charge = 0) {
  const { ctx, drawn } = recordingContext();
  const painter = fx[slot];
  if (!painter) throw new Error(`samus has no fx for ${slot}`);
  painter({
    ctx,
    f: { facing: 1, charge } as never,
    def: samus,
    cam: { zoom: 10 } as never,
    height: 12.2,
    x: 400,
    y: 400,
    u: 10,
    frame,
    total: samus.moves[slot]?.totalFrames ?? 40,
    t: 0,
    dir: 1,
    over: (paint: () => void) => paint(),
  });
  return drawn();
}

describe("the effects paint on the frames they claim to", () => {
  it("Charge Shot paints nothing before the shot and a flash on frame 3", () => {
    expect(fxAt("neutralB", 0)).toBe(0);
    expect(fxAt("neutralB", 3)).toBeGreaterThan(0);
  });

  it("the held charge grows with the charge and is drawn the whole time", () => {
    // The one thing a player has to be able to read against Samus is how full
    // the bar is, so the ball is sized off `charge` continuously.
    const small = fxAt("neutralB", 1, 1);
    const full = fxAt("neutralB", 1, SMASH_CHARGE_MAX);
    expect(small).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0);
    expect(chargeBallRadius(1)).toBeLessThan(chargeBallRadius(SMASH_CHARGE_MAX) * 0.5);
    expect(chargeBallRadius(SMASH_CHARGE_MAX / 2)).toBeGreaterThan(chargeBallRadius(1));
  });

  /** The radius the charge ball is actually drawn at, read off the canvas. */
  function chargeBallRadius(charge: number): number {
    let biggest = 0;
    const ctx = {
      ...recordingContext().ctx,
      arc: (_x: number, _y: number, r: number) => {
        biggest = Math.max(biggest, r);
      },
    } as unknown as CanvasRenderingContext2D;
    fx.neutralB?.({
      ctx,
      f: { facing: 1, charge } as never,
      def: samus,
      cam: { zoom: 10 } as never,
      height: 12.2,
      x: 400,
      y: 400,
      u: 10,
      frame: 1,
      total: 44,
      t: 0,
      dir: 1,
      over: (paint: () => void) => paint(),
    });
    return biggest;
  }

  it("every multihit frame of up air has something on it", () => {
    for (let frame = 5; frame <= 17; frame++) {
      expect(fxAt("uair", frame), `uair frame ${frame} paints nothing`).toBeGreaterThan(0);
    }
    expect(fxAt("uair", 30)).toBe(0);
  });

  it("neutral air paints a trail across the whole active window", () => {
    for (let frame = 8; frame <= 22; frame++) {
      expect(fxAt("nair", frame), `nair frame ${frame} paints nothing`).toBeGreaterThan(0);
    }
  });

  it("the Morph Ball replaces the figure only while it is a ball", () => {
    const { ctx } = recordingContext();
    const call = (frame: number) =>
      fx.downB?.({
        ctx, f: { facing: 1, charge: 0 } as never, def: samus, cam: { zoom: 10 } as never,
        height: 12.2, x: 400, y: 400, u: 10, frame, total: 47, t: 0, dir: 1,
        over: (paint: () => void) => paint(),
      });
    expect(call(2)?.hideFigure ?? false).toBe(false);
    expect(call(11)?.hideFigure).toBe(true);
    expect(call(40)?.hideFigure ?? false).toBe(false);
  });

  it("every projectile painter draws something", () => {
    for (const [id, painter] of Object.entries(projectiles)) {
      const { ctx, drawn } = recordingContext();
      painter({ ctx, u: 10, age: 4, dir: 1, heading: 0.2, charge: 2, returning: false, frame: 7 });
      expect(drawn(), `${id} painted nothing`).toBeGreaterThan(0);
    }
  });

  it("the Charge Shot grows in flight with how long it was held", () => {
    const radiusAt = (charge: number) => {
      let biggest = 0;
      const ctx = {
        ...recordingContext().ctx,
        arc: (_x: number, _y: number, r: number) => {
          biggest = Math.max(biggest, r);
        },
      } as unknown as CanvasRenderingContext2D;
      projectiles.chargeShot({
        ctx, u: 10, age: 3, dir: 1, heading: 0, charge, returning: false, frame: 3,
      });
      return biggest;
    };
    expect(radiusAt(5.6)).toBeGreaterThan(radiusAt(1) * 1.5);
  });
});
