import { describe, expect, it } from "vitest";

import { SHIELD_MAX_HEALTH, SMASH_INPUT_WINDOW } from "@/engine/constants";
import { fx, toFloat } from "@/engine/fixed";
import { Btn, held, type FighterState, type GameState, type StageDef } from "@/engine/types";
import {
  BEHAVIOURS,
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  GRAB_RANGE,
  MELEE_RANGE,
  ROLL_RECOVER,
  approach,
  attack,
  blastMargin,
  canAct,
  diDirection,
  digitalDirection,
  edgeguard,
  fullHopPulse,
  isOffstage,
  isStunned,
  meleeReachFromDef,
  observe,
  platformMove,
  pulse,
  recover,
  shield,
  shortHopPulse,
  stageViewFromDef,
  survive,
  towardX,
  type BehaviourContext,
  type LevelTuning,
} from "./behaviours";
import { tuningForLevel } from "./cpu";

/* --------------------------------------------------------------- fixtures -- */

function fighter(port: number, over: Partial<FighterState> = {}): FighterState {
  return {
    port,
    defId: "mario",
    costume: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    platform: 0,
    action: "stand",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: SHIELD_MAX_HEALTH,
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 99,
    lastDirPressed: 0,
    bufferedAction: null,
    ...over,
  };
}

function gameState(fighters: FighterState[], over: Partial<GameState> = {}): GameState {
  return {
    frame: 0,
    rngSeed: 1,
    fighters,
    stageId: "battlefield",
    rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
    projectiles: [],
    nextProjectileId: 1,
    smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
    timeRemaining: 0,
    outcome: null,
    freezeFrames: 0,
    ...over,
  };
}

/** All rolls at zero: every gated behaviour is allowed to fire. */
function context(
  state: GameState,
  tuning: LevelTuning,
  rolls: number[] = new Array(DECISION_ROLLS).fill(0),
): BehaviourContext {
  return {
    state,
    view: observe(state, 0, tuning.reactionFrames),
    stage: DEFAULT_STAGE_VIEW,
    tuning,
    jumps: 1,
    meleeReach: MELEE_RANGE,
    rolls,
  };
}

const L9 = tuningForLevel(9);
const L1 = tuningForLevel(1);

/* ------------------------------------------------------------ observation -- */

describe("observe", () => {
  it("rewinds the opponent by the reaction delay", () => {
    const state = gameState([fighter(0), fighter(1, { x: fx(40), vx: fx(2) })]);

    const fast = observe(state, 0, 4);
    const slow = observe(state, 0, 30);

    // The level-1 CPU is looking at where the opponent was half a second ago,
    // which is 60 units back at this speed.
    expect(fast.dx).toBe(fx(40) - fx(2) * 4);
    expect(slow.dx).toBe(fx(40) - fx(2) * 30);
    expect(slow.distance).toBeLessThan(fast.distance);
  });

  it("does not report an action until it has been visible for the delay", () => {
    const swinging = gameState([
      fighter(0),
      fighter(1, { x: fx(20), action: "attack", actionFrame: 6 }),
    ]);

    expect(observe(swinging, 0, 4).targetAction).toBe("attack");
    expect(observe(swinging, 0, 4).targetActionAge).toBe(2);

    // 30 frames of delay: the swing has not registered at all yet.
    expect(observe(swinging, 0, 30).targetAction).toBe("stand");
    expect(observe(swinging, 0, 30).targetActionAge).toBe(-1);
  });

  it("falls back to the airborne neutral for an unseen airborne action", () => {
    const state = gameState([
      fighter(0),
      fighter(1, { x: fx(20), grounded: false, action: "attack", actionFrame: 1 }),
    ]);
    expect(observe(state, 0, 10).targetAction).toBe("fall");
  });

  it("picks the nearest live opponent, lowest port on a tie", () => {
    const state = gameState([
      fighter(0),
      fighter(1, { x: fx(50) }),
      fighter(2, { x: fx(-50) }),
      fighter(3, { x: fx(10), stocks: 0, action: "dead" }),
    ]);
    expect(observe(state, 0, 0).target?.port).toBe(1);
  });

  it("copes with a state that has no opponent left", () => {
    const view = observe(gameState([fighter(0)]), 0, 4);
    expect(view.target).toBeNull();
    expect(view.distance).toBe(0);
  });

  it("knows whether it is facing the target", () => {
    const state = gameState([fighter(0, { facing: -1 }), fighter(1, { x: fx(30) })]);
    expect(observe(state, 0, 0).facingTarget).toBe(false);
    expect(observe(gameState([fighter(0), fighter(1, { x: fx(30) })]), 0, 0).facingTarget).toBe(true);
  });
});

