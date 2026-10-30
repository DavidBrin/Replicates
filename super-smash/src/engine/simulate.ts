/**
 * `step(state, inputs)` — the one door into the simulation.
 *
 * Everything above this file (renderer, netcode, CPU, UI) calls this and reads
 * what comes back; nothing above it may reach in and change a fighter. That is
 * not tidiness, it is the precondition for rollback: a frame has to be
 * reproducible from its inputs alone, so a frame that anybody else can touch is
 * a frame that cannot be re-simulated.
 *
 * **Frame order is part of the contract.** The ten phases below run in this order
 * on every peer, and reordering two of them is a desync even though both peers
 * are running correct code. In particular: hits resolve *after* movement (so a
 * hitbox is tested where it actually ended up, swept from where it was), and
 * blast-zone KOs resolve *after* hits (so the frame that kills you is the frame
 * you were hit, not the one after).
 */

import { DIAGONAL, ONE, fx, mul, abs, byRatio, clamp, cosDeg, magnitude, randomInt, nextRandom, sinDeg } from "./fixed";
import {
  ASDI_DISTANCE,
  ASDI_VERTICAL,
  AUTOLINK_GROUNDED_ANGLE,
  AUTOLINK_HALF_MOMENTUM,
  AUTOLINK_MAX,
  AUTOLINK_MIN,
  AUTOLINK_MIN_VY,
  AUTOLINK_PULL_RATIO,
  AUTOLINK_SPEED_CAP,
  BOUNCE_FLOOR_LAUNCH_RATIO,
  BOUNCE_FLOOR_MIN_SPEED,
  FINAL_SMASH_STANDBY,
  GLANCING_BLOW_DEPTH,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  LEDGE_REGRAB_LIMIT,
  LEDGE_REGRAB_LOCKOUT_FRAMES,
  ONE_ON_ONE_MULTIPLIER,
  SDI_COMBO_HITS,
  SDI_COMBO_RATIO,
  SDI_DISTANCE,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
  SHORT_HOP_DAMAGE,
  SMASH_BALL_DECAY,
  SMASH_BALL_DECAY_INTERVAL,
  SMASH_BALL_HEALTH,
  SMASH_BALL_SPAWN_INTERVAL,
  STALE_QUEUE_LENGTH,
  TUMBLE_HITSTUN,
} from "./constants";
import {
  computeHitlag,
  computeHitstun,
  computeKnockback,
  computeRage,
  computeShieldstun,
  computeStaleness,
  effectiveHitstun,
  framesAfterHit,
  shieldstunExact,
  applyDI,
  applyLSI,
  launchDiAble,
  lsiApplies,
  knockbackStack,
  knockbackToVelocity,
  launchWorldAngle,
  resolveAngle,
} from "./knockback";
import {
  SMASH_BALL_TARGET,
  alreadyHit,
  capsulesOverlap,
  circle,
  clearHitRecord,
  contactPoint,
  deepestReach,
  hitboxWorldPos,
  hurtboxCapsule,
  markHit,
  moveFrameOf,
  resolveClank,
  sweptCapsuleOverlaps,
} from "./hitbox";
import type { Capsule } from "./hitbox";
import type { Ecb, Point } from "./physics";
import {
  advanceProjectile,
  chargeFraction,
  cloneProjectile,
  findProjectileDef,
  markProjectileHit,
  projectileAlreadyHit,
  projectileHitbox,
  projectileHitboxActive,
  spawnProjectile,
} from "./projectile";
import { chargedHitbox } from "./specialCharge";
import { reflectProjectiles } from "./reflect";
import { activeCounter, counterBubble, triggerCounter } from "./counter";
import { pinHeldFighters, ridesCaptor } from "./held";
import {
  COPY_GRACE_FRAMES,
  HOLD_BLAST_REACH,
  carryOutStarRiders,
  carryStarRider,
  dropLostCopies,
  dropRiderlessStars,
  holdsMouthful,
  inhaleMayCatch,
  loseCopy,
  maybeLoseCopy,
  resolveInhaleReleases,
  spawnDamageMul,
  swallowVictim,
  withCopyAbility,
} from "./inhale";
import {
  blastZoneKO,
  clampShiftToStage,
  ecbOf,
  findLedgeGrab,
  integrate,
  ledgeIntangibilityFrames,
  ledgePosition,
  platformCentreX,
  resolveCollision,
} from "./physics";
import {
  ENTRY_FRAMES,
  advanceFighter,
  applyMovement,
  chargeMultiplier,
  grabHoldFrames,
  grabLedge,
  hasSuperArmour,
  heavyArmourOf,
  interpretInput,
  isCatchStatus,
  isHolding,
  isParrying,
  onLanded,
  onLeftGround,
  releaseGrab,
  shieldCovers,
  startAction,
  trumpLedge,
  updateDodgeIntangibility,
  updateInputTracking,
} from "./states";
import type { Intent, StateContext } from "./states";
import {
  cloneKinetic,
  emptyKinetic,
  kineticClear,
  kineticDisarmLaunch,
  kineticLaunch,
  kineticPush,
  kineticTurnLaunch,
  kineticSet,
  kineticSetX,
} from "./kinetic";
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { LEGACY_BAKE, type BakeTables } from "./acmd/bakeTables";
import { bakedEcb, fighterHurtboxes, restEcb } from "./acmd/hurtboxes";
import { launchBefore, techOrBounce, updateTechInput } from "./tech";
import { cloneCombat, emptyCombat } from "./combat";
import type { CombatState } from "./combat";
import {
  attackerShieldPushback,
  perfectShieldHitlag,
  shieldBreakStun,
  shieldBubble,
  shieldDamage,
  shieldPushback,
} from "./shield";
import { absHitbox, scriptHitboxes, unplacedHitbox } from "./acmd/hitboxes";
import { moveScriptFrame, prepareFighterScripts, throwStrikeFrame } from "./acmd/run";
import { gameScriptFor } from "./acmd/legacy";
import "./status";
import { releaseHeld, struggleInGrab } from "./status/grab";
import { emptyEvents } from "./types";
import type {
  ActionState,
  FighterDef,
  FighterState,
  GameState,
  Hitbox,
  InputFrame,
  MatchRules,
  MoveSlot,
  ProjectileDef,
  ProjectileState,
  StageDef,
  StepEvents,
} from "./types";

/* -------------------------------------------------------------- registry -- */

/**
 * Where `defId` and `stageId` turn back into data.
 *
 * `GameState` carries ids rather than objects because it is cloned ten times a
 * frame and shipped through a hash — embedding a whole moveset in it would make
 * both of those an order of magnitude more expensive for data that never changes
 * during a match. The roster and the stage list register themselves once at
 * startup; the engine still imports nothing from `fighters/` or `stages/`, so
 * the dependency arrow keeps pointing the right way and `layering.test.ts` stays
 * green.
 */
const fighterRegistry = new Map<string, FighterDef>();
const stageRegistry = new Map<string, StageDef>();

/**
 * Registering is `registryContext`'s load, so every script a fighter can run
 * is made ready for that context's bone table here (`prepareFighterScripts`):
 * a script the sim could not run is refused now, the whole batch with it,
 * rather than inside `step()` mid-match.
 */
export function registerFighters(defs: readonly FighterDef[]): void {
  for (const d of defs) prepareFighterScripts(d, registryContext.bones ?? LEGACY_BONE_TABLE);
  for (const d of defs) fighterRegistry.set(d.id, d);
}

export function registerStages(stages: readonly StageDef[]): void {
  for (const s of stages) stageRegistry.set(s.id, s);
}

export function clearRegistry(): void {
  fighterRegistry.clear();
  stageRegistry.clear();
}

export interface SimContext {
  fighter(id: string): FighterDef;
  stage(id: string): StageDef;
  /**
   * Where fighters' bones are, for script hitboxes (`acmd/bones.ts`). Absent
   * means the root-bone `LEGACY_BONE_TABLE`; Plan 4 passes its bake here.
   */
  readonly bones?: BoneTable;
  /**
   * Plan 4: the bake's motion clocks and per-bone hurtboxes (`acmd/bakeTables.ts`).
   * Absent means Plan 2's single capsule and fixed ECB.
   */
  readonly bake?: BakeTables;
}

export const registryContext: SimContext = {
  fighter(id) {
    const d = fighterRegistry.get(id);
    if (d === undefined) throw new Error(`unregistered fighter: ${id}`);
    return d;
  },
  stage(id) {
    const s = stageRegistry.get(id);
    if (s === undefined) throw new Error(`unregistered stage: ${id}`);
    return s;
  },
  bones: LEGACY_BONE_TABLE,
};

/* ---------------------------------------------------------------- clone -- */

/**
 * A genuine deep copy of the simulation state.
 *
 * Rollback runs this on every confirmed frame and then re-steps up to eight
 * frames from a snapshot, so it happens on the order of ten times per rendered
 * frame. It is written longhand for two reasons: a spread would share the
 * `staleQueue` and `hitThisMove` arrays between the copy and the original, which
 * is a mutation of the input state disguised as a clone; and `structuredClone`
 * is both slower and unavailable in the plain-Node test environment.
 */
export function cloneState(state: GameState): GameState {
  const fighters: FighterState[] = new Array(state.fighters.length);
  for (let i = 0; i < state.fighters.length; i++) {
    const f = state.fighters[i];
    fighters[i] = {
      port: f.port,
      defId: f.defId,
      costume: f.costume,
      x: f.x,
      y: f.y,
      vx: f.vx,
      vy: f.vy,
      facing: f.facing,
      grounded: f.grounded,
      platform: f.platform,
      action: f.action,
      actionFrame: f.actionFrame,
      move: f.move,
      charge: f.charge,
      damage: f.damage,
      stocks: f.stocks,
      jumpsUsed: f.jumpsUsed,
      airDodged: f.airDodged,
      fastFalling: f.fastFalling,
      shortHop: f.shortHop,
      shieldHealth: f.shieldHealth,
      hitstun: f.hitstun,
      hitlag: f.hitlag,
      launchSpeed: f.launchSpeed,
      pendingKnockback: f.pendingKnockback,
      pendingAngle: f.pendingAngle,
      pendingFacing: f.pendingFacing,
      balloon: f.balloon,
      intangible: f.intangible,
      invincible: f.invincible,
      grabbedBy: f.grabbedBy,
      grabbing: f.grabbing,
      grabTimer: f.grabTimer,
      ledge: f.ledge === null ? null : { platform: f.ledge.platform, side: f.ledge.side },
      ledgeRegrabs: f.ledgeRegrabs,
      ledgeLockout: f.ledgeLockout,
      airTime: f.airTime,
      finalSmashReady: f.finalSmashReady,
      staleQueue: f.staleQueue.slice(),
      hitThisMove: f.hitThisMove.slice(),
      framesSinceDirPress: f.framesSinceDirPress,
      lastDirPressed: f.lastDirPressed,
      bufferedAction:
        f.bufferedAction === null
          ? null
          : ({ kind: f.bufferedAction.kind, frame: f.bufferedAction.frame } as FighterState["bufferedAction"]),
      kinetic: cloneKinetic(f.kinetic),
      combat: cloneCombat(f.combat),
    };
  }
  const projectiles: ProjectileState[] = new Array(state.projectiles.length);
  for (let i = 0; i < state.projectiles.length; i++) {
    projectiles[i] = cloneProjectile(state.projectiles[i]);
  }

  return {
    frame: state.frame,
    rngSeed: state.rngSeed,
    fighters,
    stageId: state.stageId,
    projectiles,
    nextProjectileId: state.nextProjectileId,
    rules: {
      mode: state.rules.mode,
      stocks: state.rules.stocks,
      timeLimit: state.rules.timeLimit,
      smashBall: state.rules.smashBall,
      oneOnOne: state.rules.oneOnOne,
    },
    smashBall: {
      active: state.smashBall.active,
      x: state.smashBall.x,
      y: state.smashBall.y,
      vx: state.smashBall.vx,
      vy: state.smashBall.vy,
      health: state.smashBall.health,
      driftTimer: state.smashBall.driftTimer,
    },
    timeRemaining: state.timeRemaining,
    outcome:
      state.outcome === null
        ? null
        : { kind: state.outcome.kind, placings: state.outcome.placings.slice() },
    freezeFrames: state.freezeFrames,
    cinematic: state.cinematic,
  };
}

/* --------------------------------------------------------------- startup -- */

export interface FighterSelection {
  readonly defId: string;
  readonly costume?: number;
}

/** Default seed. Any integer works; the netcode replaces it with an agreed one. */
export const DEFAULT_SEED = 0x5eed1e55 | 0;

export function createInitialState(
  stageId: string,
  selections: readonly FighterSelection[],
  rules: MatchRules,
  seed: number = DEFAULT_SEED,
  ctx: SimContext = registryContext,
): GameState {
  const stage = ctx.stage(stageId);
  const fighters: FighterState[] = selections.map((sel, i) => {
    const spawn = stage.spawns[i % stage.spawns.length];
    return {
      port: i,
      defId: sel.defId,
      costume: sel.costume ?? 0,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      // Fighters face the centre of the stage on entry, as they do in the game.
      facing: spawn.x > 0 ? -1 : 1,
      grounded: false,
      platform: -1,
      action: "entering",
      actionFrame: 0,
      move: null,
      charge: 0,
      damage: 0,
      stocks: rules.stocks,
      jumpsUsed: 0,
      airDodged: false,
      fastFalling: false,
      shortHop: false,
      shieldHealth: SHIELD_MAX_HEALTH,
      hitstun: 0,
      hitlag: 0,
      launchSpeed: 0,
      pendingKnockback: 0,
      pendingAngle: 0,
      pendingFacing: 0,
      balloon: false,
      // The entry drop is intangible for its whole length plus a beat, so two
      // fighters spawning on top of each other is not a coin flip.
      intangible: ENTRY_FRAMES + 30,
      invincible: 0,
      grabbedBy: -1,
      grabbing: -1,
      grabTimer: 0,
      ledge: null,
      ledgeRegrabs: 0,
      ledgeLockout: 0,
      airTime: 0,
      finalSmashReady: 0,
      staleQueue: [],
      hitThisMove: [],
      framesSinceDirPress: 999,
      lastDirPressed: 0,
      bufferedAction: null,
      kinetic: emptyKinetic(),
      combat: emptyCombat(),
    };
  });

  return {
    frame: 0,
    rngSeed: seed | 0,
    fighters,
    stageId,
    projectiles: [],
    // Ids start at 1 so zero can mean "no projectile" anywhere downstream.
    nextProjectileId: 1,
    rules: {
      mode: rules.mode,
      stocks: rules.stocks,
      timeLimit: rules.timeLimit,
      smashBall: rules.smashBall,
      oneOnOne: rules.oneOnOne,
    },
    smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
    timeRemaining: rules.mode === "time" ? rules.timeLimit : 0,
    outcome: null,
    freezeFrames: 0,
    cinematic: -1,
  };
}

/* ------------------------------------------------------------------ step -- */

export interface StepOptions {
  /**
   * The previous frame's inputs, for edge detection.
   *
   * `GameState` has no field for them, and a button press is an *edge* — "jump"
   * means the key went down this frame, not that it is down. A rollback session
   * owns the whole input history and so always has frame N−1 to hand; omitting
   * it makes every button read as already-held, which is the right answer for a
   * physics-only test and the wrong one for anything else.
   */
  readonly prevInputs?: readonly InputFrame[];
  readonly ctx?: SimContext;
}

/**
 * Frames the whole game freezes for on a KO, for the drama. UNVERIFIED: no source
 * gives a whole-game pause on a KO; SmashWiki "KO" (https://www.ssbwiki.com/KO) and
 * "Blast line" (https://www.ssbwiki.com/Blast_line) give none, and "Special Zoom"
 * (https://www.ssbwiki.com/Special_Zoom) is a slowdown at the hit, of a factor the
 * page itself marks unknown, not a pause on the KO. Not a hitlag, so not counted
 * through `framesAfterHit` (Plan 5, Task 7b): the KO's frame runs, then these.
 */
export const KO_FREEZE_FRAMES = 14;
/** The Smash Ball's radius, and how hard it drifts. */
export const SMASH_BALL_RADIUS = fx(6);
export const SMASH_BALL_SPEED = fx(1.4);
export const SMASH_BALL_DRIFT_FRAMES = 45;

const SMASH_SLOTS: readonly MoveSlot[] = ["fsmash", "usmash", "dsmash"];
const AERIAL_SLOTS: readonly MoveSlot[] = ["nair", "fair", "bair", "uair", "dair"];

/**
 * One live hitbox this frame, whether it belongs to a fist or to an arrow.
 *
 * Projectiles and melee share this shape deliberately: clanking, priority, shield
 * interaction and the whole knockback pipeline then have exactly one
 * implementation. A projectile hit that took a different code path would be a
 * second combat system to keep in sync, and the two would drift.
 */
/**
 * Actions during which a fighter's move can put hitboxes on the field.
 *
 * `grab` is in this list and is easy to leave out: a grab box is a hitbox with
 * `grabbing` set, so a fighter whose grab never gathers is a fighter who can
 * never grab at all — and nothing else in the engine would report it.
 */
function hasLiveMove(action: ActionState): boolean {
  return (
    action === "attack" ||
    action === "special" ||
    action === "throw" ||
    action === "grab" ||
    action === "pummel"
  );
}

