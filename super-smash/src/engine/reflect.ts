/**
 * Reflectors (Plan 5, Task 3): Fox's Reflector and Mario's Cape.
 *
 * A reflector is a bubble a move raises for a span of frames. A reflectable
 * projectile that touches it changes hands: it belongs to the reflector's
 * owner from then on, flies back the way it came, faster and harder by the
 * move's multipliers, with its life renewed by the lifetime multiplier and its
 * hit record cleared so it can hit the fighter who threw it. SmashWiki
 * "Reflection" (https://www.ssbwiki.com/Reflection): "Reflected projectiles
 * also change ownership from the original user to the reflector"; a projectile
 * can be reflected at most seven times; a projectile past the reflector's
 * damage threshold is not reflected and hits instead.
 *
 * Only the owner changes hands. `ProjectileState.source`, the fighter whose
 * moveset defines the projectile, stays the spawner's: it is still that
 * fighter's fireball or laser, and `step()` looks its definition up there.
 *
 * Everything here mutates the projectile and the reflector's fighter only, so
 * it rolls back with them.
 */

import { ONE, mul } from "./fixed";
import { actionFrameOf, circle, moveFrameOf, sweptCapsulePenetration } from "./hitbox";
import type { Capsule } from "./hitbox";
import { kineticSetX, kineticSetY } from "./kinetic";
import { fighterParams } from "./params";
import { NO_STALE } from "./projectile";
import { startAction, startRoll } from "./states";
import type { Intent, StateContext } from "./states";
import type { FighterDef, FighterState, GameState, ProjectileDef, ProjectileState, ReflectorDef, StallDef, StepEvents } from "./types";

/**
 * SmashWiki "Reflection" (https://www.ssbwiki.com/Reflection): "projectiles can
 * only be reflected up to 7 times before disappearing."
 */
export const MAX_REFLECTIONS = 7;

/**
 * The reflector this fighter has up this frame, if any. Only a special raises
 * one: every reflector in the roster is one (the Reflector, the Cape), and only
 * the special status counts `reflectHold` down and clears it (`reflectorMain`,
 * `STATUS_SPECIAL`).
 */
export function activeReflector(f: FighterState, def: FighterDef): ReflectorDef | null {
  if (f.move === null || f.action !== "special") return null;
  const r = def.moves[f.move]?.reflector;
  if (r === undefined) return null;
  const g = moveFrameOf(f.actionFrame);
  return g >= r.active[0] && g <= r.active[1] ? r : null;
}

/** Where the bubble is: `r.y` above the fighter's origin, `r.x` in front. */
export function reflectorBubble(f: FighterState, r: ReflectorDef): Capsule {
  return circle(f.x + (f.facing >= 0 ? r.x : -r.x), f.y + r.y, r.radius);
}

/**
 * The projectile as the reflector sends it back. Pure in the projectile's
 * fields; `source` is left alone (see the file header).
 */
export function reflectProjectile(p: ProjectileState, def: ProjectileDef, by: FighterState, r: ReflectorDef): void {
  p.owner = by.port;
  // Its new owner's, and none of its moves': it stales by nothing and joins no queue
  // (Plan 5 final wave 2, ruling R-FW2b: `ProjectileState.staleAs`). UNVERIFIED: no
  // source says how Ultimate stales a reflected projectile; SmashWiki "Stale-move
  // negation" has only Melee's "Reflected projectiles ... contribute to the staleness
  // queue", whose queue it does not name. The alternatives: it keeps the stamp it was
  // fired with, or it queues the reflecting move.
  p.staleAs = NO_STALE.as;
  p.staleDamage = NO_STALE.damage;
  p.staleKnockback = NO_STALE.knockback;
  // UNVERIFIED: the speed multiplier scales and reverses `vx` only, and `vy`
  // carries on as it was; no source says how a reflector treats a vertical speed.
  p.vx = -mul(p.vx, r.speed);
  p.facing = -p.facing;
  p.chargeScale = mul(p.chargeScale, r.damage);
  // Lifetime ×m: it has `lifetime · m` frames left from here. UNVERIFIED
  // reading of SmashWiki's "Lifetime multiplier" — it renews the clock.
  // A running wave (Plan 6, Task 16 fix round 1) renews its own: its wave's life ×m
  // left (`ProjectileState.life`), and its age, its phase clock (`crawl.stages`), set as
  // every other projectile's is from the lifetime it runs on. UNVERIFIED: no source
  // covers a reflected wave. It runs back the other way round (`facing`, below).
  const crawling = p.mode === "crawl" && def.crawl !== undefined;
  const lifetime = crawling ? def.crawl!.life : def.lifetime;
  const left = Math.trunc((lifetime * r.lifetime) / ONE);
  p.age = lifetime - left;
  if (crawling) p.life = left;
  p.hitPorts.length = 0;
  // UNVERIFIED: a reflected boomerang starts its flight over, so it slows from
  // its reflected speed, turns, and comes back to the reflector, its owner now,
  // who catches it (`advanceProjectile`). No source covers a reflected boomerang.
  p.returning = false;
  // A bomb resting on the floor (Plan 5, Task 13c) stays where it rests: it rests
  // with no speed, and the reflector's multiplier leaves it none.
  p.reflected += 1;
}

