/**
 * What has to stay true about Link.
 *
 * The failure this file exists for is the one that was reported: *the sword
 * does not swing*. It is invisible to every other test in the project, because
 * a clip with a motionless sword in it is a perfectly well-formed clip — it
 * type-checks, it interpolates, it has four keys and a `strike`, and the only
 * thing wrong with it is what it looks like. So the assertions here are about
 * the **blade path**: how far the sword travels between the wind-up and the
 * contact, how far it travels across the whole move, and how fast it is moving
 * on the frames either side of the hit. Those three numbers separate a swing
 * from a fighter pointing at someone, and nothing else in the suite does.
 *
 * The rest are cross-file invariants — the release frame of a projectile, the
 * clip time of a second hitbox — which exist because both halves are written
 * down in two different files and there is otherwise nothing to notice when one
 * of them moves.
 */

import { describe, expect, it } from "vitest";
import { actionFrameOf } from "@/engine/hitbox";
import { toFloat } from "@/engine/fixed";
import { link } from "@/fighters/link";
import type { MoveSlot } from "@/engine/types";
import { angleDelta, samplePose, type PoseClip } from "../../poses/clip";
import { POSE_LIBRARY, type PoseName } from "../../poses/library";
import { BASE_RIG, resolve, type BoneName } from "../../skeleton";
import { assignmentsTo, createMockContext, type MockContext } from "../../mockContext";
import type { Brush } from "../../rigKit";
import { PROP_STILL } from "../../rigKit";
import type { FxContext, ProjectileContext } from "../../fxKit";
import { poses } from "./poses";
import { fx, projectiles } from "./fx";
import { rig } from "./rig";

/* ------------------------------------------------------------- the blade -- */

/**
 * Where the sword points, in radians, 0 = straight up and 90° = forward.
 *
 * The Master Sword hangs off `handR` at its tip and is drawn along the bone, so
 * the blade's direction is the accumulated angle of the chain that carries it.
 * That accumulation is the only number in this file that corresponds to what a
 * player actually sees.
 */
const BLADE_CHAIN: readonly BoneName[] = ["hip", "torso", "upperArmR", "forearmR", "handR"];

function bladeAngle(clip: PoseClip, t: number): number {
  const sample = samplePose(clip, t);
  let total = 0;
  for (const bone of BLADE_CHAIN) total += sample.angles[bone] ?? BASE_RIG[bone].angle;
  return total;
}

const DEG = 180 / Math.PI;

/**
 * How far the blade **travels** between two clip times, in degrees — the length
 * of the path, not the distance between its ends.
 *
 * The distinction is not academic and it is what this file got wrong. A
 * straight `angleDelta` between the first key and the contact key measures
 * where the blade *ended up*, and Link's forward smash is an overhead chop that
 * starts pointing forward-down and lands pointing forward: ten degrees apart,
 * two hundred and ninety degrees of blade path in between, over the top and
 * back down. The endpoint metric calls that swing motionless. It would also
 * pass a clip that swung out to the target and came straight back, which is the
 * exact failure — "the sword does not swing" — this whole file exists to catch.
 */
function bladePath(clip: PoseClip, from = 0, to = 1, steps = 240): number {
  let total = 0;
  let prev = bladeAngle(clip, from);
  for (let i = 1; i <= steps; i++) {
    const cur = bladeAngle(clip, from + ((to - from) * i) / steps);
    total += Math.abs(angleDelta(prev, cur));
    prev = cur;
  }
  return total * DEG;
}

function clipOf(name: PoseName): PoseClip {
  const clip = poses[name];
  expect(clip, `${name} is not overridden`).toBeDefined();
  return clip as PoseClip;
}

/**
 * The moves the sword is the point of.
 *
 * Deliberately not "every move": Link's neutral air is a flying kick, his back
 * air is two kicks and two of his throws are kicks, and demanding blade travel
 * of those would be demanding the wrong animation.
 */
const SWORD_MOVES: readonly PoseName[] = [
  "jab", "ftilt", "utilt", "dtilt", "dashAttack",
  "fsmash", "usmash", "dsmash",
  "fair", "uair", "dair", "upB", "uthrow",
];

