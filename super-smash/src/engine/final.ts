/**
 * Final Smashes (Plan 5, Task 14).
 *
 * Breaking the Smash Ball sets `finalSmashReady` ("Standby Mode"); SmashWiki
 * "Final Smash" (https://www.ssbwiki.com/Final_Smash): "the character's neutral
 * special move is replaced with a single use of their Final Smash", so the next
 * *neutral* special spends it and starts the fighter's `finalSmash` move
 * (`beginFinalSmash`). SmashWiki "Smash Ball" (https://www.ssbwiki.com/Smash_Ball):
 * "Players can attack a fighter in standby mode to make them 'drop' the Smash
 * Ball, at which point it will begin roaming the stage again" (`dropSmashBall`).
 * A cinematic Final Smash traps whoever its first hit touches, and then, SmashWiki
 * "Final Smash": "If the hitbox created from this action makes contact with an
 * opponent, the game effectively pauses as an unskippable scene plays out". The
 * replica plays that scene in the simulation itself, as ordinary state, so a
 * rollback replays it exactly:
 *
 * - `start`: the `finalSmash` move. With `trap`, every box of it that lands traps
 *   instead of hitting: the victim takes the damage and waits, trapped
 *   (`finalTrapped`, `CombatState.trappedBy`). With nobody trapped it simply
 *   ends: a whiff.
 * - `attack`: the scene's hits. `GameState.cinematic` holds the user's port, and
 *   everybody else, every projectile, the Smash Ball and the clock stand still
 *   (`updateCinematic`, `inCinematic`). Its boxes reach every fighter it trapped,
 *   wherever they are (SSBU hangs them off `virtualfinalattack` bones, which the
 *   scene places; the replica has none), for damage only.
 * - `end`: the finishing blow, which also reaches every fighter trapped, and
 *   launches. The scene stands the match still through it until the launch
 *   (Task 15).
 *
 * A part goes on to the next when it ends, or from its `nextAt` frame (Task 15),
 * with somebody trapped. Scene boxes keep no hit record, so each is authored one
 * frame long and lands once (`fighters/finalKit.ts`).
 *
 * While its scene plays, the user is held where it is, in the air too, and a
 * landing never ends a part (fix round 1, ruling R-T14d); the stage's clock stops
 * with everything else (`GameState.stageFrame`, ruling R-T14f); and the scene and
 * the world freeze on the same steps (`step`, ruling R-T14g). Kirby in Stone is not
 * trapped (ruling R-T14e, `applyHit`).
 *
 * A Final Smash with no `trap` (Task 16's: Mario Finale, Zero Laser, the Ancient
 * Bow and Arrow) is an ordinary, very large move, its projectiles included.
 * SmashWiki "Unblockable attack" (https://www.ssbwiki.com/Unblockable_attack):
 * "in Ultimate, all Final Smashes are unblockable", an unblockable attack being
 * one that "cannot be defended against with a shield or a counterattack"; so no
 * counter catches a Final Smash box or projectile, and no shield takes one
 * (`step`, the candidates' `final`). UNVERIFIED-simplified: the cutscene's camera
 * and its playback speed are presentation (Task 17).
 *
 * `final.ts` and `states.ts` import each other: `states.ts` calls
 * `beginFinalSmash` and `status/attack.ts` `nextFinalPhase`, and this file calls
 * `startMove`, `startAction` and `releaseGrab`. The cycle is safe only because
 * neither side calls the other at module load: every call is made at run time,
 * from inside a function, so whichever module loads first finds the other's
 * exports bound by the time any of them runs. Keep it that way: no top-level
 * call across the cycle.
 */

import { momentumWindows } from "./acmd/run";
import { kineticClear } from "./kinetic";
import { SMASH_BALL_HEALTH } from "./constants";
import { fx } from "./fixed";
import { actionFrameOf, moveFrameOf } from "./hitbox";
import { releaseGrab, startAction, startMove } from "./states";
import type { StateContext } from "./states";
import type { FighterDef, FighterState, GameState, MoveDef, MoveSlot } from "./types";

