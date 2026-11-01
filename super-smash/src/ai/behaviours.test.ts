import { describe, expect, it } from "vitest";

import { DEFAULT_AIR_DODGE, airDodgeCharge } from "@/engine/airDodge";
import { SHIELD_MAX_HEALTH, SMASH_INPUT_WINDOW } from "@/engine/constants";
import { fx, mul, toFloat } from "@/engine/fixed";
import { fighterParams } from "@/engine/params";
import { Btn, held, type FighterState, type GameState, type StageDef } from "@/engine/types";
import { emptyCombat } from "@/engine/combat";
import { emptyKinetic, kineticSet } from "@/engine/kinetic";
import {
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  GRAB_RANGE,
  MELEE_RANGE,
  ROLL_RECOVER,
  ROLL_SHIELD,
  blastMargin,
  canAct,
  diDirection,
  digitalDirection,
  dodgeDrift,
  sideDodgeTravel,
  fullHopPulse,
  isHelpless,
  isOffstage,
  isStunned,
  meleeReachFromDef,
  moveReach,
  observe,
  pulse,
  shortHopPulse,
  stageViewFromDef,
  towardX,
  type BehaviourContext,
  type LevelTuning,
  type RecoveryMove,
} from "./behaviours";
import { recover, recoveryFromDef } from "./recovery";
import { shield, survive } from "./defence";
import {
  POINT_BLANK,
  approach,
  attack,
  edgeguard,
  platformMove,
  pressToward,
  slidesOff,
} from "./offence";
import { FIGHTERS, getFighter } from "@/fighters";
import { ENTRY_INTANGIBILITY, dodgeWindow } from "@/engine/states";
import { FOOTSTOOL_INTANGIBLE_FIRST } from "@/engine/footstool";
import { createInitialState, step } from "@/engine/simulate";
import type { InputFrame } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { BEHAVIOURS, cpuWorldFromDef, decideCpu, tuningForLevel } from "./cpu";

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
    ledgeLockout: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 99,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
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
    cinematic: -1,
    stageFrame: 0,
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
    airBrake: 0,
    airDodge: DEFAULT_AIR_DODGE,
    recovery: null,
    fighterDef: null,
    matchDefs: [],
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
    // Tumbling after the hitstun is free to act, like a fall (SmashWiki "Tumbling").
    expect(isStunned(fighter(0, { action: "tumbleFall" }))).toBe(false);
    expect(canAct(fighter(0, { action: "tumbleFall" }))).toBe(true);
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

  // A fighter in an air dodge cannot act until it ends, and a neutral one keeps
  // falling (Plan 3, Task 20b): chasing an opponent toward the ledge in one would
  // drift it off the stage with no way back, so it steers back over the stage.
  it("steers back over the stage while an air dodge's drift would carry it off", () => {
    const dodging = (x: number, vx: number, over: Partial<FighterState> = {}) =>
      gameState([fighter(0, { x: fx(x), y: fx(15), vx: fx(vx), grounded: false, platform: -1, action: "airDodge", ...over })]);
    const result = recover(context(dodging(-70, -1), L9));
    expect(result.score).toBeGreaterThan(0);
    expect(result.input).toBe(Btn.Right);
    expect(recover(context(dodging(-70, 1), L9)).score).toBe(0);
    expect(recover(context(dodging(0, -1), L9)).score).toBe(0);
    // Steering is drift, which `recover` does at every level (Task 20c, M5).
    expect(recover(context(dodging(-70, -1), L1, [0, 0, 0, 0.99, 0, 0])).input).toBe(Btn.Right);
  });

  // Plan 3, Task 20c (the Task 20b review's M5): judged over what is left of
  // the dodge, by the fighter's own length (Mario's neutral 52, its directional
  // sideways 86), not the whole length every frame.
  it("judges the drift over the frames the dodge has left", () => {
    const dodging = (actionFrame: number, charge = 0) =>
      gameState([
        fighter(0, { x: fx(-70), y: fx(15), vx: -fx(1), grounded: false, platform: -1, action: "airDodge", actionFrame, charge }),
      ]);
    // 10 left carry it 10, to -80: still over the stage (-82 is off it).
    expect(recover(context(dodging(DEFAULT_AIR_DODGE.neutralFrames - 10), L9)).score).toBe(0);
    expect(recover(context(dodging(DEFAULT_AIR_DODGE.neutralFrames - 13), L9)).input).toBe(Btn.Right);
    // A directional one sideways runs 86: on its frame 73 it has 13 left.
    const side = airDodgeCharge(-1, 0);
    expect(recover(context(dodging(DEFAULT_AIR_DODGE.sideFrames - 13, side), L9)).input).toBe(Btn.Right);
    expect(recover(context(dodging(DEFAULT_AIR_DODGE.sideFrames - 10, side), L9)).score).toBe(0);
  });
});

/* ---------------------------------------------------------- special fall -- */