/* ------------------------------------------------------------- primitives -- */

describe("primitives", () => {
  it("quantises a vector onto the nine digital directions", () => {
    expect(digitalDirection(fx(1), 0)).toBe(Btn.Right);
    expect(digitalDirection(-fx(1), 0)).toBe(Btn.Left);
    expect(digitalDirection(0, -fx(1))).toBe(Btn.Down);
    expect(digitalDirection(fx(1), fx(1))).toBe(Btn.Right | Btn.Up);
    // 20 degrees off the horizontal reads as sideways, not as a diagonal.
    expect(digitalDirection(fx(1), fx(0.3))).toBe(Btn.Right);
    expect(digitalDirection(0, 0)).toBe(0);
  });

  it("points toward a target", () => {
    expect(towardX(fx(-10), fx(10))).toBe(Btn.Right);
    expect(towardX(fx(10), fx(-10))).toBe(Btn.Left);
    expect(towardX(fx(5), fx(5))).toBe(0);
  });

  it("pulses so a fresh press edge exists every period", () => {
    const frames = Array.from({ length: 12 }, (_, f) => pulse(f, 0, 4, 2));
    expect(frames).toEqual([
      true, true, false, false,
      true, true, false, false,
      true, true, false, false,
    ]);
    // Different ports are out of phase, so four CPUs do not press in unison.
    expect(pulse(0, 0, 4, 2)).not.toBe(pulse(0, 1, 4, 2));
  });

  it("holds jump for two frames on a short hop and five on a full hop", () => {
    const shortFrames = Array.from({ length: 8 }, (_, f) => shortHopPulse(f, 0)).filter(Boolean);
    const fullFrames = Array.from({ length: 10 }, (_, f) => fullHopPulse(f, 0)).filter(Boolean);
    // Released inside the 3-frame jumpsquat is a short hop (SPEC section 6).
    expect(shortFrames).toHaveLength(2);
    expect(fullFrames).toHaveLength(5);
  });

  it("measures the distance to the nearest blast zone", () => {
    expect(blastMargin(0, 0, DEFAULT_STAGE_VIEW)).toBe(fx(140));
    expect(blastMargin(fx(230), 0, DEFAULT_STAGE_VIEW)).toBe(fx(10));
  });

  it("knows what counts as offstage and as actionable", () => {
    expect(isOffstage(fighter(0, { x: fx(-100) }), DEFAULT_STAGE_VIEW)).toBe(true);
    expect(isOffstage(fighter(0, { x: fx(0) }), DEFAULT_STAGE_VIEW)).toBe(false);
    expect(isStunned(fighter(0, { hitstun: 12 }))).toBe(true);
    expect(isStunned(fighter(0, { action: "tumble" }))).toBe(true);
    expect(canAct(fighter(0))).toBe(true);
    expect(canAct(fighter(0, { action: "dead" }))).toBe(false);
  });

  it("converts a real stage definition", () => {
    const def: StageDef = {
      id: "fd",
      name: "Final Destination",
      series: "smash",
      platforms: [
        { x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true },
        { x: fx(30), y: fx(25), halfWidth: fx(15), soft: true, ledges: false },
      ],
      blastZone: { left: fx(-240), right: fx(240), top: fx(180), bottom: fx(-140) },
      spawns: [],
      theme: "space",
    };

    const view = stageViewFromDef(def);
    expect(view.leftLedge).toBe(fx(-80));
    expect(view.rightLedge).toBe(fx(80));
    expect(view.blastTop).toBe(fx(180));
    expect(view.platforms).toEqual([{ x: fx(30), y: fx(25), halfWidth: fx(15) }]);
  });
});

/* --------------------------------------------------------------- survival -- */

