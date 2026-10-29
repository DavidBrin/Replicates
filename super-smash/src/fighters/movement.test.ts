import { beforeAll, describe, expect, it } from "vitest";

import { airBrakeFromDef, airDodgeFromDef, sideDodgeTravel } from "@/ai/behaviours";
import { ONE, fx, mul, toFloat } from "@/engine/fixed";
import { emptyKinetic, initialRiseStep, jumpLaunchSpeed, jumpRiseSpeeds } from "@/engine/kinetic";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { LEDGE_HANG_MIN, onLanded } from "@/engine/states";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { finalDestination } from "@/stages/finalDestination";
import { FIGHTERS } from "./index";
import { FIGHTER_PARAMS, type RosterId } from "./params";

/**
 * Movement measured through the real `step()`, with the real roster on Final
 * Destination (Plan 2, Tasks 19–24). Every expectation is a published number
 * from `FIGHTER_PARAMS` (rubendal SSBU-Calculator) and cites the page that
 * states the rule; where the rule itself is not published the test says
 * UNVERIFIED.
 */

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const IDS = FIGHTERS.map((f) => f.id as RosterId);

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** One fighter standing still on a stage (Final Destination unless told otherwise), actionable. */
function standing(id: RosterId, stage = "finalDestination"): GameState {
  let s = createInitialState(stage, [{ defId: id }], RULES, 7);
  for (let i = 0; i < 80; i++) s = step(s, [0], { prevInputs: [0] }).state;
  const f = s.fighters[0];
  expect(f.grounded).toBe(true);
  expect(f.action).toBe("stand");
  return s;
}

/** Play `inputs` one per frame; report the fighter after each. */
function play(s0: GameState, inputs: readonly InputFrame[]): FighterState[] {
  let s = s0;
  let prev: InputFrame = 0;
  const out: FighterState[] = [];
  for (const input of inputs) {
    s = step(s, [input], { prevInputs: [prev] }).state;
    prev = input;
    out.push(s.fighters[0]);
  }
  return out;
}

const hold = (input: InputFrame, n: number): InputFrame[] => Array.from({ length: n }, () => input);

/** Height above the ground, in units, on every frame from the first airborne one. */
function airborneHeights(frames: readonly FighterState[], groundY: number): number[] {
  const start = frames.findIndex((f) => !f.grounded);
  return frames.slice(start).map((f) => toFloat(f.y - groundY));
}

describe("jump arcs (SmashWiki Jump, https://www.ssbwiki.com/Jump)", () => {
  // "the game encodes jump height, and works backwards using gravity to figure
  // out the correct force"; the page's source gives the force as
  // f = sqrt(2g*h) + g/2, and sqrt(2g*(h-i)) + g/2 for a full hop after its
  // "jump initial height … the height that a character will reach in the first
  // 4 frames of a full hop … no affect on short hops or aerial jumps".
  // With gravity on every airborne frame that launch peaks between h − g/8 and
  // h (see `jumpLaunchSpeed`); Q12 truncation takes off less than 0.01 more.
  const ROUNDING = 0.01;

  function expectPeak(peak: number, height: number, gravity: number, label: string): void {
    const h = toFloat(height);
    const g = toFloat(gravity);
    expect(peak, `${label}: below h − g/8`).toBeGreaterThanOrEqual(h - g / 8 - ROUNDING);
    expect(peak, `${label}: above h`).toBeLessThanOrEqual(h);
  }

  it.each(IDS)("%s full hop: the initial height over 4 frames (even split UNVERIFIED), then the published peak", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    const frames = play(s, hold(Btn.Jump, 120));
    const start = frames.findIndex((f) => !f.grounded);
    const ground = s.fighters[0].y;
    const rise = [1, 2, 3, 4].map((n) => frames[start + n - 1].y - ground);
    let sum = 0;
    const want = [1, 2, 3, 4].map((n) => (sum += initialRiseStep(p.jump_initial_y, n)));
    expect(rise).toEqual(want);
    expect(rise[3]).toBe(p.jump_initial_y);
    expectPeak(Math.max(...airborneHeights(frames, ground)), p.jump_y, p.air_accel_y, "full hop");
  });

  it.each(IDS)("%s short hop: launched by the published formula, gravity on its first frame, the published peak", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    const frames = play(s, [Btn.Jump, ...hold(0, 120)]);
    const first = frames.find((f) => !f.grounded)!;
    expect(first.vy).toBe(jumpLaunchSpeed(p.air_accel_y, p.mini_jump_y) - p.air_accel_y);
    expect(first.y - s.fighters[0].y).toBe(first.vy);
    expectPeak(Math.max(...airborneHeights(frames, s.fighters[0].y)), p.mini_jump_y, p.air_accel_y, "short hop");
  });

  // SmashWiki "Air dodge" (https://www.ssbwiki.com/Air_dodge): Ultimate's neutral
  // air dodge keeps the fighter's momentum, the hop's rise included (Plan 3, Task 20b).
  it.each(IDS)("%s neutral air dodge inside the initial rise: the hop rises on under it, frame for frame", (id) => {
    const s = standing(id);
    const hop = play(s, hold(Btn.Jump, 120));
    const start = hop.findIndex((f) => !f.grounded);
    // Shield pressed on the third airborne frame, with the jump still held: mid-rise.
    const frames = play(s, [...hold(Btn.Jump, start + 2), ...hold(Btn.Jump | Btn.Shield, 8)]);
    const dodge = frames.findIndex((f) => f.action === "airDodge");
    expect(dodge, "the air dodge starts on the press").toBe(start + 2);
    expect(frames[dodge - 1].kinetic.jumpInitial, "pressed inside the initial rise").toBeGreaterThan(0);
    for (let n = 0; n <= 7; n++) {
      expect(frames[dodge + n].action).toBe("airDodge");
      expect(frames[dodge + n].y, `dodge frame ${n}`).toBe(hop[dodge + n].y);
    }
  });

  it.each(IDS)("%s directional air dodge inside the initial rise: it ends the rise, and holds its height", (id) => {
    const s = standing(id);
    const start = play(s, hold(Btn.Jump, 120)).findIndex((f) => !f.grounded);
    const frames = play(s, [...hold(Btn.Jump, start + 2), ...hold(Btn.Jump | Btn.Shield | Btn.Right, 8)]);
    const dodge = frames.findIndex((f) => f.action === "airDodge");
    expect(dodge, "the air dodge starts on the press").toBe(start + 2);
    for (let n = 0; n <= 5; n++) {
      expect(frames[dodge + n].kinetic.jumpInitial).toBe(0);
      expect(frames[dodge + n].y, `dodge frame ${n}`).toBe(frames[dodge - 1].y);
    }
  });

  it.each(IDS)("%s air jump inside the full hop's initial rise: it ends the rise, then rises the air jump's own height", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    const start = play(s, hold(Btn.Jump, 120)).findIndex((f) => !f.grounded);
    // A full hop (jump held through jumpsquat), let go on the first airborne
    // frame, and pressed again on the second: inside the 4-frame initial rise.
    const frames = play(s, [...hold(Btn.Jump, start + 1), 0, Btn.Jump, ...hold(0, 90)]);
    const jumpAt = start + 2;
    expect(frames[jumpAt - 1].kinetic.jumpInitial, "still in the initial rise").toBeGreaterThan(0);
    expect(frames[jumpAt].jumpsUsed).toBe(2);
    expect(frames[jumpAt].kinetic.jumpInitial).toBe(0);
    const from = toFloat(frames[jumpAt - 1].y);
    const peak = Math.max(...frames.slice(jumpAt).map((f) => toFloat(f.y)));
    const first = (p.jump_aerial_y_list ?? [p.jump_aerial_y])[0];
    expectPeak(peak - from, first, p.air_accel_y, "air jump in the rise");
  });

  it.each(IDS)("%s air jump: rises the published height of its first midair jump", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    // Short hop, then a fresh jump press on frame 9, airborne and well before it lands.
    const frames = play(s, [Btn.Jump, ...hold(0, 8), Btn.Jump, ...hold(0, 90)]);
    const jumpAt = 9;
    expect(frames[jumpAt - 1].grounded).toBe(false);
    expect(frames[jumpAt].grounded).toBe(false);
    expect(frames[jumpAt].jumpsUsed).toBe(2);
    const from = toFloat(frames[jumpAt - 1].y);
    const peak = Math.max(...frames.slice(jumpAt).map((f) => toFloat(f.y)));
    const first = (p.jump_aerial_y_list ?? [p.jump_aerial_y])[0];
    expectPeak(peak - from, first, p.air_accel_y, "air jump");
  });
});