export interface ReflectCandidate {
  readonly projectile: ProjectileState | null;
  readonly hitbox: { readonly radius: number; readonly damage: number };
  readonly x: number;
  readonly y: number;
  readonly prevX: number;
  readonly prevY: number;
  suppressed: boolean;
}

/**
 * Phase 6a: every projectile that touches a raised reflector is reflected
 * before anything clanks or hits. Fighters are tried in port order, so two
 * reflectors meeting one projectile resolve the same way on both peers.
 */
export function reflectProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  projectileDef: (p: ProjectileState) => ProjectileDef | undefined,
  candidates: ReflectCandidate[],
  events: StepEvents,
  destroyed: Set<number>,
): void {
  for (const c of candidates) {
    const p = c.projectile;
    if (p === null || c.suppressed || destroyed.has(p.instanceId)) continue;
    const def = projectileDef(p);
    if (def === undefined || def.reflectable !== true) continue;
    for (let i = 0; i < s.fighters.length; i++) {
      const f = s.fighters[i];
      if (i === p.owner || f.action === "dead") continue;
      const r = activeReflector(f, defs[i]);
      if (r === null) continue;
      if (sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, 0, 0, c.hitbox.radius, reflectorBubble(f, r)) < 0) continue;
      // Past the threshold the projectile goes through and hits (SmashWiki
      // "Fox (SSBU)/Down special", https://www.ssbwiki.com/Fox_(SSBU)/Down_special:
      // "Damage threshold 50%"; "Reflection": from Brawl on, "the projectile
      // simply ignores the reflector and hits the user").
      if (mul(c.hitbox.damage, p.chargeScale) > r.maxDamage) continue;
      c.suppressed = true;
      if (p.reflected >= MAX_REFLECTIONS) {
        destroyed.add(p.instanceId);
      } else {
        reflectProjectile(p, def, f, r);
        // Fox's reflector stays up at least 20 frames after a reflection
        // ("Minimum reflection period 20 frames").
        f.combat.reflectHold = r.holdAfterReflect;
        events.reflects.push({ port: f.port, x: p.x, y: p.y });
      }
      break;
    }
  }
  detectProjectiles(s, defs, projectileDef, candidates, destroyed);
}

/**
 * The reflector's own status logic, run from the special status's `main`.
 * Returns true when it consumed the frame. SmashWiki "Fox (SSBU)/Down special"
 * (https://www.ssbwiki.com/Fox_(SSBU)/Down_special) throughout.
 *
 * - **Escape**: in a reflection's minimum period, on the ground, a jump, a
 *   roll or a spot dodge ends the move into that action: "Upon reflecting a
 *   projectile, the move lasts an extra 20 frames before it can be ended,
 *   though it can also be canceled by a roll, spot dodge, or jump during this
 *   period" (`reflectEscape`). Without a reflection there is none.
 * - **Loop** (`r.loop`, Fox): the reflecting frames repeat while B is held or
 *   a reflection's minimum period runs ("Loop points 3-4 and 23-24"). After one
 *   full pass, letting go skips to the end ("After one full loop, releasing the
 *   button at any point causes the move to transition into the ending
 *   portion"). `FighterState.charge` counts the passes, as it counts a smash's
 *   charge.
 * - **Turn** (`r.turnFrom`): holding back turns the fighter round from that
 *   frame of the reflecting frames ("From frame 5 onward, Fox can also turn
 *   around with no delay during any frame of the reflecting portion").
 */
