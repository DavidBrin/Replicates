import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { initialRiseStep, jumpLaunchSpeed } from "@/engine/kinetic";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
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

  it.each(IDS)("%s air dodge inside the initial rise: it ends the rise, and the dodge holds still", (id) => {
    const s = standing(id);
    const start = play(s, hold(Btn.Jump, 120)).findIndex((f) => !f.grounded);
    // Shield pressed on the third airborne frame, with the jump still held: mid-rise.
    const frames = play(s, [...hold(Btn.Jump, start + 2), ...hold(Btn.Jump | Btn.Shield, 8)]);
    const dodge = frames.findIndex((f) => f.action === "airDodge");
    expect(dodge, "the air dodge starts on the press").toBe(start + 2);
    for (let n = 0; n <= 5; n++) {
      expect(frames[dodge + n].kinetic.jumpInitial).toBe(0);
      expect(frames[dodge + n].y, `dodge frame ${n}`).toBe(frames[dodge - 1].y);
    }
  });

  it.each(IDS)("%s air jump: rises the published height of its first midair jump", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    // Short hop, then a fresh jump press on its sixth airborne frame, well before it lands.
    const frames = play(s, [Btn.Jump, ...hold(0, 8), Btn.Jump, ...hold(0, 90)]);
    const jumpAt = 9;
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