describe("recover, now that the up special leaves the fighter helpless (Plan 5, Task 4b)", () => {
  // Mario's own up special, as the CPU models it (`recoveryFromDef`; its
  // agreement with the engine is `recovery.test.ts`'s), off the default stage,
  // whose left ledge is at x -80, y 0.
  const MARIO = getFighter("mario")!;
  const UP_B: RecoveryMove = recoveryFromDef(MARIO)!;
  const withUpB = (state: GameState, tuning = L9): BehaviourContext => ({ ...context(state, tuning), recovery: UP_B });
  /** Out of jumps (one, spent), off the left of the default stage, facing it. */
  const spent = (over: Partial<FighterState> = {}) =>
    gameState([fighter(0, { x: fx(-220), y: 0, vy: 0, grounded: false, platform: -1, jumpsUsed: 1, action: "fall", ...over })]);
  const pressesOver = (ctx: (f: number) => BehaviourContext): number[] => Array.from({ length: 12 }, (_, f) => recover(ctx(f)).input);
  const fires = (inputs: number[]) => inputs.some((i) => held(i, Btn.Special) && held(i, Btn.Up));

  it("takes each fighter's own up special, the one it uses in the air, and its helpless drift at the published multiplier", () => {
    // Since Plan 5, Task 13b the model runs the move (`upBPath`) rather than read a
    // momentum list: it carries the move's length, how it is aimed, and the fall.
    expect(UP_B.slot).toBe("upB");
    // SmashWiki "Mario (SSBU)/Up special": "Animation length 37".
    expect(UP_B.totalFrames).toBe(37);
    expect(UP_B.aim).toBe("tilt");
    expect(UP_B.wallJump).toBe(true);
    // SmashWiki "Mario (SSBU)/Up special": "Helplessness air speed multiplier 0.6".
    expect(UP_B.helplessDrift).toBe(mul(fighterParams(MARIO).air_speed_x_stable, fx(0.6)));
  });

  it("drifts closer rather than spend the up special where it would come down short of the ledge", () => {
    const inputs = pressesOver((f) => withUpB(gameState(spent().fighters, { frame: f })));
    expect(inputs.every((i) => held(i, Btn.Right))).toBe(true);
    expect(fires(inputs)).toBe(false);
  });

  it("spends it once the ledge is in its reach", () => {
    expect(fires(pressesOver((f) => withUpB(gameState(spent({ x: fx(-100), y: fx(-10) }).fighters, { frame: f }))))).toBe(true);
  });

  it("spends it anyway once a few more frames of falling would put the ledge out of its rise", () => {
    expect(fires(pressesOver((f) => withUpB(gameState(spent({ y: fx(-80) }).fighters, { frame: f }))))).toBe(true);
  });

  it("jumps instead while it still has one and the up special is out of reach", () => {
    const inputs = pressesOver((f) => withUpB(gameState(spent({ y: fx(-30), jumpsUsed: 0 }).fighters, { frame: f })));
    expect(fires(inputs)).toBe(false);
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
  });

  it("only drifts home while helpless: no button, at every level, and no other behaviour acts", () => {
    const helpless = (x: number, y: number) =>
      gameState([fighter(0, { x: fx(x), y: fx(y), grounded: false, platform: -1, action: "specialFall" }), fighter(1, { x: fx(x + 10), y: fx(y - 20) })]);
    for (const tuning of [L9, L1]) {
      for (const [x, y, home] of [
        [-100, -10, Btn.Right],
        [100, 20, Btn.Left],
        [-60, 20, Btn.Right],
        [-60, -20, Btn.Left],
      ] as const) {
        const ctx = withUpB(helpless(x, y), tuning);
        expect(isHelpless(ctx.view.self)).toBe(true);
        const r = recover({ ...ctx, rolls: [0, 0, 0, 0.99, 0, 0] });
        expect([r.score > 0, r.input], `${x}, ${y}`).toEqual([true, home]);
        expect(canAct(ctx.view.self)).toBe(false);
        for (const b of BEHAVIOURS) if (b.name !== "recover" && b.name !== "idle") expect(b.run(ctx).score, b.name).toBe(0);
      }
    }
  });
});

/* --------------------------------------------------------------- defence -- */

// Plan 5, Task 19 (ruling R-T18g): the shield decides once a threat, on the first
// frame it sees the swing or grab in range, so these are staged on that frame: the
// attacker `seen` frames into its move, the level's reaction time (Plan 4's tests
// put it 8 or 40 frames in, which is now a threat already decided on).
const seen = (t: LevelTuning) => t.reactionFrames;

describe("shield", () => {
  const swinging = (actionFrame: number) =>
    gameState([fighter(0), fighter(1, { x: fx(20), action: "attack", actionFrame })]);

  it("shields an attack it has had time to see", () => {
    const result = shield(context(swinging(seen(L9)), L9));
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
      fighter(1, { x: fx(14), action: "grab", actionFrame: seen(L9) }),
    ]);
    const result = shield(context(grabbed, L9));
    expect(held(result.input, Btn.Down)).toBe(true);
    expect(held(result.input, Btn.Shield)).toBe(true);
  });

  it("backs off instead of holding a shield that is about to break", () => {
    const state = gameState([
      fighter(0, { shieldHealth: fx(5) }),
      fighter(1, { x: fx(20), action: "attack", actionFrame: seen(L9) }),
    ]);
    expect(held(shield(context(state, L9)).input, Btn.Left)).toBe(true);
    // And from a shield already up against the swing (the Task 19 review's M1): the
    // spent shield is let go for the roll, not held through the swing.
    const raised = gameState([
      fighter(0, { shieldHealth: fx(5), action: "shield", actionFrame: 6 }),
      fighter(1, { x: fx(20), action: "attack", actionFrame: seen(L9) + 6 }),
    ]);
    const r = shield(context(raised, L9));
    expect([held(r.input, Btn.Left), held(r.input, Btn.Shield)]).toEqual([true, true]);
  });

  // In the air the shield is a neutral air dodge, which keeps the fighter's
  // momentum (Plan 3, Task 20b): one drifting out past the ledge would dodge
  // itself off the stage, so the CPU does not take it.
  it("does not air-dodge when its drift would carry it off the stage during the dodge", () => {
    const airborne = (x: number, vx: number) =>
      gameState([
        fighter(0, { x: fx(x), y: fx(15), vx: fx(vx), grounded: false, platform: -1, action: "fall" }),
        fighter(1, { x: fx(x + 20), y: fx(15), action: "attack", actionFrame: seen(L9) }),
      ]);
    expect(shield(context(airborne(-66, -1.2), L9)).score).toBe(0);
    expect(held(shield(context(airborne(-66, 1.2), L9)).input, Btn.Shield)).toBe(true);
    expect(held(shield(context(airborne(0, -1.2), L9)).input, Btn.Shield)).toBe(true);
    // Air friction shortens the drift: 1.2 a frame bled by 0.015 a frame carries
    // 41.7 over Mario's 52-frame dodge, not 62.4, so from x -30 it stays on the stage.
    expect(shield(context(airborne(-30, -1.2), L9)).score).toBe(0);
    const braked = { ...context(airborne(-30, -1.2), L9), airBrake: fx(0.015) };
    expect(held(shield(braked).input, Btn.Shield)).toBe(true);
  });

  // Plan 3, Task 20c: over the fighter's own neutral length. Fox's is 38
  // (fudgepop01 `fighter_param_motion.xml` @523374aa L734), 45.6 at 1.2 a frame:
  // from x -30 that stays on the stage where Mario's 52 (62.4) does not.
  it("judges the dodge's drift by the fighter's own length", () => {
    const airborne = gameState([
      fighter(0, { x: fx(-30), y: fx(15), vx: -fx(1.2), grounded: false, platform: -1, action: "fall" }),
      fighter(1, { x: fx(-10), y: fx(15), action: "attack", actionFrame: seen(L9) }),
    ]);
    expect(shield(context(airborne, L9)).score).toBe(0);
    const fox = { ...context(airborne, L9), airDodge: { ...DEFAULT_AIR_DODGE, neutralFrames: 38 } };
    expect(held(shield(fox).input, Btn.Shield)).toBe(true);
  });

  // A spent shield in the air backs off with a directional air dodge, `away | Shield`
  // (Task 20c fix round, the review's M3): 7 back, 20 forward and the 1.3 it hands
  // to drift. Fox's sideways one runs 63 frames (fudgepop01 `fighter_param_motion.xml`
  // @523374aa L822), and with his air friction 0.015 it carries him 59.9 (`sideDodgeTravel`):
  // from x 72 on Battlefield (ledge 80) that is off the stage, so he neutral-dodges
  // instead; from the middle it is not.
  describe("a spent shield in the air", () => {
    const FOX = { ...DEFAULT_AIR_DODGE, neutralFrames: 38, sideFrames: 63 };
    const spent = (x: number, tuning: LevelTuning) =>
      gameState([
        fighter(0, { x: fx(x), y: fx(20), grounded: false, platform: -1, action: "fall", shieldHealth: fx(10) }),
        fighter(1, { x: fx(x - 20), y: fx(20), action: "attack", actionFrame: seen(tuning) }),
      ]);
    const fox = (x: number, tuning = L9, rolls?: number[]) => ({ ...context(spent(x, tuning), tuning, rolls), airDodge: FOX, airBrake: fx(0.015) });

    it("is how far the engine's sideways dodge goes", () => {
      expect(sideDodgeTravel(1, fx(0.015), FOX)).toBe(fx(20) - fx(7) + dodgeDrift(fx(1.3), fx(0.015), 63 - 11));
      expect(sideDodgeTravel(-1, fx(0.015), FOX)).toBe(-sideDodgeTravel(1, fx(0.015), FOX));
    });

    it("dodges away when the travel stays over the stage", () => {
      const result = shield(fox(0));
      expect(held(result.input, Btn.Right) && held(result.input, Btn.Shield)).toBe(true);
    });

    it("does not dodge away off the stage: it takes the neutral dodge instead", () => {
      const result = shield(fox(72));
      expect(held(result.input, Btn.Shield)).toBe(true);
      expect(held(result.input, Btn.Right)).toBe(false);
    });

    it("still rolls on the ground, where a roll is no air dodge", () => {
      const grounded = { ...fox(72), state: gameState([fighter(0, { x: fx(72), shieldHealth: fx(10) }), fighter(1, { x: fx(52), action: "attack", actionFrame: seen(L9) })]) };
      const result = shield({ ...grounded, view: observe(grounded.state, 0, L9.reactionFrames) });
      expect(held(result.input, Btn.Right)).toBe(true);
    });

    it("forgets the guard when its recovery roll fails, as a low level does", () => {
      const result = shield(fox(72, L1, [0, 0, 0, 0.5, 0, 0]));
      expect(held(result.input, Btn.Right) && held(result.input, Btn.Shield)).toBe(true);
    });
  });

  // Knowing the dodge drifts it off is recovery judgement: a CPU whose recovery
  // roll fails forgets it, as `recover` has it forget the jump back (Task 20c, M5).
  it("forgets the guard when its recovery roll fails, as a low level does", () => {
    const airborne = (t: LevelTuning) =>
      gameState([
        fighter(0, { x: fx(-66), y: fx(15), vx: -fx(1.2), grounded: false, platform: -1, action: "fall" }),
        fighter(1, { x: fx(-46), y: fx(15), action: "attack", actionFrame: seen(t) }),
      ]);
    const rolls = (recovery: number) => [0, 0, 0, recovery, 0, 0];
    expect(rolls(0)[ROLL_RECOVER]).toBe(0);
    expect(shield(context(airborne(L1), L1, rolls(0))).score).toBe(0);
    expect(held(shield(context(airborne(L1), L1, rolls(0.5))).input, Btn.Shield)).toBe(true);
    // Level 9 never fails the roll (recoverySkill 1).
    expect(shield(context(airborne(L9), L9, rolls(0.99))).score).toBe(0);
  });
});

