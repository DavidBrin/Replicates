/**
 * Footstool jumps (Plan 5, Task 11).
 *
 * SmashWiki "Footstool Jump" (https://www.ssbwiki.com/Footstool_Jump, revision
 * 2037662 of 2026-04-11): "When characters are directly above another character,
 * they can press the jump button to bounce off of the character's head." "It
 * does no damage." A grounded victim is "briefly" frozen (`footstooled`, SSBU's
 * TREAD_DAMAGE); an airborne one is sent to "tumble a set distance", which "does
 * not produce proper knockback", and "In Ultimate, teching is possible". "A
 * footstool cannot cancel out an opponent's move that is in progress ... the
 * player will do a footstool jump ... while the opponent continues through with
 * their move without interruption" (the phantom footstool). "Players can also
 * footstool off someone hanging on a ledge, but the character being jumped off
 * will not fall and the footstool will not gain as much height." In a row, "each
 * jump resulting in approximately half the rebound", "between two and six times
 * in succession". In Ultimate "characters must wait for 16 frames after
 * attacking before they can footstool (starting from when the attack ends or is
 * interrupted)". And "if this results in a Fall, it will count as a KO for the
 * footstooling player" (`StepEvents.footstools`, `killCredit.ts`).
 *
 * The game's own check, as WuBor Patch reimplements it (a mod's reimplementation,
 * not first-party), at
 * https://github.com/WuBoytH/The-WuBor-Patch/blob/9d5e5cf90d7d686f5ab367a92789019c05574dec/fighters/common/src/status/sub_transitions.rs:
 * `sub_air_check_fall_common` (L486-519) tries the airborne actions in the order
 * special, item throw, lasso, air dodge, attack, footstool (tread jump), wall
 * jump, midair jump; `sub_transition_group_check_air_tread_jump` (L664-739,
 * vanilla kept in comments, WuBor's one addition marked) refuses it while
 * `FIGHTER_INSTANCE_WORK_ID_INT_NO_TREAD_FRAME` runs, and when the next tread
 * speed (`FL_sub_fighter_float_next_tread_speed_y`) is under the common param
 * `tread_jump_speed_limit`. The params
 * (fudgepop01/amiibo_research `common.xml` L62-67,
 * https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/common.xml#L62-L67):
 * `tread_jump_speed_dec` 0.75, `tread_jump_speed_limit` 0.5,
 * `tread_jump_disable_frame_after_attack` 16 (SmashWiki's 16). And each status
 * says whether it can be stood on (`FIGHTER_TREADED_KIND_*`, `TREADED_KIND_OF_ACTION`).
 *
 * Who can be stood on is read from everybody's state **before** the state
 * machines run (`footstoolHeads`), and what happens to the one stood on is
 * applied **after** all of them (`applyFootstools`), so the outcome never depends
 * on which port is which. The head is the top of the fighter's ECB, and the feet
 * its bottom: Plan 4's bone-derived ECB when the bake is installed, else Plan
 * 2's box (`attributes.height`).
 *
 * UNVERIFIED, all unpublished: the reach (`FOOTSTOOL_REACH`), the grounded
 * freeze (`FOOTSTOOL_GROUND_FRAMES`), the airborne tumble's stun
 * (`FOOTSTOOL_AIR_STUN`) and its push (the victim's own full fall speed), the
 * bounce's base (the jumper's full hop), and the lower bounce off a ledge. Not
 * modelled, their use unpublished: the common params `tread_jump_disable_frame`
 * 8 and `tread_jump_after_xlu_frame` 4 (`common.xml` L66, L65); nor the page's
 * "Like a normal jump, this jump can be short hopped", whose hop length and
 * decision frame no source gives.
 */

