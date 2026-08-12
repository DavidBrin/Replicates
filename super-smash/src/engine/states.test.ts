import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import {
  AIR_DODGE_FRAMES,
  BUFFER_FRAMES,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  JUMP_SQUAT_FRAMES,
  PERFECT_SHIELD_WINDOW,
  ROLL_INTANGIBLE,
  SDI_DISTANCE,
  SHIELD_MIN_HOLD,
  SPOT_DODGE_INTANGIBLE,
} from "./constants";
import {
  advanceFighter,
  aerialSlot,
  applyMovement,
  chargeMultiplier,
  groundAttackSlot,
  interpretInput,
  isParrying,
  onLanded,
  peekBuffer,
  specialSlot,
  startAction,
  updateInputTracking,
} from "./states";
import type { Intent, StateContext } from "./states";
import { Btn } from "./types";
import type {
  FighterAttributes,
  FighterDef,
  FighterState,
  InputFrame,
  MoveDef,
  StageDef,
} from "./types";

/* ------------------------------------------------------------- fixtures -- */

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.1),
  initialDashSpeed: fx(1.76),
  runSpeed: fx(1.5),
  airSpeed: fx(1.15),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.05),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.08),
  fullHopVelocity: fx(3.1),
  shortHopVelocity: fx(1.7),
  airJumpVelocity: fx(2.85),
  jumps: 2,
  canWallJump: true,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

function move(slot: MoveDef["slot"], over: Partial<MoveDef> = {}): MoveDef {
  return {
    slot,
    name: slot,
    totalFrames: 20,
    hitboxes: [
      {
        id: 0,
        startFrame: 4,
        endFrame: 6,
        x: fx(8),
        y: fx(6),
        radius: fx(4),
        damage: fx(10),
        angle: fx(45),
        baseKnockback: fx(30),
        knockbackGrowth: fx(100),
      },
    ],
    ...over,
  };
}

const DEF: FighterDef = {
  id: "test",
  name: "Test",
  series: "test",
  number: 1,
  attributes: ATTRS,
  moves: {
    jab1: move("jab1"),
    ftilt: move("ftilt"),
    utilt: move("utilt"),
    dtilt: move("dtilt"),
    fsmash: move("fsmash", { chargeable: true, totalFrames: 45 }),
    usmash: move("usmash", { chargeable: true, totalFrames: 45 }),
    dsmash: move("dsmash", { chargeable: true, totalFrames: 45 }),
    dashAttack: move("dashAttack"),
    nair: move("nair", { landingLag: 8 }),
    fair: move("fair", { landingLag: 12, autoCancelBefore: 3 }),
    bair: move("bair", { landingLag: 10 }),
    uair: move("uair", { landingLag: 9 }),
    dair: move("dair", { landingLag: 16 }),
    neutralB: move("neutralB"),
    upB: move("upB"),
    grab: move("grab", { totalFrames: 30 }),
  },
  palette: {
    primary: "#f00",
    secondary: "#00f",
    accent: "#ff0",
    skin: "#fca",
    outline: "#000",
    alts: [],
  },
  blurb: "test",
};

const STAGE: StageDef = {
  id: "test",
  name: "Test",
  series: "test",
  platforms: [
    { x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true },
    { x: 0, y: fx(30), halfWidth: fx(20), soft: true, ledges: false },
  ],
  blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
  spawns: [{ x: fx(-40), y: fx(20) }],
  theme: "test",
};

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "test",
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
    shieldHealth: fx(50),
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
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    ...over,
  };
}

let clock = 0;
/** The roster the context carries, so a grab release can reach both fighters. */
const roster: FighterState[] = [];
function ctx(): StateContext {
  return { def: DEF, stage: STAGE, frame: clock, fighters: roster };
}

/** Run one frame of interpretation + state machine + movement. */
function tick(f: FighterState, input: InputFrame, prev: InputFrame): Intent {
  clock += 1;
  updateInputTracking(f, input, prev);
  const intent = interpretInput(f, input, prev);
  advanceFighter(f, intent, ctx());
  applyMovement(f, intent, ctx());
  return intent;
}