describe("survive", () => {
  it("holds DI perpendicular to a horizontal launch, on the safe side", () => {
    // Launched hard toward the right blast zone: the perpendicular that
    // survives is up, because down is toward the lower blast zone.
    const state = gameState([fighter(0, { x: fx(150), vx: fx(6), vy: 0, hitstun: 20 })]);
    const result = survive(context(state, L9));

    expect(result.score).toBeGreaterThan(900);
    expect(held(result.input, Btn.Up)).toBe(true);
    expect(held(result.input, Btn.Right)).toBe(false);
    expect(held(result.input, Btn.Left)).toBe(false);
  });

  it("picks the perpendicular that increases the blast-zone margin", () => {
    // Launched up and to the left with the ceiling closer than the side: the
    // answer is the perpendicular that carries away from the top.
    const self = fighter(0, { x: fx(-40), y: fx(150), vx: -fx(3), vy: fx(3), hitstun: 20 });
    const chosen = diDirection(self, DEFAULT_STAGE_VIEW);
    expect(held(chosen, Btn.Down)).toBe(true);
    expect(held(chosen, Btn.Up)).toBe(false);
  });

  it("never DIs at level 1 and always does at level 9", () => {
    const state = gameState([fighter(0, { x: fx(150), vx: fx(6), hitstun: 20 })]);
    const rolls = new Array(DECISION_ROLLS).fill(0.5);
    expect(survive(context(state, L1, rolls)).input).toBe(0);
    expect(survive(context(state, L9, rolls)).input).not.toBe(0);
  });

  it("mashes SDI during hitlag, releasing between pulses", () => {
    const base = fighter(0, { x: fx(150), vx: fx(6), hitlag: 8 });
    const inputs = Array.from({ length: 8 }, (_, f) =>
      survive(context(gameState([{ ...base }], { frame: f }), L9)).input,
    );

    // One fresh press per SDI_INPUT_INTERVAL: held, held, released, released.
    expect(inputs.map((i) => i !== 0)).toEqual([true, true, false, false, true, true, false, false]);
  });

  it("stays silent when the fighter can act", () => {
    expect(survive(context(gameState([fighter(0)]), L9))).toEqual({ score: 0, input: 0 });
  });
});

/* --------------------------------------------------------------- recovery -- */

