/**
 * Kirby's Inhale (Plan 5, Task 9): the catch, the swallow, the spit and its star,
 * and the Copy Ability. The statuses are in `status/inhale.ts`.
 *
 * SmashWiki "Kirby (SSBU)/Neutral special"
 * (https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special):
 * - Swallow: "Throw" 10.0% (angle 361, BK 0, KS 0, H× 0.0×), "Throw release
 *   frame 8"; Spit: "Throw" 6.0%, release 8: no launch and no freeze, so the
 *   damage alone lands (and the 1v1 multiplier with it);
 * - the star: "Offsets 7, 7"; "Can pierce opponents? Yes"; radius 2.5, angle 45
 *   ("Speed-based"), BK 70, KS 78, "H× 2.0×"; its damage by the spat fighter's
 *   weight (the table: 62 - 68: 10% … 135: 21%); "its speed in units per frame is
 *   determined by 2.8 + 0.008(t - k). The star's speed decreases by 0.05 per
 *   frame, and it releases the target when its speed drops below 0.4";
 * - while he holds someone, Kirby's blast line detection is "extended forward and
 *   down by 4 units";
 * - "Copy Ability damage multiplier 1.2"; "Period before Copy Ability can be lost
 *   by damage taken 1200 frames (6.0.0 onward)"; "Chance to lose Copy Ability by
 *   damage taken (this * damage / 0.7)": 0.7 from 6.0.0, so damage / 100.
 * SmashWiki "Kirby (SSBU)" (https://www.ssbwiki.com/Kirby_(SSBU)): "the chance for
 * Kirby to lose his Copy Ability by getting hit is equal to the damage % taken"
 * (6.0.0: "Damage Received/70 * 100% → Damage Received/70 * 70%").
 * SmashWiki "Inhale (Kirby)" (https://www.ssbwiki.com/Inhale_(Kirby)): "Kirby's Copy
 * Abilities have a 1.2× damage multiplier applied to all their hitboxes"; it
 * "raises damage percent, but knockback only reflects the change in percent";
 * "If a Kirby swallows a Kirby with a Copy Ability, he will steal it away from
 * them. If a Kirby attempts to copy another Kirby that has no Copy Ability, the
 * swallowed Kirby will pop out normally"; "Kirby can't inhale another Kirby who
 * already has someone in his mouth"; he loses the ability "upon being KO'd".
 * SmashWiki "Copy Ability" (https://www.ssbwiki.com/Copy_Ability): "knockback is
 * not affected"; "anything spawned by the ability will vanish if Kirby loses it".
 *
 * UNVERIFIED, the replica's readings:
 * - The swallow lets its fighter out where Kirby is, standing or falling. SSBU
 *   flies it out on a small star of its own ("The copy star spawns 7 units above
 *   Kirby ... 3.4 ... 62°", the page's parameters), which is not modelled.
 * - The swallow's and the spit's damage take no staleness.
 * - The star's damage is its rider's weight's row; a weight between published
 *   rows takes the row below (the table skips 69 - 74, 114 - 115 and 119 - 126).
 * - t and k for the star are the percents after the spit's own damage.
 * - The ×1.2 rides on a copied special's projectiles ("all their hitboxes"), even
 *   once reflected; it is left out of the hitlag, as the 1v1 multiplier is.
 * - A projectile the ability spawned vanishes with it unless reflected away.
 */

import { ONE, fx, mul, randomInt } from "./fixed";
import { ONE_ON_ONE_MULTIPLIER } from "./constants";
import { gameScriptFor } from "./acmd/legacy";
import { moveFrameOf } from "./hitbox";
import { kineticSet } from "./kinetic";
import { inhaleHoldFrames, leaveStar, starFrames } from "./status/inhale";
import { releaseGrab, startAction } from "./states";
import type { FighterDef, FighterState, GameState, MoveDef, ProjectileState, StageDef, StepEvents } from "./types";

