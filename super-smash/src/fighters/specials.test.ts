/**
 * The specials that are made of movement, driven through the real simulation.
 *
 * ## Why this file exists
 *
 * `MoveDef.momentum` and `MoveDef.superArmourFrames` were both in the type from
 * the start, both used by the roster, and both read by nothing. The visible
 * consequence was that **no fighter could recover**: up-special played its
 * animation and left you exactly where you were, so every hit that sent you off
 * the stage was a stock, for all eight fighters, from the first match.
 *
 * Nothing caught it, and the reason is worth stating. Every unit test around it
 * passed: the frame data was well-formed, `specialSlot` returned `"upB"` for an
 * up input, the state machine entered `special`, the animation played. The
 * property nobody had written down is the one a player would notice in ten
 * seconds — that pressing up-special off the side of the stage gets you back.
 *
 * So these tests run the actual `step()` loop with the actual roster and assert
 * on where the fighter ends up. Nothing here inspects `momentum` directly; a
 * test that read the same table the code reads would pass just as happily
 * against an engine that ignored it, which is exactly the failure that shipped.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { fx, toFloat } from "@/engine/fixed";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { FIGHTERS } from "./index";
import { STAGES } from "@/stages";

const RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 60 * 60 * 7,
  smashBall: false,
  oneOnOne: false,
};

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** One fighter, alone, dropped into the air well above the stage. */
function airborne(defId: string): GameState {
  const state = createInitialState("finalDestination", [{ defId }], RULES, 0x51de);
  const f = state.fighters[0];
  f.action = "fall";
  f.actionFrame = 0;
  f.grounded = false;
  f.platform = -1;
  f.x = fx(0);
  f.y = fx(70);
  f.vx = 0;
  f.vy = 0;
  f.facing = 1;
  return state;
}

/**
 * Run `frames` of simulation on one input, reporting every frame.
 *
 * The input is held rather than tapped because that is how a recovery is
 * actually done, and because a special that only moved you on the frame it was
 * pressed would pass a one-frame check and still be useless.
 */
function run(state: GameState, input: InputFrame, frames: number): FighterState[] {
  let s = state;
  let prev: InputFrame = 0;
  const seen: FighterState[] = [];
  for (let i = 0; i < frames; i++) {
    const result = step(s, [input], { prevInputs: [prev] });
    s = result.state;
    prev = input;
    seen.push(s.fighters[0]);
  }
  return seen;
}

const UP_SPECIAL = Btn.Up | Btn.Special;

describe("every fighter can recover", () => {
  for (const fighter of FIGHTERS) {
    it(`${fighter.id}'s up-special gains height`, () => {
      const state = airborne(fighter.id);
      const startY = toFloat(state.fighters[0].y);

      const frames = run(state, UP_SPECIAL, 90);
      const peak = Math.max(...frames.map((f) => toFloat(f.y)));

      // A fighter falls under gravity from the first frame, so merely "did not
      // go down" would be a real result. The bar is a fighter's own height:
      // less than that is not a recovery, it is a stumble.
      expect(peak - startY, `${fighter.id} rose ${(peak - startY).toFixed(1)}`).toBeGreaterThan(13);
    });

    it(`${fighter.id}'s up-special enters the special state at all`, () => {
      // Guards the test above against passing for the wrong reason: if the
      // input never reached the move, a fighter who happened to drift upward
      // would still look like a recovery.
      const frames = run(airborne(fighter.id), UP_SPECIAL, 10);
      expect(frames.some((f) => f.action === "special" && f.move === "upB")).toBe(true);
    });
  }
});