/** Hold one input for `n` frames, reporting the state after each. */
function hold(f: FighterState, input: InputFrame, n: number, from: InputFrame = 0): void {
  let prev = from;
  for (let i = 0; i < n; i++) {
    tick(f, input, prev);
    prev = input;
  }
}

/* ------------------------------------------------------ input meaning -- */

describe("walk versus dash", () => {
  it("walks for the first three frames of a held direction", () => {
    const f = fighter();
    hold(f, Btn.Right, 1);
    expect(f.action).toBe("walk");
    hold(f, Btn.Right, 2, Btn.Right);
    expect(f.action).toBe("walk");
  });

  it("becomes a dash once the direction is held past the window", () => {
    const f = fighter();
    hold(f, Btn.Right, 6);
    expect(f.action).toBe("dashStart");
  });

  it("turns the fighter to face the direction held", () => {
    const f = fighter({ facing: -1 });
    hold(f, Btn.Right, 1);
    expect(f.facing).toBe(1);
  });

  it("returns to standing when the direction is released", () => {
    const f = fighter();
    hold(f, Btn.Right, 2);
    tick(f, 0, Btn.Right);
    expect(f.action).toBe("stand");
  });

  /**
   * The tap is the keyboard's only micro-spacing tool, so it has to survive a
   * reversal: pressing away from the way you are facing used to commit an
   * initial dash on frame 1, which turned a one-frame tap into a long slide.
   */
  it("steps rather than dashing when a standstill reverses", () => {
    const f = fighter({ facing: 1 });
    tick(f, Btn.Left, 0);
    expect(f.facing).toBe(-1);
    expect(f.action).toBe("walk");
    expect(f.vx).toBe(-ATTRS.traction * 2);
    // A tap must travel a fraction of what the initial dash would have.
    tick(f, 0, Btn.Left);
    expect(Math.abs(f.x)).toBeLessThan(ATTRS.initialDashSpeed);
  });

  it("still dashes when the reversal is held past the window", () => {
    const f = fighter({ facing: 1 });
    hold(f, Btn.Left, 6);
    expect(f.facing).toBe(-1);
    expect(f.action).toBe("dashStart");
    expect(f.vx).toBe(-ATTRS.initialDashSpeed);
  });

  it("keeps dash-dancing instant once a dash is under way", () => {
    const f = fighter();
    hold(f, Btn.Right, 6);
    expect(f.action).toBe("dashStart");
    tick(f, Btn.Left, Btn.Right);
    // No walk window on the way out of a dash: the reversal is the dash dance.
    expect(f.action).toBe("dashStart");
    expect(f.vx).toBe(-ATTRS.initialDashSpeed);
  });

  it("runs a held direction through walk, then dash, then run", () => {
    const f = fighter();
    const seen: string[] = [];
    for (let i = 0; i < 22; i++) {
      tick(f, Btn.Right, i === 0 ? 0 : Btn.Right);
      if (seen[seen.length - 1] !== f.action) seen.push(f.action);
    }
    expect(seen).toEqual(["walk", "dashStart", "run"]);
  });
});