describe("midair jumps (SmashWiki Midair jump, https://www.ssbwiki.com/Midair_jump)", () => {
  const PRESS_EVERY = 30;

  /** A full hop, then a jump press every 30 frames; the fighter after each frame. */
  function chain(id: RosterId, presses: number): FighterState[] {
    const inputs: InputFrame[] = [...hold(Btn.Jump, 6), ...hold(0, 9)];
    for (let i = 0; i < presses; i++) inputs.push(Btn.Jump, ...hold(0, PRESS_EVERY - 1));
    return play(standing(id), inputs);
  }

  // Covers the ground-hop route only; the routes that leave the ground without a jump are Task 20b's.
  it.each(IDS)("%s gets exactly jump_count_max − 1 of them", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = chain(id, p.jump_count_max + 1);
    expect(Math.max(...frames.map((f) => f.jumpsUsed))).toBe(p.jump_count_max);
  });

  it("gives Kirby five, each rising its own published height (SmashWiki Jump, Ultimate table)", () => {
    // https://www.ssbwiki.com/Jump, Kirby, Air Jump: "21.06378125, 18.528125, 15.931125,
    // 13.34569531, 10.82288281 for each air jump." Each peaks between h − g/8 and h (Task 19).
    const p = FIGHTER_PARAMS.kirby;
    const list = p.jump_aerial_y_list!;
    const g = toFloat(p.air_accel_y);
    const frames = chain("kirby", list.length);
    for (let i = 0; i < list.length; i++) {
      const at = 15 + i * PRESS_EVERY;
      expect(frames[at].jumpsUsed, `jump ${i + 1} taken`).toBe(i + 2);
      const from = toFloat(frames[at - 1].y);
      const gain = Math.max(...frames.slice(at, at + PRESS_EVERY).map((f) => toFloat(f.y))) - from;
      expect(gain, `jump ${i + 1}`).toBeGreaterThanOrEqual(toFloat(list[i]) - g / 8 - 0.01);
      expect(gain, `jump ${i + 1}`).toBeLessThanOrEqual(toFloat(list[i]));
    }
  });

  it("takes the jump, not a fast fall, when down and jump arrive on one frame (Review Focus #4)", () => {
    const s = standing("mario");
    // Short hop, fall past the apex, then down + jump together.
    const frames = play(s, [Btn.Jump, ...hold(0, 25), Btn.Down | Btn.Jump, 0]);
    // Precondition: the fighter really is falling when the two arrive, so a fast fall was on offer.
    expect(frames[25].vy).toBeLessThan(0);
    const f = frames[26];
    expect(f.jumpsUsed).toBe(2);
    expect(f.fastFalling).toBe(false);
    expect(f.vy).toBeGreaterThan(0);
  });
});

