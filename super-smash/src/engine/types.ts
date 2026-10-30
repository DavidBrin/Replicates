/**
 * The contract every part of the game agrees on.
 *
 * The renderer, the CPU, the netcode and the UI all read these shapes and none
 * of them may mutate simulation state outside `step()`. Every numeric field
 * marked "fixed" is a Q12 fixed-point integer (see `fixed.ts`); every field
 * marked "frames" is a whole number of 60Hz simulation frames.
 */

import type { AcmdScript } from "./acmd/types";
import type { CombatState } from "./combat";
import type { KineticState } from "./kinetic";
import type { FighterParams } from "./params";

/* ------------------------------------------------------------------ input -- */

/**
 * One frame of one player's input, as a bitfield.
 *
 * A bitfield rather than an object because this is the thing that goes over the
 * wire 60 times a second, and because rollback compares inputs for equality on
 * every packet — an integer compare is one instruction, a deep object compare is
 * a function call. The directional bits are the raw key states; the *meaning*
 * of a direction (walk vs. dash, tilt vs. smash) is derived inside the
 * simulation from how long the bit has been held, never by the input layer —
 * with one exception, `Btn.Soft`, which only an analog stick can know.
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
  /**
   * The stick is deflected, but not fully: a gamepad's partial tilt.
   *
   * A key is always a full deflection, so the keyboard never sets this. With
   * it, a held direction stays a walk instead of becoming a dash, a fresh
   * direction plus attack is a tilt instead of a smash, and DI bends a quarter
   * as far. It rides the input bitfield, so it crosses the wire and rolls back
   * like every other button.
   */
  Soft = 1 << 9,
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
  // helpless after a recovery move, and its landing (Plan 5, Task 4b)
  | "specialFall"
  | "specialLanding"
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
  | "tumbleFall"
  | "grabbed"
  | "thrown"
  | "downed"
  | "getUp"
  // teching (Plan 3)
  | "tech"
  | "techRoll"
  | "techWall"
  | "techCeiling"
  // ledge
  | "ledgeHang"
  | "ledgeGetUp"
  | "ledgeAttack"
  | "ledgeRoll"
  | "ledgeJump"
  | "ledgeTrumped"
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
  | "finalSmash"
  // Plan 5: what a special turns into (Marth's Counter, `CounterDef.then`).
  | "counterAttack";

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
  /**
   * The far end of an extended hitbox (smash-script `ATTACK`/`CATCH` `X2, Y2, Z2`),
   * facing-relative like `x`/`y`: the box is the capsule between the two, `radius`
   * wide (Plan 3, Task 17). Absent for a sphere. Only a script's hitboxes
   * (`scriptHitboxes`) carry it, and so does a `MoveDef` table that is a
   * script's own boxes (`withReferenceScripts`, Plan 3, Task 18), which the
   * renderer and the CPU read with their far ends. A hand-authored `MoveDef`
   * hitbox the legacy compile reads and a projectile's `hitbox` are spheres,
   * and `registerFighters` refuses one with a far end.
   */
  readonly x2?: number;
  readonly y2?: number;
  readonly radius: number;
  /** Percent, fixed. */
  readonly damage: number;
  /**
   * Launch angle in fixed degrees, measured counter-clockwise from "directly
   * in front of the attacker". 361 (`SAKURAI_ANGLE`) means the angle depends on
   * whether the victim is grounded or airborne, and on the ground on the
   * knockback too (`resolveAngle`). 0° and 180° lift to 32° and 148° from 120
   * knockback (`FLAT_LIFT_KB`), and 363° and 365°-368° are autolink angles, not
   * directions (`AUTOLINK_MIN`, `AUTOLINK_UNMODELLED`).
   */
  readonly angle: number;
  /** Base knockback, the script's `bkb`, in either formula. */
  readonly baseKnockback: number;
  readonly knockbackGrowth: number;
  readonly effect?: HitEffect;
  /**
   * Fixed ("set") knockback, the script's `fkb`. Above 0, the box is set
   * knockback, as a script's is when its `fkb` is not 0 (rubendal
   * SSBU-Calculator: `if (fkb == 0) VSKB(...) else WeightBasedKB(...)`): the
   * knockback formula with the victim's percent replaced,
   * `((((1 + fkb/2) · (200/(w+100)) · 1.4) + 18) · kbg/100) + bkb`. The victim's
   * weight, the growth and `baseKnockback` still count; its percent, the hit's
   * damage, rage and crouch cancel do not (`computeKnockback`; Plan 3, Task 16b).
   * Absent or 0: scaling knockback. It mirrors `AttackParams.fkb`.
   */
  readonly fixedKnockback?: number;
  /** Passes through opposing hitboxes rather than clanking with them. */
  readonly transcendent?: boolean;
  /** Per-move hitlag scaling. 1.0 (`ONE`) unless stated. */
  readonly hitlagMultiplier?: number;
  /** Per-move shieldstun scaling. 1.0 (`ONE`) unless stated. */
  readonly shieldstunMultiplier?: number;
  /**
   * A meteor smash: the box is documented to spike (SmashWiki's "Meteor smashes"
   * lists, or a 230°–310° script angle, `scriptHitboxes`). Since the Plan 3 final
   * wave it gates nothing: every launch that tumbles a grounded victim into the
   * floor bounces it as it fires, meteor or not (`releasePendingLaunch`; Task
   * 16b's rule, widened). It stays as the move's documented kind, for the specials
   * that read it (a bury, Plan 5).
   */
  readonly meteor?: boolean;
  /** `collision_attr_turn` (SmashWiki "Reverse"): the victim is turned round (Plan 5: Cape). */
  readonly reverse?: boolean;
  /**
   * A windbox (Plan 5, Task 6: F.L.U.D.D.): a smash-script `Flinchless=true`
   * box (SmashWiki "Hitbox", https://www.ssbwiki.com/Hitbox: it "prevents the
   * hitbox from inflicting hitstun or hitlag"). SmashWiki "Windbox" (https://www.ssbwiki.com/Windbox):
   * "hitboxes that deal knockback, but cause no hitstun". It pushes by its
   * knockback and does nothing else (no damage, hitstun, hitlag, stale entry or
   * hit event), and a raised shield, a ledge and a counter do not take it the
   * way they take a hit (`applyWindbox`, `simulate.ts`).
   */
  readonly windbox?: boolean;
  /**
   * `AttackModule::set_force_reaction(id, true, …)`: the hit goes through super
   * armour as if there were none (Plan 5, Task 5 fix round 1: Marth's
   * counterattack, SmashWiki "the hitboxes ignore most kinds of armor").
   */
  readonly forceReaction?: boolean;
  /** This hitbox grabs rather than damages. */
  readonly grabbing?: boolean;
  /**
   * smash-script `direct`: the hit comes from the fighter's own body. Absent
   * means direct for a fighter's move and indirect for a projectile — what a
   * perfect shield's hitlag depends on (Plan 3, Task 10).
   */
  readonly direct?: boolean;
  /**
   * smash-script `set_weight`: knockback as if every victim weighed 100
   * (SmashWiki "Knockback", https://www.ssbwiki.com/Knockback: `w` "is set to 100
   * if the attack is weight independent"). Plan 3, Task 16. Its launch falls by
   * gravity 0.087 toward 1.5 for its first 10 frames and is never balloon fall
   * (`SET_WEIGHT_GRAVITY`; Plan 3, Task 16b).
   */
  readonly setWeight?: boolean;
  /** `COLLISION_SITUATION_MASK_G`/`_A`: the box hits only grounded, or only airborne, victims. */
  readonly situation?: "ground" | "air";
  /**
   * `ATTACK_LR_CHECK_POS`: launch away from the attacker whichever side the
   * victim is on; `ATTACK_LR_CHECK_B`: launch backwards. Absent: forwards.
   */
  readonly lr?: "position" | "back";
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
  /**
   * Frames it lives, the frame it spawns on included: ages 0 to `lifetime` − 1
   * (SmashWiki's "Lifetime"; Plan 5, Task 6 fix round 1).
   */
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
  /**
   * What a full charge launches instead (Plan 5): the hitbox it interpolates
   * towards (`chargedHitbox`) and its speed. Samus's Charge Shot is SSBU's
   * `ATTACK_SET_LERP` between an uncharged and a full-charge box. `vy`, when a
   * shot aimed off the flat speeds up along its aim (F.L.U.D.D.'s 12°, Task 6);
   * absent, `vy` stays as uncharged.
   */
  readonly charged?: { readonly hitbox: ChargedHitbox; readonly vx: number; readonly vy?: number; readonly partial?: PartialCharge };
  /** Drawing hint for the renderer. */
  readonly visual: "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";
  /** A reflector can send it back (Plan 5): the article's `ATTACK(…, Reflectable=true)`. */
  readonly reflectable?: boolean;
}

