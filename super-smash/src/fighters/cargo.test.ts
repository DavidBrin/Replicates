/**
 * Donkey Kong's cargo, through the real `step()` (Plan 5, Task 8).
 *
 * Sources for every number pinned here:
 * - SmashWiki "Donkey Kong (SSBU)/Forward throw"
 *   (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_throw): the carry's
 *   "Invincibility 1-15" and "Animation length 15"; the four cargo throws'
 *   ATTACK_ABS (forward 12% at 60°, BKB 90, KBG 46; back 13% at 72°, 85/52; up
 *   12% at 92°, 65/53; down 11% at 46°, 70/45), their "Throw" frames (15, 16, 15,
 *   17) and "Interruptible" frames (46, 43, 30, 45); "Donkey Kong changes direction
 *   on frame 16"; the down throw "sets his vertical momentum to 1.5" on frame 17;
 *   the carry lasts "((90 + 1.7p) * 11 / 6) - g" frames, "165 frames if initiated
 *   immediately out of a grab, and 105 frames if initiated after 60 grab frames"
 *   at 0%; "As with standard grabs, button mashing reduces this amount by 8 frames
 *   per stick input, and 14.4 frames per button input"; "while carrying an
 *   opponent ... Donkey Kong's walk speed and acceleration are increased by 1.1×".
 * - UltimateFrameData (https://ultimateframedata.com/donkey_kong), "Grabs /
 *   Throws": Cargo Forward Throw 15/45 (startup/total), Cargo Backward Throw
 *   16/42, Cargo Up Throw 15/29, Cargo Down Throw 17/44, 12.0/13.0/12.0/11.0%.
 * - rubendal SSBU Data Viewer, patch 13.0.1
 *   (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Donkey%20Kong/data.json):
 *   `game_throwff`, `game_throwfb`, `game_throwfhi`, `game_throwflw` carry the same
 *   ATTACK_ABS, with ATK_HIT_ABS on frames 15, 16 (after `REVERSE_LR()`), 15 and 17,
 *   and `SET_SPEED_EX(0, 1.5, …)` on the down throw's 17; their motions
 *   `throw_f_f`/`_b`/`_hi`/`_lw` have CancelFrame 46, 43, 30 and 45; `game_throwf`
 *   (the lift) raises FIGHTER_DONKEY_STATUS_SHOULDER_START_FLAG_SHOULDER_WAIT on
 *   frame 16, its motion CancelFrame 16.
 * - SmashWiki "Forward throw" (https://www.ssbwiki.com/Forward_throw, "Notable
 *   forward throws"): the cargo "allows Donkey Kong to move and jump while holding
 *   the opponent", and "like regular grabs, the carried opponent can break free
 *   via button mashing, triggering a grab release".
 * - SmashWiki "Grab" (https://www.ssbwiki.com/Grab): "invulnerability to grabs for
 *   around one second after being released" (60 frames in Ultimate).
 *
 * UNVERIFIED and pinned as the replica's reading (`status/cargo.ts` says why):
 * the jump is his own full hop at once, with no squat and no landing lag; a
 * neutral press throws forward, and the grab button throws as the attack button
 * does; the carry keeps the grab's 19-frame floor; the carried ride at the top of
 * his standing body; he turns only on the ground.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { restEcb } from "@/engine/acmd/hurtboxes";
import { fx, mul, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { moveFrameOf } from "@/engine/hitbox";
import { fighterParams } from "@/engine/params";
import { KO_FREEZE_FRAMES, cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { GRAB_MIN_FRAMES, GRAB_RELEASE_IMMUNITY } from "@/engine/states";
import { CARGO_WALK } from "@/engine/status/cargo";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const DK = FIGHTERS.find((f) => f.id === "donkeyKong")!;
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const BAKED: SimContext = bakedContext(
  { fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! },
  readBakeFromDisk(),
);

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/**
 * Donkey Kong (port 0) holding Mario (1), as a landed grab leaves them, with
 * Mario's whole grab time ahead of him; `others` stand at x 60 unless placed.
 */