describe("tilt versus smash", () => {
  it("reads an attack within five frames of a fresh direction as a smash", () => {
    const f = fighter();
    tick(f, Btn.Right, 0);
    tick(f, Btn.Right | Btn.Attack, Btn.Right);
    expect(f.move).toBe("fsmash");
  });

  it("reads an attack after the window as a tilt", () => {
    const f = fighter();
    tick(f, Btn.Right, 0);
    // Six frames of holding puts the fighter into a dash, so hold up instead:
    // the direction is stale but still held.
    const g = fighter();
    tick(g, Btn.Up, 0);
    for (let i = 0; i < 6; i++) tick(g, Btn.Up, Btn.Up);
    tick(g, Btn.Up | Btn.Attack, Btn.Up);
    expect(g.move).toBe("utilt");
    expect(f.action).toBe("walk");
  });

  it("reads a bare attack as a jab", () => {
    const f = fighter();
    tick(f, Btn.Attack, 0);
    expect(f.move).toBe("jab1");
  });

  it("reads an attack out of a run as a dash attack", () => {
    const f = fighter();
    hold(f, Btn.Right, 20);
    expect(f.action).toBe("run");
    tick(f, Btn.Right | Btn.Attack, Btn.Right);
    expect(f.move).toBe("dashAttack");
  });

  it("picks the aerial from the direction relative to facing", () => {
    const f = fighter({ facing: 1 });
    const base: Intent = {
      x: 0,
      y: 0,
      jumpPressed: false,
      jumpHeld: false,
      attackPressed: false,
      attackHeld: false,
      specialPressed: false,
      shieldHeld: false,
      shieldPressed: false,
      shieldReleased: false,
      grabPressed: false,
      downPressed: false,
      wantsDash: false,
      smash: false,
      smashX: 0,
      smashY: 0,
      sdiX: 0,
      sdiY: 0,
    };
    expect(aerialSlot(f, { ...base, x: 1 })).toBe("fair");
    expect(aerialSlot(f, { ...base, x: -1 })).toBe("bair");
    expect(aerialSlot(f, { ...base, y: 1 })).toBe("uair");
    expect(aerialSlot(f, { ...base, y: -1 })).toBe("dair");
    expect(aerialSlot(f, base)).toBe("nair");
    expect(groundAttackSlot(f, base)).toBe("jab1");
    expect(specialSlot({ ...base, y: 1 })).toBe("upB");
    expect(specialSlot(base)).toBe("neutralB");
  });
});

describe("jumps", () => {
  it("takes three frames of jumpsquat and then leaves the ground", () => {
    const f = fighter();
    // The press frame is jumpsquat frame 1, so the fighter is grounded for three
    // ticks and airborne on the fourth.
    for (let i = 0; i < JUMP_SQUAT_FRAMES; i++) {
      tick(f, Btn.Jump, i === 0 ? 0 : Btn.Jump);
      expect(f.action).toBe("jumpSquat");
      expect(f.grounded).toBe(true);
    }
    tick(f, Btn.Jump, Btn.Jump);
    expect(f.action).toBe("jump");
    expect(f.grounded).toBe(false);
  });

  it("short hops when the button is released inside jumpsquat", () => {
    const f = fighter();
    tick(f, Btn.Jump, 0);
    tick(f, 0, Btn.Jump);
    tick(f, 0, 0);
    tick(f, 0, 0);
    expect(f.action).toBe("jump");
    // Gravity has already been applied once, so compare against the initial value.
    expect(f.vy).toBe(ATTRS.shortHopVelocity - ATTRS.gravity);
    // ...and the hop is marked, because its aerials deal 0.85×.
    expect(f.shortHop).toBe(true);
  });

  it("full hops when the button is still held", () => {
    const f = fighter();
    hold(f, Btn.Jump, JUMP_SQUAT_FRAMES + 1);
    expect(f.vy).toBe(ATTRS.fullHopVelocity - ATTRS.gravity);
    expect(f.shortHop).toBe(false);
  });

  it("clears the short-hop mark on landing", () => {
    const f = fighter({ shortHop: true, grounded: true });
    onLanded(f, ctx());
    expect(f.shortHop).toBe(false);
  });

  it("clears the short-hop mark on an air jump", () => {
    const f = fighter({ grounded: false, action: "fall", jumpsUsed: 1, shortHop: true });
    tick(f, Btn.Jump, 0);
    expect(f.jumpsUsed).toBe(2);
    expect(f.shortHop).toBe(false);
  });

  it("forces a short hop when an attack is buffered inside jumpsquat", () => {
    const f = fighter();
    tick(f, Btn.Jump, 0);
    tick(f, Btn.Jump | Btn.Attack, Btn.Jump);
    tick(f, Btn.Jump, Btn.Jump | Btn.Attack);
    tick(f, Btn.Jump, Btn.Jump);
    // Jump was held the whole way, and the hop is short anyway: an attack during
    // jumpsquat is Ultimate's short-hop aerial macro, and it is what the 0.85×
    // damage penalty is the price of.
    expect(f.shortHop).toBe(true);
    expect(f.vy).toBe(ATTRS.shortHopVelocity - ATTRS.gravity);
    tick(f, Btn.Jump, Btn.Jump);
    expect(f.action).toBe("attack");
    expect(f.move).toBe("nair");
  });

  it("allows exactly the fighter's number of air jumps", () => {
    const f = fighter({ grounded: false, action: "fall", jumpsUsed: 1 });
    tick(f, Btn.Jump, 0);
    expect(f.jumpsUsed).toBe(2);
    tick(f, 0, Btn.Jump);
    tick(f, Btn.Jump, 0);
    expect(f.jumpsUsed).toBe(2);
  });

  it("fast-falls only after the apex", () => {
    const rising = fighter({ grounded: false, action: "jump", vy: fx(2) });
    tick(rising, Btn.Down, 0);
    expect(rising.fastFalling).toBe(false);

    const falling = fighter({ grounded: false, action: "fall", vy: -fx(0.5) });
    tick(falling, Btn.Down, 0);
    expect(falling.fastFalling).toBe(true);
  });
});