/**
 * A reflector a move raises (Plan 5): Fox's Reflector, Mario's Cape. Frames
 * are game frames of the move, quoted from one; multipliers are Q12.
 */
export interface ReflectorDef {
  /** First and last frame the reflector is up. */
  readonly active: readonly [number, number];
  /** The bubble: radius, and its centre's offset from the origin (x facing-relative). */
  readonly radius: number;
  readonly x: number;
  readonly y: number;
  /** SmashWiki's "Damage multiplier", "Speed multiplier", "Lifetime multiplier". */
  readonly damage: number;
  readonly speed: number;
  readonly lifetime: number;
  /** "Damage threshold": a projectile hitting harder than this passes through. */
  readonly maxDamage: number;
  /** Frames the reflector stays up after a reflection however B is held (Fox: 20). */
  readonly holdAfterReflect: number;
  /** The reflecting frames repeat while B is held: first and last frame of the loop. */
  readonly loop?: readonly [number, number];
  /** From this frame, holding back turns the fighter round. */
  readonly turnFrom?: number;
  /** A projectile detector that brings the reflector up early (Mario's Cape). */
  readonly detector?: ReflectDetector;
}

/**
 * A reflector's projectile detector (Plan 5: Mario's Cape, its script's
 * `SEARCH`): on `frames` of the move, a reflectable projectile inside it skips
 * the move on to frame `to` from the next frame, so the reflector and every
 * later frame come that much sooner. The capsule runs from `x1` to `x2` in
 * front of the fighter at height `y`, `radius` wide.
 */