import { SINCE_ATTACK_CAP } from "./combat";
import { fx, mul } from "./fixed";
import { jumpLaunchSpeed, kineticClear, kineticJump, kineticSetY } from "./kinetic";
import { fighterParams } from "./params";
import { airActionFirst, isHolding, peekBuffer, startAction } from "./states";
import type { Intent, StateContext } from "./states";
import type { ActionState, FighterDef, FighterState, StepEvents } from "./types";

/**
 * SmashWiki: "characters must wait for 16 frames after attacking"; the common
 * param `tread_jump_disable_frame_after_attack` 16 (`common.xml`, above).
 */
export const FOOTSTOOL_AFTER_ATTACK = 16;
/** UNVERIFIED: how long a grounded fighter stays footstooled ("briefly"). */
export const FOOTSTOOL_GROUND_FRAMES = 30;
/** UNVERIFIED: an airborne fighter's tumble, in frames of hitstun ("a set distance"). */
export const FOOTSTOOL_AIR_STUN = 30;
/** UNVERIFIED: how far below a head's top a jumper's feet may be and still footstool. */
export const FOOTSTOOL_REACH = fx(4);
/**
 * Each footstool since the ground bounces at 0.75× the speed of the one before
 * (`tread_jump_speed_dec`): 0.5625× the height, SmashWiki's "approximately half
 * the rebound". UNVERIFIED: that the param multiplies each bounce so; its name
 * and the page agree.
 */
export const FOOTSTOOL_SPEED_DECAY = fx(0.75);
/**
 * No footstool whose bounce would be slower than this (`tread_jump_speed_limit`,
 * compared with the next tread speed in the vanilla check). UNVERIFIED: that
 * the speed compared is the bounce's launch speed in units a frame; read so, it
 * gives Mario six in a row, inside SmashWiki's "between two and six".
 */
export const FOOTSTOOL_SPEED_LIMIT = fx(0.5);

/**
 * Whether a status can be stood on: SSBU's `FIGHTER_TREADED_KIND_*`, which each
 * status sets in its `pre` (`set_fighter_status_data`). ENABLE: it can, and is
 * footstooled. NO_REAC: it can, and feels nothing (the phantom footstool).
 * DISABLE: it cannot; a jump over it is the jumper's own.
 */
export type TreadedKind = "ENABLE" | "NO_REAC" | "DISABLE";

/**
 * Each action's treaded kind. "WuBor" is WuBor Patch's reimplementation of the
 * status's vanilla `status_pre` (a mod, not first-party) at commit `9d5e5cf`,
 * file `fighters/common/src/status/<path>`; "SmashWiki" is the page above; the
 * rest are UNVERIFIED, each with its reading.
 */
