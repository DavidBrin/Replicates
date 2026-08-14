/**
 * What has to stay true about Pikachu specifically.
 *
 * Nothing here restates a number from `poses.ts` or `fx.ts`. Every assertion is
 * either a property the drawing has to have to read as Pikachu at all (the ears
 * and the tail leave his outline; his feet stay on the floor), or a relationship
 * between two files that a later edit to *either* would silently break: the
 * contact key is held for as long as the hitbox table in `fighters/pikachu.ts`
 * says the move is live, and the electric effect paints on the frames that same
 * table says it hits.
 *
 * Every failure these guard against is silent. Ears authored long and *drawn*
 * pointing down into the skull still draw; an effect whose frame window has
 * drifted off its hitbox still paints, just at the wrong moment; a clip that has
 * stopped moving still samples.
 */

import { describe, expect, it } from "vitest";
import { pikachu as def } from "@/fighters/pikachu";
import type { MoveSlot } from "@/engine/types";
import { moveFrameOf } from "@/engine/hitbox";
import { toFloat } from "@/engine/fixed";
import { samplePose, type Keyframe, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { resolve, rigHeight } from "../../skeleton";
import type { Brush, PropAnim, PropDef } from "../../rigKit";
import { PROP_STILL, alphaOf, hexToRgb, withAlpha } from "../../rigKit";
import { createCamera } from "../../camera";
import { createMockContext, type RecordedCall } from "../../mockContext";
import { makeFighter, makeStage } from "../../testFixtures";
import { ELECTRIC, fx, projectiles } from "./fx";
import { poses } from "./poses";
import { rig } from "./rig";

/* ------------------------------------------------------------- the rig --- */

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The bounding box of every point a recording was asked to draw through. */
function boundsOf(calls: readonly RecordedCall[]): Box {
  const box: Box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const at = (x: unknown, y: unknown) => {
    if (typeof x !== "number" || typeof y !== "number") return;
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  };
  for (const c of calls) {
    const a = c.args;
    switch (c.method) {
      case "moveTo":
      case "lineTo":
        at(a[0], a[1]);
        break;
      case "quadraticCurveTo":
        at(a[0], a[1]);
        at(a[2], a[3]);
        break;
      case "arc":
      case "ellipse": {
        const [x, y, rx, ry] = a as number[];
        at(x - rx, y - (c.method === "arc" ? rx : ry));
        at(x + rx, y + (c.method === "arc" ? rx : ry));
        break;
      }
      default:
        break;
    }
  }
  return box;
}

/**
 * Run one custom prop's painter and hand back its extent, in the prop's own
 * normalised frame: `+x` toward the fighter's front, `+y` along the bone toward
 * its tip. The mock records the transform calls without applying them, so this
 * measures the shape as authored, which is exactly the layer the bug was in —
 * the shared `earsBolt` painter puts its tips at *negative* y and so drew both
 * ears downward into the skull.
 */
function propBox(prop: PropDef, anim: PropAnim = PROP_STILL): Box {
  const ctx = createMockContext();
  const brush: Brush = {
    ctx,
    mode: "body",
    palette: def.palette,
    rimLocal: 0,
    outline: def.palette.outline,
    fill: () => ctx.fill(),
    line: () => ctx.stroke(),
  };
  prop.draw!(brush, prop, anim);
  return boundsOf(ctx.calls);
}

/** Where a prop's tip is — the furthest point from its root. */
function propTip(prop: PropDef, anim: PropAnim = PROP_STILL): readonly [number, number] {
  const ctx = createMockContext();
  const brush: Brush = {
    ctx,
    mode: "body",
    palette: def.palette,
    rimLocal: 0,
    outline: def.palette.outline,
    fill: () => ctx.fill(),
    line: () => ctx.stroke(),
  };
  prop.draw!(brush, prop, anim);
  let best: [number, number] = [0, 0];
  let far = -1;
  for (const c of ctx.calls) {
    if (c.method !== "moveTo" && c.method !== "lineTo") continue;
    const [x, y] = c.args as number[];
    if (typeof x !== "number" || typeof y !== "number") continue;
    const d = Math.hypot(x, y);
    if (d > far) {
      far = d;
      best = [x, y];
    }
  }
  return best;
}

const still = (over: Partial<PropAnim> = {}): PropAnim => ({ ...PROP_STILL, ...over });

function propNamed(bone: string, index = 0): PropDef {
  const found = rig.props.filter((p) => p.kind === "custom" && p.bone === bone);
  return found[index];
}

describe("the silhouette is Pikachu's", () => {
  // He is drawn about sixty pixels tall in a match, and at that size a player
  // has three things to go on. Two of them have to leave the body outline.
  it("puts the ear tips well clear of the head circle", () => {
    const ears = propNamed("head");
    const tip = (ears.along ?? 0) + propBox(ears).maxY * ears.size;
    // Measured from the head bone's tip, which is the centre of the head circle.
    expect(tip, "the ears do not clear the skull at all").toBeGreaterThan(rig.headRadius);
    expect(tip - rig.headRadius).toBeGreaterThan(rig.headRadius * 0.66);
  });

  it("draws the ears upward rather than down into the skull", () => {
    const box = propBox(propNamed("head"));
    expect(box.maxY).toBeGreaterThan(0);
    expect(Math.abs(box.minY)).toBeLessThan(box.maxY * 0.2);
  });

  it("puts the tail clear of the body behind him", () => {
    const tail = rig.props.find((p) => p.bone === "hip" && p.kind === "custom")!;
    const back = (tail.across ?? 0) + propBox(tail).minX * tail.size;
    // `across` is toward the front, so behind is negative. The widest part of
    // him is the head circle; the tail has to get past it.
    expect(back).toBeLessThan(-rig.headRadius);
    expect(-back - rig.headRadius).toBeGreaterThan(rig.headRadius * 0.5);
  });

  /**
   * The head swallowing the whole body is what this rig started as, and it is
   * why no pose could ever show a limb: with the skull across 72% of his height
   * there was nothing else on screen to move, and the shoulders sat a unit and a
   * half *inside* the head circle.
   */
  it("leaves a body under the head rather than being one circle", () => {
    const total = rigHeight(rig.bones, rig.headRadius);
    expect(rig.headRadius * 2).toBeLessThan(total * 0.62);
    expect(rig.headRadius * 2).toBeGreaterThan(rig.bones.torso.thickness);
    const skeleton = resolve(rig.bones, {}, { x: 0, y: 0, scale: 1, facing: 1 });
    // Screen space is y-down: a larger y is lower, so this says the shoulders
    // are below the head circle's underside.
    expect(skeleton.upperArmR.y0).toBeGreaterThan(skeleton.head.y1 - rig.headRadius);
  });

  /**
   * The paws have to be a colour, not a shade of the outline.
   *
   * They were `#6B4A18` against an outline of `#4A3208`, and the figure is drawn
   * twice — once inflated in the outline colour for the rim, once in body
   * colours — so a dark brown foot was painted into the middle of its own dark
   * brown rim and vanished. The move it cost is the forward tilt, which fires
   * both feet a third of his height clear of the head circle and rendered as a
   * shadow with a spark next to it.
   *
   * Two separations, because either alone is satisfiable by a colour that is
   * wrong in the other direction: far enough from the outline to be a shape, and
   * far enough from the body yellow to be a *different* shape.
   */
  /**
   * The two paws are the same paw.
   *
   * Deliberately *not* a claim about how long it should be. The foot bone is the
   * only cheap source of forward reach on this rig, so the temptation is to
   * assert a minimum here — and the ceiling is set by a shared test rather than
   * by anything in this file: `poses.test.ts` requires every rig to plant within
   * 0.6 units of every other in the shared `brake`, Pikachu is the deepest of
   * the five, and the paw rotates toe-down in that clip. Two tenths of a unit is
   * the whole budget. A minimum written here would be a number copied out of
   * `rig.ts`, and it would fail for a reason that has nothing to do with
   * Pikachu.
   */
  it("gives him two paws of the same size", () => {
    expect(rig.bones.footR.length).toBeCloseTo(rig.bones.footL.length, 6);
    expect(rig.bones.footR.thickness).toBeCloseTo(rig.bones.footL.thickness, 6);
    expect(rig.bones.footR.thickness).toBeGreaterThan(rig.bones.shinR.thickness);
  });

  it("gives the paws a colour that is neither the outline nor the body", () => {
    const paw = rig.boneColour.footR!;
    expect(paw.startsWith("#"), "the paws are a palette role, not a literal").toBe(true);
    const gap = (a: string, b: string) => {
      const [r1, g1, b1] = hexToRgb(a);
      const [r2, g2, b2] = hexToRgb(b);
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
    };
    expect(gap(paw, def.palette.outline), "the paws disappear into their own rim").toBeGreaterThan(
      140,
    );
    expect(gap(paw, def.palette.primary), "the paws disappear into the body").toBeGreaterThan(60);
  });
});

/**
 * The tail is the one shape nothing else on the roster has, and for a whole
 * round it was a decal: bolted to the hip, moving only when a pose moved the
 * hip, which no clip that is not a tail swipe ever does. `PropAnim` is what made
 * it possible to fix, and these are the three things it bought.
 */
describe("the tail moves on its own", () => {
  const tail = () => rig.props.find((p) => p.bone === "hip" && p.kind === "custom")!;

  it("drifts on its own clock while he is standing perfectly still", () => {
    const t = tail();
    const a = propTip(t, still({ frame: 0 }));
    const b = propTip(t, still({ frame: 30 }));
    const c = propTip(t, still({ frame: 62 }));
    // Three samples rather than two: one pair could coincide at the ends of a
    // sine and read as "nothing moves" when everything does.
    const swing = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]));
    expect(swing, "the tail is welded to the hip").toBeGreaterThan(0.05);
    // And not so much that it is flapping: this is drift, not an animation.
    expect(swing).toBeLessThan(1.2);
  });

  /**
   * `PropAnim.vx` is signed by facing, so a tail streams behind its owner in
   * both directions with no conditional in the painter — and a painter that
   * *did* branch on a direction would apply the sign twice. The way to catch
   * that without being able to see a facing is that the response has to be odd:
   * running forward and running backward must move the tip to opposite sides of
   * where it rests.
   */
  it("streams behind him at speed, symmetrically, with no sign of its own", () => {
    const t = tail();
    const rest = propTip(t, still());
    const fwd = propTip(t, still({ vx: 2.0 }));
    const back = propTip(t, still({ vx: -2.0 }));
    expect(Math.hypot(fwd[0] - rest[0], fwd[1] - rest[1]), "speed does nothing").toBeGreaterThan(
      0.25,
    );
    // Laid back: a streaming tail drops toward the horizontal, so the tip is
    // lower along the bone than at rest and further behind.
    expect(fwd[1]).toBeLessThan(rest[1]);
    expect(back[1]).toBeGreaterThan(rest[1]);
  });

  it("lifts when he leaves the ground", () => {
    const t = tail();
    expect(propTip(t, still({ airborne: true }))[1]).toBeGreaterThan(propTip(t, still())[1]);
  });

  /**
   * Calibrated against the **documented** units, which are world units per
   * frame: a walk is about 1, Pikachu's full run 2.04, a launch a good deal
   * more. For most of this pass the renderer handed painters the simulation's
   * raw Q12 value instead — 9839 for that same run — and the tail carried a
   * local correction for it. The fix landed in `renderer.ts` and the correction
   * came back out, so what is pinned here is the contract rather than the bug:
   * a real run has to bend the tail visibly, and no velocity, however large, may
   * fold it back through its own root.
   *
   * The absurd case is not hypothetical. It is what the *old* renderer supplied
   * on every frame of a dash.
   */
  it("bends by a run rather than by a number, and clamps beyond one", () => {
    const t = tail();
    const rest = propTip(t, still());
    const run = propTip(t, still({ vx: 2.039 }));
    expect(
      Math.hypot(run[0] - rest[0], run[1] - rest[1]),
      "a full run does not visibly move the tail",
    ).toBeGreaterThan(0.3);
    const launched = propTip(t, still({ vx: 9839 }));
    // Still a tail: the tip stays out at nearly its authored distance from the
    // root rather than curling in on itself.
    expect(Math.hypot(launched[0], launched[1])).toBeGreaterThan(
      Math.hypot(rest[0], rest[1]) * 0.9,
    );
    // And the clamp is a plateau, not a cliff — twice the speed is the same tail.
    const faster = propTip(t, still({ vx: 40 }));
    expect(launched[0]).toBeCloseTo(faster[0], 6);
    expect(launched[1]).toBeCloseTo(faster[1], 6);
  });

  /**
   * The ears sweep back with speed too, and they are the part that actually
   * *needs* the clamp: the tail's bend is bounded a second time on its way to
   * being an angle, but the ear's lean is a straight multiply into a shear. An
   * unbounded one puts the tips several hundred units off the top of the screen
   * on the first frame of a launch, and the fighter loses the top of his
   * silhouette at exactly the moment a player is trying to find him.
   */
  it("keeps the ears on his head at any speed", () => {
    const ears = propNamed("head");
    const rest = propBox(ears, PROP_STILL);
    for (const vx of [2.039, 40, 9839, -9839]) {
      const box = propBox(ears, still({ vx }));
      expect(Math.abs(box.minX), `ears at vx=${vx}`).toBeLessThan(Math.abs(rest.minX) + 2);
      expect(box.maxX, `ears at vx=${vx}`).toBeLessThan(rest.maxX + 2);
    }
    // But a run still visibly sweeps them: clamped is not frozen.
    expect(Math.abs(propBox(ears, still({ vx: 2.039 })).minX - rest.minX)).toBeGreaterThan(0.02);
  });

  /**
   * A portrait, a stock icon and the silhouette check all draw a figure with no
   * match behind them and get `PROP_STILL`. Two portraits of the same fighter
   * that differed would be a bug nobody could explain, so the whole of the
   * motion has to vanish at frame zero with no velocity.
   */
  it("is exactly as authored in a portrait, which has no clock", () => {
    const t = tail();
    const box = propBox(t, PROP_STILL);
    expect(box.maxY).toBeCloseTo(propBox(t, PROP_STILL).maxY, 10);
    expect(propTip(t, PROP_STILL)[0]).toBeLessThan(0);
  });
});