/** The Copy Ability's grace: no hit knocks it off for this long (SmashWiki, 6.0.0 onward). */
export const COPY_GRACE_FRAMES = 1200;
/** SmashWiki: "Copy Ability damage multiplier 1.2". */
export const COPY_DAMAGE = fx(1.2);
/** How far Kirby's blast lines reach out forward and down while he holds someone (SmashWiki: 4 units). */
export const HOLD_BLAST_REACH = fx(4);
/** The star's speed, `2.8 + 0.008(t − k)`: its base (SmashWiki, above). */
const STAR_BASE_SPEED = fx(2.8);

/** The spit star's damage by the spat fighter's weight (SmashWiki's table; gaps UNVERIFIED, above). */
export function starDamage(weight: number): number {
  const rows: readonly (readonly [number, number])[] = [
    [135, 21],
    [127, 20],
    [116, 18],
    [108, 17],
    [101, 16],
    [95, 15],
    [88, 14],
    [82, 13],
    [75, 12],
    [62, 10],
  ];
  for (const [min, damage] of rows) if (weight >= min) return damage;
  return 10;
}

/**
 * Is `f` a Kirby with someone in his mouth: holding (`inhaleHold`), or in the
 * swallow or the spit before its release (the link still whole)?
 */
export function holdsMouthful(f: Pick<FighterState, "action" | "grabbing">): boolean {
  return f.grabbing >= 0 && (f.action === "inhaleHold" || f.action === "special");
}

/**
 * The catch landed (`applyHit`'s grab branch, the link already made): the fighter
 * caught goes into Kirby's mouth for `180 + 1.1t − k` frames, intangible from
 * this frame, and Kirby holds them. Both change status through the status module
 * (`startAction`), so whatever the caught fighter was in ends as any status
 * does: a helpless fall's record goes (Task 4b carry).
 */
export function swallowVictim(kirby: FighterState, victim: FighterState): void {
  victim.grabTimer = inhaleHoldFrames(victim.damage, kirby.damage);
  victim.combat.grabLength = victim.grabTimer;
  victim.intangible = Math.max(victim.intangible, 1);
  startAction(victim, "swallowed");
  startAction(kirby, "inhaleHold");
}

/**
 * Whether Kirby's inhale (`attackerDef`'s move `slot`) may catch `victim`: not a
 * fighter on a ledge (UNVERIFIED: no source says either way; it would strand the
 * mouthful there. Ruling P5-R11: Inhale only, so an ordinary grab still takes a
 * hanging fighter, D56), not another Kirby with someone in his mouth (SmashWiki
 * "Inhale (Kirby)"), and only with an empty mouth of its own (one link a captor).
 */
export function inhaleMayCatch(attacker: FighterState, victim: FighterState): boolean {
  return victim.ledge === null && !holdsMouthful(victim) && attacker.grabbing < 0 && attacker.grabbedBy < 0;
}

/** The Copy Ability a swallow of `victim` gives: their neutral special's, or a Kirby's own copy, stolen. */
export function abilityFromSwallow(victimDef: FighterDef, victim: Pick<FighterState, "defId" | "combat">): string {
  return victimDef.moves.neutralB?.inhale !== undefined ? victim.combat.copy : victim.defId;
}

/**
 * `def` with Kirby's neutral special replaced by the copied fighter's, at ×1.2
 * (`MoveDef.copyDamage`). The copied fighter's own script runs it, the one its
 * registration made ready (`prepareFighterScripts`), so nothing compiles mid-match.
 * Cached per pair of definition objects, as `withLimbScripts` caches per
 * definition: two contexts that hold different definitions under the same ids (a
 * test's, the game's with its limb scripts) never share a merged one.
 */
