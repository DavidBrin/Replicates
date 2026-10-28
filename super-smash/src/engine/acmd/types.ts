/**
 * ACMD `game_` scripts — a move as an ordered list of timed commands.
 *
 * Ultimate does not describe a move as a table of hitboxes with start and end
 * frames. It runs a script per motion (`game_attack11`, `game_attackairn` …)
 * whose commands are executed as the animation reaches them: `frame(n)` waits
 * until motion frame n, `wait(n)` waits n more, `ATTACK(...)` opens a hitbox in
 * a numbered slot, `AttackModule::clear_all()` closes them. Hitboxes hang off
 * *bones* and move with the animation. The command and argument names below
 * are smash-script's (HDR-Development/smash-script `src/macros.rs`, `ATTACK`
 * and `CATCH` signatures) — read for the names, never copied.
 *
 * Numbers are Q12 fixed point unless a comment says frames or a count.
 */

/** A bone, as rubendal's data spells it: lowercase, e.g. "top", "hip", "kneer", "handl", "haver", "sword1". */
export type BoneName = string;

/** A motion kind, as rubendal's `Motions` table spells it: "attack_11", "attack_air_n", "special_hi" … */
export type MotionKind = string;

export type AttackSetoff = "ATTACK_SETOFF_KIND_ON" | "ATTACK_SETOFF_KIND_OFF" | "ATTACK_SETOFF_KIND_THRU";
export type AttackLr = "ATTACK_LR_CHECK_F" | "ATTACK_LR_CHECK_B" | "ATTACK_LR_CHECK_POS" | "ATTACK_LR_CHECK_SPEED";
export type CollisionSituation =
  | "COLLISION_SITUATION_MASK_GA"
  | "COLLISION_SITUATION_MASK_G"
  | "COLLISION_SITUATION_MASK_A"
  | "COLLISION_SITUATION_MASK_G_d"
  | "COLLISION_SITUATION_MASK_GA_d";
export type HitStatus = "HIT_STATUS_NORMAL" | "HIT_STATUS_XLU" | "HIT_STATUS_INVINCIBLE" | "HIT_STATUS_OFF";

/**
 * smash-script `ATTACK(id, part, bone, damage, angle, kbg, fkb, bkb, size, x, y, z, x2, y2, z2, hitlag, sdi,
 * clang, facing, set_weight, shield_damage, trip, rehit, reflectable, absorbable, flinchless, disable_hitlag,
 * direct, ground_air, hitbits, collision_part, friendly_fire, effect, sfx_level, collision_sound, _type)`.
 */
export interface AttackParams {
  /** Slot number. A lower id wins when two of one fighter's hitboxes reach a target. */
  readonly id: number;
  readonly part: number;
  readonly bone: BoneName;
  /** Percent. */
  readonly damage: number;
  /** Degrees; 361 is the Sakurai angle. */
  readonly angle: number;
  /** Knockback growth, raw (100 means 100). */
  readonly kbg: number;
  /** Fixed ("set") knockback, raw; 0 when the move uses `bkb`. */
  readonly fkb: number;
  /** Base knockback, raw. */
  readonly bkb: number;
  /** Radius. */
  readonly size: number;
  /** Offset in the bone's local frame. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The far end of an extended (capsule) hitbox, bone-local; absent for a sphere. */
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  /** Hitlag multiplier (ONE = 1.0×). */
  readonly hitlag: number;
  /** SDI multiplier (ONE = 1.0×). */
  readonly sdi: number;
  readonly clang: AttackSetoff;
  readonly facing: AttackLr;
  readonly setWeight: boolean;
  readonly shieldDamage: number;
  /** Trip chance, ONE = certain. */
  readonly trip: number;
  /** Frames between rehits of a multihit; 0 for none. */
  readonly rehit: number;
  readonly reflectable: boolean;
  readonly absorbable: boolean;
  readonly flinchless: boolean;
  readonly noHitlag: boolean;
  readonly direct: boolean;
  readonly situation: CollisionSituation;
  /** `collision_attr_*`, e.g. "collision_attr_normal", "collision_attr_elec", "collision_attr_cutup". */
  readonly collisionAttr: string;
  /** `ATTACK_REGION_*`, e.g. "ATTACK_REGION_PUNCH". */
  readonly region: string;
  /**
   * REPLICA: the legacy `Hitbox.meteor` flag (grounded-meteor knockback ×0.8),
   * carried until Plan 3 derives it from the angle as the game does.
   */
  readonly meteor?: boolean;
}