interface Candidate {
  /** Port of the fighter responsible — the projectile's owner, for a projectile. */
  readonly attacker: number;
  readonly hitbox: Hitbox;
  readonly x: number;
  readonly y: number;
  readonly prevX: number;
  readonly prevY: number;
  /** Far end of an extended hitbox, relative to (x, y); 0, 0 for a sphere (Plan 3, Task 17). */
  readonly dx: number;
  readonly dy: number;
  /** The move this came from, or null when the source is a projectile. */
  readonly slot: MoveSlot | null;
  readonly projectile: ProjectileState | null;
  /** Charge scaling already resolved: Samus's shot, or a charged smash. */
  readonly chargeScale: number;
  readonly destroyOnHit: boolean;
  /**
   * The only port this candidate may hit, or null for anyone it reaches. A box
   * live under `set_catch_only_all` (a pummel's, a throw's hits before its
   * launch: Plan 5, Task 7) hits the fighter its owner holds and nobody else,
   * wherever that fighter is, and only for damage (`applyHeldHit`); a throw's
   * launch is no candidate at all (`resolveThrows`). `-1` is "the fighter held"
   * when nobody is, which no port equals.
   */
  readonly onlyPort: number | null;
  /**
   * Kirby's Copy Ability, ×1.2 on the damage dealt and not on knockback's `d`
   * (Plan 5, Task 9: `MoveDef.copyDamage`, a copied projectile's `damageMul`); `ONE`
   * otherwise.
   */
  readonly damageMul: number;
  suppressed: boolean;
}

/** Where a candidate's box is this frame: a capsule, or a circle when it has no length. */
function capsuleOf(c: Candidate): Capsule {
  return { x1: c.x, y1: c.y, x2: c.x + c.dx, y2: c.y + c.dy, r: c.hitbox.radius };
}

/**
 * The x of the candidate's spine nearest `x`: the box's own `x` for a sphere, and
 * `x` itself when the spine spans it. Which end a script writes first is no
 * part of where a capsule is, so the side of a shield a capsule reaches is read
 * from here and not from `c.x` (Plan 3, Task 17).
 */
function nearestX(c: Candidate, x: number): number {
  return clamp(x, Math.min(c.x, c.x + c.dx), Math.max(c.x, c.x + c.dx));
}

/** Key a candidate occupies when picking one winner per source, per victim. */
function candidateKey(c: Candidate): number {
  // Each projectile competes on its own, so two arrows both connect; a fighter's
  // own overlapping hitboxes compete with each other, so only the tipper lands.
  return c.projectile === null ? c.attacker : 1000 + c.projectile.instanceId;
}

/**
 * Advance the simulation one frame.
 *
 * Returns a new state — the caller's is untouched, which is rule 4 of SPEC §3
 * and the reason a rollback can hold on to a snapshot and trust it.
 */
export function step(
  state: GameState,
  inputs: readonly InputFrame[],
  opts: StepOptions = {},
): { state: GameState; events: StepEvents } {
  const ctx = opts.ctx ?? registryContext;
  const s = cloneState(state);
  const events = emptyEvents();
  const stage = ctx.stage(s.stageId);
  // A Kirby with a Copy Ability runs the copied neutral special (Plan 5, Task 9).
  const defs = s.fighters.map((f) => {
    const def = ctx.fighter(f.defId);
    return f.combat.copy === "" ? def : withCopyAbility(def, ctx.fighter(f.combat.copy));
  });
  const bones = ctx.bones ?? LEGACY_BONE_TABLE;
  const bake = ctx.bake ?? LEGACY_BAKE;
  // A fighter's ECB this frame: from its bones (Plan 4), or Plan 2's box without a bake.
  // One body for every reader: the collision, the SDI clamp, the ledge grab and the trump.
  const ecbFor = (i: number, f: FighterState): Ecb => bakedEcb(defs[i], f, s.frame, bake, bones) ?? ecbOf(f, defs[i].attributes);
  const prevInputs = opts.prevInputs ?? inputs;

  s.frame += 1;

  /* -- 1. hitlag and global freeze ---------------------------------------- */

  if (s.freezeFrames > 0) {
    s.freezeFrames -= 1;
    return { state: s, events };
  }

  // Where each hitbox was last frame, for the swept test in phase 6.
  const prevPos = s.fighters.map((f) => ({ x: f.x, y: f.y }));

  /* -- 2. inputs become intent -------------------------------------------- */

  const intents: Intent[] = [];
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    const input = inputs[i] ?? 0;
    const prev = prevInputs[i] ?? 0;
    updateInputTracking(f, input, prev);
    intents.push(interpretInput(f, input, prev));
  }

  const stateCtx = (i: number): StateContext => ({
    def: defs[i],
    stage,
    frame: s.frame,
    fighters: s.fighters,
  });

  /* -- 3. action state machines ------------------------------------------- */

  // Whether a fighter was frozen *this* frame, decided once. Reading `hitlag > 0`
  // again in phases 4 and 5 would let a fighter whose hitlag expired this frame
  // move without its state machine having run, which is a one-frame teleport.
  const frozen: boolean[] = new Array(s.fighters.length).fill(false);
  // The animation frame each move was on before this tick. A charging smash
  // *holds* its frame, so without this a move whose projectile spawns on the
  // charge frame would launch one every frame of the charge. A move *entered*
  // this tick is told apart from a held frame by `frozen` (see `spawnDueProjectiles`).
  const beforeActionFrame = s.fighters.map((f) => f.actionFrame);

  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    const intent = intents[i];

    // Tech input counts on every frame, frozen or not, before anything else in
    // this phase, so phase 5's collision sees a press made on the frame of
    // landing itself (Plan 3, Task 12).
    updateTechInput(f, intent);

    // Before the hitlag branch on purpose: these count down through a freeze,
    // so a fighter hit off a ledge serves its lockout during the hitlag too.
    if (f.intangible > 0) f.intangible -= 1;
    if (f.combat.grabImmune > 0) f.combat.grabImmune -= 1;
    // The Copy Ability's grace counts up to its end and stops (Plan 5, Task 9); a
    // loss waiting on the copied special (`COPY_LOSS_PENDING`, negative) does not count.
    if (f.combat.copy !== "" && f.combat.copyFrames >= 0 && f.combat.copyFrames < COPY_GRACE_FRAMES) f.combat.copyFrames += 1;
    if (f.invincible > 0) f.invincible -= 1;
    if (f.ledgeLockout > 0) f.ledgeLockout -= 1;

    if (f.hitlag > 0) {
      // Frozen on contact. The only thing a victim may do is SDI — one pulse
      // per fresh direction press, at most one every four frames — which is why
      // mashing during the crunch works exactly as it does in the real game. Only
      // the victim: an attacker frozen by its own hit stands still, whatever the
      // stick says (`CombatState.victimFreeze`; Plan 3 final wave).
      f.hitlag -= 1;
      frozen[i] = true;
      // A move's own intangible frames are its animation's, and a freeze holds
      // the animation on its frame (SmashWiki "Hitlag",
      // https://www.ssbwiki.com/Hitlag: the attacker is frozen "in the frame when
      // they landed the hit"), so they hold too: the countdown above ticks
      // through a freeze, and `advanceFighter`, which re-asserts the window, does
      // not run in one (Plan 5, Task 5 fix round 1).
      updateDodgeIntangibility(f, defs[i]);
      // A held fighter's grab time runs, and it can still mash out of the grab,
      // during the freeze of a pummel (`struggleInGrab`; Plan 5, Task 7 fix round
      // 1: the frame counts too, where Plan 3 Task 14 stopped the clock). So does
      // a carried one's (Plan 5, Task 8: the carry's struggle is the grab's).
      if ((f.action === "grabbed" || f.action === "cargoHeld") && f.grabbedBy >= 0) struggleInGrab(f, intent, stateCtx(i));
      const shiftedFromX = f.x;
      const shiftedFromY = f.y;
      if (intent.sdiX !== 0 || intent.sdiY !== 0) {
        const pulse = sdiDistance(f);
        f.x += intent.sdiX * pulse;
        f.y += intent.sdiY * pulse;
      }
      // ...and then, on the frame the freeze ends, the launch it was holding
      // back finally happens — bent by whichever direction is held *now*. The
      // fighter stays frozen for the rest of this frame, so the velocity first
      // applies on the next one, exactly as it did when it was set on contact.
      //
      // In four steps, in this order (Plan 3 final wave; the final review's
      // Important 1, Task 19 re-review N2): the automatic SDI shift; the clamp
      // that keeps SDI and ASDI out of the stage's solid bodies (Task 11), since a
      // frozen fighter skips the collision phase below; the ground re-check, as
      // the shift may have carried a grounded victim off its platform; and only
      // then the launch, which reads where the victim really is: a 367° pull aims
      // from the clamped position, and a downward launch bounces off the floor
      // only if the victim is still standing on one.
      const releasing = f.hitlag === 0 && f.pendingFacing !== 0;
      if (releasing) applyAsdi(f, intent);
      clampShiftToStage(f, shiftedFromX, shiftedFromY, stage, defs[i].attributes, s.frame, ecbFor(i, f));
      if (releasing) {
        leaveGroundIfShiftedOff(f, stage, s.frame);
        releasePendingLaunch(f, intent);
      }
      if (f.hitlag === 0) f.combat.victimFreeze = false;
      continue;
    }

    if (f.hitstun > 0) f.hitstun -= 1;
    // A string of hits is over once the fighter is out of hitstun (SDI ×1.15, Task 11).
    if (f.hitstun === 0) f.combat.comboHits = 0;
    // The balloon classification belongs to one launch and dies with it, so the
    // next hit is free to classify itself. Clearing it here rather than leaving
    // it stale keeps the field honest in the desync hash.
    if (f.hitstun === 0) f.balloon = false;
    if (!f.grounded && f.ledge === null) f.airTime += 1;

    const before = f.action;
    advanceFighter(f, intent, stateCtx(i));
    if (before === "jumpSquat" && f.action === "jump") {
      events.jumps.push({ port: f.port, x: f.x, y: f.y });
    }
  }

  // A fighter whose status is not a holding one has let go, whatever its link
  // says: a clank cancels a pummel and leaves `grabbing` set, and carrying the
  // victim from then on drags it off the stage with the captor (Plan 3, Task 14).
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (f.grabbing >= 0 && f.action !== "dead" && !isHolding(f, defs[i])) releaseHeld(f, s.fighters);
  }

  /* -- 4. physics ---------------------------------------------------------- */

  const preIntegrate = s.fighters.map((f) => ({ x: f.x, y: f.y }));
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.action === "dead") continue;
    // A held fighter has no movement of its own: it is carried (5b below), and a
    // spat one rides its star (phase 6; Plan 5, Task 9).
    if (captorOf(s, f) !== null || f.action === "spatStar") continue;
    applyMovement(f, intents[i], stateCtx(i));
    preIntegrate[i] = { x: f.x, y: f.y };
    integrate(f);
  }

  /* -- 5. platforms and ledges --------------------------------------------- */

  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.action === "dead" || f.action === "respawnPlatform") continue;
    if (f.ledge !== null) continue; // hanging: the ledge holds you, not the floor
    if (captorOf(s, f) !== null) continue; // held: the captor's floor is all it touches
    if (f.action === "spatStar") continue; // riding a star: where it flies, it goes

    const before = launchBefore(f);
    // The ECB from this frame's bones (Plan 4), or Plan 2's box without a bake.
    const ecb = ecbFor(i, f);
    const outcome = resolveCollision(
      f,
      preIntegrate[i].x,
      preIntegrate[i].y,
      stage,
      defs[i].attributes,
      s.frame,
      // The catch statuses stop at the edge instead of walking off it.
      { cliffStop: isCatchStatus(f.action), ecb },
    );
    // A tumbling body that meets a surface techs or bounces (Plan 3, Task 12);
    // otherwise a landing is a landing — a missed tech lies down in `onLanded`.
    const surface = outcome.landed ? "floor" : outcome.ceiling ? "ceiling" : outcome.wall !== 0 ? "wall" : null;
    const reaction = surface === null ? null : techOrBounce(f, surface, before, intents[i], outcome.wall);
    if (outcome.landed) {
      if (reaction === null) onLanded(f, stateCtx(i));
      // A bounce leaves the floor again at once: it touched down, but did not land.
      if (reaction !== "bounce") events.lands.push({ port: f.port, x: f.x, y: f.y });
    } else if (outcome.leftGround) {
      onLeftGround(f);
    }

    // Hands full: a carrier, or a thrower in a cargo throw it began in the air, takes
    // no ledge (Plan 5, Task 8; a throw on the ground never reaches here); nor does
    // a full mouth, or the one held would be left in it on the ledge (Task 9).
    // UNVERIFIED: no source says whether any of them can take one.
    if (!f.grounded && f.action !== "cargoCarry" && f.action !== "throw" && !holdsMouthful(f, defs[i])) {
      const grab = findLedgeGrab(f, stage, s.frame, ecb.half, s.fighters);
      if (grab !== null) {
        const pos = ledgePosition(stage, grab, s.frame);
        const frames =
          f.ledgeRegrabs >= LEDGE_REGRAB_LIMIT
            ? 0
            : ledgeIntangibilityFrames(f.airTime, f.damage, f.ledgeRegrabs);
        // A fighter hanging on it is trumped off it (Plan 3, Task 15; SmashWiki "Ledge
        // trump", https://www.ssbwiki.com/Ledge_trump). Phase 6 comes after, so a grab that
        // reaches the fighter trumped here still lands on it, and then the held fighter is
        // placed at its captor (5b).
        //
        // Only a HANGING fighter: one in a ledge option still has `ledge` set, but
        // `findLedgeGrab` has already shut the ledge to us while it is, so the test below
        // is that same rule stated where the trump decides its target (SmashWiki "Ledge
        // trump": buffering an attack, a jump or a roll "the moment it is grabbed" avoids the
        // trump). UNVERIFIED: that reading, and above all for a regular getup: the page
        // names only an attack, a jump and a roll, and says "a regular getup and dropping
        // from the ledge cannot be buffered, making it much easier to trump someone
        // attempting these ledge options". Here a getup's performer is exempt like the rest.
        //
        // UNVERIFIED: two fighters taking one free ledge on the same frame. The ports are
        // handled in order, so the later one trumps the earlier, which hung for no frames. That
        // grab's `ledgeRegrabs` count stays: a trump never touches it, however long the
        // fighter hung.
        for (let j = 0; j < s.fighters.length; j++) {
          const other = s.fighters[j];
          if (j === i || other.ledge === null || other.action !== "ledgeHang") continue;
          if (other.ledge.platform !== grab.platform || other.ledge.side !== grab.side) continue;
          // Clear of the stage by its own ECB's half-width and a unit: its bones', with a bake (ruling R6).
          trumpLedge(other, ecbFor(j, other).half + ONE);
        }
        grabLedge(f, grab.platform, grab.side, pos.x, pos.y, frames);
      }
    }
  }

  /* -- 5b. a held fighter stays with its captor ------------------------------ */

  // After phase 5, so the captor's position for the frame is final whatever the
  // port order, and before the hit phase, so the box a pummel or a throw is
  // measured from is where the victim is.
  // A fighter carried rides on top of its carrier instead (Plan 5, Task 8: `held.ts`),
  // and one swallowed is inside Kirby: where he is, with no gap (Task 9).
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    const captor = f.action === "dead" ? null : captorOf(s, f);
    if (captor === null || ridesCaptor(f, captor)) continue;
    const inside = f.action === "swallowed";
    const captorHalf = inside ? 0 : bodyHalf(defs[captor.port], bake, bones);
    holdAtCaptor(f, captor, captorHalf, inside ? 0 : bodyHalf(defs[i], bake, bones), stage, s.frame);
  }
  pinHeldFighters(s, (captor) => bodyTop(defs[captor.port], bake, bones));

  /* -- 6. hitboxes: gather, clank, connect --------------------------------- */

  // Projectiles fly, then this frame's launches join them, then everything —
  // fists and arrows alike — goes through one clank pass and one hit pass.
  const projectilePrev = advanceProjectiles(s, ctx, stage);
  spawnDueProjectiles(s, defs, beforeActionFrame, frozen, projectilePrev);
  // A swallow or a spit lets its mouthful out, onto this frame's star for a spit,
  // and a star nobody rides is gone (Plan 5, Task 9).
  resolveInhaleReleases(s, defs, (id) => ctx.fighter(id), frozen, beforeActionFrame, events);
  carryOutStarRiders(s, (id) => ctx.fighter(id), stage);
  dropRiderlessStars(s, (p) => projectileDefOf(ctx, p)?.ridden === true);

  const destroyed = new Set<number>();
  const candidates = gatherHitboxes(s, defs, prevPos, frozen, bones);
  appendProjectileCandidates(s, ctx, candidates, projectilePrev);
  // Reflectors first: a reflected projectile neither clanks nor hits this frame (Plan 5).
  reflectProjectiles(s, defs, (p) => projectileDefOf(ctx, p), candidates, events, destroyed);
  resolveClanks(s, candidates, events, destroyed);
  resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed);
  resolveThrows(s, defs, frozen, beforeActionFrame, intents, events);
  if (destroyed.size > 0) {
    s.projectiles = s.projectiles.filter((p) => !destroyed.has(p.instanceId));
  }

  /* -- 7. shields ---------------------------------------------------------- */

  for (const f of s.fighters) {
    const shielding =
      f.action === "shield" || f.action === "shieldStart" || f.action === "shieldStun";
    if (shielding) {
      f.shieldHealth -= SHIELD_DECAY_PER_FRAME;
      if (f.shieldHealth <= 0) {
        f.shieldHealth = 0;
        startAction(f, "shieldBroken");
        f.hitstun = shieldBreakStun(f.damage);
        events.shieldBreaks.push(f.port);
      }
    } else if (f.action !== "shieldBroken" && f.shieldHealth < SHIELD_MAX_HEALTH) {
      // A broken shield does not regrow during the stun; it comes back at 37.5
      // when the stun ends (FURAFURA, SmashWiki "Shield break").
      f.shieldHealth = Math.min(SHIELD_MAX_HEALTH, f.shieldHealth + SHIELD_REGEN_PER_FRAME);
    }
  }

  /* -- 8. the Smash Ball --------------------------------------------------- */

  if (s.rules.smashBall) updateSmashBall(s);

  /* -- 9. blast zones ------------------------------------------------------ */

  for (const f of s.fighters) {
    if (f.action === "dead" || f.hitlag > 0) continue;
    // A Kirby with a mouthful meets his blast lines 4 units sooner, ahead and below
    // (Plan 5, Task 9: SmashWiki "Kirby (SSBU)/Neutral special"), so in a Kirbycide he goes first.
    const ko = blastZoneKO(f, stage, holdsMouthful(f, defs[f.port]) ? HOLD_BLAST_REACH : 0);
    if (ko === null) continue;
    events.kos.push({ port: f.port, x: f.x, y: f.y, kind: ko });
    f.stocks -= 1;
    f.damage = 0;
    kineticClear(f);
    f.hitstun = 0;
    f.hitlag = 0;
    f.combat.victimFreeze = false;
    f.balloon = false;
    clearPendingLaunch(f);
    f.grounded = false;
    f.platform = -1;
    f.ledge = null;
    f.ledgeRegrabs = 0;
    f.ledgeLockout = 0;
    // Both ends, in both directions: a KO'd fighter may have been holding
    // someone *or* be held by someone, and clearing only its own half of the
    // link strands the other fighter in `grabbed` for the rest of the match.
    releaseGrab(f, s.fighters);
    f.shieldHealth = SHIELD_MAX_HEALTH;
    f.staleQueue.length = 0;
    f.combat.staleShield.length = 0;
    // Nothing of the lost stock's struggles, launches or swings rides into the
    // respawn: a mash credit left over shortened the next shield-break stun by a
    // frame (Plan 3 final wave; codex P2-1, the final review's Minor 6).
    f.combat.mash = 0;
    f.combat.launchSource = -1;
    f.combat.swingQueued = false;
    // A stored charge goes with the stock (Plan 5): SmashWiki "Charge"
    // (https://www.ssbwiki.com/Charge) notes surviving a KO only for Oil Panic
    // and Wario Waft ("Charge can be held even after ... is KO'd").
    f.combat.storedCharge = 0;
    // A new stock is a new airtime: its one special stall is back (Plan 5).
    f.combat.specialStall = false;
    // A KO costs Kirby his Copy Ability (Plan 5, Task 9: SmashWiki "Copy Ability",
    // "he will also lose it upon being KO'd").
    loseCopy(f);
    clearHitRecord(f);
    startAction(f, "dead");
    s.freezeFrames = KO_FREEZE_FRAMES;
  }
  // What a lost Copy Ability spawned vanishes with it (Plan 5, Task 9).
  dropLostCopies(s);

  /* -- 10. is the match over? ---------------------------------------------- */

  if (s.rules.mode === "time" && s.timeRemaining > 0) {
    s.timeRemaining -= 1;
  }
  if (s.outcome === null) s.outcome = resolveOutcome(s);

  return { state: s, events };
}

