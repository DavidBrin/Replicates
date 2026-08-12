/**
 * The bone hierarchy every fighter is drawn from.
 *
 * There is no legitimate way to obtain Nintendo's art, so nothing is blitted:
 * a fighter is sixteen bones, each a parent-relative `{ angle, length,
 * thickness }`, walked depth-first to accumulate transforms and drawn as
 * capsules and circles. Per-fighter identity comes from scaling those lengths
 * and hanging props off named bones (SPEC §10, DECISIONS D2) — Kirby and Donkey
 * Kong run the same sixteen bones and the same pose data.
 *
 * ## Conventions
 *
 * Angles are **radians, parent-relative, zero = along the parent, clockwise
 * positive when the fighter faces right**. Concretely, in rig space a bone at
 * accumulated angle `a` points along `(sin a, cos a)`.
 *
 * Rig space is **y-up, origin at the feet, one unit = one simulation unit**,
 * which is the same unit the stage geometry is in — so a fighter is ~13 units
 * tall against Battlefield's 160-unit platform, exactly as in the real game.
 * Screen space is y-down; `resolve()` is the only place that flip happens.
 *
 * This module is pure geometry. It never touches `GameState`, and it may use
 * `Math` freely: the determinism rules in SPEC §3 bind `engine/`, and a
 * renderer that disagreed with a peer in the last bit of a knee angle would
 * cost nothing.
 */

export type BoneName =
  | "root"
  | "hip"
  | "torso"
  | "head"
  | "thighL"
  | "shinL"
  | "footL"
  | "thighR"
  | "shinR"
  | "footR"
  | "upperArmL"
  | "forearmL"
  | "handL"
  | "upperArmR"
  | "forearmR"
  | "handR";

/**
 * Parents strictly before children, so one forward pass resolves the tree.
 * `resolve()` relies on this and `BASE_RIG` is asserted against it in the tests.
 */
export const BONE_NAMES: readonly BoneName[] = [
  "root",
  "hip",
  "torso",
  "head",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
  "upperArmL",
  "forearmL",
  "handL",
  "upperArmR",
  "forearmR",
  "handR",
];

/** The far-side limbs, drawn behind the torso and shaded down. */
export const FAR_BONES: readonly BoneName[] = [
  "thighL",
  "shinL",
  "footL",
  "upperArmL",
  "forearmL",
  "handL",
];

/** The near-side limbs, drawn in front of the torso. */
export const NEAR_BONES: readonly BoneName[] = [
  "thighR",
  "shinR",
  "footR",
  "upperArmR",
  "forearmR",
  "handR",
];

export interface Bone {
  readonly parent: BoneName | null;
  /**
   * Where on the parent this bone hangs: 1 = the parent's tip (the usual
   * chain), 0 = the parent's base. The thighs use 0 so that leaning the hip
   * swings the legs about the pelvis rather than about the waist.
   */
  readonly attach: 0 | 1;
  /** Rest angle, parent-relative, radians. */
  readonly angle: number;
  /** Rig units. */
  readonly length: number;
  /** Capsule diameter in rig units. Zero means "structural, never drawn". */
  readonly thickness: number;
}

export type Rig = Readonly<Record<BoneName, Bone>>;

/** Degrees to radians, so the rig and the pose library read like a drawing. */
export function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * The reference humanoid, in simulation units.
 *
 * Proportions are Ultimate-ish rather than anatomical: heads are large, legs
 * are short, the silhouette is wider than a real person's. That is deliberate —
 * a fighting game reads its characters at 1/12th of the screen height, and a
 * realistic head disappears at that size.
 *
 * `root` is a zero-thickness strut from the feet to the pelvis; it is the
 * whole-body pivot and is never drawn. `head` runs from the shoulders to the
 * *centre* of the head circle, so `resolve(...).head.x1/y1` is where the skull
 * goes.
 */
export const BASE_RIG: Rig = {
  root: { parent: null, attach: 1, angle: 0, length: 4.2, thickness: 0 },
  hip: { parent: "root", attach: 1, angle: 0, length: 1.1, thickness: 3.1 },
  torso: { parent: "hip", attach: 1, angle: 0, length: 3.2, thickness: 3.7 },
  head: { parent: "torso", attach: 1, angle: 0, length: 2.5, thickness: 1.6 },

  thighL: { parent: "hip", attach: 0, angle: deg(184), length: 2.1, thickness: 1.85 },
  shinL: { parent: "thighL", attach: 1, angle: deg(-4), length: 2.0, thickness: 1.5 },
  footL: { parent: "shinL", attach: 1, angle: deg(-88), length: 1.0, thickness: 1.35 },
  thighR: { parent: "hip", attach: 0, angle: deg(176), length: 2.1, thickness: 1.85 },
  shinR: { parent: "thighR", attach: 1, angle: deg(4), length: 2.0, thickness: 1.5 },
  footR: { parent: "shinR", attach: 1, angle: deg(88), length: 1.0, thickness: 1.35 },

  upperArmL: { parent: "torso", attach: 1, angle: deg(191), length: 1.95, thickness: 1.5 },
  forearmL: { parent: "upperArmL", attach: 1, angle: deg(-13), length: 1.8, thickness: 1.3 },
  handL: { parent: "forearmL", attach: 1, angle: 0, length: 0.6, thickness: 1.75 },
  upperArmR: { parent: "torso", attach: 1, angle: deg(169), length: 1.95, thickness: 1.5 },
  forearmR: { parent: "upperArmR", attach: 1, angle: deg(13), length: 1.8, thickness: 1.3 },
  handR: { parent: "forearmR", attach: 1, angle: 0, length: 0.6, thickness: 1.75 },
};