const copied = new WeakMap<FighterDef, WeakMap<FighterDef, FighterDef>>();
export function withCopyAbility(def: FighterDef, copy: FighterDef | null): FighterDef {
  if (copy === null) return def;
  let byCopy = copied.get(def);
  if (byCopy === undefined) {
    byCopy = new WeakMap();
    copied.set(def, byCopy);
  }
  let out = byCopy.get(copy);
  if (out === undefined) {
    const move = copy.moves.neutralB;
    const script = gameScriptFor(copy, "neutralB");
    const moves = { ...def.moves, neutralB: move === undefined ? undefined : ({ ...move, copyDamage: COPY_DAMAGE } as MoveDef) };
    const scripts = { ...def.scripts };
    if (script === null) delete scripts.neutralB;
    else scripts.neutralB = script;
    out = { ...def, moves, scripts };
    byCopy.set(copy, out);
  }
  return out;
}

/**
 * Releases (phase 6, after projectiles spawn): on the frame a swallow or a spit
 * steps onto its release frame (`MoveDef.release`), the fighter in Kirby's mouth
 * comes out, through `releaseGrab` (ruling R-T9b: the mash credit goes with the
 * link, as on every release). A frame held by a freeze is not acted on again, as
 * `resolveThrows` does it.
 *
 * - Its damage lands, with the 1v1 multiplier, and is reported as a hit that
 *   launches nothing.
 * - A swallow gives Kirby the fighter's neutral special (`abilityFromSwallow`;
 *   from a Kirby, his copy, which he loses) and lets them out where he is.
 * - A spit puts them on the star this move spawned this very frame, found by its
 *   definition and its age, never by its place in the list: its damage is their
 *   weight's (the box carries 1%, `chargeScale` the rest), its speed `2.8 +
 *   0.008(t − k)`, their flight `25 + 0.5t` frames.
 */
export function resolveInhaleReleases(
  s: GameState,
  defs: readonly FighterDef[],
  fighterOf: (id: string) => FighterDef,
  frozen: readonly boolean[],
  beforeActionFrame: readonly number[],
  events: StepEvents,
): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const kirby = s.fighters[i];
    if (frozen[i] || kirby.action !== "special" || kirby.move === null) continue;
    // Stepped onto this frame: advanced, or entered this tick (`enteredThisTick`).
    if (kirby.actionFrame === beforeActionFrame[i] && kirby.actionFrame !== 0) continue;
    const move = defs[i].moves[kirby.move];
    const release = move?.release;
    if (move === undefined || release === undefined || moveFrameOf(kirby.actionFrame) !== release.frame) continue;
    const victim = kirby.grabbing >= 0 ? s.fighters[kirby.grabbing] : undefined;
    if (victim === undefined || victim.grabbedBy !== kirby.port || victim.action !== "swallowed") continue;

    const damage = s.rules.oneOnOne ? mul(release.damage, ONE_ON_ONE_MULTIPLIER) : release.damage;
    victim.damage += damage;
    events.hits.push({
      attacker: kirby.port,
      victim: victim.port,
      damage,
      x: victim.x,
      y: victim.y,
      contactX: victim.x,
      contactY: victim.y,
      knockback: 0,
      angle: 0,
      hitboxId: 0,
    });
    releaseGrab(kirby, s.fighters);

    if (release.kind === "swallow") {
      const ability = abilityFromSwallow(fighterOf(victim.defId), victim);
      if (ability !== "") {
        kirby.combat.copy = ability;
        kirby.combat.copyFrames = 0;
        if (ability === victim.combat.copy) {
          victim.combat.copy = "";
          victim.combat.copyFrames = 0;
        }
      }
      startAction(victim, victim.grounded ? "stand" : "fall");
      continue;
    }

    maybeLoseCopy(s, victim, damage);
    const starId = move.projectiles?.find((p) => p.ridden === true)?.id;
    const star = s.projectiles.find((p) => p.owner === kirby.port && p.source === kirby.defId && p.defId === starId && p.age === 0);
    if (star === undefined) {
      startAction(victim, victim.grounded ? "stand" : "fall");
      continue;
    }
    star.chargeScale = fx(starDamage(fighterOf(victim.defId).attributes.weight));
    const speed = STAR_BASE_SPEED + Math.trunc(((victim.damage - kirby.damage) * 8) / 1000);
    star.vx = star.facing * speed;
    startAction(victim, "spatStar");
    victim.combat.ride = star.instanceId;
    victim.grabTimer = starFrames(victim.damage);
    victim.facing = star.facing;
    rideAt(victim, star);
  }
}

