import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
import type { KineticState } from "./kinetic";
import type { FighterState } from "./types";

/** Only the fields the KineticModule touches; the rest of a fighter is irrelevant here. */
function body(k: Partial<KineticState> = {}, over: Partial<FighterState> = {}): FighterState {
  return {
    vx: 0,
    vy: 0,
    launchSpeed: 0,
    kinetic: { ...emptyKinetic(), ...k },
    ...over,
  } as FighterState;
}

describe("energy sum", () => {
  it("adds CONTROL, STOP, MOTION and DAMAGE horizontally", () => {
    const f = body({ controlX: fx(1), stopX: fx(0.5), motionX: fx(2), damageX: -fx(0.25) });
    expect(kineticSumX(f)).toBe(fx(1) + fx(0.5) + fx(2) - fx(0.25));
  });

  it("adds GRAVITY, MOTION and DAMAGE vertically", () => {
    const f = body({ gravityY: -fx(1), motionY: fx(3), damageY: fx(0.5) });
    expect(kineticSumY(f)).toBe(-fx(1) + fx(3) + fx(0.5));
  });

  it("writes the sum back to vx/vy", () => {
    const f = body({ controlX: fx(1), gravityY: -fx(2) });
    kineticSum(f);
    expect([f.vx, f.vy]).toEqual([fx(1), -fx(2)]);
  });
});

describe("adopting a direct write", () => {
  it("is the identity when vx/vy already equal the sum", () => {
    const f = body({ controlX: fx(1), gravityY: fx(2) }, { vx: fx(1), vy: fx(2) });
    kineticAdopt(f);
    expect(f.kinetic).toEqual({ ...emptyKinetic(), controlX: fx(1), gravityY: fx(2) });
  });

  it("puts a horizontal write on the carrier it is told to", () => {
    const toControl = body({}, { vx: fx(3) });
    kineticAdopt(toControl, "control");
    expect(toControl.kinetic.controlX).toBe(fx(3));
    const toStop = body({}, { vx: fx(3) });
    kineticAdopt(toStop, "stop");
    expect(toStop.kinetic.stopX).toBe(fx(3));
  });

  it("always restores vx/vy == sum, whatever the energies held", () => {
    const q12 = fc.integer({ min: -fx(50), max: fx(50) });
    fc.assert(
      fc.property(q12, q12, q12, q12, q12, q12, q12, q12, q12, fc.boolean(), (cx, sx, gy, mx, my, dx, dy, vx, vy, stop) => {
        const f = body(
          { controlX: cx, stopX: sx, gravityY: gy, motionX: mx, motionY: my, damageX: dx, damageY: dy },
          { vx, vy },
        );
        kineticAdopt(f, stop ? "stop" : "control");
        return kineticSumX(f) === vx && kineticSumY(f) === vy && f.kinetic.motionX === mx && f.kinetic.damageY === dy;
      }),
    );
  });
});

describe("clearing", () => {
  it("zeroes every energy, the launch and the velocity", () => {
    const f = body(
      { controlX: 1, stopX: 2, gravityY: 3, motionX: 4, motionY: 5, damageX: 6, damageY: 7, fallFrames: 8, jumpInitial: 2 },
      { vx: 9, vy: 9, launchSpeed: 9 },
    );
    kineticClear(f);
    expect(f.kinetic).toEqual(emptyKinetic());
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([0, 0, 0]);
  });
});