/**
 * The ready flag the Smash Ball sets ("Standby Mode"). It lasts until it is used:
 * SmashWiki "Smash Ball" (https://www.ssbwiki.com/Smash_Ball), "The Final Smash can
 * then be unleashed at any time by pressing the input for a neutral special move",
 * and "While a character is in standby mode, no Smash Balls will appear until the
 * Final Smash is used (or the Smash Ball is dropped)"; SmashWiki "Final Smash" gives
 * only the Meter's a limit, "As of the 4.0.0 update, a charged FS Meter now has a
 * time limit of 20 seconds". It is also lost with a dropped ball (`dropSmashBall`)
 * and, UNVERIFIED, with a stock (`step`'s KO). UNVERIFIED: that the standby has no time
 * limit in Ultimate; no source publishes one, or a number (Plan 5 final wave 2, ruling
 * R-FW2m: `SMASH_BALL_SPAWN_INTERVAL`'s note). Left to the polish phase.
 */
export const FINAL_SMASH_READY = 1;

/** The slots a Final Smash's parts are in: only a Final Smash is ever in them. */
const FINAL_SLOTS: ReadonlySet<MoveSlot> = new Set<MoveSlot>(["finalSmash", "finalAttack", "finalEnd"]);

/** Is `slot` one of a Final Smash's parts (`FINAL_SLOTS`)? The one list, for the CPU too (Plan 5, Task 19 fix round 1). */
export function isFinalSlot(slot: MoveSlot | null): boolean {
  return slot !== null && FINAL_SLOTS.has(slot);
}

/**
 * Is anybody's Final Smash out? While one is, everybody else in standby is out of
 * it, and has the power back once it is over (Plan 5, Task 14 fix round 1, ruling
 * R-T14h): SmashWiki "Final Smash", "When a Final Smash is active, all other players
 * on standby temporarily exit standby mode and regain it upon conclusion", and
 * "only one Smash Ball or Final Smash can be present onscreen at any given time". So
 * nobody else starts one, no hit drops one, and no Smash Ball appears (`step`'s
 * `updateSmashBall`), until it is over.
 *
 * It is out while its user is in one of its parts, or while any projectile one of
 * them launched is still out, `projectileOut` (Task 16 fix round 1, ruling R-T16a:
 * `isFinalProjectile`): Mario Finale's flames and the Ancient Arrow fly on after
 * their move has ended, and are as much the Final Smash as the move was.
 */
export function finalSmashActive(s: { readonly fighters: readonly FighterState[] }, projectileOut: boolean): boolean {
  return projectileOut || s.fighters.some((f) => f.action === "special" && isFinalSlot(f.move));
}

/**
 * Does `f`'s Final Smash hold it where it is in the air? Every part of one, used in the
 * air, stands its user still: one that traps nobody (Mario Finale, Zero Laser, the
 * Ancient Bow and Arrow; Plan 5, Task 16 fix round 1, ruling R-T16b); a cinematic one's
 * start too, which whiffed plays to its end there (Jungle Rush, Ultra Sword, Team Star
 * Fox; fix round 2, ruling R-T16j); and its end, through and past the scene's launch,
 * until the move is over (fix round 3, ruling R-T16k). SmashWiki "Mario (SSBU)/Final
 * Smash" calls Mario Finale "a desperate recovery tool", and SmashWiki "Final Smash":
 * "When most Final Smashes are performed in the air, upon ending the move, the
 * character gains a slight boost in height and regains their spent midair jumps,
 * which can aid in recovery" (`refreshFinalJumps`): the user is let go when the move
 * ends. While a scene plays, it holds its user anyway (ruling R-T14d).
 *
 * The one exception is a part that travels (`travelWindows`): it holds its user only
 * before its first travel window, its windup, and from that window's first frame to the
 * move's end keeps its normal kinetics, the travel and then whatever its status does with
 * the speed and gravity (fix round 4, ruling R-T16l, amended; round 3 held after the
 * window too). So a dash whiffed in the air carries on and falls, as published: SmashWiki
 * "Critical Hit" (https://www.ssbwiki.com/Critical_Hit), "In the air, the user will
 * travel at high speed directly forward", and "missing with this attack … in the air
 * without any intervening terrain, usually results in a self-destruct"; "Volt Tackle"
 * (https://www.ssbwiki.com/Volt_Tackle), "it is fairly easy to self-destruct off the side
 * blast line if the player misses", after it "Surrounds itself with electricity before
 * dashing forwards" (SmashWiki "Pikachu (SSBU)", ruling R-T15h). Which parts travel, and
 * on which frames, is pinned (`finalSmash.test.ts`, ruling R-T16m): today Critical Hit's
 * dash and Volt Tackle's alone.
 *
 * UNVERIFIED: the kinetics, no gravity and no movement at all while held (no page gives
 * them), and from a travel window on, the engine's ordinary ones (the window's speed
 * handed on to drift, `applyMoveMomentum`, and gravity); the height boost has no
 * published size and is not modelled.
 */