/* ---------------------------------------------------------------- holding -- */

/**
 * The fighter holding `f`, when the link is whole at both ends; null otherwise
 * (not grabbed, or a stale index: `releaseGrab` guards the same way).
 */
function captorOf(s: GameState, f: FighterState): FighterState | null {
  if (f.grabbedBy < 0) return null;
  const captor = s.fighters[f.grabbedBy];
  return captor !== undefined && captor.grabbing === f.port ? captor : null;
}

/**
 * Put a held fighter at its captor, facing it, standing wherever the captor
 * stands, with no motion of its own (Plan 3, Task 14).
 *
 * UNVERIFIED: where a held fighter stands. SmashWiki "Grab" says only that "the
 * opponent is immobilized"; in the game the victim is pulled to the grabber's
 * hand (CAPTURE_PULLED, then CAPTURE_WAIT attached to the `throw` joint). The
 * stand-in: bodies touching, in front of the captor, `captorHalf + half` apart:
 * the two fighters' standing ECB half-widths from the bake (Plan 4, ruling R7:
 * a body's size is its bones'), or the legacy `attributes.width` of one the
 * bake does not cover (`bodyHalf`). Placing it at the captor's baked `throw`
 * joint every frame is carried to Plan 5. The pummel and throw boxes are
 * catch-only (no geometry test), so the distance moves no hit.
 *
 * Standing where the captor stands counts as touching the ground, if there is
 * ground there: a victim over the captor's platform is grounded on it, and a
 * fighter caught in the air gets its ground jump, its air dodge and its special
 * stall back, as a landing gives them (UNVERIFIED for the air dodge: SmashWiki
 * "Air dodge" lists "land"; and for the stall: SmashWiki "Fox (SSBU)" says
 * "until he lands or gets hit"). A victim held past the edge (the captor at the
 * lip, facing out) is held in the air: not grounded, so no restore, and a
 * release leaves it to fall.
 * It is placed, so gravity never moves it, and it is not "in the air" for the
 * ledge's airtime bonus either (`airTime` stays 0 while held). UNVERIFIED: that
 * last part; SmashWiki "Ledge" counts the time in the air before a grab, and no
 * source says what being held does to it. Positions are written, not velocities:
 * `kineticSet` re-sums the energies.
 */
function holdAtCaptor(
  f: FighterState,
  captor: FighterState,
  captorHalf: number,
  half: number,
  stage: StageDef,
  frame: number,
): void {
  const ahead = captor.facing >= 0 ? 1 : -1;
  f.x = captor.x + ahead * (captorHalf + half);
  f.y = captor.y;
  const platform = captor.grounded ? stage.platforms[captor.platform] : undefined;
  const over = platform !== undefined && Math.abs(f.x - platformCentreX(platform, frame)) <= platform.halfWidth;
  f.grounded = over;
  f.platform = over ? captor.platform : -1;
  f.ledge = null;
  f.facing = -ahead;
  f.airTime = 0;
  kineticSet(f, 0, 0);
  if (over) {
    f.jumpsUsed = 0;
    f.airDodged = false;
    f.combat.specialStall = false;
  }
}

/**
 * How wide a fighter's body is to either side, standing: its standing ECB's
 * half-width from the bake (`restEcb`, Plan 4), or Plan 2's `attributes.width`
 * without one.
 */
function bodyHalf(def: FighterDef, bake: BakeTables, bones: BoneTable): number {
  return restEcb(def, bake, bones)?.half ?? def.attributes.width;
}

/** How tall a fighter's body stands: the top of `restEcb`, or Plan 2's `attributes.height` (Plan 5, Task 8). */
function bodyTop(def: FighterDef, bake: BakeTables, bones: BoneTable): number {
  return restEcb(def, bake, bones)?.top ?? def.attributes.height;
}

/* ------------------------------------------------------------- hit phases -- */

function gatherHitboxes(
  s: GameState,
  defs: readonly FighterDef[],
  prevPos: readonly { x: number; y: number }[],
  frozen: readonly boolean[],
  bones: BoneTable,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.move === null) continue;
    if (!hasLiveMove(f.action)) continue;
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    // `AttackModule::clear_all` ends the swing's hit record with its boxes, so a
    // box the script issues again can hit again — how a multi-hit works. Legacy
    // moves only ever clear by id, and keep one hit per swing (Plan 3, Task 16).
    if (run.state.fired.some((cmd) => cmd.op === "clearAll")) clearHitRecord(f);
    const live = scriptHitboxes(run.state, defs[i].id, run.script.motion, run.gameFrame, bones);
    // A charged special's boxes grow towards their full-charge values (Plan 5);
    // a smash's charge stays the damage multiplier it always was.
    const sc = defs[i].moves[f.move]?.specialCharge;
    const chargeT = sc === undefined ? 0 : chargeFraction(f.charge, sc.frames);
    // A counterattack deals what its counter caught (Plan 5, Task 5; `counter.ts`).
    const countered = defs[i].moves[f.move]?.counterDamage === true;
    for (const raw of live) {
      const charged = sc === undefined ? raw : chargedHitbox(raw, sc.full?.[raw.id], chargeT, sc.partial);
      const hb = countered ? { ...charged, damage: f.combat.counterDamage } : charged;
      const now = hitboxWorldPos(f.x, f.y, f.facing, hb);
      const was = hitboxWorldPos(prevPos[i].x, prevPos[i].y, f.facing, hb);
      // The far end mirrors with facing exactly as the near end does.
      const far =
        hb.x2 === undefined || hb.y2 === undefined
          ? now
          : hitboxWorldPos(f.x, f.y, f.facing, { x: hb.x2, y: hb.y2 });
      out.push({
        attacker: i,
        hitbox: hb,
        x: now.x,
        y: now.y,
        prevX: was.x,
        prevY: was.y,
        dx: far.x - now.x,
        dy: far.y - now.y,
        slot: f.move,
        projectile: null,
        chargeScale: f.action === "attack" ? chargeMultiplier(f.charge) : ONE,
        destroyOnHit: false,
        onlyPort: run.state.catchOnly ? f.grabbing : null,
        damageMul: defs[i].moves[f.move]?.copyDamage ?? ONE,
        suppressed: false,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------- projectiles -- */

type PrevPositions = Map<number, { x: number; y: number }>;

/**
 * A projectile's definition, from the fighter whose moveset holds it (`source`)
 * rather than from whoever owns it now (Plan 5: reflectors, Kirby's copy).
 */
function projectileDefOf(ctx: SimContext, p: ProjectileState): ProjectileDef | undefined {
  return findProjectileDef(ctx.fighter(p.source), p.defId);
}

/**
 * Fly every projectile one frame and drop the ones that ran out of life, stage
 * or bounces. Returns where each was before it moved, for the swept hit test.
 */
function advanceProjectiles(s: GameState, ctx: SimContext, stage: StageDef): PrevPositions {
  const prev: PrevPositions = new Map();
  if (s.projectiles.length === 0) return prev;
  const survivors: ProjectileState[] = [];
  for (const p of s.projectiles) {
    const def = projectileDefOf(ctx, p);
    if (def === undefined) continue;
    const owner = s.fighters[p.owner] ?? null;
    const moved = advanceProjectile(p, def, stage, owner, s.frame);
    prev.set(p.instanceId, { x: moved.prevX, y: moved.prevY });
    // A spat fighter rides its star, and is let go when it is gone (Plan 5, Task 9).
    if (def.ridden === true) carryStarRider(s, p, moved.alive, stage);
    if (moved.alive) survivors.push(p);
  }
  s.projectiles = survivors;
  return prev;
}

/**
 * Whether `f`'s status was entered this tick, so its `actionFrame` 0 is a first
 * frame rather than a held one. `advanceFighter` counts `actionFrame` up before a
 * status runs, a held charge pins it at 1 or later (`chargeHoldFrame`), and only
 * `changeStatus` writes 0: so a fighter that was not frozen this tick and is on
 * frame 0 entered its status this tick, whatever frame it left — including 0,
 * for a status entered the tick before (Plan 3, Task 18).
 */
function enteredThisTick(f: FighterState, frozen: boolean): boolean {
  return !frozen && f.actionFrame === 0;
}

/** Launch anything whose move reached its spawn frame this tick. */
function spawnDueProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  beforeActionFrame: readonly number[],
  frozen: readonly boolean[],
  prev: PrevPositions,
): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (f.move === null) continue;
    if (!hasLiveMove(f.action)) continue;
    // A held charge freezes the animation frame, and so does hitlag, and the
    // script lists the same `fired` spawns every time a held frame is re-run;
    // nothing may spawn off a frame the move did not actually advance onto. A
    // move entered this tick is on a new frame even when the status it left was
    // also on frame 0, so entry is asked separately from the frame comparison.
    if (f.actionFrame === beforeActionFrame[i] && !enteredThisTick(f, frozen[i])) continue;
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    for (const cmd of run.state.fired) {
      if (cmd.op !== "spawnProjectile") continue;
      // The script says which and when; what flies is still the move's `ProjectileDef`.
      const def = findProjectileDef(defs[i], cmd.id);
      if (def === undefined) continue;
      const move = defs[i].moves[f.move];
      const sc = move?.specialCharge;
      // A copied neutral special fires the copied fighter's projectile, at its ×1.2
      // (Plan 5, Task 9, ruling R-T9a): its definition is looked up by `source`.
      const source = f.combat.copy !== "" && f.move === "neutralB" ? f.combat.copy : defs[i].id;
      const p = spawnProjectile(def, f, s.nextProjectileId, source, sc?.frames, spawnDamageMul(move));
      s.nextProjectileId += 1;
      s.projectiles.push(p);
      prev.set(p.instanceId, { x: p.x, y: p.y });
    }
  }
}

/** Add every live projectile hitbox to the same candidate list as the fists. */
function appendProjectileCandidates(
  s: GameState,
  ctx: SimContext,
  candidates: Candidate[],
  prev: PrevPositions,
): void {
  for (const p of s.projectiles) {
    const def = projectileDefOf(ctx, p);
    if (def === undefined || !projectileHitboxActive(p, def)) continue;
    const was = prev.get(p.instanceId) ?? { x: p.x, y: p.y };
    const hitbox = projectileHitbox(p, def);
    const offsetX = p.facing >= 0 ? hitbox.x : -hitbox.x;
    candidates.push({
      attacker: p.owner,
      hitbox,
      x: p.x + offsetX,
      y: p.y + hitbox.y,
      prevX: was.x + offsetX,
      prevY: was.y + hitbox.y,
      dx: 0,
      dy: 0,
      slot: null,
      projectile: p,
      chargeScale: p.chargeScale,
      destroyOnHit: def.destroyOnHit === true,
      onlyPort: null,
      damageMul: p.damageMul,
      suppressed: false,
    });
  }
}

/**
 * Opposing hitboxes that met this frame.
 *
 * Both are suppressed for the frame whatever the outcome, so a clank is never
 * also a hit — the loser's move is cancelled outright, and on a rebound both
 * fighters are pushed back and returned to neutral.
 */
function resolveClanks(
  s: GameState,
  candidates: Candidate[],
  events: StepEvents,
  destroyed: Set<number>,
): void {
  // A projectile already suppressed when this pass starts was reflected this
  // frame (`reflectProjectiles`, phase 6a): it neither clanks nor hits until the
  // next (Plan 5). Nothing else suppresses a candidate before the clanks.
  const reflected = new Set(candidates.filter((c) => c.projectile !== null && c.suppressed));
  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const ca = candidates[a];
      const cb = candidates[b];
      if (ca.attacker === cb.attacker) continue;
      if (reflected.has(ca) || reflected.has(cb)) continue;
      // A catch-only box (`set_catch_only_all`: a pummel's, a throw's hits on the
      // fighter held) is not a hitbox in the world: nothing clanks with it.
      if (ca.onlyPort !== null || cb.onlyPort !== null) continue;
      if (ca.suppressed && cb.suppressed) continue;
      if (!capsulesOverlap(capsuleOf(ca), capsuleOf(cb))) continue;
      const outcome = resolveClank(ca.hitbox, cb.hitbox);
      if (outcome === "none") continue;

      ca.suppressed = true;
      cb.suppressed = true;
      events.clanks.push({
        x: Math.trunc((ca.x + cb.x) / 2),
        y: Math.trunc((ca.y + cb.y) / 2),
      });
      if (outcome === "rebound" || outcome === "bWins") loseClank(s, ca, destroyed);
      if (outcome === "rebound" || outcome === "aWins") loseClank(s, cb, destroyed);
    }
  }
  // A move cancelled by a clank keeps no live hitboxes for the rest of the frame.
  for (const c of candidates) {
    if (c.projectile !== null) {
      if (destroyed.has(c.projectile.instanceId)) c.suppressed = true;
      continue;
    }
    const f = s.fighters[c.attacker];
    if (!hasLiveMove(f.action)) c.suppressed = true;
  }
}

/** Losing a clank ends a swing and deletes a projectile. */
function loseClank(s: GameState, c: Candidate, destroyed: Set<number>): void {
  if (c.projectile !== null) {
    destroyed.add(c.projectile.instanceId);
    return;
  }
  // The rebound: the attack ends and the fighter is pushed back a little.
  const f = s.fighters[c.attacker];
  kineticSetX(f, -f.facing * fx(0.5));
  clearHitRecord(f);
  startAction(f, f.grounded ? "stand" : "fall");
}

function isSmashSlot(slot: MoveSlot): boolean {
  return SMASH_SLOTS.includes(slot);
}

function isAerialSlot(slot: MoveSlot): boolean {
  return AERIAL_SLOTS.includes(slot);
}

