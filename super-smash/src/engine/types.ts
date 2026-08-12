/**
 * The contract every part of the game agrees on.
 *
 * The renderer, the CPU, the netcode and the UI all read these shapes and none
 * of them may mutate simulation state outside `step()`. Every numeric field
 * marked "fixed" is a Q12 fixed-point integer (see `fixed.ts`); every field
 * marked "frames" is a whole number of 60Hz simulation frames.
 */

/* ------------------------------------------------------------------ input -- */

/**
 * One frame of one player's input, as a bitfield.
 *
 * A bitfield rather than an object because this is the thing that goes over the
 * wire 60 times a second, and because rollback compares inputs for equality on
 * every packet — an integer compare is one instruction, a deep object compare is
 * a function call. The directional bits are the raw key states; the *meaning*
 * of a direction (walk vs. dash, tilt vs. smash) is derived inside the
 * simulation from how long the bit has been held, never by the input layer.
 * See SPEC §6.
 */
export const enum Btn {
  Left = 1 << 0,
  Right = 1 << 1,
  Up = 1 << 2,
  Down = 1 << 3,
  Attack = 1 << 4,
  Special = 1 << 5,
  Shield = 1 << 6,
  Jump = 1 << 7,
  Grab = 1 << 8,
}

/** A packed input frame. Zero means "no keys held". */
export type InputFrame = number;

export function held(input: InputFrame, b: Btn): boolean {
  return (input & b) !== 0;
}

/** True when `b` went down this frame — i.e. is held now and was not before. */
export function pressed(input: InputFrame, prev: InputFrame, b: Btn): boolean {
  return (input & b) !== 0 && (prev & b) === 0;
}

/** True when `b` came up this frame. */
export function released(input: InputFrame, prev: InputFrame, b: Btn): boolean {
  return (input & b) === 0 && (prev & b) !== 0;
}

/** Horizontal component of the "stick", as -1, 0 or 1. */
export function stickX(input: InputFrame): number {
  const l = held(input, Btn.Left) ? 1 : 0;
  const r = held(input, Btn.Right) ? 1 : 0;
  return r - l;
}

/** Vertical component of the "stick", as -1 (down), 0 or 1 (up). */
export function stickY(input: InputFrame): number {
  const d = held(input, Btn.Down) ? 1 : 0;
  const u = held(input, Btn.Up) ? 1 : 0;
  return u - d;
}

/* ----------------------------------------------------------- action state -- */

/**
 * What a fighter is doing. This is the spine of the simulation: every frame,
 * exactly one of these is true, and it determines which inputs are even legal.
 */
export type ActionState =
  // grounded neutral
  | "stand"
  | "walk"
  | "dashStart"
  | "run"
  | "runBrake"
  | "turnaround"
  | "crouchStart"
  | "crouch"
  | "crouchEnd"
  // airborne
  | "jumpSquat"
  | "jump"
  | "fall"
  | "land"
  | "landingLag"
  // offence
  | "attack"
  | "special"
  | "grab"
  | "grabHold"
  | "pummel"
  | "throw"
  // defence
  | "shieldStart"
  | "shield"
  | "shieldRelease"
  | "shieldStun"
  | "shieldBroken"
  | "spotDodge"
  | "roll"
  | "airDodge"
  // reeling
  | "hitstun"
  | "tumble"
  | "grabbed"
  | "thrown"
  | "downed"
  | "getUp"
  // ledge
  | "ledgeHang"
  | "ledgeGetUp"
  | "ledgeAttack"
  | "ledgeRoll"
  | "ledgeJump"
  // meta
  | "respawnPlatform"
  | "dead"
  | "entering";

