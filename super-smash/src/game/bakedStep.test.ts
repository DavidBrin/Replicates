import { describe, expect, it } from "vitest";

import { ATTACK, clearAll, frame } from "@/engine/acmd/dsl";
import { bakedEcb, fighterHurtboxes, localHurtboxes, restEcb } from "@/engine/acmd/hurtboxes";
import { LEDGE_GRAB_RANGE_X } from "@/engine/constants";
import { ONE, fx, mul, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { capsulesOverlap, contactPoint, deepestReach, hurtboxCapsule, pointSegmentDistSq, type Capsule } from "@/engine/hitbox";
import { kineticLaunch } from "@/engine/kinetic";
import { HARD_PLATFORM_DEPTH } from "@/engine/physics";
import { cloneState, createInitialState, step, type SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterDef, FighterState, GameState, InputFrame, MatchRules, StageDef, StepEvents } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { readBakeFromDisk } from "./bakeNode";

/**
 * `step()` in the baked world (Plan 4, Task 12): hits meet the bones' per-bone
 * hurtboxes, the stage and the ledges meet the bones' ECB, a held fighter is
 * placed by the bones' widths, and a rollback across a change of shape replays
 * to the same hash. Each behaviour is shown against the same frame without the
 * bake, where Plan 2's single capsule and box still answer.
 *
 * Roster fighters on a flat stage of our own (floor at y 0, walls at x ±80,
 * `HARD_PLATFORM_DEPTH` deep), and a hand-built swinger: Mario's attributes
 * with one jab, a sphere on the root bone wherever a test puts it.
 */

const BAKE = readBakeFromDisk();
const ROSTER = new Map(FIGHTERS.map((d) => [d.id, d]));
const roster = (id: string): FighterDef => ROSTER.get(id)!;

const FLAT: StageDef = {
  id: "flat",
  name: "Flat",
  series: "test",
  platforms: [{ x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true }],
  blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
  spawns: [
    { x: fx(-40), y: 0 },
    { x: fx(40), y: 0 },
  ],
  theme: "test",
};
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

/**
 * A jab that is one sphere of `radius` at (`forward`, `up`) from the swinger's
 * feet — or, given `far`, the capsule from `forward` to `far` at that height —
 * live on its frame 4 alone: the body it meets moves (an idle breathes), so a
 * test places the box against the body on that one frame.
 */
function swinger(forward: number, up: number, radius: number, far?: number): FighterDef {
  const box = ATTACK({
    id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: toFloat(radius), x: 0, y: toFloat(up), z: toFloat(forward),
    ...(far === undefined ? {} : { z2: toFloat(far) }),
  });
  return {
    ...roster("mario"),
    id: "swinger",
    scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands: [frame(4), box, frame(5), clearAll()] } },
  };
}

/** The flat stage and the roster (plus `extra`), with the bake or without it. */
function world(baked: boolean, extra?: FighterDef): SimContext {
  const base: SimContext = {
    fighter: (id) => (extra !== undefined && id === extra.id ? extra : roster(id)),
    stage: () => FLAT,
  };
  return baked ? { ...base, bones: BAKE.bones, bake: BAKE } : base;
}

/** Two fighters standing on the floor, port 0 at x `a` facing right and port 1 at `b` facing left. */
function pair(ids: readonly [string, string], a: number, b: number, ctx: SimContext): GameState {
  const s = createInitialState("flat", ids.map((defId) => ({ defId })), RULES, 12345, ctx);
  s.fighters.forEach((f, i) => {
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0, invincible: 0 });
    f.x = i === 0 ? a : b;
    f.facing = i === 0 ? 1 : -1;
  });
  return s;
}

interface Frame {
  readonly state: GameState;
  readonly events: StepEvents;
}

function play(s: GameState, n: number, inputs: (i: number) => readonly InputFrame[], ctx: SimContext): Frame[] {
  const out: Frame[] = [];
  let state = s;
  let prev: readonly InputFrame[] = s.fighters.map(() => 0);
  for (let i = 0; i < n; i++) {
    const now = inputs(i);
    const r = step(state, now, { prevInputs: prev, ctx });
    out.push(r);
    state = r.state;
    prev = now;
  }
  return out;
}

/** The highest point of any capsule, and the upper end of the spine it is on. */
function crown(caps: readonly Capsule[]): { top: number; x: number; y: number } {
  let best = { top: -Infinity, x: 0, y: 0 };
  for (const c of caps) {
    const [x, y] = c.y1 >= c.y2 ? [c.x1, c.y1] : [c.x2, c.y2];
    if (y + c.r > best.top) best = { top: y + c.r, x, y };
  }
  return best;
}

/* ---------------------------------------------------------------- hits -- */

