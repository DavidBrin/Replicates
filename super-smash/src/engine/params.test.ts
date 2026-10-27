import { describe, expect, it } from "vitest";

import { div, fx, mul } from "./fixed";
import { fighterParams, paramsFromAttributes } from "./params";
import type { FighterAttributes, FighterDef } from "./types";

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

function def(over: Partial<FighterDef> = {}): FighterDef {
  return {
    id: "t",
    name: "t",
    series: "t",
    number: 1,
    attributes: ATTRS,
    moves: { nair: { slot: "nair", name: "n", totalFrames: 30, hitboxes: [], landingLag: 7 } },
    palette: { primary: "#000000", secondary: "#000000", accent: "#000000", skin: "#000000", outline: "#000000", alts: [] },
    blurb: "t",
    ...over,
  };
}

describe("paramsFromAttributes — the legacy bridge", () => {
  const p = paramsFromAttributes(ATTRS, def());

  it("keeps the legacy walk and run acceleration totals (2× and 3× traction)", () => {
    expect(p.walk_accel_add + p.walk_accel_mul).toBe(2 * ATTRS.traction);
    expect(p.run_accel_add + p.run_accel_mul).toBe(3 * ATTRS.traction);
  });

  it("has no air friction and no full-hop initial phase, as the legacy engine had neither", () => {
    expect(p.air_brake_x).toBe(0);
    expect(p.jump_initial_y).toBe(0);
  });

  it("recovers jump heights from the legacy launch velocities by v^2 / 2g", () => {
    expect(p.jump_y).toBe(div(mul(ATTRS.fullHopVelocity, ATTRS.fullHopVelocity), 2 * ATTRS.gravity));
    expect(p.mini_jump_y).toBe(div(mul(ATTRS.shortHopVelocity, ATTRS.shortHopVelocity), 2 * ATTRS.gravity));
  });

  it("launches vertically at the roster's 1.8 fall speed, fx(1.8) exactly", () => {
    expect(p.damage_fly_top_speed_y_stable).toBe(fx(1.8));
  });

  it("reads aerial landing lag from the moveset", () => {
    expect(p.landing_attack_air_frame_n).toBe(7);
    expect(p.landing_attack_air_frame_f).toBe(0);
  });
});

describe("fighterParams", () => {
  it("prefers the definition's own params", () => {
    const own = paramsFromAttributes(ATTRS);
    const d = def({ params: { ...own, walk_speed_max: fx(9) } });
    expect(fighterParams(d).walk_speed_max).toBe(fx(9));
  });

  it("adapts and caches a definition without params", () => {
    const d = def();
    expect(fighterParams(d)).toBe(fighterParams(d));
    expect(fighterParams(d).walk_speed_max).toBe(ATTRS.walkSpeed);
  });
});
