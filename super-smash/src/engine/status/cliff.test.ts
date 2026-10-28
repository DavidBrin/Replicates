/**
 * CLIFF_WAIT (`ledgeHang`) on its own: the minimum hang, letting go, and the
 * forced getup once the regrab limit is spent. The golden script hangs, but
 * none of these three is pinned there, and Plan 4 moves the hang's origin, so
 * they are pinned here first.
 */

import { describe, expect, it } from "vitest";

import { LEDGE_REGRAB_LIMIT, LEDGE_REGRAB_LOCKOUT_FRAMES } from "../constants";
import { fx } from "../fixed";
import { emptyKinetic } from "../kinetic";
import { LEDGE_HANG_MIN, advanceFighter, interpretInput, updateInputTracking } from "../states";
import type { StateContext } from "../states";
import { Btn } from "../types";
import type { ActionState, FighterState, InputFrame } from "../types";
import "./index";

/** Hanging from the right-hand ledge (side 1), facing the stage. */
function hanging(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "t",
    costume: 0,
    x: fx(82),
    y: fx(-10),
    vx: 0,
    vy: 0,
    facing: -1,
    grounded: false,
    platform: -1,
    action: "ledgeHang",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 1,
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
    intangible: 30,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: { platform: 0, side: 1 },
    ledgeRegrabs: 1,
    ledgeLockout: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
}

let clock = 0;

/** One frame of input meaning and state machine, the input pressed fresh (the frame before held nothing). */
function tick(f: FighterState, input: InputFrame): void {
  clock += 1;
  updateInputTracking(f, input, 0);
  const ctx = { def: {}, stage: { platforms: [] }, frame: clock, fighters: [f] } as unknown as StateContext;
  advanceFighter(f, interpretInput(f, input, 0), ctx);
}

/** Away from the stage is Right for the right-hand ledge, and in is Left. */
const AWAY = Btn.Right;
const IN = Btn.Left;

describe("CLIFF_WAIT", () => {
  it.each([
    ["a jump", Btn.Jump, "ledgeJump"],
    ["an attack", Btn.Attack, "ledgeAttack"],
    ["a shield (roll)", Btn.Shield, "ledgeRoll"],
    ["up (getup)", Btn.Up, "ledgeGetUp"],
    ["in (getup)", IN, "ledgeGetUp"],
    ["down (let go)", Btn.Down, "fall"],
    ["away (let go)", AWAY, "fall"],
  ] as const)("takes no input for its first LEDGE_HANG_MIN frames, then %s", (_what, input, then: ActionState) => {
    const f = hanging();
    for (let frame = 1; frame < LEDGE_HANG_MIN; frame++) {
      tick(f, input);
      expect([f.action, f.actionFrame], `frame ${frame}`).toEqual(["ledgeHang", frame]);
    }
    tick(f, input);
    expect(f.action).toBe(then);
  });

  it.each([
    ["down", Btn.Down],
    ["away from the stage", AWAY],
  ])("lets go on %s: off the ledge, no longer intangible, and locked out of a regrab", (_how, input) => {
    const f = hanging({ actionFrame: LEDGE_HANG_MIN, intangible: 30 });
    tick(f, input);
    expect(f).toMatchObject({ action: "fall", ledge: null, intangible: 0, ledgeLockout: LEDGE_REGRAB_LOCKOUT_FRAMES });
  });

  it("hangs on with the stick neutral while the regrab limit has not been passed", () => {
    const f = hanging({ ledgeRegrabs: LEDGE_REGRAB_LIMIT });
    for (let frame = 1; frame <= 60; frame++) tick(f, 0);
    expect(f.action).toBe("ledgeHang");
  });

  it("forces a getup, with no input, once a grab passes the regrab limit, after the minimum hang", () => {
    const f = hanging({ ledgeRegrabs: LEDGE_REGRAB_LIMIT + 1 });
    for (let frame = 1; frame < LEDGE_HANG_MIN; frame++) {
      tick(f, 0);
      expect(f.action, `frame ${frame}`).toBe("ledgeHang");
    }
    tick(f, 0);
    expect(f.action).toBe("ledgeGetUp");
  });
});
