/**
 * The things about Mario's art that are silently wrong when they break.
 *
 * `chars.test.ts` already checks that the override tables are *reached* — that
 * the rig is not the fallback, that every effect names a real move, that the
 * sampler hands back this fighter's clip. None of that says the clip is any
 * good, and the four failures below are all invisible: the fighter goes on
 * looking plausible and slightly wrong, which is the hardest kind of bug to
 * see and the reason this file exists.
 */

import { describe, expect, it } from "vitest";
import { actionFrameOf } from "@/engine/hitbox";
import { deg } from "../../skeleton";
import type { BoneName } from "../../skeleton";
import type { MoveSlot } from "@/engine/types";
import { mario } from "@/fighters/mario";
import type { PoseName } from "../../poses/library";
import { poses } from "./poses";
import { rig } from "./rig";
import { fx, projectiles } from "./fx";

/** Which move each override animates. Every entry in `poses` needs one. */
const SLOT: Partial<Record<PoseName, MoveSlot>> = {
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
};

const named = Object.keys(poses) as PoseName[];

/** The active window in `actionFrame` terms, or null for a move with none. */
function window(slot: MoveSlot): { first: number; last: number; total: number } | null {
  const move = mario.moves[slot];
  if (!move || move.hitboxes.length === 0) return null;
  return {
    first: actionFrameOf(Math.min(...move.hitboxes.map((h) => h.startFrame))),
    last: actionFrameOf(Math.max(...move.hitboxes.map((h) => h.endFrame))),
    total: move.totalFrames,
  };
}

/** `poseTimeFor`'s two-piece map, for a frame past the contact. */
function clipTime(strike: number, f: number, first: number, total: number): number {
  if (f <= first) return (strike * f) / first;
  return Math.min(1, strike + ((1 - strike) * (f - first)) / (total - first));
}

describe("every clip animates a move Mario actually has", () => {
  it("maps each override to a slot", () => {
    for (const name of named) expect(SLOT[name], `no slot for ${name}`).toBeDefined();
  });

  it("names a move on the roster", () => {
    for (const name of named) {
      expect(mario.moves[SLOT[name] as MoveSlot], `${name}: mario has no such move`).toBeDefined();
    }
  });
});

describe("the contact frame is a drawn key", () => {
  /*
   * `strike` is only meaningful if there is a key exactly there — `poseTimeFor`
   * puts clip time `strike` on the frame the hitbox goes live, and if no key
   * sits at that `t` the fighter is at whatever the two neighbouring keys blend
   * to, which is never full extension.
   */
  it("has a key at every declared strike", () => {
    for (const name of named) {
      const clip = poses[name]!;
      expect(clip.strike, `${name} declares no strike`).toBeDefined();
      const at = clip.keys.findIndex((k) => Math.abs(k.t - (clip.strike as number)) < 1e-9);
      expect(at, `${name} declares strike ${clip.strike} but has no key there`).toBeGreaterThan(0);
      // The wind-up accelerates into it rather than easing to a halt.
      expect(clip.keys[at - 1].ease, `${name} eases into its contact`).toBe("in");
    }
  });
});