describe("air friction (SmashWiki Air friction, https://www.ssbwiki.com/Air_friction)", () => {
  // "Air friction only applies when the player is not holding the Control Stick
  // in a horizontal direction", and the page adds that input ignored in hitstun
  // counts as not holding it. "If the player is attempting to slow down, air
  // acceleration applies instead." Values: calculator `AirFriction` (air_brake_x).
  //
  // The engine deliberately does NOT slow a fighter in hitstun: SmashWiki
  // "Knockback" says air friction is disabled while a launch decays, so
  // `kineticReel` bleeds only the launch (pinned in `kinetic.test.ts`). The two
  // pages read differently on hitstun; D55 will record which one the engine follows.

  /** A full hop drifting right for 20 frames (17 of them airborne), then `input` for `n` frames. */
  function drift(id: RosterId, input: InputFrame, n: number): FighterState[] {
    const frames = play(standing(id), [...hold(Btn.Jump | Btn.Right, 20), ...hold(input, n)]);
    expect(frames[19].grounded, `${id} is airborne when the drift ends`).toBe(false);
    expect(frames[19].vx, `${id} is drifting right`).toBeGreaterThan(0);
    return frames.slice(19);
  }

  it.each(IDS)("%s slows by air_brake_x a frame with the stick neutral", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = drift(id, Btn.Jump, 15);
    let checked = 0;
    for (let i = 1; i < frames.length && !frames[i].grounded; i++) {
      expect(frames[i - 1].vx - frames[i].vx, `${id} neutral frame ${i}`).toBe(Math.min(p.air_brake_x, frames[i - 1].vx));
      checked += 1;
    }
    expect(checked, `${id}: airborne neutral frames measured`).toBeGreaterThanOrEqual(10);
  });

  it("does not slow a fighter who is holding the way they drift", () => {
    const frames = play(standing("mario"), hold(Btn.Jump | Btn.Right, 40)).slice(20, 40);
    expect(frames.every((f) => !f.grounded)).toBe(true);
    expect(frames.every((f) => f.vx === FIGHTER_PARAMS.mario.air_speed_x_stable)).toBe(true);
  });
});

describe("scripted momentum after a full hop's initial rise (Task 18)", () => {
  // A momentum hold replaces every other energy (`kineticMotion`), the full hop's
  // initial rise included. Left running, its counter outlived the hold and its
  // first `kineticExec` replaced the velocity the move had just handed over.
  // The last test below is UNVERIFIED as a game measurement: it pins continuity
  // (starting the move one frame later must not change what the move adds), not a
  // published height.

  const UP_B = Btn.Up | Btn.Special;

  /** A full hop with Jump held for `n` frames, then up-special held. */
  function hopThenUpB(id: RosterId, n: number): FighterState[] {
    return play(standing(id), [...hold(Btn.Jump, n), ...hold(UP_B, 70)]);
  }

  /** The earliest jump-held length after which up-special starts on the very next frame, mid-rise. */
  function firstPress(id: RosterId): number {
    const start = play(standing(id), hold(Btn.Jump, 20)).findIndex((f) => !f.grounded);
    for (let n = start; n < start + 8; n++) {
      if (hopThenUpB(id, n)[n].action === "special") return n;
    }
    throw new Error(`${id} never starts up-special in the first airborne frames`);
  }

  it.each(["mario", "samus"] as const)("%s: up-special on the first actionable airborne frame ends the initial rise", (id) => {
    const n = firstPress(id);
    const frames = hopThenUpB(id, n);
    const first = frames.findIndex((f) => f.kinetic.motionX !== 0 || f.kinetic.motionY !== 0);
    expect(first, `${id}: the move reached its momentum`).toBeGreaterThan(n);
    // The jump was still rising when the press came, or this proves nothing.
    expect(frames[n - 1].kinetic.jumpInitial, `${id}: a rise in progress at the press`).toBeGreaterThan(0);
    expect(frames[first].kinetic.jumpInitial).toBe(0);
  });

  it.each(["mario", "samus"] as const)("%s: the hold's velocity carries on into drift and gravity", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = hopThenUpB(id, firstPress(id));
    const first = frames.findIndex((f) => f.kinetic.motionY !== 0);
    const over = frames.findIndex((f, i) => i > first && f.kinetic.motionY === 0);
    expect(over, `${id}: the hold ended`).toBeGreaterThan(first);
    // Handed to gravity on the hold's last frame, which gravity then acts on as well.
    expect(frames[over].vy).toBe(frames[over - 1].kinetic.motionY - p.air_accel_y);
  });

  it.each(["mario", "samus"] as const)("%s: the height a hold gains does not depend on when in the hop it starts", (id) => {
    // Height from the hold's first frame to the peak. The hop keeps rising a little
    // while the move winds up, so a later press peaks higher; what the move itself
    // adds must be the same.
    const gain = (at: number) => {
      const frames = hopThenUpB(id, at);
      const first = frames.findIndex((f) => f.kinetic.motionY !== 0);
      return Math.max(...frames.slice(first).map((f) => toFloat(f.y))) - toFloat(frames[first].y);
    };
    const n = firstPress(id);
    expect(Math.abs(gain(n) - gain(n + 1)), `${id}`).toBeLessThan(0.1);
  });
});

describe("a midair jump never reads before the start of Kirby's height list", () => {
  // Kirby's air-jump list is indexed by `jumpsUsed − 2`; an airborne fighter that has
  // not spent the ground jump would index −1 and launch with NaN (fix round 1 of Task 20).
  const kirbyAfter = (frames: readonly FighterState[], jumpAt: number) => {
    const f = frames[jumpAt];
    expect(Number.isFinite(f.vy), "the launch speed is a number").toBe(true);
    expect(f.vy, "and it rises").toBeGreaterThan(0);
    const peak = Math.max(...frames.slice(jumpAt).map((g) => toFloat(g.y)));
    expect(peak, "and the fighter really climbs").toBeGreaterThan(toFloat(frames[jumpAt - 1].y) + 1);
  };

  it("holds after a drop-through (Kirby on the Battlefield soft platform: Down, then Jump)", () => {
    const s = standing("kirby", "battlefield");
    expect(s.fighters[0].platform, "standing on a soft platform").toBeGreaterThanOrEqual(0);
    const frames = play(s, [Btn.Down, ...hold(0, 7), Btn.Jump, ...hold(0, 40)]);
    expect(frames[0].grounded, "the drop-through left the platform").toBe(false);
    kirbyAfter(frames, 8);
  });

  it("holds for any airborne fighter whose jumpsUsed is 0", () => {
    const s = standing("kirby", "battlefield");
    const dropped = play(s, [Btn.Down])[0];
    expect(dropped.grounded).toBe(false);
    const forced: GameState = { ...s, fighters: [{ ...dropped, jumpsUsed: 0 }] };
    kirbyAfter(play(forced, [0, 0, Btn.Jump, ...hold(0, 40)]), 2);
  });
});