describe("dodgeDrift", () => {
  it("is the drift that air friction leaves over the frames given, frame by frame", () => {
    const cases: [number, number][] = [
      [fx(1.2), fx(0.015)],
      [-fx(0.3), fx(0.0038)],
      [fx(2), fx(0.05)],
      [-fx(0.9), 0],
    ];
    for (const frames of [DEFAULT_AIR_DODGE.neutralFrames, 38, 7, 0]) {
      for (const [vx, brake] of cases) {
        // The engine's neutral stick: `approach(controlX, 0, air_brake_x)`, then move.
        let v = Math.abs(vx);
        let x = 0;
        for (let i = 0; i < frames; i++) {
          v = Math.max(v - brake, 0);
          x += v;
        }
        expect(dodgeDrift(vx, brake, frames), `${toFloat(vx)} at ${toFloat(brake)} over ${frames}`).toBe(vx < 0 ? -x : x);
      }
    }
  });

  it("is nothing once the dodge has no frames left", () => {
    expect(dodgeDrift(fx(1.2), fx(0.015), -3)).toBe(0);
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

  it("does not take a target standing on a floor past the ledge for one off the stage (ruling R-FW1l)", () => {
    // Town & City's outer platforms hang past the ledges: an opponent standing on one
    // is past the ledge in x (`isOffstage`), but on a floor. Airborne, on the ledge or
    // helpless, it is the edgeguard's target; standing, it is not.
    const standing = gameState([fighter(0, { x: fx(40) }), fighter(1, { x: fx(94), y: fx(41.5), grounded: true })]);
    expect(isOffstage(standing.fighters[1], DEFAULT_STAGE_VIEW)).toBe(true);
    expect(edgeguard(context(standing, L9)).score).toBe(0);
    for (const over of [{ grounded: false }, { grounded: false, ledge: { platform: 0, side: 1 } }, { grounded: false, action: "specialFall" as const }]) {
      const s = gameState([fighter(0, { x: fx(40) }), fighter(1, { x: fx(94), y: fx(41.5), actionFrame: 30, ...over })]);
      expect(edgeguard(context(s, L9)).score, JSON.stringify(over)).toBeGreaterThan(0);
    }
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
      // Plan 5: a tech and a hitstun cancel are survival too.
      "tech",
      "escape",
      "survive",
      // Plan 5, Task 19: the specials, each where its urgency puts it; a mash
      // and a sideways recovery are survival too.
      "mash",
      "sideRecover",
      "recover",
      "holding",
      "finalSmash",
      "parry",
      "reflect",
      "counter",
      "shield",
      "edgeguard",
      "storeCharge",
      "smashSpecial",
      "smashBall",
      "attack",
      "platformMove",
      "approach",
      "retreat",
      // Plan 5, Task 19: back to the middle with nobody to fight.
      "centre",
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

  // Plan 3, Task 18: an activated script's box can be a capsule, and the sim hits
  // with all of it, so its reach is whichever end is further out.
  it("reads an extended box's reach off its further end, whichever that is", () => {
    const out = { hitboxes: [{ x: fx(4), x2: fx(10), radius: fx(2) }] } as unknown as Parameters<typeof moveReach>[0];
    const back = { hitboxes: [{ x: fx(10), x2: fx(7), radius: fx(2) }] } as unknown as Parameters<typeof moveReach>[0];
    expect(toFloat(moveReach(out))).toBeCloseTo(12, 6);
    expect(toFloat(moveReach(back))).toBeCloseTo(12, 6);
  });
});

/* ------------------------------------------- loops and the edge (Plan 5, Task 19) -- */

describe("breaking a loop against the same defence (Plan 5, Task 19)", () => {
  it("does not swing at a target it cannot hit: rolling, dodging or hanging intangible, or invincible", () => {
    for (const over of [{ action: "roll", intangible: 10 }, { action: "spotDodge", intangible: 6 }, { action: "ledgeHang", intangible: 30 }, { action: "stand", invincible: 60 }] as const) {
      const state = gameState([fighter(0), fighter(1, { x: fx(10), actionFrame: 20, ...over })]);
      expect(attack(context(state, L9)).score, over.action).toBe(0);
    }
  });

  it("sees a target's intangibility only with the action it has noticed: a roll's start is still a target (ruling R-T19k)", () => {
    // The roll two frames in: a level 9 (4 frames) still believes it standing, and swings;
    // a level 1 (30) for longer. Once the roll is seen, it holds off.
    // A roll's intangibility is a window, held at 1 a frame at a time (a countdown of 2 or
    // more is a ledge's or the entry's grant, read off its own clock: R-T19k amended).
    const rolling = (actionFrame: number) => gameState([fighter(0), fighter(1, { x: fx(10), action: "roll", actionFrame, intangible: 1 })]);
    expect(attack(context(rolling(2), L9)).score).toBeGreaterThan(0);
    expect(attack(context(rolling(seen(L9)), L9)).score).toBe(0);
    expect(attack(context(rolling(20), tuningForLevel(1))).score).toBeGreaterThan(0);
  });

  it("keeps invulnerability it has already seen, and respawn invincibility, visible across an action change (R-T19k amended)", () => {
    // A ledge's intangibility, set at the grab, carried into the get-up two frames in:
    // the hang under it (at least LEDGE_HANG_MIN frames) was seen, and so was the
    // intangibility. A level 9 holds off.
    const climbing = gameState([fighter(0), fighter(1, { x: fx(10), action: "ledgeGetUp", actionFrame: 2, intangible: 40 })]);
    expect(observe(climbing, 0, L9.reactionFrames).target?.intangible).toBe(40);
    expect(attack(context(climbing, L9)).score).toBe(0);
    // A ledge's grant carried on past the get-up, into an aerial out of a ledge jump: 33 of
    // its least 64 (no air time, no damage, a first grab) left, so 31 frames on at least.
    const carried = gameState([fighter(0), fighter(1, { x: fx(10), action: "attack", actionFrame: 4, intangible: 33, ledgeRegrabs: 1, grounded: false })]);
    for (const t of [L9, tuningForLevel(7)]) expect(observe(carried, 0, t.reactionFrames).target?.intangible, `level reaction ${t.reactionFrames}`).toBe(33);
    // The entry drop's, exactly: 12 frames on, so seen at levels 9 and 7, not at level 1.
    const entering = (over: Partial<FighterState>) => gameState([fighter(0), fighter(1, { x: fx(10), action: "fall", actionFrame: 3, intangible: ENTRY_INTANGIBILITY - 12, ...over })]);
    expect([L9, tuningForLevel(7), tuningForLevel(1)].map((t) => observe(entering({}), 0, t.reactionFrames).target?.intangible)).toEqual([ENTRY_INTANGIBILITY - 12, ENTRY_INTANGIBILITY - 12, 0]);
    // Respawn invincibility shows on screen: a live read, at any level.
    for (const t of [L9, tuningForLevel(1)]) {
      const respawned = gameState([fighter(0), fighter(1, { x: fx(10), action: "fall", actionFrame: 1, invincible: 100 })]);
      expect(observe(respawned, 0, t.reactionFrames).target?.invincible, `level reaction ${t.reactionFrames}`).toBe(100);
      expect(attack(context(respawned, t)).score, `level reaction ${t.reactionFrames}`).toBe(0);
    }
  });

  it("hides an intangibility that began inside the window it has not seen yet, read off the action's own frames (R-T19k amended)", () => {
    const mario = getFighter("mario")!;
    const rolling = (actionFrame: number) => gameState([fighter(0), fighter(1, { x: fx(10), action: "roll", actionFrame, intangible: 1 })]);
    const w = dodgeWindow(rolling(0).fighters[1], mario.attributes)!;
    const seenAt = (actionFrame: number) => observe(rolling(actionFrame), 0, L9.reactionFrames, [mario, mario]).target?.intangible;
    // Begun one frame ago, inside the 4 frames a level 9 has not seen: hidden.
    expect(seenAt(w[0] + 1)).toBe(0);
    expect(attack({ ...context(rolling(w[0] + 1), L9), view: observe(rolling(w[0] + 1), 0, L9.reactionFrames, [mario, mario]) }).score).toBeGreaterThan(0);
    // Begun as long ago as the level's reaction: seen.
    expect(seenAt(w[0] + L9.reactionFrames)).toBe(1);
    // A hold no table gives, begun with its action (Kirby's mouthful), from the action's
    // start; a footstool jump's by its own clock, whatever the jump's frame.
    const swallowed = (actionFrame: number) => gameState([fighter(0), fighter(1, { x: fx(10), action: "swallowed", actionFrame, intangible: 1 })]);
    expect([3, 4].map((af) => observe(swallowed(af), 0, L9.reactionFrames).target?.intangible)).toEqual([0, 1]);
    const bounced = (since: number) => {
      const f = fighter(1, { x: fx(10), action: "jump", actionFrame: 20, intangible: 1, grounded: false });
      f.combat.footstoolFrame = FOOTSTOOL_INTANGIBLE_FIRST + since;
      return gameState([fighter(0), f]);
    };
    expect([1, L9.reactionFrames].map((k) => observe(bounced(k), 0, L9.reactionFrames).target?.intangible)).toEqual([0, 1]);
  });

  it("after the same move has met the shield three times running, grabs it in grab range or walks in, rather than poke it again", () => {
    const poked = (gap: number) => {
      const self = fighter(0, { staleQueue: ["jab1", "jab1", "jab1"] });
      self.combat.staleShield = [true, true, true];
      return gameState([self, fighter(1, { x: fx(gap), action: "shield", actionFrame: 30 })]);
    };
    const near = attack(context(poked(9), L9));
    expect(held(near.input, Btn.Grab) || near.input === 0).toBe(true);
    expect(held(near.input, Btn.Attack)).toBe(false);
    const far = attack(context(poked(16), L9));
    expect([far.score > 0, held(far.input, Btn.Attack), held(far.input, Btn.Right)]).toEqual([true, false, true]);
    // A mix of moves, or one that landed off the shield, is no loop.
    const mixed = poked(16);
    mixed.fighters[0].staleQueue = ["jab1", "ftilt", "jab1"];
    expect(attack(context(mixed, L9)).input).not.toBe(Btn.Right);
  });
});

describe("leaving the edge while the opponent respawns (Plan 5, Task 19)", () => {
  it("walks back toward the middle with nobody to fight, and stops there", () => {
    const away = gameState([fighter(0, { x: fx(76) }), fighter(1, { action: "respawnPlatform", x: fx(-20), y: fx(60) })]);
    expect(BEHAVIOURS.map((b) => b.run(context(away, L9))).some((r) => r.score > 1 && held(r.input, Btn.Left))).toBe(true);
    const home = gameState([fighter(0, { x: fx(3) }), fighter(1, { action: "respawnPlatform", x: fx(-20), y: fx(60) })]);
    expect(BEHAVIOURS.map((b) => b.run(context(home, L9))).every((r) => r.score <= 1)).toBe(true);
  });
});

/* ----------------------------------- point blank (Plan 5 final wave, R-FW1a, R-FW1b) -- */

describe("turning at point blank (Plan 5 final wave, ruling R-FW1a; the final review's I1)", () => {
  // A target 0.6 behind: a full press would start a dash that carries the CPU about two
  // units past it (I1's trace: Pikachu at 28.1 and 30.0 in turn, every frame, around an
  // idle Fox at 28.7), and next frame it would be behind again.
  const behind = (over: Partial<FighterState>, gap = 0.6) => gameState([fighter(0, { facing: -1, framesSinceDirPress: 30, ...over }), fighter(1, { x: fx(gap), actionFrame: 30 })]);

  it("in a dash or a run, lets go of the stick for a frame, so the dash ends, rather than dash back past the target", () => {
    for (const action of ["dashStart", "run"] as const) {
      expect(attack(context(behind({ action, vx: -fx(1.9) }), L9)).input, action).toBe(0);
      expect(pressToward(behind({ action }).fighters[0], fx(0.6)), action).toBe(0);
    }
  });

  it("from a standstill or a walk, turns with a part-way push, which never dashes, smashes or stick-jumps", () => {
    for (const action of ["stand", "walk"] as const) {
      expect(attack(context(behind({ action }), L9)).input, action).toBe(Btn.Right | Btn.Soft);
    }
  });

  it("turns with the whole stick from further than point blank, as before", () => {
    expect(POINT_BLANK).toBe(fx(6));
    expect(attack(context(behind({ action: "dashStart" }, 6), L9)).input).toBe(Btn.Right);
    expect(attack(context(behind({ action: "stand" }, 12), L9)).input).toBe(Btn.Right);
    expect(pressToward(behind({ action: "run" }).fighters[0], fx(5.99))).toBe(0);
    expect(pressToward(behind({ action: "run" }).fighters[0], -fx(6))).toBe(Btn.Left);
  });

  it("brakes another way where a let-go would slide off a platform with nothing under it, not off one over the stage (ruling R-FW1p)", () => {
    // Town & City's outer platforms run past the main ledge to about ±99: a dash let go
    // near the right one's outer end slides off it into nothing. Off the centre platform's
    // end, the fall lands on the stage.
    const dashing = (x: number, platform: number, y: number) => {
      const s = createInitialState("townAndCity", [{ defId: "fox" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
      Object.assign(s.fighters[0], { x: fx(x), y, grounded: true, action: "dashStart", actionFrame: 2, platform, facing: 1, intangible: 0, invincible: 0 });
      kineticSet(s.fighters[0], fx(2.2), 0);
      Object.assign(s.fighters[1], { x: fx(-40), y: 0, grounded: true, action: "stand", actionFrame: 30, platform: 0, intangible: 0, invincible: 0 });
      s.frame = 0;
      return bakedCtx(s);
    };
    const view = stageViewFromDef(BAKED.stage("townAndCity"));
    const outer = view.platforms.reduce((a, b) => (b.x > a.x ? b : a));
    const centre = view.platforms.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
    expect(slidesOff(dashing(96, 3, outer.y), 0), "off the outer platform's end").toBe(true);
    expect(slidesOff(dashing(16, 1, centre.y), 0), "off the centre platform, over the stage").toBe(false);
  });

  it("lets a shield down rather than press a direction in it, which is a roll (fix round 1, ruling R-FW1n)", () => {
    for (const action of ["shieldStart", "shield", "shieldStun"] as const) {
      expect(pressToward(behind({ action }).fighters[0], fx(3)), action).toBe(0);
      expect(pressToward(behind({ action }).fighters[0], fx(30)), action).toBe(0);
    }
  });

  it("approaches a target straight above with the same press: no dash back and forth under it", () => {
    // Out of reach only by height: the review's approach dance under a falling target.
    const under = (action: "dashStart" | "stand") => gameState([fighter(0, { action, facing: -1, framesSinceDirPress: 30 }), fighter(1, { x: fx(0.6), y: fx(22), grounded: false, action: "fall", actionFrame: 30 })]);
    expect(approach(context(under("dashStart"), L9)).input).toBe(0);
    expect(approach(context(under("stand"), L9)).input).toBe(Btn.Right | Btn.Soft);
  });
});

/**
 * The game's baked world (Plan 4), for the swings a point-blank CPU reads off its own move
 * data: its boxes, run by the engine's own rules from where it stands, against the
 * target's baked hurt capsules.
 */
const BAKED = bakedContext(
  { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((x) => x.id === id)! },
  readBakeFromDisk(),
);

/** `a` on port 0 facing right at x 0, `b` on port 1 `gap` ahead, both standing on Final Destination; frame 0 is a swing frame. */
function pointBlank(a: string, b: string, gap: number, over: Partial<FighterState> = {}): GameState {
  const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
  Object.assign(s.fighters[0], { x: 0, y: 0, facing: 1, action: "stand", actionFrame: 30, grounded: true, intangible: 0, invincible: 0, framesSinceDirPress: 30, ...over });
  Object.assign(s.fighters[1], { x: fx(gap), y: 0, facing: -1, action: "stand", actionFrame: 30, grounded: true, intangible: 0, invincible: 0 });
  s.frame = 0;
  return s;
}

/** The level-9 context `decideCpu` builds for port 0 in the baked world. */
function bakedCtx(state: GameState): BehaviourContext {
  const defs = state.fighters.map((f) => BAKED.fighter(f.defId));
  const view = stageViewFromDef(BAKED.stage(state.stageId));
  const world = cpuWorldFromDef(defs[0], view, defs, (id) => BAKED.fighter(id), BAKED.bake);
  return {
    state,
    view: observe(state, 0, L9.reactionFrames, defs),
    stage: view,
    tuning: L9,
    jumps: world.jumps!,
    meleeReach: world.meleeReach!,
    airBrake: world.airBrake!,
    airDodge: world.airDodge!,
    recovery: world.recovery ?? null,
    fighterDef: defs[0],
    matchDefs: defs,
    bake: BAKED.bake,
    rolls: new Array(DECISION_ROLLS).fill(0),
  };
}

/** Whether `input`, pressed on the scene's first frame and nothing after, lands a hit on port 1 in the engine. */
function landsInEngine(state: GameState, input: InputFrame): boolean {
  let s = state;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < 60; i++) {
    const now = [i === 0 ? input : 0, 0];
    const out = step(s, now, { prevInputs: prev, ctx: BAKED });
    if (out.events.hits.some((h) => h.attacker === 0 && h.victim === 1)) return true;
    s = out.state;
    prev = now;
  }
  return false;
}

describe("swinging at point blank at a short target (Plan 5 final wave, ruling R-FW1b; the final review's I1)", () => {
  const JAB = Btn.Attack;
  const FTILT = Btn.Right | Btn.Soft | Btn.Attack;
  const UTILT = Btn.Up | Btn.Soft | Btn.Attack;
  const DTILT = Btn.Down | Btn.Soft | Btn.Attack;

  it("uses the tilt whose box covers the overlap, read off its move data: Marth's and Link's down tilts on Kirby", () => {
    // Marth's jab, forward tilt and up tilt pass over Kirby at 1.5; his down tilt reaches him.
    expect(attack(bakedCtx(pointBlank("marth", "kirby", 1.5))).input).toBe(DTILT);
    // Link's jab and forward tilt reach Kirby only from further out; his down tilt does here.
    expect(attack(bakedCtx(pointBlank("link", "kirby", 0.5))).input).toBe(DTILT);
  });

  it("swings the jab, not the forward tilt its stale direction would make, where only the jab reaches: Donkey Kong on Mario", () => {
    expect(attack(bakedCtx(pointBlank("donkeyKong", "mario", 1))).input).toBe(JAB);
  });

  it("steps back a frame where nothing it has reaches: Marth over Kirby at 0.14, and on Pikachu at 1.5", () => {
    // The final review's whiff loops: Marth's jabs and tilts through a short fighter
    // standing at his own origin, thousands of frames, never connecting.
    for (const [b, gap] of [["kirby", 0.14], ["pikachu", 1.5]] as const) {
      const r = attack(bakedCtx(pointBlank("marth", b, gap)));
      expect([held(r.input, Btn.Attack), r.input & (Btn.Left | Btn.Right)], b).toEqual([false, Btn.Left]);
    }
  });

  it("agrees with the engine: what it swings lands, and where it steps back, nothing it has would", () => {
    expect(landsInEngine(pointBlank("marth", "kirby", 1.5), DTILT)).toBe(true);
    expect(landsInEngine(pointBlank("link", "kirby", 0.5), DTILT)).toBe(true);
    expect(landsInEngine(pointBlank("donkeyKong", "mario", 1), JAB)).toBe(true);
    expect(landsInEngine(pointBlank("donkeyKong", "mario", 1), FTILT)).toBe(false);
    for (const [b, gap] of [["kirby", 0.14], ["pikachu", 1.5]] as const)
      for (const swing of [JAB, FTILT, UTILT, DTILT]) expect(landsInEngine(pointBlank("marth", b, gap), swing), `${b} swing ${swing}`).toBe(false);
  });

  it("ends a dash rather than swing a dash attack that would carry it past the target: Pikachu at an idle Link 1.2 ahead", () => {
    // The sweep's dash-attack loop: from 1.2, the dash attack's slide takes Pikachu past
    // Link before its box comes out, and then back again from the other side.
    const dashing = pointBlank("pikachu", "link", 1.2, { action: "dashStart", actionFrame: 4, vx: fx(2.04) });
    expect(landsInEngine(dashing, Btn.Right | Btn.Attack)).toBe(false);
    expect(attack(bakedCtx(dashing)).input).toBe(0);
  });

  it("judges a swing pressed in its own swing as it would come out, from a standstill there, and presses none that would not land", () => {
    // The review's whiff loop was swing after swing, each pressed inside the last: Marth
    // mid-jab over Kirby at 0.14 presses nothing, and the first free frame chooses.
    expect(attack(bakedCtx(pointBlank("marth", "kirby", 0.14, { action: "attack", move: "jab1", actionFrame: 12 }))).input).toBe(0);
    // Where the swing would land from there, it is pressed: Donkey Kong's jab on Mario at 1.
    expect(attack(bakedCtx(pointBlank("donkeyKong", "mario", 1, { action: "attack", move: "jab1", actionFrame: 12, framesSinceDirPress: 2 }))).input).toBe(JAB);
  });

  it("judges a swing pressed in a jab as the jab's next hit, which the press starts there and then (ruling R-FW1o)", () => {
    // A press from the jab's third frame starts its follow-up at once (the attack
    // status's `followUp`), not a fresh jab after it. Samus's second jab passes over
    // Kirby at 1, where a fresh first jab would land: it is not pressed. Mario's second
    // jab lands on Mario at 1, where a fresh first jab would not: it is.
    const samus = pointBlank("samus", "kirby", 1, { action: "attack", move: "jab1", actionFrame: 4, framesSinceDirPress: 2 });
    const mario = pointBlank("mario", "mario", 1, { action: "attack", move: "jab1", actionFrame: 3, framesSinceDirPress: 2 });
    expect([landsInEngine(samus, JAB), landsInEngine(mario, JAB)]).toEqual([false, true]);
    expect([held(attack(bakedCtx(samus)).input, Btn.Attack), held(attack(bakedCtx(mario)).input, Btn.Attack)]).toEqual([false, true]);
  });

  it("judges a swing pressed in a ledge get-up from where the get-up puts it (ruling R-FW1n): Marth past Mario at Town & City's ledge", () => {
    // The re-review's marth-mario@townAndCity (seed 3256): Mario standing at 83.10 by the
    // right ledge (83.22), Marth getting up from it to 75.22, facing in, Mario behind him.
    // The jab buffered in the get-up came out facing away, every time round.
    const s = createInitialState("townAndCity", [{ defId: "marth" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
    Object.assign(s.fighters[0], { x: fx(83.22), y: 0, grounded: false, action: "ledgeGetUp", actionFrame: 20, ledge: { platform: 0, side: 1 }, facing: -1, platform: -1, intangible: 0, invincible: 0, framesSinceDirPress: 30 });
    Object.assign(s.fighters[1], { x: fx(83.1), y: 0, grounded: true, action: "stand", actionFrame: 30, platform: 0, facing: -1, intangible: 0, invincible: 0 });
    s.frame = 0;
    expect(landsInEngine(s, JAB)).toBe(false);
    expect(held(attack(bakedCtx(s)).input, Btn.Attack)).toBe(false);
    // With Mario at 74, in front of where the get-up puts Marth, the jab lands: pressed.
    s.fighters[1].x = fx(74);
    expect(landsInEngine(s, JAB)).toBe(true);
    expect(held(attack(bakedCtx(s)).input, Btn.Attack)).toBe(true);
  });

  it("does not take the air over Town & City's outer platforms for off the stage; it still recovers over no floor (ruling R-FW1p)", () => {
    // Past the main ledge in x (83.22) but over the right outer platform (79.81 ± 19.25, at
    // 41.54), the fighter's own fall lands on the platform: it is not recovering. Past that
    // platform, or under it, nothing would catch the fall: it is.
    const tc = (x: number, y: number, vx = 0) => {
      const s = createInitialState("townAndCity", [{ defId: "fox" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
      Object.assign(s.fighters[0], { x: fx(x), y: fx(y), grounded: false, action: "fall", actionFrame: 5, jumpsUsed: 1, platform: -1, facing: 1, intangible: 0, invincible: 0 });
      kineticSet(s.fighters[0], fx(vx), -fx(0.5));
      Object.assign(s.fighters[1], { x: fx(-40), y: 0, grounded: true, action: "stand", actionFrame: 30, platform: 0, intangible: 0, invincible: 0 });
      s.frame = 0;
      return bakedCtx(s);
    };
    expect(recover(tc(93, 60)).score, "over the outer platform").toBe(0);
    expect(recover(tc(-94, 70)).score, "over the left one").toBe(0);
    expect(recover(tc(108, 30)).score, "past it, over nothing").toBeGreaterThan(0);
    expect(recover(tc(93, 30)).score, "under it").toBeGreaterThan(0);
    // Over its span but carried out past its end before the fall comes down, whatever the
    // stick: its fall is run, not its x read.
    expect(recover(tc(104, 47, 2.5)).score, "carried out past it").toBeGreaterThan(0);
    const fd = createInitialState("finalDestination", [{ defId: "fox" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
    Object.assign(fd.fighters[0], { x: fx(-100), y: fx(10), grounded: false, action: "fall", actionFrame: 5, jumpsUsed: 1, platform: -1, facing: 1, intangible: 0, invincible: 0 });
    fd.frame = 0;
    expect(recover(bakedCtx(fd)).score, "off Final Destination").toBeGreaterThan(0);
  });

  it("climbs to a player on Town & City's outer platform from over the stage, not out past the ledge under it (ruling R-FW1p)", () => {
    // Pikachu stands at 94 on the right outer platform, past the ledge (83.22). Fox, rising
    // just past the ledge and under the platform's floor, steers back over the stage while
    // he climbs: out there, under the platform, nothing would catch his fall.
    const s = createInitialState("townAndCity", [{ defId: "fox" }, { defId: "pikachu" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
    const view = stageViewFromDef(BAKED.stage("townAndCity"));
    const outer = view.platforms.reduce((a, b) => (b.x > a.x ? b : a));
    Object.assign(s.fighters[1], { x: fx(94), y: outer.y, grounded: true, action: "stand", actionFrame: 30, platform: 3, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[0], { x: view.rightLedge + fx(0.3), y: fx(20), grounded: false, action: "fall", actionFrame: 3, jumpsUsed: 1, platform: -1, facing: 1, intangible: 0, invincible: 0 });
    kineticSet(s.fighters[0], 0, -fx(0.5));
    s.frame = 0;
    const climb = platformMove(bakedCtx(s)).input;
    expect([held(climb, Btn.Left), held(climb, Btn.Jump)]).toEqual([true, true]);
  });

  it("presses at point blank out of a short hop only the aerial that lands in the engine (ruling R-FW1q)", () => {
    // Each frame of a short hop at a target standing 0 to 2 ahead, from the jumpsquat on:
    // whatever aerial the CPU presses there lands, pressed and its stick held, as the engine
    // plays it, and on a frame where none would, it presses none.
    const STICK = Btn.Left | Btn.Right | Btn.Up | Btn.Down;
    const lands = (state: GameState, input: InputFrame): boolean => {
      let st = state;
      let prev: readonly InputFrame[] = [0, 0];
      for (let i = 0; i < 60; i++) {
        const now = [i === 0 ? input : input & STICK, 0];
        const out = step(st, now, { prevInputs: prev, ctx: BAKED });
        if (out.events.hits.some((h) => h.attacker === 0 && h.victim === 1)) return true;
        st = out.state;
        prev = now;
      }
      return false;
    };
    let pressed = 0;
    const missed: string[] = [];
    for (const a of ["marth", "link", "mario", "fox"])
      for (const b of ["kirby", "pikachu"])
        for (const gap of [0, 1, 2]) {
          let st = pointBlank(a, b, gap);
          let prev: readonly InputFrame[] = [0, 0];
          for (let k = 1; k <= 30; k++) {
            const now = [k === 1 ? Btn.Jump : 0, 0];
            const out = step(st, now, { prevInputs: prev, ctx: BAKED });
            st = out.state;
            prev = now;
            const f = st.fighters[0];
            if (out.events.hits.length > 0 || (f.grounded && f.action !== "jumpSquat")) break;
            const input = attack(bakedCtx(st)).input;
            if (!held(input, Btn.Attack)) continue;
            pressed++;
            if (!lands(st, input)) missed.push(`${a} on ${b} at ${gap}, ${f.action}@${f.actionFrame}: ${input}`);
          }
        }
    expect(pressed).toBeGreaterThan(50);
    expect(missed).toEqual([]);
  });

  it("climbs only under the target's own platform: not after walking off the other one at its height (ruling R-FW1k, widened)", () => {
    // The golden's mario-fox: Fox walks off Battlefield's right platform, Mario standing on
    // the left one at the same height; the climb took the right one for Mario's and spent
    // Fox's midair jump. Under Mario's own platform, at the top of his hop, it jumps.
    const s = createInitialState("battlefield", [{ defId: "fox" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
    const view = stageViewFromDef(BAKED.stage("battlefield"));
    const left = view.platforms.reduce((a, b) => (b.x < a.x ? b : a));
    const right = view.platforms.reduce((a, b) => (b.x > a.x ? b : a));
    Object.assign(s.fighters[1], { x: left.x, y: left.y, grounded: true, action: "stand", actionFrame: 30, platform: 1, intangible: 0, invincible: 0 });
    Object.assign(s.fighters[0], { x: right.x - right.halfWidth - fx(2), y: left.y - fx(1.2), grounded: false, action: "fall", actionFrame: 1, vy: -fx(0.2), jumpsUsed: 1, platform: -1, facing: -1, intangible: 0, invincible: 0 });
    s.frame = 0;
    expect(platformMove(bakedCtx(s)).score).toBe(0);
    Object.assign(s.fighters[0], { x: left.x + fx(6), y: left.y - fx(6) });
    expect(held(platformMove(bakedCtx(s)).input, Btn.Jump)).toBe(true);
  });

  it("judges a swing pressed in a ledge get-up as it comes out at the get-up's end, the stick let go or held (ruling R-FW1s)", () => {
    // Re-review 2: Mario on Mario, Final Destination, 10 to 11 in from the ledge, late in
    // the get-up: a forward tilt pressed there came out as a jab, the stick let go by then,
    // and the jab fell short. Whatever it presses in the get-up that comes out must land.
    const ledge = stageViewFromDef(BAKED.stage("finalDestination")).leftLedge;
    const outcome = (state: GameState, input: InputFrame): "hit" | "whiff" | "none" => {
      let st = state;
      let prev: readonly InputFrame[] = [0, 0];
      let swung = false;
      for (let i = 0; i < 80; i++) {
        const now = [i === 0 ? input : 0, 0];
        const out = step(st, now, { prevInputs: prev, ctx: BAKED });
        if (out.events.hits.some((h) => h.attacker === 0 && h.victim === 1)) return "hit";
        st = out.state;
        prev = now;
        swung ||= st.fighters[0].action === "attack";
      }
      return swung ? "whiff" : "none";
    };
    let hits = 0;
    const whiffs: string[] = [];
    for (const [a, b] of [["mario", "mario"], ["marth", "kirby"]] as const)
      for (let frame = 14; frame <= 25; frame++)
        for (let d = 8; d <= 13; d += 0.5) {
          const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
          Object.assign(s.fighters[0], { x: ledge, y: 0, grounded: false, action: "ledgeGetUp", actionFrame: frame, ledge: { platform: 0, side: -1 }, facing: 1, platform: -1, intangible: 0, invincible: 0, framesSinceDirPress: 30 });
          Object.assign(s.fighters[1], { x: ledge + fx(d), y: 0, grounded: true, action: "stand", actionFrame: 30, platform: 0, facing: -1, intangible: 0, invincible: 0 });
          s.frame = 0;
          const input = attack(bakedCtx(s)).input;
          if (!held(input, Btn.Attack)) continue;
          const r = outcome(s, input);
          if (r === "hit") hits++;
          if (r === "whiff") whiffs.push(`${a} on ${b}, get-up frame ${frame}, ${d} in`);
        }
    expect(hits).toBeGreaterThan(5);
    expect(whiffs).toEqual([]);
    // A target on the move is judged where it will be when the swing comes out: Mario
    // running away from 6 in, behind where the get-up puts Mario now and in front of him by
    // then. Judged as if the get-up ended now, nothing was pressed.
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5, BAKED);
    Object.assign(s.fighters[0], { x: ledge, y: 0, grounded: false, action: "ledgeGetUp", actionFrame: 20, ledge: { platform: 0, side: -1 }, facing: 1, platform: -1, intangible: 0, invincible: 0, framesSinceDirPress: 30 });
    Object.assign(s.fighters[1], { x: ledge + fx(6), y: 0, grounded: true, action: "run", actionFrame: 20, platform: 0, facing: 1, intangible: 0, invincible: 0 });
    kineticSet(s.fighters[1], BAKED.fighter("mario").attributes.runSpeed, 0);
    s.frame = 0;
    const input = attack(bakedCtx(s)).input;
    expect(held(input, Btn.Attack), "pressed").toBe(true);
    let st = s;
    let prev: readonly InputFrame[] = [0, Btn.Right];
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      const now = [i === 0 ? input : 0, Btn.Right];
      const out = step(st, now, { prevInputs: prev, ctx: BAKED });
      hit = out.events.hits.some((h) => h.attacker === 0 && h.victim === 1);
      st = out.state;
      prev = now;
    }
    expect(hit, "it lands on the running Mario").toBe(true);
  });

  it("does not step back off the stage: its back to the ledge, it swings where it stands", () => {
    // Marth facing in, a unit inside Final Destination's right ledge, Kirby at 0.14: a step
    // back would walk him off.
    const s = pointBlank("marth", "kirby", 0.14);
    const ledge = stageViewFromDef(BAKED.stage("finalDestination")).rightLedge;
    Object.assign(s.fighters[0], { x: ledge - fx(1), facing: -1 });
    s.fighters[1].x = ledge - fx(1.14);
    expect(attack(bakedCtx(s)).input & Btn.Right).toBe(0);
  });

  it("keeps stepping back, turned away, until a swing would reach, then turns once and lands it", () => {
    let s = pointBlank("marth", "kirby", 0.14);
    const world = cpuWorldFromDef(BAKED.fighter("marth"), stageViewFromDef(BAKED.stage("finalDestination")), [BAKED.fighter("marth"), BAKED.fighter("kirby")], (id) => BAKED.fighter(id), BAKED.bake);
    let prev: readonly InputFrame[] = [0, 0];
    let seed = 7;
    let turns = 0;
    let hit = -1;
    for (let f = 1; f <= 120 && hit < 0; f++) {
      const d = decideCpu(s, 0, 9, seed, world);
      seed = d.seed;
      const out = step(s, [d.input, 0], { prevInputs: prev, ctx: BAKED });
      if (out.state.fighters[0].facing !== s.fighters[0].facing) turns++;
      if (out.events.hits.some((h) => h.attacker === 0)) hit = f;
      s = out.state;
      prev = [d.input, 0];
    }
    expect([hit > 0 && hit <= 60, turns <= 2], `hit on ${hit}, ${turns} turns`).toEqual([true, true]);
  });
});

describe("a threat first seen in its attacker's freeze (Plan 5 final wave, ruling R-FW1h)", () => {
  const rollsWith = (slot: number, value: number): number[] => {
    const rolls = new Array<number>(DECISION_ROLLS).fill(0);
    rolls[slot] = value;
    return rolls;
  };

  it("is decided once, on the freeze's last frame, not on every frame the attacker is frozen at its first sight", () => {
    // A jab first seen by a level 9 (4 frames) on its fourth frame, the frame its hit
    // froze it (on something else): the freeze holds its frame, so the view shows it
    // first seen on every frame of the freeze. Its last frame (hitlag 0) is the one.
    const frozen = (actionFrame: number, hitlag: number) => gameState([fighter(0), fighter(1, { x: fx(10), facing: -1, action: "attack", move: "jab1", actionFrame, hitlag })]);
    const decides = (s: GameState) => shield(context(s, L9)).input === Btn.Shield && shield(context(s, L9, rollsWith(ROLL_SHIELD, 0.99))).input === 0;
    const freeze = [3, 2, 1, 0].map((h) => decides(frozen(L9.reactionFrames, h)));
    expect([...freeze, decides(frozen(L9.reactionFrames + 1, 0))]).toEqual([false, false, false, true, false]);
  });
});