function holding(percent = 0, others: readonly string[] = [], ctx?: SimContext): GameState {
  const ids = ["donkeyKong", "mario", ...others];
  const s = createInitialState("finalDestination", ids.map((defId) => ({ defId })), { ...RULES, oneOnOne: ids.length === 2 }, 5, ctx);
  const [dk, m] = s.fighters;
  Object.assign(dk, { action: "grabHold", grounded: true, platform: 0, x: fx(-5), y: 0, facing: 1, intangible: 0, grabbing: 1 });
  Object.assign(m, { action: "grabbed", grounded: true, platform: 0, x: fx(5), y: 0, facing: -1, intangible: 0, grabbedBy: 0, damage: fx(percent) });
  // floor(90 + 1.7p) (`grabHoldFrames`), none of it spent yet.
  m.grabTimer = Math.floor((900 * 4096 + 17 * m.damage) / (10 * 4096));
  for (const f of s.fighters.slice(2)) Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0 });
  return s;
}

/** Step `n` frames, each port's keys from `keys(i)`; `prev0` the keys of the frame before the first. */
function play(
  s0: GameState,
  n: number,
  keys: (i: number) => readonly InputFrame[],
  ctx?: SimContext,
  prev0?: readonly InputFrame[],
): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: readonly InputFrame[] = prev0 ?? s0.fighters.map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < n; i++) {
    const now = keys(i);
    const out = step(s, now, { prevInputs: prev, ...(ctx ? { ctx } : {}) });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

/** Donkey Kong's keys from a list, Mario's from `mario`. */
function run(s0: GameState, dk: readonly InputFrame[], mario: (i: number) => InputFrame = () => 0, ctx?: SimContext) {
  return play(s0, dk.length, (i) => [dk[i], mario(i), ...s0.fighters.slice(2).map(() => 0)], ctx);
}

const idle = (n: number): InputFrame[] => Array<InputFrame>(n).fill(0);
/** The forward throw on step 0; he carries from step 15, the lift's frame 16. */
const LIFT: readonly InputFrame[] = [Btn.Right, ...idle(15)];
const CARRYING_FROM = 15;

/** Where a carried fighter rides: the top of the carrier's standing body (`held.ts`). */
function shoulders(ctx?: SimContext): number {
  const bake = ctx?.bake;
  return (bake === undefined ? null : restEcb(DK, bake, ctx?.bones ?? bake.bones))?.top ?? DK.attributes.height;
}

describe("Donkey Kong's cargo: the lift and the carry", () => {
  it("lifts Mario onto his shoulders on the forward throw's frame 16 (SHOULDER_WAIT)", () => {
    const { states } = run(holding(), [...LIFT, ...idle(5)]);
    const before = states[CARRYING_FROM - 1];
    expect(before.fighters[0].action).toBe("throw");
    expect(moveFrameOf(before.fighters[0].actionFrame)).toBe(15);
    expect(before.fighters[1].action).toBe("thrown");
    for (const s of states.slice(CARRYING_FROM)) {
      const [dk, m] = s.fighters;
      expect([dk.action, m.action, dk.grabbing, m.grabbedBy]).toEqual(["cargoCarry", "cargoHeld", 1, 0]);
      expect(m.x).toBe(dk.x);
      expect(m.y).toBe(dk.y + shoulders());
      expect([m.grounded, m.facing, m.vx, m.vy]).toEqual([false, dk.facing, 0, 0]);
    }
  });

  it("carries him at the top of his baked body, where the game plays it", () => {
    const top = shoulders(BAKED);
    expect(top).not.toBe(DK.attributes.height);
    const { states } = run(holding(0, [], BAKED), [...LIFT, ...idle(5)], () => 0, BAKED);
    const [dk, m] = states.at(-1)!.fighters;
    expect(m.action).toBe("cargoHeld");
    expect(m.y).toBe(dk.y + top);
  });

  it("is invincible through the lift, frames 1 to 15, and not once he carries: a hit then frees Mario", () => {
    // Fox behind Donkey Kong, facing him, jabbing every fourth frame: far enough
    // back that the jab meets Donkey Kong and not Mario in front of him (a hit on
    // the fighter held frees them: that is not a hit on the thrower).
    const s = holding(0, ["fox"]);
    Object.assign(s.fighters[2], { x: fx(-18), facing: 1 });
    const { states, events } = play(s, 40, (i) => [LIFT[i] ?? 0, 0, i % 4 === 1 ? Btn.Attack : 0]);
    const onDk = events.flatMap((e, i) => e.hits.filter((h) => h.victim === 0).map((h) => ({ i, damage: h.damage })));
    const during = onDk.filter((h) => h.i < CARRYING_FROM);
    const after = onDk.filter((h) => h.i >= CARRYING_FROM);
    expect(during.length, "jabs met the lift").toBeGreaterThan(0);
    expect(during.every((h) => h.damage === 0)).toBe(true);
    expect(after.length, "a jab met the carry").toBeGreaterThan(0);
    const hit = after[0].i;
    expect(after[0].damage).toBeGreaterThan(0);
    // The hit on the carrier ends the carry at both ends; Mario falls from where he rode.
    const [dk, m] = states[hit].fighters;
    expect([dk.grabbing, m.grabbedBy]).toEqual([-1, -1]);
    expect(states[hit + 1].fighters[1].action).toBe("fall");
    // ...with no grab immunity: his captor was hit, he did not break out (`releaseHeld`).
    expect(states[hit + 1].fighters[1].combat.grabImmune).toBe(0);
  });

  it("lifts nobody when a hit frees Mario during the lift: the throw ends as any other", () => {
    // Fox close enough behind Donkey Kong that his jab reaches Mario, held in front.
    const s = holding(0, ["fox"]);
    Object.assign(s.fighters[2], { x: fx(-16), facing: 1 });
    const { states, events } = play(s, 20, (i) => [LIFT[i] ?? 0, 0, i === 1 ? Btn.Attack : 0]);
    const freed = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(freed).toBeGreaterThan(0);
    expect(freed).toBeLessThan(CARRYING_FROM);
    expect(states[CARRYING_FROM - 1].fighters[0].action).toBe("throw");
    expect(states[CARRYING_FROM].fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
    expect(states.every((st) => st.fighters[1].action !== "cargoHeld")).toBe(true);
  });

  it("walks him along at 1.1× Donkey Kong's walk: its speed and its acceleration", () => {
    const p = fighterParams(DK);
    const { states } = run(holding(), [...LIFT, ...Array<InputFrame>(40).fill(Btn.Right)]);
    // The first frame of the walk is one frame of the ×1.1 acceleration from a standstill.
    expect(states[CARRYING_FROM].fighters[0].vx).toBe(0);
    expect(states[CARRYING_FROM + 1].fighters[0].vx).toBe(mul(p.walk_accel_add + p.walk_accel_mul, CARGO_WALK));
    const end = states.at(-1)!;
    expect(end.fighters[0].action).toBe("cargoCarry");
    expect(end.fighters[0].vx).toBe(mul(p.walk_speed_max, CARGO_WALK));
    expect(toFloat(end.fighters[0].vx)).toBeCloseTo(toFloat(p.walk_speed_max) * 1.1, 3);
    for (const s of states.slice(CARRYING_FROM)) expect(s.fighters[1].x).toBe(s.fighters[0].x);
    expect(end.fighters[0].x).toBeGreaterThan(fx(30));
  });

  it("turns to walk the other way, and Mario turns with him", () => {
    const { states } = run(holding(), [...LIFT, ...Array<InputFrame>(30).fill(Btn.Left)]);
    const [dk, m] = states.at(-1)!.fighters;
    expect([dk.action, dk.facing, m.facing]).toEqual(["cargoCarry", -1, -1]);
    expect(dk.vx).toBeLessThan(0);
    expect(m.x).toBe(dk.x);
  });

  it("jumps with him, and lands still carrying", () => {
    const { states } = run(holding(), [...LIFT, Btn.Jump, ...idle(80)]);
    expect(Math.max(...states.map((s) => s.fighters[0].y))).toBeGreaterThan(fx(10));
    for (const s of states.slice(CARRYING_FROM)) {
      expect(s.fighters[0].action).toBe("cargoCarry");
      expect(s.fighters[1].action).toBe("cargoHeld");
    }
    const end = states.at(-1)!.fighters[0];
    expect(end.grounded).toBe(true);
    expect(end.jumpsUsed).toBe(0);
  });

  it("turns only on the ground: a stick held back in the air drifts him, and he faces on (UNVERIFIED)", () => {
    const { states } = run(holding(), [...LIFT, Btn.Jump, ...Array<InputFrame>(20).fill(Btn.Left)]);
    const air = states.slice(CARRYING_FROM + 2);
    expect(air.every((s) => !s.fighters[0].grounded && s.fighters[0].facing === 1)).toBe(true);
    expect(air.at(-1)!.fighters[0].vx).toBeLessThan(0);
  });

  it("never takes a ledge with his hands full: he walks off the stage carrying, and the KO ends the carry", () => {
    // Final Destination's right ledge is at x 80: he walks right off it, then drifts
    // back toward it as he falls past it. Mario at 100% rides for 476 frames.
    const keys = [...LIFT, ...Array<InputFrame>(66).fill(Btn.Right), ...Array<InputFrame>(30).fill(Btn.Left), ...idle(120)];
    const { states } = run(holding(100), keys);
    const left = states.findIndex((s, i) => i > CARRYING_FROM && !s.fighters[0].grounded);
    expect(left).toBeGreaterThan(0);
    expect(states[left].fighters[0].action).toBe("cargoCarry");
    expect(states.some((s) => s.fighters[0].ledge !== null || s.fighters[0].action === "ledgeHang")).toBe(false);
    // Off the bottom, Donkey Kong first: both ends of the link go with his KO, and
    // Mario, above him, falls from there once the KO's freeze is over.
    const ko = states.findIndex((s) => s.fighters[0].action === "dead");
    expect(ko).toBeGreaterThan(left);
    expect(states[ko].fighters[1].grabbedBy).toBe(-1);
    expect(states[ko].fighters[0].grabbing).toBe(-1);
    expect(states[ko + KO_FREEZE_FRAMES + 1].fighters[1].action).toBe("fall");
  });
});

describe("Donkey Kong's cargo throws", () => {
  const CASES = [
    // keys, slot, ATTACK_ABS damage and angle, throw frame, first interruptible frame, Mario sent forward
    ["neutral", Btn.Attack, "cargoFthrow", 12, 60, 15, 46, true],
    ["forward", Btn.Right | Btn.Attack, "cargoFthrow", 12, 60, 15, 46, true],
    ["back", Btn.Left | Btn.Attack, "cargoBthrow", 13, 72, 16, 43, false],
    ["up", Btn.Up | Btn.Attack, "cargoUthrow", 12, 92, 15, 30, true],
    ["down", Btn.Down | Btn.Attack, "cargoDthrow", 11, 46, 17, 45, true],
    ["grab and forward", Btn.Right | Btn.Grab, "cargoFthrow", 12, 60, 15, 46, true],
  ] as const;

  it.each(CASES)("%s: lands its ATTACK_ABS on its throw frame and ends on its first interruptible frame", (_n, keys, slot, damage, angle, at, faf, forward) => {
    const { states, events } = run(holding(), [...LIFT, idle(1)[0], keys, ...idle(60)]);
    const start = CARRYING_FROM + 2;
    expect(states[start].fighters[0]).toMatchObject({ action: "throw", move: slot, actionFrame: 0 });
    const hits = events.flatMap((e, i) => e.hits.filter((h) => h.attacker === 0).map((h) => ({ i, ...h })));
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(moveFrameOf(states[hit.i].fighters[0].actionFrame)).toBe(at);
    // Fresh (×1.05) in a one-on-one (×1.2).
    expect(toFloat(hit.damage)).toBeCloseTo(damage * 1.05 * 1.2, 2);
    // The launch's world angle: as authored facing right, mirrored once he has turned.
    const facing = states[hit.i].fighters[0].facing;
    expect(toFloat(hit.angle)).toBeCloseTo(facing > 0 ? angle : 180 - angle, 3);
    expect(states[hit.i].fighters[1].grabbedBy).toBe(-1);
    // He acts on the published frame: the throw's last frame is the one before it.
    expect(states[start + faf - 2].fighters[0].action).toBe("throw");
    expect(states[start + faf - 1].fighters[0].action).not.toBe("throw");
    const sent = states[hit.i + 5].fighters[1];
    expect(forward ? sent.vx > 0 || angle === 92 : sent.vx < 0).toBe(true);
  });

  it("turns round on the back throw's frame 16, the launch's frame, and no earlier", () => {
    const { states } = run(holding(), [...LIFT, 0, Btn.Left | Btn.Attack, ...idle(50)]);
    const turned = states.findIndex((s) => s.fighters[0].facing === -1);
    expect(states[turned].fighters[0].action).toBe("throw");
    expect(moveFrameOf(states[turned].fighters[0].actionFrame)).toBe(16);
    expect(states.slice(turned).every((s) => s.fighters[0].facing === -1)).toBe(true);
    expect(states.at(-1)!.fighters[1].x).toBeLessThan(states.at(-1)!.fighters[0].x);
  });

  it("hops him up at 1.5 on the down throw's frame 17", () => {
    const { states } = run(holding(), [...LIFT, 0, Btn.Down | Btn.Attack, ...idle(60)]);
    const at = states.findIndex((s) => s.fighters[0].action === "throw" && moveFrameOf(s.fighters[0].actionFrame) === 17);
    expect(states[at - 1].fighters[0].grounded).toBe(true);
    expect(states[at].fighters[0].vy).toBe(fx(1.5));
    expect(states[at].fighters[0].grounded).toBe(false);
  });

  it("keeps the fighter thrown on his shoulders until the release", () => {
    const { states } = run(holding(), [...LIFT, 0, Btn.Up | Btn.Attack, ...idle(20)]);
    const start = CARRYING_FROM + 2;
    for (let i = start; i < start + 14; i++) {
      const [dk, m] = states[i].fighters;
      expect(m.action, `step ${i}`).toBe("thrown");
      expect([m.x, m.y]).toEqual([dk.x, dk.y + shoulders()]);
    }
  });

  it("throws on the carry's first frame when the press came during the lift (the buffer)", () => {
    const { states } = run(holding(), [Btn.Right, ...idle(9), Btn.Attack, ...idle(10)]);
    expect(states[CARRYING_FROM].fighters[0]).toMatchObject({ action: "throw", move: "cargoFthrow", actionFrame: 0 });
  });

  it("takes no ledge in the middle of a cargo throw begun in the air, and lands the launch", () => {
    // Just outside Final Destination's right ledge (x 80), facing it and falling:
    // an airborne fighter here takes the ledge.
    const s = holding();
    Object.assign(s.fighters[0], { action: "throw", move: "cargoUthrow", actionFrame: 0, grounded: false, platform: -1, x: fx(83), y: fx(-1), facing: -1 });
    Object.assign(s.fighters[1], { action: "thrown", grounded: false, platform: -1, x: fx(83), y: fx(-1) });
    const { states, events } = run(s, idle(30));
    expect(states.every((st) => st.fighters[0].ledge === null)).toBe(true);
    const at = events.findIndex((e) => e.hits.some((h) => h.attacker === 0));
    expect(moveFrameOf(states[at].fighters[0].actionFrame)).toBe(15);
    // ...and the same fighter, not throwing, does take it.
    const free = holding();
    Object.assign(free.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(83), y: fx(-1), facing: -1, grabbing: -1 });
    Object.assign(free.fighters[1], { action: "stand", grabbedBy: -1, grabTimer: 0 });
    expect(run(free, idle(30)).states.some((st) => st.fighters[0].ledge !== null)).toBe(true);
  });

  it("throws from the air: the cargo throw launches him, and Donkey Kong lands free", () => {
    // Jump with him, throw near the top of the jump.
    const { states, events } = run(holding(), [...LIFT, Btn.Jump, ...idle(12), Btn.Attack, ...idle(80)]);
    const at = events.findIndex((e) => e.hits.length > 0);
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[0].grounded).toBe(false);
    expect(toFloat(events[at].hits[0].damage)).toBeCloseTo(12 * 1.05 * 1.2, 2);
    const end = states.at(-1)!;
    expect(end.fighters[0].grabbing).toBe(-1);
    expect(end.fighters[1].grabbedBy).toBe(-1);
    expect(end.fighters[0].grounded).toBe(true);
    expect(["stand", "land", "landingLag"]).toContain(end.fighters[0].action);
  });

  it("lands in the middle of a cargo throw and finishes it, launching the thrown fighter", () => {
    // Throw a frame or two before the jump comes back down.
    const fall = run(holding(), [...LIFT, Btn.Jump, ...idle(120)]).states;
    const landsAt = fall.findIndex((st, i) => i > CARRYING_FROM + 2 && st.fighters[0].grounded);
    expect(landsAt).toBeGreaterThan(CARRYING_FROM + 2);
    const pressAt = landsAt - 3;
    const { states, events } = run(holding(), [...LIFT, Btn.Jump, ...idle(pressAt - CARRYING_FROM - 2), Btn.Attack, ...idle(80)]);
    const landed = states.findIndex((s, i) => i > pressAt && s.fighters[0].grounded);
    expect(states[landed].fighters[0].action).toBe("throw");
    const at = events.findIndex((e) => e.hits.length > 0);
    expect(at).toBeGreaterThan(landed);
    const end = states.at(-1)!;
    expect(end.fighters[1].action).not.toBe("thrown");
    expect(end.fighters[1].action).not.toBe("cargoHeld");
    expect(end.fighters[0].grabbing).toBe(-1);
  });
});

