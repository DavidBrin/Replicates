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
import { toFloat } from "@/engine/fixed";
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

/**
 * Where the Arm Cannon's muzzle is, in rig units, for a clip at time `t`.
 *
 * The prop is mounted at 0.55 along `forearmR` and painted in its own frame,
 * where `+y` runs along the bone; the bore sits at 1.08 of those units past the
 * anchor and the prop's `size` is 2.2. Recomputed here rather than imported so
 * that a test about where the weapon *is* cannot be satisfied by the rig
 * agreeing with itself.
 */
function muzzleAt(clip: PoseClip, t: number): { x: number; y: number } {
  const sk = skeletonAt(clip, t);
  const f = sk.forearmR;
  const dx = f.x1 - f.x0;
  const dy = f.y1 - f.y0;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: f.x0 + dx * 0.55 + (dx / len) * 1.08 * 2.2,
    y: f.y0 + dy * 0.55 + (dy / len) * 1.08 * 2.2,
  };
}

/* ------------------------------------------------------------ the stand -- */

/**
 * The idle is the pose a player looks at more than any other, and hers was the
 * shared clip — which hangs both arms straight down. On every other fighter
 * that is a pair of arms. On Samus the near one carries a prop 4.2 rig units
 * across mounted *perpendicular* to the bone, so an arm pointing at the floor
 * lays the Arm Cannon across her hips as a horizontal slab whose only
 * distinguishing part is a dark muzzle band. It was called out as the worst
 * remaining frame she had.
 */
