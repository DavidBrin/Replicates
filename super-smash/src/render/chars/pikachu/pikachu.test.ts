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
import { samplePose, type Keyframe } from "../../poses/clip";
import type { PoseName } from "../../poses/library";
import { resolve, rigHeight } from "../../skeleton";
import type { Brush, PropDef } from "../../rigKit";
import { PROP_STILL } from "../../rigKit";
import { createCamera } from "../../camera";
import { createMockContext, type RecordedCall } from "../../mockContext";
import { makeFighter, makeStage } from "../../testFixtures";
import { fx, projectiles } from "./fx";
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
function propBox(prop: PropDef): Box {
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
  prop.draw!(brush, prop, PROP_STILL);
  return boundsOf(ctx.calls);
}

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
  const s = samplePose(poses[name]!, t);
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

/* --------------------------------------------------------------- the fx --- */

function paint(slot: MoveSlot, frame: number) {
  const fn = fx[slot];
  if (!fn) throw new Error(`pikachu has no effect for ${slot}`);
  const ctx = createMockContext();
  const move = def.moves[slot]!;
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
    over: (paint: () => void) => paint(),
  });
  return ctx;
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

describe("the Thunder Jolt is drawn as a ball of electricity", () => {
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