/** Which slot a move occupies in the universal Smash moveset. */
export type MoveSlot =
  | "jab1"
  | "jab2"
  | "jab3"
  | "rapidJab"
  | "ftilt"
  | "utilt"
  | "dtilt"
  | "dashAttack"
  | "fsmash"
  | "usmash"
  | "dsmash"
  | "nair"
  | "fair"
  | "bair"
  | "uair"
  | "dair"
  | "neutralB"
  | "sideB"
  | "upB"
  | "downB"
  | "grab"
  | "dashGrab"
  | "pummel"
  | "fthrow"
  | "bthrow"
  | "uthrow"
  | "dthrow"
  | "ledgeAttack"
  | "getUpAttack"
  | "finalSmash";

/** Non-damage properties a hit can carry. Drives VFX, hitlag and reactions. */
export type HitEffect =
  | "normal"
  | "electric"
  | "fire"
  | "slash"
  | "stab"
  | "darkness"
  | "aura"
  | "freeze"
  | "bury"
  | "paralyze";

/* --------------------------------------------------------------- hitboxes -- */

export interface Hitbox {
  /** Lower id wins when two of a fighter's own hitboxes overlap a target. */
  readonly id: number;
  /** First and last frame of the move on which this hitbox is live. */
  readonly startFrame: number;
  readonly endFrame: number;
  /** Offset from the fighter's origin, facing-relative. Fixed. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Percent, fixed. */
  readonly damage: number;
  /**
   * Launch angle in fixed degrees, measured counter-clockwise from "directly
   * in front of the attacker". 361 (`SAKURAI_ANGLE`) means the angle depends on
   * whether the victim is grounded or airborne.
   */
  readonly angle: number;
  readonly baseKnockback: number;
  readonly knockbackGrowth: number;
  readonly effect?: HitEffect;
  /** Knockback is a fixed value, unaffected by percent, rage or weight. */
  readonly setKnockback?: boolean;
  /** Passes through opposing hitboxes rather than clanking with them. */
  readonly transcendent?: boolean;
  /** Per-move hitlag scaling. 1.0 (`ONE`) unless stated. */
  readonly hitlagMultiplier?: number;
  /** Per-move shieldstun scaling. 1.0 (`ONE`) unless stated. */
  readonly shieldstunMultiplier?: number;
  /** Drives downward regardless of the victim's position. */
  readonly meteor?: boolean;
  /** This hitbox grabs rather than damages. */
  readonly grabbing?: boolean;
}

/**
 * Something a move launches that outlives it.
 *
 * This exists because three of the eight fighters are *defined* by it — Link's
 * bomb, boomerang and arrow, Samus's charge shot, Pikachu's Thunder Jolt — and
 * a projectile cannot be modelled as a hitbox on its move. A hitbox belongs to
 * the animation and dies with it; an arrow keeps flying for a second after Link
 * is free to act again. Encoding one as the other either freezes the fighter
 * for the arrow's whole flight or deletes the arrow the moment he can move.
 *
 * So a projectile is a separate entity with its own position and lifetime,
 * spawned on a named frame of the move and thereafter independent of it.
 */
export interface ProjectileDef {
  readonly id: string;
  /** Frame of the parent move on which this spawns. */
  readonly spawnFrame: number;
  /** Spawn offset from the fighter's origin, facing-relative. Fixed. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Initial velocity. `vx` is facing-relative; `vy` is absolute. Fixed. */
  readonly vx: number;
  readonly vy: number;
  /** Per-frame downward acceleration. Zero for a laser, non-zero for a bomb. */
  readonly gravity: number;
  /** Frames before it expires on its own. */
  readonly lifetime: number;
  /** Damage and knockback. `startFrame`/`endFrame` are relative to the spawn. */
  readonly hitbox: Hitbox;
  /** Disappears on its first hit. False for a boomerang or a lingering flame. */
  readonly destroyOnHit?: boolean;
  /** Bounces off surfaces this many times before expiring. */
  readonly bounces?: number;
  /** Returns to its owner partway through its life, like a boomerang. */
  readonly returns?: boolean;
  /** Charge scales damage and speed by up to this multiplier at full charge. */
  readonly chargeScaling?: number;
  /** Drawing hint for the renderer. */
  readonly visual: "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";
}

