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
import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import { fx, toFloat } from "@/engine/fixed";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { insideSolidBody } from "@/engine/physics";
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
  // Donkey Kong's recovers sideways (Plan 5, Task 13b): SmashWiki "Donkey Kong
  // (SSBU)" (https://www.ssbwiki.com/Donkey_Kong_(SSBU)): Spinning Kong "has decently
  // long horizontal recovery distance" but "offers almost no vertical recovery".
  it("donkeyKong's up-special covers distance sideways, further than he drifts without it", () => {
    // His plain drift, Right held for 70 frames with no up special, covers 80.0
    // (the Task 13b review's measurement); the up special's "Maximum air speed 1.7"
    // carries him 90.5.
    const startX = toFloat(airborne("donkeyKong").fighters[0].x);
    const drift = run(airborne("donkeyKong"), Btn.Right, 70);
    const spun = run(airborne("donkeyKong"), UP_SPECIAL | Btn.Right, 70);
    const far = (fs: FighterState[]) => Math.max(...fs.map((f) => toFloat(f.x))) - startX;
    expect(far(spun)).toBeGreaterThan(far(drift) + 5);
    expect(far(spun)).toBeGreaterThan(85);
  });

  for (const fighter of FIGHTERS.filter((d) => d.id !== "donkeyKong")) {
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
  }

  // Every fighter, Donkey Kong too (the Task 13b review's M-2): his sideways test
  // above needs the same guard.
  for (const fighter of FIGHTERS) {
    it(`${fighter.id}'s up-special enters the special state at all`, () => {
      // Guards the test above against passing for the wrong reason: if the
      // input never reached the move, a fighter who happened to drift upward
      // would still look like a recovery.
      const frames = run(airborne(fighter.id), UP_SPECIAL, 10);
      // Its aerial one where it has one of its own (Link's, Plan 5, Task 13b).
      const slot = fighter.moves.upBAir !== undefined ? "upBAir" : "upB";
      expect(frames.some((f) => f.action === "special" && f.move === slot)).toBe(true);
    });
  }
});