/* ------------------------------------------------------------ the clips --- */

/** The move slot each overridden clip animates. */
const SLOT: Partial<Record<PoseName, MoveSlot>> = {
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

const NAMES = Object.keys(poses) as PoseName[];

const PIVOT = rigHeight(rig.bones, rig.headRadius) * 0.45;

function skeletonAt(name: PoseName, t: number) {
  return skeletonOf(poses[name]!, t);
}

/** The same, for a clip that is not in the table — a rebuilt two-key version. */
function skeletonOf(clip: PoseClip, t: number) {
  const s = samplePose(clip, t);
  return resolve(rig.bones, s.angles, {
    x: s.offsetX,
    y: -s.offsetY,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
    rotation: s.rotation,
    pivot: PIVOT,
  });
}

/** How far the drawing at `t` has moved from the rest pose, summed over bones. */
function reach(name: PoseName, t: number): number {
  const rest = resolve(rig.bones, {}, { x: 0, y: 0, scale: 1, facing: 1 });
  const now = skeletonAt(name, t);
  let d = 0;
  for (const b of Object.keys(now) as (keyof typeof now)[]) {
    d += Math.hypot(now[b].x1 - rest[b].x1, now[b].y1 - rest[b].y1);
  }
  return d;
}

describe("every clip is an animation rather than a photograph", () => {
  it("moves through the frames it is actually drawn on", () => {
    const still: string[] = [];
    for (const name of NAMES) {
      const seen = new Set<string>();
      // `t = 1` is never sampled — the last frame drawn of an n-frame state is
      // at (n-1)/n — so sampling all the way to 1 would flatter a clip that
      // stops short of where it was heading.
      for (let i = 0; i < 24; i++) seen.add(JSON.stringify(samplePose(poses[name]!, i / 25)));
      if (seen.size < 5) still.push(name);
    }
    expect(still).toEqual([]);
  });

  it("keeps its keys sorted and distinct", () => {
    for (const name of NAMES) {
      const ts = poses[name]!.keys.map((k) => k.t);
      expect([...ts].sort((a, b) => a - b), `${name} keys are out of order`).toEqual(ts);
      expect(new Set(ts).size, `${name} has two keys at one t`).toBe(ts.length);
    }
  });

  it("names a strike on every attack that has a hitbox", () => {
    for (const name of NAMES) {
      const slot = SLOT[name];
      if (!slot || !def.moves[slot]?.hitboxes.length) continue;
      const strike = poses[name]!.strike;
      expect(strike, `${name} has no strike key`).toBeDefined();
      expect(strike!).toBeGreaterThan(0);
      expect(strike!).toBeLessThan(1);
    }
  });
});

/**
 * The span of clip time `poseTimeFor` maps a move's live frames onto.
 *
 * Recomputed from the hitbox table rather than copied out of `poses.ts`, so that
 * editing either file alone is what makes these fail.
 */
function activeWindow(slot: MoveSlot, strike: number): readonly [number, number] | null {
  const move = def.moves[slot];
  if (!move || move.hitboxes.length === 0) return null;
  const first = Math.min(...move.hitboxes.map((h) => h.startFrame)) - 1;
  const last = Math.max(...move.hitboxes.map((h) => h.endFrame)) - 1;
  if (first <= 0 || first >= move.totalFrames) return null;
  return [strike, strike + ((1 - strike) * (last - first)) / (move.totalFrames - first)];
}

describe("the contact shape is held for as long as the hitbox is live", () => {
  /**
   * The two identical keys `held()` emits, if this clip has a pair.
   *
   * Found by comparing shapes rather than by index, so the test is about the
   * contact pose being held and not about where in the array it happens to sit.
   */
  function heldSpan(name: PoseName): readonly [number, number] | null {
    const keys = poses[name]!.keys;
    const shape = (k: Keyframe) => JSON.stringify({ ...k, t: 0, ease: "" });
    for (let i = 0; i < keys.length - 1; i++) {
      if (shape(keys[i]) === shape(keys[i + 1])) return [keys[i].t, keys[i + 1].t];
    }
    return null;
  }

  /**
   * `ease: "out"` is a cubic, so a clip leaves its strike key almost at once:
   * the forward smash's hitbox is live for fifteen frames and the body was a
   * quarter of the way into its recovery by the fourth of them. One frame of
   * extension and fourteen of visibly putting the move away is not what an
   * attack looks like, so every attack that holds one shape emits a second,
   * identical key at the end of its own window — recomputed here from the hitbox
   * table, so shortening the window in `fighters/pikachu.ts` fails this too.
   */
  it("does not release the held shape before the hitbox is done", () => {
    const early: string[] = [];
    for (const name of NAMES) {
      const slot = SLOT[name];
      const clip = poses[name]!;
      if (!slot || clip.strike === undefined) continue;
      const span = heldSpan(name);
      const win = activeWindow(slot, clip.strike);
      if (!span || !win) continue;
      expect(span[0], `${name} holds from ${span[0]} rather than from its strike`).toBeCloseTo(
        clip.strike,
        6,
      );
      if (span[1] < win[1] - 0.005) {
        early.push(`${name} releases at t=${span[1].toFixed(3)}, still hits to ${win[1].toFixed(3)}`);
      }
    }
    expect(early).toEqual([]);
  });

  /**
   * The rest of his moveset does not hold one shape — the drills turn, the
   * multi-hits pulse, and Quick Attack is two separate zips with a beat between
   * them where the move genuinely is not hitting. What has to be true of those
   * is weaker but still real: they keep working through the window rather than
   * sagging back toward the rest pose, which is what deleting a key in the
   * middle of one would do.
   */
  it("keeps the moves that turn or pulse working through the window", () => {
    const limp: string[] = [];
    for (const name of NAMES) {
      const slot = SLOT[name];
      const clip = poses[name]!;
      if (!slot || clip.strike === undefined || heldSpan(name)) continue;
      const win = activeWindow(slot, clip.strike);
      // Thunder is the declared exception: its second hitbox is a column of
      // lightning live to the last frame, and it belongs to the effect rather
      // than to the body, which has already taken the blast.
      if (!win || name === "downB" || win[1] - win[0] < 0.02) continue;
      const shapes = new Set<string>();
      let peak = 0;
      let mean = 0;
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const at = win[0] + ((win[1] - win[0]) * i) / N;
        shapes.add(JSON.stringify(samplePose(clip, at)));
        const r = reach(name, at);
        peak = Math.max(peak, r);
        mean += r / (N + 1);
      }
      // Three rather than four: `hold` easing cuts between drawings instead of
      // travelling through them, and Quick Attack is deliberately three held
      // shapes — the zip up, the beat, and the zip forward. Two would mean a key
      // had gone missing.
      if (shapes.size < 3) limp.push(`${name} is a photograph while it is hitting`);
      if (mean < peak * 0.55) limp.push(`${name} sags back toward rest while it is hitting`);
    }
    expect(limp).toEqual([]);
  });

  /**
   * The forward tilt's wind-up is a *shape*, not an interpolation.
   *
   * Two keys — rest, then contact — blend, so every frame in between is on the
   * straight line joining them. On a fighter whose attacks are carried by
   * whole-body rotation that line is the same picture leaning further over each
   * frame, and a critic reading a capture of this move called it "falling over
   * sideways" rather than a kick. He was right: nothing between standing and
   * horizontal said the drop had been *chosen*. The real move drops onto a
   * shoulder first — paws down, hips up, knees into the chest — and that plant is
   * the frame that distinguishes a breaking move from a stumble.
   *
   * Measured against **the two-key clip it replaced**, rebuilt here from the
   * move's own first and contact keys. That is the only comparison that isolates
   * the thing being claimed: bone angles interpolate, so every limb tip swings
   * through an arc and deviates from a straight line whether or not there is a
   * key in the middle — a "does the path bow" test passes on a clip with nothing
   * in it. Easing does not help either; `ease: "in"` changes *when* the body is
   * on the two-key path, never whether.
   *
   * Scoped to this move because it is the one where the wind-up is a distinct
   * posture rather than a coil. The smashes genuinely do just rear back.
   */
  it("drops onto a shoulder before it kicks, rather than toppling", () => {
    const clip = poses.ftilt!;
    const contact = clip.keys.find((k) => Math.abs(k.t - clip.strike!) < 1e-9)!;
    const twoKey: PoseClip = { loop: false, strike: clip.strike, keys: [clip.keys[0], contact] };
    const LIMB = ["footR", "footL", "handR", "head", "hip"] as const;
    // Every shape the two-key version ever passes through, sampled finely. The
    // comparison is against the *set* rather than frame against frame, so that
    // it measures a shape the flat clip does not have rather than merely a
    // difference in when it arrives — a key that only re-times the same path
    // would pass a frame-matched test and is not a plant.
    const flatPath = Array.from({ length: 60 }, (_, i) =>
      skeletonOf(twoKey, (clip.strike! * i) / 59),
    );
    let novel = 0;
    for (let i = 1; i < 12; i++) {
      const real = skeletonOf(clip, (clip.strike! * i) / 12);
      let nearest = Infinity;
      for (const flat of flatPath) {
        let d = 0;
        for (const bone of LIMB) {
          d = Math.max(d, Math.hypot(real[bone].x1 - flat[bone].x1, real[bone].y1 - flat[bone].y1));
        }
        nearest = Math.min(nearest, d);
      }
      novel = Math.max(novel, nearest);
    }
    const a = skeletonOf(clip, 0);
    const b = skeletonOf(clip, clip.strike!);
    let travelled = 0;
    for (const bone of LIMB) {
      travelled = Math.max(travelled, Math.hypot(b[bone].x1 - a[bone].x1, b[bone].y1 - a[bone].y1));
    }
    expect(
      novel / travelled,
      "the wind-up only visits shapes two keys would have drawn anyway — there is no plant in it",
    ).toBeGreaterThan(0.1);
  });

  it("is at its furthest extension on the strike and not after it", () => {
    for (const name of NAMES) {
      const clip = poses[name]!;
      if (clip.strike === undefined) continue;
      expect(reach(name, clip.strike), `${name} does not extend at contact`).toBeGreaterThan(
        reach(name, 0),
      );
      expect(reach(name, clip.strike), `${name} is still extending at the end`).toBeGreaterThan(
        reach(name, 0.95) - 1e-9,
      );
    }
  });
});

