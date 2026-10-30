/**
 * Footstool jumps, through the real `step()` (Plan 5, Task 11).
 *
 * SmashWiki "Footstool Jump" (https://www.ssbwiki.com/Footstool_Jump, revision
 * 2037662): jump over a head to bounce off it; it "does no damage"; a grounded
 * victim is "briefly" frozen, an airborne one is sent to "tumble a set
 * distance" and in Ultimate "teching is possible"; "a footstool cannot cancel
 * out an opponent's move that is in progress" (the phantom footstool);
 * "Players can also footstool off someone hanging on a ledge, but the character
 * being jumped off will not fall and the footstool will not gain as much
 * height"; "each jump resulting in approximately half the rebound"; in Ultimate
 * "characters must wait for 16 frames after attacking before they can
 * footstool"; and "if this results in a Fall, it will count as a KO for the
 * footstooling player". The game's own check, as WuBor Patch reimplements it
 * (a mod, not first-party; `footstool.ts` cites the lines): after a special, an
 * air dodge and an attack, before a wall jump; never out of a tumble.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { airDodgeFrames, airDodgeOf } from "@/engine/airDodge";
import { fx, mul } from "@/engine/fixed";
import {
  FOOTSTOOL_AFTER_ATTACK,
  FOOTSTOOL_AIR_STUN,
  FOOTSTOOL_GROUND_FRAMES,
  FOOTSTOOL_SPEED_DECAY,
  FOOTSTOOL_SPEED_LIMIT,
  TREADED_KIND_OF_ACTION,
} from "@/engine/footstool";
import { hashState } from "@/engine/hash";
import { jumpLaunchSpeed } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { ActionState, FighterDef, FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox, mario } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

/**
 * Mario with no neutral special: a stand-in (not a published fighter) for the
 * one case the roster cannot show, a special press with no special to start.
 */
const NO_NEUTRAL_B: FighterDef = {
  ...mario,
  id: "noNeutralB",
  moves: Object.fromEntries(Object.entries(mario.moves).filter(([slot]) => slot !== "neutralB")),
  scripts: Object.fromEntries(Object.entries(mario.scripts ?? {}).filter(([slot]) => slot !== "neutralB")),
};

beforeAll(() => {
  registerFighters([...FIGHTERS, NO_NEUTRAL_B]);
  registerStages(STAGES);
});

/** Mario falling onto Fox's head; Fox standing, or in the air with him. */
function overHead(foxInAir = false): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 4);
  const foxY = foxInAir ? fx(40) : 0;
  Object.assign(s.fighters[1], { action: foxInAir ? "fall" : "stand", grounded: !foxInAir, platform: foxInAir ? -1 : 0, x: 0, y: foxY, vy: 0, intangible: 0 });
  const head = foxY + fox.attributes.height;
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(1), y: head - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1 });
  return s;
}

/** Port 0 presses `inputs`, port 1 nothing; every state after each step. */
function run(s0: GameState, inputs: readonly InputFrame[], theirs: readonly InputFrame[] = []): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  inputs.forEach((i, n) => {
    const now: InputFrame[] = [i, theirs[n] ?? 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  });
  return out;
}

/** Mario (port 0) dropping onto port 1's head; port 2, when given, is a third fighter. */
function stoolOn(victim: string, third?: string): GameState {
  const ids = third === undefined ? ["mario", victim] : ["mario", victim, third];
  const s = createInitialState("finalDestination", ids.map((defId) => ({ defId })), RULES, 4);
  const def = FIGHTERS.find((f) => f.id === victim)!;
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: i === 2 ? fx(6) : 0, y: 0, vy: 0, intangible: 0 }));
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(1), y: def.attributes.height - fx(1), vy: fx(-1), jumpsUsed: 1 });
  return s;
}

function step1(s: GameState, inputs: InputFrame[] = [Btn.Jump, 0, 0]): GameState {
  return step(s, inputs.slice(0, s.fighters.length), { prevInputs: s.fighters.map(() => 0) }).state;
}

/** Mario's own footstool bounce: his full hop's launch speed. */
const BOUNCE = jumpLaunchSpeed(fighterParams(mario).air_accel_y, fighterParams(mario).jump_y);