export interface MoveDef {
  readonly slot: MoveSlot;
  readonly name: string;
  /** First Actionable Frame — the move ends and the fighter may act again. */
  readonly totalFrames: number;
  readonly hitboxes: readonly Hitbox[];
  /** Aerials only: frames of lag if the move is still out on landing. */
  readonly landingLag?: number;
  /** Aerials only: landing at or before/after these frames cancels cleanly. */
  readonly autoCancelBefore?: number;
  readonly autoCancelAfter?: number;
  /** Smash attacks may be held to charge. */
  readonly chargeable?: boolean;
  /** Frames the fighter may not be interrupted, for specials with armour. */
  readonly superArmourFrames?: readonly [number, number];
  /** A jab that loops until the button is released. */
  readonly rapid?: boolean;
  /** Which move follows this one if the button is pressed again in time. */
  readonly followUp?: MoveSlot;
  /** Horizontal impulse applied on the given frame — dash attacks, side-Bs. */
  readonly momentum?: readonly { frame: number; x: number; y: number }[];
  /** What this move launches, if anything. See `ProjectileDef`. */
  readonly projectiles?: readonly ProjectileDef[];
}

/* --------------------------------------------------------------- fighters -- */

export interface FighterAttributes {
  /** Ultimate's weight stat. Mario 98, Bowser 135, Jigglypuff 68. */
  readonly weight: number;
  /** All fixed-point, units per frame. */
  readonly walkSpeed: number;
  readonly initialDashSpeed: number;
  readonly runSpeed: number;
  readonly airSpeed: number;
  readonly airAccelBase: number;
  readonly airAccelAdditional: number;
  readonly gravity: number;
  readonly fallSpeed: number;
  readonly fastFallSpeed: number;
  /** Deceleration per frame on the ground, fixed. */
  readonly traction: number;
  /** Initial upward velocity, fixed. */
  readonly fullHopVelocity: number;
  readonly shortHopVelocity: number;
  readonly airJumpVelocity: number;
  readonly jumps: number;
  readonly canWallJump: boolean;
  /** Half-width and height of the fighter's hurtbox, fixed. */
  readonly width: number;
  readonly height: number;
  /** Frames of jumpsquat. Universally 3 in Ultimate. */
  readonly jumpSquatFrames: number;
}

export interface FighterDef {
  readonly id: string;
  readonly name: string;
  /** Series the fighter comes from, shown on the CSS and results screen. */
  readonly series: string;
  /** Fighter number, which is what the CSS orders by. */
  readonly number: number;
  readonly attributes: FighterAttributes;
  readonly moves: Readonly<Partial<Record<MoveSlot, MoveDef>>>;
  /** Palette used by the procedural renderer. See `render/characterArt.ts`. */
  readonly palette: FighterPalette;
  /** One-line description shown on the character select screen. */
  readonly blurb: string;
}

export interface FighterPalette {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly skin: string;
  readonly outline: string;
  /** Alternate costumes: each remaps primary/secondary/accent. */
  readonly alts: readonly { primary: string; secondary: string; accent: string }[];
}

/* ----------------------------------------------------------------- stages -- */

export interface Platform {
  /** Centre x, top-surface y, half-width. All fixed. */
  readonly x: number;
  readonly y: number;
  readonly halfWidth: number;
  /** Soft platforms may be dropped through and jumped up through. */
  readonly soft: boolean;
  /** Grabbable ledges at either end. Main platforms have them; soft ones do not. */
  readonly ledges: boolean;
  /** Optional horizontal sweep, for Smashville's moving platform. */
  readonly motion?: {
    readonly kind: "sweep";
    readonly amplitude: number;
    readonly periodFrames: number;
  };
}

export interface StageDef {
  readonly id: string;
  readonly name: string;
  readonly series: string;
  readonly platforms: readonly Platform[];
  readonly blastZone: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  /** Where fighters stand at the start of a match, and where they respawn. */
  readonly spawns: readonly { x: number; y: number }[];
  /** Background rendering hint. See `render/stageArt.ts`. */
  readonly theme: string;
}

