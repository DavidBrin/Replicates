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
  hitboxWorldPos,
  hurtboxCapsule,
  markHit,
  resolveClank,
  sweptCapsuleOverlaps,
  sweptCapsulePenetration,
} from "./hitbox";
import type { Capsule } from "./hitbox";
import {
  advanceProjectile,
  cloneProjectile,
  findProjectileDef,
  markProjectileHit,
  projectileAlreadyHit,
  projectileHitboxActive,
  spawnProjectile,
} from "./projectile";
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
  interpretInput,
  isHolding,
  isParrying,
  onLanded,
  onLeftGround,
  releaseGrab,
  shieldCovers,
  startAction,
  trumpLedge,
  updateInputTracking,
} from "./states";
import type { Intent, StateContext } from "./states";
import {
  cloneKinetic,
  emptyKinetic,
  kineticClear,
  kineticDisarmLaunch,
  kineticLaunch,
  kineticTurnLaunch,
  kineticSet,
  kineticSetX,
} from "./kinetic";
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
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
import { scriptHitboxes } from "./acmd/hitboxes";
import { moveScriptFrame, prepareFighterScripts } from "./acmd/run";
import "./status";
import { releaseHeld, struggleInGrab } from "./status/attack";
import { emptyEvents } from "./types";
import type {
  ActionState,
  FighterAttributes,
  FighterDef,
  FighterState,
  GameState,
  Hitbox,
  InputFrame,
  MatchRules,
  MoveSlot,
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

/** Frames the whole game freezes for on a KO, for the drama. */
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
   * The only port this candidate may hit, or null for anyone it reaches. A
   * pummel and the four throws hit the fighter their owner holds and nobody
   * else, wherever that fighter is: the game's `set_catch_only_all` /
   * `ATTACK_ABS` (Plan 5, Task 7 reads the script's own). `-1` is "the fighter
   * held" when nobody is, which no port equals.
   */
  readonly onlyPort: number | null;
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
  const defs = s.fighters.map((f) => ctx.fighter(f.defId));
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
      // A held fighter can still mash out of the grab during the freeze of a
      // pummel (SmashWiki "Pummel": "opponents can still mash out of the
      // attacker's grab during hitlag"). Only the mash counts: the frame itself
      // does not, as nothing else in a freeze does (Plan 3, Task 14).
      if (f.action === "grabbed" && f.grabbedBy >= 0) struggleInGrab(f, intent, stateCtx(i), false);
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
      clampShiftToStage(f, shiftedFromX, shiftedFromY, stage, defs[i].attributes, s.frame);
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
  for (const f of s.fighters) {
    if (f.grabbing >= 0 && f.action !== "dead" && !isHolding(f.action)) releaseHeld(f, s.fighters);
  }

  /* -- 4. physics ---------------------------------------------------------- */

  const preIntegrate = s.fighters.map((f) => ({ x: f.x, y: f.y }));
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.action === "dead") continue;
    // A held fighter has no movement of its own: it is carried (5b below).
    if (captorOf(s, f) !== null) continue;
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

    const before = launchBefore(f);
    const outcome = resolveCollision(
      f,
      preIntegrate[i].x,
      preIntegrate[i].y,
      stage,
      defs[i].attributes,
      s.frame,
      // The catch statuses stop at the edge instead of walking off it.
      { cliffStop: isHolding(f.action) },
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

    if (!f.grounded) {
      const grab = findLedgeGrab(f, stage, s.frame, ecbOf(f, defs[i].attributes).half, s.fighters);
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
        // trump). UNVERIFIED: that reading.
        //
        // UNVERIFIED: two fighters taking one free ledge on the same frame. The ports are
        // handled in order, so the later one trumps the earlier, which hung for no frames. That
        // grab's `ledgeRegrabs` count stays: a trump never touches it, however long the
        // fighter hung.
        for (let j = 0; j < s.fighters.length; j++) {
          const other = s.fighters[j];
          if (j === i || other.ledge === null || other.action !== "ledgeHang") continue;
          if (other.ledge.platform !== grab.platform || other.ledge.side !== grab.side) continue;
          trumpLedge(other, ecbOf(other, defs[j].attributes).half + ONE);
        }
        grabLedge(f, grab.platform, grab.side, pos.x, pos.y, frames);
      }
    }
  }

  /* -- 5b. a held fighter stays with its captor ------------------------------ */

  // After phase 5, so the captor's position for the frame is final whatever the
  // port order, and before the hit phase, so the box a pummel or a throw is
  // measured from is where the victim is.
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    const captor = f.action === "dead" ? null : captorOf(s, f);
    if (captor !== null) holdAtCaptor(f, captor, defs[captor.port].attributes, defs[i].attributes, stage, s.frame);
  }

  /* -- 6. hitboxes: gather, clank, connect --------------------------------- */

  // Projectiles fly, then this frame's launches join them, then everything —
  // fists and arrows alike — goes through one clank pass and one hit pass.
  const projectilePrev = advanceProjectiles(s, defs, stage);
  spawnDueProjectiles(s, defs, beforeActionFrame, frozen, projectilePrev);

  const destroyed = new Set<number>();
  const candidates = gatherHitboxes(s, defs, prevPos, frozen, ctx.bones ?? LEGACY_BONE_TABLE);
  appendProjectileCandidates(s, defs, candidates, projectilePrev);
  resolveClanks(s, candidates, events, destroyed);
  resolveHits(s, defs, candidates, intents, events, destroyed);
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
    const ko = blastZoneKO(f, stage);
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
    clearHitRecord(f);
    startAction(f, "dead");
    s.freezeFrames = KO_FREEZE_FRAMES;
  }

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
 * hand (CAPTURE_PULLED, then CAPTURE_WAIT attached to the `throw` joint), a bone
 * position that arrives with Plan 4's bake. Until then: bodies touching, the two
 * hurtbox radii apart, in front of the captor. The roster's legacy pummel and
 * throw boxes were written for a victim about this close.
 *
 * Standing where the captor stands counts as touching the ground, if there is
 * ground there: a victim over the captor's platform is grounded on it, and a
 * fighter caught in the air gets its ground jump and its air dodge back, as a
 * landing gives them (UNVERIFIED for the air dodge: SmashWiki "Air dodge" lists
 * "land"). A victim held past the edge (the captor at the lip, facing out) is
 * held in the air: not grounded, so no restore, and a release leaves it to fall.
 * It is placed, so gravity never moves it, and it is not "in the air" for the
 * ledge's airtime bonus either. Positions are written, not velocities:
 * `kineticSet` re-sums the energies.
 */