export function reflectorMain(f: FighterState, intent: Intent, ctx: StateContext, r: ReflectorDef): boolean {
  if (f.combat.reflectHold > 0 && f.grounded && reflectEscape(f, intent, ctx)) return true;
  if (f.combat.reflectHold > 0) f.combat.reflectHold -= 1;
  const g = moveFrameOf(f.actionFrame);
  if (r.turnFrom !== undefined && g >= r.turnFrom && g <= r.active[1] && intent.x === -f.facing) {
    f.facing = -f.facing;
  }
  if (r.loop === undefined) return false;
  const [from, to] = r.loop;
  const holding = intent.specialHeld || f.combat.reflectHold > 0;
  if (g === to + 1 && holding) {
    // Back to the first reflecting frame.
    f.actionFrame = actionFrameOf(from);
    f.charge += 1;
    return true;
  }
  if (f.charge >= 1 && !holding && g >= from && g <= to) {
    // On to the first frame after the loop: the ending portion.
    f.actionFrame = actionFrameOf(to + 1);
    return true;
  }
  return false;
}

/**
 * Out of a reflection, on the ground, into a jump, a roll or a spot dodge.
 * SmashWiki "Reflector (Fox)" (https://www.ssbwiki.com/Reflector_(Fox)): "When
 * Fox reflects a projectile on the ground from Brawl onward, he can cancel the
 * move into a roll, spot dodge or jump by making the appropriate directional
 * input during the reflector's animation change".
 *
 * UNVERIFIED: the first frame (the one after the reflection; no source gives
 * one) and the inputs, which are the ordinary ones: a jump press jumps, and a
 * shield press is a spot dodge with down held and a roll with a side held, as
 * out of a shield. A shield press with the stick at rest does nothing, so a
 * held Down alone (the Reflector's own input) never dodges.
 */
function reflectEscape(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (intent.jumpPressed) {
    startAction(f, "jumpSquat");
    return true;
  }
  if (!intent.shieldPressed) return false;
  if (intent.y < 0) {
    startAction(f, "spotDodge");
    return true;
  }
  if (intent.x !== 0) {
    startRoll(f, intent.x, ctx);
    return true;
  }
  return false;
}

/**
 * A special's stall in the air (`MoveDef.stall`, `StallDef`): a **stop** on the
 * airtime's first aerial use, and the move's own **physics** with it (and on
 * every aerial use, for `everyUse`).
 * - Fox's Reflector: SmashWiki "Reflector (Fox)"
 *   (https://www.ssbwiki.com/Reflector_(Fox)), "However, it now only stalls Fox
 *   once in midair"; "Fox (SSBU)" (https://www.ssbwiki.com/Fox_(SSBU)), "he
 *   can only do it once until he lands or gets hit"; "Fox (SSBU)/Down special"
 *   (https://www.ssbwiki.com/Fox_(SSBU)/Down_special), "Horizontal speed
 *   multiplier on startup 0.5", "Period before applying gravity 4 frames",
 *   "Gravity 0.027". A later use falls as Fox does.
 * - Mario's Cape: SmashWiki "Mario (SSBU)/Side special"
 *   (https://www.ssbwiki.com/Mario_(SSBU)/Side_special), "Horizontal speed
 *   divisor 2.5", "Air friction 0.0025", "Vertical speed added 0.3", "Gravity
 *   0.031", "Falling speed 1". The stop is the first midair use's only (Super
 *   Mario Wiki "Cape": the first midair use "briefly stops Mario's falling");
 *   the physics are every aerial use's, the page's numbers being the move's.
 *
 * Run as the special status's `exec`, after the FALL kinetic type has applied
 * the fighter's own gravity, which it replaces with the move's (the air
 * friction is the kinetic type's, `applyMovement`). `CombatState.specialStall`
 * says the airtime's stop is spent; `stalling`, that this special made it.
 *
 * The no-gravity frames are the first pass's only (`FighterState.charge`, the
 * passes `reflectorMain` counts, still 0). A held Reflector loops back to its
 * frame 4, and stopping the fall again on each pass would hover Fox for as long
 * as B is held; the stall is once per airtime, so every later pass falls by the
 * move's gravity.
 */