/* ------------------------------------------------------------- resolving -- */

/** Parent-relative angle overrides. Absent bones keep their rest angle. */
export type PoseAngles = Partial<Record<BoneName, number>>;

export interface RigTransform {
  /** Screen position of the root's base — the fighter's feet. */
  readonly x: number;
  readonly y: number;
  /** Screen pixels per rig unit. */
  readonly scale: number;
  /** Squash and stretch, multiplied onto `scale`. Default 1. */
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** 1 faces right, -1 faces left. Mirrors the whole rig. */
  readonly facing: number;
  /** Whole-body rotation in radians — tumble, screen KO. Default 0. */
  readonly rotation?: number;
  /** Height in rig units the rotation pivots about. Default 4.2 (the pelvis). */
  readonly pivot?: number;
}

export interface ResolvedBone {
  readonly name: BoneName;
  /** Screen coordinates, y-down, mirroring and squash already applied. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Capsule diameter in screen pixels. */
  readonly thickness: number;
  /** Accumulated rig-space angle, before mirroring. */
  readonly angle: number;
}

export type Skeleton = Record<BoneName, ResolvedBone>;

/**
 * Walk the tree once, accumulating transforms, and hand back every bone in
 * screen space.
 *
 * Two passes over the same array rather than one: positions are accumulated in
 * rig space (where the pose data lives and where rotation about the pelvis is
 * expressible), then mapped to the screen. Doing the mirror inside the walk
 * would flip every child's angle sign and make the pose library unreadable.
 */
export function resolve(rig: Rig, pose: PoseAngles, t: RigTransform): Skeleton {
  const sx = (t.scaleX ?? 1) * t.scale;
  const sy = (t.scaleY ?? 1) * t.scale;
  const rot = t.rotation ?? 0;
  const pivotY = t.pivot ?? 4.2;
  const thicknessScale = (Math.abs(sx) + Math.abs(sy)) / 2;

  // Seeding the root with `rot` rotates the rig about the *feet*; a tumbling
  // fighter spins about their middle. Translating by (P - R·P) moves the centre
  // of rotation up to the pelvis without a second pass over the tree.
  const offX = -pivotY * Math.sin(rot);
  const offY = pivotY * (1 - Math.cos(rot));

  // Rig space, y-up, feet at the origin.
  const bx: Record<string, number> = {};
  const by: Record<string, number> = {};
  const tx: Record<string, number> = {};
  const ty: Record<string, number> = {};
  const ang: Record<string, number> = {};

  for (const name of BONE_NAMES) {
    const bone = rig[name];
    const angle = (bone.parent ? ang[bone.parent] : rot) + (pose[name] ?? bone.angle);
    let x0 = 0;
    let y0 = 0;
    if (bone.parent) {
      x0 = bone.attach === 1 ? tx[bone.parent] : bx[bone.parent];
      y0 = bone.attach === 1 ? ty[bone.parent] : by[bone.parent];
    }
    ang[name] = angle;
    bx[name] = x0;
    by[name] = y0;
    tx[name] = x0 + Math.sin(angle) * bone.length;
    ty[name] = y0 + Math.cos(angle) * bone.length;
  }

  const out = {} as Skeleton;
  for (const name of BONE_NAMES) {
    out[name] = {
      name,
      x0: t.x + t.facing * (bx[name] + offX) * sx,
      y0: t.y - (by[name] + offY) * sy,
      x1: t.x + t.facing * (tx[name] + offX) * sx,
      y1: t.y - (ty[name] + offY) * sy,
      thickness: rig[name].thickness * thicknessScale,
      angle: ang[name],
    };
  }
  return out;
}

/** Total rig height in rig units, from the feet to the crown. */
export function rigHeight(rig: Rig, headRadius: number): number {
  return rig.root.length + rig.hip.length + rig.torso.length + rig.head.length + headRadius;
}

/* --------------------------------------------------------- two-bone IK --- */

export interface IkSolution {
  /** Parent-relative angle for the upper bone. */
  readonly upper: number;
  /** Parent-relative angle for the lower bone (the elbow/knee bend). */
  readonly lower: number;
  /** False when the target was out of reach and the limb was straightened at it. */
  readonly reached: boolean;
}

