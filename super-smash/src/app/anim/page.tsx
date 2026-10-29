/**
 * The animation lab.
 *
 * A development harness, not part of the game. It exists because animation is
 * the one thing in this codebase that cannot be judged from its source: a clip
 * is a list of angles, and whether those angles read as a fighter landing is a
 * question only the eye can answer. Before this page existed, checking a
 * movement meant starting a match, provoking the state, and hoping a screenshot
 * landed on the right frame — at 60Hz a screenshot round-trip is fifteen frames
 * wide, so most animations were never actually looked at.
 *
 * One view: the **contact sheet** (`Lab3D`), one cell per *simulation frame*
 * of the action at its true length, each the fighter's SSBU model posed by the
 * match's own pose (`drawnPose`, on the sim's clock) with the sim's hitboxes
 * and hurtboxes over it. This is the view that tells the truth about timing: a
 * four-frame landing gets four cells, and if three of them are the same drawing
 * you can see that they are. A clip edit is a gameplay edit now (D57), and this
 * is where its limbs and boxes are looked at together.
 *
 * Plan 4 removed the 2D contact sheet and the 60 Hz 2D playback: they drew the
 * 2D figure the match no longer draws.
 */

"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { actionDurationFor, poseNameFor, poseTimeFor, jumpTimingFor, type JumpTiming } from "@/render/poses";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { makeFighter } from "@/render/testFixtures";
import { clipFor } from "@/render/chars";
import { FIGHTER_IDS, getFighter } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { useBake } from "@/game/useBake";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import type { ActionState, FighterDef, FighterState, MoveSlot } from "@/engine/types";

/**
 * The contact sheet, in 3D. three.js (~200 KB gzipped) loads with it, through
 * `import()`, after the page is up, so the page's own controls need none of it
 * (`app/chunkSplit.test.ts` walks this page's static imports for it).
 */
const Lab3D = dynamic(() => import("./Lab3D").then((m) => m.Lab3D), {
  ssr: false,
  loading: () => <p style={{ color: "#7C8896", fontSize: 12, margin: "6px 0" }}>contact sheet — loading</p>,
});

/** Every action worth looking at, grouped the way an animator would think of them. */
const GROUPS: ReadonlyArray<readonly [string, readonly ActionState[]]> = [
  ["ground", ["stand", "walk", "dashStart", "run", "runBrake", "turnaround"]],
  ["crouch", ["crouchStart", "crouch", "crouchEnd"]],
  ["air", ["jumpSquat", "jump", "fall", "land", "landingLag"]],
  ["defence", ["shieldStart", "shield", "shieldRelease", "shieldBroken", "roll", "spotDodge", "airDodge"]],
  ["reeling", ["hitstun", "tumble", "tumbleFall", "downed", "getUp", "grabbed", "thrown"]],
  ["tech", ["tech", "techRoll", "techWall", "techCeiling"]],
  ["ledge", ["ledgeHang", "ledgeGetUp", "ledgeJump", "ledgeTrumped"]],
  ["offence", ["attack", "special", "grab", "throw"]],
];

const MOVES: readonly MoveSlot[] = [
  "jab1", "ftilt", "utilt", "dtilt", "dashAttack", "fsmash", "usmash", "dsmash",
  "nair", "fair", "bair", "uair", "dair", "neutralB", "sideB", "upB", "downB",
  "grab", "fthrow", "bthrow", "uthrow", "dthrow",
];

/** How long the lab should show an action that has no natural end. */
const OPEN_ENDED = 40;

/**
 * How many frames of this action the sheet should draw.
 *
 * `moveFrames` is separate from `jump` because an attack's length is not a
 * property of the *state* — `actionDurationFor` reads the state machine's own
 * constants and an attack has none, since it lasts exactly as long as the move
 * being thrown. Without it the lab quietly fell back to forty cells for every
 * attack, so a 79-frame down air was reviewed at just over half its length and
 * whatever happened after frame 40 was authored blind. The recovery of a slow
 * move is not a detail: it is most of what a stuffed attack looks like.
 */