describe("the drawing stays on the stage", () => {
  /**
   * A whole-body rotation turns about the pelvis, so a grounded clip that
   * rotates far enough swings the feet through the floor. The first down smash
   * did exactly that, cartwheeling him through two full turns for a move that in
   * the real game never leaves the ground — the spin is about a *vertical* axis
   * and a side-on camera cannot show it as rotation at all.
   */
  const GROUNDED: readonly PoseName[] = [
    "idle",
    "jab", "ftilt", "utilt", "dtilt", "dashAttack",
    "fsmash", "usmash", "dsmash", "neutralB", "downB",
    "grab", "fthrow", "uthrow", "dthrow",
  ];

  it("keeps his feet on the floor in every grounded clip", () => {
    const offenders: string[] = [];
    for (const name of GROUNDED) {
      if (!poses[name]) continue;
      let worst = 0;
      let worstAt = 0;
      for (let i = 0; i < 40; i++) {
        const sk = skeletonAt(name, i / 40);
        for (const b of ["footL", "footR", "shinL", "shinR"] as const) {
          const low = Math.max(sk[b].y1, sk[b].y0);
          if (low > worst) {
            worst = low;
            worstAt = i / 40;
          }
        }
      }
      // The `t` is reported because without it the only way to find which key
      // sank is to bisect the clip by hand, which is how long this took once.
      if (worst > 1.2) offenders.push(`${name} sinks ${worst.toFixed(2)} at t=${worstAt.toFixed(2)}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The standing loop, which is the pose he is in for most of a match and was the
 * shared humanoid one: knees straight, spine vertical, arms hanging at the
 * sides. On a fighter who is half head that draws a sphere on a column.
 *
 * Nothing here restates an angle. Each assertion is a property of the *shape* —
 * hunched, low, paws forward — that a later edit to any of the four keys would
 * have to keep, and that the shared clip fails.
 */
describe("the standing loop is an animal rather than a person", () => {
  const SAMPLES = [0, 0.12, 0.25, 0.34, 0.46, 0.58, 0.7, 0.8, 0.92];

  it("is his own clip rather than the roster's", () => {
    expect(poses.idle, "Pikachu is back on the shared humanoid stand").toBeDefined();
  });

  /**
   * The hunch. The head leads the hips at every point in the cycle, which is
   * what separates a crouching animal from a standing figure, and it has to hold
   * at *every* sample — a clip that only leans at one key rocks back and forth
   * through vertical instead of being hunched.
   */
  it("carries the head forward of the hips throughout", () => {
    for (const t of SAMPLES) {
      const s = skeletonAt("idle", t);
      expect(
        s.head.x1 - s.hip.x1,
        `at t=${t} his head sits over his hips like a person's`,
      ).toBeGreaterThan(rig.headRadius * 0.15);
    }
  });

  /**
   * The forepaws. Pikachu carries them up in front of his chest, and until the
   * arms were lengthened the whole arm was shorter than the torso capsule's own
   * radius, so a paw brought forward finished up *inside his own body* and no
   * pose could get it out. This asks the question the way the silhouette does:
   * is the hand outside the capsule it would otherwise be buried in.
   */
  it("holds a forepaw clear of the body rather than inside it", () => {
    for (const t of SAMPLES) {
      const s = skeletonAt("idle", t);
      const trunk = Math.max(rig.bones.hip.thickness, rig.bones.torso.thickness) / 2;
      // Not merely outside — outside by enough to *see*. A fifth of a head
      // radius is about three pixels at match scale, and a paw that clears its
      // own body by less than that is a paw nobody can tell is there. The arms
      // at their original length cleared by 0.31 units and read as a bulge.
      expect(
        Math.abs(s.handR.x1 - s.hip.x1),
        `at t=${t} the near forepaw is buried in his own torso`,
      ).toBeGreaterThan(trunk + rig.headRadius * 0.22);
    }
  });

  /**
   * It breathes, and no two parts of it turn round together. A four-key clip
   * whose keys all peak at once is a two-key clip with extra steps, and reads as
   * a metronome at any amplitude — which is the whole reason `idle.ts` is
   * written the way it is.
   */
  it("breathes, with the chest and the head on different beats", () => {
    const chest = (t: number) => -skeletonAt("idle", t).torso.y1;
    // How far the skull is tipped forward of vertical. Screen space is y-down,
    // so "up the bone" is a negative dy. This is the quantity `idle.ts` means by
    // the head having a rhythm of its own — the skull barely changes *height*
    // whatever the neck does, because the neck is a unit and a half long and a
    // few degrees of it is a hundredth of a unit. What it changes is where the
    // face points, which is what an eye reads.
    const tip = (t: number) => {
      const h = skeletonAt("idle", t).head;
      return Math.atan2(h.x1 - h.x0, -(h.y1 - h.y0));
    };
    const argmax = (f: (t: number) => number) => {
      let best = -Infinity;
      let at = 0;
      for (let i = 0; i < 50; i++) {
        const v = f(i / 50);
        if (v > best) {
          best = v;
          at = i / 50;
        }
      }
      return at;
    };
    const range = (f: (t: number) => number) =>
      Math.max(...SAMPLES.map(f)) - Math.min(...SAMPLES.map(f));
    expect(range(chest), "he does not breathe at all").toBeGreaterThan(0.08);
    expect(range(tip), "the head is welded upright").toBeGreaterThan(0.02);
    expect(
      Math.abs(argmax(chest) - argmax((t) => -tip(t))),
      "the chest and the head turn round at the same moment",
    ).toBeGreaterThan(0.08);
  });
});

