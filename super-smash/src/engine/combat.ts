/**
 * CombatState — the per-fighter bookkeeping Plan 3's combat rules need.
 *
 * One sub-object, like `KineticState`, so every rule Plan 3 adds is one more
 * field here rather than one more `FighterState` field that every fixture in
 * the repo has to learn about. It is cloned by `cloneState` and hashed by
 * `hashState` (`mixCombat`) like everything else a rollback must reproduce;
 * the reflective tests in `simulate.test.ts` and `hash.test.ts` walk it.
 */

import type { MoveSlot } from "./types";

export interface CombatState {
  /**
   * Parallel to `FighterState.staleQueue`: entry i landed on a shield, so it
   * stales at 0.85 (SmashWiki "Stale-move negation"). Pushed and trimmed with
   * the queue, never on its own.
   *
   * INVARIANT: `staleShield.length === staleQueue.length` at every frame boundary.
   * Anything that pushes, trims, empties or replaces the queue (`enterStaleQueue`,
   * the KO reset, `cloneState`, a fixture) must do the same to this array.
   * `computeStaleness` reads a missing mark as "not a shield hit", so a drift
   * would not throw: it would stale a move at the wrong rate. The golden trace's
   * per-frame invariants check it on every frame of every match.
   */
  staleShield: boolean[];
  /**
   * The parked launch's reaction frames (`computeHitstun + 1`) when it will be
   * sped up — a tumbling launch without set knockback — else 0. Set on contact,
   * handed to `kineticLaunch` when the freeze ends (Plan 3, Task 6).
   */
  launchFaf: number;
  /**
   * The parked launch is from a set-weight hit, so it falls by set weight's
   * own gravity for its first frames and is never balloon fall. Set on contact,
   * handed to `kineticLaunch` when the freeze ends (Plan 3, Task 16b).
   */
  launchSetWeight: boolean;
  /**
   * The parked launch tumbles a grounded victim: if it points into the floor as
   * it fires, and the victim still stands on one then, it bounces off it, once
   * (Plan 3, Task 16b fix round 1, for meteors; the final wave, for any launch).
   * Set on contact, read when the freeze ends.
   */
  launchBounce: boolean;
  /**
   * Who launched this fighter last: the attacker's port, or 1000 + a
   * projectile's instance id (`candidateKey` in `simulate.ts`), −1 for nobody.
   * Knockback stacks only between different sources (Plan 3, Task 8).
   */
  launchSource: number;
  /** Tenths of a frame mashing has earned but not yet spent (`mashFrames`). */
  mash: number;
  /**
   * On a held fighter: the grab time the grab was made with, `grabHoldFrames` at
   * the catch, kept for the hold and the carry (Plan 5, Task 8 fix round 1).
   * Grab time is fixed "at the time of the grab (so it is not affected by
   * pummeling or external damage)" (SmashWiki "Grab",
   * https://www.ssbwiki.com/Grab), so the grab time passed is this less
   * `grabTimer`, mashing included: Donkey Kong's carry reads it (`liftCargo`).
   * 0 when nobody holds the fighter; `releaseGrab` clears it with the link.
   */
  grabLength: number;
  /** Hits taken since this fighter was last out of hitstun: SDI grows ×1.15 past five (Task 11). */
  comboHits: number;
  /** The freeze now running is from a hit that grants automatic SDI when it ends (Task 11). */
  asdi: boolean;
  /** Frames left of an open tech window: 11 from a shield press (Task 12). */
  techWindow: number;
  /** Frames before another shield press can open a tech window: 40 from the last (Task 12). */
  techLockout: number;
  /** Frames during which a grab cannot catch this fighter: 60 after breaking out of one (Task 14). */
  grabImmune: number;
  /**
   * The air dodge now running began out of a tumble (the hitstun cancel, or
   * `tumbleFall`): in its first 15 frames a surface is a tech (Task 12).
   * Set by `startAirDodge`, cleared when the air dodge status ends.
   */
  tumbleDodge: boolean;
  /**
   * The current swing has already joined the stale queue, so its later hits (a
   * box `clear_all` re-armed, a second victim) do not queue it again. Reset by
   * `startMove`, which every swing, pummel and throw begins with (Task 16).
   */
  swingQueued: boolean;
  /**
   * The parked launch is an autolink (Plan 3, Task 19): what its vector needs is
   * parked on contact, and `releasePendingLaunch` computes the vector from it
   * when the freeze ends ("calculated after hitlag is over", so the victim's
   * position is where SDI left it), with no DI, LSI or balloon fall (the hit's
   * speed-up and set weight still ride along: `launchFaf`, `launchSetWeight`).
   * Every field below stays false or 0 when it is not.
   */
  autolink: boolean;
  /** The 367 rule (a pull toward the hit point); false is 365, half the momentum. */
  autolinkPull: boolean;
  /** The attacker's momentum at contact (a projectile's, for one), Q12. */
  autolinkMomentumX: number;
  autolinkMomentumY: number;
  /** The hit point at contact, world, Q12: the centre of the hitbox. 0 for 365. */
  autolinkPointX: number;
  autolinkPointY: number;
  /**
   * The freeze now running (`hitlag`) was dealt to this fighter as a hit's
   * victim: a hit on its body or its shield (a parry included), or a pummel. Only
   * then may it SDI, and ASDI (Plan 3 final wave; the final review's Important 3):
   * SmashWiki "Smash directional influence" lets players "slightly alter their
   * position during hitlag from being hit by an attack", and "Shield SDI ... allows
   * players to move slightly when their shield is hit". An attacker's freeze is
   * not one. Set with the victim's hitlag, cleared when the freeze ends and on KO.
   * UNVERIFIED: that a parry's freeze counts (the page's shield SDI does not
   * mention perfect shields), and a pummel's, where the hold places the victim
   * at its captor whatever SDI did (`holdAtCaptor`).
   */
  victimFreeze: boolean;
  /**
   * Plan 5: frames of a store-mode special's charge put away for later (Charge
   * Shot, Giant Punch, F.L.U.D.D.); 0 for none. Survives shielding, jumping
   * and being hit; spent by the next use of that special.
   */
  storedCharge: number;
  /**
   * Plan 5: frames a reflector must stay up after reflecting something (Fox: 20).
   * Per move: cleared when the special starts and when it ends, however it ends.
   */
  reflectHold: number;
  /**
   * Plan 5: this airtime's one special stall is spent (Reflector, Cape). Reset on
   * landing, a ledge, a hit and a KO, and by being held over the ground, which
   * counts as a landing (`holdAtCaptor`); not by the catch itself, as the air
   * dodge is not (`applyHit`). SmashWiki "Fox (SSBU)"
   * (https://www.ssbwiki.com/Fox_(SSBU)): "he can only do it once until he lands
   * or gets hit".
   */
  specialStall: boolean;
  /** Plan 5: the current move is the one stalling (it took the airtime's stall). Per move, as `reflectHold`. */
  stalling: boolean;
  /**
   * Plan 5, Task 4b: the move whose ending left this fighter helpless, whose
   * `HelplessDef` sets the fall's drift and its landing's lag; null when not
   * helpless. Set on entering `specialFall`, carried into `specialLanding`, and
   * cleared by either status's `end` however it is left: the landing's end, a
   * ledge, a hit, a grab or a KO.
   */
  helplessMove: MoveSlot | null;
  /**
   * Plan 5, Task 5: the damage the counterattack deals (Q12), the hit its counter
   * caught × the counter's multiplier, clamped (`counter.ts`); 0 when no
   * counterattack is out. Per move, as `reflectHold`: set as the counterattack
   * starts and cleared by the special status's `end` however it is left (its own
   * end, a hit, a grab, a ledge, a landing, a clank or a KO).
   */
  counterDamage: number;
  /**
   * Plan 5, Task 9: Kirby's Copy Ability, the id of the fighter whose neutral
   * special he has (`withCopyAbility`), or "" for none. Set by a swallow, and
   * cleared by a KO (SmashWiki "Copy Ability": "he will also lose it upon being
   * KO'd") or, past its grace, by a hit's chance (`maybeLoseCopy`); a Kirby who
   * is swallowed by another loses it to him.
   */
  copy: string;
  /**
   * Plan 5, Task 9: frames the Copy Ability has been held, counting up to its
   * 1200-frame grace and stopping there (`COPY_GRACE_FRAMES`). 0 with no copy;
   * cleared with it. −1 (`COPY_LOSS_PENDING`, fix round 1, ruling R-T9d) while a
   * copy lost to a hit waits for the copied special under way to end, which the
   * special status's `end` makes good.
   */
  copyFrames: number;
  /**
   * Plan 5, Task 9: on a fighter Kirby spat (`spatStar`), the instance id of the
   * star it rides; 0 otherwise. Cleared when the ride ends, however it ends
   * (`STATUS_SPAT_STAR`'s `end`: the flight's end, the star's, a KO).
   */
  ride: number;
  /**
   * Plan 5, Task 10: the wall this fighter last touched in the air (`wallJump.ts`),
   * 1 to its right, −1 to its left, 0 for none. Set by the collision when a wall
   * stops the fighter (`CollisionOutcome.wall`), forgotten once neither a wall
   * jump nor a wall tech jump could use it, and by a landing, a ledge, a hit, a
   * grab, a KO and the jump off it.
   */
  wallSide: number;
  /** Plan 5, Task 10: frames since that touch; 0 with no wall. */
  wallFrames: number;
  /**
   * Plan 5, Task 10: wall jumps since this fighter last touched the ground, each
   * 0.96× the one before (SmashWiki "Wall jump"). Reset by the ground (a landing,
   * a tech, being held over it), a ledge and a KO; not by a hit or a grab.
   */
  wallJumps: number;
  /**
   * Plan 5, Task 11: frames since this fighter last attacked (in `attack` or
   * `special`), counted from the move's end however it ends, up to
   * `SINCE_ATTACK_CAP`; a footstool waits 16 (`footstool.ts`). A KO sets it to
   * the cap: a new stock has attacked nobody. Nothing else touches it.
   */
  sinceAttack: number;
  /**
   * Plan 5, Task 11: footstool jumps since this fighter last touched the ground,
   * each bouncing 0.75× as fast as the one before (`footstool.ts`). Reset by the
   * ground (any grounded frame), a ledge and a KO; not by a hit or a grab.
   */
  footstools: number;
  /**
   * Plan 5, Task 11 fix round 1 (ruling R-T11f): a footstool's bounce, by frame:
   * 1 on the footstool, counting up while its jumper stays in the bounce's jump or
   * the fall after, and 0 once past frame 12 or out of them. The jumper acts from
   * frame 8 and is intangible on frames 9 to 12 (`footstoolBounceHolds`). A KO
   * clears it; any other status clears it at the next frame's count.
   */
  footstoolFrame: number;
}