function lengthOf(f: FighterState, jump?: JumpTiming, moveFrames?: number): number {
  const name = poseNameFor(f);
  const clip = clipFor(f.defId, name);
  if (!clip.loop) {
    return actionDurationFor(f, jump) ?? (moveFrames && moveFrames > 0 ? moveFrames : OPEN_ENDED);
  }
  // A speed-paced cycle has no fixed frame count — find the frame the clip
  // comes back round to its start, so the sheet shows exactly one cycle.
  if (poseTimeFor(name, { ...f, actionFrame: 1 }, 0) === 0) return clip.period ?? 30;
  for (let n = 2; n <= 240; n++) {
    if (poseTimeFor(name, { ...f, actionFrame: n }, 0) < poseTimeFor(name, { ...f, actionFrame: n - 1 }, 0)) {
      return n;
    }
  }
  return clip.period ?? 30;
}

/**
 * The fighter as the game plays it against `bake`: its limb-bone scripts on and
 * their `MoveDef` tables placed through the bake's bones (`withLimbScripts`,
 * ruling R1(a)) — the very object the installed context hands the sim, the CPU
 * and the match's renderer. Without a bake, the plain def.
 */
export function gameFighterFor(id: string, bake: BakeTables | null): FighterDef | undefined {
  const base = getFighter(id);
  return base !== undefined && bake !== null ? withLimbScripts(base, bake.bones) : base;
}

/**
 * How many cells the sheet draws for these options: the action's true length.
 *
 * An attack's length is its move's `totalFrames`, and the game's is not always
 * the legacy table's: a slot running its imported script ends on the script's
 * published first actionable frame (`withReferenceScripts`), which differs from
 * the legacy length for Mario's up air, Kirby's neutral and up airs and Fox's
 * neutral air. So once the bake is in, the game's own def is asked
 * (`withLimbScripts`), the one the sim, the bake and the match play.
 */
export function lengthFor(o: Options, bake: BakeTables | null): number {
  const def = gameFighterFor(o.fighterId, bake);
  return lengthOf(
    fighterAt(o, 0),
    def ? jumpTimingFor(def) : undefined,
    usesMoveFor(o.action) ? def?.moves?.[moveFor(o)]?.totalFrames : undefined,
  );
}

export interface Options {
  readonly fighterId: string;
  readonly action: ActionState;
  readonly move: MoveSlot;
  readonly jumpsUsed: number;
  readonly fastFalling: boolean;
}

/**
 * The move an action actually performs.
 *
 * The move dropdown is hidden for an action that does not take one, but the
 * *value* stays at whatever was last picked — so selecting `grab` left `move`
 * on `fsmash`, and once `drawMoveFx` learned to draw during a grab the lab
 * painted Mario's fire palm over his grab. A grab performs the grab; nothing
 * else here performs a move it did not choose.
 */
export function moveFor(o: Options): MoveSlot {
  return o.action === "grab" ? "grab" : o.move;
}

/** The moves that are only ever thrown in the air. */
const AERIALS: ReadonlySet<MoveSlot> = new Set(["nair", "fair", "bair", "uair", "dair"]);

/**
 * Whether the lab should draw this option set standing on the ground.
 *
 * Exported so it can be tested, because getting it wrong is silent: the
 * fighter looks the same either way, and only a prop that reads `airborne`
 * behaves differently.
 *
 * It used to list the three states whose *names* say airborne, which drew a
 * neutral air as a fighter standing on the floor. That was invisible until the
 * 2D figure's prop timing began reading `grounded`, at which point every
 * airborne-dependent prop — Pikachu's tail, Marth's cape — behaved in the
 * authoring view as it never would in a match. (That timing, and the outline
 * width the lab and the match once shared, went with the 2D figure in Plan 4.)
 */
export function groundedFor(o: Options): boolean {
  if (AIRBORNE.has(o.action)) return false;
  return !(usesMoveFor(o.action) && AERIALS.has(moveFor(o)));
}