describe("leaving the ground any way but a jump spends the ground jump (Task 20b)", () => {
  // SmashWiki Double jump (https://www.ssbwiki.com/Double_jump; "Midair jump" redirects there):
  // "Most characters can only jump once while airborne; however, some characters can jump
  // multiple times without touching the ground." SmashWiki Jump (https://www.ssbwiki.com/Jump):
  // "Kirby, Meta Knight, and Jigglypuff can do a midair jump five times." So a fighter in the
  // air has jump_count_max − 1 midair jumps, however it got there.
  //
  // Restoration, same Double jump page: "A character's double jump(s) are restored upon
  // landing, grabbing a ledge, being KO'd and respawning, or being grabbed by an opposing
  // character", and "double jumps are not given back to the player upon being put into
  // hitstun".
  //
  // UNVERIFIED: neither page names the routes this file tests (walking off, drop-through, a
  // hit launch, a ledge drop, respawn, entry, a rising special) one by one. They only say
  // "airborne", so each route takes the walk-off rule: the ground jump is spent, the midair
  // jumps are not.
  const SPACING = 20;
  const TWO_AND_SIX: RosterId[] = ["mario", "kirby"];

  /** A stage whose spawns hang well above the floor, so entry and respawn end in the air. */
  const HIGH_SPAWN = { ...finalDestination, id: "highSpawn", spawns: finalDestination.spawns.map((p) => ({ x: p.x, y: fx(60) })) };
  registerStages([HIGH_SPAWN]);

  /** One input for port 0, nothing for anybody else. */
  const only = (s: GameState, input: InputFrame): InputFrame[] => s.fighters.map((_, i) => (i === 0 ? input : 0));

  /** Hold `input` on port 0 from the start until `done` holds for it; at most `limit` frames. */
  function holdUntil(s0: GameState, input: InputFrame, done: (f: FighterState) => boolean, limit = 400): GameState {
    let s = s0;
    let prev: InputFrame = 0;
    for (let i = 0; i < limit; i++) {
      s = step(s, only(s, input), { prevInputs: only(s, prev) }).state;
      prev = input;
      if (done(s.fighters[0])) return s;
    }
    throw new Error(`never reached the condition within ${limit} frames`);
  }

  /**
   * From `s0`, press jump every SPACING frames (two more presses than the fighter can use) and
   * count the midair jumps it takes before it lands or is KO'd.
   */
  function midairJumps(s0: GameState): number {
    const need = FIGHTER_PARAMS[s0.fighters[0].defId as RosterId].jump_count_max;
    let s = s0;
    let prev: InputFrame = 0;
    let taken = 0;
    for (let i = 0; i < (need + 2) * SPACING; i++) {
      const input = i % SPACING === 0 ? Btn.Jump : 0;
      const before = s.fighters[0];
      s = step(s, only(s, input), { prevInputs: only(s, prev) }).state;
      prev = input;
      const after = s.fighters[0];
      if (after.grounded || after.action === "dead") break;
      if (!before.grounded && after.jumpsUsed > before.jumpsUsed) taken += 1;
    }
    return taken;
  }

  const expected = (id: RosterId) => FIGHTER_PARAMS[id].jump_count_max - 1;

  /** The fighter and a Mario beside it, both settled on Final Destination. */
  function withMario(id: RosterId): GameState {
    let s = createInitialState("finalDestination", [{ defId: id }, { defId: "mario" }], RULES, 7);
    for (let i = 0; i < 80; i++) s = step(s, [0, 0], { prevInputs: [0, 0] }).state;
    return s;
  }

  /**
   * Mario (port 1) throws an up smash at port 0, which must be inside its reach; then nothing
   * until the victim has been launched and its hitstun is over.
   */
  function upSmashed(s0: GameState): GameState {
    let s = step(s0, [0, Btn.Up | Btn.Attack], { prevInputs: [0, 0] }).state;
    let launched = false;
    for (let i = 0; i < 120 && !(launched && s.fighters[0].hitstun === 0); i++) {
      s = step(s, [0, 0], { prevInputs: [0, 0] }).state;
      launched ||= !s.fighters[0].grounded && s.fighters[0].hitstun > 0;
    }
    expect(launched, "the up smash launched the victim").toBe(true);
    return s;
  }

  it.each(TWO_AND_SIX)("%s walking off a platform keeps its midair jumps, and no extra", (id) => {
    const s = holdUntil(standing(id, "battlefield"), Btn.Left, (f) => !f.grounded);
    expect(midairJumps(s)).toBe(expected(id));
  });

  it.each(TWO_AND_SIX)("%s dropping through a soft platform keeps its midair jumps, and no extra", (id) => {
    const s = holdUntil(standing(id, "battlefield"), Btn.Down, (f) => !f.grounded);
    expect(midairJumps(s)).toBe(expected(id));
  });

  it.each(TWO_AND_SIX)("%s rising off the ground on a special spends the ground jump", (id) => {
    // Final Cutter and Super Jump Punch lift the fighter themselves; no jump is taken.
    const s = holdUntil(standing(id), Btn.Up | Btn.Special, (f) => !f.grounded);
    expect(s.fighters[0].action).toBe("special");
    expect(s.fighters[0].jumpsUsed).toBe(1);
  });

  it("Mario, once his rising special is over, has his midair jump and no extra", () => {
    // Kirby's Final Cutter ends on the floor, so only Mario is still airborne to count.
    const s = holdUntil(standing("mario"), Btn.Up | Btn.Special, (f) => !f.grounded);
    const over = holdUntil(s, 0, (f) => f.action !== "special", 200);
    expect(over.fighters[0].grounded, "still airborne when the special ends").toBe(false);
    expect(midairJumps(over)).toBe(expected("mario"));
  });

  it.each(TWO_AND_SIX)("%s launched off the ground by a hit keeps its midair jumps, and no extra", (id) => {
    const s = withMario(id);
    const [victim, attacker] = s.fighters;
    victim.x = fx(0);
    victim.facing = -1;
    attacker.x = fx(-3);
    attacker.facing = 1;
    expect(midairJumps(upSmashed(s))).toBe(expected(id));
  });

  it.each(TWO_AND_SIX)("%s grabbing a ledge gets every midair jump back, and a hit off it adds no extra", (id) => {
    // Out of jumps, just outboard of Final Destination's left ledge (x −80), facing the stage.
    let s = withMario(id);
    Object.assign(s.fighters[0], {
      action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(-82), y: fx(-5),
      intangible: 0, jumpsUsed: FIGHTER_PARAMS[id].jump_count_max, facing: 1,
    });
    s = holdUntil(s, 0, (f) => f.ledge !== null, 60);
    expect(s.fighters[0].jumpsUsed, "the grab restores them: the ground jump stays spent").toBe(1);
    // Mario on the stage, in reach of the hanging fighter, which is past its grab invulnerability.
    Object.assign(s.fighters[1], { x: fx(-76), facing: -1 });
    s.fighters[0].intangible = 0;
    expect(midairJumps(upSmashed(s))).toBe(expected(id));
  });

  it.each(TWO_AND_SIX)("%s leaving the respawn platform keeps its midair jumps, and no extra", (id) => {
    let s = createInitialState("highSpawn", [{ defId: id }], RULES, 7);
    s.fighters[0].y = fx(-150); // under the blast zone: KO'd, then respawned
    s = holdUntil(s, 0, (f) => f.action === "respawnPlatform", 200);
    s = holdUntil(s, Btn.Right, (f) => f.action === "fall", 20);
    expect(s.fighters[0].grounded).toBe(false);
    expect(midairJumps(s)).toBe(expected(id));
  });

  it.each(TWO_AND_SIX)("%s entering from above keeps its midair jumps, and no extra", (id) => {
    const s = holdUntil(createInitialState("highSpawn", [{ defId: id }], RULES, 7), 0, (f) => f.action === "fall");
    expect(midairJumps(s)).toBe(expected(id));
  });

  it.each(TWO_AND_SIX)("%s is not given a midair jump back by a hit", (id) => {
    // Out of jumps, high above the stage, struck by Mario's neutral air: the page says hitstun
    // does not restore them.
    let s = withMario(id);
    const [victim, attacker] = s.fighters;
    const out = FIGHTER_PARAMS[id].jump_count_max;
    Object.assign(victim, { action: "fall", grounded: false, platform: -1, x: fx(0), y: fx(80), intangible: 0, jumpsUsed: out });
    Object.assign(attacker, { action: "fall", grounded: false, platform: -1, x: fx(-3), y: fx(80), intangible: 0, jumpsUsed: 1, facing: 1 });
    s = step(s, [0, Btn.Attack], { prevInputs: [0, 0] }).state;
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      const r = step(s, [0, 0], { prevInputs: [0, 0] });
      s = r.state;
      hit = r.events.hits.length > 0;
    }
    expect(hit, "the neutral air connected").toBe(true);
    expect(s.fighters[0].jumpsUsed).toBe(out);
  });
});