describe("recover", () => {
  const offstage = (over: Partial<FighterState> = {}) =>
    gameState([fighter(0, { x: fx(-100), y: fx(-10), grounded: false, vy: -fx(1), ...over })]);

  it("drifts back toward the ledge and jumps while a jump remains", () => {
    const inputs = Array.from({ length: 10 }, (_, f) =>
      recover(context(gameState(offstage().fighters, { frame: f }), L9)).input,
    );
    expect(inputs.every((i) => held(i, Btn.Right))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Special))).toBe(false);
  });

  it("spends the up special once the jump is gone", () => {
    const state = offstage({ jumpsUsed: 1 });
    const inputs = Array.from({ length: 8 }, (_, f) =>
      recover(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.some((i) => held(i, Btn.Special) && held(i, Btn.Up))).toBe(true);
  });

  it("up-Bs immediately when it is already far below the stage", () => {
    const state = offstage({ y: fx(-60) });
    const inputs = Array.from({ length: 8 }, (_, f) =>
      recover(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.some((i) => held(i, Btn.Special) && held(i, Btn.Up))).toBe(true);
  });

  it("drifts but forgets the button when the recovery roll fails", () => {
    // The level-1 self-destruct, made explicit: it knows which way home is and
    // presses nothing.
    const rolls = new Array(DECISION_ROLLS).fill(0);
    rolls[ROLL_RECOVER] = 0.99;
    const result = recover(context(offstage(), L1, rolls));
    expect(result.input).toBe(Btn.Right);
  });

  it("climbs off a ledge hang rather than hanging forever", () => {
    const state = gameState([
      fighter(0, { x: fx(-80), y: 0, grounded: false, action: "ledgeHang" }),
    ]);
    const inputs = Array.from({ length: 12 }, (_, f) =>
      recover(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.some((i) => held(i, Btn.Up))).toBe(true);
  });

  it("stays silent while safely on the stage", () => {
    expect(recover(context(gameState([fighter(0)]), L9)).score).toBe(0);
  });
});

/* --------------------------------------------------------------- defence -- */

describe("shield", () => {
  const swinging = (actionFrame: number) =>
    gameState([fighter(0), fighter(1, { x: fx(20), action: "attack", actionFrame })]);

  it("shields an attack it has had time to see", () => {
    const result = shield(context(swinging(8), L9));
    expect(held(result.input, Btn.Shield)).toBe(true);
  });

  it("does not shield an attack that is still inside its reaction window", () => {
    expect(shield(context(swinging(2), L9)).score).toBe(0);
    // At level 1 the whole swing finishes before the CPU perceives it at all.
    expect(shield(context(swinging(25), L1)).score).toBe(0);
  });

  it("ignores an attack thrown from across the stage", () => {
    const far = gameState([
      fighter(0),
      fighter(1, { x: fx(120), action: "attack", actionFrame: 10 }),
    ]);
    expect(shield(context(far, L9)).score).toBe(0);
  });

  it("spot-dodges a grab rather than shielding it", () => {
    const grabbed = gameState([
      fighter(0),
      fighter(1, { x: fx(14), action: "grab", actionFrame: 8 }),
    ]);
    const result = shield(context(grabbed, L9));
    expect(held(result.input, Btn.Down)).toBe(true);
    expect(held(result.input, Btn.Shield)).toBe(true);
  });

  it("backs off instead of holding a shield that is about to break", () => {
    const state = gameState([
      fighter(0, { shieldHealth: fx(5) }),
      fighter(1, { x: fx(20), action: "attack", actionFrame: 8 }),
    ]);
    expect(held(shield(context(state, L9)).input, Btn.Left)).toBe(true);
  });
});

/* --------------------------------------------------------------- offence -- */

describe("attack", () => {
  it("turns to face the target before swinging", () => {
    const state = gameState([fighter(0, { facing: -1 }), fighter(1, { x: fx(12) })]);
    const result = attack(context(state, L9));
    expect(result.input).toBe(Btn.Right);
  });

  it("short-hops an up aerial at a target above it", () => {
    const state = gameState([fighter(0), fighter(1, { x: fx(2), y: fx(18) })]);
    const inputs = Array.from({ length: 10 }, (_, f) =>
      attack(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.every((i) => held(i, Btn.Up))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Attack))).toBe(true);
  });

  it("grabs a shielding target", () => {
    const state = gameState([
      fighter(0),
      fighter(1, { x: GRAB_RANGE - fx(1), action: "shield", actionFrame: 10 }),
    ]);
    const inputs = Array.from({ length: 10 }, (_, f) =>
      attack(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.some((i) => held(i, Btn.Grab))).toBe(true);
  });

  it("commits to a smash on a target reeling at a killing percent", () => {
    const state = gameState([
      fighter(0, { framesSinceDirPress: 1 }),
      fighter(1, { x: fx(12), damage: fx(120), action: "hitstun", actionFrame: 10, hitstun: 20 }),
    ]);
    const result = attack(context(state, L9));
    // Attack pressed while the smash window is still open: a smash, not a tilt.
    expect(held(result.input, Btn.Attack)).toBe(true);
    expect(held(result.input, Btn.Right)).toBe(true);
  });

  it("releases the direction first when the smash window has lapsed", () => {
    const state = gameState([
      fighter(0, { framesSinceDirPress: SMASH_INPUT_WINDOW + 20 }),
      fighter(1, { x: fx(12), damage: fx(120), action: "hitstun", actionFrame: 10, hitstun: 20 }),
    ]);
    const inputs = Array.from({ length: 4 }, (_, f) =>
      attack(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    // A direction held for twenty frames cannot produce a fresh press, so the
    // flick has to include an empty frame.
    expect(inputs).toContain(0);
    expect(inputs.some((i) => held(i, Btn.Attack) && held(i, Btn.Right))).toBe(true);
  });

  it("never fires an accidental smash from a stale direction", () => {
    const state = gameState([
      fighter(0, { framesSinceDirPress: 2 }),
      fighter(1, { x: fx(12) }),
    ]);
    const inputs = Array.from({ length: 10 }, (_, f) =>
      attack(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    // With the window open, the default swing drops the direction so the hit
    // comes out as a jab rather than as a wasted smash.
    for (const input of inputs) {
      if (held(input, Btn.Attack)) expect(held(input, Btn.Right)).toBe(false);
    }
  });

  it("stays silent out of range", () => {
    const state = gameState([fighter(0), fighter(1, { x: MELEE_RANGE + fx(10) })]);
    expect(attack(context(state, L9)).score).toBe(0);
  });
});

describe("edgeguard", () => {
  const chasing = (over: Partial<FighterState> = {}) =>
    gameState([
      fighter(0, { x: fx(40) }),
      fighter(1, { x: fx(110), y: fx(-10), grounded: false, ...over }),
    ]);

  it("is never attempted at level 1", () => {
    expect(edgeguard(context(chasing(), L1)).score).toBe(0);
  });

  it("walks to the ledge on the target's side", () => {
    const result = edgeguard(context(chasing(), L9));
    expect(result.input).toBe(Btn.Right);
  });

  it("chases off the stage once it is at the ledge", () => {
    const state = gameState([
      fighter(0, { x: fx(78) }),
      fighter(1, { x: fx(110), y: fx(-10), grounded: false }),
    ]);
    const inputs = Array.from({ length: 12 }, (_, f) =>
      edgeguard(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.every((i) => held(i, Btn.Right))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Attack))).toBe(true);
  });

  it("does not leave the stage at a level that could not get back", () => {
    const midLevel = tuningForLevel(4);
    const state = gameState([
      fighter(0, { x: fx(78) }),
      fighter(1, { x: fx(110), y: fx(-10), grounded: false }),
    ]);
    const inputs = Array.from({ length: 16 }, (_, f) =>
      edgeguard(context(gameState(state.fighters, { frame: f }), midLevel)).input,
    );
    expect(inputs.every((i) => !held(i, Btn.Right))).toBe(true);
  });
});

describe("platformMove", () => {
  it("drops through the soft platform it is standing on", () => {
    const state = gameState([
      fighter(0, { y: fx(27.2) }),
      fighter(1, { x: fx(6), y: 0 }),
    ]);
    const inputs = Array.from({ length: 10 }, (_, f) =>
      platformMove(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.some((i) => held(i, Btn.Down))).toBe(true);
  });

  it("jumps for a platform above it", () => {
    const state = gameState([
      fighter(0, { x: fx(-38) }),
      fighter(1, { x: fx(-38), y: fx(28) }),
    ]);
    const inputs = Array.from({ length: 10 }, (_, f) =>
      platformMove(context(gameState(state.fighters, { frame: f }), L9)).input,
    );
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
  });

  it("does not jump at a target above it on a stage with no platforms", () => {
    const flat = { ...DEFAULT_STAGE_VIEW, platforms: [] };
    const state = gameState([fighter(0), fighter(1, { y: fx(28) })]);
    const ctx = { ...context(state, L9), stage: flat };
    expect(platformMove(ctx).score).toBe(0);
  });
});

describe("the behaviour set", () => {
  it("lists the survival behaviours first, so they win ties", () => {
    expect(BEHAVIOURS.map((b) => b.name)).toEqual([
      "survive",
      "recover",
      "shield",
      "edgeguard",
      "attack",
      "platformMove",
      "approach",
      "retreat",
      "idle",
    ]);
  });

  it("always has an answer", () => {
    const state = gameState([fighter(0), fighter(1, { x: fx(60) })]);
    const ctx = context(state, L9);
    expect(BEHAVIOURS.some((b) => b.run(ctx).score > 0)).toBe(true);
  });
});

describe("the approach/attack threshold", () => {
  /**
   * The dead band, stated as a property.
   *
   * `approach` stops closing at `meleeReach` and `attack` starts swinging at
   * `meleeReach`, so the two must read the *same* number. When they did not —
   * `attack` used a roster-wide constant of 20 units while Donkey Kong's jab
   * covers 11.5 — every distance in between was one where neither behaviour
   * would act on the gap: the CPU stood still and threw jabs at air. Against an
   * opponent who also stood still the state was identical on the next frame, so
   * the same decision returned forever and the match stopped progressing at
   * 58%–0%.
   *
   * Swept rather than spot-checked, because the bug lived in a *band* of
   * distances: any single sample outside 11.5…20 would have passed.
   */
  for (const reach of [fx(4), fx(8), fx(11.5), fx(16), fx(20), fx(30)]) {
    it(`covers every distance for a fighter reaching ${toFloat(reach)}`, () => {
      for (let d = 1; d <= 40; d++) {
        const state = gameState([fighter(0), fighter(1, { x: fx(d) })]);
        const ctx = { ...context(state, L9), meleeReach: reach };

        const acted = attack(ctx).score > 0 || approach(ctx).score > 0;
        expect(acted, `nothing to do at distance ${d} with reach ${toFloat(reach)}`).toBe(true);
      }
    });
  }

  it("reads a fighter's reach off its own move data", () => {
    // A stand-in rather than the real roster, so this stays a test of the
    // function and not of Donkey Kong's frame data: jab reaching 11.5 and ftilt
    // reaching 13.5 must yield 11.5, because the default swing does not choose
    // which of the two comes out.
    const def = {
      moves: {
        jab1: { hitboxes: [{ x: fx(7.5), radius: fx(4) }] },
        ftilt: { hitboxes: [{ x: fx(9), radius: fx(4.5) }] },
      },
    } as unknown as Parameters<typeof meleeReachFromDef>[0];

    expect(toFloat(meleeReachFromDef(def))).toBeCloseTo(11.5, 1);
  });

  it("falls back to the constant for a fighter with no pokes at all", () => {
    const def = { moves: {} } as unknown as Parameters<typeof meleeReachFromDef>[0];
    expect(meleeReachFromDef(def)).toBe(MELEE_RANGE);
  });
});