/** A rider where its star is: off the ground, still, its ground jump spent (as `pinHeldFighters`'s riders). */
function rideAt(f: FighterState, star: ProjectileState): void {
  f.x = star.x;
  f.y = star.y;
  f.grounded = false;
  f.platform = -1;
  f.ledge = null;
  f.airTime = 0;
  f.jumpsUsed = Math.max(f.jumpsUsed, 1);
  f.intangible = Math.max(f.intangible, 1);
  kineticSet(f, 0, 0);
}

/** The fighter riding `p`, if one is. */
export function riderOf(s: GameState, p: ProjectileState): FighterState | undefined {
  return s.fighters.find((f) => f.action === "spatStar" && f.combat.ride === p.instanceId);
}

/**
 * A star moved (`step`'s `advanceProjectiles`): its rider goes with it. A star
 * gone lets its rider go where it last was, unless it went past a blast line,
 * which takes the rider with it (phase 9): a wall, its time or its speed ends
 * a ride, a blast line ends a stock. UNVERIFIED: no source says where a rider is
 * let go of; a star flies through no wall, so the last place it was is in the open.
 */
export function carryStarRider(s: GameState, p: ProjectileState, alive: boolean, stage: StageDef): void {
  const rider = riderOf(s, p);
  if (rider === undefined) return;
  if (alive) {
    rideAt(rider, p);
    return;
  }
  const b = stage.blastZone;
  if (p.x < b.left || p.x > b.right || p.y > b.top || p.y < b.bottom) {
    rider.x = p.x;
    rider.y = p.y;
  }
  leaveStar(rider);
}

/** A ridden projectile nobody rides is gone: a star lives only while it carries its fighter. */
export function dropRiderlessStars(s: GameState, isRidden: (p: ProjectileState) => boolean): void {
  if (!s.projectiles.some((p) => isRidden(p) && riderOf(s, p) === undefined)) return;
  s.projectiles = s.projectiles.filter((p) => !isRidden(p) || riderOf(s, p) !== undefined);
}

/**
 * A hit of `damage` (Q12, as taken) may knock the Copy Ability off once its grace
 * is over: chance damage / 100, one draw from the match's seeded RNG in state,
 * so both peers agree and a rollback replays it (ruling R-T9c). No draw without
 * a copy, inside the grace, or for a hit that deals nothing.
 */
export function maybeLoseCopy(s: GameState, f: FighterState, damage: number): void {
  if (f.combat.copy === "" || f.combat.copyFrames < COPY_GRACE_FRAMES || damage <= 0) return;
  const r = randomInt(s.rngSeed, 100 * ONE);
  s.rngSeed = r.seed;
  if (r.value < damage) loseCopy(f);
}

/** The Copy Ability goes (a KO, a hit's chance). What it spawned goes too (`dropLostCopies`). */
export function loseCopy(f: FighterState): void {
  f.combat.copy = "";
  f.combat.copyFrames = 0;
}

/**
 * "Anything spawned by the ability will vanish if Kirby loses it" (SmashWiki
 * "Copy Ability"): a projectile a copied special launched (`damageMul` not `ONE`)
 * whose owner no longer has that ability. One reflected away is the reflector's
 * now, and stays (UNVERIFIED).
 */
export function dropLostCopies(s: GameState): void {
  const lost = (p: ProjectileState): boolean =>
    p.damageMul !== ONE && p.reflected === 0 && s.fighters[p.owner]?.combat.copy !== p.source;
  if (s.projectiles.some(lost)) s.projectiles = s.projectiles.filter((p) => !lost(p));
}

/** The projectile a copied special spawns carries its ×1.2 (`MoveDef.copyDamage`; R-T9a). */
export function spawnDamageMul(move: MoveDef | undefined): number {
  return move?.copyDamage ?? ONE;
}