describe("footstool jumps", () => {
  it("bounce off a standing head, keep the midair jump, and freeze the one stood on", () => {
    const states = run(overHead(), [Btn.Jump, 0, 0, 0]);
    const [marioNow, foxNow] = states[0].fighters;
    expect(marioNow.action).toBe("jump");
    expect(marioNow.vy).toBeGreaterThan(0);
    expect(marioNow.jumpsUsed).toBe(1);
    expect(marioNow.combat.footstools).toBe(1);
    expect(foxNow.action).toBe("footstooled");
    expect(foxNow.damage).toBe(0);
  });

  it("bounce at the jumper's full hop speed", () => {
    const s = overHead();
    s.fighters[0].vy = 0;
    s.fighters[0].kinetic.gravityY = 0;
    const after = step1(s, [Btn.Jump, 0]);
    // The launch, less the frame's gravity (`jumpLaunchSpeed` is applied with it).
    expect(after.fighters[0].vy).toBe(BOUNCE - fighterParams(mario).air_accel_y);
  });

  it("ends the jumper's fast fall", () => {
    const s = overHead();
    s.fighters[0].fastFalling = true;
    expect(step1(s, [Btn.Jump, 0]).fighters[0].fastFalling).toBe(false);
  });

  it("send an airborne victim tumbling down, with no damage and no launch", () => {
    const states = run(overHead(true), [Btn.Jump, 0, 0]);
    const victim = states[0].fighters[1];
    expect(victim.action).toBe("tumble");
    expect(victim.hitstun).toBe(FOOTSTOOL_AIR_STUN);
    expect(victim.damage).toBe(0);
    // "It does not produce proper knockback": the push is a fall, not a launch.
    expect(victim.launchSpeed).toBe(0);
    expect(victim.vx).toBe(0);
    expect(states[2].fighters[1].vy).toBeLessThan(0);
  });

  it("push an airborne victim down at its full fall speed, even one rising", () => {
    const s = overHead(true);
    s.fighters[1].kinetic.gravityY = fx(2);
    s.fighters[1].vy = fx(2);
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[1].vy).toBe(-fighterParams(fox).air_speed_y_stable);
  });

  it("ends an airborne victim's fast fall: it tumbles at its plain fall speed", () => {
    const s = overHead(true);
    s.fighters[1].fastFalling = true;
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[1].fastFalling).toBe(false);
    expect(after.fighters[1].vy).toBe(-fighterParams(fox).air_speed_y_stable);
  });

  it("wait 16 frames after an attack", () => {
    const s = overHead();
    s.fighters[0].combat.sinceAttack = 3;
    const states = run(s, [Btn.Jump, 0]);
    expect(states[0].fighters[1].action).not.toBe("footstooled");
  });

  it("can footstool on the 16th frame after an attack, not the 15th", () => {
    // `sinceAttack` counts up at the top of the frame, before the jump is read:
    // 15 going in is the 16th frame (SmashWiki's 16, written out, not the constant).
    const at = (since: number): ActionState => {
      const s = overHead();
      s.fighters[0].combat.sinceAttack = since;
      return step1(s, [Btn.Jump, 0]).fighters[1].action;
    };
    expect(FOOTSTOOL_AFTER_ATTACK).toBe(16);
    expect(at(14)).toBe("stand");
    expect(at(15)).toBe("footstooled");
  });

  it("counts a special as attacking", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 4);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: 0, y: fx(120), vy: 0, intangible: 0, jumpsUsed: 1 });
    const states = run(s, [Btn.Special, 0, 0]).map((st) => st.fighters[0]);
    expect(states[1].action).toBe("special");
    expect(states[1].combat.sinceAttack).toBe(0);
  });

  it("counts the wait from the attack's end: 0 through the move, then one a frame", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 4);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: 0, y: fx(120), vy: 0, intangible: 0, jumpsUsed: 1 });
    let state = s;
    let prev: InputFrame = 0;
    const seen: [ActionState, number][] = [];
    for (let i = 0; i < 90; i++) {
      const input = i === 0 ? Btn.Attack : 0;
      state = step(state, [input], { prevInputs: [prev] }).state;
      prev = input;
      seen.push([state.fighters[0].action, state.fighters[0].combat.sinceAttack]);
    }
    const end = seen.findIndex(([a]) => a !== "attack");
    expect(end).toBeGreaterThan(1);
    // It counts at the top of each frame, so from the move's second frame on.
    expect(seen.slice(1, end).every(([, n]) => n === 0)).toBe(true);
    // The hand-off frame is still the attack's (its `main` ran it), then one a frame.
    expect(seen[end][1]).toBe(0);
    expect(seen[end + 1][1]).toBe(1);
    expect(seen[end + 16][1]).toBe(16);
  });

  it("need a head under the feet", () => {
    const s = overHead();
    s.fighters[0].x = fx(30);
    const states = run(s, [Btn.Jump, 0]);
    expect(states[0].fighters[1].action).toBe("stand");
    expect(states[0].fighters[0].jumpsUsed).toBe(2);
  });

  it("need the feet at the head: not above its top, nor too far below it", () => {
    for (const dy of [fx(0.5), fx(-5)]) {
      const s = overHead();
      s.fighters[0].y = fox.attributes.height + dy;
      expect(step1(s, [Btn.Jump, 0]).fighters[1].action, `feet ${dy / 4096} from the top`).toBe("stand");
    }
  });

  it("works with no midair jump left, and gives none back", () => {
    const s = overHead();
    s.fighters[0].jumpsUsed = 2;
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[0].action).toBe("jump");
    expect(after.fighters[0].jumpsUsed).toBe(2);
    expect(after.fighters[1].action).toBe("footstooled");
  });

  it("takes a jump buffered through an air dodge's end", () => {
    const s = overHead();
    const total = airDodgeFrames(airDodgeOf(mario.attributes), 0);
    Object.assign(s.fighters[0], { action: "airDodge", actionFrame: total - 2, charge: 0, airDodged: true });
    const states = run(s, [Btn.Jump, 0]);
    expect(states[0].fighters[0].action).toBe("airDodge");
    expect(states[1].fighters[0].action).toBe("jump");
    expect(states[1].fighters[0].jumpsUsed).toBe(1);
    expect(states[1].fighters[0].bufferedAction).toBeNull();
    expect(states[1].fighters[1].action).toBe("footstooled");
  });

  it("is refused in special fall (SmashWiki \"Helpless\")", () => {
    const s = overHead();
    Object.assign(s.fighters[0], { action: "specialFall" });
    s.fighters[0].combat.helplessMove = "upB";
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[0].action).toBe("specialFall");
    expect(after.fighters[1].action).toBe("stand");
  });

  it("is refused out of a tumble (the vanilla DAMAGE_FALL transitions), where the jump is the midair one", () => {
    const s = overHead();
    Object.assign(s.fighters[0], { action: "tumbleFall" });
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[1].action).toBe("stand");
    expect(after.fighters[0].jumpsUsed).toBe(2);
  });

  it("gives way to a special, an air dodge or an aerial pressed on the same frame (the game's order)", () => {
    const pressed = (keys: InputFrame, airDodged = false): GameState => {
      const s = overHead();
      s.fighters[0].airDodged = airDodged;
      return step1(s, [keys, 0]);
    };
    const attack = pressed(Btn.Jump | Btn.Attack);
    expect([attack.fighters[0].action, attack.fighters[1].action]).toEqual(["attack", "stand"]);
    const special = pressed(Btn.Jump | Btn.Special);
    expect([special.fighters[0].action, special.fighters[1].action]).toEqual(["special", "stand"]);
    const dodge = pressed(Btn.Jump | Btn.Shield);
    expect([dodge.fighters[0].action, dodge.fighters[1].action]).toEqual(["airDodge", "stand"]);
    // With the air dodge spent, the shield press takes nothing, and the footstool goes.
    const spent = pressed(Btn.Jump | Btn.Shield, true);
    expect([spent.fighters[0].action, spent.fighters[1].action]).toEqual(["jump", "footstooled"]);
    // So does a special press with no special to start (a stand-in without one).
    const none = createInitialState("finalDestination", [{ defId: "noNeutralB" }, { defId: "fox" }], RULES, 4);
    Object.assign(none.fighters[1], overHead().fighters[1]);
    Object.assign(none.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(1), y: fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1 });
    const noSpecial = step1(none, [Btn.Jump | Btn.Special, 0]);
    expect([noSpecial.fighters[0].action, noSpecial.fighters[1].action]).toEqual(["jump", "footstooled"]);
  });

  it("comes before a wall jump: a jump pressed away from a wall, over a head, footstools", () => {
    // Mario just touched Final Destination's right wall (to his left) and
    // presses jump and away together; Fox is falling under him.
    const beside = (withFox: boolean): GameState => {
      const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 4);
      const foxY = fx(-40);
      Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: withFox ? fx(85) : fx(-150), y: foxY, vy: 0, intangible: 0 });
      Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(84), y: foxY + fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 2, facing: -1 });
      Object.assign(s.fighters[0].combat, { wallSide: -1, wallFrames: 0 });
      return s;
    };
    // The control: with nobody under him, the same press kicks off the wall.
    const alone = step1(beside(false), [Btn.Jump | Btn.Right, 0]).fighters[0];
    expect(alone.combat.wallJumps).toBe(1);
    const over = step1(beside(true), [Btn.Jump | Btn.Right, 0]);
    expect(over.fighters[0].combat.wallJumps).toBe(0);
    expect(over.fighters[0].combat.footstools).toBe(1);
    expect(over.fighters[1].action).toBe("tumble");
  });

  it("leaves the wall jumps' count as it is: a head is not the ground (SmashWiki \"Wall jump\")", () => {
    const s = overHead();
    s.fighters[0].combat.wallJumps = 2;
    expect(step1(s, [Btn.Jump, 0]).fighters[0].combat.wallJumps).toBe(2);
  });
});