/* ------------------------------------------------------------------ state -- */

/** A live hitbox belonging to a fighter, resolved for the current frame. */
export interface ActiveHit {
  readonly owner: number;
  readonly hitbox: Hitbox;
  readonly x: number;
  readonly y: number;
}

export interface FighterState {
  /** Index into `GameState.fighters`; also the player port (0-3). */
  port: number;
  defId: string;
  /** Costume index into the fighter's palette alts. */
  costume: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 for right, -1 for left. */
  facing: number;
  grounded: boolean;
  /** Index into the stage's platforms, or -1 when airborne. */
  platform: number;

  action: ActionState;
  /** Frames elapsed in the current action. */
  actionFrame: number;
  /** The move being performed, when `action` is attack/special/throw. */
  move: MoveSlot | null;
  /** Frames a chargeable smash has been held. */
  charge: number;

  damage: number;
  stocks: number;
  jumpsUsed: number;
  /** Set on leaving the ground; cleared on landing. */
  airDodged: boolean;
  fastFalling: boolean;
  /**
   * This airtime began as a short hop, so its aerials deal 0.85× damage.
   *
   * A field rather than a derived value because nothing else in the state
   * records *how* a fighter got into the air: `vy` has already been changed by
   * gravity and drift a frame later, and the choice was made once, at the end of
   * jumpsquat. Set there, cleared by anything that ends the hop — landing, an
   * air jump, a ledge grab, a respawn. See SPEC §4.
   */
  shortHop: boolean;

  shieldHealth: number;
  /** Frames of shieldstun, hitstun, hitlag remaining. */
  hitstun: number;
  hitlag: number;
  /** Launch speed during tumble, which decays each frame. */
  launchSpeed: number;
  /**
   * A launch parked until the last frame of hitlag, which is when Ultimate
   * samples DI.
   *
   * The knockback and the un-DI'd angle are both fixed by the hit itself, so
   * they are computed on contact and held here; only the *direction the victim
   * is holding* is read later, on the frame the freeze ends. That delay is the
   * whole mechanic — it is what makes DI a reaction to the hit rather than a
   * prediction of it, and it is why hitlag exists at all.
   *
   * `pendingFacing` is the facing the launch is mirrored by (the attacker's, or
   * the projectile's own), and doubles as the flag: it is 0 when nothing is
   * parked and ±1 when something is.
   */
  pendingKnockback: number;
  pendingAngle: number;
  pendingFacing: number;
  /**
   * This launch was near-vertical, so the fall back down is a flat 1.8 rather
   * than the fighter's own gravity — Ultimate's "balloon knockback".
   *
   * Decided **once**, from the launch angle, on the frame the launch fires, and
   * cleared when hitstun ends. It is a field rather than a test on `vx`/`vy`
   * because those change: gravity and the linear launch decay rotate a
   * trajectory continuously, so a hit launched at 45° passes through the
   * 70°–110° cone on its way down and would flip to balloon fall halfway
   * through its own hitstun. The angle at contact is the only moment the
   * question has one answer.
   */
  balloon: boolean;
  /** Frames of intangibility remaining. */
  intangible: number;
  /**
   * Frames of invincibility remaining.
   *
   * Deliberately not the same thing as `intangible`, and the difference is
   * resolved in `simulate.ts`: an *intangible* fighter is not there at all, so
   * a hitbox passes through and nothing happens; an *invincible* one is hit —
   * the hit registers, reports itself and freezes the attacker — but takes no
   * damage, no knockback and no hitstun from it.
   */
  invincible: number;

  /** Port of the fighter holding this one, or -1. */
  grabbedBy: number;
  grabbing: number;
  grabTimer: number;

  /** Ledge currently hung from: platform index and side, or null. */
  ledge: { platform: number; side: number } | null;
  ledgeRegrabs: number;
  airTime: number;

  /** Frames of Final Smash standby remaining, or 0. */
  finalSmashReady: number;