describe("landing", () => {
  it("pays a move's landing lag when it is still out", () => {
    const f = fighter({ grounded: true, action: "attack", move: "dair", actionFrame: 8 });
    onLanded(f, ctx());
    expect(f.action).toBe("landingLag");
    expect(f.charge).toBe(16);
  });

  it("auto-cancels a move landed inside its early window", () => {
    const f = fighter({ grounded: true, action: "attack", move: "fair", actionFrame: 2 });
    onLanded(f, ctx());
    expect(f.action).toBe("land");
  });

  it("puts a tumbling fighter on the floor", () => {
    const f = fighter({ grounded: true, action: "tumble", hitstun: 20 });
    onLanded(f, ctx());
    expect(f.action).toBe("downed");
    expect(f.hitstun).toBe(0);
  });
});

/* ------------------------------------------------------------ defence -- */

describe("shield", () => {
  it("raises on the frame shield is pressed", () => {
    const f = fighter();
    tick(f, Btn.Shield, 0);
    expect(f.action).toBe("shieldStart");
    tick(f, Btn.Shield, Btn.Shield);
    expect(f.action).toBe("shield");
  });

  it("refuses to drop before the minimum hold", () => {
    const f = fighter();
    tick(f, Btn.Shield, 0);
    tick(f, Btn.Shield, Btn.Shield);
    // One frame in shield, then release: too early.
    tick(f, 0, Btn.Shield);
    expect(f.action).toBe("shield");
  });

  it("parries for five frames of the drop, having been held three", () => {
    const f = fighter();
    tick(f, Btn.Shield, 0);
    for (let i = 0; i < SHIELD_MIN_HOLD + 1; i++) tick(f, Btn.Shield, Btn.Shield);
    expect(f.action).toBe("shield");
    tick(f, 0, Btn.Shield);
    expect(f.action).toBe("shieldRelease");
    expect(isParrying(f)).toBe(true);
    // Frames 0 through 4 parry; frame 5 of the 11-frame drop no longer does.
    for (let i = 0; i < PERFECT_SHIELD_WINDOW - 1; i++) {
      tick(f, 0, 0);
      expect(isParrying(f)).toBe(true);
    }
    tick(f, 0, 0);
    expect(f.action).toBe("shieldRelease");
    expect(isParrying(f)).toBe(false);
  });

  it("spot dodges on down and rolls on a direction", () => {
    const f = fighter();
    tick(f, Btn.Shield, 0);
    tick(f, Btn.Shield, Btn.Shield);
    tick(f, Btn.Shield | Btn.Down, Btn.Shield);
    expect(f.action).toBe("spotDodge");

    const g = fighter();
    tick(g, Btn.Shield, 0);
    tick(g, Btn.Shield, Btn.Shield);
    tick(g, Btn.Shield | Btn.Right, Btn.Shield);
    expect(g.action).toBe("roll");
    expect(g.vx).toBeGreaterThan(0);
  });

  it("grants spot-dodge intangibility exactly on frames 3 to 20", () => {
    const f = fighter({ action: "spotDodge", actionFrame: 0 });
    const seen: number[] = [];
    for (let i = 1; i <= 24; i++) {
      f.intangible = 0;
      tick(f, 0, 0);
      if (f.intangible > 0) seen.push(f.actionFrame);
    }
    expect(seen[0]).toBe(SPOT_DODGE_INTANGIBLE[0]);
    expect(seen[seen.length - 1]).toBe(SPOT_DODGE_INTANGIBLE[1]);
  });

  it("grants roll intangibility exactly on frames 4 to 20", () => {
    const f = fighter({ action: "roll", actionFrame: 0 });
    const seen: number[] = [];
    for (let i = 1; i <= 24; i++) {
      f.intangible = 0;
      tick(f, 0, 0);
      if (f.intangible > 0) seen.push(f.actionFrame);
    }
    expect(seen[0]).toBe(ROLL_INTANGIBLE[0]);
    expect(seen[seen.length - 1]).toBe(ROLL_INTANGIBLE[1]);
  });
});