describe("one footstool after another", () => {
  /** Mario's bounce off Fox's head with `footstools` already made since he left the ground. */
  function bounce(footstools: number): FighterState {
    const s = overHead();
    s.fighters[0].vy = 0;
    s.fighters[0].kinetic.gravityY = 0;
    s.fighters[0].combat.footstools = footstools;
    return step1(s, [Btn.Jump, 0]).fighters[0];
  }

  it("bounces each 0.75× as fast as the one before (about half the height)", () => {
    const g = fighterParams(mario).air_accel_y;
    const speeds = [0, 1, 2].map((n) => bounce(n).vy + g);
    expect(speeds[1] / speeds[0]).toBeCloseTo(0.75, 2);
    expect(speeds[2] / speeds[0]).toBeCloseTo(0.5625, 2);
    expect(bounce(1).combat.footstools).toBe(2);
  });

  it("is refused once the bounce would be slower than the limit, and the jump is the midair one", () => {
    // The last footstool Mario has: the most made before it whose bounce is still
    // at least the limit (his full hop's speed, ×0.75 a footstool).
    let last = 0;
    for (let v = mul(BOUNCE, FOOTSTOOL_SPEED_DECAY); v >= FOOTSTOOL_SPEED_LIMIT && last < 50; v = mul(v, FOOTSTOOL_SPEED_DECAY)) last++;
    // Six in a row for Mario, inside SmashWiki's "between two and six times".
    expect(last + 1).toBe(6);
    expect(bounce(last).combat.footstools).toBe(last + 1);
    const refused = bounce(last + 1);
    expect(refused.combat.footstools).toBe(last + 1);
    expect(refused.jumpsUsed).toBe(2);
    // A buffered jump refused so is still the midair jump, not spent on nothing.
    const s = overHead();
    const total = airDodgeFrames(airDodgeOf(mario.attributes), 0);
    Object.assign(s.fighters[0], { action: "airDodge", actionFrame: total - 2, charge: 0, airDodged: true });
    s.fighters[0].combat.footstools = last + 1;
    const states = run(s, [Btn.Jump, 0]);
    expect(states[1].fighters[0].action).toBe("jump");
    expect(states[1].fighters[0].jumpsUsed).toBe(2);
    expect(states[1].fighters[1].action).toBe("stand");
  });

  it("starts again on the ground, on a ledge and after a KO", () => {
    // The ground: a standing frame.
    const ground = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 4);
    Object.assign(ground.fighters[0], { action: "stand", grounded: true, platform: 0, x: 0, y: 0, vy: 0 });
    ground.fighters[0].combat.footstools = 3;
    expect(step(ground, [0], { prevInputs: [0] }).state.fighters[0].combat.footstools).toBe(0);
    // A ledge: Mario falling past Final Destination's right ledge grabs it.
    const ledge = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 4);
    Object.assign(ledge.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(81.5), y: fx(-1), vy: -fx(0.5), intangible: 0, jumpsUsed: 2, facing: -1 });
    ledge.fighters[0].combat.footstools = 3;
    const hung = step(ledge, [0], { prevInputs: [0] }).state.fighters[0];
    expect(hung.action).toBe("ledgeHang");
    expect(hung.combat.footstools).toBe(0);
    // A KO: past the bottom blast line.
    const ko = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 4);
    Object.assign(ko.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(-200), y: fx(-139), vy: -fx(2), intangible: 0 });
    Object.assign(ko.fighters[0].combat, { footstools: 3, sinceAttack: 0 });
    const dead = step(ko, [0, 0], { prevInputs: [0, 0] }).state.fighters[0];
    expect(dead.action).toBe("dead");
    expect(dead.combat.footstools).toBe(0);
    expect(dead.combat.sinceAttack).toBeGreaterThanOrEqual(FOOTSTOOL_AFTER_ATTACK);
  });
});