export function holdsAloft(f: FighterState, def: FighterDef): boolean {
  if (f.grounded || f.action !== "special" || f.move === null) return false;
  if (def.moves[f.move]?.final === undefined) return false;
  const windows = travelWindows(def, f.move);
  return windows.length === 0 || moveFrameOf(f.actionFrame) < Math.min(...windows.map(([from]) => from));
}

/**
 * The move frames a Final Smash part travels on (`holdsAloft`): each window of the
 * scripted movement the engine applies to it (`moveMomentum`), from its first frame to
 * the last it holds the speed: a script's own `momentum` commands where it has any, else
 * the move's `MoveDef.momentum` (`momentumWindows`; Plan 5, Task 16 fix rounds 3 and 4,
 * rulings R-T16l, R-T16m and R-T16n). None for a part that never travels.
 */
export function travelWindows(def: Pick<FighterDef, "moves" | "scripts">, slot: MoveSlot): readonly (readonly [number, number])[] {
  return momentumWindows(def, slot);
}

/**
 * A Final Smash ending in the air gives its user back the midair jumps it had spent
 * (ruling R-T16b): SmashWiki "Final Smash", "upon ending the move, the character
 * [...] regains their spent midair jumps". Every Final Smash, the cinematic ones too.
 * The first jump, from the ground, is not a midair jump: one that left the ground
 * keeps it spent (`jumpsUsed` counts it).
 */
export function refreshFinalJumps(f: FighterState): void {
  if (!f.grounded) f.jumpsUsed = Math.min(f.jumpsUsed, 1);
}

/** The fighters `user`'s Final Smash has trapped. */
export function trappedBy(s: { readonly fighters: readonly FighterState[] }, user: number): FighterState[] {
  return s.fighters.filter((f) => f.action === "finalTrapped" && f.combat.trappedBy === user);
}

/**
 * A neutral special with a Final Smash ready starts it, and spends it; anything
 * else leaves the power where it is, and so does somebody else's Final Smash out
 * (`finalSmashActive`). Returns true if it started.
 *
 * The user is intangible from the step the power is spent (fix round 1, ruling
 * R-T14i): SmashWiki "Final Smash", "Final Smashes are unblockable, make the user
 * fully intangible". A move's window holds from its first step (`advanceFighter`
 * asserts it again after the status's `main`, which is where this is called; Plan 5
 * final wave 2, ruling R-FW2a), so a hit on that step cannot cost the Final Smash it
 * had just spent; nor, on the step its scene starts, the scene.
 */
export function beginFinalSmash(f: FighterState, ctx: StateContext, neutral: boolean): boolean {
  if (!neutral || f.finalSmashReady <= 0 || ctx.def.moves.finalSmash === undefined || finalSmashActive(ctx, ctx.finalProjectileOut?.() === true)) return false;
  f.finalSmashReady = 0;
  startMove(f, "special", "finalSmash");
  return true;
}

/**
 * A trap box landed: the victim waits, trapped, for the scene, still where it
 * was caught (`kineticClear`; `step` neither moves nor collides it, nor lets it
 * take a ledge). Anybody it was holding, or being held by, is let go first
 * (`releaseGrab` clears both halves), so nobody is left hanging off a fighter
 * who is in the cutscene. The reel it was in ends: the scene's last blow is
 * what launches it. `step` also drops any launch it had parked.
 */
