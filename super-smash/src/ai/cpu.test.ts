import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SHIELD_MAX_HEALTH } from "@/engine/constants";
import { fx } from "@/engine/fixed";
import { Btn, held, type FighterState, type GameState } from "@/engine/types";
import { DEFAULT_STAGE_VIEW } from "./behaviours";
import { MAX_LEVEL, MIN_LEVEL, cpuInput, decideCpu, tuningForLevel } from "./cpu";

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

/* ---------------------------------------------------------- determinism -- */

describe("determinism", () => {
  const state = gameState([fighter(0), fighter(1, { x: fx(35), vx: -fx(1) })], { frame: 91 });

  it("gives the same answer for the same state, port, level and seed", () => {
    for (const level of [1, 4, 9]) {
      const first = cpuInput(state, 0, level, 0x1234abcd);
      const second = cpuInput(state, 0, level, 0x1234abcd);
      expect(second).toEqual(first);
    }
  });

  it("re-simulates identically after a rollback of eight frames", () => {
    // What rollback actually does: replay the same frames from a snapshot and
    // require the same inputs to come out. Any hidden state in the CPU would
    // show up here as a mismatch.
    const run = (): number[] => {
      let seed = 0xfeed;
      const inputs: number[] = [];
      for (let f = 0; f < 8; f++) {
        const result = cpuInput(gameState(state.fighters, { frame: f }), 0, 7, seed);
        seed = result.seed;
        inputs.push(result.input);
      }
      return inputs;
    };
    expect(run()).toEqual(run());
  });

  it("advances the seed by the same number of draws whatever it decides", () => {
    const seeds = [
      cpuInput(state, 0, 9, 99).seed,
      cpuInput(gameState([fighter(0, { hitstun: 20, vx: fx(5) })]), 0, 9, 99).seed,
      cpuInput(gameState([fighter(0, { x: fx(-140), grounded: false })]), 0, 9, 99).seed,
    ];
    // A draw count that varied by branch would desync a rolled-back frame from
    // the one it replaces.
    expect(new Set(seeds).size).toBe(1);
    expect(seeds[0]).not.toBe(99);
  });

  it("returns nothing, and burns nothing, for a fighter that is not playing", () => {
    const dead = gameState([fighter(0, { action: "dead", stocks: 0 }), fighter(1)]);
    expect(cpuInput(dead, 0, 9, 4242)).toEqual({ input: 0, seed: 4242 });
  });

  it("uses no unseeded randomness and no wall clock", () => {
    const root = join(process.cwd(), "src");
    const sources = [
      "ai/cpu.ts",
      "ai/behaviours.ts",
      "input/schemes.ts",
      "input/keyboard.ts",
      "input/gamepad.ts",
    ];

    for (const relative of sources) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, `${relative} must not roll its own dice`).not.toMatch(/Math\s*\.\s*random/);
      expect(source, `${relative} must not read the clock`).not.toMatch(/Date\s*\.\s*now/);
      expect(source, `${relative} must not read the clock`).not.toMatch(/performance\s*\.\s*now/);
    }

    // The simulation-facing half additionally avoids the transcendentals two
    // engines are allowed to disagree about (SPEC section 3 rule 3).
    for (const relative of ["ai/cpu.ts", "ai/behaviours.ts"]) {
      const source = readFileSync(join(root, relative), "utf8");
      expect(source, relative).not.toMatch(/Math\s*\.\s*(sin|cos|tan|pow|exp|log|atan2|hypot)\b/);
    }
  });
});

/* ------------------------------------------------------------- the levels -- */

describe("the level table", () => {
  it("runs reaction time from about 30 frames down to about 4", () => {
    expect(tuningForLevel(1).reactionFrames).toBe(30);
    expect(tuningForLevel(9).reactionFrames).toBe(4);

    for (let level = 2; level <= MAX_LEVEL; level++) {
      expect(tuningForLevel(level).reactionFrames).toBeLessThan(
        tuningForLevel(level - 1).reactionFrames,
      );
    }
  });

  it("rises monotonically on every skill dial and falls on every error dial", () => {
    const rising = ["aggression", "shieldRate", "dodgeRate", "diSkill", "sdiSkill", "recoverySkill", "edgeguardSkill", "moveChoiceSkill"] as const;
    const falling = ["noise", "fumbleChance"] as const;

    for (let level = 2; level <= MAX_LEVEL; level++) {
      const previous = tuningForLevel(level - 1);
      const current = tuningForLevel(level);
      for (const dial of rising) {
        expect(current[dial], `${dial} at level ${level}`).toBeGreaterThanOrEqual(previous[dial]);
      }
      for (const dial of falling) {
        expect(current[dial], `${dial} at level ${level}`).toBeLessThan(previous[dial]);
      }
    }
  });

  it("clamps anything outside 1-9", () => {
    expect(tuningForLevel(0)).toBe(tuningForLevel(MIN_LEVEL));
    expect(tuningForLevel(99)).toBe(tuningForLevel(MAX_LEVEL));
    expect(tuningForLevel(4.4).level).toBe(4);
  });
});