/** Mario (port 0) dropping onto Fox (port 1) hanging from Final Destination's right ledge. */
function onTheLedge(): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 4);
  const edge = fx(79.995);
  const top = fx(0.005);
  Object.assign(s.fighters[1], { action: "ledgeHang", actionFrame: 5, ledge: { platform: 0, side: 1 }, grounded: false, platform: -1, x: edge, y: top, vy: 0, facing: -1, intangible: 0 });
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: edge - fx(1), y: top + fox.attributes.height - fx(1), vy: 0, intangible: 0, jumpsUsed: 1 });
  s.fighters[0].kinetic.gravityY = 0;
  return s;
}

describe("a footstool that the one stood on does not feel", () => {
  it("off a fighter hanging from a ledge: it keeps hanging, and the bounce is lower", () => {
    const after = step1(onTheLedge(), [Btn.Jump, 0]);
    const [jumper, hanger] = after.fighters;
    expect(hanger.action).toBe("ledgeHang");
    expect(hanger.ledge).not.toBeNull();
    expect(jumper.action).toBe("jump");
    expect(jumper.jumpsUsed).toBe(1);
    const g = fighterParams(mario).air_accel_y;
    expect((jumper.vy + g) / BOUNCE).toBeCloseTo(0.75, 2);
  });

  const UNDER_WAY: [string, ActionState, "jab1" | "nair" | "neutralB", boolean][] = [
    ["a jab", "attack", "jab1", false],
    ["an aerial", "attack", "nair", true],
    ["a special, standing", "special", "neutralB", false],
    ["a special, in the air", "special", "neutralB", true],
  ];
  for (const [what, action, move, airborne] of UNDER_WAY) {
    it(`off ${what} under way: the move goes on, and the jumper still bounces (a phantom footstool)`, () => {
      const s = overHead(airborne);
      Object.assign(s.fighters[1], { action, move, actionFrame: 3 });
      const [jumper, victim] = step1(s, [Btn.Jump, 0]).fighters;
      expect([victim.action, victim.move, victim.actionFrame]).toEqual([action, move, 4]);
      expect(victim.hitstun).toBe(0);
      expect(jumper.action).toBe("jump");
      expect(jumper.jumpsUsed).toBe(1);
      expect(jumper.combat.footstools).toBe(1);
    });
  }

  it("off a shield: the shield stays up (FIGHTER_TREADED_KIND_NO_REAC)", () => {
    const s = overHead();
    Object.assign(s.fighters[1], { action: "shield", actionFrame: 3 });
    const after = run(s, [Btn.Jump, 0], [Btn.Shield, Btn.Shield])[0];
    expect(after.fighters[1].action).toBe("shield");
    expect(after.fighters[0].action).toBe("jump");
    expect(after.fighters[0].jumpsUsed).toBe(1);
  });

  it("from a move begun on the very frame: it goes on too, whichever port is which", () => {
    const layout = (jumperFirst: boolean): GameState => {
      const s = createInitialState("finalDestination", jumperFirst ? [{ defId: "mario" }, { defId: "fox" }] : [{ defId: "fox" }, { defId: "mario" }], RULES, 4);
      const [j, v] = jumperFirst ? [s.fighters[0], s.fighters[1]] : [s.fighters[1], s.fighters[0]];
      Object.assign(v, { action: "stand", grounded: true, platform: 0, x: 0, y: 0, vy: 0, intangible: 0, facing: 1 });
      Object.assign(j, { action: "fall", grounded: false, platform: -1, x: fx(1), y: fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1, facing: 1 });
      return s;
    };
    const a = step1(layout(true), [Btn.Jump, Btn.Attack]);
    const b = step1(layout(false), [Btn.Attack, Btn.Jump]);
    expect(a.fighters[1].action).toBe("attack");
    expect(b.fighters[0].action).toBe("attack");
    expect(a.fighters[0].action).toBe("jump");
    expect(a.fighters[0].combat.footstools).toBe(1);
    expect(hashState(swapPorts(b))).toBe(hashState(a));
  });
});