/**
 * Damage, knockback, hitstun, hitlag — the frame a hit actually lands.
 *
 * One swing hits one target once (`hitThisMove`), the lowest-id hitbox wins among
 * an attacker's own overlapping ones, and a hit that reaches a raised shield goes
 * down the shield path instead, where a parry freezes the attacker longer than
 * the defender (`perfectShieldHitlag`).
 */
function resolveHits(
  s: GameState,
  defs: readonly FighterDef[],
  bake: BakeTables,
  bones: BoneTable,
  candidates: readonly Candidate[],
  intents: readonly Intent[],
  events: StepEvents,
  destroyed: Set<number>,
): void {
  for (let v = 0; v < s.fighters.length; v++) {
    const victim = s.fighters[v];
    if (victim.action === "dead" || victim.action === "entering") continue;
    // One capsule per bone from the bake (Plan 4), else Plan 2's single capsule.
    const hurtboxes = fighterHurtboxes(defs[v], victim, s.frame, bake, bones) ?? [hurtboxCapsule(victim, defs[v].attributes)];
    /** How deep `c` reaches the body at its deepest, and on which capsule. */
    const reachOf = (c: Candidate) => deepestReach(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, hurtboxes);
    /**
     * Whether `c` reaches the body: any capsule (Plan 4: one per bone), and
     * deeper than a graze. A box that only grazes the body — less than 0.1 deep —
     * is a glancing blow: no hit, and the swing is not spent (Plan 3, Task 13). It
     * is skipped before the lowest-id pick, so it cannot shadow a deeper box of the
     * same source. With a bake the body is a capsule per bone, and the depth is
     * the deepest any of them is reached (Plan 4): a box that grazes an arm on its
     * way into the chest hits. UNVERIFIED: that a grab, or a hit that reaches a
     * raised shield, is exempt. SmashWiki "Glancing blow" says nothing of either,
     * so this is a choice, not a rule: they keep the plain overlap test they
     * always had (a grab stays as reliable as it was, a shield is poked as it
     * was). D56 lists it under Open questions.
     */
    const reachesBody = (c: Candidate): boolean =>
      hurtboxes.some((h) => sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, h)) &&
      (reachOf(c).depth >= GLANCING_BLOW_DEPTH || c.hitbox.grabbing === true || hitReachesShield(victim, defs[v], c));
    // A counter out (Plan 5, Task 5): its bubble catches whatever reaches it but
    // a grab, which goes through to the body (`counter.ts`), and a windbox (Task
    // 6), which pushes the countering fighter as it would anyone. UNVERIFIED for
    // the windbox: no source says either way (SmashWiki "Windbox", "F.L.U.D.D.",
    // "Mario (SSBU)/Down special" and "Counterattack" are silent), and a 0% push
    // has nothing for a counter to return. `caught` holds the candidates that
    // reached the bubble, whether or not they reach the body.
    const counter = activeCounter(victim, defs[v]);
    const bubble = counter === null ? null : counterBubble(victim, counter);
    const caught = new Set<Candidate>();

    // Per source, the lowest-id hitbox that reaches this victim.
    const perSource = new Map<number, Candidate>();
    for (const c of candidates) {
      if (c.suppressed || c.attacker === v) continue;
      // Ground-only and air-only boxes (`COLLISION_SITUATION_MASK_G`/`_A`). A held
      // victim is grounded only over its captor's platform (`holdAtCaptor`), so a
      // throw's mask reads that.
      if (c.hitbox.situation === "ground" && !victim.grounded) continue;
      if (c.hitbox.situation === "air" && victim.grounded) continue;
      if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
      // A windbox leaves a fighter on a ledge alone (Plan 5, Task 6): SmashWiki
      // "Windbox" (https://www.ssbwiki.com/Windbox), "characters hanging from a
      // ledge are not affected". It is not spent on them, and passes on.
      // UNVERIFIED: the ledge's getup, roll, attack and jump too, which hold the
      // ledge (`ledge`) until they end, pinned to it as the hang is.
      if (c.hitbox.windbox === true && victim.ledge !== null) continue;
      // Kirby's Inhale catches nobody on a ledge (ruling P5-R11: the Inhale alone; an
      // ordinary grab still pulls a hanging fighter off, D56), no Kirby with someone
      // in his mouth, and nobody once its own mouth is full (Plan 5, Task 9: `inhaleMayCatch`).
      if (c.hitbox.grabbing === true && isInhale(defs[c.attacker], c) && !inhaleMayCatch(s.fighters[c.attacker], victim, defs[v])) continue;
      if (!unrecorded(c) && recordSaysAlreadyHit(s, c, victim.port)) continue;
      // Ruling P5-R8: a captor's box that is not catch-only leaves the fighter it
      // holds alone, and hits anyone else it reaches. SmashWiki "Throw"
      // (https://www.ssbwiki.com/Throw): "a few throws such as Mario's back throw
      // have collateral hitboxes, which can only hit bystanders and not the thrown
      // opponent" (`game_throwb` hangs an 8% `hip` box on frame 13 with no
      // `set_catch_only_all`, and lands the throw by `ATK_HIT_ABS` on 44).
      // UNVERIFIED: the rule for any captor's box, beyond the throws the page
      // names. Not a projectile, which has left its owner's move.
      if (c.onlyPort === null && c.projectile === null && captorOf(s, victim) === s.fighters[c.attacker]) continue;
      if (c.onlyPort !== null) {
        // Catch-only (a pummel, a throw's hits before its launch): the fighter
        // held, wherever the box is. Not geometry-tested: the game holds the
        // victim at the box, and a legacy box sits there only for some of the
        // roster (Plan 3, Task 14).
        if (c.onlyPort !== v || victim.grabbedBy !== c.attacker) continue;
      } else if (bubble !== null && !c.hitbox.grabbing && c.hitbox.windbox !== true && sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, bubble)) {
        caught.add(c);
      } else if (!reachesBody(c)) continue;
      const key = candidateKey(c);
      const incumbent = perSource.get(key);
      if (incumbent === undefined || c.hitbox.id < incumbent.hitbox.id) perSource.set(key, c);
    }

    // Sorted by key so two sources connecting on one frame resolve in the same
    // order on both peers — `Map` iteration order is insertion order, and
    // insertion order here depends on the candidate list.
    const ordered = Array.from(perSource.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c);
    for (const c of ordered) {
      const attacker = s.fighters[c.attacker];
      if (caught.has(c) && bubble !== null) {
        // The counter catches it (Plan 5, Task 5): the hit is spent and does
        // nothing to the fighter, who starts the counterattack frozen; a melee
        // attacker freezes with them ("freezes for 21 frames alongside the
        // opponent"). The caught damage is the box's own, before staleness
        // (SmashWiki "Stale Moves", https://www.ssbwiki.com/Stale_Moves: "Moves
        // that are counter-attacks or absorbers do not take the staleness of the
        // incoming attack into consideration") and before the one-on-one bonus
        // (SmashWiki "1v1 multiplier", https://www.ssbwiki.com/1v1_multiplier:
        // "It does not affect the damage received by counterattacks or
        // absorption moves"). UNVERIFIED: that a smash's charge counts (`c`'s
        // chargeScale): the pages name no charge. A projectile is consumed, and
        // its thrower does not freeze (UNVERIFIED for a counter: the engine's
        // rule for any projectile hit, its owner not a party to the contact).
        // UNVERIFIED: that one which survives its hits (`destroyOnHit` false) is
        // consumed too.
        const counterNow = activeCounter(victim, defs[v]);
        if (counterNow !== null) {
          recordHit(c, attacker, victim.port);
          const freeze = triggerCounter(victim, defs[v], counterNow, mul(c.hitbox.damage, c.chargeScale));
          if (c.projectile === null) freezeFighter(attacker, freeze);
          else destroyed.add(c.projectile.instanceId);
          const at = contactPoint(capsuleOf(c), bubble);
          events.counters.push({ port: victim.port, x: at.x, y: at.y });
          continue;
        }
        // Another source set the counter off earlier this frame: what reached
        // only the bubble misses, and what reaches the body meets the
        // counterattack's intangibility below.
        if (!reachesBody(c)) continue;
      }
      // Intangible: the fighter is not there, so there is nothing to hit — and
      // crucially the swing is *not* spent on them. Marking it here would mean a
      // lingering hitbox that met a dodge on its first active frame could never
      // connect on its last, even though the dodge ended in between. Spot dodge
      // is intangible frames 3-20 while plenty of moves stay active past frame
      // 20, so "dodged the first frame, immune to the rest" is a reachable and
      // wrong outcome that makes dodging strictly better than the real game's.
      if (victim.intangible > 0) continue;
      // Fresh out of a grab: grabs pass through, unspent, for 60 frames (Task 14).
      if (c.hitbox.grabbing === true && victim.combat.grabImmune > 0) continue;
      // Where the box met the body, for the spark: on the capsule it reached
      // deepest (ruling R9). A catch-only box is not tested, but it has one too.
      const contact = contactPoint(capsuleOf(c), hurtboxes[reachOf(c).index]);
      // A windbox only pushes (Plan 5, Task 6: `applyWindbox`), invincible victim
      // and raised shield included, so it goes first.
      if (c.hitbox.windbox === true) applyWindbox(attacker, victim, defs[v], c, events);
      // Invincible: the fighter *is* there and the hit connects. It is only the
      // consequences that do not land. See `FighterState.invincible`.
      else if (isInvincible(victim, defs[v])) applyInvincibleHit(attacker, victim, c, contact, events);
      // Catch-only: damage and a freeze, and the hold stays (Plan 5, Task 7).
      else if (c.onlyPort !== null) applyHeldHit(s, attacker, victim, c, contact, events);
      else {
        applyHit(s, attacker, defs[c.attacker], victim, defs[v], c, contact, intents[v], events);
        // `collision_attr_turn` (Mario's Cape, Plan 5): the victim is turned round
        // on contact, whatever else the hit does: a launch, a launch it cannot
        // replace (knockback stacking), armour, a shield. SmashWiki "Reverse"
        // (https://www.ssbwiki.com/Reverse_(effect)): "A fighter hit by a reverse
        // attack is forcibly turned around to face the opposite direction"; SmashWiki
        // "Cape" (https://www.ssbwiki.com/Cape): "Cape can even flip shielding
        // opponents". UNVERIFIED: through armour and a perfect shield (no source
        // says either way), and not through invincibility, whose hit has no effect.
        if (c.hitbox.reverse === true) victim.facing = -victim.facing;
      }
      if (c.destroyOnHit && c.projectile !== null) destroyed.add(c.projectile.instanceId);
    }
  }

  if (s.smashBall.active) resolveSmashBallHits(s, candidates, events);
}

/**
 * Throws (Plan 5, Task 7): what a throw's script fires on the frame it reaches,
 * in script order.
 *
 * - `REVERSE_LR()` turns the thrower round (ruling P5-R7): Samus's back throw on
 *   12, Mario's on 40, a legacy back throw on its `turnAt`. Everything the
 *   throw does after, its launch included, is the way the thrower then faces.
 * - `FT_CATCH_STOP(n, …)` stops both fighters, the one held invincible
 *   (fix round 1): SmashWiki "Marth (SSBU)/Forward throw"
 *   (https://www.ssbwiki.com/Marth_(SSBU)/Forward_throw), "During frame 14, the
 *   move inflicts 4 frames of hitlag to both Marth and the opponent, during which
 *   the opponent is invincible"; SmashWiki "Hitlag" (https://www.ssbwiki.com/Hitlag)
 *   says the same of his back and down throws. The n frames count the frame it
 *   fires on, as every freeze does (`framesAfterHit`), so the move stands n − 1
 *   frames more: UFD's 18, 19 and 20 for Marth's forward, back and down throws
 *   are the scripts' releases 15, 16 and 16 plus 3, 3 and 4
 *   (https://ultimateframedata.com/marth). No damage and no hit, so nothing is
 *   reported.
 * - A catch-only box issued and cleared on one frame (`flashed`) is registered
 *   in part on the fighter held: the freeze of its hit on both fighters, and
 *   nothing else (fix round 1). SmashWiki "Pikachu (SSBU)/Down throw"
 *   (https://www.ssbwiki.com/Pikachu_(SSBU)/Down_throw): the box is "set to
 *   both appear and be deleted on frame 14", and "the hit is only partially
 *   registered on the thrown opponent, causing hitlag but not any damage or
 *   graphical effects". UNVERIFIED: that it freezes Pikachu too; UFD's 29/51
 *   (https://ultimateframedata.com/pikachu) count it in his own timeline: the
 *   script's 21/43 and the box's ⌊(3.15 × 0.65 + 6) × 1.2⌋ = 9 frames less the one
 *   they share (Plan 5, Task 7b). Its damage is the swing's, without the 1v1
 *   multiplier (`swingDamage`), as every freeze's is.
 * - `ATK_HIT_ABS` lays the live `ATTACK_ABS` launch on the fighter held — no
 *   hurtbox, no geometry, nothing to clank with — through the ordinary hit
 *   pipeline (`applyHit`): damage, staleness, knockback, the release. Its
 *   hitlag falls on the one thrown alone, and the thrower plays on (fix round
 *   1): SmashWiki "Hitlag", throws "can inflict hitlag on release, which only
 *   affects the opponent", and in Ultimate only Pikachu's down throw does on
 *   this roster; the rest carry `Hitlag=0.0`. Not on a fighter the throw no
 *   longer holds: a KO either side, or a hit on the fighter held, has ended the
 *   link (`releaseGrab`) before this frame. Hits resolve first (`resolveHits`),
 *   so a hit on the fighter held on the frame of the release takes them out of
 *   the throw (UNVERIFIED: no source orders the two).
 *
 * Each fires once, on the frame the move steps onto: a frame held by a freeze
 * is run again but not acted on again, as `spawnDueProjectiles` does it (a
 * second turn would face the thrower forward again, a second stop stop it twice).
 *
 * UNVERIFIED: where the hit is reported. The game lays the throw at its `throw`
 * joint; here the spark is the held fighter's position (`holdAtCaptor`).
 */
function resolveThrows(
  s: GameState,
  defs: readonly FighterDef[],
  frozen: readonly boolean[],
  beforeActionFrame: readonly number[],
  intents: readonly Intent[],
  events: StepEvents,
): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.action !== "throw" || f.move === null) continue;
    if (f.actionFrame === beforeActionFrame[i] && !enteredThisTick(f, frozen[i])) continue;
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    /** The fighter this throw holds, both ends of the link whole, or null. */
    const held = (): FighterState | null => {
      const victim = f.grabbing >= 0 ? s.fighters[f.grabbing] : undefined;
      return victim === undefined || captorOf(s, victim) !== f || victim.action === "dead" ? null : victim;
    };
    for (const cmd of run.state.fired) {
      if (cmd.op === "reverseLr") f.facing = -f.facing;
      if (cmd.op === "catchStop") {
        const victim = held();
        if (victim === null) continue;
        freezeFighter(f, cmd.frames);
        freezeFighter(victim, cmd.frames);
        // `invincible` counts down before each frame's hits, so `frames` covers the stop.
        victim.invincible = Math.max(victim.invincible, cmd.frames);
      }
      if (cmd.op !== "hitAbs" || run.state.throwAbs === null) continue;
      const victim = held();
      if (victim === null) continue;
      const v = victim.port;
      const at = { x: victim.x, y: victim.y };
      const own = f.hitlag;
      applyHit(s, f, defs[i], victim, defs[v], throwCandidate(i, absHitbox(run.state.throwAbs), f.move, at), at, intents[v], events);
      f.hitlag = own;
    }
    for (const flash of run.state.flashed) {
      if (!flash.catchOnly) continue;
      const victim = held();
      if (victim === null) continue;
      const hb = unplacedHitbox(flash.params);
      const damage = swingDamage(f, throwCandidate(i, hb, f.move, { x: victim.x, y: victim.y }));
      const lag = computeHitlag(damage, { electric: hb.effect === "electric", moveMultiplier: hb.hitlagMultiplier });
      freezeVictim(victim, lag);
      freezeFighter(f, lag);
    }
  }
}

/**
 * Invincible: the respawn's and the dodges' counter (`FighterState.invincible`),
 * or a throw short of its release (fix round 1). SmashWiki "Throw"
 * (https://www.ssbwiki.com/Throw): in Ultimate "the thrower is now invincible
 * until the opponent has been thrown", and "it lasts from frame 1 all the way
 * until the frame the opponent is thrown" — the release frame included
 * (SmashWiki "Pikachu (SSBU)/Down throw": "Invincibility 1-21", release on 21).
 * A freeze holds the throw on its frame, and the invincibility with it. Read
 * off the throw's script, so nothing is kept for it.
 */
function isInvincible(f: FighterState, def: FighterDef): boolean {
  if (f.invincible > 0) return true;
  if (f.action !== "throw" || f.move === null) return false;
  // A throw with knockback armour has it "instead of gaining Throw
  // Invulnerability" (SmashWiki "Donkey Kong (SSBU)",
  // https://www.ssbwiki.com/Donkey_Kong_(SSBU): Donkey Kong's cargo throws; Plan
  // 5, Task 8 fix round 1, `heavyArmourOf`).
  if (def.moves[f.move]?.heavyArmour !== undefined) return false;
  // A throw that releases nobody, Donkey Kong's lift (`MoveDef.cargo`), is
  // invincible throughout: SmashWiki "Donkey Kong (SSBU)/Forward throw"
  // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Forward_throw), the carry's
  // "Invincibility 1-15" over its "Animation length 15" (`game_throwf`'s
  // `WHOLE_HIT(HIT_STATUS_INVINCIBLE)`, rubendal Data Viewer 13.0.1). Plan 5, Task 8.
  if (def.moves[f.move]?.cargo === true) return true;
  const script = gameScriptFor(def, f.move);
  const release = script === null ? null : throwStrikeFrame(script);
  return release !== null && moveFrameOf(f.actionFrame) <= release;
}