describe("the forward tilt is a kick rather than an effect", () => {
  /**
   * SmashWiki calls it "an electrified double kick performed from the baby
   * freeze" — the legs are the move. On this rig they very nearly were not: the
   * head circle is 2.6 units of radius and the striking foot reached 4.5 from
   * the spine, so with the body's own backward tip most of the leg was inside
   * the skull and what a player saw was a spark going off next to a yellow blob.
   *
   * The measure that matters is not distance from the spine — the body rotates,
   * and the head goes with it — but **how far past the head circle's own forward
   * edge the paw gets**, in head radii. Below about one, there is no kick.
   */
  it("puts the striking paw well clear of the head circle", () => {
    const clip = poses.ftilt!;
    const s = skeletonAt("ftilt", clip.strike!);
    const edge = s.head.x1 + rig.headRadius;
    const paw = Math.max(s.footR.x1, s.footL.x1);
    expect(paw - edge, "the kick does not leave his own outline").toBeGreaterThan(
      rig.headRadius * 1.0,
    );
  });

  /**
   * And it reaches most of the way to the box it hits with. The hitbox is
   * declared in world units and the skeleton resolves in rig units, so the
   * conversion is `rig.scale` — which also means this fails if someone rescales
   * the fighter without rescaling the move.
   */
  it("reaches most of the way to the hitbox it swings", () => {
    const hit = def.moves.ftilt!.hitboxes[0];
    const centre = toFloat(hit.x) / rig.scale;
    const s = skeletonAt("ftilt", poses.ftilt!.strike!);
    // The nearer of the two. `max` would be satisfied by one leg reaching while
    // the other stayed folded under him, which is a kick and not a double kick.
    expect(Math.min(s.footR.x1, s.footL.x1)).toBeGreaterThan(centre * 0.75);
  });

  /** Both feet, together, and not one behind the other: it is a *double* kick. */
  it("throws both feet, close enough together to read as one strike", () => {
    const s = skeletonAt("ftilt", poses.ftilt!.strike!);
    expect(Math.abs(s.footR.x1 - s.footL.x1)).toBeLessThan(rig.headRadius);
    expect(Math.min(s.footR.x1, s.footL.x1)).toBeGreaterThan(s.head.x1 + rig.headRadius);
  });
});