describe("walking (calculator WalkBaseAcceleration / WalkAddAcceleration / WalkSpeed)", () => {
  // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/<fighter>/data.json.
  // As with dash and air acceleration (SmashWiki "Dash", https://www.ssbwiki.com/Dash),
  // a base value applies at any deflection and an additional one scales with it.
  // UNVERIFIED: that the walk's top speed scales linearly with deflection. The game's
  // struct also has walk_slow_speed_mul / walk_middle_ratio / walk_fast_ratio, which no
  // source used here publishes for this roster.

  it.each(IDS)("%s starts a walk at base + additional acceleration on its first frame", (id) => {
    const p = FIGHTER_PARAMS[id];
    const [first] = play(standing(id), [Btn.Right]);
    expect(first.action).toBe("walk");
    expect(first.vx).toBe(p.walk_accel_add + p.walk_accel_mul);
  });

  it.each(IDS)("%s walks at half its top speed on a soft stick (UNVERIFIED half-deflection reading, Plan 1)", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = play(standing(id), hold(Btn.Right | Btn.Soft, 40));
    expect(frames.at(-1)!.action).toBe("walk");
    expect(frames.at(-1)!.vx).toBe(Math.trunc(p.walk_speed_max / 2));
  });

  it.each(IDS)("%s starts a soft walk at base + half the additional acceleration (UNVERIFIED half deflection)", (id) => {
    const p = FIGHTER_PARAMS[id];
    const [first] = play(standing(id), [Btn.Right | Btn.Soft]);
    expect(first.action).toBe("walk");
    expect(first.vx).toBe(p.walk_accel_add + mul(p.walk_accel_mul, ONE >> 1));
  });

  // Literal anchors, so a misread field cannot pass by being read the same way twice:
  // Mario's data.json has WalkBaseAcceleration 0.105, WalkAddAcceleration 0.105 and
  // WalkSpeed 1.155 (https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/mario/data.json).
  it("Mario, by the published numbers: 0.21 on a walk's first frame, 0.105 + 0.105 × ½ on a soft one, 1.155 ÷ 2 soft", () => {
    expect(play(standing("mario"), [Btn.Right])[0].vx).toBe(fx(0.105) + fx(0.105));
    expect(play(standing("mario"), [Btn.Right | Btn.Soft])[0].vx).toBe(fx(0.105) + (fx(0.105) >> 1));
    expect(play(standing("mario"), hold(Btn.Right | Btn.Soft, 40)).at(-1)!.vx).toBe(Math.trunc(fx(1.155) / 2));
  });
});

