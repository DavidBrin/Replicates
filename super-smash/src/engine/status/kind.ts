/**
 * StatusModule — one object per fighter status, in Ultimate's shape.
 *
 * Ultimate runs a fighter as a state machine whose states are *statuses*
 * (`FIGHTER_STATUS_KIND_*`, skyline-smash `lua_const.rs`,
 * https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/lua_const.rs), each a set of
 * functions the engine calls at fixed moments: `pre` when it is entered,
 * `main` every frame, `exec` for per-frame physics, `end` when it is left
 * (HDR's `status/` tree is laid out the same way). The replica's statuses are
 * the `ActionState` names the renderer, CPU and HUD already read, so those
 * names stay what `FighterState.action` holds, and the table below maps each to
 * the SSBU kind it stands for.
 *
 * Four replica names aggregate several SSBU kinds and are marked so: `attack`
 * (every ground attack and aerial — SSBU splits ATTACK, ATTACK_S3 … ATTACK_AIR),
 * `special` (SSBU: SPECIAL_N/S/HI/LW, no aggregate kind exists — the name
 * here is SSBU-*like*), `roll` (ESCAPE_F and ESCAPE_B), and `landingLag`
 * (named LANDING_ATTACK_AIR for an aerial's landing lag, but also the replica's
 * landing from an air dodge, which is not an aerial's).
 */

import type { Intent, StateContext } from "../states";
import type { KineticType } from "../kinetic";
import type { ActionState, FighterState } from "../types";

export type StatusKind =
  | "FIGHTER_STATUS_KIND_WAIT"
  | "FIGHTER_STATUS_KIND_WALK"
  | "FIGHTER_STATUS_KIND_DASH"
  | "FIGHTER_STATUS_KIND_RUN"
  | "FIGHTER_STATUS_KIND_RUN_BRAKE"
  | "FIGHTER_STATUS_KIND_TURN_RUN"
  | "FIGHTER_STATUS_KIND_SQUAT"
  | "FIGHTER_STATUS_KIND_SQUAT_WAIT"
  | "FIGHTER_STATUS_KIND_SQUAT_RV"
  | "FIGHTER_STATUS_KIND_JUMP_SQUAT"
  | "FIGHTER_STATUS_KIND_JUMP"
  | "FIGHTER_STATUS_KIND_FALL"
  | "FIGHTER_STATUS_KIND_LANDING"
  | "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR"
  | "FIGHTER_STATUS_KIND_ATTACK"
  | "FIGHTER_STATUS_KIND_SPECIAL"
  | "FIGHTER_STATUS_KIND_CATCH"
  | "FIGHTER_STATUS_KIND_CATCH_WAIT"
  | "FIGHTER_STATUS_KIND_CATCH_ATTACK"
  | "FIGHTER_STATUS_KIND_THROW"
  | "FIGHTER_STATUS_KIND_GUARD_ON"
  | "FIGHTER_STATUS_KIND_GUARD"
  | "FIGHTER_STATUS_KIND_GUARD_OFF"
  | "FIGHTER_STATUS_KIND_GUARD_DAMAGE"
  | "FIGHTER_STATUS_KIND_FURAFURA"
  | "FIGHTER_STATUS_KIND_ESCAPE"
  | "FIGHTER_STATUS_KIND_ESCAPE_F"
  | "FIGHTER_STATUS_KIND_ESCAPE_AIR"
  | "FIGHTER_STATUS_KIND_DAMAGE"
  | "FIGHTER_STATUS_KIND_DAMAGE_FLY"
  | "FIGHTER_STATUS_KIND_DAMAGE_FALL"
  | "FIGHTER_STATUS_KIND_CAPTURE_WAIT"
  | "FIGHTER_STATUS_KIND_THROWN"
  | "FIGHTER_STATUS_KIND_DOWN_WAIT"
  | "FIGHTER_STATUS_KIND_DOWN_STAND"
  | "FIGHTER_STATUS_KIND_PASSIVE"
  | "FIGHTER_STATUS_KIND_PASSIVE_FB"
  | "FIGHTER_STATUS_KIND_PASSIVE_WALL"
  | "FIGHTER_STATUS_KIND_PASSIVE_CEIL"
  | "FIGHTER_STATUS_KIND_CLIFF_WAIT"
  | "FIGHTER_STATUS_KIND_CLIFF_CLIMB"
  | "FIGHTER_STATUS_KIND_CLIFF_ATTACK"
  | "FIGHTER_STATUS_KIND_CLIFF_ESCAPE"
  | "FIGHTER_STATUS_KIND_CLIFF_JUMP1"
  | "FIGHTER_STATUS_KIND_REBIRTH"
  | "FIGHTER_STATUS_KIND_DEAD"
  | "FIGHTER_STATUS_KIND_ENTRY";