function holdAtCaptor(
  f: FighterState,
  captor: FighterState,
  captorAttrs: FighterAttributes,
  attrs: FighterAttributes,
  stage: StageDef,
  frame: number,
): void {
  const ahead = captor.facing >= 0 ? 1 : -1;
  f.x = captor.x + ahead * (captorAttrs.width + attrs.width);
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
  }
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
    for (const hb of live) {
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
        chargeScale: chargeMultiplier(f.charge),
        destroyOnHit: false,
        onlyPort: f.action === "pummel" || f.action === "throw" ? f.grabbing : null,
        suppressed: false,
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------- projectiles -- */

type PrevPositions = Map<number, { x: number; y: number }>;

/**
 * Fly every projectile one frame and drop the ones that ran out of life, stage
 * or bounces. Returns where each was before it moved, for the swept hit test.
 */
function advanceProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  stage: StageDef,
): PrevPositions {
  const prev: PrevPositions = new Map();
  if (s.projectiles.length === 0) return prev;
  const survivors: ProjectileState[] = [];
  for (const p of s.projectiles) {
    const ownerDef = defs[p.owner];
    const def = ownerDef === undefined ? undefined : findProjectileDef(ownerDef, p.defId);
    if (def === undefined) continue;
    const owner = s.fighters[p.owner] ?? null;
    const moved = advanceProjectile(p, def, stage, owner, s.frame);
    prev.set(p.instanceId, { x: moved.prevX, y: moved.prevY });
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
      const p = spawnProjectile(def, f, s.nextProjectileId);
      s.nextProjectileId += 1;
      s.projectiles.push(p);
      prev.set(p.instanceId, { x: p.x, y: p.y });
    }
  }
}