describe("dash into run (SmashWiki Dash, https://www.ssbwiki.com/Dash)", () => {
  // "there exist two acceleration values for each character's initial dash
  // speed until it reaches their run speed: a base value … and an additional
  // value that is scaled based on how much the control stick is tilted … if it
  // is higher, the character's traction value is used to decrease it down to
  // their run speed." Values: calculator DashInitialSpeed, RunBase/AddAcceleration,
  // RunSpeed, GroundFriction. UNVERIFIED: that `dash_speed` is held for exactly two
  // frames (actionFrame 0 and 1) before the acceleration rule takes over (the page
  // does not say how long).

  it.each(IDS)("%s leaves its initial dash speed by the published rule, and settles at run speed", (id) => {
    const p = FIGHTER_PARAMS[id];
    // Forty frames: long enough to reach run speed, short enough to stay on the stage.
    const frames = play(standing(id), hold(Btn.Right, 40));
    expect(frames.every((f) => f.grounded)).toBe(true);
    const d = frames.findIndex((f) => f.action === "dashStart");
    const v = frames.slice(d).map((f) => f.vx);
    expect(v[0]).toBe(p.dash_speed);
    const next = v.find((x) => x !== p.dash_speed)!;
    const want =
      p.dash_speed > p.run_speed_max
        ? Math.max(p.dash_speed - p.ground_brake, p.run_speed_max)
        : Math.min(p.dash_speed + p.run_accel_add + p.run_accel_mul, p.run_speed_max);
    expect(next).toBe(want);
    expect(v.at(-1)).toBe(p.run_speed_max);
  });

  // Fox dashes slower than he runs (DashInitialSpeed 2.09 < RunSpeed 2.402), so he
  // accelerates out of the dash, and a soft stick is "× deflection" at half.
  // UNVERIFIED: the half-deflection reading of `Btn.Soft` (Plan 1).
  it("Fox, eased to a soft stick mid-dash, accelerates by run_accel_add + run_accel_mul × ½, and still reaches run speed", () => {
    const p = FIGHTER_PARAMS.fox;
    const full = play(standing("fox"), hold(Btn.Right, 40));
    const d = full.findIndex((f) => f.action === "dashStart");
    // dash_speed holds for the dash's first two frames; ease the stick on the third.
    const easeAt = d + 2;
    const soft = play(standing("fox"), [...hold(Btn.Right, easeAt), ...hold(Btn.Right | Btn.Soft, 40)]);
    expect(soft[easeAt - 1].vx).toBe(p.dash_speed);
    expect(full[easeAt].vx).toBe(p.dash_speed + p.run_accel_add + p.run_accel_mul);
    expect(soft[easeAt].vx).toBe(p.dash_speed + p.run_accel_add + mul(p.run_accel_mul, ONE >> 1));
    expect(soft.at(-1)).toMatchObject({ action: "run", vx: p.run_speed_max });
  });
});

describe("a ledge drop and a double jump back (the regrab lockout, LEDGE_REGRAB_LOCKOUT_FRAMES)", () => {
  // The lockout (UNVERIFIED for Ultimate, constants.ts) must not cost a fighter who
  // drops and jumps straight back its way home: within the lockout the regrab is
  // refused, so the double jump has to carry the fighter onto the stage.
  /** Walk off Final Destination's right ledge (x 80) and hang there past the minimum hang. */
  function hangingRight(id: RosterId): GameState {
    let s = standing(id);
    s.fighters[0].x = fx(78);
    let prev: InputFrame = 0;
    for (let i = 0; i < 60 && s.fighters[0].action !== "ledgeHang"; i++) {
      s = step(s, [Btn.Right], { prevInputs: [prev] }).state;
      prev = Btn.Right;
    }
    expect(s.fighters[0].action, "never caught the ledge").toBe("ledgeHang");
    for (let i = 0; i <= LEDGE_HANG_MIN; i++) s = step(s, [0], { prevInputs: [0] }).state;
    expect(s.fighters[0].action).toBe("ledgeHang");
    return s;
  }

  for (const delay of [1, 10, 20]) {
    it.each(IDS)(`%s drops, waits ${delay} frames, double jumps toward the stage, and lands on it`, (id) => {
      const frames = play(hangingRight(id), [Btn.Down, ...hold(0, delay - 1), Btn.Jump | Btn.Left, ...hold(Btn.Left, 150)]);
      expect(frames[0].ledge, "the drop let go").toBeNull();
      expect(frames[delay].jumpsUsed, "the double jump was taken").toBe(2);
      const home = frames.findIndex((f) => f.grounded);
      expect(home, "never landed").toBeGreaterThan(delay);
      expect(frames[home]).toMatchObject({ platform: 0, stocks: 3 });
    });
  }
});

