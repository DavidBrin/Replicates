/**
 * Fighter parameters, named as `fighter_param.prc` names them.
 *
 * Ultimate keeps every fighter's movement numbers in one table,
 * `fighter/common/param/fighter_param.prc`, one struct per fighter. The field
 * names below are that table's hash labels, read (names and types only) from
 * skyline-smash's `FighterParamTable` struct —
 * https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/params/fighter_param.rs
 * — and checked against ultimate-research/param-labels `ParamLabels.csv`.
 * Keeping the game's names means a number here can be looked up anywhere the
 * community discusses it, and Plans 3–5 can add the next field by its real
 * name instead of inventing one.
 *
 * Values come from rubendal's SSBU-Calculator data (`Data/<fighter>/data.json`
 * on the gh-pages branch, commit 233590e94bc4bd8813f2d1a2af45c8c46648f351),
 * whose labels are the calculator's own ("WalkSpeed") and are mapped field by
 * field below. One field is the replica's own and says so: `jump_aerial_y_list`.
 *
 * Units: every speed, acceleration and height is Q12 fixed point in units per
 * frame (per frame² for accelerations); frame counts and the jump count are
 * plain integers; `weight` is the game's raw weight stat.
 */

import { ONE, div, mul } from "./fixed";
import type { FighterAttributes, FighterDef } from "./types";

export interface FighterParams {
  /** Calculator `WalkSpeed`. Top walking speed at full deflection. */
  readonly walk_speed_max: number;
  /** Calculator `WalkAddAcceleration`. Walk acceleration scaled by stick deflection. */
  readonly walk_accel_mul: number;
  /** Calculator `WalkBaseAcceleration`. Walk acceleration at any deflection. */
  readonly walk_accel_add: number;
  /** Calculator `GroundFriction` (traction). */
  readonly ground_brake: number;
  /** Calculator `DashInitialSpeed`. Speed on the first frame of an initial dash. */
  readonly dash_speed: number;
  /** Calculator `RunAddAcceleration`. Dash/run acceleration scaled by deflection. */
  readonly run_accel_mul: number;
  /** Calculator `RunBaseAcceleration`. Dash/run acceleration at any deflection. */
  readonly run_accel_add: number;
  /** Calculator `RunSpeed`. */
  readonly run_speed_max: number;
  /** Calculator `Jumpsquat`. Frames, universally 3 in Ultimate. */
  readonly jump_squat_frame: number;
  /**
   * Calculator `JumpInitialSpeed` — despite the calculator's label, a *height*:
   * how far a full hop rises in its first 4 airborne frames (SmashWiki "Jump",
   * "jump initial height"; 0.55 × `jump_y` for all eight fighters here).
   */
  readonly jump_initial_y: number;
  /** Calculator `JumpHeight`. Full-hop peak height. */
  readonly jump_y: number;
  /** Calculator `HopHeight`. Short-hop peak height. */
  readonly mini_jump_y: number;
  /** Calculator `AirJumpHeight`. Height gained by a midair jump. */
  readonly jump_aerial_y: number;
  /**
   * REPLICA FIELD (no published prc label): the height of each successive
   * midair jump for a multi-jumper. Index 0 is the first midair jump. Absent for
   * fighters whose every midair jump is `jump_aerial_y`.
   */
  readonly jump_aerial_y_list?: readonly number[];
  /** Calculator `JumpCount`. Grounded jump plus midair jumps. */
  readonly jump_count_max: number;
  /** Calculator `AerialAddAcceleration`. Air drift acceleration scaled by deflection. */
  readonly air_accel_x_mul: number;
  /** Calculator `AerialBaseAcceleration`. Air drift acceleration at any deflection. */
  readonly air_accel_x_add: number;
  /** Calculator `AirSpeed`. Top air drift speed. */
  readonly air_speed_x_stable: number;
  /** Calculator `AirFriction`. Horizontal air deceleration with the stick neutral. */
  readonly air_brake_x: number;
  /** Calculator `Gravity`. */
  readonly air_accel_y: number;
  /** Calculator `FallSpeed`. */
  readonly air_speed_y_stable: number;
  /** Calculator `FastFallSpeed`. */
  readonly dive_speed_y: number;
  /** Calculator `DamageFlyTopGravity`. Gravity during a vertical launch. */
  readonly damage_fly_top_air_accel_y: number;
  /** Calculator `DamageFlyTopFallSpeed`. Fall speed during a vertical launch. */
  readonly damage_fly_top_speed_y_stable: number;
  /** Calculator `Weight`. Raw, not Q12. */
  readonly weight: number;
  /** Calculator `NairLandingLag` … `DairLandingLag`. Frames. */
  readonly landing_attack_air_frame_n: number;
  readonly landing_attack_air_frame_f: number;
  readonly landing_attack_air_frame_b: number;
  readonly landing_attack_air_frame_hi: number;
  readonly landing_attack_air_frame_lw: number;
  /**
   * The struct's three landing fields, in its order: `landing_frame_light: f32`,
   * `landing_frame: f32`, `landing_heavy_frame: i32`. The calculator publishes
   * three landing values, `SoftLandingLag`, `HardLandingLag` and
   * `FallingFrameToUseHardLandingLag`; pairing them by order and type (the one
   * integer is the frame threshold) is this replica's reading — UNVERIFIED.
   */
  /** Calculator `SoftLandingLag`. Frames of a light landing. */
  readonly landing_frame_light: number;
  /** Calculator `HardLandingLag`. Frames of a heavy landing. */
  readonly landing_frame: number;
  /**
   * Calculator `FallingFrameToUseHardLandingLag`. Frames spent at full fall
   * speed before a landing counts as heavy (SmashWiki "Lag", Normal landing).
   */
  readonly landing_heavy_frame: number;
  /** Calculator `ShieldSize`. */
  readonly shield_radius: number;
  /** Calculator `CharacterSizeMultiplier`. */
  readonly scale: number;
}