describe("the sword swings", () => {
  it("carries the blade most of a half-turn into every contact", () => {
    for (const name of SWORD_MOVES) {
      const clip = clipOf(name);
      const strike = clip.strike;
      expect(strike, `${name} has no strike`).toBeDefined();
      expect(bladePath(clip, 0, strike as number), `${name}: wind-up to contact`).toBeGreaterThan(
        80,
      );
    }
  });

  it("is still moving on the frames around the contact", () => {
    // The specific shape of the reported bug: a clip can travel a long way in
    // total and still arrive at full extension early and sit there, which reads
    // as a fighter holding a sword out rather than as a hit.
    for (const name of SWORD_MOVES) {
      const clip = clipOf(name);
      const strike = clip.strike as number;
      expect(
        bladePath(clip, Math.max(0, strike - 0.12), strike),
        `${name}: approach`,
      ).toBeGreaterThan(30);
    }
  });

  it("never spends a whole move within a hand's width of one angle", () => {
    for (const name of SWORD_MOVES) {
      expect(bladePath(clipOf(name)), `${name}: total blade path`).toBeGreaterThan(150);
    }
  });

  it("whirls right round, more than once, for Spin Attack", () => {
    // The one move whose blade path is the entire read. A sector sweep would
    // pass every assertion above and still not be a spin.
    expect(bladePath(clipOf("upB"))).toBeGreaterThan(700);
  });
});

/**
 * The one-shot clips — everything except the standing loop.
 *
 * `idle` is the one clip in this file that is *supposed* to be a two-degree
 * breath with no terminator, so the three assertions below — travel, a shape
 * after the contact, a key at `t = 1` — are all false of it and true of
 * everything else. Filtering rather than special-casing keeps them honest: a
 * second looping clip added later drops out of these and has to earn its own
 * test rather than quietly weakening one of these.
 */
const ACTION_CLIPS = Object.entries(poses).filter(([, c]) => !(c as PoseClip).loop) as [
  PoseName,
  PoseClip,
][];