/* --------------------------------------------------------------- in play -- */

/** Sample one situation across many frames and seeds. */
function sample(
  state: GameState,
  level: number,
  frames = 240,
): { inputs: number[]; behaviours: string[] } {
  let seed = 0xc0ffee;
  const inputs: number[] = [];
  const behaviours: string[] = [];
  for (let f = 0; f < frames; f++) {
    const decision = decideCpu(gameState(state.fighters, { frame: f }), 0, level, seed);
    seed = decision.seed;
    inputs.push(decision.input);
    behaviours.push(decision.behaviour);
  }
  return { inputs, behaviours };
}

describe("level 9 versus level 1", () => {
  // Well inside threat range and outside melee range, so shielding is the
  // question on the table and nothing else is.
  const underAttack = gameState([
    fighter(0),
    fighter(1, { x: fx(25), action: "attack", actionFrame: 26 }),
  ]);

  it("shields an incoming attack far more often at level 9 than at level 1", () => {
    const nine = sample(underAttack, 9).inputs.filter((i) => held(i, Btn.Shield)).length;
    const one = sample(underAttack, 1).inputs.filter((i) => held(i, Btn.Shield)).length;

    expect(nine).toBeGreaterThan(one);
    expect(nine).toBeGreaterThan(200);
    // A level-1 CPU's 30-frame delay means the swing is over before it is seen.
    expect(one).toBe(0);
  });

  it("shields more at every step up the ladder", () => {
    const counts = [1, 3, 5, 7, 9].map(
      (level) => sample(underAttack, level).inputs.filter((i) => held(i, Btn.Shield)).length,
    );
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `level ${[1, 3, 5, 7, 9][i]}`).toBeGreaterThan(counts[i - 1]);
    }
  });

  it("fumbles frames at level 1 and never at level 9", () => {
    const neutral = gameState([fighter(0), fighter(1, { x: fx(60) })]);
    const one = sample(neutral, 1).inputs.filter((i) => i === 0).length;
    const nine = sample(neutral, 9).inputs.filter((i) => i === 0).length;
    expect(one).toBeGreaterThan(nine);
  });

  it("commits to one behaviour at level 9 and dithers at level 1", () => {
    const neutral = gameState([fighter(0), fighter(1, { x: fx(60) })]);
    const nine = new Set(sample(neutral, 9).behaviours).size;
    const one = new Set(sample(neutral, 1).behaviours).size;
    // Same behaviours available to both; the noise dial is what makes level 1
    // change its mind.
    expect(one).toBeGreaterThanOrEqual(nine);
  });
});

describe("recovery", () => {
  const offstage = (over: Partial<FighterState> = {}) =>
    gameState([
      fighter(0, { x: fx(-105), y: fx(-12), grounded: false, vy: -fx(1.2), ...over }),
      fighter(1, { x: fx(20) }),
    ]);

  it("a CPU knocked offstage jumps back toward the ledge", () => {
    const { inputs } = sample(offstage(), 9, 60);
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
    expect(inputs.every((i) => held(i, Btn.Right))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Left))).toBe(false);
  });

  it("...and up-Bs once the jump is spent", () => {
    const { inputs } = sample(offstage({ jumpsUsed: 1 }), 9, 60);
    expect(inputs.some((i) => held(i, Btn.Special) && held(i, Btn.Up))).toBe(true);
  });

  it("recovers with the extra jumps a multi-jump fighter has", () => {
    // Kirby has five. Told about them, the CPU spends jumps before the up-B.
    let seed = 7;
    const inputs: number[] = [];
    for (let f = 0; f < 40; f++) {
      const result = cpuInput(gameState(offstage({ jumpsUsed: 2 }).fighters, { frame: f }), 0, 9, seed, {
        jumps: 5,
        stage: DEFAULT_STAGE_VIEW,
      });
      seed = result.seed;
      inputs.push(result.input);
    }
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
    expect(inputs.some((i) => held(i, Btn.Special))).toBe(false);
  });

  it("dies offstage at level 1 far more often than at level 9", () => {
    const deep = offstage({ y: fx(-40), jumpsUsed: 1 });
    const nine = sample(deep, 9, 120).inputs.filter((i) => held(i, Btn.Special)).length;
    const one = sample(deep, 1, 120).inputs.filter((i) => held(i, Btn.Special)).length;
    expect(nine).toBeGreaterThan(one * 3);
  });
});