describe("Kirby's Stone is a stone", () => {
  it("falls markedly faster than Kirby otherwise does", () => {
    // Against his own fast fall, not against a constant: the claim is that the
    // rock is heavy, and "heavy" only means anything relative to the puffball.
    // 45 frames from 120 up, which is short enough that neither run has reached
    // the ground — a comparison that ends with both of them stopped on the floor
    // measures the floor, not the fall. The stone forms, and falls, from its frame
    // 29 (Plan 5, Task 13 fix round 2: SmashWiki's "Fall speed 4.5").
    const high = () => {
      const s = airborne("kirby");
      s.fighters[0].y = fx(120);
      return s;
    };
    const fastFalling = run(high(), Btn.Down, 45);
    const stone = run(high(), Btn.Down | Btn.Special, 45);

    // Terminal speed, not distance travelled: distance mixes in however long
    // the transformation takes, so it understates the difference and would
    // still pass if the Stone fell at a brisk walk.
    const fastest = (frames: FighterState[]) => Math.min(...frames.map((f) => toFloat(f.vy)));
    expect(fastest(stone)).toBeLessThan(fastest(fastFalling) * 1.8);

    const dropOf = (frames: FighterState[]) => 120 - Math.min(...frames.map((f) => toFloat(f.y)));
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
    // The stone is the move. Kirby drops through the middle of a fight and the
    // point is that nothing stops him: it takes the hit (no damage, SmashWiki
    // "Stone": "taking no damage while transformed") and keeps going (Plan 5, Task
    // 13 fix round 2).
    const state = createInitialState("finalDestination", [{ defId: "kirby" }, { defId: "mario" }], RULES, 7);
    const kirby = state.fighters[0];
    const mario = state.fighters[1];

    kirby.action = "special";
    kirby.move = "downB";
    // Inside the stone's window on the ground (11-28), the stone formed.
    kirby.actionFrame = 20;
    kirby.combat.stoneFrames = 10;
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
    expect(toFloat(hitKirby.damage), "and not hurt").toBe(0);
    expect(hitKirby.combat.stoneTaken, "but count against the stone").toBeGreaterThan(0);
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
 * eventually thrown or breaks free"). Since Plan 5 Task 7 every throw runs that
 * way: its catch-only boxes hurt the fighter held, and its launch lands once,
 * by `ATK_HIT_ABS`.
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

  /** The angle of the ATTACK_ABS a throw's script lands, read off the script at its ATK_HIT_ABS. */
  function launchAngle(def: (typeof FIGHTERS)[number], slot: (typeof THROWS)[number][0]): number {
    const script = gameScriptFor(def, slot)!;
    for (let g = 1; g <= def.moves[slot]!.totalFrames; g++) {
      const st = runScript(script, g);
      if (st.fired.some((c) => c.op === "hitAbs")) return st.throwAbs!.angle;
    }
    throw new Error(`${def.id} ${slot} lands no throw`);
  }

  describe.each(FIGHTERS.map((f) => [f.id, f] as const))("%s", (id, def) => {
    // Donkey Kong's forward throw launches nobody: it lifts the fighter held to
    // carry (Plan 5, Task 8; `MoveDef.cargo`, `fighters/cargo.test.ts`).
    it.each(THROWS.filter(([slot]) => def.moves[slot]?.cargo !== true))("%s lands its launch once and launches the way it points (a back throw, behind)", (slot, button) => {
      const ticks = press(holding(id, victimFor(id)), button, 140);
      const hits = ticks.flatMap((t) => t.events.hits);
      // Its catch-only hits (Kirby's stomps, Link's kicks) hurt and hold; the
      // last hit is the one launch.
      const launches = hits.filter((h) => h.knockback > 0);
      expect(launches, "the throw should land its launch once").toHaveLength(1);
      expect(hits.at(-1)).toBe(launches[0]);
      const hit = ticks.findIndex((t) => t.events.hits.includes(launches[0]));
      // The victim is no longer held, and is launched when the freeze ends.
      const out = ticks.findIndex((t, i) => i >= hit && t.state.fighters[1].hitlag === 0 && t.state.fighters[1].pendingFacing === 0);
      const v = ticks[out].state.fighters[1];
      expect(v.grabbedBy).toBe(-1);
      expect(v.hitstun).toBeGreaterThan(0);
      // The holder faces right, so "forward" is +x.
      const cos = Math.cos((toFloat(launchAngle(def, slot)) * Math.PI) / 180);
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

// Kirby's Inhale held its victim for the whole move here, a stand-in (Plan 3 final
// wave, part 2, item 7) until Plan 5 Task 9 built its own statuses: the mouthful,
// the swallow and the spit are `inhale.test.ts`'s.

/**
 * No projectile is launched inside the stage's solid body (Plan 5, Task 9 fix
 * round 3; `spawnDueProjectiles`): fired from just outside Final Destination's
 * left wall, facing it, below its floor. Before, each of these started inside
 * the body and flew on through it for 22 to 45 frames. UNVERIFIED: that such a
 * projectile is not launched at all; no source says.
 */
describe("a projectile fired into a wall from beside it", () => {
  const FD = STAGES.find((st) => st.id === "finalDestination")!;
  // Plan 5, Task 13c (the Task 9 re-review 3's rows): a stored full Charge Shot
  // (offset 8, the roster's widest), the Thunder Jolt and Link's Remote Bomb (offset
  // 4: from 1 nearer the wall), and F.L.U.D.D.'s seven pumps, a stored full charge,
  // its owner held where it starts so that every pump's spawn is in the wall.
  // Task 13d: a side special pressed with its direction is its smash version now,
  // so the Homing Missile and the tilt Boomerang are pressed as a soft tilt, and the
  // Super Missile and the smash-thrown Boomerang have rows of their own; each row
  // names the move its press starts.
  it.each([
    ["mario", "Fireball", Btn.Special, -84, {}, false, "neutralB"],
    ["fox", "Blaster", Btn.Special, -84, {}, false, "neutralB"],
    ["samus", "Homing Missile", Btn.Soft | Btn.Special | Btn.Right, -84, {}, false, "sideB"],
    ["samus", "Super Missile", Btn.Special | Btn.Right, -84, {}, false, "sideBSmash"],
    ["link", "Hero's Bow", Btn.Special, -84, {}, false, "neutralB"],
    ["link", "Boomerang", Btn.Soft | Btn.Special | Btn.Right, -84, {}, false, "sideB"],
    ["link", "smash-thrown Boomerang", Btn.Special | Btn.Right, -84, {}, false, "sideBSmash"],
    ["samus", "stored full Charge Shot", Btn.Special, -84, { storedCharge: 112 }, false, "neutralB"],
    ["pikachu", "Thunder Jolt", Btn.Special, -83, {}, false, "neutralB"],
    ["mario", "F.L.U.D.D. water (stored full)", Btn.Down | Btn.Special, -84, { storedCharge: 80 }, true, "downB"],
    ["link", "Remote Bomb", Btn.Down | Btn.Special, -83, {}, false, "downB"],
  ] as const)("%s's %s never starts, or flies, inside it", (id, _name, key, x, combat, hover, slot) => {
    let s = createInitialState("finalDestination", [{ defId: id }, { defId: "kirby" }], RULES, 9);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(x), y: fx(-30), facing: 1, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[0].combat, combat);
    Object.assign(s.fighters[1], { action: "stand", x: fx(40), y: 0, grounded: true, platform: 0 });
    let prev: InputFrame[] = [0, 0];
    let launches = 0;
    for (let i = 0; i < 60; i++) {
      if (hover) Object.assign(s.fighters[0], { x: fx(x), y: fx(-30) });
      const now: InputFrame[] = [i === 0 ? key : 0, 0];
      const before = s.nextProjectileId;
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      if (i === 0) expect(s.fighters[0].move, "the move its press starts").toBe(slot);
      launches += s.nextProjectileId - before;
      for (const p of s.projectiles) expect(insideSolidBody(FD, s.frame, p.x, p.y), `${p.defId} at age ${p.age}`).toBe(false);
    }
    // Its spawn point was inside the wall, so nothing was launched.
    expect(launches).toBe(0);
  });

  it("Samus's bomb, laid with her held just under the stage's underside, never starts inside it (Task 13c)", () => {
    // Its spawn, 2 above her ("Bomb Y offset 2"), is 1 inside Final Destination's underside.
    const bottom = FD.platforms[0].y - fx(60);
    let s = createInitialState("finalDestination", [{ defId: "samus" }, { defId: "kirby" }], RULES, 9);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: 0, y: bottom - fx(1), facing: 1, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[1], { action: "stand", x: fx(40), y: 0, grounded: true, platform: 0 });
    let prev: InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      Object.assign(s.fighters[0], { x: 0, y: bottom - fx(1) });
      const now: InputFrame[] = [i === 0 ? Btn.Down | Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      for (const p of s.projectiles) expect(insideSolidBody(FD, s.frame, p.x, p.y), `${p.defId} at age ${p.age}`).toBe(false);
    }
    expect([s.nextProjectileId, s.fighters[0].move]).toEqual([1, "downB"]);
  });

  it("still launches one whose spawn point is in the open (the Fireball, facing away)", () => {
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "kirby" }], RULES, 9);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(-84), y: fx(-30), facing: -1, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[1], { action: "stand", x: fx(40), y: 0, grounded: true, platform: 0 });
    let prev: InputFrame[] = [0, 0];
    let seen = false;
    for (let i = 0; i < 30; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      if (s.projectiles.length > 0) seen = true;
    }
    expect(seen).toBe(true);
  });
});