/** The alias table: which SSBU status each replica action stands for. */
export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> = {
  stand: "FIGHTER_STATUS_KIND_WAIT",
  walk: "FIGHTER_STATUS_KIND_WALK",
  dashStart: "FIGHTER_STATUS_KIND_DASH",
  run: "FIGHTER_STATUS_KIND_RUN",
  runBrake: "FIGHTER_STATUS_KIND_RUN_BRAKE",
  turnaround: "FIGHTER_STATUS_KIND_TURN_RUN",
  crouchStart: "FIGHTER_STATUS_KIND_SQUAT",
  crouch: "FIGHTER_STATUS_KIND_SQUAT_WAIT",
  crouchEnd: "FIGHTER_STATUS_KIND_SQUAT_RV",
  jumpSquat: "FIGHTER_STATUS_KIND_JUMP_SQUAT",
  jump: "FIGHTER_STATUS_KIND_JUMP",
  fall: "FIGHTER_STATUS_KIND_FALL",
  land: "FIGHTER_STATUS_KIND_LANDING",
  landingLag: "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR",
  attack: "FIGHTER_STATUS_KIND_ATTACK",
  special: "FIGHTER_STATUS_KIND_SPECIAL",
  grab: "FIGHTER_STATUS_KIND_CATCH",
  grabHold: "FIGHTER_STATUS_KIND_CATCH_WAIT",
  pummel: "FIGHTER_STATUS_KIND_CATCH_ATTACK",
  throw: "FIGHTER_STATUS_KIND_THROW",
  shieldStart: "FIGHTER_STATUS_KIND_GUARD_ON",
  shield: "FIGHTER_STATUS_KIND_GUARD",
  shieldRelease: "FIGHTER_STATUS_KIND_GUARD_OFF",
  shieldStun: "FIGHTER_STATUS_KIND_GUARD_DAMAGE",
  shieldBroken: "FIGHTER_STATUS_KIND_FURAFURA",
  spotDodge: "FIGHTER_STATUS_KIND_ESCAPE",
  roll: "FIGHTER_STATUS_KIND_ESCAPE_F",
  airDodge: "FIGHTER_STATUS_KIND_ESCAPE_AIR",
  hitstun: "FIGHTER_STATUS_KIND_DAMAGE",
  tumble: "FIGHTER_STATUS_KIND_DAMAGE_FLY",
  tumbleFall: "FIGHTER_STATUS_KIND_DAMAGE_FALL",
  grabbed: "FIGHTER_STATUS_KIND_CAPTURE_WAIT",
  thrown: "FIGHTER_STATUS_KIND_THROWN",
  downed: "FIGHTER_STATUS_KIND_DOWN_WAIT",
  getUp: "FIGHTER_STATUS_KIND_DOWN_STAND",
  tech: "FIGHTER_STATUS_KIND_PASSIVE",
  techRoll: "FIGHTER_STATUS_KIND_PASSIVE_FB",
  techWall: "FIGHTER_STATUS_KIND_PASSIVE_WALL",
  techCeiling: "FIGHTER_STATUS_KIND_PASSIVE_CEIL",
  ledgeHang: "FIGHTER_STATUS_KIND_CLIFF_WAIT",
  ledgeGetUp: "FIGHTER_STATUS_KIND_CLIFF_CLIMB",
  ledgeAttack: "FIGHTER_STATUS_KIND_CLIFF_ATTACK",
  ledgeRoll: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
  ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
  respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
  dead: "FIGHTER_STATUS_KIND_DEAD",
  entering: "FIGHTER_STATUS_KIND_ENTRY",
};