export const TREADED_KIND_OF_ACTION: Readonly<Record<ActionState, TreadedKind>> = {
  // UNVERIFIED: standing and walking are the footstool's plain case on the page.
  stand: "ENABLE",
  walk: "ENABLE",
  // WuBor `movement/dash.rs` (Dash), `movement/run.rs` (RunBrake); UNVERIFIED
  // for the run and the turn (TURN_RUN), read as theirs.
  dashStart: "ENABLE",
  run: "ENABLE",
  runBrake: "ENABLE",
  turnaround: "ENABLE",
  // UNVERIFIED (SmashWiki names a crouching Piranha Plant's reaction, so crouching is stood on).
  crouchStart: "ENABLE",
  crouch: "ENABLE",
  crouchEnd: "ENABLE",
  // WuBor `movement/jump_squat.rs`.
  jumpSquat: "ENABLE",
  // SmashWiki: "When used on an opponent in midair".
  jump: "ENABLE",
  fall: "ENABLE",
  // WuBor `movement/landing.rs` (Landing, LandingLight, the special landing),
  // `attack/attack_air.rs` (LandingAttackAir).
  land: "ENABLE",
  landingLag: "ENABLE",
  specialLanding: "ENABLE",
  // UNVERIFIED: helpless is a fall.
  specialFall: "ENABLE",
  // SmashWiki: "a footstool cannot cancel out an opponent's move that is in
  // progress, regardless of if they're grounded or not"; WuBor `attack/attack.rs`,
  // `attack_3.rs`, `attack_4.rs`, `attack_100.rs` (NO_REAC). A throw let go of
  // its fighter is a move too; one still holding is closed by the hold (`footstoolable`).
  attack: "NO_REAC",
  special: "NO_REAC",
  throw: "NO_REAC",
  // WuBor `catch/catch.rs` (Catch, CatchDash, CatchDashPull): the grab itself is stood on.
  grab: "ENABLE",
  // Holding somebody: the pair moves as one (Plan 5 review).
  grabHold: "DISABLE",
  pummel: "DISABLE",
  // UNVERIFIED for the shield's start; WuBor `guard/guard.rs`, `guard_off.rs`,
  // `guard_damage.rs` (NO_REAC) for the shield, its drop and its stun.
  shieldStart: "NO_REAC",
  shield: "NO_REAC",
  shieldRelease: "NO_REAC",
  shieldStun: "NO_REAC",
  // UNVERIFIED: the stunned state after a break (SSBU's FURAFURA); WuBor gives
  // only the flight before it (`guard/shield_break_fly.rs`, DISABLE), which the
  // replica does not have.
  shieldBroken: "ENABLE",
  // WuBor `escape/escape.rs` (Escape: the spot dodge); UNVERIFIED for the rolls, read as the spot dodge's.
  spotDodge: "DISABLE",
  roll: "DISABLE",
  // UNVERIFIED: an air dodge outside its intangible frames.
  airDodge: "ENABLE",
  // WuBor `damage/damage.rs`, `damage_fly.rs`, `damage_fall.rs` (ENABLE). The
  // replica keeps a fighter in hitstun closed (`footstoolable`, a DECISION).
  hitstun: "ENABLE",
  tumble: "ENABLE",
  tumbleFall: "ENABLE",
  // Held: the pair moves as one (Plan 5 review).
  grabbed: "DISABLE",
  thrown: "DISABLE",
  // UNVERIFIED: lying down and getting up, and the techs (mostly intangible).
  downed: "ENABLE",
  getUp: "ENABLE",
  tech: "ENABLE",
  techRoll: "ENABLE",
  techWall: "ENABLE",
  techCeiling: "ENABLE",
  // SmashWiki: "the character being jumped off will not fall"; WuBor
  // `cliff/cliff_wait.rs` (NO_REAC). UNVERIFIED for the ledge options, read as
  // the hang's, and the getup attack is an attack.
  ledgeHang: "NO_REAC",
  ledgeGetUp: "NO_REAC",
  ledgeAttack: "NO_REAC",
  ledgeRoll: "NO_REAC",
  ledgeJump: "NO_REAC",
  // UNVERIFIED: let go of the ledge, falling.
  ledgeTrumped: "ENABLE",
  // Carried and carrying, inside Kirby and holding a mouthful, his star (Plan 5 review).
  cargoCarry: "DISABLE",
  cargoHeld: "DISABLE",
  inhaleHold: "DISABLE",
  swallowed: "DISABLE",
  spatStar: "DISABLE",
  // UNVERIFIED: stood on again while still footstooled.
  footstooled: "ENABLE",
  // Not on the stage.
  respawnPlatform: "DISABLE",
  dead: "DISABLE",
  entering: "DISABLE",
};

/** A fighter's head this frame, as the footstool reads it. */
export interface FootstoolHead {
  readonly port: number;
  readonly x: number;
  /** World y of the head's top (the ECB's). */
  readonly top: number;
  /** World y of the feet (the ECB's bottom), for when this fighter is the jumper. */
  readonly feet: number;
  /** Half the body's width (the ECB's). */
  readonly half: number;
  /** Whether a jump may stand on it (`footstoolable`). */
  readonly open: boolean;
  /** Hanging from a ledge: a lower bounce (SmashWiki). */
  readonly onLedge: boolean;
}