/** smash-script `CATCH(id, bone, size, x, y, z, x2, y2, z2, status, situation)`. */
export interface CatchParams {
  readonly id: number;
  readonly bone: BoneName;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly status: string;
  readonly situation: CollisionSituation;
}

/** A rate as an exact fraction: game frames per motion frame (`FT_MOTION_RATE`'s FSM). */
export type Rate = readonly [num: number, den: number];

export type AcmdCommand =
  /** `frame(Frame=n)`: wait until motion frame n (frames). */
  | { readonly op: "frame"; readonly frame: number }
  /** `wait(Frames=n)`: wait n motion frames from where the script is (frames). */
  | { readonly op: "wait"; readonly frames: number }
  | { readonly op: "attack"; readonly params: AttackParams }
  | { readonly op: "catch"; readonly params: CatchParams }
  /** `AttackModule::clear_all()`. */
  | { readonly op: "clearAll" }
  /** `AttackModule::clear(ID=n)`. */
  | { readonly op: "clear"; readonly id: number }
  /** `grab(MA_MSC_CMD_GRAB_CLEAR_ALL)`. */
  | { readonly op: "catchClearAll" }
  /** `grab(MA_MSC_CMD_GRAB_CLEAR, n)`. */
  | { readonly op: "catchClear"; readonly id: number }
  /** `ATK_POWER(id, damage)`: a live hitbox's damage changes, the hitbox does not. */
  | { readonly op: "atkPower"; readonly id: number; readonly damage: number }
  /** `ATK_SET_SHIELD_SETOFF_MUL(ID, ShieldstunMul)`. */
  | { readonly op: "shieldSetoffMul"; readonly id: number; readonly mul: number }
  /** `FT_MOTION_RATE(FSM=r)`. */
  | { readonly op: "motionRate"; readonly rate: Rate }
  /** `WorkModule::on_flag` / `off_flag`. */
  | { readonly op: "setFlag"; readonly flag: string; readonly on: boolean }
  /** `damage(MA_MSC_DAMAGE_DAMAGE_NO_REACTION, …)`: super armour on (ALWAYS) or off (NORMAL). */
  | { readonly op: "superArmour"; readonly on: boolean }
  /** `WHOLE_HIT(HIT_STATUS_*)`: intangible (XLU), invincible, or back to normal. */
  | { readonly op: "wholeHit"; readonly status: HitStatus }
  /**
   * REPLICA: a scripted velocity (Q12, `x` facing-relative) set for this frame
   * and held `hold` more frames — the legacy `MoveDef.momentum`, which the game
   * expresses as animation translation (the MOTION energy). `order` is the
   * entry's position in the legacy list; the lowest live one wins.
   */
  | { readonly op: "momentum"; readonly x: number; readonly y: number; readonly hold: number; readonly order: number }
  /** `ArticleModule::generate_article` — here, a `ProjectileDef` id. */
  | { readonly op: "spawnProjectile"; readonly id: string }
  /** `REVERSE_LR()`. */
  | { readonly op: "reverseLr" }
  /** `for(N Iterations){ … }`. */
  | { readonly op: "loop"; readonly count: number; readonly body: readonly AcmdCommand[] }
  /** Anything the replica does not interpret yet, kept verbatim so nothing is lost on import. */
  | { readonly op: "unknown"; readonly raw: string };

export interface AcmdScript {
  /** `game_<motion>`, e.g. "game_attack11". */
  readonly name: string;
  readonly motion: MotionKind;
  readonly commands: readonly AcmdCommand[];
}