/**
 * The actions a fighter is off the ground for.
 *
 * `ledgeHang` and `ledgeJump` are here because a ledge is grabbed *from* the
 * air and nothing re-grounds the fighter while they hang — `grabLedge` never
 * touches `grounded`, and `applyMovement` returns early for anyone on a ledge.
 * They were missing because the first version of this listed the three states
 * whose names say airborne. `ledgeTrumped` is the fall that follows losing it.
 *
 * `ledgeGetUp` is deliberately absent: it starts off the stage and finishes on
 * it, so either answer is wrong for half the clip, and "on the ground" is right
 * for the frames a prop is most likely to be read in.
 */
const AIRBORNE: ReadonlySet<ActionState> = new Set([
  "jump",
  "fall",
  "airDodge",
  "ledgeHang",
  "ledgeJump",
  "ledgeTrumped",
  // A tumbling fighter who touches the ground becomes `downed` (or a tech) on
  // that frame, so every frame that is still `tumble` or `tumbleFall` is a frame
  // in the air. A wall or ceiling tech is in the air too; the floor techs
  // (`tech`, `techRoll`) are on it.
  "tumble",
  "tumbleFall",
  "techWall",
  "techCeiling",
]);

/** Whether this action performs a move, and so has frame data of its own. */
export function usesMoveFor(action: ActionState): boolean {
  return action === "attack" || action === "special" || action === "throw" || action === "grab";
}

/**
 * The fighter these options show on `frame`: that many frames into the action,
 * at the origin facing forward. The sheet poses it through the match's own
 * `drawnPose` and puts the same fighter's boxes over it (`Lab3D`).
 */
export function fighterAt(o: Options, frame: number): FighterState {
  return makeFighter({
    defId: o.fighterId,
    action: o.action,
    actionFrame: frame,
    move: moveFor(o),
    jumpsUsed: o.jumpsUsed,
    fastFalling: o.fastFalling,
    // A reel is as long as the hit that caused it; 24 is an average one.
    hitstun: o.action === "hitstun" ? Math.max(0, 24 - frame) : 0,
    charge: o.action === "landingLag" ? 16 : 0,
    grounded: groundedFor(o),
    // Walk and run are paced by ground covered rather than by frames elapsed,
    // so a fighter standing still freezes mid-step. Give them their own speed
    // or the lab shows one motionless drawing for the cycles that move most.
    vx: speedFor(o),
    vy: verticalFor(o, getFighter(o.fighterId), frame),
  });
}

/**
 * A plausible vertical velocity for the state being shown.
 *
 * Zero for everything was the fourth way this file has been caught disagreeing
 * with the renderer in one pass — a fall drawn at zero `vy` tells a prop the
 * fighter is hanging at the apex, so Fox's tail and Marth's cape show their
 * apex behaviour through a whole descent and never their falling one.
 *
 * An approximation, and deliberately a coarse one: the lab has no simulation
 * and inventing an arc here would be inventing physics. A fall gets the
 * fighter's own terminal speed, a jump the engine's own rise for that frame
 * (`jumpRiseSpeeds`, the same numbers `step()` produces), and everything else
 * stays at zero because everything else genuinely is.
 */