describe("the extension survives the whole active window", () => {
  /*
   * The failure this catches is the one that cost the most here. `ease: "out"`
   * is a cubic, so two frames past the contact key a clip is already a third of
   * the way to the next one — a hitbox live for five frames gets one frame of
   * full extension and four of a fighter visibly putting the move away. Every
   * attack therefore carries a second key at or past the end of its active
   * window. Deleting one is invisible in a still and obvious in motion, which
   * is exactly the sort of thing a test has to hold.
   */
  it("keys at least one frame at or beyond the last live frame", () => {
    for (const name of named) {
      const w = window(SLOT[name] as MoveSlot);
      if (!w || w.last <= w.first) continue;
      const clip = poses[name]!;
      const strike = clip.strike as number;
      const tLast = clipTime(strike, w.last, w.first, w.total);
      const held = clip.keys.filter((k) => k.t > strike + 1e-9 && k.t <= tLast + 0.03);
      expect(
        held.length,
        `${name}: nothing keyed between the contact (t=${strike}) and the end of the ` +
          `active window (t=${tLast.toFixed(3)}, frame ${w.last}) — the extension will ` +
          `have decayed before the hitbox is gone`,
      ).toBeGreaterThan(0);
    }
  });

  /*
   * And the tail. Mario's forward air is 59 frames and connects on 16; a single
   * span from the follow-through to a terminator at t = 1 crosses the remaining
   * 43 frames at well under a degree a frame, which reads as a freeze.
   */
  it("keys the recovery more than once", () => {
    for (const name of named) {
      const clip = poses[name]!;
      const strike = clip.strike as number;
      const after = clip.keys.filter((k) => k.t > strike + 0.08);
      expect(after.length, `${name} has a one-span recovery`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("both feet point forwards", () => {
  /*
   * Bone angles accumulate down the chain and the legs are *not* individually
   * mirrored — the whole rig is, once, at draw time. So `footR` rests at −88°,
   * the same as `footL`, and a pose naming `footL: -84, footR: 84` gives one
   * foot pointing backwards. Three people have shipped that; this is what stops
   * a fourth.
   */
  it("never poses the ankles as exact opposites", () => {
    for (const name of named) {
      for (const [i, key] of poses[name]!.keys.entries()) {
        const l = key.pose.footL;
        const r = key.pose.footR;
        if (l === undefined || r === undefined) continue;
        const mirrored = Math.abs(l + r) < deg(12) && Math.abs(l) > deg(55) && Math.abs(r) > deg(55);
        expect(mirrored, `${name} key ${i}: footL ${l} and footR ${r} are mirrored`).toBe(false);
      }
    }
  });
});

describe("the moves with no hitbox are timed off their own event", () => {
  /*
   * Fireball and F.L.U.D.D. have empty `hitboxes` arrays, deliberately — one is
   * all projectile, the other does no damage at all. `moveTimingFor` therefore
   * finds no `firstActive`, the strike remap never engages, and the clip runs
   * linearly across the move. Which means `strike` is not a hint here, it is a
   * literal fraction, and Fireball's has to be the frame the ball appears:
   * `spawnFrame` is compared against `moveFrameOf(actionFrame)`, so frame 17 is
   * actionFrame 16.
   */
  it("releases the fireball on the frame it spawns", () => {
    const move = mario.moves.neutralB!;
    expect(move.hitboxes).toHaveLength(0);
    const spawn = move.projectiles![0].spawnFrame;
    expect(poses.neutralB!.strike).toBeCloseTo(actionFrameOf(spawn) / move.totalFrames, 2);
  });

  it("leaves F.L.U.D.D. without a hitbox", () => {
    expect(mario.moves.downB!.hitboxes).toHaveLength(0);
  });
});

describe("the rig paints what it declares", () => {
  it("gives every custom prop a painter", () => {
    for (const p of rig.props) {
      if (p.kind === "custom") expect(p.draw, `custom prop on ${p.bone} has no draw`).toBeTypeOf("function");
    }
  });

  /*
   * The cap, the nose, the hair and the dungarees are all `custom` because the
   * shared shapes cannot make this face: the shared `cap` is a semicircle twice
   * as wide as it is tall and reads as a bowl on a round head, and the shared
   * `nose` is a plain ellipse in the palette's own skin colour, which on a
   * skin-coloured head is invisible. If someone puts them back, the fighter
   * stops being recognisable and nothing else complains.
   */
  it("keeps the four props the face is made of", () => {
    expect(rig.props.filter((p) => p.kind === "custom")).toHaveLength(4);
    expect(rig.props.some((p) => p.kind === "moustache")).toBe(true);
    expect(rig.props.some((p) => p.kind === "face")).toBe(true);
  });

  /*
   * Gloves and shoes are literal hex, not palette roles: they stay white and
   * brown in every costume, where the shirt and dungarees do not. Writing them
   * as `accent` would make Wario-yellow Mario wear yellow gloves.
   */
  it("keeps the gloves and shoes off the costume palette", () => {
    for (const bone of ["handL", "handR", "footL", "footR"] as BoneName[]) {
      expect(rig.boneColour[bone]?.startsWith("#"), `${bone} follows the costume`).toBe(true);
    }
  });
});

describe("the effects cover the moves that need them", () => {
  it("paints the fire, the cape, the coins, the water and the sweep", () => {
    for (const slot of ["fsmash", "dsmash", "neutralB", "sideB", "upB", "downB"] as MoveSlot[]) {
      expect(fx[slot], `${slot} paints nothing`).toBeTypeOf("function");
    }
  });

  /*
   * Keyed by the projectile's def id, not by the move that threw it — a typo
   * here is silent and the symptom is a fireball drawn by the shared "fire"
   * fallback, which is a generic orange blob and not this one.
   */
  it("paints the fireball under the id the roster launches it with", () => {
    const launched = new Set(
      Object.values(mario.moves).flatMap((m) => (m?.projectiles ?? []).map((p) => p.id)),
    );
    for (const id of Object.keys(projectiles)) expect(launched.has(id), `no projectile ${id}`).toBe(true);
    expect(projectiles.fireball).toBeTypeOf("function");
  });
});