describe("Kirby's Stone is a stone", () => {
  it("falls markedly faster than Kirby otherwise does", () => {
    // Against his own fast fall, not against a constant: the claim is that the
    // rock is heavy, and "heavy" only means anything relative to the puffball.
    // Twenty frames, which is short enough that neither run has reached the
    // ground — a comparison that ends with both of them stopped on the floor
    // measures the floor, not the fall.
    const fastFalling = run(airborne("kirby"), Btn.Down, 20);
    const stone = run(airborne("kirby"), Btn.Down | Btn.Special, 20);

    // Terminal speed, not distance travelled: distance mixes in however long
    // the transformation takes, so it understates the difference and would
    // still pass if the Stone fell at a brisk walk.
    const fastest = (frames: FighterState[]) => Math.min(...frames.map((f) => toFloat(f.vy)));
    expect(fastest(stone)).toBeLessThan(fastest(fastFalling) * 1.8);

    const dropOf = (frames: FighterState[]) => 70 - Math.min(...frames.map((f) => toFloat(f.y)));
    expect(dropOf(stone)).toBeGreaterThan(dropOf(fastFalling));
  });

  it("sits still on the ground rather than falling out of the world", () => {
    const state = createInitialState("finalDestination", [{ defId: "kirby" }], RULES, 11);
    const f = state.fighters[0];
    f.action = "stand";
    f.actionFrame = 0;
    f.grounded = true;
    f.platform = 0;
    f.intangible = 0;
    f.x = 0;
    f.y = 0;

    const frames = run(state, Btn.Down | Btn.Special, 40);
    const lowest = Math.min(...frames.map((g) => toFloat(g.y)));
    expect(lowest).toBeGreaterThanOrEqual(-0.001);
  });

  it("shrugs off a hit instead of being launched by it", () => {
    // The armour is the move. Kirby drops through the middle of a fight and the
    // point is that nothing stops him — he takes the damage and keeps going.
    const state = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], RULES, 7);
    const kirby = state.fighters[0];
    const mario = state.fighters[1];

    kirby.action = "special";
    kirby.move = "downB";
    // Inside the armour window declared on the move.
    kirby.actionFrame = 20;
    kirby.grounded = true;
    kirby.x = fx(0);
    kirby.y = 0;
    // Fighters spawn intangible, and an intangible victim is skipped before
    // armour is ever consulted — so without this the test would pass by
    // reporting no hit at all, which is the opposite of what it claims.
    kirby.intangible = 0;
    kirby.invincible = 0;

    mario.action = "attack";
    mario.move = "fsmash";
    mario.actionFrame = 14;
    mario.grounded = true;
    mario.x = fx(-7);
    mario.y = 0;
    mario.facing = 1;
    mario.hitThisMove = [];

    const after = step(state, [0, 0], { prevInputs: [0, 0] });
    const hitKirby = after.state.fighters[0];

    expect(after.events.hits.length, "the hit should still land").toBeGreaterThan(0);
    expect(toFloat(hitKirby.damage), "and still hurt").toBeGreaterThan(0);
    // But not move him: no launch, no hitstun, still doing his move.
    expect(hitKirby.hitstun).toBe(0);
    expect(hitKirby.action).toBe("special");
  });
});

describe("Fox Illusion actually crosses ground", () => {
  it("carries Fox further than walking would", () => {
    // Started well left of the ledge, and stopped before either run could
    // reach it: at the edge both are clamped to the same x and the comparison
    // silently becomes "the stage is as wide as the stage".
    const start = fx(-70);

    // Standing on the ground, not spawning: a fighter in the entry animation
    // cannot act, so the special press lands on a frame that ignores it and
    // both runs turn into the same plain dash.
    const onGround = (s: GameState) => {
      const f = s.fighters[0];
      f.action = "stand";
      f.actionFrame = 0;
      f.grounded = true;
      f.platform = 0;
      f.intangible = 0;
      f.x = start;
      f.y = 0;
      f.facing = 1;
      return s;
    };

    const state = onGround(createInitialState("finalDestination", [{ defId: "fox" }], RULES, 3));
    const illusion = run(state, Btn.Right | Btn.Special, 34);
    const travelled = toFloat(illusion[illusion.length - 1].x);

    const walkState = onGround(createInitialState("finalDestination", [{ defId: "fox" }], RULES, 3));
    const walked = run(walkState, Btn.Right, 34);
    const walkedTo = toFloat(walked[walked.length - 1].x);

    expect(walkedTo, "the walk must not have hit the ledge").toBeLessThan(80);

    expect(travelled).toBeGreaterThan(walkedTo);
  });
});

/**
 * The same class of bug as the two above, found the same way and one layer up.
 *
 * `thrown` is an action state with its own handler in `states.ts`, its own
 * entry in `poseNameFor`, its own place in the draw order, and its own
 * animation. Nothing ever put a fighter into it: a throw's victim went from
 * `grabbed` straight to `hitstun`, so the carry — the part of a throw where the
 * victim has stopped struggling and is already committed to a trajectory — was
 * drawn as a fighter still fighting the grip.
 */