describe("air dodge", () => {
  it("is neutral without a direction and directional with one", () => {
    const neutral = fighter({ grounded: false, action: "fall" });
    tick(neutral, Btn.Shield, 0);
    expect(neutral.action).toBe("airDodge");
    expect(neutral.charge).toBe(0);
    expect(neutral.vx).toBe(0);

    const directional = fighter({ grounded: false, action: "fall" });
    tick(directional, Btn.Shield | Btn.Right, 0);
    expect(directional.action).toBe("airDodge");
    expect(directional.charge).toBe(1);
    expect(directional.vx).toBeGreaterThan(0);
  });

  it("lasts 50 frames neutral and 63 directional", () => {
    const neutral = fighter({ grounded: false, action: "fall" });
    tick(neutral, Btn.Shield, 0);
    for (let i = 0; i < AIR_DODGE_FRAMES; i++) tick(neutral, 0, 0);
    expect(neutral.action).toBe("fall");

    const directional = fighter({ grounded: false, action: "fall" });
    tick(directional, Btn.Shield | Btn.Right, 0);
    for (let i = 0; i < AIR_DODGE_FRAMES; i++) tick(directional, 0, 0);
    expect(directional.action).toBe("airDodge");
    for (let i = 0; i < DIRECTIONAL_AIR_DODGE_FRAMES - AIR_DODGE_FRAMES; i++) {
      tick(directional, 0, 0);
    }
    expect(directional.action).toBe("fall");
  });

  it("is available once per airtime", () => {
    const f = fighter({ grounded: false, action: "fall" });
    tick(f, Btn.Shield, 0);
    expect(f.airDodged).toBe(true);
    startAction(f, "fall");
    tick(f, Btn.Shield, 0);
    expect(f.action).toBe("fall");
    // Landing refreshes it.
    f.grounded = true;
    onLanded(f, ctx());
    expect(f.airDodged).toBe(false);
  });
});

/* ------------------------------------------------------------ reeling -- */

describe("hitstun", () => {
  it("becomes tumble past 32 frames", () => {
    const f = fighter({ grounded: false, action: "hitstun", hitstun: 40 });
    tick(f, 0, 0);
    expect(f.action).toBe("tumble");
  });

  it("stays plain hitstun below the threshold", () => {
    const f = fighter({ grounded: false, action: "hitstun", hitstun: 10 });
    tick(f, 0, 0);
    expect(f.action).toBe("hitstun");
  });

  it("releases to fall when it expires", () => {
    const f = fighter({ grounded: false, action: "hitstun", hitstun: 0 });
    tick(f, 0, 0);
    expect(f.action).toBe("fall");
  });
});