describe("no clip is a photograph", () => {
  it("has one-shot clips to check", () => {
    expect(ACTION_CLIPS.length).toBeGreaterThan(20);
  });

  it("moves some bone a long way in every clip", () => {
    for (const [name, clip] of ACTION_CLIPS) {
      const seen = new Map<BoneName, { min: number; max: number }>();
      for (let i = 0; i <= 20; i++) {
        const sample = samplePose(clip, i / 21);
        for (const [bone, value] of Object.entries(sample.angles) as [BoneName, number][]) {
          const at = seen.get(bone) ?? { min: value, max: value };
          seen.set(bone, { min: Math.min(at.min, value), max: Math.max(at.max, value) });
        }
      }
      const widest = Math.max(...[...seen.values()].map((r) => (r.max - r.min) * DEG));
      expect(widest, `${name} barely moves`).toBeGreaterThan(25);
    }
  });

  it("puts a drawn shape between the contact and the terminator", () => {
    // `t = 1` is never sampled. A clip whose only key after the strike is the
    // terminator holds the contact pose for the whole recovery — thirty frames
    // of a smash, which is what a freeze looks like.
    for (const [name, clip] of ACTION_CLIPS) {
      const after = clip.keys.filter((k) => k.t > (clip.strike ?? 0) && k.t < 1);
      expect(after.length, `${name} has nothing drawn after its contact`).toBeGreaterThan(0);
      expect(clip.keys[clip.keys.length - 1].t, `${name} has no terminator`).toBe(1);
    }
  });

  it("names the contact key at exactly the t it declares", () => {
    for (const [name, clip] of ACTION_CLIPS) {
      if (clip.strike === undefined) continue;
      expect(
        clip.keys.some((k) => k.t === clip.strike),
        `${name} declares strike ${clip.strike} and has no key there`,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------------ the stance -- */

/**
 * Where things are, in rig units, y-up, feet at the origin, with the key's own
 * `offsetX`/`offsetY`/`scaleX`/`scaleY` folded in.
 *
 * The pose layer's angles are not the thing anyone looks at; positions are.
 * Every assertion about the standing pose below is about a *place* — is the
 * blade above the stage, are the feet on it, are the ankles apart — and none of
 * them can be written against joint angles without re-deriving the skeleton by
 * hand, which is how the previous version of this file ended up measuring only
 * accumulated angles and missing that the sword was inside his own shins.
 */
function placesAt(clip: PoseClip, t: number) {
  const s = samplePose(clip, t);
  const sk = resolve(rig.bones, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
  });
  const at = (bone: BoneName, tip: boolean) => ({
    x: (tip ? sk[bone].x1 : sk[bone].x0) + s.offsetX,
    y: -(tip ? sk[bone].y1 : sk[bone].y0) + s.offsetY,
  });
  const hand = at("handR", true);
  const wrist = at("handR", false);
  // The Master Sword hangs off `handR` at its tip and is drawn along the bone,
  // so the blade runs `SWORD.size` units on from the fist in the hand's own
  // direction. Read from the rig rather than restated, so lengthening the
  // sword moves the test with it.
  const len = rig.props.find((p) => p.bone === "handR")?.size ?? 0;
  const d = Math.hypot(hand.x - wrist.x, hand.y - wrist.y) || 1;
  return {
    hand,
    tip: { x: hand.x + ((hand.x - wrist.x) / d) * len, y: hand.y + ((hand.y - wrist.y) / d) * len },
    ankleR: at("footR", false),
    ankleL: at("footL", false),
    crown: -sk.head.y1 + s.offsetY + rig.headRadius,
    hip: -sk.hip.y1 + s.offsetY,
  };
}

/** Eight phases of the standing loop, which is a loop and has no first frame. */
const IDLE_PHASES = [0, 0.13, 0.26, 0.39, 0.52, 0.65, 0.78, 0.91];

describe("standing still", () => {
  // Resolved per test rather than once in the describe body. A `clipOf` up here
  // throws at *collection* time when the override is missing, which takes the
  // whole file out — so the mutation "delete Link's idle" produced a suite that
  // did not run rather than a suite that failed, and a run that does not happen
  // is not a test that caught anything.
  const idle = () => clipOf("idle");

  it("is Link's own clip, and it loops", () => {
    // The guard on everything below: `poses.idle` falling back to the shared
    // library would make every assertion here a test of somebody else's clip.
    expect(poses.idle, "Link does not override idle").toBeDefined();
    expect(poses.idle).not.toBe(POSE_LIBRARY.idle);
    expect(idle().loop).toBe(true);
    expect(idle().period ?? 0).toBeGreaterThan(30);
    // A looping clip is sampled with `t` wrapped, so a key at `t = 1` would be
    // a duplicate of key 0 that the last span crossfades into — a stall.
    expect(idle().keys[idle().keys.length - 1].t).toBeLessThan(1);
  });

  it("braces in a wide stance rather than standing to attention", () => {
    // The shared clip stacks his ankles within a tenth of a unit. Ultimate's
    // Link is measured at 0.52 of his own height apart; this rig tops out
    // around 0.4 before the legs are doing the splits, and 3.5 units — a
    // quarter of his height — is the floor below which it stops reading as a
    // fighting stance at all.
    for (const t of IDLE_PHASES) {
      const p = placesAt(idle(), t);
      expect(Math.abs(p.ankleR.x - p.ankleL.x), `stance width at t=${t}`).toBeGreaterThan(3.5);
    }
  });

  it("keeps both feet on the stage while it does", () => {
    // Folding the legs raises the ankles, because the pelvis is pinned a fixed
    // height above the fighter's own position — so a wide stance has to be paid
    // for in `offsetY`, and forgetting that leaves him hovering. The shared
    // clip's ankles sit about 0.1 above the origin; anything inside a third of
    // a unit of that is on the floor.
    for (const t of IDLE_PHASES) {
      const p = placesAt(idle(), t);
      for (const [name, ankle] of [["right", p.ankleR], ["left", p.ankleL]] as const) {
        expect(ankle.y, `${name} ankle at t=${t}`).toBeGreaterThan(-0.25);
        expect(ankle.y, `${name} ankle at t=${t}`).toBeLessThan(0.45);
      }
    }
  });

  it("carries the sword up and behind him, not down through his own legs", () => {
    // The whole reason this clip exists. On the shared idle the blade hung
    // point-down from a hand at hip height, which on a fighter holding four and
    // a half units of Master Sword means the sword is inside his shins and
    // under the stage. Ultimate's is raked *up and back*, tip near the crown.
    for (const t of IDLE_PHASES) {
      const p = placesAt(idle(), t);
      expect(p.tip.y, `blade tip height at t=${t}`).toBeGreaterThan(p.hip + 4);
      expect(p.tip.x, `blade tip is behind him at t=${t}`).toBeLessThan(p.hand.x - 1);
      expect(p.tip.y, `blade tip is near the crown at t=${t}`).toBeGreaterThan(p.crown - 2.5);
    }
  });

  it("does not bounce", () => {
    // SmashWiki, of this exact animation: "he does not bounce in place." The
    // reference's own capture moves his crown one pixel in two hundred and
    // sixty — under half a percent of his height — and that stillness is the
    // read. It is the opposite of what the shared clip does, so it is the thing
    // most likely to be undone by someone adding "life" back.
    const crowns = IDLE_PHASES.map((t) => placesAt(idle(), t).crown);
    const travel = Math.max(...crowns) - Math.min(...crowns);
    expect(travel / placesAt(idle(), 0).crown).toBeLessThan(0.012);
  });

  it("is still not a photograph", () => {
    // The other side of the same coin: stillness is not stopping. What moves is
    // the sword hand — two to four degrees at the shoulder, which at the end of
    // a four-and-a-half-unit blade is a quarter of a unit of tip travel, and
    // the only motion on this rig where an angle that small is visible.
    const tips = IDLE_PHASES.map((t) => placesAt(idle(), t).tip);
    const spread = Math.max(...tips.map((p) => Math.hypot(p.x - tips[0].x, p.y - tips[0].y)));
    expect(spread).toBeGreaterThan(0.2);
  });

  it("closes the loop without a jump", () => {
    // A loop is sampled with `t` wrapped, so the span from the last key runs
    // back to key 0 and any mismatch is a snap every cycle at the same phase.
    const end = placesAt(idle(), 0.999);
    const start = placesAt(idle(), 0);
    expect(Math.hypot(end.tip.x - start.tip.x, end.tip.y - start.tip.y)).toBeLessThan(0.15);
  });
});

describe("every grounded clip lands back in that stance", () => {
  /**
   * The clips that end standing — everything except the three that recover on
   * a kneel and the five aerials, which are followed by a fall.
   */
  const KNEELING = new Set<PoseName>(["dtilt", "dsmash", "dthrow"]);
  const AERIAL = new Set<PoseName>(["nair", "fair", "bair", "uair", "dair"]);
  const GROUNDED = ACTION_CLIPS.filter(
    ([name]) => !KNEELING.has(name) && !AERIAL.has(name) && name !== "grab",
  );

  it("has clips to check", () => {
    expect(GROUNDED.length).toBeGreaterThan(10);
  });

  it("brings the feet down to where standing puts them", () => {
    // The bug this exists for is silent and I nearly shipped it: the stance
    // folds its legs, which raises the ankles, and it pays for that with
    // `offsetY`. A terminator that copied the *angles* and left the offset at
    // zero ends every attack with Link floating two thirds of a unit above the
    // stage for the last few frames, then snapping down as the cross-fade into
    // idle finishes. `t = 1` is never drawn — but the frames before it travel
    // towards it, so the height it names is the height they head for.
    const stand = placesAt(clipOf("idle"), 0);
    for (const [name, clip] of GROUNDED) {
      const last = clip.keys[clip.keys.length - 1];
      const end = placesAt(clip, 0.999);
      expect(last.t, `${name} has no terminator`).toBe(1);
      for (const [side, ankle] of [["right", end.ankleR], ["left", end.ankleL]] as const) {
        expect(ankle.y, `${name}: ${side} foot ends ${ankle.y.toFixed(2)} up`).toBeLessThan(
          stand.ankleR.y + 0.4,
        );
      }
    }
  });
});

/* --------------------------------------------------- against the raw data -- */

/** Clip time of a move frame, exactly as `poseTimeFor` computes it. */
function clipTimeOf(slot: MoveSlot, frame: number, strike: number): number {
  const move = link.moves[slot];
  const total = move?.totalFrames ?? 0;
  const first = actionFrameOf(Math.min(...(move?.hitboxes ?? []).map((h) => h.startFrame)));
  return frame <= first
    ? (strike * frame) / first
    : strike + ((1 - strike) * (frame - first)) / (total - first);
}

describe("the later hits land where the hitboxes are", () => {
  // A multi-hit is the one case `strike` cannot place on its own: it anchors
  // one key, and every slash after it has to be put where the frame data says
  // by hand. If either side moves, these drift apart silently and the second
  // swing plays over an empty window.
  const CASES: ReadonlyArray<readonly [PoseName, MoveSlot]> = [
    ["usmash", "usmash"],
    ["dsmash", "dsmash"],
    ["fair", "fair"],
    ["bair", "bair"],
  ];

  it("has a key at the clip time of every hitbox after the first", () => {
    for (const [name, slot] of CASES) {
      const clip = clipOf(name);
      const strike = clip.strike as number;
      const starts = [...new Set((link.moves[slot]?.hitboxes ?? []).map((h) => h.startFrame))].sort(
        (a, b) => a - b,
      );
      for (const start of starts.slice(1)) {
        const want = clipTimeOf(slot, actionFrameOf(start), strike);
        const nearest = Math.min(...clip.keys.map((k) => Math.abs(k.t - want)));
        expect(nearest, `${name}: no key near t=${want.toFixed(3)} for frame ${start}`).toBeLessThan(
          0.035,
        );
      }
    }
  });
});

describe("the projectile moves let go when the projectile appears", () => {
  // The bow, the boomerang and the bomb have no hitbox at all, so `strike`
  // never fires and clip time is a plain `frame / totalFrames`. The release
  // pose is therefore placed by arithmetic against `fighters/link.ts`, and this
  // is the only thing that would notice the two disagreeing.
  const CASES: ReadonlyArray<readonly [PoseName, MoveSlot]> = [
    ["neutralB", "neutralB"],
    ["sideB", "sideB"],
    ["downB", "downB"],
  ];

  it("has no strike to remap with", () => {
    for (const [name, slot] of CASES) {
      expect(clipOf(name).strike, `${name}`).toBeUndefined();
      expect(link.moves[slot]?.hitboxes.length, `${slot}`).toBe(0);
    }
  });

  it("keys the release on the frame the projectile spawns", () => {
    for (const [name, slot] of CASES) {
      const move = link.moves[slot];
      const spawn = move?.projectiles?.[0]?.spawnFrame ?? -1;
      expect(spawn, `${slot} launches nothing`).toBeGreaterThan(0);
      const want = spawn / (move?.totalFrames ?? 1);
      const nearest = Math.min(...clipOf(name).keys.map((k) => Math.abs(k.t - want)));
      expect(nearest, `${name}: no key at t=${want.toFixed(3)} (frame ${spawn})`).toBeLessThan(0.015);
    }
  });
});

/* ----------------------------------------------------------------- rig --- */

describe("the rig", () => {
  it("rests both feet pointing the same way", () => {
    // Angles accumulate down the chain and the legs are not individually
    // mirrored, so a right foot at +88 is a right foot on backwards.
    expect(rig.bones.footR.angle).toBe(rig.bones.footL.angle);
    expect(rig.bones.footR.angle).toBeLessThan(0);
  });

  it("hangs the sword off the hand that swings", () => {
    const sword = rig.props.find((p) => p.bone === "handR");
    expect(sword, "no prop on handR").toBeDefined();
    expect(sword?.at, "the sword must start at the fist, not the wrist").toBe(1);
    // Long enough to be seen at match scale. The shared `sword` prop at 4.2 is
    // a 0.46-unit-wide strip beside a 1.25-unit forearm, and a swing you cannot
    // see is the bug this whole file is about.
    expect(sword?.size ?? 0).toBeGreaterThan(4);
  });

  it("leaves the off hand empty", () => {
    // The bow, the boomerang, the bomb and the grab are all done with the left
    // hand, because the right is holding a sword. A shield strapped to
    // `forearmL` puts a dinner plate in every one of them.
    const onTheLeftArm = rig.props.filter((p) => p.bone === "forearmL" || p.bone === "handL");
    expect(onTheLeftArm.map((p) => p.kind)).toEqual([]);
  });

  it("paints its custom props through the brush and never through the context", () => {
    // The figure is drawn twice, once inflated in the outline colour for the
    // rim and once in body colours. A painter that sets `ctx.fillStyle` itself
    // paints that colour into the rim pass and punches a hole in the
    // silhouette — which is invisible until someone stands in front of a light
    // background.
    const custom = rig.props.filter((p) => p.draw);
    expect(custom.length, "the sword, shield, bow and quiver are all custom").toBe(4);

    for (const prop of custom) {
      for (const mode of ["rim", "body"] as const) {
        const ctx = createMockContext();
        const filled: string[] = [];
        prop.draw?.(brushFor(ctx, mode, filled), prop, PROP_STILL);
        // The rim pass is one flat silhouette per shape and the body pass adds
        // the detail on top, so only the body pass is expected to be rich.
        expect(filled.length, `${prop.bone} in ${mode} paints nothing`).toBeGreaterThan(
          mode === "body" ? 2 : 0,
        );
        expect(
          assignmentsTo(ctx, "fillStyle"),
          `${prop.bone} sets fillStyle itself in ${mode}`,
        ).toEqual([]);
      }
    }
  });
});

function brushFor(ctx: MockContext, mode: "rim" | "body", filled: string[]): Brush {
  return {
    ctx,
    mode,
    palette: link.palette,
    rimLocal: 0.05,
    outline: link.palette.outline,
    fill(colour: string) {
      filled.push(colour);
      ctx.fill();
    },
    line(colour: string) {
      filled.push(colour);
      ctx.stroke();
    },
  };
}

/* ------------------------------------------------------------------ fx --- */

/**
 * Play one frame of an effect and hand back everything it painted.
 *
 * `over` is a real queue rather than a no-op, and it is drained here, because
 * an effect that defers all its drawing would otherwise come back having drawn
 * nothing — which is precisely the shape of a bug this file exists to catch.
 * `deferred` is kept separate so a test can ask *where* a graphic was painted,
 * not merely whether it was: the bow and the boomerang in hand are only
 * visible at all because they are in front of the figure.
 */
function fxAt(slot: MoveSlot, frame: number): { ctx: MockContext; under: number; over: number } {
  // The mock context records every property *assignment* as a call, so the
  // counts have to be read out of it rather than stashed back onto it.
  const ctx = createMockContext();
  const total = link.moves[slot]?.totalFrames ?? 1;
  const queue: (() => void)[] = [];
  fx[slot]?.({
    ctx,
    u: 12,
    x: 400,
    y: 500,
    dir: 1,
    frame,
    total,
    t: frame / total,
    over: (paint: () => void) => queue.push(paint),
  } as unknown as FxContext);
  const under = ctx.calls.length;
  for (const paint of queue) paint();
  return { ctx, under, over: ctx.calls.length - under };
}

/** Everything an effect painted this frame, wherever it painted it. */
function fxCalls(slot: MoveSlot, frame: number): number {
  return fxAt(slot, frame).ctx.calls.length;
}

describe("the specials paint what the rig cannot", () => {
  it("puts a bow in his hands until the arrow is away, and nothing after", () => {
    const spawn = link.moves.neutralB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(fxCalls("neutralB", spawn - 4), "no bow while drawing").toBeGreaterThan(4);
    expect(fxCalls("neutralB", spawn + 12), "bow still drawn after the shot").toBe(0);
  });

  it("holds the boomerang until the frame it is thrown", () => {
    const spawn = link.moves.sideB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(fxCalls("sideB", spawn - 6)).toBeGreaterThan(4);
    expect(fxCalls("sideB", spawn + 2), "two boomerangs at once").toBe(0);
  });

  it("runs the Spin Attack ring for exactly the frames the hitbox is live", () => {
    const boxes = link.moves.upB?.hitboxes ?? [];
    const first = Math.min(...boxes.map((h) => h.startFrame));
    const last = Math.max(...boxes.map((h) => h.endFrame));
    expect(fxCalls("upB", first - 2), "ring before the hitbox").toBe(0);
    expect(fxCalls("upB", first + 1)).toBeGreaterThan(4);
    expect(fxCalls("upB", last)).toBeGreaterThan(4);
    expect(fxCalls("upB", last + 20), "ring outliving the hitbox").toBe(0);
  });

  it("fires the Sheikah rune as the bomb appears", () => {
    const spawn = link.moves.downB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(fxCalls("downB", spawn - 3)).toBeGreaterThan(2);
    expect(fxCalls("downB", spawn)).toBeGreaterThan(4);
    expect(fxCalls("downB", spawn + 20)).toBe(0);
  });
});

/**
 * The vertical extent of everything an effect drew, in pixels.
 *
 * Every path command that carries a `y` — `moveTo`, `lineTo`, `arc`, `rect` —
 * contributes, and `arc` contributes its centre plus and minus its radius.
 * Crude, and enough for the only question being asked: is the graphic big
 * enough that a player can see it.
 */
function paintedHeight(ctx: MockContext): number {
  const ys: number[] = [];
  for (const c of ctx.calls) {
    const a = c.args.map(Number);
    if (c.method === "moveTo" || c.method === "lineTo") ys.push(a[1]);
    else if (c.method === "quadraticCurveTo") ys.push(a[1], a[3]);
    else if (c.method === "arc") ys.push(a[1] - a[2], a[1] + a[2]);
    else if (c.method === "rect" || c.method === "fillRect") ys.push(a[1], a[1] + a[3]);
  }
  return ys.length === 0 ? 0 : Math.max(...ys) - Math.min(...ys);
}

describe("the props a player has to see", () => {
  // `u` in `fxAt` is 12 pixels to the world unit, and Link is a shade over 14
  // world units tall — so his whole body is about 170 pixels there.
  const BODY = 14.2 * 12;

  it("draws the bow at the size a bow is", () => {
    // The failure this catches is the one the Master Sword had before it was
    // widened, in a different place: a graphic that is *correct* and too small
    // to see. Ultimate's Traveler's Bow is 0.83 of Link's height tip to tip.
    // The first version of this effect drew a 6.2-unit arc — 0.44 — and at
    // match scale it read as a gold hair beside his fist.
    const spawn = link.moves.neutralB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(paintedHeight(fxAt("neutralB", spawn - 6).ctx)).toBeGreaterThan(BODY * 0.6);
  });

  it("draws the boomerang at the size a boomerang is", () => {
    // Measured off the exported model: 0.59 of his height tip to tip, which is
    // most of the reason it is a threat you can see coming.
    const spawn = link.moves.sideB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(paintedHeight(fxAt("sideB", spawn - 8).ctx)).toBeGreaterThan(BODY * 0.45);
  });

  it("paints the parts a body would swallow in front of the fighter", () => {
    // A held graphic drawn under the figure is a graphic inside his outline —
    // which is not drawn at all. The bow's string and the back half of its
    // arrow live between his fist and his cheek; the boomerang's whole wind-up
    // is behind his shoulder. Two rounds of captures had one of each missing
    // before `over` existed, and this is the assertion that says it is still
    // being used.
    for (const [slot, frame] of [
      ["neutralB", 8],
      ["sideB", 12],
    ] as const) {
      expect(
        fxAt(slot, frame).over,
        `${slot} defers nothing to the over layer`,
      ).toBeGreaterThan(4);
    }
  });

  it("still leaves the bow itself under his fist", () => {
    // The other half of the same decision, and the one a wholesale move to
    // `over` breaks: the limbs and the grip are at arm's length in front of him
    // where nothing occludes them, and his hand should close *over* the grip.
    // Deferring all of it paints the bow on top of the hand holding it — and
    // makes `specialFx.test.ts`, which asks every effect to paint something
    // under the figure, go red for reasons nobody would connect to this.
    expect(fxAt("neutralB", 8).under).toBeGreaterThan(4);
  });

  it("draws the Master Sword after the cap", () => {
    // Props in one layer paint in array order, and the cap is a five-unit green
    // wedge hung off the head covering most of the space above and behind the
    // shoulder — which is exactly where the blade goes in the standing pose, in
    // the whole of the forward smash's wind-up, and in the up smash. With the
    // sword first, all of those drew the blade and then painted the cap over
    // it. Nothing throws; the wind-up simply has no sword in it.
    const order = rig.props.map((p) => (p.bone === "handR" ? "sword" : p.kind));
    expect(order.indexOf("sword")).toBeGreaterThan(order.indexOf("capPointed"));
  });
});

describe("the second slash is available and the animation says so", () => {
  // Ultimate's forward smash is two inputs: hit one on frames 17-18, and if
  // attack is pressed again on frames 22-36 a one-handed outward slash follows.
  // The engine simulates only the first, so the animation must not invent a
  // hitbox — what it can do is hold the shape the second one fires from, which
  // in the real move is the blade dragged back and low behind him, in a lunge
  // he does not come out of until frame 37. That retraction *is* hit two's
  // wind-up, and a recovery that instead lowers the sword to the carry says the
  // move is over when it is not.
  const WINDOW = [22, 25, 29, 33, 36];
  const clip = clipOf("fsmash");
  const strike = clip.strike as number;
  const at = (frame: number) => bladeAngle(clip, clipTimeOf("fsmash", actionFrameOf(frame), strike));

  it("has no second hitbox to be wrong about", () => {
    const starts = new Set((link.moves.fsmash?.hitboxes ?? []).map((h) => h.startFrame));
    expect([...starts]).toEqual([17]);
  });

  it("holds the blade back and low for every frame of the input window", () => {
    for (const frame of WINDOW) {
      const a = at(frame);
      // Direction is `(sin, cos)` with +x forward and +y up.
      expect(Math.sin(a), `frame ${frame}: blade is not behind him`).toBeLessThan(0);
      expect(Math.cos(a), `frame ${frame}: blade is not low`).toBeLessThan(0);
    }
  });

  it("keeps it alive across the window without swinging it", () => {
    const from = clipTimeOf("fsmash", actionFrameOf(22), strike);
    const to = clipTimeOf("fsmash", actionFrameOf(36), strike);
    const travelled = bladePath(clip, from, to);
    // 13.6 degrees as authored, against about 5 for three identical keys — a
    // degree a frame, which at the end of a four-and-a-half-unit blade is a
    // unit and a half of tip travel across the window. Held, not stopped.
    expect(travelled, "the window is a frozen frame").toBeGreaterThan(8);
    expect(travelled, "the window swings the sword the engine has no hitbox for").toBeLessThan(70);
  });

  it("lowers it again once the window has closed", () => {
    // Nobody pressed: the blade comes back up to where standing carries it,
    // which is the tell that the follow-up is gone. Read at 44 rather than at
    // the last frame — by 49 the clip is almost entirely the terminator, so a
    // recovery that stayed loaded all the way through would still test clean
    // purely because `STAND` is where it converges.
    expect(Math.cos(at(36)), "still loaded at the end of the window").toBeLessThan(0);
    expect(Math.cos(at(44)), "never comes out of the hold").toBeGreaterThan(0.15);
  });

  it("parks a charging smash on a key that was authored for it", () => {
    // `poseTimeFor` freezes a held smash at `strike × 0.55` for as long as the
    // button is down, which makes that one frame the most-looked-at frame of
    // the move. Landing it *between* keys means the charge pose is whatever two
    // shapes happen to average out to.
    const parked = strike * 0.55;
    const nearest = Math.min(...clip.keys.map((k) => Math.abs(k.t - parked)));
    expect(nearest, `no key at t=${parked}`).toBeLessThan(0.005);
  });
});

describe("the projectiles are his own", () => {
  const launched = new Set(
    Object.values(link.moves).flatMap((m) => (m?.projectiles ?? []).map((p) => p.id)),
  );

  it("paints every projectile Link actually launches", () => {
    expect([...launched].sort()).toEqual(Object.keys(projectiles).sort());
  });

  it("draws something for each of them, at any age", () => {
    for (const [id, paint] of Object.entries(projectiles)) {
      for (const age of [0, 40, 1790]) {
        const ctx = createMockContext();
        paint({
          ctx,
          u: 12,
          age,
          dir: 1,
          heading: 0.3,
          charge: 1.4,
          returning: age > 40,
          frame: age,
        } as unknown as ProjectileContext);
        expect(ctx.calls.length, `${id} at age ${age} draws nothing`).toBeGreaterThan(3);
      }
    }
  });

  it("scales the arrow with its charge, because the charge is the move", () => {
    const reach = (charge: number) => {
      const ctx = createMockContext();
      projectiles.arrow({
        ctx, u: 12, age: 5, dir: 1, heading: 0, charge, returning: false, frame: 5,
      } as unknown as ProjectileContext);
      const xs = ctx.calls
        .filter((c) => c.method === "lineTo" || c.method === "moveTo")
        .map((c) => Math.abs(Number(c.args[0])));
      return Math.max(...xs);
    };
    expect(reach(1.6)).toBeGreaterThan(reach(1) * 1.2);
  });

  it("gives the arrow a hitbox worth the size it is drawn at", () => {
    // Not a drawing property: a sanity check that the graphic and the thing it
    // stands for are the same order of magnitude.
    const radius = toFloat(link.moves.neutralB?.projectiles?.[0]?.hitbox.radius ?? 0);
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThan(6);
  });
});
