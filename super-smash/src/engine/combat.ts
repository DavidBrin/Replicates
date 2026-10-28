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
}

export function emptyCombat(): CombatState {
  return {
    staleShield: [],
    launchFaf: 0,
    launchSource: -1,
    mash: 0,
    comboHits: 0,
    asdi: false,
    techWindow: 0,
    techLockout: 0,
    grabImmune: 0,
    tumbleDodge: false,
  };
}

export function cloneCombat(c: CombatState): CombatState {
  return {
    staleShield: c.staleShield.slice(),
    launchFaf: c.launchFaf,
    launchSource: c.launchSource,
    mash: c.mash,
    comboHits: c.comboHits,
    asdi: c.asdi,
    techWindow: c.techWindow,
    techLockout: c.techLockout,
    grabImmune: c.grabImmune,
    tumbleDodge: c.tumbleDodge,
  };
}