describe("a hit must reach one of the bones' hurt capsules (Plan 4, Task 12)", () => {
  const RADIUS = fx(2);
  const FORWARD = fx(10);
  /** Mario (port 1) at x 30 holding `hold`, set up by `setup`; the swinger jabs on frame 1, a box of `radius` at `at`. */
  function swing(
    at: { x: number; y: number },
    ctx: (sw: FighterDef) => SimContext,
    setup: (m: FighterState) => void,
    hold: InputFrame,
    radius = RADIUS,
    far?: number,
  ): Frame[] {
    const sw = swinger(FORWARD, at.y, radius, far);
    const c = ctx(sw);
    const s = pair(["swinger", "mario"], at.x - FORWARD, fx(30), c);
    setup(s.fighters[1]);
    return play(s, 10, (i) => [i === 0 ? Btn.Attack : 0, hold], c);
  }
  /** The frame the jab's box is live on, and Mario then: a run with the box far overhead, so nothing changes him. */
  function whenLive(setup: (m: FighterState) => void, hold: InputFrame): { frame: number; mario: FighterState } {
    const frames = swing({ x: 0, y: fx(100) }, (sw) => world(true, sw), setup, hold);
    const live = frames.find((f) => f.state.fighters[0].action === "attack" && f.state.fighters[0].actionFrame === 3)!;
    expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
    return { frame: live.state.frame, mario: live.state.fighters[1] };
  }
  const hitsOn = (frames: Frame[]) => frames.flatMap((f) => f.events.hits).filter((h) => h.victim === 1);

  it("misses a crouching body the box clears, which the same body standing takes", () => {
    const crouch = (m: FighterState) => Object.assign(m, { action: "crouch", actionFrame: 10 });
    const live = whenLive(crouch, Btn.Down);
    expect(live.mario.action).toBe("crouch");
    const caps = fighterHurtboxes(roster("mario"), live.mario, live.frame, BAKE)!;
    // Half a unit clear over the crouch, straight over the feet.
    const at = { x: live.mario.x, y: crown(caps).top + RADIUS + fx(0.5) };
    expect(hitsOn(swing(at, (sw) => world(true, sw), crouch, Btn.Down))).toEqual([]);
    // Standing, the body is up there.
    expect(hitsOn(swing(at, (sw) => world(true, sw), () => {}, 0))).toHaveLength(1);
  });

  it("hits the bones' head where Plan 2's shorter capsule is not", () => {
    // SSBU's Mario stands 13.5 to the box's 11 (hurt.allow.json).
    const live = whenLive(() => {}, 0);
    const top = crown(fighterHurtboxes(roster("mario"), live.mario, live.frame, BAKE)!);
    const small = fx(1);
    // Half a unit inside the head, straight over its spine's top.
    const at = { x: top.x, y: top.top - fx(0.5) };
    const legacy = hurtboxCapsule(live.mario, roster("mario").attributes);
    expect(pointSegmentDistSq(at.x, at.y, legacy.x1, legacy.y1, legacy.x2, legacy.y2)).toBeGreaterThan(mul(small + legacy.r, small + legacy.r));
    expect(hitsOn(swing(at, (sw) => world(true, sw), () => {}, 0, small))).toHaveLength(1);
    expect(hitsOn(swing(at, (sw) => world(false, sw), () => {}, 0, small))).toEqual([]);
  });

  it("hits a body anywhere, and says where it met the capsule it reached deepest (ruling R9)", () => {
    // A capsule box, 20 long, through the legs at the height of the lowest spine end:
    // nowhere near the head (the first capsule), deepest in a leg.
    const live = whenLive(() => {}, 0);
    const caps = fighterHurtboxes(roster("mario"), live.mario, live.frame, BAKE)!;
    let low = { x: 0, y: Infinity };
    for (const c of caps) for (const [x, y] of [[c.x1, c.y1], [c.x2, c.y2]]) if (y < low.y) low = { x, y };
    const small = fx(1);
    const box: Capsule = { x1: low.x, y1: low.y, x2: low.x + fx(20), y2: low.y, r: small };
    const deepest = deepestReach(box.x1, box.y1, box.x1, box.y1, fx(20), 0, small, caps).index;
    expect(deepest).not.toBe(0);
    expect(capsulesOverlap(box, caps[0])).toBe(false);
    const want = contactPoint(box, caps[deepest]);
    expect(want).not.toEqual(contactPoint(box, caps[0]));
    // The swinger stands FORWARD behind the box's near end; it reaches FORWARD + 20 out.
    const hits = hitsOn(swing({ x: low.x, y: low.y }, (sw) => world(true, sw), () => {}, 0, small, FORWARD + fx(20)));
    expect(hits).toHaveLength(1);
    expect([hits[0].x, hits[0].y]).toEqual([low.x, low.y]);
    expect([hits[0].contactX, hits[0].contactY]).toEqual([want.x, want.y]);
  });

  describe("is a glancing blow by the deepest capsule it reaches", () => {
    const live = whenLive(() => {}, 0);
    const top = crown(fighterHurtboxes(roster("mario"), live.mario, live.frame, BAKE)!);
    /** The box straight over the highest spine end, `deep` into the capsule round it. */
    const skim = (deep: number) => swing({ x: top.x, y: top.top + RADIUS - deep }, (sw) => world(true, sw), () => {}, 0);

    it("is no hit, and spends nothing, 0.05 deep", () => {
      const frames = skim(fx(0.05));
      expect(hitsOn(frames)).toEqual([]);
      expect(frames.at(-1)!.state.fighters[0].hitThisMove).toEqual([]);
    });

    it("hits 0.2 deep, and says it touched at the box's centre (ruling R9)", () => {
      const hits = hitsOn(skim(fx(0.2)));
      expect(hits).toHaveLength(1);
      expect([hits[0].contactX, hits[0].contactY]).toEqual([top.x, top.top + RADIUS - fx(0.2)]);
    });
  });
});

