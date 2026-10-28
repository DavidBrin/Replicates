/**
 * CombatState — the per-fighter bookkeeping Plan 3's combat rules need.
 *
 * One sub-object, like `KineticState`, so every rule Plan 3 adds is one more
 * field here rather than one more `FighterState` field that every fixture in
 * the repo has to learn about. It is cloned by `cloneState` and hashed by
 * `hashState` (`mixCombat`) like everything else a rollback must reproduce;
 * the reflective tests in `simulate.test.ts` and `hash.test.ts` walk it.
 */

export interface CombatState {
  /**
   * Parallel to `FighterState.staleQueue`: entry i landed on a shield, so it
   * stales at 0.85 (SmashWiki "Stale-move negation"). Pushed and trimmed with
   * the queue, never on its own.
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
   * The parked launch is a meteor that tumbles a grounded victim: it bounces off
   * the floor as it fires, once (Plan 3, Task 16b fix round 1). Set on contact,
   * read when the freeze ends.
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
}

export function emptyCombat(): CombatState {
  return {
    staleShield: [],
    launchFaf: 0,
    launchSetWeight: false,
    launchBounce: false,
    launchSource: -1,
    mash: 0,
    comboHits: 0,
    asdi: false,
    techWindow: 0,
    techLockout: 0,
    grabImmune: 0,
    tumbleDodge: false,
    swingQueued: false,
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
    comboHits: c.comboHits,
    asdi: c.asdi,
    techWindow: c.techWindow,
    techLockout: c.techLockout,
    grabImmune: c.grabImmune,
    tumbleDodge: c.tumbleDodge,
    swingQueued: c.swingQueued,
  };
}