/**
 * A fighter's own windbox leaves no mark on its swing's hit record (Plan 5, Task 9
 * fix round 1): it pushes on each frame it is out, and its move times its rehits
 * with boxes one frame long (Kirby's Inhale pull, `Rehit=10`: frames 11, 21, 31,
 * 41). Marked, a pull would spend the swing on its victim, and the Inhale's catch,
 * the same swing in the replica's one record, could never take them; SSBU keeps
 * catches (`CatchModule`) and attacks (`AttackModule`) apart. UNVERIFIED: the rehit
 * timed from the box's frames, where SSBU times it from each victim's last hit. A
 * projectile's windbox (F.L.U.D.D.'s water) marks its own record, as before.
 */
function unrecorded(c: Candidate): boolean {
  return c.hitbox.windbox === true && c.projectile === null;
}

/** Is `c` a box of a move that inhales (`MoveDef.inhale`, Plan 5, Task 9: Kirby's neutral special)? */
function isInhale(def: FighterDef, c: Candidate): boolean {
  return c.projectile === null && c.slot !== null && def.moves[c.slot]?.inhale !== undefined;
}

/** A throw's own hit as a hit candidate: no geometry, no projectile, the fighter held its only target. */
function throwCandidate(attacker: number, hitbox: Hitbox, slot: MoveSlot, at: Point): Candidate {
  return {
    attacker,
    hitbox,
    x: at.x,
    y: at.y,
    prevX: at.x,
    prevY: at.y,
    dx: 0,
    dy: 0,
    slot,
    projectile: null,
    chargeScale: ONE,
    destroyOnHit: false,
    onlyPort: null,
    damageMul: ONE,
    suppressed: false,
  };
}

/**
 * One swing hits one target once — and one *arrow* hits one target once.
 *
 * The record lives on the projectile rather than on its owner, because Link can
 * have three arrows in the air and each is entitled to its own hit.
 */
function recordSaysAlreadyHit(s: GameState, c: Candidate, port: number): boolean {
  if (c.projectile !== null) return projectileAlreadyHit(c.projectile, port);
  return alreadyHit(s.fighters[c.attacker], port);
}

function recordHit(c: Candidate, attacker: FighterState, port: number): void {
  if (c.projectile !== null) markProjectileHit(c.projectile, port);
  else markHit(attacker, port);
}

/**
 * A hit that lands on an invincible fighter.
 *
 * Invincibility is not intangibility, and the difference is the whole reason
 * `FighterState` carries both. A fighter stepping off the respawn platform is
 * *solid*: the attack connects, it is spent, it makes its noise and it costs the
 * attacker the usual freeze — it simply transfers nothing. That is what makes
 * swinging at a returning opponent a bad idea rather than a free one, and it is
 * why the event is reported with zero damage and zero knockback rather than not
 * reported at all: the renderer and the audio layer read this to draw the clang.
 *
 * A grab is the exception, and it whiffs outright: there is no "connects but
 * transfers nothing" version of being caught.
 */
/**
 * Crouching, for the purpose of crouch cancel.
 *
 * Shared between the ordinary and invincible hit paths because they must agree:
 * the attacker's freeze cannot depend on whether the fighter they hit happened
 * to be invincible at the time.
 */
function isCrouching(f: FighterState): boolean {
  return f.action === "crouch" || f.action === "crouchStart";
}

/**
 * How stale this swing is. A move joins the queue once per swing (Plan 3,
 * Task 16): its later hits — a multi-hit re-armed by `clear_all`, or a second
 * victim — are as stale as its first was, not one level more (SmashWiki "Stale
 * Moves": from Brawl on, "later hitboxes of multi-hit moves" are protected
 * "from being staled while the move is in progress"). So once the swing has
 * queued itself, its own entry — the newest, at the front — is left out.
 */
function swingStaleness(attacker: FighterState, slot: MoveSlot) {
  const queued = attacker.combat.swingQueued;
  return computeStaleness(
    queued ? attacker.staleQueue.slice(1) : attacker.staleQueue,
    slot,
    queued ? attacker.combat.staleShield.slice(1) : attacker.combat.staleShield,
  );
}

/**
 * What a swing is worth once its charge, a short hop and staleness have
 * applied, before the one-on-one bonus: the damage a freeze reads (Plan 5, Task
 * 7b). SmashWiki "Hitlag" (https://www.ssbwiki.com/Hitlag), of the formula's
 * damage: "Stale/fresh damage, equipment, spirits, etc. are factored. The 1v1
 * multiplier and shield damage are not factored". So a fresh move's ×1.05 is in
 * it (`computeStaleness`), and a pummel's freeze is a frame longer than the
 * base-damage figure frame data measures (SmashWiki "Stale Moves": the freshness
 * bonus "is also ignored" in single-player and practice).
 *
 * Shared between an ordinary hit and one that lands on an invincible fighter,
 * because the two must agree: the attacker's freeze cannot depend on the state
 * of the person they hit. A projectile is exempt from staleness and short hop —
 * its charge was baked in at launch and the staleness queue is keyed by move
 * slot, which an arrow in flight no longer has. `applyHit` works the same
 * numbers out inline, with the knockback's staleness beside them.
 */
function swingDamage(attacker: FighterState, c: Candidate): number {
  const staleness = c.slot === null ? ONE : swingStaleness(attacker, c.slot).damage;
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const charged = mul(c.hitbox.damage, c.chargeScale);
  const base = shortHopped ? mul(charged, SHORT_HOP_DAMAGE) : charged;
  return mul(base, staleness);
}

/** What a hit deals: the swing's damage (`swingDamage`), and the one-on-one bonus in 1v1. */
function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staled = swingDamage(attacker, c);
  return s.rules.oneOnOne ? mul(staled, ONE_ON_ONE_MULTIPLIER) : staled;
}

function applyInvincibleHit(
  attacker: FighterState,
  victim: FighterState,
  c: Candidate,
  contact: Point,
  events: StepEvents,
): void {
  recordHit(c, attacker, victim.port);
  if (c.hitbox.grabbing) return;
  // The freeze is computed from the *same* adjusted damage an ordinary hit's
  // freeze uses — staleness and short hop included, the 1v1 bonus not (Plan 5,
  // Task 7b: `swingDamage`). Hitlag is a property of the swing, not of whether
  // its consequences landed, so a stale aerial that meets an invincible respawn
  // should freeze for exactly as long as one that meets a vulnerable fighter.
  // Reading raw damage here made the freeze wrong in precisely the situations
  // where the attacker most needs it to be predictable.
  const lag = computeHitlag(swingDamage(attacker, c), {
    electric: c.hitbox.effect === "electric",
    moveMultiplier: c.hitbox.hitlagMultiplier,
    // Crouch cancel too. A fighter who has just left the respawn platform is
    // still invincible and can perfectly well be crouching, and the freeze must
    // not depend on which of the two the victim happens to be — that is the
    // whole point of computing it from the swing rather than from the outcome.
    crouchCancel: isCrouching(victim),
  });
  // Same asymmetry as an ordinary hit: a projectile's owner is not a party to
  // the exchange, so an arrow bouncing off does not freeze the archer.
  if (c.projectile === null) freezeFighter(attacker, lag);
  events.hits.push({
    attacker: attacker.port,
    victim: victim.port,
    damage: 0,
    x: c.x,
    y: c.y,
    contactX: contact.x,
    contactY: contact.y,
    knockback: 0,
    // An invincible defender is not launched, so there is no direction to
    // report and the spark stays symmetric.
    angle: 0,
    hitboxId: c.hitbox.id,
  });
}

/* ------------------------------------------------------- pending launch -- */

/**
 * Fire the launch a hit parked, reading DI from the direction held *now*.
 *
 * Called on the last frame of the victim's hitlag — the frame Ultimate samples
 * DI and LSI on, and the reason hitlag is a window rather than merely a pause.
 * The victim has had the whole freeze to decide, so a launch angle here is a
 * reaction to a hit that has already landed rather than a guess made before it
 * did; SDI mashing during those same frames is unaffected, because it moves the
 * fighter's position and this decides their velocity. `step` has already
 * applied the automatic SDI shift, kept the shifts out of the stage and
 * re-checked the ground by then (phase 3), so the position and `grounded` read
 * here are where the victim really is. A hit with no freeze calls it on
 * contact, with nothing shifted.
 *
 * Everything is in attacker-relative space, so the stick is mirrored by the
 * facing the launch was authored against before it is read.
 */
function releasePendingLaunch(f: FighterState, intent: Intent): void {
  if (f.pendingFacing === 0) return;
  // A launch ends a short hop, as the hit ended a fast fall: an aerial thrown out
  // of its hitstun (Task 7) is not the hop's, and deals 1x, not 0.85x (Plan 3
  // final wave; the final review's Minor 3). Here, as the launch fires, not on
  // contact: in a trade the fighter's own aerial lands on the same frame and is
  // still the short hop's, whichever port the hit phase reaches first (a hit with
  // no freeze fires its launch on contact, so a trade of two of those does not).
  f.shortHop = false;
  if (f.combat.autolink) {
    releaseAutolink(f);
    return;
  }
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
  // DI and LSI only act on a launch that tumbles and is not within 0.17 rad of
  // straight ahead (rubendal Sm4sh-Calculator wiki "DI and LSI calculation and
  // controller stick limits",
  // https://github.com/rubendal/Sm4sh-Calculator/wiki/DI-and-LSI-calculation-and-controller-stick-limits:
  // "Conditions for DI: … the attack causes tumble; launch angle is greater than
  // 9.74°" — Ultimate "reuses the directional influence mechanics" of Smash 4,
  // SmashWiki "Directional influence"; rubendal SSBU-Calculator `js/knockback.js`
  // computes LSI only inside `di_able`). UNVERIFIED: the list's other condition,
  // "the opponent's kinetic handler is in the air (the opponent doesn't slide on the
  // ground after hitlag)", is not modelled: a grounded victim is DI'd here (D56 lists
  // it). Tumble is the *base* hitstun's call: a
  // sped-up launch's `hitstun` counts its shorter real time, so its base comes
  // back from the parked reaction frames (Plan 3, Task 6).
  const baseHitstun = f.combat.launchFaf > 0 ? f.combat.launchFaf - 1 : f.hitstun;
  const diAble = lsiApplies(baseHitstun) && launchDiAble(f.pendingAngle);
  const angle = diAble ? applyDI(f.pendingAngle, relStick, intent.y, intent.soft) : f.pendingAngle;
  const launch = knockbackToVelocity(f.pendingKnockback, angle, facing);
  // LSI is a survival tool, not a damage buff: it only touches knockback heavy
  // enough to tumble. Without the gate, holding up scales *every* jab by 1.095×
  // and holding down shrinks it by 0.92×, which is a mechanic the game does not
  // have. `baseHitstun` is the hit's full value here — the hitlag branch that
  // leads to this call never decrements `hitstun`. See `lsiApplies`.
  const speed = diAble ? applyLSI(launch.speed, intent.y, angle) : launch.speed;
  // The one moment the balloon question has an answer: the angle this launch
  // actually goes out at, DI included. See `FighterState.balloon`. A set-weight
  // launch is never one: its own fall "overrides the homogenised fall speed and
  // gravity" of a 70°-110° launch (SmashWiki "Knockback"; `SET_WEIGHT_GRAVITY`).
  const setWeight = f.combat.launchSetWeight;
  f.balloon = launch.balloon && !setWeight;

  let vx = launch.speed > 0 ? Math.trunc((launch.vx * speed) / launch.speed) : 0;
  let vy = launch.speed > 0 ? Math.trunc((launch.vy * speed) / launch.speed) : 0;
  let launchSpeed = speed;
  // A tumbling launch into the floor on a grounded victim is a floor bounce,
  // here, as it fires (Plan 3, Task 16b fix round 1, for meteors; the final
  // wave, for every such launch: `launchBounce`). SmashWiki "Meteor smash"
  // (https://www.ssbwiki.com/Meteor_smash, revision 2047089), grounded targets
  // "immediately bounce off the ground they're standing on (as long as they deal
  // enough knockback to put the opponent into tumble)"; SmashWiki "Knockback"
  // (revision 2063895): "Landing a meteor smash or spike on a grounded opponent
  // counts as a bounce": a meteor smash or a spike, so any launch into the floor,
  // whether or not its box is marked a meteor (`Hitbox.meteor`). So it is Task
  // 12's floor bounce (`techOrBounce`): the launch, DI'd, is sent back up at 0.9
  // (`BOUNCE_FLOOR_LAUNCH_RATIO`) if it is fast enough to bounce, still points
  // into the floor, and the victim still stands on one after the freeze's shifts
  // (`leaveGroundIfShiftedOff`). Not a tech: "meteor
  // smashes done on grounded-standing characters can no longer be teched" (same
  // page). The hitstun stays the hit's, from its whole knockback ("the amount of
  // hitstun delivered by a meteor smash is not affected by the knockback
  // reduction"; Task 16 review, Minor 7). The 0.8 a mid-flight bounce takes off
  // the hitstun (`BOUNCE_HITSTUN_RATIO`, the param
  // `damage_fly_reflect_reaction_frame_mul`) does not apply to this one: SmashWiki
  // "Hitstun" (https://www.ssbwiki.com/Hitstun): "Characters bouncing off
  // surfaces due to knockback have their hitstun reduced by 0.8× relative to the
  // initial amount, with the exception of grounded meteor smashes." The page's
  // exception names meteor smashes; every tumbling launch into the floor takes
  // it here, which is UNVERIFIED for one that is neither a meteor smash nor a
  // spike. UNVERIFIED: that the bounced launch keeps the speed-up and set
  // weight's fall a mid-flight bounce disarms (`kineticReflect`): it is the
  // launch itself.
  if (f.combat.launchBounce && f.grounded && vy < 0 && speed >= BOUNCE_FLOOR_MIN_SPEED) {
    vx = byRatio(vx, BOUNCE_FLOOR_LAUNCH_RATIO);
    vy = byRatio(-vy, BOUNCE_FLOOR_LAUNCH_RATIO);
    launchSpeed = byRatio(speed, BOUNCE_FLOOR_LAUNCH_RATIO);
  }
  kineticLaunch(f, vx, vy, launchSpeed, launch.speed > 0 ? f.combat.launchFaf : 0, setWeight);
  // Whether the launch takes the victim off the ground is a DI question too: a
  // flat Sakurai-angle hit that gets DI'd upward leaves the floor, and the same
  // hit without DI slides along it.
  leaveGroundIfLifted(f);
  clearPendingLaunch(f);
}

/**
 * Automatic SDI: the freeze of an electric or paralyzing hit ends with a shift
 * toward the held stick (Plan 3, Task 11; `ASDI_DISTANCE`), the first of the
 * release's four steps in `step` (phase 3). It is spent either way. A victim's,
 * as SDI is (`CombatState.victimFreeze`): only a hit's victim is ever armed with
 * it, so the second test states the rule rather than changes what it does.
 */
function applyAsdi(f: FighterState, intent: Intent): void {
  if (f.combat.asdi && f.combat.victimFreeze && (intent.x !== 0 || intent.y !== 0)) {
    const diagonal = intent.x !== 0 && intent.y !== 0;
    const distance = diagonal ? mul(ASDI_DISTANCE, DIAGONAL) : ASDI_DISTANCE;
    f.x += intent.x * distance;
    f.y += intent.y * distance;
  }
  f.combat.asdi = false;
}

/**
 * The ground re-check of a frozen victim whose launch is about to fire (Plan 3
 * final wave; the final review's Important 1). `grounded` was decided before the
 * freeze, and a frozen fighter skips the collision phase, so SDI and ASDI could
 * carry a grounded victim off its platform while it still counted as standing
 * there: a downward launch then bounced it up off thin air. It is the test
 * `resolveCollision` asks of a fighter already standing on something, on the
 * clamped position: is its origin still over the platform's span? If not, it has
 * left the ground without a jump, which spends the ground jump as walking off
 * does (`onLeftGround`; SmashWiki "Double jump").
 */
function leaveGroundIfShiftedOff(f: FighterState, stage: StageDef, frame: number): void {
  if (!f.grounded) return;
  if (f.platform >= 0 && f.platform < stage.platforms.length) {
    const p = stage.platforms[f.platform];
    if (abs(f.x - platformCentreX(p, frame)) <= p.halfWidth) return;
  }
  f.grounded = false;
  f.platform = -1;
  f.jumpsUsed = Math.max(f.jumpsUsed, 1);
}

/**
 * A launch that rises takes a grounded victim off the floor. Launched off the
 * floor is leaving the ground without a jump: the ground jump is spent, the
 * midair jumps are not (see `onLeftGround`). Being hit gives none back either:
 * "double jumps are not given back to the player upon being put into hitstun"
 * (SmashWiki Double jump).
 */
function leaveGroundIfLifted(f: FighterState): void {
  if (f.vy > 0 && f.grounded) {
    f.grounded = false;
    f.platform = -1;
    f.jumpsUsed = Math.max(f.jumpsUsed, 1);
  }
}