export function specialStallExec(f: FighterState, ctx: StateContext, stall: StallDef, gravityBefore: number): void {
  if (f.grounded) return;
  const g = moveFrameOf(f.actionFrame);
  if (g === 1 && !f.combat.specialStall) {
    // The stop: the airtime's first aerial use only.
    f.combat.specialStall = true;
    f.combat.stalling = true;
    // UNVERIFIED: the startup's horizontal multiplier goes with the stop, so a
    // later aerial use in one airtime keeps its speed.
    kineticSetX(f, mul(f.vx, stall.startX));
    // The fall stopped dead. UNVERIFIED reading of "Vertical speed added": the
    // boost goes on top of that, and on top of a rise.
    kineticSetY(f, stall.boostY > 0 ? Math.max(f.vy, 0) + stall.boostY : 0);
    return;
  }
  if (!f.combat.stalling && stall.everyUse !== true) return;
  const p = fighterParams(ctx.def);
  // The speed before this frame's own gravity, which the move's replaces: the FALL
  // step's change to GRAVITY, undone exactly (Plan 5 final wave 2, ruling R-FW2j; Task
  // 4 re-review 1, Minor 3). Read back from the step's result, as it was before, a step
  // stopped at the fighter's terminal looked like one that never reached it: a frame
  // starting within his own gravity of it went there at once (Fox, 0.198 too far),
  // and a fast fall's terminal had to be told apart by hand.
  const before = f.vy - (f.kinetic.gravityY - gravityBefore);
  if (f.combat.stalling && g <= stall.noGravityFrames && f.charge === 0) {
    // No gravity at all: the speed the stop left holds, a boost included.
    kineticSetY(f, before);
    return;
  }
  const terminal = -(stall.fallSpeed ?? p.air_speed_y_stable);
  kineticSetY(f, Math.max(terminal, before - stall.gravity));
}

/**
 * The early reflect (Mario's Cape, `ReflectorDef.detector`): a reflectable
 * projectile inside a fighter's detector on one of its frames skips the move
 * on, so the next frame is the detector's `to`. SmashWiki "Mario (SSBU)"
 * (https://www.ssbwiki.com/Mario_(SSBU)): the reflector can "start two frames
 * earlier (frame 7) if a projectile is very close to Mario at the time", and
 * then "the entire move loses two frames of startup, allowing the offensive
 * hitbox to come out earlier (on frame 10)"; `game_specials`: a `SEARCH` from
 * frame 6 to 8 and `REFLECT_MOTION_FRAME` 9. UNVERIFIED: which projectiles it
 * reacts to (here, as for the reflector, anyone else's reflectable ones), and
 * that the skip shows on the detecting frame (the frame is drawn as `to` − 1).
 */
function detectProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  projectileDef: (p: ProjectileState) => ProjectileDef | undefined,
  candidates: readonly ReflectCandidate[],
  destroyed: ReadonlySet<number>,
): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (f.action !== "special" || f.move === null) continue;
    const d = defs[i].moves[f.move]?.reflector?.detector;
    if (d === undefined) continue;
    const g = moveFrameOf(f.actionFrame);
    if (g < d.frames[0] || g > d.frames[1]) continue;
    const side = f.facing >= 0 ? 1 : -1;
    const zone: Capsule = { x1: f.x + side * d.x1, y1: f.y + d.y, x2: f.x + side * d.x2, y2: f.y + d.y, r: d.radius };
    const near = candidates.some((c) => {
      const p = c.projectile;
      if (p === null || p.owner === i || c.suppressed || destroyed.has(p.instanceId)) return false;
      if (projectileDef(p)?.reflectable !== true) return false;
      return sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, 0, 0, c.hitbox.radius, zone) >= 0;
    });
    if (near) f.actionFrame = actionFrameOf(d.to - 1);
  }
}