/**
 * Parameters that reproduce a legacy `FighterAttributes` exactly.
 *
 * The bridge for the strangler: engine tests build fighters from
 * `FighterAttributes` alone, and until every reader has moved to
 * `FighterParams` the two must describe the same fighter. Every field without
 * an attributes counterpart is set to the value that makes the new code behave
 * like the old: walk acceleration totals 2 × traction and run acceleration
 * 3 × traction (the legacy walk and run rules' factors), no air
 * friction, no full-hop initial phase, a 4-frame landing either way, and jump
 * heights recovered from the legacy launch velocities by v² / 2g.
 */
export function paramsFromAttributes(a: FighterAttributes, def?: Pick<FighterDef, "moves">): FighterParams {
  const height = (v: number): number => (a.gravity > 0 ? div(mul(v, v), 2 * a.gravity) : 0);
  const lag = (slot: "nair" | "fair" | "bair" | "uair" | "dair"): number => def?.moves[slot]?.landingLag ?? 0;
  return {
    walk_speed_max: a.walkSpeed,
    walk_accel_mul: a.traction,
    walk_accel_add: a.traction,
    ground_brake: a.traction,
    dash_speed: a.initialDashSpeed,
    run_accel_mul: 2 * a.traction,
    run_accel_add: a.traction,
    run_speed_max: a.runSpeed,
    jump_squat_frame: a.jumpSquatFrames,
    jump_initial_y: 0,
    jump_y: height(a.fullHopVelocity),
    mini_jump_y: height(a.shortHopVelocity),
    jump_aerial_y: height(a.airJumpVelocity),
    jump_count_max: a.jumps,
    air_accel_x_mul: a.airAccelAdditional,
    air_accel_x_add: a.airAccelBase,
    air_speed_x_stable: a.airSpeed,
    air_brake_x: 0,
    air_accel_y: a.gravity,
    air_speed_y_stable: a.fallSpeed,
    dive_speed_y: a.fastFallSpeed,
    damage_fly_top_air_accel_y: a.gravity,
    damage_fly_top_speed_y_stable: 7373, // fx(1.8), every roster fighter's DamageFlyTopFallSpeed
    weight: a.weight,
    landing_attack_air_frame_n: lag("nair"),
    landing_attack_air_frame_f: lag("fair"),
    landing_attack_air_frame_b: lag("bair"),
    landing_attack_air_frame_hi: lag("uair"),
    landing_attack_air_frame_lw: lag("dair"),
    landing_frame_light: 4,
    landing_frame: 4,
    landing_heavy_frame: 1_000_000,
    shield_radius: 10 * ONE,
    scale: ONE,
  };
}

const adapted = new WeakMap<FighterDef, FighterParams>();

/**
 * The parameters the engine reads for a fighter: its own `params` when the
 * roster supplies them, otherwise the legacy adapter. Cached per definition,
 * which is immutable roster data.
 */
export function fighterParams(def: FighterDef): FighterParams {
  if (def.params !== undefined) return def.params;
  let p = adapted.get(def);
  if (p === undefined) {
    p = paramsFromAttributes(def.attributes, def);
    adapted.set(def, p);
  }
  return p;
}