/** The inverse alias table. One-to-one, which `status.test.ts` pins. */
export const ACTION_OF_STATUS_KIND: Readonly<Record<StatusKind, ActionState>> = Object.fromEntries(
  (Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]).map((a) => [STATUS_KIND_OF_ACTION[a], a]),
) as Record<StatusKind, ActionState>;

export function statusKindOf(f: Pick<FighterState, "action">): StatusKind {
  return STATUS_KIND_OF_ACTION[f.action];
}

/**
 * One status. `main` is required; the rest are optional, as they are in the
 * game, where most statuses leave most hooks to the common implementation.
 *
 * `pre` and `end` take the fighter alone because a status change happens from
 * places that have no `StateContext` — a hit in `simulate.ts`, a KO — and they
 * must behave the same from all of them. Anything that needs fighter data is
 * done by whoever requested the change, as the game's `change_status` callers
 * do with `WorkModule` set-up.
 */
export interface FighterStatus {
  readonly kind: StatusKind;
  readonly action: ActionState;
  /** `KineticModule::change_kinetic` — how the energies are driven in this status. */
  readonly kineticType: KineticType;
  /** status_pre: once, on entry, after the previous status's `end`. */
  readonly pre?: (f: FighterState) => void;
  /** status_main: every frame the fighter is not frozen, after `actionFrame` advances. */
  readonly main: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  /**
   * status_exec: per-frame extras after the kinetic type has run. Unused in
   * Plan 2; the wall tech's hold is the one user (Plan 3, Task 12). Not called
   * on the frames `applyMovement` returns early: hanging on a
   * ledge, under a live scripted-momentum hold, and in hitstun.
   */
  readonly exec?: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  /** status_end: once, on leaving, before the next status's `pre`. */
  readonly end?: (f: FighterState) => void;
}

export type StatusTable = { readonly [A in ActionState]?: FighterStatus };
type MutableStatusTable = { [A in ActionState]?: FighterStatus };

const REGISTRY: MutableStatusTable = {};

/** Every registered status. Filled by `status/index.ts` at module load. */
export const STATUS_TABLE: StatusTable = REGISTRY;

/**
 * Add `s` to `table` (the engine's own registry unless a test passes one).
 * Throws rather than overwrite a status already there, or file one under an
 * action whose SSBU kind the alias table says is another: either is a typo
 * that would otherwise swap a status's behaviour silently.
 */
export function registerStatus(s: FighterStatus, table: MutableStatusTable = REGISTRY): void {
  const kind = STATUS_KIND_OF_ACTION[s.action];
  if (s.kind !== kind) throw new Error(`the status for "${s.action}" says ${s.kind}, but the alias table says ${kind}`);
  if (table[s.action] !== undefined) throw new Error(`a status for "${s.action}" is already registered`);
  table[s.action] = s;
}

/**
 * `StatusModule::change_status`: leave the current status, enter `action`.
 *
 * Runs the old status's `end`, resets the per-status counters, then runs the
 * new status's `pre`. Re-entering the status a fighter is already in (a
 * dash-dance, a jab follow-up) runs both, as the game does.
 */
export function changeStatus(f: FighterState, action: ActionState, table: StatusTable = STATUS_TABLE): void {
  table[f.action]?.end?.(f);
  f.action = action;
  f.actionFrame = 0;
  if (action !== "attack" && action !== "special" && action !== "throw" && action !== "pummel") {
    f.move = null;
    f.charge = 0;
  }
  table[action]?.pre?.(f);
}