/** A footstool decided this frame: who jumped off whom. */
export interface Footstool {
  readonly jumper: number;
  readonly victim: number;
}

/**
 * Can `f` be stood on now? Not in a status that says DISABLE
 * (`TREADED_KIND_OF_ACTION`), nor intangible or invincible, nor held, carried
 * or inside Kirby (`grabbedBy`), nor holding or carrying somebody (`isHolding`
 * with the link: a hold, a pummel, a throw before its release, the carry, a
 * mouthful, as `holdsMouthful` reads it); nor — a DECISION, UNVERIFIED — while
 * frozen or reeling from a hit, so a footstool never overwrites a launch (WuBor's
 * damage statuses are ENABLE; no source says what a footstool does to one).
 */
export function footstoolable(f: FighterState, def: FighterDef): boolean {
  if (TREADED_KIND_OF_ACTION[f.action] === "DISABLE") return false;
  if (f.intangible > 0 || f.invincible > 0) return false;
  if (f.grabbedBy >= 0 || (f.grabbing >= 0 && isHolding(f, def))) return false;
  if (f.hitstun > 0 || f.hitlag > 0) return false;
  return true;
}

/** Everybody's head and feet, read once before the state machines run, from each fighter's ECB this frame. */
export function footstoolHeads(
  fighters: readonly FighterState[],
  defs: readonly FighterDef[],
  ecbs: readonly { readonly bottom: number; readonly top: number; readonly half: number }[],
): FootstoolHead[] {
  return fighters.map((f, i) => ({
    port: f.port,
    x: f.x,
    top: f.y + ecbs[i].top,
    feet: f.y + ecbs[i].bottom,
    half: ecbs[i].half,
    open: footstoolable(f, defs[i]),
    onLedge: f.ledge !== null,
  }));
}

/**
 * The head `jumper`'s feet are on, if any, from this frame's snapshot: within
 * `FOOTSTOOL_REACH` under its top, and the bodies overlapping across. Of two,
 * the higher, then the nearer, then the lower port.
 */
export function headUnder(jumper: number, heads: readonly FootstoolHead[]): FootstoolHead | null {
  const own = heads.find((h) => h.port === jumper);
  if (own === undefined) return null;
  let best: FootstoolHead | null = null;
  for (const head of heads) {
    if (head.port === jumper || !head.open) continue;
    if (own.feet > head.top || own.feet < head.top - FOOTSTOOL_REACH) continue;
    const dx = Math.abs(own.x - head.x);
    if (dx > head.half + own.half) continue;
    if (best === null || head.top > best.top || (head.top === best.top && dx < Math.abs(own.x - best.x))) best = head;
  }
  return best;
}

/**
 * The bounce's launch speed after `made` footstools since the ground: the full
 * hop's, ×0.75 for each, and once more off a ledge (UNVERIFIED: the page says only
 * "will not gain as much height").
 */
export function footstoolSpeed(def: FighterDef, made: number, onLedge: boolean): number {
  const p = fighterParams(def);
  let speed = jumpLaunchSpeed(p.air_accel_y, p.jump_y);
  for (let i = 0; i < made + (onLedge ? 1 : 0); i++) speed = mul(speed, FOOTSTOOL_SPEED_DECAY);
  return speed;
}

/**
 * Phase 3, every frame, frozen or not: the wait after an attack counts (0 while
 * attacking, so it counts from the move's end, however it ends), and the ground
 * starts the run of footstools again.
 */
export function ageFootstool(f: FighterState): void {
  if (f.action === "attack" || f.action === "special") f.combat.sinceAttack = 0;
  else if (f.combat.sinceAttack < SINCE_ATTACK_CAP) f.combat.sinceAttack += 1;
  if (f.grounded) f.combat.footstools = 0;
}