describe("the standing pose is a fighter holding a gun", () => {
  const idle = poses.idle!;
  // Four keys of a breath: every one of them is a frame somebody sees.
  const PHASES = [0, 0.34, 0.58, 0.8];

  it("she has her own idle at all", () => {
    expect(idle).toBeDefined();
    expect(idle.loop).toBe(true);
  });

  it("holds the muzzle clear of her own torso, at hip height, all the way round", () => {
    for (const t of PHASES) {
      const sk = skeletonAt(idle, t);
      const bore = muzzleAt(idle, t);
      // Clear of the torso capsule in front, not merely forward of the joint.
      const front = Math.max(sk.torso.x0, sk.torso.x1) + sk.torso.thickness / 2;
      expect(bore.x, `at t=${t} the bore is at ${bore.x.toFixed(2)}, the torso reaches ${front.toFixed(2)}`)
        .toBeGreaterThan(front);
      // And pointing down the stage rather than at the sky or at her feet: the
      // reference has it 25–35° under the horizontal, over the leading thigh.
      // `y` is measured downward, so the muzzle must be *below* the shoulder
      // and *above* the knee.
      expect(bore.y).toBeGreaterThan(sk.torso.y1);
      expect(bore.y).toBeLessThan(sk.shinR.y0);
    }
  });

  it("stands on two legs rather than on one", () => {
    // At her proportions two legs a degree apart are one leg. The stagger has
    // to be at least a boot's length or the silhouette is a fighter on a pole.
    for (const t of PHASES) {
      const sk = skeletonAt(idle, t);
      expect(Math.abs(sk.footR.x0 - sk.footL.x0), `at t=${t} the two ankles are stacked`).toBeGreaterThan(0.8);
    }
  });

  it("keeps both boots on the floor through the whole breath", () => {
    // `offsetY` is absolute and has to be repaid by folding the legs. A stance
    // that drops the hips without shortening the legs walks the feet through
    // the stage, and it is invisible in the lab, where there is no stage.
    for (const t of PHASES) {
      const s = samplePose(idle, t);
      const sk = skeletonAt(idle, t);
      const lowest = Math.max(sk.footR.y1, sk.footL.y1, sk.footR.y0, sk.footL.y0);
      // `y` is down-positive from the feet origin; `offsetY` lifts.
      const throughTheFloor = lowest - s.offsetY;
      expect(throughTheFloor, `at t=${t} a boot is ${throughTheFloor.toFixed(2)} units under the stage`)
        .toBeLessThan(0.35);
    }
  });

  it("breathes without going anywhere", () => {
    // A loop that does not move is a photograph and a loop that moves a lot is
    // a fidget. The reference measures the whole body's bob at about 1% of her
    // height, which on a 12-unit fighter is a tenth of a unit at the pelvis —
    // but the cannon is on the end of a two-bone chain and swings further.
    let most = 0;
    for (let i = 1; i < 12; i++) most = Math.max(most, travel(idle, 0, i / 12));
    expect(most, "the idle is a photograph").toBeGreaterThan(0.4);
    expect(most, "the idle is a fidget").toBeLessThan(6);
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

/**
 * A canvas that records the *geometry* it was asked for, not just that it was
 * asked for something.
 *
 * The assertions below are about where things are and how big they are — how
 * far a tether reaches, whether a ball is still in the barrel — and none of
 * those can be checked by counting `fill` calls. Everything is recorded in the
 * coordinates the painter passed, which is screen space with the fighter's feet
 * at `(x, y)`; the callers divide by `u` to talk in rig units.
 */
interface Trace {
  /** `solid` is false for a circle filled with a gradient — i.e. a `glow`,
   *  which is two and a half times the radius of whatever it is glowing
   *  around. Measuring "the biggest circle" without this measures the bloom. */
  arcs: { x: number; y: number; r: number; from: number; to: number; solid: boolean }[];
  ellipses: { x: number; y: number; rx: number; ry: number }[];
  points: { x: number; y: number }[];
  strokeWidths: number[];
  /** Where each `save`d sub-frame was moved to, in order. */
  translates: { x: number; y: number }[];
}

function tracingContext(): { ctx: CanvasRenderingContext2D; trace: Trace } {
  const trace: Trace = { arcs: [], ellipses: [], points: [], strokeWidths: [], translates: [] };
  const gradient = { addColorStop: () => {} };
  const ctx = {
    canvas: { width: 800, height: 600 },
    save: () => {},
    restore: () => {},
    translate: (x: number, y: number) => trace.translates.push({ x, y }),
    scale: () => {},
    rotate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: (x: number, y: number) => trace.points.push({ x, y }),
    lineTo: (x: number, y: number) => trace.points.push({ x, y }),
    arc(x: number, y: number, r: number, from: number, to: number) {
      trace.arcs.push({
        x, y, r, from, to,
        solid: typeof (this as { fillStyle: unknown }).fillStyle === "string",
      });
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => trace.ellipses.push({ x, y, rx, ry }),
    bezierCurveTo: () => {},
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => trace.points.push({ x, y }),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fill: () => {},
    stroke() {
      trace.strokeWidths.push((this as { lineWidth: number }).lineWidth);
    },
    fillRect: () => {},
    strokeRect: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, trace };
}

/**
 * Run one fighter's effect and hand back what it drew, split by **when**.
 *
 * `under` is everything painted immediately, which the renderer draws before
 * the figure; `over` is everything the effect deferred through the `over`
 * callback, which the renderer drains afterwards. Keeping the two traces apart
 * is the whole point — an effect that is in the wrong one still paints, still
 * passes a "did it draw anything" check, and is still invisible behind the
 * fighter.
 */
function fxTrace(
  slot: MoveSlot,
  frame: number,
  opts: { charge?: number; move?: MoveSlot; u?: number } = {},
): { under: Trace; over: Trace; deferred: number } {
  const u = opts.u ?? 10;
  const { ctx, trace } = tracingContext();
  const queued: (() => void)[] = [];
  const painter = fx[slot];
  if (!painter) throw new Error(`samus has no fx for ${slot}`);
  painter({
    ctx,
    f: { facing: 1, charge: opts.charge ?? 0, move: opts.move ?? slot } as never,
    def: samus,
    cam: { zoom: u } as never,
    height: 12.2,
    x: 400,
    y: 400,
    u,
    frame,
    total: samus.moves[opts.move ?? slot]?.totalFrames ?? 40,
    t: 0,
    dir: 1,
    over: (paint: () => void) => queued.push(paint),
  });
  // Everything so far is what the renderer paints *before* the figure.
  const under: Trace = {
    arcs: [...trace.arcs],
    ellipses: [...trace.ellipses],
    points: [...trace.points],
    strokeWidths: [...trace.strokeWidths],
    translates: [...trace.translates],
  };
  // Now drain the queue the way `renderer.ts` does, and whatever lands after
  // that is what goes in front.
  for (const paint of queued) paint();
  return {
    under,
    over: {
      arcs: trace.arcs.slice(under.arcs.length),
      ellipses: trace.ellipses.slice(under.ellipses.length),
      points: trace.points.slice(under.points.length),
      strokeWidths: trace.strokeWidths.slice(under.strokeWidths.length),
      translates: trace.translates.slice(under.translates.length),
    },
    deferred: queued.length,
  };
}

/** Anything at all in this trace. */
function anything(t: Trace): number {
  return t.arcs.length + t.ellipses.length + t.points.length + t.strokeWidths.length;
}

/** The biggest circle that is a shape rather than a bloom, in rig units. */
function biggestSolid(t: Trace, u = 10): number {
  const rs = t.arcs.filter((a) => a.solid).map((a) => a.r);
  return rs.length ? Math.max(...rs) / u : 0;
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

/* ------------------------------------------------- in front, not behind -- */

/**
 * Which side of the fighter an effect is painted on.
 *
 * Effects go **under** the figure by default, which is right for a charge glow
 * and a shockwave at the feet and wrong for anything the body is inside of.
 * Both of these were in the wrong one for a whole round: the up air's drill was
 * a cone built deliberately wider than her hurtbox so that its *flanks* would
 * survive being occluded, with its entire centre — the part that says drill —
 * behind her; and the down air's arc is swept about her shoulder, so its inner
 * half lay inside her too.
 *
 * The check is on the queue rather than on the drawing, because the failure is
 * invisible to a "did it paint anything" test: an effect in the wrong layer
 * paints exactly as much as one in the right layer.
 */
describe("the effects the body is inside of are painted in front of it", () => {
  it("the up air drill defers its cone and its bands", () => {
    for (const frame of [5, 11, 17]) {
      const t = fxTrace("uair", frame);
      expect(t.deferred, `uair frame ${frame} queued nothing for over()`).toBeGreaterThan(0);
      // The rings are the drill. If they are not in the deferred half, they are
      // behind her.
      expect(anything(t.over), `uair frame ${frame} deferred an empty paint`).toBeGreaterThan(0);
      expect(t.over.ellipses.length, `uair frame ${frame} draws no bands in front`).toBeGreaterThan(2);
    }
  });

  it("the up air's glow stays behind her, so the body is lit from inside it", () => {
    // Not everything moves. A bloom painted over the fighter washes her out;
    // this one is the light *behind* the drill and belongs under.
    const t = fxTrace("uair", 11);
    expect(anything(t.under), "uair paints nothing behind the fighter").toBeGreaterThan(0);
  });

  it("the down air's swing arc goes in front and its meteor spark stays under", () => {
    const t = fxTrace("dair", 19);
    expect(t.deferred, "dair queued nothing for over()").toBeGreaterThan(0);
    expect(anything(t.over), "dair's arc is not painted in front").toBeGreaterThan(0);
    // The spark is a point of impact two units below her boots, not part of the
    // swing, and it is drawn immediately.
    expect(anything(t.under), "dair's meteor spark left the under layer").toBeGreaterThan(0);
  });

  it("the down air's trail does not paint over the barrel it comes off", () => {
    /**
     * `over` cuts both ways. Painting an effect in front of the fighter means
     * it covers whatever it is drawn across, and the first version of this
     * swept the whole way round to the muzzle — which laid a gold band exactly
     * where the Arm Cannon is on the meteor frame, so the move's own weapon was
     * missing from the frame that takes the stock. A trail belongs *behind* the
     * leading edge.
     *
     * Measured as coverage rather than as reach, because the arc is swept about
     * her shoulder and its outer radius passes the muzzle's distance whether or
     * not it passes the muzzle.
     */
    const u = 10;
    const t = fxTrace("dair", 20, { u });
    const pivot = t.over.translates[0];
    expect(pivot, "the arc was not drawn in a frame of its own").toBeDefined();
    // `crescent` walks the outer edge and then the inner edge back, so the two
    // radii recover the band's centre line and its half-width.
    const [outer, inner] = t.over.arcs;
    const mid = (outer.r + inner.r) / 2;
    const half = Math.abs(outer.r - inner.r) / 2;

    const clip = poses.dair!;
    const time = timeOfFrame("dair", 20);
    const sample = samplePose(clip, time);
    const bore = muzzleAt(clip, time);
    // Into the same screen space the painter drew in: feet at (400, 400), `u`
    // pixels to the unit, `y` down, and the clip's own body offset applied.
    const bx = 400 + (bore.x + sample.offsetX) * u - pivot.x;
    const by = 400 + (bore.y - sample.offsetY) * u - pivot.y;
    const angle = Math.atan2(by, bx);
    const distance = Math.hypot(bx, by);
    const withinSweep = angle >= Math.min(outer.from, outer.to) && angle <= Math.max(outer.from, outer.to);
    const withinBand = Math.abs(distance - mid) < half;
    expect(
      withinSweep && withinBand,
      `the trail covers the muzzle: it is at ${angle.toFixed(2)} rad and ${(distance / u).toFixed(2)} units ` +
        `from the pivot, and the band runs ${outer.from.toFixed(2)}..${outer.to.toFixed(2)} at ` +
        `${(mid / u).toFixed(2)}±${(half / u).toFixed(2)}`,
    ).toBe(false);
  });
});

/* --------------------------------------------------------- the tether -- */

describe("the Grapple Beam reaches what it grabs", () => {
  /** How far forward, in rig units, the beam was drawn on this frame. */
  function reachOn(move: MoveSlot, frame: number): number {
    const t = fxTrace("grab", frame, { move });
    if (t.under.points.length === 0) return 0;
    return Math.max(...t.under.points.map((p) => p.x - 400)) / 10;
  }

  /**
   * Both grabs, and they are not the same move.
   *
   * A standing grab reaches 14 units and is live on frames 15–22; a dash grab
   * reaches 15 and is live on 17–24, and they share this one painter. Written
   * against the standing numbers, the tether on a dash grab was already on its
   * way home two frames before the move stopped grabbing, and the reach was a
   * unit short of the box that does the grabbing.
   */
  const CASES: MoveSlot[] = ["grab", "dashGrab"];

  it.each(CASES)("%s puts the claw on its own grab hitbox", (move) => {
    const box = samus.moves[move]!.hitboxes[0];
    const want = toFloat(box.x);
    const got = reachOn(move, box.startFrame);
    expect(got, `${move} frame ${box.startFrame}: beam reaches ${got.toFixed(2)}, hitbox is at ${want.toFixed(2)}`)
      .toBeGreaterThan(want - 0.6);
  });

  it.each(CASES)("%s is still out on the last frame it can grab", (move) => {
    const box = samus.moves[move]!.hitboxes[0];
    const want = toFloat(box.x);
    const got = reachOn(move, box.endFrame);
    expect(got, `${move} frame ${box.endFrame}: beam has already retracted to ${got.toFixed(2)}`)
      .toBeGreaterThan(want - 0.6);
  });

  it.each(CASES)("%s has pulled the beam home by the time the move ends", (move) => {
    const total = samus.moves[move]!.totalFrames;
    expect(reachOn(move, total - 1)).toBeLessThan(7);
  });

  it("is drawn thick enough to see at the zoom a match is played at", () => {
    // The first version was a 0.24-unit core in a 0.7-unit halo, which at match
    // scale is a three-pixel dotted line over a night stage — geometrically
    // correct and, in a real capture, a laser sight rather than a tether. This
    // is the one move on her whose entire graphic is the effect.
    const t = fxTrace("grab", 18);
    const widest = Math.max(...t.under.strokeWidths);
    expect(widest / 10, `the beam's widest stroke is ${(widest / 10).toFixed(2)} rig units`).toBeGreaterThan(1.0);
  });
});

/* ------------------------------------------------- the ball in the barrel -- */

describe("Charge Shot", () => {
  /** The biggest circle the effect drew, in rig units. */
  function biggest(frame: number, charge: number): number {
    return biggestSolid(fxTrace("neutralB", frame, { charge }).under);
  }

  /**
   * The charge pins `actionFrame` to 1 and `frame` is `actionFrame + 1`, so the
   * whole of the hold is frame 2 and the plasma leaves on frame 3.
   */
  const HOLDING = 2;

  it("holds a ball that is most of her own height at full charge", () => {
    // Measured off the game's own hurtbox renders: the full-charge sphere is
    // around three quarters of her standing height across. At half that it
    // reads as a slightly bigger tap, and the only decision a player makes
    // against Samus is whether the ball is worth respecting yet.
    const r = biggest(HOLDING, SMASH_CHARGE_MAX);
    expect(r * 2, `a full charge is ${(r * 2).toFixed(1)} rig units across`).toBeGreaterThan(8.0);
  });

  it("puts the ball off the end of the barrel rather than inside it", () => {
    // The cannon prop is four rig units across. A ball centred on the bore has
    // its inboard half behind the barrel, and since the ball is painted under
    // the fighter that half is not drawn at all — a full charge came out
    // looking like a half one.
    const t = fxTrace("neutralB", HOLDING, { charge: SMASH_CHARGE_MAX });
    const centres = t.under.arcs.filter((a) => a.solid).map((a) => (a.x - 400) / 10);
    // The bore is at about 7.2 units. A fully charged ball is 4.4 units in
    // radius, so standing it off by half of that puts its centre past 9.
    expect(Math.min(...centres)).toBeGreaterThan(8.5);
  });

  it("stops drawing the ball once the shot has left", () => {
    // `f.charge` is not cleared when the plasma spawns — `startAction` clears
    // it, and that does not happen until the move ends — so a guard on `charge`
    // alone kept a fully charged ball hanging at the muzzle through all
    // forty-one frames of recovery, while the shot it fired was already
    // exploding on somebody.
    expect(biggest(HOLDING, SMASH_CHARGE_MAX)).toBeGreaterThan(4);
    // Once it has left, nothing on screen may still depend on how full the bar
    // was — the flash and the steam are the same whatever she fired.
    for (const frame of [4, 9, 20]) {
      expect(
        biggest(frame, SMASH_CHARGE_MAX),
        `frame ${frame} still draws something that scales with the charge`,
      ).toBeCloseTo(biggest(frame, 0), 5);
    }
  });

  it("still flashes and vents on the frames the shot is leaving", () => {
    expect(fxAt("neutralB", 3, SMASH_CHARGE_MAX)).toBeGreaterThan(0);
    expect(fxAt("neutralB", 9, SMASH_CHARGE_MAX)).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------- the cannon is alive -- */

describe("the Arm Cannon", () => {
  /** The prop painters the rig hangs on `forearmR`. */
  const cannon = rig.props.find((p) => p.bone === "forearmR");

  function paint(mode: "body" | "rim", frame: number): Trace {
    const { ctx, trace } = tracingContext();
    const brush = {
      ctx,
      mode,
      palette: samus.palette,
      rimLocal: 0.1,
      outline: "#000000",
      fill: () => {},
      line: () => {},
    } as unknown as Parameters<NonNullable<typeof cannon>["draw"] & ((b: never) => void)>[0];
    cannon?.draw?.(brush, cannon, { frame, t: 0, vx: 0, vy: 0, airborne: false });
    return trace;
  }

  it("is mounted on the cannon arm and paints something", () => {
    expect(cannon).toBeDefined();
    expect(anything(paint("body", 0))).toBeGreaterThan(0);
  });

  it("has a lamp that breathes on its own clock", () => {
    // A prop is bolted rigidly to its bone, so without the animation argument
    // nothing about it can change while she stands still — and a weapon whose
    // light is a painted dot is a weapon that is switched off. The pulse is in
    // the ring's *size* rather than its alpha so the colour stays a palette
    // role and follows an alternate costume.
    const sizes = [0, 14, 28, 43, 57].map((frame) => {
      const t = paint("body", frame);
      return Math.max(...t.ellipses.map((e) => e.rx));
    });
    const spread = Math.max(...sizes) - Math.min(...sizes);
    expect(spread, `the ring's radius only varies by ${spread.toFixed(3)}`).toBeGreaterThan(0.05);
  });

  it("keeps the lamp out of the rim pass", () => {
    // A shape painted in the rim pass inflates the silhouette. A two-pixel lamp
    // has no business growing her outline, and a hot colour handed to the rim
    // is painted in the outline colour and disappears anyway.
    const body = paint("body", 0).ellipses.length;
    const rim = paint("rim", 0).ellipses.length;
    expect(body).toBeGreaterThan(rim);
  });
});

/* ------------------------------------------------------- the Morph Ball -- */

describe("the Morph Ball", () => {
  it("spins a hoop that changes shape every frame", () => {
    // The ball body barely turns in the real thing; a thin bright ring round it
    // does all the rotational work, and its projected ellipse is different on
    // every frame. Without it a sphere sitting on the floor has no way to say
    // it is alive, which is what the previous version — a disc with three fixed
    // latitude lines — could not do.
    const heights = [8, 10, 12, 14, 16].map((frame) => {
      const t = fxTrace("downB", frame);
      // The hoop is the widest ellipse: it is larger than the ball itself.
      const widest = t.under.ellipses.reduce((a, b) => (b.rx > a.rx ? b : a), t.under.ellipses[0]);
      return widest.ry / 10;
    });
    const spread = Math.max(...heights) - Math.min(...heights);
    expect(spread, `the hoop's height only varies by ${spread.toFixed(2)} units`).toBeGreaterThan(0.6);
  });

  it("is about a third of her height, not half of it", () => {
    const t = fxTrace("downB", 12);
    const body = biggestSolid(t.under);
    // 12.2 units tall; the game's ball measures around 0.35 of that across.
    expect(body * 2).toBeLessThan(5.6);
    expect(body * 2).toBeGreaterThan(3.4);
  });
});