export function trapVictim(user: FighterState, victim: FighterState, fighters: readonly FighterState[]): void {
  releaseGrab(victim, fighters);
  kineticClear(victim);
  victim.hitstun = 0;
  startAction(victim, "finalTrapped");
  victim.combat.trappedBy = user.port;
}

/**
 * Called when a Final Smash part's move ends, or reaches its `nextAt` (Task 15):
 * on to the next part if anybody is trapped, else nothing. Returns the slot
 * started, or null. The scene plays where the trap landed: whatever carried the
 * user there (Critical Hit's dash, Volt Tackle's tackle) stops (`kineticClear`).
 */
export function nextFinalPhase(f: FighterState, ctx: StateContext, next: MoveSlot | undefined): MoveSlot | null {
  if (next === undefined) return null;
  if (trappedBy(ctx, f.port).length === 0) return null;
  kineticClear(f);
  startMove(f, "special", next);
  return next;
}

/**
 * Is `f` in its move's dash, the first `momentum` window, which `MoveDef.dashEnd`
 * may end early (Task 15 fix round 1, ruling R-T15f)?
 */
export function inDash(f: Pick<FighterState, "actionFrame">, move: MoveDef): boolean {
  const w = move.dashEnd === undefined ? undefined : move.momentum?.[0];
  if (w === undefined) return false;
  const frame = moveFrameOf(f.actionFrame);
  return frame >= w.frame && frame <= w.frame + (w.hold ?? 0);
}

/**
 * End the dash `f` is in (`inDash`): it stops dead, and the move goes on from the
 * frame after the window, this step, with whatever the window held (its boxes)
 * passed. Critical Hit's whiff then plays its end, final_dash_end, "without the user
 * swinging" (SmashWiki "Critical Hit", https://www.ssbwiki.com/Critical_Hit).
 */
export function endDash(f: FighterState, move: MoveDef): void {
  const w = move.momentum![0];
  kineticClear(f);
  f.actionFrame = actionFrameOf(w.frame + (w.hold ?? 0) + 1);
}

/**
 * The cinematic, decided once a frame after the state machines have run: it
 * plays while a fighter's move is an `attack` or `end` part with somebody still
 * trapped. The end's finishing blow launches them, and that ends it (Task 15).
 */
export function updateCinematic(s: GameState, defs: readonly FighterDef[]): void {
  s.cinematic = -1;
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (f.action !== "special" || f.move === null) continue;
    const phase = defs[i].moves[f.move]?.final?.phase;
    if (phase !== "attack" && phase !== "end") continue;
    if (trappedBy(s, f.port).length > 0) {
      s.cinematic = f.port;
      return;
    }
  }
}

/** Does this fighter play on while `s.cinematic` stands everybody else still? */
export function inCinematic(s: Pick<GameState, "cinematic">, f: FighterState): boolean {
  return f.port === s.cinematic || (f.action === "finalTrapped" && f.combat.trappedBy === s.cinematic);
}

/**
 * A hit that deals hitstun to a fighter in standby drops the Smash Ball's power,
 * and the ball roams again from where they are. SmashWiki "Final Smash" (In
 * competitive play): "Characters on Final Smash standby can also randomly drop it
 * from any hit that deals hitstun". Not while somebody's Final Smash is out: then
 * the fighter is not in standby, and has the power back after (`finalSmashActive`,
 * ruling R-T14h; its projectiles too, `projectileOut`, ruling R-T16a). UNVERIFIED:
 * every such hit drops it here (the page says "randomly", and publishes no chance);
 * the dropped ball's HP (a fresh one's 40) and the 10 units above the fighter it
 * appears at.
 */
export function dropSmashBall(s: Pick<GameState, "smashBall" | "fighters">, f: FighterState, projectileOut: boolean): void {
  if (f.finalSmashReady <= 0 || finalSmashActive(s, projectileOut)) return;
  f.finalSmashReady = 0;
  if (s.smashBall.active) return;
  Object.assign(s.smashBall, { active: true, x: f.x, y: f.y + fx(10), vx: 0, vy: 0, health: SMASH_BALL_HEALTH, driftTimer: 0 });
}