describe("it cannot read inputs", () => {
  it("behaves identically whether or not the opponent has started a move it cannot see", () => {
    const still = gameState([fighter(0), fighter(1, { x: fx(25) })]);
    const swinging = gameState([
      fighter(0),
      fighter(1, { x: fx(25), action: "attack", actionFrame: 8 }),
    ]);

    // Eight frames into the startup, a level-1 CPU (30 frames of delay) has
    // no way to know. Its inputs must be indistinguishable.
    expect(sample(swinging, 1).inputs).toEqual(sample(still, 1).inputs);

    // A level-9 CPU is past its four frames and reacts.
    expect(sample(swinging, 9).inputs).not.toEqual(sample(still, 9).inputs);
  });

  it("aims at where a moving opponent was, not where it is", () => {
    const running = gameState([fighter(0), fighter(1, { x: fx(70), vx: fx(3) })]);
    // Level 1 sees the opponent 30 frames back, which is 90 units behind — on
    // the far side of the CPU, so it chases the wrong way.
    const one = decideCpu(running, 0, 1, 0xabc);
    const nine = decideCpu(running, 0, 9, 0xabc);
    expect(one.scores).not.toEqual(nine.scores);
  });
});

describe("DI and SDI", () => {
  const launched = gameState([
    fighter(0, { x: fx(140), vx: fx(7), hitstun: 24 }),
    fighter(1, { x: fx(20) }),
  ]);

  it("level 9 DIs perpendicular to the launch, level 1 does not DI at all", () => {
    const nine = sample(launched, 9, 60).inputs;
    const one = sample(launched, 1, 60).inputs;

    expect(nine.every((i) => held(i, Btn.Up))).toBe(true);
    expect(one.every((i) => i === 0)).toBe(true);
  });

  it("level 9 mashes SDI during hitlag and level 1 stands still", () => {
    const frozen = gameState([
      fighter(0, { x: fx(140), vx: fx(7), hitlag: 10 }),
      fighter(1, { x: fx(20) }),
    ]);
    const nine = sample(frozen, 9, 60).inputs;
    expect(nine.some((i) => i !== 0)).toBe(true);
    expect(nine.some((i) => i === 0)).toBe(true);
    expect(sample(frozen, 1, 60).inputs.every((i) => i === 0)).toBe(true);
  });
});

describe("edgeguarding", () => {
  const chasing = gameState([
    fighter(0, { x: fx(50) }),
    fighter(1, { x: fx(115), y: fx(-14), grounded: false }),
  ]);

  it("never happens below level 3 and is routine at level 9", () => {
    const one = sample(chasing, 1).behaviours.filter((b) => b === "edgeguard").length;
    const nine = sample(chasing, 9).behaviours.filter((b) => b === "edgeguard").length;
    expect(one).toBe(0);
    expect(nine).toBeGreaterThan(150);
  });
});

describe("stages", () => {
  it("uses whatever geometry it is handed", () => {
    // A stage half the usual width: what was comfortably onstage is now off it,
    // and the CPU turns round instead of walking further out.
    const narrow = { ...DEFAULT_STAGE_VIEW, leftLedge: fx(-40), rightLedge: fx(40) };
    const state = gameState([
      fighter(0, { x: fx(60), y: fx(10), grounded: false }),
      fighter(1, { x: 0 }),
    ]);

    const onWide = decideCpu(state, 0, 9, 5).behaviour;
    const onNarrow = decideCpu(state, 0, 9, 5, { stage: narrow }).behaviour;
    expect(onWide).not.toBe("recover");
    expect(onNarrow).toBe("recover");
  });
});