export interface ReflectDetector {
  readonly frames: readonly [number, number];
  readonly to: number;
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * A counter a move holds out (Plan 5, Task 5): Marth's Counter. Frames are game
 * frames of the move; lengths and damages Q12.
 *
 * SmashWiki "Counterattack" (https://www.ssbwiki.com/Counterattack): a counter
 * puts "the user into a shield-like state"; "Should any normally blockable
 * attack hit the user during these guard frames, the attack will be blocked
 * ... and the user will automatically retaliate". What it catches is what
 * reaches its bubble ("if no attack hits a counterattack's counter hurtbox, the
 * move fails"), the page's "Counter bubble size" and "offsets".
 */
export interface CounterDef {
  /** First and last frame a hit is caught (the page's "Counter a-b"). */
  readonly active: readonly [number, number];
  /** The counter bubble: radius, and its centre's offset from the origin (x facing-relative). */
  readonly radius: number;
  readonly x: number;
  readonly y: number;
  /** The counterattack's damage: caught × multiplier, clamped to [min, max]. */
  readonly multiplier: number;
  readonly minDamage: number;
  readonly maxDamage: number;
  /** Frames the counter and a melee attacker freeze when it catches something ("Counter hitlag on activation"). */
  readonly freeze: number;
  /** The move slot the counterattack is. Its hitboxes deal the counter's damage (`MoveDef.counterDamage`). */
  readonly then: MoveSlot;
}

/**
 * A special's stall in the air (Plan 5): Fox's Reflector, Mario's Cape. Q12.
 *
 * Its **stop** (`startX`, `boostY`, `noGravityFrames`) is the airtime's first
 * aerial use's only (`CombatState.specialStall`). Its **physics** (`gravity`,
 * `fallSpeed`, `airFriction`) run with the stop, and on every aerial use when
 * `everyUse` is set.
 */
export interface StallDef {
  /** The stop: horizontal speed multiplier on its first frame (Cape: 1 / 2.5). */
  readonly startX: number;
  /** The stop: vertical speed added on its first frame, onto a fall stopped dead (Cape: 0.3). */
  readonly boostY: number;
  /** The stop: frames with no gravity at all, from a fall stopped dead (Reflector: 4). */
  readonly noGravityFrames: number;
  /** The move's own gravity. */
  readonly gravity: number;
  /** The move's own falling speed, if it has one (Cape: 1). */
  readonly fallSpeed?: number;
  /**
   * The move's own air friction, if it restricts air mobility (Cape: 0.0025):
   * while its physics run the stick does not drift the fighter, and horizontal
   * speed bleeds toward 0 by this each frame.
   */
  readonly airFriction?: number;
  /** The physics run on every aerial use of the move, not only the stop's (Cape). */
  readonly everyUse?: boolean;
}

/**
 * How a move that ends helpless leaves its fighter (Plan 5, Task 4b): SmashWiki
 * "Helpless" (https://www.ssbwiki.com/Helpless), "unable to take any action, with
 * the exception of grabbing a ledge, maneuvering left/right, fastfalling ...
 * until they land on the ground". Each fighter cites its move's page.
 */
export interface HelplessDef {
  /**
   * Frames of `specialLanding` when the fall lands: the page's "Landing lag"
   * (SmashWiki "Lag", https://www.ssbwiki.com/Lag, "Special landing": "a
   * specific amount of landing lag, dependent on the move that initiated it").
   */
  readonly landingLag: number;
  /**
   * The page's "Helplessness air speed multiplier", Q12: the fall drifts no
   * faster than the fighter's air speed times this.
   */
  readonly airSpeed: number;
  /**
   * Helpless only when the move was begun in the air (fix round 1: Link's Spin
   * Attack, SmashWiki "Helpless": "helpless after the move was used if in the
   * air"). Begun on the ground, it ends free to act wherever it ends.
   */
  readonly aerialOnly?: boolean;
}

/** The numbers a charge changes on a hitbox; the rest of the box stays as authored. */
export type ChargedHitbox = Partial<Pick<Hitbox, "damage" | "angle" | "baseKnockback" | "knockbackGrowth" | "radius">>;

/**
 * How a partly charged special's boxes grow before a full charge replaces them
 * with the `full` values outright (SmashWiki, per move; `c` the charge frames,
 * `frames` the total charge time):
 * - `"lerp"`: every number moves linearly from the uncharged box to the full
 *   one (Charge Shot: "damage, shield damage, base knockback, knockback scaling,
 *   and radius are linearly scaled"); `floor` rounds the damage down to a whole
 *   percent;
 * - `"add"`: the damage alone grows by `total · c / frames` (Giant Punch
 *   `base + 18·c/110` rounded down, Hammer Flip 0.085% a frame, Skull Bash
 *   `6.2 + 15.2·c/80`, the bow `4 + 8·c/60` rounded down);
 * - `"multiply"`: the damage alone is multiplied by `1 + by · c / frames`
 *   (Shield Breaker `1 + 1.2·c/60`).
 */
export type PartialCharge =
  | { readonly kind: "lerp"; readonly floor?: boolean }
  | { readonly kind: "add"; readonly total: number; readonly floor?: boolean }
  | { readonly kind: "multiply"; readonly by: number };

/**
 * A special move that charges (Plan 5). SSBU has two kinds:
 * - `"hold"` (`HoldCharge`): charges while B is held, fires on release (Hero's
 *   Bow, Shield Breaker, Hammer Flip, Skull Bash);
 * - `"store"` (`StoreCharge`): loops after one press; B fires, a shield, roll,
 *   spot dodge, jump or air dodge puts the charge away for later
 *   (`CombatState.storedCharge`), and a full charge stores itself (Charge Shot,
 *   Giant Punch, F.L.U.D.D.).
 */
export type SpecialCharge = HoldCharge | StoreCharge;

interface ChargeBase {
  /** Frames from empty to full: SmashWiki's "Total charge time". */
  readonly frames: number;
  /** The move frame the charge loops on: SmashWiki's "Charges between a–b", a. */
  readonly loopFrame: number;
  /** Full-charge values per hitbox id, reached only at a full charge. */
  readonly full?: Readonly<Record<number, ChargedHitbox>>;
  /** How the boxes grow before that (`PartialCharge`); linear in every number when absent. */
  readonly partial?: PartialCharge;
}

/** A special that charges while B is held. */
export interface HoldCharge extends ChargeBase {
  readonly mode: "hold";
  /**
   * What a full charge does with B still held (SmashWiki "Charge",
   * https://www.ssbwiki.com/Charge): `"release"` fires it ("Automatically
   * activates at full charge": Shield Breaker, Skull Bash); `"hold"` keeps it
   * until B comes up ("Can be held indefinitely": Hero's Bow, Hammer Flip).
   */
  readonly atFull: "release" | "hold";
  /** The longest a `"hold"` charge can be held, in charge frames, before it fires anyway. */
  readonly maxHold?: number;
  /** Damage the fighter takes while holding a full charge (Hammer Flip's burn). */
  readonly recoil?: ChargeRecoil;
}

/** Self-damage every `every` frames held at full, while the fighter's damage is below `below`. Q12 damage. */
export interface ChargeRecoil {
  readonly every: number;
  readonly damage: number;
  readonly below: number;
}

/** A special whose charge loops after one press and can be stored. */
export interface StoreCharge extends ChargeBase {
  readonly mode: "store";
  /** What a stored full charge does when B brings it back out (`StoredFullCharge`). */
  readonly fromStore: StoredFullCharge;
}

/**
 * A stored full charge's release, as SmashWiki's "Fully charged" rows give it,
 * every frame counted from the B press that brings it out.
 */
export interface StoredFullCharge {
  /**
   * `"loop"`: the move starts on its loop frame and releases at once (Giant
   * Punch: "Hitbox 19-20" against 26-27 uncharged); `"entry"`: it plays its
   * entry frames and releases on reaching the loop (Charge Shot: "Hitbox 16-75"
   * either way).
   */
  readonly start: "loop" | "entry";
  /** The fully charged move's "Interruptible" frame. */
  readonly interruptible: number;
  /** Its super armour, first and last frame, on the ground and in the air. */
  readonly superArmour?: { readonly grounded: readonly [number, number]; readonly aerial?: readonly [number, number] };
}

export interface MoveDef {
  readonly slot: MoveSlot;
  readonly name: string;
  /**
   * UFD's "Total frames" T: the move's frames are 1..T, and the first actionable
   * frame is T + 1. The move is entered on its frame 1 (`actionFrame` 0), so it
   * ends on `actionFrame` T, where the fighter acts (`handOff`, `states.ts`).
   */
  readonly totalFrames: number;
  readonly hitboxes: readonly Hitbox[];
  /** Aerials only: frames of lag if the move is still out on landing. */
  readonly landingLag?: number;
  /** Aerials only: landing at or before/after these frames cancels cleanly. */
  readonly autoCancelBefore?: number;
  readonly autoCancelAfter?: number;
  /** Smash attacks may be held to charge. */
  readonly chargeable?: boolean;
  /** A special that charges (Plan 5): on B, held or stored. See `SpecialCharge`. */
  readonly specialCharge?: SpecialCharge;
  /** A reflector this move raises (Plan 5). */
  readonly reflector?: ReflectorDef;
  /** The move stalls a fall in the air (Plan 5). See `StallDef`. */
  readonly stall?: StallDef;
  /** A counter this move holds out (Plan 5, Task 5). See `CounterDef`. */
  readonly counter?: CounterDef;
  /**
   * Its hitboxes deal the damage its counter caught (`CombatState.counterDamage`)
   * in place of their own (Plan 5, Task 5: the counterattack).
   */
  readonly counterDamage?: boolean;
  /**
   * The move leaves its fighter helpless (`specialFall`) when it ends in the air
   * (Plan 5, Task 4b). See `HelplessDef`.
   */
  readonly helpless?: HelplessDef;
  /**
   * In the air, the move's animation runs to this frame (Plan 5: Mario's Cape,
   * SmashWiki's "Animation length"). It is interruptible from `totalFrames` + 1
   * as on the ground, but only by an action (an air dodge, a special, an aerial
   * or a jump); with none it plays out to here under the move's own physics.
   */
  readonly airTotalFrames?: number;
  /** First and last move frame the fighter is intangible (Plan 5: SmashWiki "Intangibility a-b"). */
  readonly intangible?: readonly [number, number];
  /** Frames the fighter may not be interrupted, for specials with armour. */
  readonly superArmourFrames?: readonly [number, number];
  /**
   * A back throw whose legacy launch box points forward turns its thrower round
   * on this move frame, before the launch: the game's `REVERSE_LR()`, which the
   * legacy compile writes there (`legacyGameScript`; Plan 5, Task 7, ruling
   * P5-R7). A throw run from its imported script turns where its script says.
   */
  readonly turnAt?: number;
  /** A jab that loops until the button is released. */
  readonly rapid?: boolean;
  /** Which move follows this one if the button is pressed again in time. */
  readonly followUp?: MoveSlot;
  /**
   * Scripted movement the move carries — a Fox Illusion's dash, a Dolphin
   * Slash's rise, a Stone's drop.
   *
   * `frame` is quoted like every other frame number here, from one. `x` is
   * facing-relative and `y` absolute, matching `ProjectileDef`. The velocity is
   * set rather than added, so the movement is the same from a standstill as out
   * of a run.
   *
   * `hold` extends the impulse over that many further frames, during which the
   * velocity is re-asserted and gravity does not apply. Without it a downward
   * impulse is clawed back to the fighter's ordinary fall speed on the next
   * frame — which is the difference between a stone and a puffball.
   */
  readonly momentum?: readonly { frame: number; x: number; y: number; hold?: number }[];
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
  /**
   * The fighter's air dodges (Plan 3, Task 20c): its entry in the game's
   * `fighter_param_motion` table. Optional so the engine's hand-built test
   * fighters need not author one; they dodge as Mario does
   * (`DEFAULT_AIR_DODGE`, `airDodge.ts`). Every roster fighter has its own.
   */
  readonly airDodge?: AirDodgeAttributes;
  /**
   * The fighter's spot dodge and rolls (Plan 3 final wave), from its
   * UltimateFrameData page. Optional for the same reason as `airDodge`: the
   * engine's test fighters dodge as Mario does (`DEFAULT_GROUND_DODGE`,
   * `groundDodge.ts`). Every roster fighter has its own.
   */
  readonly groundDodge?: GroundDodgeAttributes;
}

/**
 * One ground dodge as UltimateFrameData's "Dodges / Rolls" table publishes it
 * (https://ultimateframedata.com/<fighter>), fresh, in published frames. The
 * engine reads both one `actionFrame` earlier, as it reads the air dodge's
 * (`groundDodge.ts`).
 */
export interface DodgeFrames {
  /** "Total frames" T: the dodge's frames 1..T; the first actionable frame is T + 1. */
  readonly frames: number;
  /** "Intangible on frame a-b": both ends included. */
  readonly intangible: readonly [first: number, last: number];
}

/** One fighter's spot dodge and rolls. Each fighter file cites its UFD page. */
export interface GroundDodgeAttributes {
  /**
   * The spot dodge: UFD's second number ("20/25" for Mario). SmashWiki "Spot
   * dodge" (https://www.ssbwiki.com/Spot_dodge) gives 25 for Mario and 20
   * "canceled" into a ground attack or special, which the replica does not model.
   */
  readonly spotDodge: DodgeFrames;
  /** The roll toward the way the fighter faces (SSBU's ESCAPE_F). */
  readonly forwardRoll: DodgeFrames;
  /** The roll away from it (ESCAPE_B), which UFD lists separately. */
  readonly backRoll: DodgeFrames;
}

/**
 * One fighter's air-dodge lengths and intangibility, in frames, named as
 * `fighter_param_motion.prc` names them: fudgepop01/amiibo_research
 * `fighter_param_motion.xml` @523374aa,
 * https://github.com/fudgepop01/amiibo_research/blob/523374aaf3f1b7fa67370f83bec4a53b256ac944/research/paramDecoding/common/param/fighter_param_motion.xml.
 * Each fighter file cites the lines its numbers come from.
 *
 * An intangibility pair is the param's (`hit_xlu_frame`, `hit_normal_frame`):
 * intangible from the first for the second's count of frames, so published
 * frames `xlu` to `xlu + normal − 1`. That reading reproduces SmashWiki "Air
 * dodge"'s Ultimate table (https://www.ssbwiki.com/Air_dodge) for every roster
 * fighter, neutral and directional (Mario 3, 27 → 3-29 and 3, 19 → 3-21; Fox
 * 2, 25 → 2-26 and 2, 18 → 2-19). The engine reads them one `actionFrame`
 * earlier, as it reads every published air-dodge frame (`airDodgeIntangible`).
 */
export interface AirDodgeAttributes {
  /** `escape_air_stiff_frame`: a neutral air dodge's length. */
  readonly neutralFrames: number;
  /** `escape_air_hit_xlu_frame`, `escape_air_hit_normal_frame`. */
  readonly neutralIntangible: readonly [xlu: number, normal: number];
  /** `escape_air_slide_stiff_frame`: a directional air dodge's length, sideways. */
  readonly sideFrames: number;
  /** `escape_air_slide_u_stiff_frame`: straight up. */
  readonly upFrames: number;
  /** `escape_air_slide_d_stiff_frame`: straight down. */
  readonly downFrames: number;
  /** `escape_air_slide_hit_xlu_frame`, `escape_air_slide_hit_normal_frame`. */
  readonly directionalIntangible: readonly [xlu: number, normal: number];
}

export interface FighterDef {
  readonly id: string;
  readonly name: string;
  /** Series the fighter comes from, shown on the CSS and results screen. */
  readonly series: string;
  /** Fighter number, which is what the CSS orders by. */
  readonly number: number;
  readonly attributes: FighterAttributes;
  /**
   * The fighter's `fighter_param.prc` numbers (see `params.ts`). Optional while
   * the engine migrates off `attributes`: a definition without it — every
   * engine test fixture — is read through `paramsFromAttributes`.
   */
  readonly params?: FighterParams;
  readonly moves: Readonly<Partial<Record<MoveSlot, MoveDef>>>;
  /**
   * `game_` scripts that replace a slot's compiled legacy move (see
   * `acmd/legacy.ts`). Empty for the whole roster in Plan 2; Plan 3 Task 18
   * fills the slots whose imported script hangs every box off the root bone
   * (`fighters/acmd/active.ts`).
   */
  readonly scripts?: Readonly<Partial<Record<MoveSlot, AcmdScript>>>;
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
  /**
   * A fifth surface, for a fighter who has one the four roles cannot carry.
   *
   * Added for Marth's cape, which is a distinct colour from his tunic, his
   * trim and his boots — and which had to become a hard-coded literal to stay
   * legible, because every available role merged it with one of them. A
   * literal does not follow a costume, so the red-caped alt came out blue:
   * the legibility fix traded a default-costume win for one alt being wrong.
   *
   * Optional, because seven fighters do not need it and a role nobody sets is
   * a role nobody has to think about.
   */
  readonly extra?: string;
  /** Alternate costumes: each remaps primary/secondary/accent, and `extra` if it is set. */
  readonly alts: readonly {
    primary: string;
    secondary: string;
    accent: string;
    extra?: string;
  }[];
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
  /**
   * Frames a chargeable smash has been held. Reused outside an attack, where
   * `startAction` has cleared it: the length of a landing (`land` and
   * `landingLag`, set by `onLanded`) and an air dodge's "directional" flag.
   */
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
  /** On a grabbed fighter: frames until it breaks free (`grabHoldFrames`, less mashing). Plan 3, Task 14. */
  grabTimer: number;

  /** Ledge currently hung from: platform index and side, or null. */
  ledge: { platform: number; side: number } | null;
  ledgeRegrabs: number;
  /**
   * Frames left before this fighter may grab a ledge again; 0 when free to grab.
   * Locks out every ledge. Counts down each frame and is cleared by landing and
   * by a KO. Two things set it:
   * - letting go of a ledge (a drop by down or away), or being hit or grabbed off
   *   one: `LEDGE_REGRAB_LOCKOUT_FRAMES`, so the drop does not regrab at once;
   * - being trumped off a ledge (Plan 3, Task 15): `LEDGE_TRUMPED_FRAMES` + 1,
   *   the whole of the lag in which the fighter cannot act, its last frame
   *   included (the final wave), so it cannot take the ledge back.
   * A getup, roll, jump or attack from the ledge does not set it.
   */
  ledgeLockout: number;
  airTime: number;

  /** Frames of Final Smash standby remaining, or 0. */
  finalSmashReady: number;

  /**
   * Per-move staleness queue: the last 9 move slots landed. `combat.staleShield`
   * runs parallel to it, entry for entry (see there for the invariant).
   */
  staleQueue: MoveSlot[];
  /** Hitboxes already connected this move, so one swing hits once. */
  hitThisMove: number[];

  /** Frames since the direction was last pressed — drives tilt vs. smash. */
  framesSinceDirPress: number;
  lastDirPressed: number;
  /** Buffered action awaiting a legal frame, and when it was queued. */
  bufferedAction: BufferedAction | null;
  /**
   * KineticModule energies (see `kinetic.ts`). `vx`/`vy` above are their sum,
   * kept for readers that only want a velocity.
   */
  kinetic: KineticState;
  /** Plan 3's combat bookkeeping (see `combat.ts`): stale shield marks and more. */
  combat: CombatState;
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
  /**
   * The fighter whose moveset defines `defId` (Plan 5). Not `owner`: a reflector
   * makes a projectile its own, and Kirby's copied neutral special launches
   * another fighter's projectile, so the definition is looked up here.
   * Must be an id the `SimContext` knows: `step()` throws on an unknown one, as
   * it does for an unknown `FighterState.defId`.
   */
  source: string;
  /** The fraction of a full charge it was launched with, Q12 (`ONE` = full). Plan 5. */
  charge: number;
  /** How many times it has been reflected. SmashWiki "Reflect": seven at most. Plan 5. */
  reflected: number;
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
  /**
   * The port whose Final Smash cinematic is playing, or -1 (Plan 5). While one
   * plays, only that fighter and the fighters it trapped advance — everybody
   * else, every projectile and the Smash Ball wait — exactly as SSBU pauses the
   * match for the cutscene. It is state, so a rollback replays it.
   */
  cinematic: number;
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
  hits: {
    attacker: number;
    victim: number;
    damage: number;
    /** The box's near end: its point for a sphere, its first point for a capsule. */
    x: number;
    y: number;
    /**
     * Where the box touched the body: the point of the box's spine nearest the
     * hurt capsule it reached deepest (Plan 4, ruling R9; `contactPoint`). A
     * sphere's is its centre, `x`/`y`; a capsule's can be its far end, a
     * sword's tip. Presentation only, like everything here: where a spark goes.
     */
    contactX: number;
    contactY: number;
    knockback: number;
    /**
     * The world direction the victim is about to travel, in fixed degrees from
     * +x. Presentation only — it is what lets a hit throw its sparks the way
     * the victim is going instead of in a symmetric puff that says nothing.
     */
    angle: number;
    /**
     * Which of the move's hitboxes actually won the exchange.
     *
     * A move is several hitboxes at once and `bestHitbox` resolves an overlap
     * by lowest id — which *is* the sweetspot mechanic, not an implementation
     * detail of it. Marth's tipper, Bowser's fist, a sourspotted aerial: in
     * every case the same swing does one of two very different things, and
     * which one is the single most important fact about the exchange for the
     * two players watching it.
     *
     * Without this the renderer could tell that something connected but not
     * *what*, so a tipper flash could only ever be painted from geometry —
     * where the blade is, not whether the blade is what landed. Presentation
     * only, like everything else here, and never fed back into the simulation.
     */
    hitboxId: number;
  }[];
  shieldHits: { victim: number; x: number; y: number }[];
  clanks: { x: number; y: number }[];
  kos: { port: number; x: number; y: number; kind: "blast" | "star" | "screen" }[];
  jumps: { port: number; x: number; y: number }[];
  lands: { port: number; x: number; y: number }[];
  shieldBreaks: number[];
  smashBallBroken: number | null;
  finalSmashes: number[];
  /** Projectiles sent back this frame, by whom and where (Plan 5). */
  reflects: { port: number; x: number; y: number }[];
  /** Counters that caught something this frame: whose, and where it met the bubble (Plan 5, Task 5). */
  counters: { port: number; x: number; y: number }[];
  /**
   * Windbox pushes that reached a body this frame, who pushed whom (Plan 5,
   * Task 6 fix round 1). A push reports no hit (F.L.U.D.D.'s row is `nogfx=t`),
   * but the results screen credits a KO through one as through a hit
   * (`killCredit.ts`; SmashWiki "Windbox").
   */
  pushes: { attacker: number; victim: number }[];
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
    reflects: [],
    counters: [],
    pushes: [],
  };
}