describe("struggling out of the carry", () => {
  /** Frames Mario's carry ran: from the lift's frame (his status runs after Donkey Kong's) to his release. */
  function carried(s0: GameState, dk: readonly InputFrame[], mario: (i: number) => InputFrame = () => 0): number {
    const { states } = run(s0, [...dk, ...idle(400)], mario);
    const lifted = states.findIndex((s) => s.fighters[1].action === "cargoHeld");
    const freed = states.findIndex((s, i) => i > lifted && s.fighters[1].action !== "cargoHeld");
    expect(lifted).toBeGreaterThan(0);
    expect(freed).toBeGreaterThan(lifted);
    return freed - lifted + 1;
  }

  it("lasts ((90 + 1.7p) × 11/6) − g: 165 frames at 0% straight out of the grab", () => {
    expect(carried(holding(), LIFT)).toBe(165);
  });

  it("lasts 105 frames at 0% after 60 grab frames", () => {
    expect(carried(holding(), [...idle(60), ...LIFT])).toBe(105);
  });

  it("lasts floor(175 × 11/6) = 320 frames at 50% straight out of the grab", () => {
    expect(carried(holding(50), LIFT)).toBe(320);
  });

  it("mashes 14.4 frames off a button press and 8 off a stick input, the grab's own rates", () => {
    const after = (key: InputFrame) =>
      run(holding(), [...LIFT, ...idle(10)], (i) => (i > CARRYING_FROM && (i - CARRYING_FROM) % 2 === 1 ? key : 0)).states.at(-1)!.fighters[1];
    const calm = after(0);
    expect(calm.action).toBe("cargoHeld");
    expect(after(Btn.Attack).grabTimer).toBe(calm.grabTimer - 72);
    expect(after(Btn.Left).grabTimer).toBe(calm.grabTimer - 40);
  });

  it("lets Mario struggle free sooner the harder he mashes, into a grab release", () => {
    const { states } = run(holding(), [...LIFT, ...idle(400)], (i) => (i % 2 === 0 ? Btn.Attack : 0));
    const freed = states.findIndex((s, i) => i > CARRYING_FROM && s.fighters[1].action !== "cargoHeld");
    expect(freed - CARRYING_FROM + 1).toBeLessThan(165);
    const m = states[freed].fighters[1];
    expect([m.action, m.grabbedBy]).toEqual(["fall", -1]);
    expect(m.combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY);
    // Donkey Kong's own status sees the link gone on his next frame, and stands.
    expect(states[freed + 1].fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
  });

  it("struggles through a freeze too, as a grab does (forged: nothing freezes a carried fighter today)", () => {
    const { states } = run(holding(), [...LIFT, ...idle(2)]);
    const frozen = cloneState(states.at(-1)!);
    frozen.fighters[1].hitlag = 6;
    const before = frozen.fighters[1].grabTimer;
    const after = play(frozen, 6, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]).states.at(-1)!.fighters[1];
    expect(after.action).toBe("cargoHeld");
    expect(after.hitlag).toBe(0);
    // Six frames and three presses: 6 + 3 × 14.4 = 49.2.
    expect(after.grabTimer).toBe(before - 6 - 43);
  });

  it("leaves Mario, freed in the air, his midair jump and not his ground jump (UNVERIFIED)", () => {
    const { states } = run(holding(), [...LIFT, ...idle(200)], (i) => (i % 2 === 0 ? Btn.Grab : 0));
    const freed = states.findIndex((s, i) => i > CARRYING_FROM && s.fighters[1].action !== "cargoHeld");
    expect(states[freed].fighters[1]).toMatchObject({ action: "fall", grounded: false, jumpsUsed: 1 });
  });

  it("keeps the grab's floor: nobody struggles free before the 19th frame (UNVERIFIED for the carry)", () => {
    const s = holding();
    // One frame of grab time left at the lift: 165 − 89 = 76 to go, mashed away in a few.
    s.fighters[1].grabTimer = 1;
    const { states } = run(s, [...LIFT, ...idle(40)], (i) => (i % 2 === 0 ? Btn.Attack | Btn.Left : 0));
    const freed = states.findIndex((st, i) => i > CARRYING_FROM && st.fighters[1].action !== "cargoHeld");
    expect(states[freed - 1].fighters[1].actionFrame).toBe(GRAB_MIN_FRAMES - 1);
  });
});

