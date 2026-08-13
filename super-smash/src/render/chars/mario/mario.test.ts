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
import type { BoneName, PoseAngles } from "../../skeleton";
import type { MoveSlot } from "@/engine/types";
import { mario } from "@/fighters/mario";
import type { PoseName } from "../../poses/library";
import { poses } from "./poses";
import { rig } from "./rig";
import { fx, projectiles } from "./fx";
import { assignmentsTo, countOf, createMockContext, type MockContext } from "../../mockContext";

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

/**
 * The overrides that are attacks.
 *
 * Everything below about `strike`, held extension and multi-key recovery is a
 * property of a *swing*, and Mario also overrides `idle`, which is a looping
 * breath with no contact frame and no recovery at all. Filtering by `SLOT`
 * rather than asserting over every override is what lets a non-attack clip
 * exist here without either weakening the attack rules or being exempted by
 * name — add another and it is simply not an attack.
 */
const attacks = named.filter((n) => SLOT[n] !== undefined);

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
  /*
   * The non-attack overrides are named, not inferred. `SLOT` is the mapping the
   * rest of this file filters on, so a clip missing from both tables would be
   * silently exempt from every rule below — which is the failure mode this
   * check exists to close. An attack added to `poses` and forgotten in `SLOT`
   * fails here rather than quietly skipping the timing assertions.
   */
  const NOT_ATTACKS: readonly PoseName[] = ["idle"];

  it("maps each override to a slot, or declares it as not an attack", () => {
    for (const name of named) {
      if (NOT_ATTACKS.includes(name)) continue;
      expect(SLOT[name], `no slot for ${name}`).toBeDefined();
    }
  });

  it("names a move on the roster", () => {
    for (const name of attacks) {
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
    for (const name of attacks) {
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
    for (const name of attacks) {
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
    for (const name of attacks) {
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

/* ------------------------------------------------------------------ idle -- */

/**
 * Where a bone's far end sits, in rig units relative to its chain's root.
 *
 * Angles are parent-relative and accumulate, and a pose only names the bones it
 * moves — everything else keeps its rest angle — so walking the chain by hand
 * is the only way to ask "where did the glove actually end up". `+x` is
 * forward, `+y` is up.
 */
function tipOf(pose: PoseAngles, chain: readonly BoneName[]): { x: number; y: number } {
  let a = 0;
  let x = 0;
  let y = 0;
  for (const bone of chain) {
    a += pose[bone] ?? rig.bones[bone].angle;
    x += rig.bones[bone].length * Math.sin(a);
    y += rig.bones[bone].length * Math.cos(a);
  }
  return { x, y };
}

const ARM_R = ["hip", "torso", "upperArmR", "forearmR", "handR"] as const;
const ARM_L = ["hip", "torso", "upperArmL", "forearmL", "handL"] as const;
const LEG_R = ["hip", "thighR", "shinR"] as const;
const LEG_L = ["hip", "thighL", "shinL"] as const;

/** How far the ankle hangs below the pelvis, which is what plants a foot. */
function ankleDrop(pose: PoseAngles, leg: readonly BoneName[]): number {
  // The torso's contribution has to come out: the legs hang off `hip`, and
  // `tipOf` above walks whatever chain it is given from the same origin.
  const hip = pose.hip ?? rig.bones.hip.angle;
  let a = hip;
  let y = 0;
  for (const bone of leg.slice(1)) {
    a += pose[bone] ?? rig.bones[bone].angle;
    y += rig.bones[bone].length * Math.cos(a);
  }
  return -y;
}

describe("the stand is Mario's own", () => {
  const idle = poses.idle!;

  it("overrides the shared clip and keeps its four-key breath", () => {
    expect(idle, "mario no longer authors his own idle").toBeDefined();
    expect(idle.loop).toBe(true);
    // Two keys can only give a rise and a fall with everything arriving
    // together, which the eye reads as a metronome at any amplitude.
    expect(idle.keys.length, "a two-key stand is a metronome").toBeGreaterThanOrEqual(4);
    // The reference derives ~24 frames from a two-second capture holding five
    // cycles. The shared clip's 108 is three times too slow for Mario.
    expect(idle.period).toBeLessThan(40);
  });

  /*
   * The one that matters most. Mario's three colours are red, blue and white,
   * and with the arms hanging at his sides both gloves are buried against the
   * dungarees — the silhouette becomes a red-and-blue column with a face on it.
   * The reference has both hands as closed fists carried in front of the chest
   * with the elbows flexed 80–100°, and that is what puts the white back in
   * the silhouette. Straightening either arm back out is invisible in a diff
   * and obvious on screen.
   */
  it("carries both fists forward of the shoulders, not hanging at the hips", () => {
    for (const [i, key] of idle.keys.entries()) {
      for (const [name, chain] of [["near", ARM_R], ["far", ARM_L]] as const) {
        const hand = tipOf(key.pose, chain);
        const shoulder = tipOf(key.pose, ["hip", "torso"] as const);
        expect(
          hand.x - shoulder.x,
          `idle key ${i}: the ${name} glove is only ${(hand.x - shoulder.x).toFixed(2)} units ` +
            `forward of the shoulder — it is inside the body outline`,
        ).toBeGreaterThan(1.15);
      }
    }
  });

  /*
   * The pelvis sits at a fixed 3.6 units up the `root` strut whatever the legs
   * do, so `offsetY` is the only thing that lowers him and it takes the feet
   * with it. Every key therefore has to fold the legs by exactly as much as its
   * `offsetY` drops him, or the soles leave the stage on part of the cycle —
   * which is the failure this catches, and which is four pixels of daylight
   * under a fighter who is supposed to be standing still.
   */
  it("keeps both soles on the stage for the whole cycle", () => {
    const heights = idle.keys.flatMap((k) => {
      const y = k.offsetY ?? 0;
      return [
        rig.bones.root.length + y - ankleDrop(k.pose, LEG_R),
        rig.bones.root.length + y - ankleDrop(k.pose, LEG_L),
      ];
    });
    const spread = Math.max(...heights) - Math.min(...heights);
    expect(spread, `the ankles travel ${spread.toFixed(3)} units vertically across the cycle`).toBeLessThan(0.08);
  });

  /*
   * And the bounce itself. The reference measures a full-body bob of about 11%
   * of standing height — Mario is the springy one — against the shared clip's
   * 2%. It is carried by `scaleY` rather than `offsetY` precisely because
   * `scaleY` stretches about the feet and so cannot lift them; the number below
   * is what that buys at the head.
   */
  it("bounces", () => {
    const top = (k: (typeof idle.keys)[number]) => (k.offsetY ?? 0) + ((k.scaleY ?? 1) - 1) * 10.3;
    const hs = idle.keys.map(top);
    const travel = Math.max(...hs) - Math.min(...hs);
    expect(travel, `the head only travels ${travel.toFixed(2)} units a cycle`).toBeGreaterThan(0.6);
  });
});

/* ------------------------------------------------ the shapes of the moves -- */

/** The accumulated angle of a bone chain's last link, in degrees. */
function accumulated(pose: PoseAngles, chain: readonly BoneName[]): number {
  let a = 0;
  for (const bone of chain) a += pose[bone] ?? rig.bones[bone].angle;
  return (a * 180) / Math.PI;
}

describe("the three smashes keep the shape that names them", () => {
  /*
   * Up smash is a headbutt, and round one's version moved the accumulated head
   * angle 32° — which reads, correctly, as a man leaning back. The reference
   * has the crown travel from behind his heels at about knee height, up over
   * the top, to out in front of his toes: a 235° sweep. Nothing else about
   * this move is distinctive, so if the head stops travelling there is no move
   * left, and a keyframe edit that quietly shrinks it is invisible in a diff.
   */
  it("sweeps the up smash's head through more than half a turn", () => {
    const keys = poses.usmash!.keys;
    const angles = keys.map((k) => accumulated(k.pose, ["hip", "torso", "head"] as const));
    const travel = Math.max(...angles) - Math.min(...angles);
    expect(travel, `the head only covers ${travel.toFixed(0)}° across the clip`).toBeGreaterThan(180);
  });

  /*
   * Down smash is one continuous rotation with the body flat along the floor —
   * head behind and legs out front on frame 5, the exact mirror on frame 14.
   * Round one posed it as a man crouching and kicking twice, which is a
   * different move; `rotation` is what lays him down, and the two contacts have
   * to lie in *opposite* directions or it is a kick and a second kick rather
   * than a turn.
   */
  it("lays the down smash flat, and the two hits opposite ways", () => {
    const clip = poses.dsmash!;
    const strike = clip.strike as number;
    const first = clip.keys.find((k) => Math.abs(k.t - strike) < 1e-9)!;
    // The back sweep is whichever later key is laid out furthest — picking it
    // by `t` would catch the roll over the top instead, which is upright on
    // purpose and would make this test assert the opposite of the shape.
    const second = clip.keys
      .filter((k) => k.t > strike + 0.05)
      .reduce((best, k) => (Math.abs(k.rotation ?? 0) > Math.abs(best.rotation ?? 0) ? k : best));
    expect(Math.abs(first.rotation ?? 0), "the front sweep is not laid out flat").toBeGreaterThan(1.2);
    expect(Math.abs(second.rotation ?? 0), "the back sweep is not laid out flat").toBeGreaterThan(1.2);
    expect(
      Math.sign(first.rotation ?? 0) * Math.sign(second.rotation ?? 0),
      "both sweeps lie the same way round — that is two kicks, not one turn",
    ).toBe(-1);
  });

  /*
   * Forward smash ends *lower* than it charges. The reference is specific: he
   * leans back and lifts the front foot through the charge, then on frame 15
   * explodes into a lunge that puts his head below where it was two frames
   * earlier. A contact key that is level with the charge is a shove.
   */
  it("drops the forward smash's lunge below its charge", () => {
    const keys = poses.fsmash!.keys;
    const charge = keys[1];
    const contact = keys.find((k) => Math.abs(k.t - (poses.fsmash!.strike as number)) < 1e-9)!;
    expect(
      (contact.offsetY ?? 0),
      "the contact key is no lower than the charge — this is a shove, not a lunge",
    ).toBeLessThan((charge.offsetY ?? 0) - 0.6);
  });
});

/* -------------------------------------------------------------------- fx -- */

interface Painted {
  readonly ctx: MockContext;
  /** How many paints the effect deferred to after the figure is drawn. */
  readonly over: number;
  /** Index into `ctx.calls` where the deferred paints start. */
  readonly drainedAt: number;
}

/** Run one of Mario's effects at a frame and hand back what it painted. */
function paint(slot: MoveSlot, frame: number, opts: { total?: number; struckWith?: number | null } = {}): Painted {
  const ctx = createMockContext();
  const fn = fx[slot];
  if (!fn) throw new Error(`no effect for ${slot}`);
  const deferred: (() => void)[] = [];
  fn({
    ctx: ctx as unknown as CanvasRenderingContext2D,
    f: { facing: 1, charge: 0 } as never,
    def: mario as never,
    cam: { zoom: 12 } as never,
    height: 11,
    x: 900,
    y: 700,
    u: 12,
    frame,
    total: opts.total ?? mario.moves[slot]!.totalFrames,
    t: frame / (opts.total ?? mario.moves[slot]!.totalFrames),
    dir: 1,
    struckWith: opts.struckWith,
    over: (p) => deferred.push(p),
  });
  const count = deferred.length;
  const drainedAt = ctx.calls.length;
  for (const p of deferred) p();
  return { ctx, over: count, drainedAt };
}

/** Every hex colour the effect assigned to `fillStyle`, as [r, g, b]. */
function fills(ctx: MockContext): [number, number, number][] {
  return assignmentsTo(ctx, "fillStyle")
    .map(String)
    .filter((c) => /^#[0-9a-f]{6}$/i.test(c))
    .map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
}

/** Every point the effect put a path through, in screen space. */
function points(ctx: MockContext): { x: number; y: number }[] {
  return ctx.calls
    .filter((c) => c.method === "moveTo" || c.method === "lineTo")
    .map((c) => ({ x: Number(c.args[0]), y: Number(c.args[1]) }));
}

describe("the effects that have to be in front of him are", () => {
  /*
   * Effects paint *under* the fighter by default, and three of Mario's are
   * things his own body would otherwise bury: the cape sweeps across his chest,
   * the coins come out in front of him at head height, and F.L.U.D.D.'s nozzle
   * is held beside his face. All three were invisible or half-buried in round
   * one for exactly this reason. `over` is a one-word change to lose.
   */
  /**
   * Whether any call to `method` landed in the deferred half of the paint.
   *
   * Counting `over` callbacks is not enough: every one of these effects queues
   * more than one thing, so a cape that stopped deferring would still show a
   * non-zero count off the back of its own sparkles. The question is whether
   * *this shape* ended up in front.
   */
  const deferred = (p: Painted, method: string): boolean =>
    p.ctx.calls.findIndex((c, i) => i >= p.drainedAt && c.method === method) >= 0;

  it("defers the cape sheet", () => {
    // Frame 20: past the swoosh and the sparkles, so the only thing that can
    // put a path in the deferred half is the cloth itself.
    const p = paint("sideB", 20);
    expect(deferred(p, "lineTo"), "the cape sheet paints under the fighter").toBe(true);
  });

  it("defers the coins", () => {
    const p = paint("upB", 8, { struckWith: 0 });
    expect(deferred(p, "ellipse"), "the coins paint under the fighter").toBe(true);
  });

  it("defers F.L.U.D.D.'s nozzle but not its tank", () => {
    const p = paint("downB", 24);
    // Both are `roundRect`s; the tank belongs behind him and the nozzle in his
    // hands, so the split is the assertion.
    expect(deferred(p, "roundRect"), "the nozzle paints under the fighter").toBe(true);
    expect(
      p.ctx.calls.findIndex((c, i) => i < p.drainedAt && c.method === "roundRect") >= 0,
      "the tank paints in front of him — it is a backpack",
    ).toBe(true);
  });
});

describe("the cape is the cape", () => {
  /*
   * It is Cape-Feather yellow on both faces. Round one painted it deep red with
   * a yellow lining, reasoning from Mario's shirt — and a red sheet over a red
   * shirt is one shape, so the whole graphic vanished on exactly the three
   * frames the hitbox is live. Yellow is the only colour in this move that he
   * is not already wearing.
   */
  it("is yellow, and nowhere near the shirt", () => {
    const painted = fills(paint("sideB", 13).ctx);
    expect(painted.length, "the cape paints no flat colour at all").toBeGreaterThan(0);
    expect(
      painted.some(([r, g, b]) => r > 180 && g > 130 && b < 110 && r - b > 110),
      "nothing the cape paints is yellow",
    ).toBe(true);
    // #E52521, the shirt.
    for (const [r, g, b] of painted) {
      const near = Math.abs(r - 0xe5) < 44 && Math.abs(g - 0x25) < 44 && Math.abs(b - 0x21) < 44;
      expect(near, `the cape paints ${r},${g},${b}, which is the shirt's own red`).toBe(false);
    }
  });

  /*
   * And it stays at chest height. Both damage hitboxes and the reflector sit at
   * y ≈ 6.5–6.7 — a shade under half his height — and the reference is explicit
   * that the sweep never goes over his head. Swinging it over the top is both
   * the wrong move (that is Marth's cape) and a fight with the port tag, which
   * `over` still lands underneath.
   */
  it("never sweeps above his head", () => {
    const feet = 700;
    const u = 12;
    // The cap tops out a little over eleven units up; give it twelve.
    const ceiling = feet - u * 12;
    for (const frame of [6, 9, 12, 14, 18, 24]) {
      for (const p of points(paint("sideB", frame).ctx)) {
        expect(
          p.y,
          `on frame ${frame} the cape reaches ${((feet - p.y) / u).toFixed(1)} units up — over his head`,
        ).toBeGreaterThan(ceiling);
      }
    }
  });
});

describe("the coins are a hit effect, not a timeline", () => {
  /*
   * Every Super Jump Punch hitbox carries the `coin` collision attribute: the
   * coins *are* what the hit spawns, out of the victim, at the point of
   * contact. SmashWiki is blunt about it — "if the attack strikes an enemy
   * during the jump, coins fly out of the enemy" — so a Super Jump Punch that
   * hits nothing produces none at all, and a player who sees coins knows the
   * move connected.
   *
   * `struckWith` is exactly that distinction: a number once a box has won,
   * `null` while the simulation is watching and nothing has landed, `undefined`
   * in the animation lab where there is no match to ask. Painting on `null`
   * would put coins on every whiffed recovery in the game.
   */
  it("paints nothing on a swing that has not connected", () => {
    for (const frame of [4, 8, 12, 18]) {
      const { ctx } = paint("upB", frame, { struckWith: null });
      expect(countOf(ctx, "fill"), `frame ${frame} paints coins on a whiff`).toBe(0);
    }
  });

  it("paints them once it has", () => {
    expect(countOf(paint("upB", 8, { struckWith: 0 }).ctx, "fill")).toBeGreaterThan(0);
    // And in the lab, where nobody supplied the cosmetic state at all.
    expect(countOf(paint("upB", 8, { struckWith: undefined }).ctx, "fill")).toBeGreaterThan(0);
  });
});

describe("F.L.U.D.D. is water, on the frame the brace happens", () => {
  /*
   * The move has no hitbox, so `strike` is a literal fraction of its 48 frames
   * rather than a hint, and it has to be the same frame `fx.ts` opens the water
   * on. They were 0.46 and 0.52 for a while and the brace arrived six frames
   * before the water, which reads as a flinch. The reference puts the first
   * pump on frame 21.
   */
  it("braces and fires on the same frame", () => {
    const total = mario.moves.downB!.totalFrames;
    const braceFrame = Math.round((poses.downB!.strike as number) * total);
    expect(braceFrame).toBe(21);
    const before = countOf(paint("downB", braceFrame - 2).ctx, "fill");
    const after = countOf(paint("downB", braceFrame + 1).ctx, "fill");
    expect(after, "no more is painted once the water is meant to be out").toBeGreaterThan(before);
  });

  /*
   * Seven discrete pumps on a five-frame cadence, each living twelve frames, so
   * at most three are ever in the air. Round one drew a translucent cone, which
   * reads as a beam attack — and F.L.U.D.D. deals **no damage at all**. A
   * player who learns to respect a beam loses stocks to that lie.
   */
  it("throws globs rather than a jet", () => {
    const globs = (frame: number) =>
      countOf(paint("downB", frame).ctx, "ellipse") / 2; // body and highlight per glob
    expect(globs(21), "nothing comes out on the first firing frame").toBeGreaterThan(0);
    for (const frame of [21, 26, 31, 36, 41]) {
      expect(globs(frame), `frame ${frame} has more than three globs in the air`).toBeLessThanOrEqual(3);
    }
  });
});