describe("a thrown fighter is thrown", () => {
  /** Two fighters, side by side on the ground, one already holding the other. */
  function held(): GameState {
    const state = createInitialState(
      "finalDestination",
      [{ defId: "mario" }, { defId: "kirby" }],
      RULES,
      0x9a12,
    );
    const [a, v] = state.fighters;
    for (const f of state.fighters) {
      f.action = "stand";
      f.actionFrame = 0;
      f.grounded = true;
      f.platform = 0;
      f.y = fx(0);
      f.intangible = 0;
      f.invincible = 0;
    }
    a.x = fx(0);
    a.facing = 1;
    a.action = "grabHold";
    a.grabbing = v.port;
    v.grabTimer = 90; // the escape timer is the victim's (Plan 3, Task 14)
    v.x = fx(4);
    v.facing = -1;
    v.action = "grabbed";
    v.grabbedBy = a.port;
    return state;
  }

  function play(inputs: [number, number], frames: number): FighterState[][] {
    let s = held();
    let prev: [number, number] = [0, 0];
    const seen: FighterState[][] = [];
    for (let i = 0; i < frames; i++) {
      const result = step(s, inputs, { prevInputs: prev });
      s = result.state;
      prev = inputs;
      seen.push(s.fighters.map((f) => ({ ...f })));
    }
    return seen;
  }

  // A direction alone throws; the attack button pummels. Getting this the
  // wrong way round is how the first draft of this test passed nothing.
  it("carries the victim in `thrown` rather than in `grabbed`", () => {
    const frames = play([Btn.Right, 0], 40);
    const victim = frames.map((f) => f[1]);
    expect(frames.some((f) => f[0].action === "throw")).toBe(true);
    expect(victim.some((v) => v.action === "thrown")).toBe(true);
  });

  it("lets go of them again", () => {
    // The carry holds while the thrower still has them, so the guard that
    // keeps it from ending on its first frame must not keep it for ever.
    const victim = play([Btn.Right, 0], 200).map((f) => f[1]);
    const last = victim[victim.length - 1];
    expect(last.grabbedBy).toBe(-1);
    expect(last.action).not.toBe("thrown");
    expect(last.action).not.toBe("grabbed");
  });
});

/**
 * Every fighter's pummel and four throws, through the real roster (Plan 3, Task
 * 14, fix round 1). Before it, a pummel landed only if the victim happened to be
 * caught within about 5 units, and then released and launched the victim; a back
 * throw never landed for anyone, Samus's throws never landed (she grabs from 10
 * units out) and an up or down throw landed only within 4 to 6 units. SSBU's
 * throws are `ATTACK_ABS` and its pummel is catch-only (`set_catch_only_all`):
 * both hit the held fighter, with no collision test (SmashWiki "Pummel",
 * https://www.ssbwiki.com/Pummel: pummels "continue until the opponent is
 * eventually thrown or breaks free").
 */