/**
 * Fire the autolink parked on contact (Plan 3, Task 19): its vector is
 * computed now, from the victim's position after SDI and ASDI ("calculated
 * after hitlag is over", SmashWiki "Autolink angle",
 * https://www.ssbwiki.com/Autolink_angle: which, "combined with the weakening
 * of SDI", is what makes 367° "impossible to escape"; 365° "can be easily
 * escaped with SDI" because it ignores the victim's position). No DI, no LSI
 * and no balloon fall: the vector as it stands. What is not the angle's is the
 * hit's, as for any launch: the balloon speed-up of a tumbling hit without
 * set knockback ("the knockback speed-up effect still applies to moves that
 * use autolink angles if they do not have set knockback", the 367° section;
 * its hitstun was shortened for it on contact, and UNVERIFIED for 365°, whose
 * section does not say) and set weight's fall ("whatever the angle",
 * `reelOnce`). UNVERIFIED: that DI and LSI do not act on it (the page names
 * only SDI), and that it is never balloon (the page does not say). The position
 * it reads is the one `clampShiftToStage` leaves, after SDI and ASDI: where the
 * victim really is when the freeze ends (Plan 3 final wave; Task 19 re-review
 * N2), not a point inside the stage the clamp has just moved it out of.
 */
function releaseAutolink(f: FighterState): void {
  const v = autolinkVector(parkedAutolink(f.combat), f.x, f.y);
  const speed = magnitude(v.vx, v.vy);
  f.balloon = false;
  kineticLaunch(f, v.vx, v.vy, speed, speed > 0 ? f.combat.launchFaf : 0, f.combat.launchSetWeight);
  leaveGroundIfLifted(f);
  clearPendingLaunch(f);
}

/** One SDI pulse: 2 units, ×1.15 from the sixth consecutive hit taken (Task 11). */
function sdiDistance(f: FighterState): number {
  return f.combat.comboHits > SDI_COMBO_HITS ? byRatio(SDI_DISTANCE, SDI_COMBO_RATIO) : SDI_DISTANCE;
}

/** Is `angle` one of the autolink angles, 365° to 368°: not degrees at all (Plan 3, Task 19)? */
function isAutolinkAngle(angle: number): boolean {
  return angle >= AUTOLINK_MIN && angle <= AUTOLINK_MAX;
}

/**
 * The launch angle a hit resolves to against this victim: `resolveAngle`, and an
 * autolink angle's own rule for a grounded one. "When hitting an opponent on the
 * ground, it always uses an angle of 80° and does not modify launch speed"
 * (SmashWiki "Autolink angle", https://www.ssbwiki.com/Autolink_angle, of
 * 367°); 365° is half the attacker's momentum whoever it hits, and has no angle
 * to resolve. 366° and 368° are refused at load (`AUTOLINK_UNMODELLED`); one a
 * hand-built context lets through takes 367°'s rules here, not 6° or 8°.
 */
function hitAngle(hb: Hitbox, victimGrounded: boolean, kb: number): number {
  if (victimGrounded && isAutolinkAngle(hb.angle) && hb.angle !== AUTOLINK_HALF_MOMENTUM) {
    return AUTOLINK_GROUNDED_ANGLE;
  }
  return resolveAngle(hb, victimGrounded, kb);
}

/**
 * What an autolink launch needs from the moment of contact: which rule, the
 * attacker's momentum, and the point the 367° rule pulls toward. The victim's
 * position is not here: it is read when the vector is computed.
 */
interface Autolink {
  /** The 367° rule; false is 365°. */
  readonly pull: boolean;
  readonly momentumX: number;
  readonly momentumY: number;
  readonly pointX: number;
  readonly pointY: number;
}

/**
 * The autolink a hit carries against this victim; null for any other hit, and
 * for a grounded victim of 366° to 368°, which `hitAngle` sends out at 80°
 * like any launch.
 *
 * The momentum is the attacker's `vx`/`vy`, read here, on contact in phase 6:
 * after this frame's movement and collision, so it is the velocity the
 * attacker ends the frame with. A fighter in hitlag skips movement and keeps it,
 * so it is the momentum the page's "calculated after hitlag is over" reads,
 * with one exception: a hit on two victims overwrites the attacker's freeze per
 * box, so the attacker thaws first when its last-processed box has the shorter
 * lag, and its momentum has moved on by the time the longer freeze ends. A
 * projectile's own velocity is the momentum of its hits (UNVERIFIED: the page
 * speaks of the attacker only).
 *
 * The point is the centre of the hitbox, "toward the center of the hitbox"
 * (SmashWiki, 366° and 367° sections): a capsule's midpoint, the same whichever
 * end the script writes first, and a sphere's centre. UNVERIFIED: which point of
 * a capsule the game aims at; the page speaks of "the center of the hitbox".
 */
function autolinkOf(victim: FighterState, hb: Hitbox, c: Candidate, attacker: FighterState): Autolink | null {
  if (!isAutolinkAngle(hb.angle)) return null;
  const pull = hb.angle !== AUTOLINK_HALF_MOMENTUM;
  if (pull && victim.grounded) return null;
  return {
    pull,
    momentumX: c.projectile !== null ? c.projectile.vx : attacker.vx,
    momentumY: c.projectile !== null ? c.projectile.vy : attacker.vy,
    // Halved once, from both ends together, so the two orders of an odd
    // extent give the same point (Task 19 re-review N1).
    pointX: pull ? Math.trunc((2 * c.x + c.dx) / 2) : 0,
    pointY: pull ? Math.trunc((2 * c.y + c.dy) / 2) : 0,
  };
}

/** The autolink parked on a victim (`parkAutolink`). */
function parkedAutolink(c: CombatState): Autolink {
  return {
    pull: c.autolinkPull,
    momentumX: c.autolinkMomentumX,
    momentumY: c.autolinkMomentumY,
    pointX: c.autolinkPointX,
    pointY: c.autolinkPointY,
  };
}

/**
 * The launch of an autolink on a victim at (`x`, `y`), in world space.
 *
 * SmashWiki "Autolink angle" (https://www.ssbwiki.com/Autolink_angle). 365°:
 * "it sets the opponent's launch speed to 50% of the attacker's momentum",
 * "regardless of the knockback". 367°: "the attacker's momentum, plus 20% of the
 * difference between the hitbox and opponent's positional coordinates", capped
 * at a launch speed of 3, with "vertical launch speed ... a lower cap of -1".
 * The cap holds at once, where the page has it "5 frames after the opponent is
 * launched" (UNVERIFIED simplification), and the floor comes before it (the page
 * does not order them). "Position" is the fighter's origin.
 */
function autolinkVector(a: Autolink, x: number, y: number): { vx: number; vy: number } {
  if (!a.pull) return { vx: Math.trunc(a.momentumX / 2), vy: Math.trunc(a.momentumY / 2) };
  let vx = a.momentumX + byRatio(a.pointX - x, AUTOLINK_PULL_RATIO);
  let vy = a.momentumY + byRatio(a.pointY - y, AUTOLINK_PULL_RATIO);
  if (vy < AUTOLINK_MIN_VY) vy = AUTOLINK_MIN_VY;
  const speed = magnitude(vx, vy);
  if (speed > AUTOLINK_SPEED_CAP) {
    vx = Math.trunc((vx * AUTOLINK_SPEED_CAP) / speed);
    vy = Math.trunc((vy * AUTOLINK_SPEED_CAP) / speed);
  }
  return { vx, vy };
}

/**
 * Park an autolink with the launch (Plan 3, Task 19). Both fighters are frozen
 * until it is used, and the vector is computed then (`releaseAutolink`), so SDI
 * moves it. Any other hit that replaces a parked launch clears it.
 */
function parkAutolink(victim: FighterState, hb: Hitbox, c: Candidate, attacker: FighterState): void {
  const link = autolinkOf(victim, hb, c, attacker);
  const parked = victim.combat;
  parked.autolink = link !== null;
  parked.autolinkPull = link !== null && link.pull;
  parked.autolinkMomentumX = link === null ? 0 : link.momentumX;
  parked.autolinkMomentumY = link === null ? 0 : link.momentumY;
  parked.autolinkPointX = link === null ? 0 : link.pointX;
  parked.autolinkPointY = link === null ? 0 : link.pointY;
}

/**
 * The world direction of the vector (`x`, `y`), in fixed degrees, for the hit
 * event (`HitEvent.angle`): the tenth of a degree on the sine table whose unit
 * vector it lies along (the smallest cross product, on the side it points to;
 * the dot product is too flat at its peak to tell a tenth of a degree apart in
 * Q12). A vector of nothing points the way the attacker launches, straight
 * ahead. An autolink's `Hitbox.angle` is not a direction (367° read as degrees
 * is 7°), so the spark must not take it from there.
 */
function vectorWorldAngle(x: number, y: number, facing: number): number {
  if (x === 0 && y === 0) return launchWorldAngle(0, facing);
  let best = 0;
  let bestCross = Infinity;
  for (let tenth = 0; tenth < 3600; tenth++) {
    const angle = Math.ceil((tenth * ONE) / 10);
    const cos = cosDeg(angle);
    const sin = sinDeg(angle);
    if (x * cos + y * sin <= 0) continue;
    const cross = abs(x * sin - y * cos);
    if (cross < bestCross) {
      bestCross = cross;
      best = angle;
    }
  }
  return best;
}

/**
 * Which way a launch kept through a weaker hit goes (`HitEvent.angle`): one still
 * parked in the freeze, its own angle as its hit reported it (undecided by DI
 * yet); one in flight, the world direction of its vector, after the keep has
 * turned it (`kineticTurnLaunch`).
 */
function keptLaunchAngle(victim: FighterState, facing: number): number {
  if (victim.pendingFacing !== 0) {
    if (victim.combat.autolink) {
      const link = autolinkVector(parkedAutolink(victim.combat), victim.x, victim.y);
      return vectorWorldAngle(link.vx, link.vy, victim.pendingFacing);
    }
    return launchWorldAngle(victim.pendingAngle, victim.pendingFacing);
  }
  return vectorWorldAngle(victim.kinetic.damageX, victim.kinetic.damageY, facing);
}

function clearPendingLaunch(f: FighterState): void {
  f.pendingKnockback = 0;
  f.pendingAngle = 0;
  f.pendingFacing = 0;
  f.combat.launchFaf = 0;
  f.combat.launchSetWeight = false;
  f.combat.launchBounce = false;
  f.combat.asdi = false;
  f.combat.autolink = false;
  f.combat.autolinkPull = false;
  f.combat.autolinkMomentumX = 0;
  f.combat.autolinkMomentumY = 0;
  f.combat.autolinkPointX = 0;
  f.combat.autolinkPointY = 0;
}

/**
 * Does this hit land on the victim's raised shield rather than on the body? The
 * shield must face the hit and the box must reach the bubble — a worn shield
 * shrinks to 15% of its radius, and a hit that misses it is a shield poke.
 */
function hitReachesShield(victim: FighterState, victimDef: FighterDef, c: Candidate): boolean {
  const bubble = shieldBubble(victim, victimDef);
  return shieldCovers(victim, nearestX(c, victim.x)) && capsulesOverlap(capsuleOf(c), bubble);
}

/**
 * A move joins the staleness queue once per swing, on its first connection.
 * The swing's own flag says so (`swingQueued`), not its hit record: `clear_all`
 * empties the record to re-arm a box, and a record of one would queue a
 * five-hit drill five times.
 */
function enterStaleQueue(attacker: FighterState, slot: MoveSlot | null, onShield: boolean): void {
  if (slot === null || attacker.combat.swingQueued) return;
  attacker.combat.swingQueued = true;
  attacker.staleQueue.unshift(slot);
  attacker.combat.staleShield.unshift(onShield);
  if (attacker.staleQueue.length > STALE_QUEUE_LENGTH) attacker.staleQueue.length = STALE_QUEUE_LENGTH;
  if (attacker.combat.staleShield.length > STALE_QUEUE_LENGTH) {
    attacker.combat.staleShield.length = STALE_QUEUE_LENGTH;
  }
}

/**
 * Freeze `f` for a freeze of `n` frames, counted from this one: the `n − 1`
 * frames after it (`framesAfterHit`; Plan 5, Task 7b), and never fewer than a
 * freeze it is already in still holds. A second freeze lands on a fighter in the
 * first in a trade (both hits on one frame, in port order), in knockback
 * stacking, and in a throw's stop or partial hit; each fighter keeps the longer,
 * whichever is stored first (Plan 5, Task 7b fix round 2, ruling R-7b-e).
 * UNVERIFIED: no source orders a trade; the nearest is SmashWiki "Priority"
 * (https://www.ssbwiki.com/Priority), on clanks, "a rebounding character will
 * suffer freeze frames equal to the hitlag of the stronger attack". Every freeze
 * `step()` stores goes through here, `freezeVictim`'s included; `triggerCounter`
 * applies the same rule itself (`combat.test.ts` lists every write to `hitlag`).
 */
function freezeFighter(f: FighterState, n: number): void {
  f.hitlag = Math.max(f.hitlag, framesAfterHit(n));
}

/**
 * Freeze `victim` for a freeze of `n` frames as the fighter a hit landed on
 * (`freezeFighter`): the one freeze SDI and ASDI act in (`CombatState.victimFreeze`;
 * Plan 3 final wave). A hit with no frame of freeze after its own leaves nothing
 * to SDI in.
 */
function freezeVictim(victim: FighterState, n: number): void {
  freezeFighter(victim, n);
  victim.combat.victimFreeze = victim.hitlag > 0;
}

/**
 * A catch-only hit on the fighter held — a pummel, or a throw's hits before its
 * launch (Kirby's down-throw stomps): damage, a freeze for both fighters, and
 * nothing else (Plan 3, Task 14; Plan 5, Task 7 sends every `set_catch_only_all`
 * box here). The victim stays held: no knockback, no
 * hitstun, no release and no status change, and the escape timer is untouched
 * (SmashWiki "Grab": the grab time is "not affected by pummeling"; "Pummel":
 * pummels "continue until the opponent is eventually thrown or breaks free"). It
 * goes through the same staleness and 1v1 scaling as any hit, and joins the
 * staleness queue (SmashWiki "Pummel": pummelling is how a stale move is
 * restored). Being hit gives back the air dodge and the special stall, as
 * `applyHit` does.
 */
function applyHeldHit(
  s: GameState,
  attacker: FighterState,
  victim: FighterState,
  c: Candidate,
  contact: Point,
  events: StepEvents,
): void {
  const hb = c.hitbox;
  recordHit(c, attacker, victim.port);
  const damage = effectiveDamage(s, attacker, c);
  // The freeze reads the swing's damage, without the 1v1 bonus (`swingDamage`).
  const lag = computeHitlag(swingDamage(attacker, c), { electric: hb.effect === "electric", moveMultiplier: hb.hitlagMultiplier });
  enterStaleQueue(attacker, c.slot, false);
  victim.damage += damage;
  maybeLoseCopy(s, victim, damage);
  victim.airDodged = false;
  victim.combat.specialStall = false;
  freezeVictim(victim, lag);
  freezeFighter(attacker, lag);
  events.hits.push({
    attacker: attacker.port,
    victim: victim.port,
    damage,
    x: c.x,
    y: c.y,
    contactX: contact.x,
    contactY: contact.y,
    knockback: 0,
    angle: 0,
    hitboxId: hb.id,
  });
}

/**
 * The facing a hit's launch is measured from. A box with no LR rule launches
 * forwards: the way its owner faces, or the way its projectile points.
 * `ATTACK_LR_CHECK_POS` launches away from the attacker by position, and
 * `ATTACK_LR_CHECK_B` backwards (Plan 3, Task 16).
 *
 * A back throw is no exception (Plan 5, Task 7, ruling P5-R7): one that launches
 * behind either says so in its angle (over 90°: Link's, Kirby's, Pikachu's,
 * Marth's) or turns its thrower round first (`REVERSE_LR`, `resolveThrows`:
 * Samus's and Mario's scripts, and the legacy ones that point forward, by
 * `MoveDef.turnAt`), and launches the way the thrower then faces.
 */
function launchSourceFacing(c: Candidate, attacker: FighterState, victim: FighterState): number {
  const hb = c.hitbox;
  const forward = c.projectile !== null ? c.projectile.facing : attacker.facing;
  if (hb.lr === undefined) return forward;
  if (hb.lr === "back") return -forward;
  // UNVERIFIED: origin to origin (the attacker's, or its projectile's, against the
  // victim's), and a victim level with it launches the way the attacker faces;
  // whether the game compares hitbox positions, and how it breaks a tie, is not
  // published (Task 16 review, Minor 9).
  const fromX = c.projectile !== null ? c.projectile.x : attacker.x;
  return victim.x === fromX ? forward : victim.x > fromX ? 1 : -1;
}

/**
 * Which way a hit on a raised shield pushes the defender: away from the nearest
 * point of the box (a sphere: its centre, a defender level with it going +x).
 * A capsule that spans the defender's centre has no side to be nearest on, so it
 * pushes away from the attacker's body, and a defender level with the attacker
 * goes the way the attacker faces, as `launchSourceFacing` breaks its tie.
 * UNVERIFIED: SmashWiki "Shield" (https://www.ssbwiki.com/Shield) gives how far
 * a shield is pushed (`(shieldstun + 1) * 0.09`, capped at 1.3), not which way.
 */