/**
 * From the fall's main (`airMain`: JUMP and FALL): a jump, pressed or buffered,
 * over an open head. The jumper bounces now; what happens to the one stood on
 * waits for `applyFootstools`. Returns true if it footstooled.
 *
 * In the game's order (`sub_air_check_fall_common`, above): after a special, an
 * air dodge and an attack pressed on the same frame (`airActionFirst`), and
 * before a wall jump. Not out of a tumble: the vanilla `set_damage_fall_transition`
 * (WuBor Patch `fighters/common/src/status/damage/damage_fall.rs` L87-117, kept in
 * comments) enables the special, attack, wall jump and midair jump groups in
 * DAMAGE_FALL and not the footstool's. Not from special fall either, whose main
 * is not `airMain` (SmashWiki "Helpless", https://www.ssbwiki.com/Helpless:
 * "unable to take any action, with the exception of grabbing a ledge,
 * maneuvering left/right, fastfalling, or climbing a ladder").
 *
 * The bounce spends no midair jump and gives none back; it ends the short hop's
 * damage penalty, as an air jump does (UNVERIFIED for a footstool); it leaves the
 * wall jumps' count alone (SmashWiki "Wall jump", https://www.ssbwiki.com/Wall_jump:
 * reduced "without touching the ground", and a head is not the ground).
 */
export function tryFootstool(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  const heads = ctx.heads;
  if (heads === undefined || ctx.footstools === undefined || f.grounded || f.action === "tumbleFall") return false;
  const buffered = peekBuffer(f, ctx.frame) === "jump";
  if (!intent.jumpPressed && !buffered) return false;
  if (f.combat.sinceAttack < FOOTSTOOL_AFTER_ATTACK || airActionFirst(f, intent, ctx)) return false;
  const head = headUnder(f.port, heads);
  if (head === null) return false;
  const speed = footstoolSpeed(ctx.def, f.combat.footstools, head.onLedge);
  if (speed < FOOTSTOOL_SPEED_LIMIT) return false;
  if (buffered) f.bufferedAction = null;
  kineticJump(f, speed);
  f.fastFalling = false;
  f.shortHop = false;
  f.combat.footstools += 1;
  startAction(f, "jump");
  ctx.footstools.push({ jumper: f.port, victim: head.port });
  return true;
}

/**
 * After every state machine has run: each fighter stood on this frame is
 * footstooled, once however many stood on them — unless what they did this
 * frame closed them after all, or their status feels nothing (NO_REAC: a move
 * under way, a shield, a ledge). Standing, they freeze (`footstooled`); in the
 * air they tumble down at their own full fall speed with no launch, so they tech
 * or lie down on landing and never bounce (SmashWiki: no "proper knockback";
 * "teching is possible"). Each footstool that reached its victim is reported, for
 * the kill credit.
 */
export function applyFootstools(
  fighters: readonly FighterState[],
  defs: readonly FighterDef[],
  footstools: readonly Footstool[],
  events: Pick<StepEvents, "footstools">,
): void {
  const victims = [...new Set(footstools.map((s) => s.victim))].sort((a, b) => a - b);
  for (const port of victims) {
    const victim = fighters[port];
    if (victim === undefined || !footstoolable(victim, defs[port])) continue;
    if (TREADED_KIND_OF_ACTION[victim.action] === "NO_REAC") continue;
    if (victim.grounded) {
      startAction(victim, "footstooled");
    } else {
      startAction(victim, "tumble");
      victim.hitstun = FOOTSTOOL_AIR_STUN;
      victim.fastFalling = false;
      kineticClear(victim);
      kineticSetY(victim, -fighterParams(defs[port]).air_speed_y_stable);
    }
    const jumpers = footstools.filter((s) => s.victim === port).map((s) => s.jumper).sort((a, b) => a - b);
    for (const jumper of jumpers) events.footstools.push({ jumper, victim: port });
  }
}