/**
 * Analytic two-bone IK by the law of cosines.
 *
 * A humanoid never needs more: every limb in the rig is exactly two segments
 * plus an end effector, and for two segments the closed form is exact, branchless
 * and free. FABRIK and CCD exist to solve chains of four or more, and iterating
 * toward an answer trigonometry hands you outright would be slower *and* less
 * stable — the iterative solvers jitter when the target crosses the reach limit,
 * which for a fighting game means a knee that pops on every landing.
 *
 * `dx`/`dy` are the target relative to the limb's attachment point, in rig
 * space. `bend` is +1 or -1 and picks which of the two mirror solutions to take
 * — knees bend one way, elbows the other.
 */
export function solveTwoBone(
  dx: number,
  dy: number,
  upperLength: number,
  lowerLength: number,
  bend: number,
): IkSolution {
  const raw = Math.hypot(dx, dy);
  const min = Math.abs(upperLength - lowerLength) + 1e-6;
  const max = upperLength + lowerLength - 1e-6;
  const reached = raw >= min && raw <= max;
  const dist = Math.min(Math.max(raw, min), max);

  // Direction to the target, in the rig's "0 = along +y, clockwise" convention.
  const toTarget = Math.atan2(dx, dy);

  // Interior angle at the joint, and the angle between the upper bone and the
  // straight line to the target.
  const cosJoint = clampUnit(
    (upperLength * upperLength + lowerLength * lowerLength - dist * dist) /
      (2 * upperLength * lowerLength),
  );
  const cosUpper = clampUnit(
    (upperLength * upperLength + dist * dist - lowerLength * lowerLength) /
      (2 * upperLength * dist),
  );

  const sign = bend >= 0 ? 1 : -1;
  return {
    upper: toTarget - sign * Math.acos(cosUpper),
    lower: sign * (Math.PI - Math.acos(cosJoint)),
    reached,
  };
}

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Where a two-bone chain's end effector lands for a given solution — the
 * forward pass that `solveTwoBone` inverts. Exists so the solver can be tested
 * against its own inverse rather than against hand-computed angles.
 */
export function forwardTwoBone(
  upperAngle: number,
  lowerAngle: number,
  upperLength: number,
  lowerLength: number,
): { x: number; y: number } {
  const a = upperAngle;
  const b = upperAngle + lowerAngle;
  return {
    x: Math.sin(a) * upperLength + Math.sin(b) * lowerLength,
    y: Math.cos(a) * upperLength + Math.cos(b) * lowerLength,
  };
}

/**
 * Plant a leg on a surface: solve the knee so the ankle reaches `(footX, footY)`
 * and write the result into a pose. Used for ledge hangs and for keeping feet
 * on sloped soft platforms.
 */
export function ikLeg(
  rig: Rig,
  pose: PoseAngles,
  side: "L" | "R",
  hipX: number,
  hipY: number,
  footX: number,
  footY: number,
): PoseAngles {
  const thigh = side === "L" ? "thighL" : "thighR";
  const shin = side === "L" ? "shinL" : "shinR";
  const sol = solveTwoBone(
    footX - hipX,
    footY - hipY,
    rig[thigh].length,
    rig[shin].length,
    side === "L" ? -1 : 1,
  );
  pose[thigh] = sol.upper;
  pose[shin] = sol.lower;
  return pose;
}

/* --------------------------------------------------------------- drawing -- */

/**
 * The capsule primitive: a round-capped stroke, which *is* a capsule.
 *
 * Every capsule assigns `lineCap` rather than hoisting the assignment out of
 * the loop, so that counting `lineCap = "round"` assignments counts bones —
 * see `mockContext.countCapsules`. The cost is one property write per bone.
 */
export function drawCapsule(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  colour: string,
): void {
  if (thickness <= 0) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = thickness;
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  // A zero-length bone still has to paint its cap, and some engines drop a
  // degenerate stroke entirely, so nudge it.
  ctx.lineTo(x1 === x0 && y1 === y0 ? x1 + 0.01 : x1, y1);
  ctx.stroke();
}

/** Draw a named subset of bones as capsules. */
export function drawBones(
  ctx: CanvasRenderingContext2D,
  skeleton: Skeleton,
  bones: readonly BoneName[],
  colour: string,
  inflate = 0,
): void {
  for (const name of bones) {
    const b = skeleton[name];
    if (b.thickness <= 0) continue;
    drawCapsule(ctx, b.x0, b.y0, b.x1, b.y1, b.thickness + inflate * 2, colour);
  }
}

/** Every drawable bone, in hierarchy order. Fifteen of the sixteen. */
export const DRAWN_BONES: readonly BoneName[] = BONE_NAMES.filter(
  (n) => BASE_RIG[n].thickness > 0,
);