describe("every fighter's pummel and throws land on the fighter held", () => {
  /** `holder` holding `victim`, both on Final Destination's floor, the holder facing right. */
  function holding(holder: string, victim: string): GameState {
    const state = createInitialState("finalDestination", [{ defId: holder }, { defId: victim }], RULES, 0x70a1);
    const [a, v] = state.fighters;
    for (const f of state.fighters) {
      f.action = "stand";
      f.actionFrame = 0;
      f.grounded = true;
      f.platform = 0;
      f.y = fx(0);
      f.intangible = 0;
      f.invincible = 0;
    }
    a.x = fx(0);
    a.facing = 1;
    a.action = "grabHold";
    a.grabbing = v.port;
    v.x = fx(5);
    v.facing = -1;
    v.action = "grabbed";
    v.actionFrame = 30;
    v.grabbedBy = a.port;
    v.grabTimer = 400;
    return state;
  }

  /** Fighter 0 presses `button` on tick 2; every tick is returned. */
  function press(state: GameState, button: number, ticks: number): { state: GameState; events: StepEvents }[] {
    let s = state;
    let prev: [number, number] = [0, 0];
    const out: { state: GameState; events: StepEvents }[] = [];
    for (let i = 0; i < ticks; i++) {
      const inputs: [number, number] = [i === 2 ? button : 0, 0];
      const r = step(s, inputs, { prevInputs: prev });
      s = r.state;
      prev = inputs;
      out.push(r);
    }
    return out;
  }

  const victimFor = (id: string): string => (id === "mario" ? "kirby" : "mario");

  it.each(FIGHTERS.map((f) => f.id))("%s: the pummel damages the fighter held and does not release it", (id) => {
    const ticks = press(holding(id, victimFor(id)), Btn.Attack, 30);
    const hit = ticks.findIndex((t) => t.events.hits.length > 0);
    expect(hit, "the pummel should land").toBeGreaterThan(0);
    expect(ticks[hit].events.hits[0]).toMatchObject({ attacker: 0, victim: 1, knockback: 0 });
    const v = ticks[hit].state.fighters[1];
    expect(v.damage).toBeGreaterThan(0);
    expect(v).toMatchObject({ action: "grabbed", grabbedBy: 0, hitstun: 0 });
    expect(ticks.at(-1)!.state.fighters[1]).toMatchObject({ grabbedBy: 0, vx: 0 });
  });

  const THROWS = [
    ["fthrow", Btn.Right],
    ["bthrow", Btn.Left],
    ["uthrow", Btn.Up],
    ["dthrow", Btn.Down],
  ] as const;

  describe.each(FIGHTERS.map((f) => [f.id, f] as const))("%s", (id, def) => {
    it.each(THROWS)("%s lands once and launches the way its box points (a back throw, behind)", (slot, button) => {
      const ticks = press(holding(id, victimFor(id)), button, 140);
      const hits = ticks.flatMap((t) => t.events.hits);
      expect(hits, "the throw should land").toHaveLength(1);
      const hit = ticks.findIndex((t) => t.events.hits.length > 0);
      const box = def.moves[slot]!.hitboxes.find((h) => h.id === hits[0].hitboxId)!;
      // The victim is no longer held, and is launched when the freeze ends.
      const out = ticks.findIndex((t, i) => i > hit && t.state.fighters[1].hitlag === 0);
      const v = ticks[out].state.fighters[1];
      expect(v.grabbedBy).toBe(-1);
      expect(v.hitstun).toBeGreaterThan(0);
      // The holder faces right, so "forward" is +x.
      const cos = Math.cos((toFloat(box.angle) * Math.PI) / 180);
      if (slot === "bthrow") expect(v.vx).toBeLessThan(0);
      else if (Math.abs(cos) < 0.05) expect(Math.abs(v.vx)).toBeLessThan(Math.abs(v.vy) * 0.2 + 1);
      else expect(Math.sign(v.vx)).toBe(Math.sign(cos));
      // The thrower finishes the throw and stands.
      expect(ticks.at(-1)!.state.fighters[0]).toMatchObject({ action: "stand", grabbing: -1 });
    });
  });
});

/**
 * A dash grab near the edge (Plan 3, Task 14, fix round 2). The catch statuses had
 * no cliff stop, so the holder slid off the stage still holding, took the ledge,
 * and carried the victim through every ledge option: at 150% a drop through the
 * bottom blast zone was a double KO. SSBU's catch statuses stop at the cliff
 * (`GROUND_CORRECT_KIND_GROUND_CLIFF_STOP`).
 */