describe("heads read before anybody moves", () => {
  it("a victim who spot-dodges out of its shield on the very frame dodges, and the jumper still bounces, whichever port is which", () => {
    const layout = (jumperFirst: boolean): GameState => {
      const s = createInitialState("finalDestination", jumperFirst ? [{ defId: "mario" }, { defId: "fox" }] : [{ defId: "fox" }, { defId: "mario" }], RULES, 4);
      const [j, v] = jumperFirst ? [s.fighters[0], s.fighters[1]] : [s.fighters[1], s.fighters[0]];
      Object.assign(v, { action: "shield", actionFrame: 5, grounded: true, platform: 0, x: 0, y: 0, vy: 0, intangible: 0, facing: 1 });
      Object.assign(j, { action: "fall", grounded: false, platform: -1, x: fx(1), y: fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1, facing: 1 });
      return s;
    };
    const dodge = Btn.Shield | Btn.Down;
    const a = step(layout(true), [Btn.Jump, dodge], { prevInputs: [0, Btn.Shield] }).state;
    const b = step(layout(false), [dodge, Btn.Jump], { prevInputs: [Btn.Shield, 0] }).state;
    expect(a.fighters[1].action).toBe("spotDodge");
    expect(a.fighters[0].action).toBe("jump");
    expect(a.fighters[0].jumpsUsed).toBe(1);
    expect(a.fighters[0].combat.footstools).toBe(1);
    expect(hashState(swapPorts(b))).toBe(hashState(a));
  });

  it("stands on the higher of two heads under the feet", () => {
    // Fox on the floor (port 1) and another Fox two units up (port 2), both under
    // Mario's feet, which are a unit under the lower head's top.
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }, { defId: "fox" }], RULES, 4);
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: 0, y: 0, vy: 0, intangible: 0 });
    Object.assign(s.fighters[2], { action: "fall", grounded: false, platform: -1, x: fx(2), y: fx(2), vy: 0, intangible: 0 });
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(1), y: fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1 });
    const out = step(s, [Btn.Jump, 0, 0], { prevInputs: [0, 0, 0] });
    expect(out.events.footstools).toEqual([{ jumper: 0, victim: 2 }]);
    expect(out.state.fighters[1].action).toBe("stand");
  });
});

