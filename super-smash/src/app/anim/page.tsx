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
 * Two views, and the difference matters:
 *
 * - **Contact sheet** draws one cell per *simulation frame* of the action, at
 *   its true length, sampled the way the renderer samples it. This is the view
 *   that tells the truth about timing: a four-frame landing gets four cells,
 *   and if three of them are the same drawing you can see that they are.
 * - **Playback** runs the same thing at 60Hz so the motion can be felt.
 *
 * Both go through `samplePoseForFighter`, so what shows here is what the match
 * shows, including the state-duration remapping in `poses/timing.ts`.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drawFigure, getCharacterRig, resolvePalette, squashFor } from "@/render/characterArt";
import { rigHeight } from "@/render/skeleton";
import {
  actionDurationFor,
  poseNameFor,
  poseSpinFor,
  poseTimeFor,
  samplePoseForFighter,
  type JumpAttributes,
} from "@/render/poses";
import { makeFighter, makeStage } from "@/render/testFixtures";
import { clipFor } from "@/render/chars";
import { drawMoveFx } from "@/render/specialFx";
import { createCamera } from "@/render/camera";
import { FIGHTER_IDS, getFighter } from "@/fighters";
import type { ActionState, FighterState, MoveSlot } from "@/engine/types";

/** Every action worth looking at, grouped the way an animator would think of them. */
const GROUPS: ReadonlyArray<readonly [string, readonly ActionState[]]> = [
  ["ground", ["stand", "walk", "dashStart", "run", "runBrake", "turnaround"]],
  ["crouch", ["crouchStart", "crouch", "crouchEnd"]],
  ["air", ["jumpSquat", "jump", "fall", "land", "landingLag"]],
  ["defence", ["shieldStart", "shield", "shieldRelease", "shieldBroken", "roll", "spotDodge", "airDodge"]],
  ["reeling", ["hitstun", "tumble", "downed", "getUp", "grabbed", "thrown"]],
  ["ledge", ["ledgeHang", "ledgeGetUp", "ledgeJump"]],
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
 * `moveFrames` is separate from `attrs` because an attack's length is not a
 * property of the *state* — `actionDurationFor` reads the state machine's own
 * constants and an attack has none, since it lasts exactly as long as the move
 * being thrown. Without it the lab quietly fell back to forty cells for every
 * attack, so a 79-frame down air was reviewed at just over half its length and
 * whatever happened after frame 40 was authored blind. The recovery of a slow
 * move is not a detail: it is most of what a stuffed attack looks like.
 */
function lengthOf(f: FighterState, attrs?: JumpAttributes, moveFrames?: number): number {
  const name = poseNameFor(f);
  const clip = clipFor(f.defId, name);
  if (!clip.loop) {
    return actionDurationFor(f, attrs) ?? (moveFrames && moveFrames > 0 ? moveFrames : OPEN_ENDED);
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

interface Options {
  readonly fighterId: string;
  readonly action: ActionState;
  readonly move: MoveSlot;
  readonly jumpsUsed: number;
  readonly fastFalling: boolean;
}

function fighterAt(o: Options, frame: number): FighterState {
  return makeFighter({
    defId: o.fighterId,
    action: o.action,
    actionFrame: frame,
    move: o.move,
    jumpsUsed: o.jumpsUsed,
    fastFalling: o.fastFalling,
    // A reel is as long as the hit that caused it; 24 is an average one.
    hitstun: o.action === "hitstun" ? Math.max(0, 24 - frame) : 0,
    charge: o.action === "landingLag" ? 16 : 0,
    grounded: o.action !== "jump" && o.action !== "fall" && o.action !== "airDodge",
    // Walk and run are paced by ground covered rather than by frames elapsed,
    // so a fighter standing still freezes mid-step. Give them their own speed
    // or the lab shows one motionless drawing for the cycles that move most.
    vx: speedFor(o),
  });
}

/** The fighter's own ground speed, for the clips that are paced by it. */
function speedFor(o: Options): number {
  const attrs = getFighter(o.fighterId)?.attributes;
  if (!attrs) return 0;
  if (o.action === "walk") return attrs.walkSpeed;
  if (o.action === "run" || o.action === "dashStart" || o.action === "runBrake") return attrs.runSpeed;
  return 0;
}

/** Draw one fighter, centred on its feet, exactly as the renderer would. */
function drawCell(
  ctx: CanvasRenderingContext2D,
  o: Options,
  frame: number,
  cx: number,
  groundY: number,
  zoom: number,
  alpha = 1,
): void {
  const f = fighterAt(o, frame);
  const def = getFighter(o.fighterId) ?? null;
  const rig = getCharacterRig(o.fighterId);
  const palette = resolvePalette(def, 0);
  const move = def?.moves?.[o.move];
  const timing = move
    ? {
        total: move.totalFrames,
        firstActive: move.hitboxes.length ? Math.min(...move.hitboxes.map((h) => h.startFrame)) - 1 : -1,
        lastActive: move.hitboxes.length ? Math.max(...move.hitboxes.map((h) => h.endFrame)) - 1 : -1,
      }
    : undefined;
  const usesMove = o.action === "attack" || o.action === "special" || o.action === "throw";
  const attrs = def?.attributes;
  const pose = samplePoseForFighter(f, frame, usesMove ? timing : undefined, attrs);
  const squash = squashFor(f);

  const transform = {
    x: cx + pose.offsetX * rig.scale * zoom,
    y: groundY - pose.offsetY * rig.scale * zoom,
    scale: zoom * rig.scale,
    scaleX: squash.scaleX * pose.scaleX,
    scaleY: squash.scaleY * pose.scaleY,
    facing: 1 as const,
    rotation: pose.rotation + poseSpinFor(f, frame, usesMove ? timing : undefined, attrs),
    pivot: rigHeight(rig.bones, rig.headRadius) * 0.45,
  };
  const params = { rig, palette, pose, transform, alpha } as const;

  // The move's own effect — the plasma, the rock, the electricity. Drawn here
  // and not only in a match because half of what makes a special look like
  // itself is painted rather than posed, and a lab that showed only the pose
  // would say Kirby's Stone and Samus's Charge Shot still look identical.
  const height = rigHeight(rig.bones, rig.headRadius) * rig.scale;
  const cam = { ...createCamera(makeStage()), zoom };
  const fx = def ? drawMoveFx(ctx, def, f, cam, height, cx, groundY) : { hideFigure: false };
  if (fx.hideFigure) return;

  drawFigure(ctx, { ...params, mode: "rim", rimWidth: Math.max(2, zoom * 0.5) });
  drawFigure(ctx, { ...params, mode: "body" });
}

export default function AnimLab() {
  const [fighterId, setFighterId] = useState("mario");
  const [action, setAction] = useState<ActionState>("land");
  const [move, setMove] = useState<MoveSlot>("fsmash");
  const [jumpsUsed, setJumpsUsed] = useState(1);
  const [fastFalling, setFastFalling] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [onion, setOnion] = useState(false);
  const sheet = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);

  const o = useMemo<Options>(
    () => ({ fighterId, action, move, jumpsUsed, fastFalling }),
    [fighterId, action, move, jumpsUsed, fastFalling],
  );
  const total = useMemo(() => {
    const def = getFighter(o.fighterId);
    const usesMove = o.action === "attack" || o.action === "special" || o.action === "throw";
    return lengthOf(
      fighterAt(o, 0),
      def?.attributes,
      usesMove ? def?.moves?.[o.move]?.totalFrames : undefined,
    );
  }, [o]);
  const poseName = useMemo(() => poseNameFor(fighterAt(o, 0)), [o]);

  // The contact sheet: one cell per simulation frame, at the action's real length.
  useEffect(() => {
    const c = sheet.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const n = Math.min(total, 48);
    const cell = 150;
    const rows = Math.ceil(n / 12);
    c.width = cell * Math.min(n, 12);
    c.height = (cell + 20) * rows;
    ctx.fillStyle = "#12151A";
    ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < n; i++) {
      const col = i % 12;
      const row = Math.floor(i / 12);
      const x = col * cell + cell / 2;
      const top = row * (cell + 20);
      const groundY = top + cell - 18;
      ctx.strokeStyle = "#2A3038";
      ctx.beginPath();
      ctx.moveTo(col * cell, groundY + 0.5);
      ctx.lineTo(col * cell + cell, groundY + 0.5);
      ctx.stroke();
      const f = Math.round((i * (total - 1)) / Math.max(1, n - 1));
      drawCell(ctx, o, f, x, groundY, 4.0);
      ctx.fillStyle = "#7C8896";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${f}`, x, top + cell + 13);
    }
  }, [o, total]);

  // Playback at 60Hz, with an optional onion skin of the previous four frames.
  useEffect(() => {
    const c = stage.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let last = 0;
    let f = frame;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (playing && now - last >= 1000 / 60) {
        last = now;
        f = (f + 1) % Math.max(1, total);
        setFrame(f);
      }
      const shown = playing ? f : frame;
      ctx.fillStyle = "#12151A";
      ctx.fillRect(0, 0, c.width, c.height);
      const groundY = c.height - 60;
      ctx.strokeStyle = "#2A3038";
      ctx.beginPath();
      ctx.moveTo(0, groundY + 0.5);
      ctx.lineTo(c.width, groundY + 0.5);
      ctx.stroke();
      if (onion) {
        for (let k = 4; k >= 1; k--) {
          const prev = shown - k;
          if (prev >= 0) drawCell(ctx, o, prev, c.width / 2, groundY, 9, 0.14 * (5 - k) * 0.5);
        }
      }
      drawCell(ctx, o, shown, c.width / 2, groundY, 9);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [o, total, playing, onion, frame]);

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
        <label><input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> onion skin</label>
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

      <canvas ref={stage} width={460} height={420} aria-label="Playback" style={{ borderRadius: 6, marginBottom: 18 }} />
      <div>
        <div style={{ color: "#7C8896", fontSize: 12, marginBottom: 6 }}>
          contact sheet — one cell per simulation frame
        </div>
        <canvas ref={sheet} aria-label="Contact sheet" style={{ borderRadius: 6, maxWidth: "100%" }} />
      </div>
      <p style={{ color: "#4E5866", fontSize: 12, marginTop: 18 }}>
        {FIGHTER_IDS.length} fighters share every clip. See src/render/poses/.
      </p>
    </main>
  );
}