function shieldPushDirection(c: Candidate, attacker: FighterState, victim: FighterState): number {
  const near = nearestX(c, victim.x);
  if ((c.dx !== 0 || c.dy !== 0) && near === victim.x) {
    return victim.x === attacker.x ? attacker.facing : victim.x > attacker.x ? 1 : -1;
  }
  return victim.x < near ? -1 : 1;
}

function applyHit(
  s: GameState,
  attacker: FighterState,
  attackerDef: FighterDef,
  victim: FighterState,
  victimDef: FighterDef,
  c: Candidate,
  contact: Point,
  victimIntent: Intent,
  events: StepEvents,
): void {
  const hb = c.hitbox;
  const fromProjectile = c.projectile !== null;
  recordHit(c, attacker, victim.port);

  // Grabs do not damage; they capture.
  if (hb.grabbing) {
    // Whatever grab either fighter was already part of ends here — a fighter
    // caught while holding somebody drops them, and a second grab on an
    // already-held fighter takes over rather than leaving the first holder
    // pointing at a victim who is no longer theirs.
    releaseGrab(victim, s.fighters);
    attacker.grabbing = victim.port;
    victim.grabbedBy = attacker.port;
    // The escape timer, fixed now, on the victim (Plan 3, Task 14), and the
    // length it starts from, which Donkey Kong's carry reads (Plan 5, Task 8).
    victim.grabTimer = grabHoldFrames(victim.damage);
    victim.combat.grabLength = victim.grabTimer;
    victim.combat.mash = 0;
    kineticSet(victim, 0, 0);
    // Being caught cancels a launch that had not fired yet: the victim is held,
    // not flying, and a pending launch would go off in their captor's hands.
    clearPendingLaunch(victim);
    // ...and ends whatever reeling the victim was in. A grab goes through a
    // shield, and nothing stops one landing on a fighter in stun; `hitstun` is
    // the counter all of those share (shieldstun, shield-break stun, a launch's
    // hitstun). Left running, it would reel a held fighter (`applyMovement`
    // reels whenever it is positive) and leave the released one still stunned.
    // The balloon speed-up and set weight's fall go with it: every other exit
    // from a launch disarms them, and a stale arm would act on the next reel.
    victim.hitstun = 0;
    victim.balloon = false;
    kineticDisarmLaunch(victim);
    // Being grabbed restores the midair jumps (SmashWiki "Double jump",
    // https://www.ssbwiki.com/Double_jump: "A character's double jump(s) are
    // restored upon ... being grabbed by an opposing character"). A fighter in
    // the air keeps the ground jump spent, as a ledge grab does (`grabLedge`).
    victim.jumpsUsed = Math.min(victim.jumpsUsed, 1);
    // UNVERIFIED: the air dodge is NOT restored. SmashWiki "Air dodge"
    // (https://www.ssbwiki.com/Air_dodge) lists "land, get hit, or grab a
    // ledge"; a grab is not a hit (`airDodged` is cleared on the damage path),
    // and where "Double jump" restores jumps it names being grabbed outright,
    // which the air dodge list does not.
    //
    // A hanging fighter is pulled off the ledge: it can be grabbed (SmashWiki
    // "Grab", https://www.ssbwiki.com/Grab: "In Melee, characters hanging on
    // ledges cannot be grabbed, but in every other game they can"), and `ledge`
    // must not outlive the grab, or `applyMovement` would pin the released
    // fighter in mid-air. As when a hit knocks one off, the ledge is locked out
    // for a while, or the fighter would take it straight back. UNVERIFIED: that
    // being grabbed locks the ledge out; `ledgeRegrabs` is left as it was: the
    // wiki names hitstun and touching the ground as what resets that count
    // (SmashWiki "Ledge"), and being grabbed is neither.
    if (victim.ledge !== null) victim.ledgeLockout = LEDGE_REGRAB_LOCKOUT_FRAMES;
    victim.ledge = null;
    // Kirby's Inhale swallows rather than grabs (Plan 5, Task 9): the same link,
    // its own timer and statuses (`swallowVictim`).
    if (isInhale(attackerDef, c)) {
      swallowVictim(attacker, victim);
      return;
    }
    startAction(victim, "grabbed");
    return;
  }

  // A projectile is already in the air, so nothing about the swing that launched
  // it still applies: its charge was baked in at launch, and it does not stale —
  // the staleness queue is keyed by move slot and an arrow has left its move.
  const staleness = c.slot === null ? { damage: ONE, knockback: ONE } : swingStaleness(attacker, c.slot);
  // An aerial thrown out of a short hop deals 0.85×, and the reduction is
  // applied to the damage *before* knockback is computed rather than to the
  // knockback afterwards — the formula takes damage as an input twice over (the
  // victim's new percent, and the hit's own `d`), so a short-hopped aerial has
  // to launch less far as a consequence of hurting less, not as a second rule.
  // SPEC §4. Projectiles are exempt: `slot` is null once one is in the air.
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const baseDamage = shortHopped
    ? mul(mul(hb.damage, c.chargeScale), SHORT_HOP_DAMAGE)
    : mul(hb.damage, c.chargeScale);
  let damage = mul(baseDamage, staleness.damage);
  // The knockback formula's `d`, staled its own way, and never the 1v1 bonus.
  const kbDamage = mul(baseDamage, staleness.knockback);
  // What every freeze below reads: the damage before the one-on-one bonus
  // (`swingDamage`; SmashWiki "Hitlag", https://www.ssbwiki.com/Hitlag: "The 1v1
  // multiplier and shield damage are not factored"; Plan 5, Task 7b).
  const lagDamage = damage;
  // The one-on-one bonus scales the damage dealt and nothing else (Plan 5, Task 7b
  // fix round 1, ruling R-7b-b): the knockback is reckoned without it, `d` and the
  // percent alike (below). SmashWiki "Armor" (https://www.ssbwiki.com/Armor): "In
  // Ultimate, given that knockback is calculated before the 1v1 multiplier is
  // applied to damage, knockback-based armor is unaffected by it"; SmashWiki "1v1
  // multiplier" (https://www.ssbwiki.com/1v1_multiplier): "It does not affect the
  // amount of damage needed to KO an opponent".
  if (s.rules.oneOnOne) damage = mul(damage, ONE_ON_ONE_MULTIPLIER);
  // Kirby's Copy Ability (Plan 5, Task 9): ×1.2 on the damage dealt, a shield's
  // included, and not on knockback's `d` (SmashWiki "Copy Ability": "knockback is
  // not affected"; "Inhale (Kirby)": it "raises damage percent, but knockback only
  // reflects the change in percent"; Rollout "instantly break[s] a shield" with
  // it). UNVERIFIED: that hitlag leaves it out, as it leaves the 1v1 bonus out.
  damage = mul(damage, c.damageMul);
  // This hit's damage without the 1v1 bonus, the Copy Ability's ×1.2 in: what the
  // knockback formula's percent counts (ruling R-7b-b, above), and all a shield
  // takes (ruling R-7b-d, the shield path below).
  const takenBefore1v1 = mul(lagDamage, c.damageMul);

  // A move joins the staleness queue once per swing, on its first connection —
  // a shield hit included, marked so it stales at 0.85 (SmashWiki "Stale-move
  // negation": hitting a shield enters the queue in Ultimate, perfect shield too).
  // The hit must reach the shield bubble too: a worn shield shrinks to 15% of
  // its radius and a hit that misses it lands on the body — a shield poke.
  const onShield = hitReachesShield(victim, victimDef, c);
  enterStaleQueue(attacker, c.slot, onShield);

  /* ---- the shield path ---- */
  // The 1v1 bonus never reaches a shield (Plan 5, Task 7b fix round 2, ruling
  // R-7b-d): SmashWiki "1v1 multiplier" (https://www.ssbwiki.com/1v1_multiplier),
  // "It does not affect the length of hitstun, hitlag or shieldstun", and "Shields
  // and stage elements are unaffected by the multiplier". So the shieldstun, the
  // defender's pushback (from the unrounded shieldstun, SmashWiki "Shield",
  // https://www.ssbwiki.com/Shield) and the shield damage read `takenBefore1v1`,
  // Copy's ×1.2 kept (Task 9). UNVERIFIED: the attacker's pushback too; no page
  // names it, and it follows the shield's reading.
  if (onShield) {
    const lag = computeHitlag(lagDamage, {
      electric: hb.effect === "electric",
      shielding: true,
      moveMultiplier: hb.hitlagMultiplier,
    });
    const stunOpts = {
      smash: c.slot !== null && isSmashSlot(c.slot),
      aerial: c.slot !== null && isAerialSlot(c.slot),
      // A projectile takes a further 0.29 off shieldstun, so a zoner cannot
      // freeze a shield from across the stage.
      projectile: fromProjectile,
      moveMultiplier: hb.shieldstunMultiplier,
    };
    const away = shieldPushDirection(c, attacker, victim);
    // Pushback reads the shieldstun *before* it is rounded (SmashWiki "Shield").
    const stunExact = shieldstunExact(takenBefore1v1, stunOpts);
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
      // one left standing there — frozen longer than the defender, by the
      // published amounts on top of the *shield* hitlag (SmashWiki "Perfect
      // shield": the defender "can act 3 frames earlier than shielding the attack
      // normally"; rubendal's `ParryHitlag` disagrees on the melee rows, see
      // `PARRY_MELEE_*`). Pushback carries the 0.15 inside its formula, before the
      // 1.3 cap. A parried projectile freezes nobody a stage away.
      // Each a freeze of its own, counted from the hit's frame (`framesAfterHit`).
      const parry = perfectShieldHitlag(lag, fromProjectile, hb.direct ?? !fromProjectile);
      freezeVictim(victim, parry.defender);
      if (!fromProjectile) freezeFighter(attacker, parry.attacker);
      kineticSetX(victim, away * shieldPushback(stunExact, true), "stop");
      if (!fromProjectile && attacker.grounded) kineticSetX(attacker, -away * attackerShieldPushback(takenBefore1v1));
      events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
      return;
    }
    victim.shieldHealth -= shieldDamage(takenBefore1v1);
    victim.hitstun = computeShieldstun(takenBefore1v1, stunOpts);
    freezeVictim(victim, lag);
    if (!fromProjectile) freezeFighter(attacker, lag);
    kineticSetX(victim, away * shieldPushback(stunExact), "stop");
    // A melee attacker on the ground slides back off the shield too; a
    // projectile's owner is not there to be pushed (rubendal `AttackerShieldPushback`).
    // UNVERIFIED: that an airborne attacker is not pushed; rubendal's formula has
    // no situation, and the replica pushes only one on the ground.
    if (!fromProjectile && attacker.grounded) kineticSetX(attacker, -away * attackerShieldPushback(takenBefore1v1));
    if (victim.shieldHealth <= 0) {
      victim.shieldHealth = 0;
      startAction(victim, "shieldBroken");
      victim.hitstun = shieldBreakStun(victim.damage);
      events.shieldBreaks.push(victim.port);
    } else {
      startAction(victim, "shieldStun");
    }
    events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
    return;
  }

  /* ---- the damage path ---- */
  // SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback): p is "counted after
  // the attack's damage is added", the damage before the 1v1 bonus (R-7b-b).
  const kbPercent = victim.damage + takenBefore1v1;
  victim.damage += damage;
  // A Kirby hit may lose his Copy Ability (Plan 5, Task 9: `maybeLoseCopy`).
  maybeLoseCopy(s, victim, damage);

  /* ---- the super-armour path ---- */
  //
  // Armour is not invincibility and not a shield: the damage lands in full and
  // the fighter simply refuses to be moved by it. That is the whole identity of
  // a move like Giant Punch — you walk through the jab and land the punch — and
  // it is why armour has to sit here, after damage and before knockback, rather
  // than at the top with the intangibility checks. The damage was added once,
  // above; adding it again here doubled every armoured hit (Plan 3, Task 1).
  // A box that forces its reaction goes through armour (`Hitbox.forceReaction`).
  // Both fighters freeze, as for any hit (Plan 5, Task 7b fix round 1, ruling
  // R-7b-c): SmashWiki "Armor" (https://www.ssbwiki.com/Armor), "Armor is the
  // concept of sustaining hitlag and damage, but not sustaining any (or sustaining
  // reduced) knockback"; SmashWiki "Hitlag" (https://www.ssbwiki.com/Hitlag), "both
  // the attacker and target are frozen in place". SmashWiki "Piranha Plant
  // (SSBU)/Down special" (https://www.ssbwiki.com/Piranha_Plant_(SSBU)/Down_special),
  // of Long-Stem Strike's heavy armour: it "struggles against projectiles with high
  // hitlag multipliers strangely, as the hitlag stops the move from tilting or
  // lunging until the freeze frames end". The armoured move stands the freeze out
  // on its frame, as any frozen move does, and keeps a longer freeze it is already
  // in (a trade, ruling R-7b-e: `freezeFighter`). UNVERIFIED: that it can SDI in
  // the freeze. No source names armour; SmashWiki "Hitlag"
  // (https://www.ssbwiki.com/Hitlag), "During hitlag, defending characters are
  // capable of performing smash directional influence", and SmashWiki "Smash
  // directional influence" (https://www.ssbwiki.com/Smash_directional_influence),
  // SDI "allows players to slightly alter their position during hitlag from being
  // hit by an attack", shield SDI included. A projectile's owner is not at the hit
  // and does not freeze.
  const armoured = (): void => {
    const lag = computeHitlag(lagDamage, {
      electric: hb.effect === "electric",
      moveMultiplier: hb.hitlagMultiplier,
    });
    freezeVictim(victim, lag);
    if (!fromProjectile) freezeFighter(attacker, lag);
    events.hits.push({
      attacker: attacker.port,
      victim: victim.port,
      damage,
      x: c.x,
      y: c.y,
      contactX: contact.x,
      contactY: contact.y,
      knockback: 0,
      angle: 0,
      hitboxId: hb.id,
    });
  };
  if (hasSuperArmour(victim, victimDef) && hb.forceReaction !== true) {
    armoured();
    return;
  }

  const crouchCancel = isCrouching(victim);

  // Set knockback runs the formula on the box's `fkb` with the victim's weight;
  // set weight makes that weight 100, in either formula (Plan 3, Task 16b).
  const kb = computeKnockback({
    percent: kbPercent,
    damage: kbDamage,
    weight: victimDef.attributes.weight,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
    rage: computeRage(attacker.damage),
    crouchCancel,
    fixedKnockback: hb.fixedKnockback,
    setWeight: hb.setWeight,
  });

  // Knockback-based armour (`MoveDef.heavyArmour`; Plan 5, Task 8 fix round 1):
  // a hit of no more knockback than the threshold is taken as super armour takes
  // one; a harder one launches as usual. Measured on this hit's own knockback,
  // the one it launches with: SmashWiki's "Units of Knockback" are the knockback
  // formula's (SmashWiki "Knockback", https://www.ssbwiki.com/Knockback), which
  // `computeKnockback` is, reckoned without the 1v1 bonus, so the armour is
  // "unaffected by" it (SmashWiki "Armor"; ruling R-7b-b).
  const heavy = heavyArmourOf(victim, victimDef);
  if (heavy !== null && kb <= heavy && hb.forceReaction !== true) {
    armoured();
    return;
  }

  // "Characters can only air dodge once until they land, get hit, or grab a
  // ledge" (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge). Plan 3, Task 7.
  // Below the armour: a hit armour takes is not one that gets the fighter hit
  // out of anything (Plan 3 final wave; the Task 7 review's minor). UNVERIFIED:
  // that reading of "get hit".
  victim.airDodged = false;
  // So is the airtime's special stall (Plan 5): Fox's Reflector stalls "once
  // until he lands or gets hit" (SmashWiki "Fox (SSBU)",
  // https://www.ssbwiki.com/Fox_(SSBU)). The same reading of "get hit".
  // UNVERIFIED for Mario's Cape: borrowed from Fox's; Super Mario Wiki "Cape"
  // names only landing ("between leaving the ground and returning to it").
  victim.combat.specialStall = false;

  // The base decides tumble; a tumbling launch without set knockback is then
  // played back sped up, which shortens the hitstun in real frames (SmashWiki
  // "Hitstun"; rubendal `js/knockback.js`: `tumble && !isFKB`). Plan 3, Task 6.
  // It is the hit's knockback: a grounded meteor's bounce comes after (below).
  const hitstun = computeHitstun(kb);
  const tumbles = hitstun >= TUMBLE_HITSTUN;
  const speedUp = tumbles && (hb.fixedKnockback ?? 0) <= 0;
  // Crouch cancel shortens the freeze for *both* fighters (research §4), which
  // is why one `lag` is computed and handed to each of them below rather than
  // one each: crouching does not buy the defender a frame advantage, it makes
  // the whole exchange snappier.
  const lag = computeHitlag(lagDamage, {
    electric: hb.effect === "electric",
    crouchCancel,
    moveMultiplier: hb.hitlagMultiplier,
  });

  // A projectile launches along the way *it* is pointing, which is the facing its
  // thrower had when it left rather than whichever way they happen to be looking
  // now — the arrow does not turn round when Link does.
  const sourceFacing = launchSourceFacing(c, attacker, victim);

  // Knockback stacking (Plan 3, Task 8): against a launch still live — in
  // hitstun, or parked in hitlag — from a *different* source, a weaker new
  // launch either keeps the first (0.5×–0.9×) or is armoured through (< 0.5×).
  // A launch whose hitstun is over is not "live": what is left of it is drift,
  // and any hit replaces it. Either way the damage lands and both fighters
  // freeze. A kept launch keeps its speed and hitstun, but turns toward the sum
  // of both launch vectors, and is not DI'd (SmashWiki "Knockback", stacking).
  //
  // An autolink hit stacks by its knockback's speed like any other: stacking is
  // decided here, on contact, and its vector is not computed until the freeze
  // ends ("calculated after hitlag is over"), so no other speed exists yet. A
  // parked autolink is then compared by its knockback's speed and a live one by
  // its vector's (`launchSpeed`). The hits of one multi-hit move are one source
  // and always replace each other, so an autolink move never stacks with itself.
  //
  // Four readings here are UNVERIFIED (the Task 8 review). Live: the page compares
  // the new launch with "the first hit's [launch speed] at the time the second hit
  // connects" and says nothing of a launch whose hitstun is over or one parked in
  // the freeze; here a fighter is live while `hitstun` runs or a launch is parked.
  // The 0.8 grounded-flat factor: `current` is the launch as it flies (a parked one
  // carries the 0.8 in `pendingKnockback`), `fresh` is the new knockback × 0.03
  // without it, so a grounded flat second hit compares as stronger than it would
  // launch. The edges, exactly 0.5× and 0.9× (`KB_STACK_ARMOUR`). And a kept launch
  // keeps the `balloon` flag its own angle set: it is not reclassified for the
  // vector it is turned to, which may be inside or outside the balloon cone.
  const source = candidateKey(c);
  const live = victim.hitstun > 0 || victim.pendingFacing !== 0;
  const current = !live
    ? 0
    : victim.pendingFacing !== 0
      ? mul(victim.pendingKnockback, LAUNCH_SPEED_RATIO)
      : victim.launchSpeed;
  const verdict =
    victim.combat.launchSource === source ? "replace" : knockbackStack(mul(kb, LAUNCH_SPEED_RATIO), current);
  if (verdict !== "replace") {
    if (verdict === "keep" && victim.pendingFacing === 0 && victim.launchSpeed > 0) {
      // A parked launch has no vector yet; it keeps its own, as it was. An
      // autolink adds the vector it would launch with from where the victim is
      // now (its angle is not degrees).
      const link = autolinkOf(victim, hb, c, attacker);
      const added =
        link !== null
          ? autolinkVector(link, victim.x, victim.y)
          : knockbackToVelocity(kb, hitAngle(hb, victim.grounded, kb), sourceFacing);
      kineticTurnLaunch(victim, victim.kinetic.damageX + added.vx, victim.kinetic.damageY + added.vy);
    }
    victim.combat.comboHits += 1;
    freezeVictim(victim, lag);
    if (!fromProjectile) freezeFighter(attacker, lag);
    events.hits.push({
      attacker: attacker.port,
      victim: victim.port,
      damage,
      x: c.x,
      y: c.y,
      contactX: contact.x,
      contactY: contact.y,
      knockback: verdict === "keep" ? kb : 0,
      // A kept launch goes on the way it goes, and the spark says so (Plan 3 final
      // wave; the Task 8 review's minor). One armoured through launches nothing new.
      angle: verdict === "keep" ? keptLaunchAngle(victim, sourceFacing) : 0,
      hitboxId: hb.id,
    });
    return;
  }
  victim.combat.launchSource = source;
  victim.combat.comboHits += 1;

  // The launch is *parked*, not applied: Ultimate samples DI on the last frame
  // of hitlag, so the direction that bends this angle has not been chosen yet.
  // Everything the hit itself already fixes — the launch's magnitude and its
  // un-DI'd angle — is computed here; the stick is read in
  // `releasePendingLaunch` when the freeze ends. A player who was already
  // holding a direction gets the same answer either way, which is exactly why
  // the difference only shows up for the player who is *reacting*.
  // `sourceFacing` was decided above, with the stacking check.
  victim.pendingKnockback = kb;
  victim.pendingAngle = hitAngle(hb, victim.grounded, kb);
  // A grounded victim launched flat slides out at 0.8 of the speed (rubendal
  // `groundedZeroAngle`), set knockback or not: `WeightBasedKB` builds the same
  // `Knockback`, whose `calculate` applies it. The hitstun is the hit's, above.
  if (victim.grounded && victim.pendingAngle === 0) victim.pendingKnockback = byRatio(kb, GROUNDED_ZERO_LAUNCH_RATIO);
  const vertical = victim.pendingAngle >= ASDI_VERTICAL[0] && victim.pendingAngle < ASDI_VERTICAL[1];
  // UNVERIFIED: SmashWiki "Smash directional influence" says ASDI also applies
  // to projectiles with a hitlag multiplier of 0, which have no freeze. Here it
  // takes a freeze: the shift is clamped to the stage where the freeze ends
  // (`clampShiftToStage`), and a zero-lag release happens in this function,
  // which has no stage to clamp against.
  // Only a freeze with a frame after the hit's has a last frame to shift on (one
  // of 0 or 1 releases on contact below, which clears the flag again).
  victim.combat.asdi = framesAfterHit(lag) > 0 && (hb.effect === "electric" || hb.effect === "paralyze") && !vertical;
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;
  parkAutolink(victim, hb, c, attacker);
  // Which way the launch goes, for the spark: the un-DI'd direction (DI is
  // sampled on the last frame of hitlag, so this is the launch as the *hit* set
  // it, right for a graphic that fires on the contact frame). Fixed now, because
  // a hit with no freeze fires (and clears) the parked launch below — as every
  // published throw but one does: `Hitlag=0.0` (Plan 5, Task 7; before it, such
  // a hit reported 0°). An autolink points along its own vector, as it stands at
  // contact (the victim may SDI before it is computed for real).
  const link = victim.combat.autolink ? autolinkVector(parkedAutolink(victim.combat), victim.x, victim.y) : null;
  const sparkAngle = link !== null ? vectorWorldAngle(link.vx, link.vy, sourceFacing) : launchWorldAngle(victim.pendingAngle, victim.pendingFacing);

  victim.hitstun = effectiveHitstun(kb, speedUp);
  victim.combat.launchFaf = speedUp ? hitstun + 1 : 0;
  victim.combat.launchSetWeight = hb.setWeight === true;
  // A launch that tumbles a grounded victim bounces it off the floor as it fires,
  // if it points into the floor then (`releasePendingLaunch`), set knockback
  // included: the bounce is the launch meeting the floor, not one of the
  // knockback modifiers Ultimate took off set knockback. Every such launch, not
  // only a meteor's: it is floor physics, Task 12's bounce at release (Plan 3
  // final wave; the final review's Important 2, where Donkey Kong's legacy 270°
  // Headbutt, not marked a meteor, lifted its victim along the floor and bounced
  // it a few frames later with its hitstun cut). One too weak to tumble does not
  // bounce: the victim flinches where it stands (SmashWiki "Meteor smash").
  victim.combat.launchBounce = victim.grounded && tumbles;
  freezeVictim(victim, lag);
  victim.intangible = 0;
  // A hit that knocks a hanging fighter off the ledge locks the ledge out, as
  // letting go does; a hit anywhere else leaves the lockout alone.
  if (victim.ledge !== null) victim.ledgeLockout = LEDGE_REGRAB_LOCKOUT_FRAMES;
  victim.ledge = null;
  victim.ledgeRegrabs = 0;
  victim.fastFalling = false;
  // Hitlag freezes both parties to a melee exchange. A projectile's owner is not
  // a party to it — freezing Link when his arrow connects across the stage would
  // give the opponent a free frame every time they walked into one.
  if (!fromProjectile) freezeFighter(attacker, lag);
  // A hit with no frame of freeze after its own (a freeze of 0 or 1) has no
  // window to react in, so its DI is decided on the contact frame after all —
  // which is the same rule, at length zero.
  if (victim.hitlag === 0) releasePendingLaunch(victim, victimIntent);

  // Taking a hit ends any grab this fighter is part of, at *either* end. Being
  // launched out of a captor's hands is the obvious half; the half that is easy
  // to miss is that a fighter who was doing the holding has just been knocked
  // out of `grabHold`, and leaving their `grabbing` set would strand their
  // victim in `grabbed` — whose only exit is `grabbedBy < 0` — for good.
  releaseGrab(victim, s.fighters);
  startAction(victim, tumbles ? "tumble" : "hitstun");

  events.hits.push({
    attacker: attacker.port,
    victim: victim.port,
    damage,
    x: c.x,
    y: c.y,
    contactX: contact.x,
    contactY: contact.y,
    knockback: kb,
    angle: sparkAngle,
    hitboxId: hb.id,
  });
}