/** The same match with its two ports swapped, so a layout and its mirror compare by hash. */
function swapPorts(s: GameState): GameState {
  const out = cloneState(s);
  out.fighters = [out.fighters[1], out.fighters[0]];
  out.fighters.forEach((f, i) => {
    f.port = i;
    if (f.grabbing >= 0) f.grabbing = 1 - f.grabbing;
    if (f.grabbedBy >= 0) f.grabbedBy = 1 - f.grabbedBy;
  });
  return out;
}

describe("who cannot be stood on (Plan 5 review)", () => {
  const cases: [string, () => GameState][] = [
    ["a grabbed fighter", () => {
      const s = stoolOn("fox", "donkeyKong");
      Object.assign(s.fighters[1], { action: "grabbed", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "grabHold", grabbing: 1 });
      return s;
    }],
    ["a fighter being thrown", () => {
      const s = stoolOn("fox", "donkeyKong");
      Object.assign(s.fighters[1], { action: "thrown", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "throw", move: "fthrow", grabbing: 1 });
      return s;
    }],
    ["a fighter riding Donkey Kong's shoulders", () => {
      const s = stoolOn("fox", "donkeyKong");
      Object.assign(s.fighters[1], { action: "cargoHeld", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "cargoCarry", grabbing: 1 });
      return s;
    }],
    ["a fighter holding a grab", () => {
      const s = stoolOn("fox", "mario");
      Object.assign(s.fighters[1], { action: "grabHold", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "grabbed", grabbedBy: 1 });
      return s;
    }],
    ["a fighter pummelling", () => {
      const s = stoolOn("fox", "mario");
      Object.assign(s.fighters[1], { action: "pummel", move: "pummel", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "grabbed", grabbedBy: 1 });
      return s;
    }],
    ["a fighter throwing", () => {
      const s = stoolOn("fox", "mario");
      Object.assign(s.fighters[1], { action: "throw", move: "fthrow", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "thrown", grabbedBy: 1 });
      return s;
    }],
    ["Donkey Kong carrying cargo", () => {
      const s = stoolOn("donkeyKong", "fox");
      Object.assign(s.fighters[1], { action: "cargoCarry", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "cargoHeld", grabbedBy: 1 });
      return s;
    }],
    ["a fighter inside Kirby", () => {
      const s = stoolOn("fox", "kirby");
      Object.assign(s.fighters[1], { action: "swallowed", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "inhaleHold", grabbing: 1 });
      return s;
    }],
    ["Kirby with a mouthful", () => {
      const s = stoolOn("kirby", "fox");
      Object.assign(s.fighters[1], { action: "inhaleHold", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "swallowed", grabbedBy: 1 });
      return s;
    }],
    ["Kirby swallowing", () => {
      const s = stoolOn("kirby", "fox");
      Object.assign(s.fighters[1], { action: "special", move: "inhaleSwallow", actionFrame: 2, grabbing: 2 });
      Object.assign(s.fighters[2], { action: "swallowed", grabbedBy: 1 });
      return s;
    }],
    ["a fighter riding Kirby's star", () => {
      const s = stoolOn("fox");
      Object.assign(s.fighters[1], { action: "spatStar", grounded: false, platform: -1 });
      return s;
    }],
    ["a fighter on the respawn platform", () => {
      const s = stoolOn("fox");
      Object.assign(s.fighters[1], { action: "respawnPlatform", grounded: false, platform: -1 });
      return s;
    }],
    ["a fighter spot-dodging, outside its intangible frames (FIGHTER_TREADED_KIND_DISABLE)", () => {
      const s = stoolOn("fox");
      Object.assign(s.fighters[1], { action: "spotDodge", actionFrame: 1 });
      return s;
    }],
    ["an invincible fighter", () => {
      const s = stoolOn("fox");
      s.fighters[1].invincible = 60;
      return s;
    }],
    ["an intangible fighter", () => {
      const s = stoolOn("fox");
      s.fighters[1].intangible = 10;
      return s;
    }],
    ["a frozen fighter (DECISION, UNVERIFIED)", () => {
      const s = stoolOn("fox");
      s.fighters[1].hitlag = 5;
      return s;
    }],
    ["a fighter in hitstun (DECISION, UNVERIFIED): the launch is not overwritten", () => {
      const s = stoolOn("fox");
      Object.assign(s.fighters[1], { action: "tumble", grounded: false, platform: -1, hitstun: 20, vx: fx(2), vy: fx(-1) });
      return s;
    }],
  ];
  for (const [name, make] of cases) {
    it(`not ${name}`, () => {
      const s0 = make();
      const before = { ...s0.fighters[1] };
      const after = step1(s0);
      // Mario's jump was his own midair jump, not a footstool...
      expect(after.fighters[0].jumpsUsed).toBe(2);
      expect(after.fighters[0].combat.footstools).toBe(0);
      // ...and the one under him is not footstooled, standing or in the air.
      expect(after.fighters[1].action).not.toBe("footstooled");
      expect(after.fighters[1].hitstun).toBeLessThanOrEqual(before.hitstun);
      if (before.action === "tumble") {
        expect(after.fighters[1].vx).toBe(before.vx);
        expect(after.fighters[1].hitstun).toBe(before.hitstun - 1);
      }
    });
  }

  it("names a footstool kind for every action, the held and holding ones closed", () => {
    for (const a of ["grabbed", "thrown", "cargoHeld", "cargoCarry", "grabHold", "pummel", "inhaleHold", "swallowed", "spatStar", "dead", "entering", "respawnPlatform"] as const) {
      expect(TREADED_KIND_OF_ACTION[a], a).toBe("DISABLE");
    }
    expect(TREADED_KIND_OF_ACTION.attack).toBe("NO_REAC");
    expect(TREADED_KIND_OF_ACTION.ledgeHang).toBe("NO_REAC");
    expect(TREADED_KIND_OF_ACTION.stand).toBe("ENABLE");
  });
});