  /** Per-move staleness queue: the last 9 move slots landed. */
  staleQueue: MoveSlot[];
  /** Hitboxes already connected this move, so one swing hits once. */
  hitThisMove: number[];

  /** Frames since the direction was last pressed — drives tilt vs. smash. */
  framesSinceDirPress: number;
  lastDirPressed: number;
  /** Buffered action awaiting a legal frame, and when it was queued. */
  bufferedAction: BufferedAction | null;
}

export type BufferedAction =
  | { kind: "jump"; frame: number }
  | { kind: "attack"; frame: number }
  | { kind: "special"; frame: number }
  | { kind: "shield"; frame: number }
  | { kind: "grab"; frame: number };

/** A projectile in flight. One per launched instance, not per definition. */
export interface ProjectileState {
  /** Unique per instance, so the renderer can track one across frames. */
  instanceId: number;
  defId: string;
  /** Which fighter's move launched it — it cannot hit them. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  /** Frames since it spawned. */
  age: number;
  bouncesLeft: number;
  /** Damage scaling from a charged launch, in fixed-point. `ONE` when uncharged. */
  chargeScale: number;
  /** Ports it has already hit, so one arrow cannot hit the same fighter twice. */
  hitPorts: number[];
  /** Flipped once a returning projectile turns around. */
  returning: boolean;
}

export interface SmashBallState {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  /** Frames until the ball next changes direction. */
  driftTimer: number;
}

export interface ParticleSpawn {
  readonly kind: "hit" | "clank" | "shieldHit" | "koFlash" | "dust" | "smashCharge";
  readonly x: number;
  readonly y: number;
  readonly magnitude: number;
}

export type MatchMode = "stock" | "time";

export interface MatchRules {
  readonly mode: MatchMode;
  readonly stocks: number;
  /** Frames, for time mode. */
  readonly timeLimit: number;
  readonly smashBall: boolean;
  /** Ultimate's 1v1 damage multiplier applies only in a 2-player match. */
  readonly oneOnOne: boolean;
}

/**
 * The whole simulation, in one object.
 *
 * Everything the game can branch on lives here and nowhere else — that is what
 * makes `step()` a pure function and rollback possible at all. Cosmetic state
 * (particles, camera shake, audio) deliberately does *not* live here: it is
 * derived from the events `step()` reports, so re-simulating eight frames after
 * a rollback does not replay eight frames of sound and screen shake.
 */
export interface GameState {
  frame: number;
  rngSeed: number;
  fighters: FighterState[];
  stageId: string;
  rules: MatchRules;
  projectiles: ProjectileState[];
  /** Next instance id to hand out. Part of state so it rolls back too. */
  nextProjectileId: number;
  smashBall: SmashBallState;
  /** Frames remaining in a timed match. */
  timeRemaining: number;
  /** null while playing; set once the match resolves. */
  outcome: MatchOutcome | null;
  /** Frames of global hitstop, for the dramatic freeze on a heavy hit. */
  freezeFrames: number;
}

export interface MatchOutcome {
  readonly kind: "stockOut" | "timeUp" | "suddenDeath";
  /** Ports in finishing order, winner first. */
  readonly placings: readonly number[];
}

/**
 * Everything that happened during one `step()`, for the layers that care about
 * presentation. Never fed back into the simulation.
 */
export interface StepEvents {
  hits: { attacker: number; victim: number; damage: number; x: number; y: number; knockback: number }[];
  shieldHits: { victim: number; x: number; y: number }[];
  clanks: { x: number; y: number }[];
  kos: { port: number; x: number; y: number; kind: "blast" | "star" | "screen" }[];
  jumps: { port: number; x: number; y: number }[];
  lands: { port: number; x: number; y: number }[];
  shieldBreaks: number[];
  smashBallBroken: number | null;
  finalSmashes: number[];
}

export function emptyEvents(): StepEvents {
  return {
    hits: [],
    shieldHits: [],
    clanks: [],
    kos: [],
    jumps: [],
    lands: [],
    shieldBreaks: [],
    smashBallBroken: null,
    finalSmashes: [],
  };
}