describe("SDI", () => {
  it("gives one pulse per fresh direction press during hitlag", () => {
    const f = fighter({ hitlag: 8 });
    updateInputTracking(f, Btn.Right, 0);
    const intent = interpretInput(f, Btn.Right, 0);
    expect(intent.sdiX).toBe(1);
    expect(SDI_DISTANCE).toBeGreaterThan(0);
  });

  it("gives nothing for a direction merely held", () => {
    const f = fighter({ hitlag: 8, framesSinceDirPress: 3, lastDirPressed: Btn.Right });
    updateInputTracking(f, Btn.Right, Btn.Right);
    const intent = interpretInput(f, Btn.Right, Btn.Right);
    expect(intent.sdiX).toBe(0);
  });

  it("gives nothing outside hitlag", () => {
    const f = fighter({ hitlag: 0 });
    updateInputTracking(f, Btn.Right, 0);
    expect(interpretInput(f, Btn.Right, 0).sdiX).toBe(0);
  });

  it("rate-limits to one pulse every four frames", () => {
    let pulses = 0;
    const f = fighter({ hitlag: 12 });
    for (let i = 0; i < 12; i++) {
      // A player mashing a direction on and off as fast as the keyboard allows.
      const input = i % 2 === 0 ? Btn.Right : 0;
      const prev = i % 2 === 0 ? 0 : Btn.Right;
      updateInputTracking(f, input, prev);
      if (interpretInput(f, input, prev).sdiX !== 0) pulses += 1;
      f.hitlag -= 1;
    }
    expect(pulses).toBeLessThanOrEqual(12 / 4);
    expect(pulses).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- buffer -- */

describe("input buffer", () => {
  it("fires a press made during landing lag once the fighter is free", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, Btn.Jump, 0);
    expect(f.bufferedAction?.kind).toBe("jump");
    for (let i = 0; i < 6; i++) tick(f, 0, 0);
    expect(f.action).toBe("jumpSquat");
  });

  it("forgets a press older than nine frames", () => {
    const f = fighter({ action: "landingLag", charge: 40, actionFrame: 0 });
    tick(f, Btn.Jump, 0);
    const queuedAt = f.bufferedAction?.frame ?? 0;
    for (let i = 0; i < BUFFER_FRAMES + 2; i++) tick(f, 0, 0);
    expect(peekBuffer(f, queuedAt + BUFFER_FRAMES + 1)).toBeNull();
  });
});

/* -------------------------------------------------------------- charge -- */

describe("smash charge", () => {
  it("holds the animation and accumulates charge while the button is down", () => {
    const f = fighter();
    tick(f, Btn.Right, 0);
    tick(f, Btn.Right | Btn.Attack, Btn.Right);
    expect(f.move).toBe("fsmash");
    const held = Btn.Right | Btn.Attack;
    for (let i = 0; i < 10; i++) tick(f, held, held);
    expect(f.charge).toBeGreaterThan(0);
    expect(f.actionFrame).toBeLessThan(10);
  });

  it("scales damage from 1.0 to 1.4 across sixty frames", () => {
    expect(chargeMultiplier(0)).toBe(fx(1));
    expect(chargeMultiplier(60)).toBe(fx(1.4));
    expect(chargeMultiplier(30)).toBeGreaterThan(fx(1.19));
    expect(chargeMultiplier(120)).toBe(chargeMultiplier(60));
  });
});

/* ------------------------------------------------------ drop-through -- */

describe("drop through", () => {
  it("falls through a soft platform on a fresh down press", () => {
    const f = fighter({ y: fx(30), platform: 1, grounded: true });
    tick(f, Btn.Down, 0);
    expect(f.grounded).toBe(false);
    expect(f.action).toBe("fall");
  });

  it("crouches instead on a hard platform", () => {
    const f = fighter({ y: 0, platform: 0, grounded: true });
    tick(f, Btn.Down, 0);
    expect(f.action).toBe("crouchStart");
  });
});