/* ----------------------------------------------------------------- ECB -- */

describe("the ECB from bones in step() (Plan 4, Task 12; ruling R6)", () => {
  /** Mario standing at x -40 out of the way (port 0), and `id` (port 1) placed by `setup`. */
  function with1(id: string, ctx: SimContext, setup: (f: FighterState) => void): GameState {
    const s = pair(["mario", id], fx(-40), 0, ctx);
    setup(s.fighters[1]);
    return s;
  }
  /** Port 1 as one step leaves it when nothing is near it: what `step` reads its ECB from. */
  function probe(id: string, setup: (f: FighterState) => void, hold: InputFrame = 0): { ecb: NonNullable<ReturnType<typeof bakedEcb>>; f: FighterState; dy: number } {
    const s = with1(id, world(true), setup);
    const y0 = s.fighters[1].y;
    const out = step(s, [0, hold], { prevInputs: [0, 0], ctx: world(true) }).state;
    const f = out.fighters[1];
    return { ecb: bakedEcb(roster(id), f, out.frame, BAKE)!, f, dy: f.y - y0 };
  }

  const falling = (x: number) => (f: FighterState) =>
    Object.assign(f, { x, y: fx(-1), action: "fall", actionFrame: 4, grounded: false, platform: -1, facing: -1 });

  it("reaches a ledge from the side of the pelvis capsule (12.4)", () => {
    // Kirby: Plan 2's box is 1.9 to a side; his round body is wider.
    const { ecb } = probe("kirby", falling(fx(150)));
    expect(ecb.half).toBeGreaterThan(roster("kirby").attributes.width + fx(0.1));
    const grabs = (x: number, baked: boolean) => {
      const ctx = world(baked);
      return step(with1("kirby", ctx, falling(x)), [0, 0], { prevInputs: [0, 0], ctx }).state.fighters[1].ledge !== null;
    };
    const edge = fx(80) + LEDGE_GRAB_RANGE_X + ecb.half;
    expect(grabs(edge - fx(0.05), true)).toBe(true);
    expect(grabs(edge + fx(0.05), true)).toBe(false);
    expect(grabs(edge - fx(0.05), false)).toBe(false);
  });

  it("pushes a trumped fighter out by its own ECB's half-width and a unit (ruling R6)", () => {
    // Mario (port 0) hangs on the right ledge; Kirby (port 1) takes it from him.
    const hanging = (s: GameState) =>
      Object.assign(s.fighters[0], {
        action: "ledgeHang", actionFrame: 10, ledge: { platform: 0, side: 1 }, x: fx(80), y: 0, grounded: false, platform: -1, facing: -1,
      });
    const trump = (kirbyX: number, ctx: SimContext) => {
      const s = pair(["mario", "kirby"], 0, 0, ctx);
      hanging(s);
      falling(kirbyX)(s.fighters[1]);
      return step(s, [0, 0], { prevInputs: [0, 0], ctx }).state;
    };
    // Mario as phase 5 sees him when Kirby grabs: one step on, still hanging.
    const still = trump(fx(150), world(true));
    expect(still.fighters[0].action).toBe("ledgeHang");
    const half = bakedEcb(roster("mario"), still.fighters[0], still.frame, BAKE)!.half;
    expect(half).not.toBe(roster("mario").attributes.width);
    const trumped = trump(fx(82), world(true)).fighters[0];
    expect(trumped.action).toBe("ledgeTrumped");
    expect(trumped.x).toBe(fx(80) + half + ONE);
    expect(trump(fx(82), world(false)).fighters[0].x).toBe(fx(80) + roster("mario").attributes.width + ONE);
  });

  it("keeps an SDI'd body out of the stage's side by the bones' half-width (ruling R6)", () => {
    // Kirby frozen in a hit's hitlag beside the wall, mashing toward it: five pulses of 2.
    const frozen = (x: number) => (f: FighterState) => {
      Object.assign(f, { x, y: fx(-10), grounded: false, platform: -1, action: "hitstun", actionFrame: 0, hitstun: 20, hitlag: 20 });
      f.combat.victimFreeze = true;
    };
    const half = bakedEcb(roster("kirby"), with1("kirby", world(true), frozen(0)).fighters[1], 0, BAKE)!.half;
    expect(half).not.toBe(roster("kirby").attributes.width);
    const mash = (baked: boolean) => {
      const ctx = world(baked);
      const s = with1("kirby", ctx, frozen(fx(80) + half + fx(3)));
      return play(s, 20, (i) => [0, i % 2 === 0 ? Btn.Left : 0], ctx)[19].state.fighters[1].x;
    };
    expect(mash(true)).toBe(fx(80) + half);
    expect(mash(false)).toBe(fx(80) + roster("kirby").attributes.width);
  });

  it("meets the stage's underside with the top of this frame's capsules (12.2)", () => {
    // Donkey Kong tumbling up from under the stage: his bones' head is far over Plan 2's 15.
    const rising = (y: number) => (f: FighterState) => {
      Object.assign(f, { x: 0, y, grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60 });
      kineticLaunch(f, 0, fx(3), fx(3));
    };
    const { ecb, dy } = probe("donkeyKong", rising(fx(-120)));
    const bottom = -HARD_PLATFORM_DEPTH;
    // Half a step short of the underside last frame, half a step into it now.
    const y0 = bottom - ecb.top - (dy >> 1);
    expect(y0 + roster("donkeyKong").attributes.height + dy).toBeLessThan(bottom); // Plan 2's box stays clear
    const after = (baked: boolean) => {
      const ctx = world(baked);
      return step(with1("donkeyKong", ctx, rising(y0)), [0, 0], { prevInputs: [0, 0], ctx }).state.fighters[1].y;
    };
    expect(after(true)).toBe(bottom - ecb.top);
    expect(after(false)).toBe(y0 + dy);
  });
});