/** Add every live projectile hitbox to the same candidate list as the fists. */
function appendProjectileCandidates(
  s: GameState,
  defs: readonly FighterDef[],
  candidates: Candidate[],
  prev: PrevPositions,
): void {
  for (const p of s.projectiles) {
    const ownerDef = defs[p.owner];
    const def = ownerDef === undefined ? undefined : findProjectileDef(ownerDef, p.defId);
    if (def === undefined || !projectileHitboxActive(p, def)) continue;
    const was = prev.get(p.instanceId) ?? { x: p.x, y: p.y };
    const offsetX = p.facing >= 0 ? def.hitbox.x : -def.hitbox.x;
    candidates.push({
      attacker: p.owner,
      hitbox: def.hitbox,
      x: p.x + offsetX,
      y: p.y + def.hitbox.y,
      prevX: was.x + offsetX,
      prevY: was.y + def.hitbox.y,
      dx: 0,
      dy: 0,
      slot: null,
      projectile: p,
      chargeScale: p.chargeScale,
      destroyOnHit: def.destroyOnHit === true,
      onlyPort: null,
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
  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const ca = candidates[a];
      const cb = candidates[b];
      if (ca.attacker === cb.attacker) continue;
      // A pummel or a throw on a held fighter is not a hitbox in the world (SSBU's
      // `ATTACK_ABS`, `set_catch_only_all`): nothing clanks with it.
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
  candidates: readonly Candidate[],
  intents: readonly Intent[],
  events: StepEvents,
  destroyed: Set<number>,
): void {
  for (let v = 0; v < s.fighters.length; v++) {
    const victim = s.fighters[v];
    if (victim.action === "dead" || victim.action === "entering") continue;
    const hurtbox = hurtboxCapsule(victim, defs[v].attributes);

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
      if (recordSaysAlreadyHit(s, c, victim.port)) continue;
      if (c.onlyPort !== null) {
        // Catch-only (a pummel, a throw): the fighter held, wherever the box is.
        // Not geometry-tested: the game holds the victim at the box, and a legacy
        // box sits there only for some of the roster (Plan 3, Task 14).
        if (c.onlyPort !== v || victim.grabbedBy !== c.attacker) continue;
      } else {
        if (!sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, hurtbox)) continue;
        // A box that only grazes the body — less than 0.1 deep — is a glancing
        // blow: no hit, and the swing is not spent (Plan 3, Task 13). It is skipped
        // before the lowest-id pick, so it cannot shadow a deeper box of the same
        // source. A grab and a hit that reaches a raised shield are not decided by
        // the depth into the body (SmashWiki's glancing blow is hitbox on hurtbox),
        // and keep the plain overlap test they always had.
        if (
          sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, hurtbox) < GLANCING_BLOW_DEPTH &&
          !c.hitbox.grabbing &&
          !hitReachesShield(victim, defs[v], c)
        ) {
          continue;
        }
      }
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
      // Invincible: the fighter *is* there and the hit connects. It is only the
      // consequences that do not land. See `FighterState.invincible`.
      if (victim.invincible > 0) applyInvincibleHit(s, attacker, victim, c, events);
      else if (c.slot === "pummel" && c.onlyPort !== null) applyHeldHit(s, attacker, victim, c, events);
      else applyHit(s, attacker, victim, defs[v], c, intents[v], events);
      if (c.destroyOnHit && c.projectile !== null) destroyed.add(c.projectile.instanceId);
    }
  }

  if (s.smashBall.active) resolveSmashBallHits(s, candidates, events);
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
 * What a hit is worth once every modifier that scales damage has applied.
 *
 * Shared between an ordinary hit and one that lands on an invincible fighter,
 * because the two must agree: the attacker's freeze cannot depend on the state
 * of the person they hit. A projectile is exempt from staleness and short hop —
 * its charge was baked in at launch and the staleness queue is keyed by move
 * slot, which an arrow in flight no longer has.
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

function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staleness = c.slot === null ? ONE : swingStaleness(attacker, c.slot).damage;
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const charged = mul(c.hitbox.damage, c.chargeScale);
  const base = shortHopped ? mul(charged, SHORT_HOP_DAMAGE) : charged;
  const staled = mul(base, staleness);
  return s.rules.oneOnOne ? mul(staled, ONE_ON_ONE_MULTIPLIER) : staled;
}