describe("air dodges: each fighter's own lengths and intangibility (Plan 3, Task 20c)", () => {
  // fudgepop01/amiibo_research `fighter_param_motion.xml` @523374aa,
  // https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/fighter_param_motion.xml:
  // `escape_air_stiff_frame`; `escape_air_slide_stiff_frame` / `_u_` / `_d_`;
  // `escape_air_hit_xlu_frame` + `_hit_normal_frame` and the `escape_air_slide_`
  // pair, as the window xlu .. xlu + normal − 1 (SmashWiki "Air dodge"'s Ultimate
  // table, https://www.ssbwiki.com/Air_dodge, has the same windows). Lines per entry.
  const P: Record<RosterId, { lines: string; neutral: number; side: number; up: number; down: number; nWin: [number, number]; dWin: [number, number] }> = {
    mario: { lines: "L22-30, L114-116", neutral: 52, side: 86, up: 115, down: 71, nWin: [3, 29], dWin: [3, 21] },
    donkeyKong: { lines: "L140-148, L232-234", neutral: 49, side: 82, up: 109, down: 66, nWin: [4, 32], dWin: [4, 22] },
    link: { lines: "L258-266, L350-352", neutral: 49, side: 82, up: 108, down: 68, nWin: [3, 30], dWin: [3, 21] },
    samus: { lines: "L376-384, L468-470", neutral: 57, side: 95, up: 129, down: 79, nWin: [3, 29], dWin: [3, 21] },
    kirby: { lines: "L612-620, L704-706", neutral: 61, side: 102, up: 141, down: 82, nWin: [3, 29], dWin: [3, 21] },
    fox: { lines: "L730-738, L822-824", neutral: 38, side: 63, up: 75, down: 54, nWin: [2, 26], dWin: [2, 19] },
    pikachu: { lines: "L848-856, L940-942", neutral: 50, side: 84, up: 109, down: 69, nWin: [2, 26], dWin: [2, 19] },
    marth: { lines: "L2500-2508, L2592-2594", neutral: 51, side: 85, up: 115, down: 68, nWin: [3, 29], dWin: [3, 21] },
  };

  /** The one fighter, still in the air high over Final Destination, free to act. */
  function aloft(id: RosterId): GameState {
    const s = standing(id);
    const f = s.fighters[0];
    Object.assign(f, { y: fx(145), grounded: false, platform: -1, action: "fall", actionFrame: 0, kinetic: emptyKinetic(), vx: 0, vy: 0 });
    return s;
  }
  /** The frames of an air dodge pressed with `dir`, until it ends. */
  function dodgeFrames(id: RosterId, dir: InputFrame): FighterState[] {
    const frames = play(aloft(id), [Btn.Shield | dir, ...hold(0, 160)]);
    const end = frames.findIndex((f) => f.action !== "airDodge");
    expect(frames[end].action, "it ran its length in the air").toBe("fall");
    return frames.slice(0, end);
  }
  const window = (frames: readonly FighterState[]): [number, number] => {
    // `intangible` is a countdown the dodge re-asserts at 1 inside its window.
    const on = frames.filter((f) => f.intangible > 0).map((f) => f.actionFrame);
    return [on[0], on.at(-1)!];
  };

  it.each(IDS)("%s: the neutral and the side, up and down directional lengths are P's", (id) => {
    const p = P[id];
    expect(dodgeFrames(id, 0).length, `neutral, ${p.lines}`).toBe(p.neutral);
    expect(dodgeFrames(id, Btn.Left).length, `side, ${p.lines}`).toBe(p.side);
    expect(dodgeFrames(id, Btn.Up).length, `up, ${p.lines}`).toBe(p.up);
    expect(dodgeFrames(id, Btn.Down).length, `down, ${p.lines}`).toBe(p.down);
  });

  // UNVERIFIED (mods only): HewDraw Remix and ssbexo lerp side and up (or down) by
  // the stick's angle; a keyboard diagonal is 45°, the midpoint, rounded up.
  it.each(IDS)("%s: a diagonal lasts halfway between the side length and the up or down one, rounded up", (id) => {
    const p = P[id];
    expect(dodgeFrames(id, Btn.Right | Btn.Up).length).toBe(Math.ceil((p.side + p.up) / 2));
    expect(dodgeFrames(id, Btn.Left | Btn.Down).length).toBe(Math.ceil((p.side + p.down) / 2));
  });

  it.each(IDS)("%s: intangible on P's frames, neutral and directional", (id) => {
    expect(window(dodgeFrames(id, 0)), P[id].lines).toEqual(P[id].nWin);
    expect(window(dodgeFrames(id, Btn.Right)), P[id].lines).toEqual(P[id].dWin);
  });

  // The CPU's model of a sideways dodge (`sideDodgeTravel`, Task 20c fix round),
  // held to the engine: with nothing held after the press, Q12-exact.
  it.each(IDS)("%s: a sideways dodge travels exactly as far as the CPU reckons", (id) => {
    const def = FIGHTERS.find((f) => f.id === id)!;
    const s = aloft(id);
    const frames = dodgeFrames(id, Btn.Right);
    expect(frames.at(-1)!.x - s.fighters[0].x).toBe(sideDodgeTravel(1, airBrakeFromDef(def), airDodgeFromDef(def)));
  });

  it("is authored by every roster fighter, none left to the engine's default (Mario's)", () => {
    for (const f of FIGHTERS) expect(f.attributes.airDodge, f.id).toBeDefined();
  });

  it("gives Fox the shortest neutral dodge, 38 frames, where the replica used to give everyone 50", () => {
    expect(dodgeFrames("fox", 0).length).toBe(38);
  });
});