/**
 * A windbox's push (Plan 5, Task 6: F.L.U.D.D.). SmashWiki "Windbox"
 * (https://www.ssbwiki.com/Windbox): "From a physics standpoint, pushing is
 * simply knockback without flinching". So the push is the hit's knockback, by
 * the same formula and at the same angle as a launch, put on the DAMAGE energy
 * (`kineticPush`), where it stacks with the fighter's own movement and decays as
 * a launch does. Nothing else: no damage, hitstun, hitlag for either fighter
 * (`DisableHitlag=true`), status change, stale entry or hit event (the hitbox
 * row's `nogfx=t`, SmashWiki "Mario (SSBU)/Down special"); a `pushes` event
 * says who pushed whom, for kill credit. The fighter goes on
 * with what it was doing, and a helpless one stays helpless: SmashWiki
 * "F.L.U.D.D." (https://www.ssbwiki.com/F.L.U.D.D.), it "can push opponents away
 * from the stage during their recovery without giving them another chance to
 * use it". The air dodge and the special stall a hit gives back stay spent too
 * (UNVERIFIED for those two: the page names the recovery).
 *
 * - On the ground it only slides the fighter: "windboxes cannot lift opponents
 *   off the ground, but can push them off edges". UNVERIFIED: the slide is the
 *   push's horizontal part, at that part's speed.
 * - Super armour does not stop it: SmashWiki "Armor"
 *   (https://www.ssbwiki.com/Armor), a fighter in super armour does not
 *   "flinch nor take any knockback when attacked by a harmful hitbox, but
 *   flinchless hitboxes (like windboxes) will still move the character".
 * - A raised shield takes nothing: "Pushing attacks that do not deal damage are
 *   ineffective against shielding opponents". Nor does an invincible fighter
 *   (`FighterState.invincible`: the hit connects and transfers nothing). Either
 *   way the hit is spent, as a hit is. UNVERIFIED: that it is spent.
 * - Against a launch still flying in its hitstun, knockback stacking decides,
 *   as it does for a hit (SmashWiki "Knockback",
 *   https://www.ssbwiki.com/Knockback): a push under 0.5× of the launch does
 *   nothing, one of 0.5×–0.9× turns it toward the sum, a faster one takes over
 *   its velocity, and the hitstun runs on. UNVERIFIED: the page's stacking
 *   names launches, not pushes.
 *
 * Every windbox on this roster deals 0% (`schema.test.ts`), the case the shield
 * rule names, so no damage is dealt here.
 */
function applyWindbox(attacker: FighterState, victim: FighterState, victimDef: FighterDef, c: Candidate, events: StepEvents): void {
  if (!unrecorded(c)) recordHit(c, attacker, victim.port);
  if (isInvincible(victim, victimDef) || hitReachesShield(victim, victimDef, c)) return;
  // It reached the body: who pushed whom, for the results screen's kill credit
  // (`StepEvents.pushes`), whatever the push then does.
  events.pushes.push({ attacker: attacker.port, victim: victim.port });
  // A launch parked in its freeze replaces any push when it fires
  // (`releasePendingLaunch`), and a frozen fighter does not move before then,
  // so nothing is left of a push on one.
  if (victim.pendingFacing !== 0) return;
  const hb = c.hitbox;
  // F.L.U.D.D. is set knockback, which reads neither rage nor crouch cancel
  // (`computeKnockback`); a windbox without one is a launch's knockback.
  const kb = computeKnockback({
    percent: victim.damage,
    damage: mul(hb.damage, c.chargeScale),
    weight: victimDef.attributes.weight,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
    rage: computeRage(attacker.damage),
    crouchCancel: isCrouching(victim),
    fixedKnockback: hb.fixedKnockback,
    setWeight: hb.setWeight,
  });
  const push = knockbackToVelocity(kb, resolveAngle(hb, victim.grounded, kb), launchSourceFacing(c, attacker, victim));
  const vy = victim.grounded ? 0 : push.vy;
  const speed = victim.grounded ? abs(push.vx) : push.speed;
  const verdict = knockbackStack(speed, victim.hitstun > 0 ? victim.launchSpeed : 0);
  if (verdict === "armour") return;
  if (verdict === "keep") {
    kineticTurnLaunch(victim, victim.kinetic.damageX + push.vx, victim.kinetic.damageY + vy);
    return;
  }
  kineticPush(victim, push.vx, vy, speed);
}

/* ----------------------------------------------------------- smash ball -- */

/**
 * The one item in the game, and the only source of randomness in a match.
 *
 * It drifts on a seeded RNG, loses 2 HP every 60 frames on its own so a stalemate
 * cannot last forever, and awards the Final Smash to whoever lands the hit that
 * takes it to zero.
 */
function updateSmashBall(s: GameState): void {
  const ball = s.smashBall;
  const anyoneCharged = s.fighters.some((f) => f.finalSmashReady > 0);

  if (!ball.active) {
    if (!anyoneCharged && s.frame > 0 && s.frame % SMASH_BALL_SPAWN_INTERVAL === 0) {
      const r = randomInt(s.rngSeed, 2);
      s.rngSeed = r.seed;
      ball.active = true;
      ball.x = r.value === 0 ? fx(-100) : fx(100);
      ball.y = fx(80);
      ball.health = SMASH_BALL_HEALTH;
      ball.driftTimer = 0;
    }
    for (const f of s.fighters) if (f.finalSmashReady > 0) f.finalSmashReady -= 1;
    return;
  }

  if (ball.driftTimer <= 0) {
    const rx = nextRandom(s.rngSeed);
    const ry = nextRandom(rx.seed);
    s.rngSeed = ry.seed;
    ball.vx = mul(SMASH_BALL_SPEED, Math.trunc((rx.value * 2 - 1) * ONE));
    ball.vy = mul(SMASH_BALL_SPEED, Math.trunc((ry.value * 2 - 1) * ONE));
    ball.driftTimer = SMASH_BALL_DRIFT_FRAMES;
  }
  ball.driftTimer -= 1;
  ball.x += ball.vx;
  ball.y += ball.vy;

  // 2 HP every 60 frames on its own, so a Smash Ball nobody commits to hitting
  // eventually leaves rather than turning the match into a stalemate around it.
  if (s.frame % SMASH_BALL_DECAY_INTERVAL === 0) ball.health -= SMASH_BALL_DECAY;
  if (ball.health <= 0) {
    ball.active = false;
    ball.health = 0;
  }

  for (const f of s.fighters) if (f.finalSmashReady > 0) f.finalSmashReady -= 1;
}

function resolveSmashBallHits(
  s: GameState,
  candidates: readonly Candidate[],
  events: StepEvents,
): void {
  const ball = s.smashBall;
  const target = circle(ball.x, ball.y, SMASH_BALL_RADIUS);
  for (const c of candidates) {
    // A catch-only box hits the fighter held and nothing else.
    if (c.suppressed || c.onlyPort !== null) continue;
    const attacker = s.fighters[c.attacker];
    if (alreadyHit(attacker, SMASH_BALL_TARGET)) continue;
    if (!sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, target)) continue;
    markHit(attacker, SMASH_BALL_TARGET);
    ball.health -= c.hitbox.damage;
    // Knocked along by the hit, so it stays hard to corner.
    ball.vx += (ball.x >= attacker.x ? 1 : -1) * mul(c.hitbox.damage, fx(0.1));
    if (ball.health <= 0) {
      ball.active = false;
      ball.health = 0;
      attacker.finalSmashReady = FINAL_SMASH_STANDBY;
      events.smashBallBroken = attacker.port;
      return;
    }
  }
}

/* --------------------------------------------------------------- outcome -- */

/**
 * Who won, if anybody has yet.
 *
 * Placings are stocks first and damage second, which is Ultimate's own
 * tiebreaker: two players on their last stock are ranked by who is closer to
 * losing it.
 */
export function resolveOutcome(s: GameState): GameState["outcome"] {
  const alive = s.fighters.filter((f) => f.stocks > 0);
  const timedOut = s.rules.mode === "time" && s.timeRemaining <= 0;
  if (s.rules.mode === "stock" && alive.length > 1) return null;
  if (s.rules.mode === "time" && !timedOut) return null;
  if (s.rules.mode === "stock" && alive.length === s.fighters.length) return null;

  const placings = s.fighters
    .slice()
    .sort((a, b) => (b.stocks !== a.stocks ? b.stocks - a.stocks : a.damage - b.damage))
    .map((f) => f.port);

  const tiedAtTop =
    s.fighters.length > 1 &&
    timedOut &&
    s.fighters.filter(
      (f) =>
        f.stocks === s.fighters[placings[0]].stocks &&
        f.damage === s.fighters[placings[0]].damage,
    ).length > 1;

  return {
    kind: tiedAtTop ? "suddenDeath" : timedOut ? "timeUp" : "stockOut",
    placings,
  };
}

/** Distance between two fighters, for the CPU and the camera. */
export function fighterDistance(a: FighterState, b: FighterState): number {
  return abs(a.x - b.x) + abs(a.y - b.y);
}