function applyInvincibleHit(
  s: GameState,
  attacker: FighterState,
  victim: FighterState,
  c: Candidate,
  events: StepEvents,
): void {
  recordHit(c, attacker, victim.port);
  if (c.hitbox.grabbing) return;
  // The freeze is computed from the *same* adjusted damage an ordinary hit would
  // use — staleness, short hop and the 1v1 bonus included. Hitlag is a property
  // of the swing, not of whether its consequences landed, so a stale aerial that
  // meets an invincible respawn should freeze for exactly as long as one that
  // meets a vulnerable fighter. Reading raw damage here made the freeze wrong in
  // precisely the situations where the attacker most needs it to be predictable.
  const lag = computeHitlag(effectiveDamage(s, attacker, c), {
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
  if (c.projectile === null) attacker.hitlag = lag;
  events.hits.push({
    attacker: attacker.port,
    victim: victim.port,
    damage: 0,
    x: c.x,
    y: c.y,
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
  if (f.combat.autolink) {
    releaseAutolink(f);
    return;
  }
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
  // DI and LSI only act on a launch that tumbles and is not within 0.17 rad of
  // straight ahead (rubendal Sm4sh-Calculator wiki "DI and LSI calculation",
  // https://github.com/rubendal/Sm4sh-Calculator/wiki/DI-and-LSI-calculation:
  // "Conditions for DI: … the attack causes tumble; launch angle is greater than
  // 9.74°" — Ultimate "reuses the directional influence mechanics" of Smash 4,
  // SmashWiki "Directional influence"; rubendal SSBU-Calculator `js/knockback.js`
  // computes LSI only inside `di_able`). Tumble is the *base* hitstun's call: a
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
  // reduction"; Task 16 review, Minor 7). UNVERIFIED: that the 0.8 a mid-flight
  // bounce takes off the hitstun (`BOUNCE_HITSTUN_RATIO`, the param
  // `damage_fly_reflect_reaction_frame_mul`) does not apply to this one, and
  // that the bounced launch keeps the speed-up and set weight's fall a
  // mid-flight bounce disarms (`kineticReflect`): it is the launch itself.
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
    pointX: pull ? c.x + Math.trunc(c.dx / 2) : 0,
    pointY: pull ? c.y + Math.trunc(c.dy / 2) : 0,
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
 * Freeze `victim` for `lag` frames as the fighter a hit landed on: the one freeze
 * SDI and ASDI act in (`CombatState.victimFreeze`; Plan 3 final wave). A hit with
 * no freeze leaves nothing to SDI in.
 */
function freezeVictim(victim: FighterState, lag: number): void {
  victim.hitlag = lag;
  victim.combat.victimFreeze = lag > 0;
}

/**
 * A pummel: damage, a freeze for both fighters, and nothing else (Plan 3, Task
 * 14; Plan 5, Task 7 keeps the name). The victim stays held: no knockback, no
 * hitstun, no release and no status change, and the escape timer is untouched
 * (SmashWiki "Grab": the grab time is "not affected by pummeling"; "Pummel":
 * pummels "continue until the opponent is eventually thrown or breaks free"). It
 * goes through the same staleness and 1v1 scaling as any hit, and joins the
 * staleness queue (SmashWiki "Pummel": pummelling is how a stale move is
 * restored). Being hit gives back the air dodge, as `applyHit` does.
 */
function applyHeldHit(
  s: GameState,
  attacker: FighterState,
  victim: FighterState,
  c: Candidate,
  events: StepEvents,
): void {
  const hb = c.hitbox;
  recordHit(c, attacker, victim.port);
  const damage = effectiveDamage(s, attacker, c);
  enterStaleQueue(attacker, c.slot, false);
  victim.damage += damage;
  victim.airDodged = false;
  const lag = computeHitlag(damage, { electric: hb.effect === "electric", moveMultiplier: hb.hitlagMultiplier });
  freezeVictim(victim, lag);
  attacker.hitlag = lag;
  events.hits.push({
    attacker: attacker.port,
    victim: victim.port,
    damage,
    x: c.x,
    y: c.y,
    knockback: 0,
    angle: 0,
    hitboxId: hb.id,
  });
}

/**
 * The facing a launch is measured from. Everything launches the way its box
 * points from the attacker's facing, except a back throw, which launches behind
 * the thrower. UNVERIFIED: a stand-in for the game's `REVERSE_LR` (Plan 5, Task
 * 7). The roster's legacy back-throw angles are mixed: Link's, Kirby's, Pikachu's
 * and Marth's are authored behind already (over 90°), Mario's, Donkey Kong's,
 * Samus's and Fox's point forward, so only a forward-pointing one is turned round.
 */
function launchFacing(c: Candidate, attacker: FighterState): number {
  if (c.slot !== "bthrow") return attacker.facing;
  const pointsForward = c.hitbox.angle < fx(90) || c.hitbox.angle > fx(270);
  return pointsForward ? -attacker.facing : attacker.facing;
}

/**
 * The facing a hit's launch is measured from. A box with no LR rule launches
 * forwards (`launchFacing`: the way its owner faces, or the way its projectile
 * points). `ATTACK_LR_CHECK_POS` launches away from the attacker by position,
 * and `ATTACK_LR_CHECK_B` backwards (Plan 3, Task 16).
 *
 * A box that carries its own rule replaces `launchFacing`'s back-throw
 * stand-in, which exists for the legacy tables, whose angles say nothing (a
 * back throw that said `_B` would otherwise be turned round twice). UNVERIFIED:
 * that reading; Plan 5, Task 7 replaces the stand-in with `REVERSE_LR`.
 */
function launchSourceFacing(c: Candidate, attacker: FighterState, victim: FighterState): number {
  const hb = c.hitbox;
  const forward = c.projectile !== null ? c.projectile.facing : attacker.facing;
  if (hb.lr === undefined) return c.projectile !== null ? forward : launchFacing(c, attacker);
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
  victim: FighterState,
  victimDef: FighterDef,
  c: Candidate,
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
    // The escape timer, fixed now, on the victim (Plan 3, Task 14).
    victim.grabTimer = grabHoldFrames(victim.damage);
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
  let kbDamage = mul(baseDamage, staleness.knockback);
  if (s.rules.oneOnOne) {
    damage = mul(damage, ONE_ON_ONE_MULTIPLIER);
    kbDamage = mul(kbDamage, ONE_ON_ONE_MULTIPLIER);
  }

  // A move joins the staleness queue once per swing, on its first connection —
  // a shield hit included, marked so it stales at 0.85 (SmashWiki "Stale-move
  // negation": hitting a shield enters the queue in Ultimate, perfect shield too).
  // The hit must reach the shield bubble too: a worn shield shrinks to 15% of
  // its radius and a hit that misses it lands on the body — a shield poke.
  const onShield = hitReachesShield(victim, victimDef, c);
  enterStaleQueue(attacker, c.slot, onShield);

  /* ---- the shield path ---- */
  if (onShield) {
    const lag = computeHitlag(damage, {
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
    const stunExact = shieldstunExact(damage, stunOpts);
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
      // one left standing there — frozen longer than the defender, by the
      // published amounts on top of the *shield* hitlag (SmashWiki "Perfect
      // shield": the defender "can act 3 frames earlier than shielding the attack
      // normally"; rubendal's `ParryHitlag` disagrees on the melee rows, see
      // `PARRY_MELEE_*`). Pushback carries the 0.15 inside its formula, before the
      // 1.3 cap. A parried projectile freezes nobody a stage away.
      const parry = perfectShieldHitlag(lag, fromProjectile, hb.direct ?? !fromProjectile);
      freezeVictim(victim, parry.defender);
      if (!fromProjectile) attacker.hitlag = parry.attacker;
      kineticSetX(victim, away * shieldPushback(stunExact, true), "stop");
      if (!fromProjectile && attacker.grounded) kineticSetX(attacker, -away * attackerShieldPushback(damage));
      events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
      return;
    }
    victim.shieldHealth -= shieldDamage(damage);
    victim.hitstun = computeShieldstun(damage, stunOpts);
    freezeVictim(victim, lag);
    if (!fromProjectile) attacker.hitlag = lag;
    kineticSetX(victim, away * shieldPushback(stunExact), "stop");
    // A melee attacker on the ground slides back off the shield too; a
    // projectile's owner is not there to be pushed (rubendal `AttackerShieldPushback`).
    if (!fromProjectile && attacker.grounded) kineticSetX(attacker, -away * attackerShieldPushback(damage));
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
  victim.damage += damage;
  // "Characters can only air dodge once until they land, get hit, or grab a
  // ledge" (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge). Plan 3, Task 7.
  victim.airDodged = false;

  /* ---- the super-armour path ---- */
  //
  // Armour is not invincibility and not a shield: the damage lands in full and
  // the fighter simply refuses to be moved by it. That is the whole identity of
  // a move like Giant Punch — you walk through the jab and land the punch — and
  // it is why armour has to sit here, after damage and before knockback, rather
  // than at the top with the intangibility checks. The damage was added once,
  // above; adding it again here doubled every armoured hit (Plan 3, Task 1).
  if (hasSuperArmour(victim, victimDef)) {
    // The attacker still freezes. Hitting armour should feel like hitting
    // something solid, and a hit that reports nothing back reads as a whiff.
    const lag = computeHitlag(damage, {
      electric: hb.effect === "electric",
      moveMultiplier: hb.hitlagMultiplier,
    });
    if (!fromProjectile) attacker.hitlag = lag;
    events.hits.push({
      attacker: attacker.port,
      victim: victim.port,
      damage,
      x: c.x,
      y: c.y,
      knockback: 0,
      angle: 0,
      hitboxId: hb.id,
    });
    return;
  }

  const crouchCancel = isCrouching(victim);

  // Set knockback runs the formula on the box's `fkb` with the victim's weight;
  // set weight makes that weight 100, in either formula (Plan 3, Task 16b).
  const kb = computeKnockback({
    percent: victim.damage,
    damage: kbDamage,
    weight: victimDef.attributes.weight,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
    rage: computeRage(attacker.damage),
    crouchCancel,
    fixedKnockback: hb.fixedKnockback,
    setWeight: hb.setWeight,
  });

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
  const lag = computeHitlag(damage, {
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
    freezeVictim(victim, Math.max(victim.hitlag, lag));
    if (!fromProjectile) attacker.hitlag = lag;
    events.hits.push({
      attacker: attacker.port,
      victim: victim.port,
      damage,
      x: c.x,
      y: c.y,
      knockback: verdict === "keep" ? kb : 0,
      angle: 0,
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
  victim.combat.asdi = lag > 0 && (hb.effect === "electric" || hb.effect === "paralyze") && !vertical;
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;
  parkAutolink(victim, hb, c, attacker);
  // Which way the launch goes, for the spark: fixed now, because a hit with no
  // freeze fires (and clears) it below. An autolink points along its own vector,
  // as it stands at contact (the victim may SDI before it is computed for real).
  const link = victim.combat.autolink ? autolinkVector(parkedAutolink(victim.combat), victim.x, victim.y) : null;
  const linkAngle = link !== null ? vectorWorldAngle(link.vx, link.vy, sourceFacing) : null;

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
  if (!fromProjectile) attacker.hitlag = lag;
  // A hit with no freeze at all has no window to react in, so its DI is decided
  // on the contact frame after all — which is the same rule, at length zero.
  if (lag <= 0) releasePendingLaunch(victim, victimIntent);

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
    knockback: kb,
    // The un-DI'd direction. DI has not been chosen yet — it is sampled on the
    // last frame of hitlag — so this is the launch as the *hit* set it, which
    // is the right thing for a graphic that fires on the contact frame.
    angle: linkAngle ?? launchWorldAngle(victim.pendingAngle, victim.pendingFacing),
    hitboxId: hb.id,
  });
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
    // A pummel or a throw hits the fighter held and nothing else.
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