describe("a dash grab near the edge never takes the holder off the stage", () => {
  /**
   * `holder` dashes right from the middle of FD and grabs on frame `at`; `victim` stands `gap` units
   * short of the 80 edge. `later` is a button pressed once, on the frame given (a drop off the ledge).
   */
  function dashGrab(
    holder: string,
    victim: string,
    gap: number,
    at: number,
    damage = 0,
    later?: readonly [frame: number, button: number],
  ): { states: GameState[]; kos: number } {
    let s = createInitialState("finalDestination", [{ defId: holder }, { defId: victim }], RULES, 0x9a12);
    for (const f of s.fighters) {
      f.action = "stand";
      f.actionFrame = 0;
      f.grounded = true;
      f.platform = 0;
      f.y = fx(0);
      f.intangible = 0;
      f.invincible = 0;
    }
    s.fighters[0].x = fx(40);
    s.fighters[0].facing = 1;
    s.fighters[1].x = fx(80 - gap);
    s.fighters[1].facing = -1;
    s.fighters[1].damage = fx(damage);
    let prev: [number, number] = [0, 0];
    const states: GameState[] = [];
    let kos = 0;
    for (let i = 0; i < 180; i++) {
      const press = later !== undefined && i === later[0] ? later[1] : 0;
      const inputs: [number, number] = [i < at ? Btn.Right : i === at ? Btn.Grab | Btn.Right : press, 0];
      const r = step(s, inputs, { prevInputs: prev });
      s = r.state;
      prev = inputs;
      kos += r.events.kos.length;
      states.push(s);
    }
    return { states, kos };
  }

  it("keeps a holder on the stage, grounded, for as long as it holds, whoever it grabs", () => {
    let held = 0;
    for (const holder of FIGHTERS.map((f) => f.id)) {
      for (let at = 8; at <= 24; at++) {
        // (A holder that has not grabbed yet and runs off the edge by itself is not what is tested.)
        const { states } = dashGrab(holder, "mario", 1, at);
        for (const s of states) {
          const [a, v] = s.fighters;
          if (a.grabbing < 0) continue;
          held += 1;
          expect(a.grounded, `${holder}, grab on ${at}`).toBe(true);
          expect(Math.abs(toFloat(a.x)), `${holder}, grab on ${at}`).toBeLessThanOrEqual(80);
          expect(v.y).toBe(a.y);
        }
      }
    }
    // It must have caught somebody, or this proves nothing.
    expect(held).toBeGreaterThan(500);
  });

  // The holder pressed down on frame 40: it used to drop off the ledge with the victim, 345 frames
  // of hold at 150%, and both went through the bottom blast zone on frame 141. The 180 frames played
  // run past that, so "no KO" is the whole drop, not a window that ends before it could happen.
  it("does not carry a victim at 150% over the edge: nobody is KO'd in 180 frames, past the old KO on frame 141", () => {
    const { states, kos } = dashGrab("mario", "mario", 0.5, 18, 150, [40, Btn.Down]);
    expect(states.length).toBeGreaterThan(141);
    expect(kos).toBe(0);
    expect(states.some((s) => s.fighters[0].grabbing >= 0)).toBe(true);
    expect(states.at(-1)!.fighters.map((f) => f.stocks)).toEqual([3, 3]);
  });
});

/**
 * Donkey Kong's Headbutt (Plan 3 final wave, part 2, item 2; the final review's
 * Important 2). Its legacy box is 270°, and SmashWiki files it under "Meteor
 * smashes (SSBU)" ("Donkey Kong (SSBU)/Side special",
 * https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Side_special): an airborne victim is
 * spiked. On the ground it buries, which is a Plan 5 special; until then a
 * grounded victim it tumbles takes the release's one floor bounce (UNVERIFIED: a
 * stand-in for the bury).
 */