describe("the one stood on", () => {
  it("stays still footstooled for its frames, and a press on the last acts on the next", () => {
    // UNVERIFIED (the page says "briefly"): 30, the brief's.
    const frames = 30;
    expect(FOOTSTOOL_GROUND_FRAMES).toBe(frames);
    // Fox presses attack on the footstool's last frame and nothing before.
    const theirs = Array.from({ length: frames + 3 }, (_, i) => (i === frames ? Btn.Attack : 0));
    const states = run(overHead(), [Btn.Jump, ...Array<InputFrame>(frames + 2).fill(0)], theirs);
    const fx0 = states[0].fighters[1].x;
    for (let i = 0; i < frames; i++) {
      expect(states[i].fighters[1].action, `frame ${i}`).toBe("footstooled");
      expect(states[i].fighters[1].x).toBe(fx0);
    }
    expect(states[frames].fighters[1].action).toBe("stand");
    expect(states[frames + 1].fighters[1].action).toBe("attack");
  });

  it("in the air, lies down on landing without a tech, and never bounces", () => {
    const s = overHead(true);
    s.fighters[1].y = fx(6);
    s.fighters[0].y = fx(6) + fox.attributes.height - fx(1);
    const states = run(s, [Btn.Jump, ...Array<InputFrame>(20).fill(0)]);
    const landed = states.findIndex((st) => st.fighters[1].grounded);
    expect(landed).toBeGreaterThan(0);
    expect(states[landed].fighters[1].action).toBe("downed");
  });

  it("in the air, techs the floor with a shield press (SmashWiki: \"In Ultimate, teching is possible\")", () => {
    const s = overHead(true);
    s.fighters[1].y = fx(6);
    s.fighters[0].y = fx(6) + fox.attributes.height - fx(1);
    const states = run(s, [Btn.Jump, ...Array<InputFrame>(20).fill(0)], [0, 0, Btn.Shield]);
    const landed = states.findIndex((st) => st.fighters[1].grounded);
    expect(["tech", "techRoll"]).toContain(states[landed].fighters[1].action);
  });

  it("out of special fall: the footstool's tumble ends it (UNVERIFIED), as a hit's reel does", () => {
    const s = overHead(true);
    s.fighters[1].action = "specialFall";
    s.fighters[1].combat.helplessMove = "upB";
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[1].action).toBe("tumble");
    expect(after.fighters[1].combat.helplessMove).toBeNull();
  });
});