/* --------------------------------------------------------------- the fx --- */

/**
 * Run one effect and hand back what it drew.
 *
 * `over` runs its callbacks immediately — an effect that queues a paint has still
 * drawn it, and every assertion about *what* was drawn should see the whole
 * picture — but it also counts them, because "was this queued in front of the
 * fighter or painted behind him" is itself a property worth asserting and is
 * invisible in the call list otherwise.
 */
function paint(slot: MoveSlot, frame: number) {
  const fn = fx[slot];
  if (!fn) throw new Error(`pikachu has no effect for ${slot}`);
  const ctx = createMockContext();
  const move = def.moves[slot]!;
  const deferred: number[] = [];
  fn({
    ctx,
    f: makeFighter({ defId: "pikachu", move: slot, actionFrame: frame - 1 }),
    def,
    cam: { ...createCamera(makeStage()), zoom: 8 },
    height: rigHeight(rig.bones, rig.headRadius) * rig.scale,
    x: 0,
    y: 0,
    u: 8,
    frame,
    total: move.totalFrames,
    t: frame / move.totalFrames,
    dir: 1,
    over: (run: () => void) => {
      const from = ctx.calls.length;
      run();
      deferred.push(from, ctx.calls.length);
    },
  });
  /** Was call `i` painted in front of the fighter rather than under him? */
  const inFront = (i: number) => {
    for (let k = 0; k < deferred.length; k += 2) {
      if (i >= deferred[k] && i < deferred[k + 1]) return true;
    }
    return false;
  };
  // A wrapper rather than fields hung on the context: the mock is a Proxy that
  // records every property *assignment* as a call, so `Object.assign(ctx, ...)`
  // put two entries in the recording and made an effect that draws nothing look
  // like one that draws two things.
  return { calls: ctx.calls as readonly RecordedCall[], inFront, deferredCalls: deferred.length / 2 };
}

