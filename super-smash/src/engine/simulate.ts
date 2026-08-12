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

import { ONE, fx, mul, abs, randomInt, nextRandom } from "./fixed";
import {
  FINAL_SMASH_STANDBY,
  LEDGE_REGRAB_LIMIT,
  ONE_ON_ONE_MULTIPLIER,
  SDI_DISTANCE,
  SHIELD_BREAK_STUN,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
  SHORT_HOP_DAMAGE,
  SMASH_BALL_DECAY,
  SMASH_BALL_DECAY_INTERVAL,
  SMASH_BALL_HEALTH,
  SMASH_BALL_SPAWN_INTERVAL,
  TUMBLE_HITSTUN,
} from "./constants";
import {
  computeHitlag,
  computeHitstun,
  computeKnockback,
  computeRage,
  computeShieldstun,
  computeStaleness,
  applyDI,
  applyLSI,
  lsiApplies,
  knockbackToVelocity,
  resolveAngle,
} from "./knockback";
import {
  SMASH_BALL_TARGET,
  activeHitboxes,
  alreadyHit,
  circle,
  circlesOverlap,
  clearHitRecord,
  hitboxWorldPos,
  hurtboxCapsule,
  markHit,
  resolveClank,
  sweptHitboxOverlaps,
} from "./hitbox";
import {
  advanceProjectile,
  cloneProjectile,
  findProjectileDef,
  markProjectileHit,
  projectileAlreadyHit,
  projectileHitboxActive,
  projectilesDueOnFrame,
  spawnProjectile,
} from "./projectile";
import {
  blastZoneKO,
  findLedgeGrab,
  integrate,
  ledgeIntangibilityFrames,
  ledgePosition,
  resolveCollision,
} from "./physics";
import {
  ENTRY_FRAMES,
  advanceFighter,
  applyMovement,
  chargeMultiplier,
  grabLedge,
  interpretInput,
  isParrying,
  onLanded,
  onLeftGround,
  releaseGrab,
  shieldCovers,
  startAction,
  updateInputTracking,
} from "./states";
import type { Intent, StateContext } from "./states";
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