describe("light and heavy landings (SmashWiki Lag, https://www.ssbwiki.com/Lag#Landing_lag)", () => {
  // "a heavy landing occurs once a player has been falling at their maximum
  // falling speed for a set amount of time (the amount of time is character
  // dependent)". Values: calculator SoftLandingLag (landing_frame_light),
  // HardLandingLag (landing_frame), FallingFrameToUseHardLandingLag
  // (landing_heavy_frame). UNVERIFIED: that pairing of the calculator's three
  // landing values with those prc names (see FighterParams). UNVERIFIED, both:
  // that a landing's lag is exactly that many frames of the land state, and
  // that the threshold is "at least" (>=) rather than "more than"
  // landing_heavy_frame frames at full fall speed.

  /**
   * Drop a standing fighter from `height` units; the frames that follow. With no
   * input unless `fastFall`, which taps down on the second frame (the stick has
   * to be pressed, not held, and fast fall needs the fighter past its apex).
   */
  function dropFrom(id: RosterId, height: number, fastFall = false): FighterState[] {
    const s = standing(id);
    const f = s.fighters[0];
    Object.assign(f, { y: f.y + fx(height), grounded: false, platform: -1, action: "fall", actionFrame: 0, vx: 0, vy: 0 });
    f.kinetic = emptyKinetic();
    return play(s, fastFall ? [0, ...hold(Btn.Down, 199)] : hold(0, 200));
  }

  function landing(frames: readonly FighterState[]): { lag: number; frames: number } {
    const at = frames.findIndex((f) => f.action === "land");
    expect(at, "the fighter never entered the land state").toBeGreaterThanOrEqual(0);
    let n = 0;
    while (at + n < frames.length && frames[at + n].action === "land") n += 1;
    return { lag: frames[at].charge, frames: n };
  }

  /** What `onLanded` needs to know about `id` and its stage. */
  function contextFor(id: RosterId, fighters: readonly FighterState[]) {
    const def = FIGHTERS.find((d) => d.id === id);
    expect(def, `${id} is on the roster`).toBeDefined();
    return { def: def!, stage: finalDestination, frame: 1, fighters };
  }

  it.each(IDS)("%s lands lightly from a short drop", (id) => {
    const p = FIGHTER_PARAMS[id];
    expect(landing(dropFrom(id, 2))).toEqual({ lag: p.landing_frame_light, frames: p.landing_frame_light });
  });

  it.each(IDS)("%s lands heavily after falling at full speed long enough", (id) => {
    const p = FIGHTER_PARAMS[id];
    expect(landing(dropFrom(id, 80))).toEqual({ lag: p.landing_frame, frames: p.landing_frame });
  });

  it.each(IDS)("%s: one frame short of landing_heavy_frame at full fall speed is light, that many is heavy", (id) => {
    // Pins the `>=` (UNVERIFIED, above): the engine's choice, not a published one.
    const p = FIGHTER_PARAMS[id];
    const landedAfter = (fallFrames: number): [string, number] => {
      const s = standing(id);
      const f = s.fighters[0];
      Object.assign(f, { action: "fall", actionFrame: 0 });
      f.kinetic.fallFrames = fallFrames;
      onLanded(f, contextFor(id, s.fighters));
      return [f.action, f.charge];
    };
    expect(landedAfter(p.landing_heavy_frame - 1)).toEqual(["land", p.landing_frame_light]);
    expect(landedAfter(p.landing_heavy_frame)).toEqual(["land", p.landing_frame]);
  });

  it("counts the frames of a fast fall as frames at full fall speed", () => {
    // UNVERIFIED: that a fast fall counts at all; the Lag page says "maximum
    // falling speed" and a fast fall is faster than that.
    // Mario needs ~12.9 units to reach his 1.5 fall speed (1.5^2 / 2 / 0.087),
    // so a plain fall from 14 spends about a frame at it and lands lightly,
    // while a fast fall (2.4 a frame) spends five and lands heavily.
    const p = FIGHTER_PARAMS.mario;
    expect(landing(dropFrom("mario", 14)).lag).toBe(p.landing_frame_light);
    expect(landing(dropFrom("mario", 14, true)).lag).toBe(p.landing_frame);
  });

  it("makes an auto-cancelled aerial a heavy landing, as the Lag page says (UNVERIFIED for Ultimate: may be Brawl-era)", () => {
    // "Any time a character lands while this flag is not activated, they will
    // enter their normal landing animation … landing during this window will
    // result in a heavy landing."
    const s = standing("mario");
    const f = s.fighters[0];
    Object.assign(f, { action: "attack", move: "fair", actionFrame: 50, grounded: true });
    onLanded(f, contextFor("mario", s.fighters));
    expect([f.action, f.charge]).toEqual(["land", FIGHTER_PARAMS.mario.landing_frame]);
  });
});

describe("rise timing for the renderer (jumpRiseSpeeds)", () => {
  // The renderer and the animation lab time the `jump` clip by how long the
  // `jump` action lasts. They read it from `jumpRiseSpeeds`, so it must be
  // exactly the vertical speed `step()` gives each frame of that action — the
  // rise, plus the frame the speed stops being positive.

  function risingSpeeds(frames: readonly FighterState[], from: number): number[] {
    const out: number[] = [];
    for (let i = from; i < frames.length && frames[i].action === "jump"; i++) out.push(frames[i].vy);
    return out;
  }

  it.each(IDS)("%s: full hop, short hop and first air jump, frame for frame", (id) => {
    const p = FIGHTER_PARAMS[id];
    const full = play(standing(id), hold(Btn.Jump, 120));
    expect(risingSpeeds(full, full.findIndex((f) => f.action === "jump"))).toEqual(jumpRiseSpeeds(p, "full"));
    const short = play(standing(id), [Btn.Jump, ...hold(0, 120)]);
    expect(risingSpeeds(short, short.findIndex((f) => f.action === "jump"))).toEqual(jumpRiseSpeeds(p, "short"));
    // Short hop, then a midair jump; its rise starts on the frame `jumpsUsed` becomes 2.
    const air = play(standing(id), [Btn.Jump, ...hold(0, 8), Btn.Jump, ...hold(0, 90)]);
    expect(risingSpeeds(air, air.findIndex((f) => f.jumpsUsed === 2))).toEqual(jumpRiseSpeeds(p, "air", 0));
  });

  /** Hanging from Final Destination's left ledge (x −80), facing the stage, past the hang's locked first frames. */
  function hanging(id: RosterId): GameState {
    let s = standing(id);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(-82), y: fx(-5), facing: 1 });
    for (let i = 0; i < 60 && s.fighters[0].ledge === null; i++) s = step(s, [0], { prevInputs: [0] }).state;
    expect(s.fighters[0].action, "never caught the ledge").toBe("ledgeHang");
    for (let i = 0; i < LEDGE_HANG_MIN; i++) s = step(s, [0], { prevInputs: [0] }).state;
    return s;
  }

  it.each(IDS)("%s: a jump off the ledge (LEDGE_JUMP_VELOCITY), frame for frame", (id) => {
    // `finishLedgeOption` enters `jump` with `jumpsUsed` 1 and no short hop, as a full hop does,
    // but rises at its own speed, so it is a kind of its own.
    const ledge = play(hanging(id), [Btn.Jump, ...hold(0, 120)]);
    const from = ledge.findIndex((f) => f.action === "jump");
    expect(from, "the ledge jump never left the ledge").toBeGreaterThan(0);
    expect(ledge[from].jumpsUsed).toBe(1);
    expect(ledge[from].shortHop).toBe(false);
    expect(risingSpeeds(ledge, from)).toEqual(jumpRiseSpeeds(FIGHTER_PARAMS[id], "ledge"));
  });
});