describe("every way the carry ends clears both ends", () => {
  it("frees Mario when someone else hits him off the shoulders, and Donkey Kong stands", () => {
    // Fox in the air beside Mario's head, swinging a neutral air at him.
    const s = holding(0, ["fox"]);
    const { states } = run(s, [...LIFT, ...idle(1)]);
    const at = cloneState(states.at(-1)!);
    const [dk, m] = at.fighters;
    Object.assign(at.fighters[2], { action: "fall", grounded: false, platform: -1, x: m.x + fx(7), y: m.y + fx(1), facing: -1 });
    const after = play(at, 12, (i) => [0, 0, i === 0 ? Btn.Attack : 0]);
    const hit = after.events.findIndex((e) => e.hits.some((h) => h.attacker === 2));
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(after.events[hit].hits.filter((h) => h.attacker === 2).map((h) => h.victim)).toEqual([1]);
    expect(after.states[hit].fighters[1].grabbedBy).toBe(-1);
    expect(["hitstun", "tumble"]).toContain(after.states[hit].fighters[1].action);
    expect(after.states[hit + 1].fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
    expect(dk.action).toBe("cargoCarry");
  });

  it("frees Mario when someone grabs Donkey Kong", () => {
    const s = holding(0, ["fox"]);
    const { states } = run(s, [...LIFT, ...idle(1)]);
    const at = cloneState(states.at(-1)!);
    Object.assign(at.fighters[2], { x: at.fighters[0].x + fx(8), facing: -1 });
    const after = play(at, 20, (i) => [0, 0, i === 0 ? Btn.Grab : 0]);
    const caught = after.states.findIndex((st) => st.fighters[0].grabbedBy === 2);
    expect(caught).toBeGreaterThanOrEqual(0);
    expect(after.states[caught].fighters[0].action).toBe("grabbed");
    expect(after.states[caught].fighters[1].grabbedBy).toBe(-1);
    expect(after.states[caught + 1].fighters[1].action).toBe("fall");
  });
});

describe("the carry's backstop", () => {
  // Forged: every path that frees a carried fighter today clears both ends of the
  // link. A carry must not depend on that, as a hold does not (`STATUS_CATCH_WAIT`).
  it("ends a carry whose fighter has left it with the link whole, and lets them go immune to grabs", () => {
    const { states } = run(holding(), [...LIFT, ...idle(2)]);
    const forged = cloneState(states.at(-1)!);
    Object.assign(forged.fighters[1], { action: "fall", actionFrame: 0 });
    const after = play(forged, 2, () => [0, 0]).states;
    expect(after[0].fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
    expect(after[0].fighters[1].grabbedBy).toBe(-1);
    // Set in Donkey Kong's status (port 0), and counted down in Mario's frame (port 1) after it.
    expect(after[0].fighters[1].combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY - 1);
  });
});

describe("the carry rolls back", () => {
  it("re-simulates hash-equal from snapshots mid-carry and mid-cargo-throw", () => {
    const inputs = [...LIFT, ...Array<InputFrame>(20).fill(Btn.Right), Btn.Jump, ...idle(8), Btn.Left | Btn.Attack, ...idle(40)];
    const mash = (i: number) => (i % 3 === 0 ? Btn.Special : 0);
    const keys = (i: number): InputFrame[] => [inputs[i], mash(i)];
    const { states } = play(holding(30), inputs.length, keys);
    const throwing = states.findIndex((s) => s.fighters[0].action === "throw" && s.fighters[0].move === "cargoBthrow");
    for (const at of [CARRYING_FROM + 10, throwing + 5]) {
      expect(["cargoCarry", "throw"]).toContain(states[at].fighters[0].action);
      const again = play(cloneState(states[at]), inputs.length - at - 1, (i) => keys(i + at + 1), undefined, keys(at)).states;
      again.forEach((s, k) => expect(hashState(s), `snapshot ${at}, step ${at + 1 + k}`).toBe(hashState(states[at + 1 + k])));
    }
    expect(states[throwing + 5].fighters[1].action).toBe("thrown");
  });
});