/** `CombatState.sinceAttack`'s cap, as `framesSinceDirPress` has one: long past any wait. */
export const SINCE_ATTACK_CAP = 999;

export function emptyCombat(): CombatState {
  return {
    staleShield: [],
    launchFaf: 0,
    launchSetWeight: false,
    launchBounce: false,
    launchSource: -1,
    mash: 0,
    grabLength: 0,
    comboHits: 0,
    asdi: false,
    techWindow: 0,
    techLockout: 0,
    grabImmune: 0,
    tumbleDodge: false,
    swingQueued: false,
    autolink: false,
    autolinkPull: false,
    autolinkMomentumX: 0,
    autolinkMomentumY: 0,
    autolinkPointX: 0,
    autolinkPointY: 0,
    victimFreeze: false,
    storedCharge: 0,
    reflectHold: 0,
    specialStall: false,
    stalling: false,
    helplessMove: null,
    counterDamage: 0,
    copy: "",
    copyFrames: 0,
    ride: 0,
    wallSide: 0,
    wallFrames: 0,
    wallJumps: 0,
    sinceAttack: SINCE_ATTACK_CAP,
    footstools: 0,
    footstoolFrame: 0,
  };
}

export function cloneCombat(c: CombatState): CombatState {
  return {
    staleShield: c.staleShield.slice(),
    launchFaf: c.launchFaf,
    launchSetWeight: c.launchSetWeight,
    launchBounce: c.launchBounce,
    launchSource: c.launchSource,
    mash: c.mash,
    grabLength: c.grabLength,
    comboHits: c.comboHits,
    asdi: c.asdi,
    techWindow: c.techWindow,
    techLockout: c.techLockout,
    grabImmune: c.grabImmune,
    tumbleDodge: c.tumbleDodge,
    swingQueued: c.swingQueued,
    autolink: c.autolink,
    autolinkPull: c.autolinkPull,
    autolinkMomentumX: c.autolinkMomentumX,
    autolinkMomentumY: c.autolinkMomentumY,
    autolinkPointX: c.autolinkPointX,
    autolinkPointY: c.autolinkPointY,
    victimFreeze: c.victimFreeze,
    storedCharge: c.storedCharge,
    reflectHold: c.reflectHold,
    specialStall: c.specialStall,
    stalling: c.stalling,
    helplessMove: c.helplessMove,
    counterDamage: c.counterDamage,
    copy: c.copy,
    copyFrames: c.copyFrames,
    ride: c.ride,
    wallSide: c.wallSide,
    wallFrames: c.wallFrames,
    wallJumps: c.wallJumps,
    sinceAttack: c.sinceAttack,
    footstools: c.footstools,
    footstoolFrame: c.footstoolFrame,
  };
}