export function registerFighters(defs: readonly FighterDef[]): void {
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
      airTime: 0,
      finalSmashReady: 0,
      staleQueue: [],
      hitThisMove: [],
      framesSinceDirPress: 999,
      lastDirPressed: 0,
      bufferedAction: null,
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
/** Extra frames an attacker eats for having its move parried. */
export const PARRY_PUNISH_FRAMES = 20;
/** Pushback applied to a shielding fighter, per point of damage absorbed. */
export const SHIELD_PUSHBACK = fx(0.06);
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
  /** The move this came from, or null when the source is a projectile. */
  readonly slot: MoveSlot | null;
  readonly projectile: ProjectileState | null;
  /** Charge scaling already resolved: Samus's shot, or a charged smash. */
  readonly chargeScale: number;
  readonly destroyOnHit: boolean;
  suppressed: boolean;
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
  // charge frame would launch one every frame of the charge.
  const beforeActionFrame = s.fighters.map((f) => f.actionFrame);

  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    const intent = intents[i];

    if (f.intangible > 0) f.intangible -= 1;
    if (f.invincible > 0) f.invincible -= 1;

    if (f.hitlag > 0) {
      // Frozen on contact. The only thing a victim may do is SDI — one pulse
      // per fresh direction press, at most one every four frames — which is why
      // mashing during the crunch works exactly as it does in the real game.
      f.hitlag -= 1;
      frozen[i] = true;
      if (intent.sdiX !== 0 || intent.sdiY !== 0) {
        f.x += intent.sdiX * SDI_DISTANCE;
        f.y += intent.sdiY * SDI_DISTANCE;
      }
      // ...and then, on the frame the freeze ends, the launch it was holding
      // back finally happens — bent by whichever direction is held *now*. The
      // fighter stays frozen for the rest of this frame, so the velocity first
      // applies on the next one, exactly as it did when it was set on contact.
      if (f.hitlag === 0) releasePendingLaunch(f, intent);
      continue;
    }

    if (f.hitstun > 0) f.hitstun -= 1;
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

  /* -- 4. physics ---------------------------------------------------------- */

  const preIntegrate = s.fighters.map((f) => ({ x: f.x, y: f.y }));
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.action === "dead") continue;
    applyMovement(f, intents[i], stateCtx(i));
    preIntegrate[i] = { x: f.x, y: f.y };
    integrate(f);
  }

  /* -- 5. platforms and ledges --------------------------------------------- */

  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.action === "dead" || f.action === "respawnPlatform") continue;
    if (f.ledge !== null) continue; // hanging: the ledge holds you, not the floor

    const outcome = resolveCollision(
      f,
      preIntegrate[i].x,
      preIntegrate[i].y,
      stage,
      defs[i].attributes,
      s.frame,
    );
    if (outcome.landed) {
      onLanded(f, stateCtx(i));
      events.lands.push({ port: f.port, x: f.x, y: f.y });
    } else if (outcome.leftGround) {
      onLeftGround(f);
    }

    if (!f.grounded) {
      const grab = findLedgeGrab(f, stage, s.frame);
      if (grab !== null) {
        const pos = ledgePosition(stage, grab, s.frame);
        const frames =
          f.ledgeRegrabs >= LEDGE_REGRAB_LIMIT
            ? 0
            : ledgeIntangibilityFrames(f.airTime, f.damage, f.ledgeRegrabs);
        grabLedge(f, grab.platform, grab.side, pos.x, pos.y, frames);
      }
    }
  }

  /* -- 6. hitboxes: gather, clank, connect --------------------------------- */

  // Projectiles fly, then this frame's launches join them, then everything —
  // fists and arrows alike — goes through one clank pass and one hit pass.
  const projectilePrev = advanceProjectiles(s, defs, stage);
  spawnDueProjectiles(s, defs, beforeActionFrame, projectilePrev);

  const destroyed = new Set<number>();
  const candidates = gatherHitboxes(s, defs, prevPos, frozen);
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
        f.hitstun = SHIELD_BREAK_STUN;
        events.shieldBreaks.push(f.port);
      }
    } else if (f.shieldHealth < SHIELD_MAX_HEALTH) {
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
    f.vx = 0;
    f.vy = 0;
    f.hitstun = 0;
    f.hitlag = 0;
    f.launchSpeed = 0;
    f.balloon = false;
    clearPendingLaunch(f);
    f.grounded = false;
    f.platform = -1;
    f.ledge = null;
    f.ledgeRegrabs = 0;
    // Both ends, in both directions: a KO'd fighter may have been holding
    // someone *or* be held by someone, and clearing only its own half of the
    // link strands the other fighter in `grabbed` for the rest of the match.
    releaseGrab(f, s.fighters);
    f.shieldHealth = SHIELD_MAX_HEALTH;
    f.staleQueue.length = 0;
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

/* ------------------------------------------------------------- hit phases -- */

function gatherHitboxes(
  s: GameState,
  defs: readonly FighterDef[],
  prevPos: readonly { x: number; y: number }[],
  frozen: readonly boolean[],
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (frozen[i] || f.move === null) continue;
    if (!hasLiveMove(f.action)) continue;
    const move = defs[i].moves[f.move];
    if (move === undefined) continue;
    // `actionFrame` counts from zero on the frame the move starts, so the move's
    // own frame 1 — the number the frame data is quoted in — is one higher.
    for (const hb of activeHitboxes(move, f.actionFrame + 1)) {
      const now = hitboxWorldPos(f.x, f.y, f.facing, hb);
      const was = hitboxWorldPos(prevPos[i].x, prevPos[i].y, f.facing, hb);
      out.push({
        attacker: i,
        hitbox: hb,
        x: now.x,
        y: now.y,
        prevX: was.x,
        prevY: was.y,
        slot: f.move,
        projectile: null,
        chargeScale: chargeMultiplier(f.charge),
        destroyOnHit: false,
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

/** Launch anything whose move reached its spawn frame this tick. */
function spawnDueProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  beforeActionFrame: readonly number[],
  prev: PrevPositions,
): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (f.move === null) continue;
    if (!hasLiveMove(f.action)) continue;
    // A held charge freezes the animation frame; nothing may spawn off a frame
    // the move did not actually advance onto.
    if (f.actionFrame === beforeActionFrame[i]) continue;
    const move = defs[i].moves[f.move];
    if (move === undefined) continue;
    for (const def of projectilesDueOnFrame(move, f.actionFrame + 1)) {
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
      slot: null,
      projectile: p,
      chargeScale: p.chargeScale,
      destroyOnHit: def.destroyOnHit === true,
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
      if (ca.suppressed && cb.suppressed) continue;
      if (!circlesOverlap(ca.x, ca.y, ca.hitbox.radius, cb.x, cb.y, cb.hitbox.radius)) continue;
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
  f.vx = -f.facing * fx(0.5);
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
 * down the shield path instead, where a parry costs the attacker rather than the
 * defender.
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
      if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
      if (recordSaysAlreadyHit(s, c, victim.port)) continue;
      if (!sweptHitboxOverlaps(c.prevX, c.prevY, c.x, c.y, c.hitbox.radius, hurtbox)) continue;
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
      // Invincible: the fighter *is* there and the hit connects. It is only the
      // consequences that do not land. See `FighterState.invincible`.
      if (victim.invincible > 0) applyInvincibleHit(s, attacker, victim, c, events);
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

function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staleness =
    c.slot === null ? ONE : computeStaleness(attacker.staleQueue, c.slot).damage;
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
 * fighter's position and this decides their velocity.
 *
 * Everything is in attacker-relative space, so the stick is mirrored by the
 * facing the launch was authored against before it is read.
 */
function releasePendingLaunch(f: FighterState, intent: Intent): void {
  if (f.pendingFacing === 0) return;
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
  const angle = applyDI(f.pendingAngle, relStick, intent.y);
  const launch = knockbackToVelocity(f.pendingKnockback, angle, facing);
  // LSI is a survival tool, not a damage buff: it only touches knockback heavy
  // enough to tumble. Without the gate, holding up scales *every* jab by 1.095×
  // and holding down shrinks it by 0.92×, which is a mechanic the game does not
  // have. `hitstun` still holds the full value from the hit here — the hitlag
  // branch that leads to this call never decrements it. See `lsiApplies`.
  const speed = lsiApplies(f.hitstun) ? applyLSI(launch.speed, intent.y, angle) : launch.speed;
  // The one moment the balloon question has an answer: the angle this launch
  // actually goes out at, DI included. See `FighterState.balloon`.
  f.balloon = launch.balloon;

  if (launch.speed > 0) {
    f.vx = Math.trunc((launch.vx * speed) / launch.speed);
    f.vy = Math.trunc((launch.vy * speed) / launch.speed);
  } else {
    f.vx = 0;
    f.vy = 0;
  }
  f.launchSpeed = speed;
  // Whether the launch takes the victim off the ground is a DI question too: a
  // flat Sakurai-angle hit that gets DI'd upward leaves the floor, and the same
  // hit without DI slides along it.
  if (f.vy > 0 && f.grounded) {
    f.grounded = false;
    f.platform = -1;
  }
  clearPendingLaunch(f);
}

function clearPendingLaunch(f: FighterState): void {
  f.pendingKnockback = 0;
  f.pendingAngle = 0;
  f.pendingFacing = 0;
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
    victim.vx = 0;
    victim.vy = 0;
    // Being caught cancels a launch that had not fired yet: the victim is held,
    // not flying, and a pending launch would go off in their captor's hands.
    clearPendingLaunch(victim);
    startAction(victim, "grabbed");
    return;
  }

  // A projectile is already in the air, so nothing about the swing that launched
  // it still applies: its charge was baked in at launch, and it does not stale —
  // the staleness queue is keyed by move slot and an arrow has left its move.
  const staleness =
    c.slot === null ? { damage: ONE, knockback: ONE } : computeStaleness(attacker.staleQueue, c.slot);
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

  // A move joins the staleness queue once per swing, on its first connection.
  if (c.slot !== null && attacker.hitThisMove.length === 1) {
    attacker.staleQueue.unshift(c.slot);
    if (attacker.staleQueue.length > 9) attacker.staleQueue.length = 9;
  }

  /* ---- the shield path ---- */
  if (shieldCovers(victim, c.x)) {
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
      // one left standing there. This is the whole reward for shielding on
      // release rather than on press — though parrying a projectile punishes
      // nobody, since the fighter who threw it is a stage away.
      if (!fromProjectile) attacker.hitlag = Math.max(attacker.hitlag, PARRY_PUNISH_FRAMES);
      events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
      return;
    }
    const lag = computeHitlag(damage, {
      electric: hb.effect === "electric",
      shielding: true,
      moveMultiplier: hb.hitlagMultiplier,
    });
    victim.shieldHealth -= damage;
    victim.hitstun = computeShieldstun(damage, {
      smash: c.slot !== null && isSmashSlot(c.slot),
      aerial: c.slot !== null && isAerialSlot(c.slot),
      // A projectile takes a further 0.29 off shieldstun, so a zoner cannot
      // freeze a shield from across the stage.
      projectile: fromProjectile,
      moveMultiplier: hb.shieldstunMultiplier,
    });
    victim.hitlag = lag;
    if (!fromProjectile) attacker.hitlag = lag;
    victim.vx = (victim.x < c.x ? -1 : 1) * mul(damage, SHIELD_PUSHBACK);
    if (victim.shieldHealth <= 0) {
      victim.shieldHealth = 0;
      startAction(victim, "shieldBroken");
      victim.hitstun = SHIELD_BREAK_STUN;
      events.shieldBreaks.push(victim.port);
    } else {
      startAction(victim, "shieldStun");
    }
    events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
    return;
  }

  /* ---- the damage path ---- */
  victim.damage += damage;

  const crouchCancel = isCrouching(victim);

  const kb = computeKnockback({
    percent: victim.damage,
    damage: kbDamage,
    weight: victimDef.attributes.weight,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
    rage: computeRage(attacker.damage),
    crouchCancel,
    groundedMeteor: hb.meteor === true && victim.grounded,
    setKnockback: hb.setKnockback,
  });

  const hitstun = computeHitstun(kb);
  // Crouch cancel shortens the freeze for *both* fighters (research §4), which
  // is why one `lag` is computed and handed to each of them below rather than
  // one each: crouching does not buy the defender a frame advantage, it makes
  // the whole exchange snappier.
  const lag = computeHitlag(damage, {
    electric: hb.effect === "electric",
    crouchCancel,
    moveMultiplier: hb.hitlagMultiplier,
  });

  // The launch is *parked*, not applied: Ultimate samples DI on the last frame
  // of hitlag, so the direction that bends this angle has not been chosen yet.
  // Everything the hit itself already fixes — the launch's magnitude and its
  // un-DI'd angle — is computed here; the stick is read in
  // `releasePendingLaunch` when the freeze ends. A player who was already
  // holding a direction gets the same answer either way, which is exactly why
  // the difference only shows up for the player who is *reacting*.
  //
  // A projectile launches along the way *it* is pointing, which is the facing its
  // thrower had when it left rather than whichever way they happen to be looking
  // now — the arrow does not turn round when Link does.
  const sourceFacing = c.projectile !== null ? c.projectile.facing : attacker.facing;
  victim.pendingKnockback = kb;
  victim.pendingAngle = resolveAngle(hb, victim.grounded);
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

  victim.hitstun = hitstun;
  victim.hitlag = lag;
  victim.intangible = 0;
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
  startAction(victim, hitstun >= TUMBLE_HITSTUN ? "tumble" : "hitstun");

  events.hits.push({
    attacker: attacker.port,
    victim: victim.port,
    damage,
    x: c.x,
    y: c.y,
    knockback: kb,
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
    if (c.suppressed) continue;
    const attacker = s.fighters[c.attacker];
    if (alreadyHit(attacker, SMASH_BALL_TARGET)) continue;
    if (!sweptHitboxOverlaps(c.prevX, c.prevY, c.x, c.y, c.hitbox.radius, target)) continue;
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