describe("Donkey Kong's Headbutt", () => {
  /** DK on Final Destination's floor at `dkX`, facing right, one frame before Headbutt's box; Mario 8 in front, at 130%. */
  function headbutt(mario: Partial<FighterState>, dkX = 0): GameState {
    const state = createInitialState("finalDestination", [{ defId: "donkeyKong" }, { defId: "mario" }], RULES, 0x4eb7);
    const [dk, v] = state.fighters;
    for (const f of state.fighters) {
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: fx(0), intangible: 0, invincible: 0 });
    }
    // The box is live from game frame 20, which is `actionFrame` 19 (`moveScriptFrame`).
    Object.assign(dk, { x: fx(dkX), facing: 1, action: "special", move: "sideB", actionFrame: 18 });
    Object.assign(v, { x: fx(dkX + 8), facing: -1, damage: fx(130), ...mario });
    return state;
  }

  /** Mario from the frame his launch fires, for `frames` frames, and the hit's hitstun. */
  function launched(state: GameState, frames: number): { hitstun: number; after: FighterState[] } {
    let s = state;
    let hitstun = -1;
    const after: FighterState[] = [];
    for (let i = 0; i < 40 + frames && after.length < frames; i++) {
      const r = step(s, [0, 0], { prevInputs: [0, 0] });
      if (r.events.hits.some((h) => h.attacker === 0 && h.victim === 1)) hitstun = r.state.fighters[1].hitstun;
      s = r.state;
      if (hitstun >= 0 && (after.length > 0 || (s.fighters[1].hitlag === 0 && s.fighters[1].pendingFacing === 0))) {
        after.push({ ...s.fighters[1], kinetic: { ...s.fighters[1].kinetic } });
      }
    }
    expect(hitstun, "Headbutt should land on Mario").toBeGreaterThan(0);
    return { hitstun, after };
  }

  it("is marked a meteor", () => {
    const dk = FIGHTERS.find((f) => f.id === "donkeyKong")!;
    expect(dk.moves.sideB!.hitboxes.map((h) => [h.angle, h.meteor])).toEqual([[fx(270), true]]);
  });

  // Past the edge (79.995), so nothing breaks the fall; locked out of the ledge so he does not take it first.
  it("spikes an airborne victim", () => {
    const { after } = launched(headbutt({ grounded: false, platform: -1, y: fx(4), action: "fall", ledgeLockout: 60 }, 74), 10);
    expect(after[0].x).toBeGreaterThan(fx(80));
    expect(after[0].kinetic.damageY).toBeLessThan(0);
    expect(after.every((f, i) => i === 0 || f.y < after[i - 1].y)).toBe(true);
  });

  it("bounces a grounded victim it tumbles once, as the launch fires, and keeps the hitstun (UNVERIFIED: for the bury)", () => {
    const { hitstun, after } = launched(headbutt({}), 13);
    expect(hitstun).toBeGreaterThan(0);
    expect(after[0].kinetic.damageY).toBeGreaterThan(0);
    expect(after.slice(1).every((f) => !f.grounded && f.y > 0)).toBe(true);
    expect(after.slice(1).every((f, i) => f.hitstun === after[i].hitstun - 1)).toBe(true);
  });
});

/**
 * Kirby's Inhale, until Plan 5 Task 9 builds it (Plan 3 final wave, part 2, item 7;
 * the Task 14 re-review's minor). Its neutral special catches with a grab box, and the
 * guard that lets a captor's victim go once the captor stops holding released the
 * victim one frame after the catch. UNVERIFIED stand-in: `special` holds while its
 * move owns a catch box, so the victim is held for the whole inhale and let go when it
 * ends, with the usual 60 frames of grab immunity.
 */
describe("Kirby's Inhale holds its victim for the move", () => {
  it("holds Mario from the catch to the end of the inhale, then lets him go", () => {
    let s = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], RULES, 0x1a4e);
    for (const f of s.fighters) {
      Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: fx(0), intangible: 0, invincible: 0 });
    }
    Object.assign(s.fighters[0], { x: fx(0), facing: 1 });
    Object.assign(s.fighters[1], { x: fx(7), facing: -1 });
    const kirby = FIGHTERS.find((f) => f.id === "kirby")!;
    const total = kirby.moves.neutralB!.totalFrames;
    let prev: [number, number] = [0, 0];
    const states: GameState[] = [];
    for (let i = 0; i < total + 5; i++) {
      const inputs: [number, number] = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, inputs, { prevInputs: prev }).state;
      prev = inputs;
      states.push(s);
    }
    const caught = states.findIndex((t) => t.fighters[1].grabbedBy === 0);
    expect(caught, "the inhale should catch Mario").toBeGreaterThan(0);
    const inhaling = states.slice(caught).filter((t) => t.fighters[0].action === "special");
    expect(inhaling.length).toBeGreaterThan(20);
    for (const t of inhaling) {
      expect(t.fighters[0].grabbing, `frame ${t.frame}`).toBe(1);
      expect(t.fighters[1]).toMatchObject({ action: "grabbed", grabbedBy: 0 });
    }
    const after = states.find((t, i) => i > caught && t.fighters[0].action !== "special")!;
    expect(after.fighters[0].grabbing).toBe(-1);
    expect(after.fighters[1].grabbedBy).toBe(-1);
    expect(after.fighters[1].combat.grabImmune).toBeGreaterThan(50);
  });
});