describe("footstool details (Plan 5 review)", () => {
  it("ends a short hop's damage penalty: the bounce is a full jump", () => {
    const s = overHead();
    s.fighters[0].shortHop = true;
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[0].action).toBe("jump");
    expect(after.fighters[0].jumpsUsed).toBe(1);
    expect(after.fighters[0].shortHop).toBe(false);
  });

  /** A jumper over a victim, standing or in the air, the jumper on port 0 or 1. */
  const layout = (jumperFirst: boolean, airborne: boolean): GameState => {
    const s = createInitialState("finalDestination", jumperFirst ? [{ defId: "mario" }, { defId: "fox" }] : [{ defId: "fox" }, { defId: "mario" }], RULES, 4);
    const [j, v] = jumperFirst ? [s.fighters[0], s.fighters[1]] : [s.fighters[1], s.fighters[0]];
    const vy = airborne ? fx(40) : 0;
    Object.assign(v, { action: airborne ? "fall" : "stand", grounded: !airborne, platform: airborne ? -1 : 0, x: 0, y: vy, vy: 0, intangible: 0, facing: 1, jumpsUsed: airborne ? 1 : 0 });
    Object.assign(j, { action: "fall", grounded: false, platform: -1, x: fx(1), y: vy + fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1, facing: 1 });
    return s;
  };

  for (const airborne of [false, true]) {
    it(`comes out the same whichever port the jumper and the victim are on (victim ${airborne ? "in the air" : "standing"})`, () => {
      // The victim acts on the very frame it is stood on: it jumps (a jump squat
      // standing, its midair jump in the air), and the footstool still lands.
      const a = step1(layout(true, airborne), [Btn.Jump, Btn.Jump]);
      const b = step1(layout(false, airborne), [Btn.Jump, Btn.Jump]);
      const pick = (f: GameState["fighters"][number]) => [f.action, f.move, f.x, f.y, f.vx, f.vy, f.jumpsUsed, f.hitstun];
      expect(pick(a.fighters[0])).toEqual(pick(b.fighters[1]));
      expect(pick(a.fighters[1])).toEqual(pick(b.fighters[0]));
      expect(hashState(swapPorts(b))).toBe(hashState(a));
      expect(a.fighters[1].action).toBe(airborne ? "tumble" : "footstooled");
      if (airborne) expect(a.fighters[1].jumpsUsed).toBe(2);
    });
  }

  for (const jumperFirst of [true, false]) {
    it(`re-simulates identically across a rollback around a footstool (jumper on port ${jumperFirst ? 0 : 1})`, () => {
      const j = jumperFirst ? 0 : 1;
      const at = (i: number): InputFrame[] => {
        const out: InputFrame[] = [0, 0];
        if (i === 2) out[j] = Btn.Jump;
        return out;
      };
      const frames = 40;
      const s0 = layout(jumperFirst, false);
      // Two frames of falling first: Mario's feet start a unit under the head's top.
      s0.fighters[j].y += fx(2);
      const live: GameState[] = [];
      let s = s0;
      for (let i = 0; i < frames; i++) {
        s = step(s, at(i), { prevInputs: i === 0 ? [0, 0] : at(i - 1) }).state;
        live.push(s);
      }
      expect(live[2].fighters[1 - j].action).toBe("footstooled");
      for (const from of [1, 2, 3, 10]) {
        let replay = cloneState(live[from]);
        expect(hashState(replay)).toBe(hashState(live[from]));
        for (let i = from + 1; i < frames; i++) replay = step(replay, at(i), { prevInputs: at(i - 1) }).state;
        expect(hashState(replay), `rolled back to ${from}`).toBe(hashState(live[frames - 1]));
      }
    });
  }

  it("reports who stood on whom, for the kill credit (SmashWiki: \"it will count as a KO for the footstooling player\")", () => {
    const out = step(overHead(true), [Btn.Jump, 0], { prevInputs: [0, 0] });
    expect(out.events.footstools).toEqual([{ jumper: 0, victim: 1 }]);
    // A phantom footstool reaches nobody, so it reports nothing.
    const s = onTheLedge();
    expect(step(s, [Btn.Jump, 0], { prevInputs: [0, 0] }).events.footstools).toEqual([]);
  });
});