const PAINTED = Object.keys(fx) as MoveSlot[];

describe("the electric effects paint when they say they do", () => {
  it("keys every effect to a move Pikachu actually has", () => {
    for (const slot of PAINTED) expect(def.moves[slot], slot).toBeDefined();
  });

  // Almost every one of his attacks is electric, so an unpainted attack is a
  // missing move rather than a missing flourish.
  it("paints something on all but a handful of his attacks", () => {
    const attacks = (Object.keys(def.moves) as MoveSlot[]).filter(
      (s) => (def.moves[s]?.hitboxes.length ?? 0) > 0 || s === "neutralB",
    );
    const painted = attacks.filter((s) => fx[s]);
    expect(painted.length).toBeGreaterThan(attacks.length * 0.75);
  });

  /**
   * The failure this catches cannot be seen in a still: an effect whose frame
   * window has drifted off the hitbox it belongs to still paints, and simply
   * happens at the wrong moment.
   */
  it("paints on every frame its hitbox is live", () => {
    const gaps: string[] = [];
    for (const slot of PAINTED) {
      const move = def.moves[slot]!;
      for (const hb of move.hitboxes) {
        for (const frame of [hb.startFrame, Math.round((hb.startFrame + hb.endFrame) / 2)]) {
          // Thunder's second hitbox runs to frame 85; the bolt is deliberately
          // long gone by then, and the comment on the effect says why.
          if (slot === "downB" && frame > 40) continue;
          if (paint(slot, frame).calls.length === 0) {
            gaps.push(`${slot} paints nothing on frame ${frame}`);
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("paints nothing at all once the move is over", () => {
    for (const slot of PAINTED) {
      const move = def.moves[slot]!;
      expect(paint(slot, move.totalFrames + 4).calls.length, `${slot} outlives its move`).toBe(0);
    }
  });

  /**
   * Thunder's bolt had no upper frame bound and left a full-brightness column
   * from the top of the screen to his head for the last seventy frames of the
   * move. Nothing in the move's own data says that is wrong — hitbox 1 really is
   * live until frame 85 — so it needs saying here: the strike is an event and
   * the column that follows it is a decay, not a second bolt.
   */
  it("does not leave Thunder's bolt hanging after it has struck", () => {
    expect(paint("downB", 55).calls.length).toBeLessThan(paint("downB", 16).calls.length * 0.5);
  });

  it("throws the forward smash's orb out in front of him", () => {
    // Frame 11 is the gather at his cheeks and 18 is the sweetspot. The wind-up
    // paints *more* calls than the release, so counting them says nothing; what
    // distinguishes the two is how far forward the graphic reaches. The orb's
    // own hitbox sits at x = 5.4 with a radius of 3.4, and if the picture does
    // not get most of the way there the move is a flash rather than a thrown
    // ball of electricity.
    const gather = boundsOf(paint("fsmash", 11).calls).maxX;
    const thrown = boundsOf(paint("fsmash", 18).calls).maxX;
    expect(thrown).toBeGreaterThan(gather * 1.5);
    expect(thrown).toBeGreaterThan(5.4 * 8 * 0.8);
  });

  it("is deterministic, so two peers draw the same bolt", () => {
    expect(JSON.stringify(paint("downB", 16).calls)).toBe(
      JSON.stringify(paint("downB", 16).calls),
    );
  });

  // The effects are written in the frame data's own numbering, which is one
  // ahead of `actionFrame`. A slot keyed to the wrong one is off by one
  // everywhere and looks merely mistimed.
  it("counts frames the way the frame data does", () => {
    expect(moveFrameOf(0)).toBe(1);
  });
});

/**
 * Replay a recording and hand back every fill and stroke with the blend mode and
 * the colour it was actually performed under.
 *
 * The mock records property assignments and `save`/`restore` in order, so the
 * blend mode in force at any point can be reconstructed exactly — which is the
 * only way to ask the question this file's headline bug was about, since a
 * colour is only half of what a pass paints.
 */
function paintsOf(ctx: { calls: readonly RecordedCall[] }, inFront?: (i: number) => boolean) {
  const out: { blend: string; colour: string; front: boolean }[] = [];
  let blend = "source-over";
  let fill = "#000000";
  let stroke = "#000000";
  const stack: [string, string, string][] = [];
  ctx.calls.forEach((c, i) => {
    switch (c.method) {
      case "save":
        stack.push([blend, fill, stroke]);
        break;
      case "restore": {
        const was = stack.pop();
        if (was) [blend, fill, stroke] = was;
        break;
      }
      case "set:globalCompositeOperation":
        blend = String(c.args[0]);
        break;
      case "set:fillStyle":
        fill = String(c.args[0]);
        break;
      case "set:strokeStyle":
        stroke = String(c.args[0]);
        break;
      case "fill":
        out.push({ blend, colour: fill, front: inFront?.(i) ?? false });
        break;
      case "stroke":
        out.push({ blend, colour: stroke, front: inFront?.(i) ?? false });
        break;
      default:
        break;
    }
  });
  return out;
}

/** Source-over `src` (which carries its own alpha) onto opaque `dst`. */
function over(src: string, dst: string): [number, number, number] {
  const a = alphaOf(src);
  const [r, g, b] = hexToRgb(src);
  const [dr, dg, db] = hexToRgb(dst);
  return [r * a + dr * (1 - a), g * a + dg * (1 - a), b * a + db * (1 - a)];
}

/** `lighter`: add and clamp, which is where the whiteness came from. */
function added(src: string, dst: string): [number, number, number] {
  const a = alphaOf(src);
  const [r, g, b] = hexToRgb(src);
  const [dr, dg, db] = hexToRgb(dst);
  return [
    Math.min(255, r * a + dr),
    Math.min(255, g * a + dg),
    Math.min(255, b * a + db),
  ];
}

/**
 * The brightest thing a fighter is ever drawn against on this roster.
 *
 * `stageArt.ts`'s Smashville sky runs to `#D9EEC4` at the bottom of the screen,
 * which is exactly the band the stage sits in — so it is the honest background
 * for "is this effect still the right colour in a match", and the reason the lab
 * on its `#12151A` panel could never have answered that question.
 */
const BRIGHTEST_SKY = "#D9EEC4";

/** The Thunder Jolt at one point in its ninety-five frame life. */
function jolt(age: number) {
  const ctx = createMockContext();
  projectiles.thunderJolt({
    ctx,
    u: 8,
    age,
    dir: 1,
    heading: 0.2,
    charge: 1,
    returning: false,
    frame: age,
  });
  return ctx;
}

describe("the electricity is yellow at match brightness", () => {
  /**
   * The defect this whole rework exists for.
   *
   * `lighter` adds and clamps. The saturated middle of every shape here is
   * (255, 226, 74) at better than 0.9 alpha, so added to anything at all it is
   * already at 255 in red and green, and stacked two or three deep — which every
   * one of these effects does — it reaches 255 in blue too. The result was that
   * Pikachu's forward smash orb was **white** on a night sky and white on a
   * daylit one, and a character whose entire signature is that his attacks are
   * yellow had no yellow in them.
   *
   * So: the colour a player would name is never added. It is painted. The halo,
   * the thin core filament and the glows still are additive, and are supposed to
   * be — that is what keeps a dense burst hot in the middle.
   */
  it("never adds the saturated yellow, which is what turned every move white", () => {
    const wrong: string[] = [];
    // The projectile painter is in this sweep and has to be: it sets the blend
    // mode for its own body, and it set `lighter` — so a Thunder Jolt drawn with
    // the same `orb` the forward smash uses went straight back to summing itself
    // to white while the smash's did not. The move slots alone would never have
    // said so, and Thunder Jolt is a move whose entire graphic is its projectile.
    const recordings = [
      ...PAINTED.flatMap((slot) => {
        const move = def.moves[slot]!;
        const out: { what: string; calls: readonly RecordedCall[] }[] = [];
        for (let frame = 1; frame <= move.totalFrames; frame += 3) {
          out.push({ what: `${slot} f${frame}`, calls: paint(slot, frame).calls });
        }
        return out;
      }),
      ...[1, 9, 30, 70].map((age) => ({ what: `thunderJolt age ${age}`, calls: jolt(age).calls })),
    ];
    {
      for (const rec of recordings) {
        const slot = rec.what;
        const frame = "";
        for (const p of paintsOf(rec)) {
          if (p.blend !== "lighter") continue;
          const [r, g, b] = hexToRgb(p.colour);
          const [br, bg, bb] = hexToRgb(ELECTRIC.body);
          if (r === br && g === bg && b === bb) {
            wrong.push(`${slot}${frame} adds ${ELECTRIC.body} at alpha ${alphaOf(p.colour)}`);
          }
        }
      }
    }
    expect([...new Set(wrong)].slice(0, 6)).toEqual([]);
  });

  // The other half of the same claim: it is not enough that the yellow is never
  // added, it has to actually be there. Deleting the body stroke would satisfy
  // the assertion above and leave a graphic made of halo and filament.
  it("paints that yellow on every attack that has an effect at all", () => {
    const bare: string[] = [];
    for (const slot of PAINTED) {
      const move = def.moves[slot]!;
      let seen = false;
      for (let frame = 1; frame <= move.totalFrames && !seen; frame++) {
        seen = paintsOf(paint(slot, frame)).some(
          (p) => p.blend !== "lighter" && p.colour.startsWith("rgba(255, 226, 74"),
        );
      }
      if (!seen) bare.push(slot);
    }
    expect(bare).toEqual([]);
  });

  /**
   * And the colour survives the background it is painted on.
   *
   * Guards the palette rather than the compositing: a yellow nudged toward white
   * passes both assertions above and still comes out grey over Smashville.
   * `lighter` is computed alongside only to state the size of the difference the
   * rework bought — 130-odd points of blue channel, which is the whole of the
   * gap between "electric" and "blown out".
   */
  it("stays a chromatic yellow over the brightest sky on the roster", () => {
    const painted = over(withAlpha(ELECTRIC.body, 0.95), BRIGHTEST_SKY);
    expect(painted[0] - painted[2]).toBeGreaterThan(120);
    const summed = added(withAlpha(ELECTRIC.body, 0.95), BRIGHTEST_SKY);
    expect(summed[0] - summed[2]).toBeLessThan(20);
  });

  /**
   * And it is not the same yellow *he* is.
   *
   * The fighter's own `primary` is `#F5D547` and the electric middle is
   * `#FFE24A`: the same hue, seven percent apart in value. On a bolt that is
   * fine — a bolt is a thin shape with a dark contour and a white filament down
   * the middle. On the forward smash's orb, which is a filled disc two thirds
   * his height drawn on top of him, it meant the move the character is most
   * respected for was painted in Pikachu's exact colour and disappeared into
   * Pikachu. A critic looking at a capture of it described "a yellow lump with a
   * plate of yellow noodles on it" and could not name the move.
   *
   * So the *ball* has a colour of its own, and this is the distance that has to
   * survive: far enough from the character to be a separate object, still far
   * enough from white to be electricity rather than a flash.
   */
  it("does not paint its orbs in the fighter's own yellow", () => {
    const [br, bg, bb] = hexToRgb(ELECTRIC.ball);
    const [pr, pg, pb] = hexToRgb(def.palette.primary);
    expect(
      Math.hypot(br - pr, bg - pg, bb - pb),
      "the orb is the same colour as the fighter throwing it",
    ).toBeGreaterThan(55);
    // Still yellow, not a white flash: blue stays well below red.
    expect(br - bb).toBeGreaterThan(80);
    // And the orb actually uses it — a constant nothing paints is not a colour.
    const painted = paintsOf(paint("fsmash", 18)).some((p) =>
      p.colour.startsWith(`rgba(${br}, ${bg}, ${bb}`),
    );
    expect(painted, "nothing paints the ball colour").toBe(true);
  });

  /**
   * The dark contour is the other half of legibility, and it is the pass that
   * must never be additive — adding a dark colour does nothing at all, so a
   * regression there is completely silent.
   */
  it("darkens rather than brightens where it draws its own edge", () => {
    const edge = over(withAlpha(ELECTRIC.edge, 0.3), BRIGHTEST_SKY);
    const sky = hexToRgb(BRIGHTEST_SKY);
    expect(edge[0]).toBeLessThan(sky[0] - 20);
    expect(edge[1]).toBeLessThan(sky[1] - 30);
  });
});

describe("the moves the fighter is standing inside of are painted in front of him", () => {
  /**
   * `drawMoveFx` paints under the figure by default, which is right for a charge
   * glow at the feet and wrong for anything the body occupies. Three of
   * Pikachu's specials are exactly that: the forward smash's orb has its near
   * half on his head, Quick Attack is a trail he is inside of, and Thunder Jolt's
   * whole wind-up happens on the front of his own face. All three were captured
   * showing a rim of light around the object that was hiding them.
   */
  it("queues the forward smash's orb over the fighter, not under him", () => {
    const c = paint("fsmash", 18);
    const front = paintsOf(c, c.inFront).filter((p) => p.front);
    expect(c.deferredCalls, "the orb is not deferred at all").toBeGreaterThan(0);
    expect(front.length).toBeGreaterThan(paintsOf(c).length * 0.8);
  });

  it("queues Quick Attack's trail and Thunder Jolt's wind-up over him too", () => {
    for (const [slot, frame] of [
      ["upB", 10],
      ["neutralB", 14],
    ] as const) {
      const c = paint(slot, frame);
      expect(c.deferredCalls, `${slot} paints its trail behind the fighter`).toBeGreaterThan(0);
    }
  });

  /**
   * And the ones that are genuinely behind him stay behind him. A charge glow
   * queued in front paints over the fighter's own face, which is the same bug
   * with the sign flipped — and "put everything in front" is the tempting wrong
   * fix once one move needed it.
   */
  it("leaves the effects that belong under the fighter under him", () => {
    for (const [slot, frame] of [
      ["nair", 8],
      ["dsmash", 12],
      ["dair", 16],
    ] as const) {
      expect(paint(slot, frame).deferredCalls, `${slot} paints over the fighter`).toBe(0);
    }
  });
});

describe("the Thunder Jolt is drawn as a ball of electricity", () => {
  it("draws something", () => {
    expect(projectiles.thunderJolt, "no painter for thunderJolt").toBeDefined();
    expect(jolt(12).calls.length).toBeGreaterThan(4);
  });

  // "Shoots a ball of electricity" — a ball, and one that boils rather than
  // glides. A static disc sliding across the stage is what it looked like
  // before the surface arcs were reseeded off its own age.
  it("is a different shape on every frame of its life", () => {
    expect(JSON.stringify(jolt(13).calls)).not.toBe(JSON.stringify(jolt(12).calls));
  });

  it("is still on screen late in its ninety-five frame life", () => {
    expect(jolt(80).calls.length).toBeGreaterThan(4);
  });
});