export function verticalFor(o: Options, def: FighterDef | undefined, frame: number): number {
  if (!def) return 0;
  const p = fighterParams(def);
  if (o.action === "fall" || o.action === "tumbleFall") return -(o.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
  if (o.action === "jump") {
    // The second jump is a different rise — the lab offers the choice, so it
    // has to honour it. Past the apex the clip is over; the speed is 0.
    const rise = o.jumpsUsed >= 2 ? jumpRiseSpeeds(p, "air", o.jumpsUsed - 2) : jumpRiseSpeeds(p, "full");
    return rise[frame] ?? 0;
  }
  return 0;
}

/**
 * What this deliberately does **not** model, and why.
 *
 * An aerial attack keeps whatever velocity the fighter carried into it, and a
 * move with `MoveDef.momentum` — Dolphin Slash, Fox Illusion — drives itself.
 * Both were raised in review and both are declined here: reproducing them means
 * running the simulation, and a hand-rolled approximation of it inside a dev
 * harness is a second physics implementation that can disagree with the real
 * one. A lab that is *approximately* right about velocity is worse than one
 * that is plainly neutral, because an author cannot tell which they are looking
 * at.
 *
 * The tool for a move's real velocity already exists and is what the character
 * work is reviewed with: `scripts/fightsheet.mjs` plays the move in an actual
 * match and hand-cranks the clock. The lab's job is the pose at its true
 * length; the match's job is the motion.
 */

/** The fighter's own ground speed, for the clips that are paced by it. */
function speedFor(o: Options): number {
  const attrs = getFighter(o.fighterId)?.attributes;
  if (!attrs) return 0;
  if (o.action === "walk") return attrs.walkSpeed;
  if (o.action === "run" || o.action === "dashStart" || o.action === "runBrake") return attrs.runSpeed;
  return 0;
}

export default function AnimLab() {
  const [fighterId, setFighterId] = useState("mario");
  const [action, setAction] = useState<ActionState>("land");
  const [move, setMove] = useState<MoveSlot>("fsmash");
  const [jumpsUsed, setJumpsUsed] = useState(1);
  const [fastFalling, setFastFalling] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);

  const o = useMemo<Options>(
    () => ({ fighterId, action, move, jumpsUsed, fastFalling }),
    [fighterId, action, move, jumpsUsed, fastFalling],
  );
  // The bake loads (and installs) in the background, as the match's does; until it is in the lab shows the legacy lengths.
  const { tables } = useBake();
  const total = useMemo(() => lengthFor(o, tables), [o, tables]);
  const poseName = useMemo(() => poseNameFor(fighterAt(o, 0)), [o]);

  // The frame the scrubber and the sheet's caption show, stepping at 60 Hz while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / 60) return;
      last = now;
      setFrame((f) => (f + 1) % Math.max(1, total));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // The grab has frame data but no choice of slot, so it gets no dropdown.
  const usesMove = action === "attack" || action === "special" || action === "throw";

  return (
    <main style={{ padding: 20, background: "#0A0C0F", color: "#DCE3EA", minHeight: "100vh", fontFamily: "ui-monospace, monospace" }}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>
        Animation lab — <span style={{ color: "#FFD500" }}>{poseName}</span>{" "}
        <span style={{ color: "#7C8896" }}>({total} frames)</span>
      </h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select aria-label="Fighter" value={fighterId} onChange={(e) => setFighterId(e.target.value)}>
          {FIGHTER_IDS.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value as ActionState)}>
          {GROUPS.map(([group, actions]) => (
            <optgroup key={group} label={group}>
              {actions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {usesMove && (
          <select aria-label="Move" value={move} onChange={(e) => setMove(e.target.value as MoveSlot)}>
            {MOVES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
        {action === "jump" && (
          <label><input type="checkbox" checked={jumpsUsed >= 2} onChange={(e) => setJumpsUsed(e.target.checked ? 2 : 1)} /> second jump</label>
        )}
        {action === "fall" && (
          <label><input type="checkbox" checked={fastFalling} onChange={(e) => setFastFalling(e.target.checked)} /> fast fall</label>
        )}
        <button onClick={() => setPlaying((p) => !p)}>{playing ? "pause" : "play"}</button>
        <input
          aria-label="Frame"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={Math.min(frame, total - 1)}
          onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
        />
        <span style={{ color: "#7C8896" }}>frame {Math.min(frame, total - 1)}</span>
      </div>

      <Lab3D options={o} total={total} frame={Math.min(frame, total - 1)} />
      <p style={{ color: "#4E5866", fontSize: 12, marginTop: 18 }}>
        {FIGHTER_IDS.length} fighters share every clip. See src/render/poses/.
      </p>
    </main>
  );
}
