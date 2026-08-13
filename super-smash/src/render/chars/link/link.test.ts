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
import type { PoseName } from "../../poses/library";
import { BASE_RIG, type BoneName } from "../../skeleton";
import { assignmentsTo, createMockContext, type MockContext } from "../../mockContext";
import type { Brush } from "../../rigKit";
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
const BLADE_CHAIN: readonly BoneName[] = ["torso", "upperArmR", "forearmR", "handR"];

function bladeAngle(clip: PoseClip, t: number): number {
  const sample = samplePose(clip, t);
  let total = 0;
  for (const bone of BLADE_CHAIN) total += sample.angles[bone] ?? BASE_RIG[bone].angle;
  return total;
}

const DEG = 180 / Math.PI;

/** Total distance the blade travels across one play, in degrees. */
function bladePath(clip: PoseClip, steps = 240): number {
  let total = 0;
  let prev = bladeAngle(clip, 0);
  for (let i = 1; i <= steps; i++) {
    const cur = bladeAngle(clip, i / steps);
    total += Math.abs(angleDelta(prev, cur));
    prev = cur;
  }
  return total * DEG;
}

function travel(clip: PoseClip, from: number, to: number): number {
  return Math.abs(angleDelta(bladeAngle(clip, from), bladeAngle(clip, to))) * DEG;
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
      expect(travel(clip, 0, strike as number), `${name}: wind-up to contact`).toBeGreaterThan(80);
    }
  });

  it("is still moving on the frames around the contact", () => {
    // The specific shape of the reported bug: a clip can travel a long way in
    // total and still arrive at full extension early and sit there, which reads
    // as a fighter holding a sword out rather than as a hit.
    for (const name of SWORD_MOVES) {
      const clip = clipOf(name);
      const strike = clip.strike as number;
      expect(travel(clip, Math.max(0, strike - 0.12), strike), `${name}: approach`).toBeGreaterThan(30);
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

describe("no clip is a photograph", () => {
  it("moves some bone a long way in every clip", () => {
    for (const [name, clip] of Object.entries(poses) as [PoseName, PoseClip][]) {
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
    for (const [name, clip] of Object.entries(poses) as [PoseName, PoseClip][]) {
      const after = clip.keys.filter((k) => k.t > (clip.strike ?? 0) && k.t < 1);
      expect(after.length, `${name} has nothing drawn after its contact`).toBeGreaterThan(0);
      expect(clip.keys[clip.keys.length - 1].t, `${name} has no terminator`).toBe(1);
    }
  });

  it("names the contact key at exactly the t it declares", () => {
    for (const [name, clip] of Object.entries(poses) as [PoseName, PoseClip][]) {
      if (clip.strike === undefined) continue;
      expect(
        clip.keys.some((k) => k.t === clip.strike),
        `${name} declares strike ${clip.strike} and has no key there`,
      ).toBe(true);
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
    expect(custom.length, "the sword, shield and quiver are all custom").toBe(3);

    for (const prop of custom) {
      for (const mode of ["rim", "body"] as const) {
        const ctx = createMockContext();
        const filled: string[] = [];
        prop.draw?.(brushFor(ctx, mode, filled), prop);
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

function fxAt(slot: MoveSlot, frame: number): MockContext {
  const ctx = createMockContext();
  const total = link.moves[slot]?.totalFrames ?? 1;
  fx[slot]?.({
    ctx,
    u: 12,
    x: 400,
    y: 500,
    dir: 1,
    frame,
    total,
    t: frame / total,
  } as unknown as FxContext);
  return ctx;
}

describe("the specials paint what the rig cannot", () => {
  it("puts a bow in his hands until the arrow is away, and nothing after", () => {
    const spawn = link.moves.neutralB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(fxAt("neutralB", spawn - 4).calls.length, "no bow while drawing").toBeGreaterThan(4);
    expect(fxAt("neutralB", spawn + 12).calls.length, "bow still drawn after the shot").toBe(0);
  });

  it("holds the boomerang until the frame it is thrown", () => {
    const spawn = link.moves.sideB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(fxAt("sideB", spawn - 6).calls.length).toBeGreaterThan(4);
    expect(fxAt("sideB", spawn + 2).calls.length, "two boomerangs at once").toBe(0);
  });

  it("runs the Spin Attack ring for exactly the frames the hitbox is live", () => {
    const boxes = link.moves.upB?.hitboxes ?? [];
    const first = Math.min(...boxes.map((h) => h.startFrame));
    const last = Math.max(...boxes.map((h) => h.endFrame));
    expect(fxAt("upB", first - 2).calls.length, "ring before the hitbox").toBe(0);
    expect(fxAt("upB", first + 1).calls.length).toBeGreaterThan(4);
    expect(fxAt("upB", last).calls.length).toBeGreaterThan(4);
    expect(fxAt("upB", last + 20).calls.length, "ring outliving the hitbox").toBe(0);
  });

  it("fires the Sheikah rune as the bomb appears", () => {
    const spawn = link.moves.downB?.projectiles?.[0]?.spawnFrame ?? 0;
    expect(fxAt("downB", spawn - 3).calls.length).toBeGreaterThan(2);
    expect(fxAt("downB", spawn).calls.length).toBeGreaterThan(4);
    expect(fxAt("downB", spawn + 20).calls.length).toBe(0);
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