/* ---------------------------------------------------------- held fighter -- */

describe("a held fighter stands the bones' half-widths from its captor (ruling R7)", () => {
  it("is the two standing ECBs' half-widths ahead, and Plan 2's widths without a bake", () => {
    const held = (ctx: SimContext) => {
      const s = pair(["mario", "kirby"], 0, fx(6), ctx);
      Object.assign(s.fighters[0], { action: "grabHold", grabbing: 1, grabTimer: 60 });
      Object.assign(s.fighters[1], { action: "grabbed", grabbedBy: 0 });
      return step(s, [0, 0], { prevInputs: [0, 0], ctx }).state.fighters[1];
    };
    const halves = restEcb(roster("mario"), BAKE)!.half + restEcb(roster("kirby"), BAKE)!.half;
    expect(held(world(true)).x).toBe(halves);
    expect(held(world(false)).x).toBe(roster("mario").attributes.width + roster("kirby").attributes.width);
  });
});

/* -------------------------------------------------------------- rollback -- */

describe("rollback across a change of hurtbox shape (Plan 4, Task 12)", () => {
  it("re-simulates to the same hash from a snapshot taken before the body changes shape", () => {
    // Mario crouches from frame 6 to 30 and stands; Fox, close in, jabs twice.
    const ctx = world(true);
    const inputs = (i: number): readonly InputFrame[] => [i >= 6 && i < 30 ? Btn.Down : 0, i === 10 || i === 34 ? Btn.Attack : 0];
    let live = pair(["mario", "fox"], 0, fx(9), ctx);
    let prev: readonly InputFrame[] = [0, 0];
    let snapshot: GameState | null = null;
    let prevAtSnapshot = prev;
    const tops = new Set<number>();
    for (let i = 0; i < 60; i++) {
      if (i === 4) {
        snapshot = cloneState(live);
        prevAtSnapshot = prev;
      }
      live = step(live, inputs(i), { prevInputs: prev, ctx }).state;
      prev = inputs(i);
      if (i >= 4) tops.add(crown(localHurtboxes(roster("mario"), live.fighters[0], live.frame, BAKE)!).top);
    }
    // The window does cross a change of shape: the crouch lowers the body by more than a unit.
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(fx(1));

    let replay = snapshot!;
    let replayPrev = prevAtSnapshot;
    for (let i = 4; i < 60; i++) {
      replay = step(replay, inputs(i), { prevInputs: replayPrev, ctx }).state;
      replayPrev = inputs(i);
    }
    expect(hashState(replay)).toBe(hashState(live));
  });
});
