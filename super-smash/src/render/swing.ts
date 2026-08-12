/**
 * The swoosh: the bright arc an attack leaves behind it.
 *
 * ## Why this file exists
 *
 * A fighter's limbs are a few pixels thick and a swing lasts three frames. Play
 * testing turned up the consequence: with the poses alone, a forward smash and
 * standing still are the same picture. Every fighting game solves this the same
 * way and has since the arcade era — the *weapon trail* does the reading, not
 * the limb. It says three things at once that a pose cannot:
 *
 *   - **direction**, which is the whole grammar of the game. Up-smash and
 *     down-smash are different moves and have to look different from across the
 *     room.
 *   - **reach**, which is the question a player asks a hundred times a match.
 *   - **when**, because the arc is on screen for the active frames and gone
 *     afterwards, so a whiff looks like a whiff.
 *
 * ## Where the geometry comes from
 *
 * Nothing here is authored. The arc is derived from the move's own hitboxes —
 * the same numbers the simulation hits with — so a swoosh can never promise
 * reach a move does not have, and a change to a fighter's frame data moves the
 * graphic with it. That is the point: an authored arc is a second source of
 * truth about where a move reaches, and the two would drift apart within a week.
 *
 * The pivot is the fighter's shoulder height, the radius is the distance from
 * there to the furthest live hitbox, and the sweep is centred on the direction
 * of that hitbox. The band is then *swept* across the active window rather than
 * appearing whole, with the trailing edge lagging the leading one, which is
 * what makes it read as a moving blade rather than a painted crescent.
 */

import type { FighterDef, FighterState, Hitbox, MoveSlot } from "@/engine/types";
import { toFloat } from "@/engine/fixed";
import { moveFrameOf } from "@/engine/hitbox";
import { worldToScreen, type Camera } from "./camera";

/** Frames the arc lingers after its hitbox has gone. */
export const SWING_TAIL_FRAMES = 5;

/** How much of the sweep the trailing edge is behind the leading one, 0..1. */
const TRAIL_LAG = 0.42;

/** Half-width of the sweep, radians. A swing covers about 100°. */
const HALF_SWEEP = 0.9;

/**
 * A swing's colours, keyed by the hit effect the move carries.
 *
 * Pulled from the effect rather than from the fighter's palette on purpose: a
 * player needs to read "that was electric" off a Pikachu and off a Samus alike,
 * and hit effects are already the game's own vocabulary for it.
 */
const EFFECT_COLOURS: Readonly<Record<string, readonly [string, string]>> = {
  normal: ["#FFFFFF", "#BFD4FF"],
  slash: ["#FFFFFF", "#7FE9FF"],
  stab: ["#FFFFFF", "#9FF0E4"],
  fire: ["#FFF3C4", "#FF7A1A"],
  electric: ["#FFFFFF", "#FFE24A"],
  darkness: ["#E8D6FF", "#7A3BD6"],
  aura: ["#DCEBFF", "#3D8BFF"],
  freeze: ["#FFFFFF", "#8FE6FF"],
  bury: ["#FFE9C9", "#B4703A"],
  paralyze: ["#FFFFFF", "#C9A6FF"],
};

export interface SwingArc {
  /** Pivot, in world units. */
  readonly pivotX: number;
  readonly pivotY: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** World angles — y-up, counter-clockwise. `drawSwingArc` flips them. */
  readonly fromAngle: number;
  readonly toAngle: number;
  /** 0..1, fades to nothing as the swing ends. */
  readonly alpha: number;
  readonly bright: string;
  readonly deep: string;
  /** The tip of the leading edge, where the spark goes. */
  readonly tipX: number;
  readonly tipY: number;
}

/**
 * The hitbox window that `frame` is inside, or the one it has most recently
 * left.
 *
 * Per window rather than per move, because a multi-hit — Link's spin attack,
 * a rapid jab — is several swings and drawing one arc across all of them would
 * claim the blade was out for the whole move.
 */
function windowFor(
  hitboxes: readonly Hitbox[],
  frame: number,
): { start: number; end: number; boxes: Hitbox[] } | null {
  let best: { start: number; end: number } | null = null;
  for (const hb of hitboxes) {
    if (hb.grabbing) continue;
    // Inside this window, or within the tail after it.
    if (frame < hb.startFrame || frame > hb.endFrame + SWING_TAIL_FRAMES) continue;
    if (best === null || hb.startFrame > best.start) best = { start: hb.startFrame, end: hb.endFrame };
  }
  if (best === null) return null;
  const boxes = hitboxes.filter(
    (hb) => !hb.grabbing && hb.startFrame <= best.end && hb.endFrame >= best.start,
  );
  return boxes.length > 0 ? { ...best, boxes } : null;
}

/**
 * The arc to draw for a fighter this frame, or null when there is nothing to
 * draw — which is most frames, and includes every projectile move, since a
 * charge shot's graphic is the shot.
 */
export function swingArcFor(
  def: FighterDef | null | undefined,
  f: Pick<FighterState, "action" | "actionFrame" | "move" | "x" | "y" | "facing">,
  height: number,
): SwingArc | null {
  if (f.action !== "attack" && f.action !== "special") return null;
  const move = def?.moves[f.move as MoveSlot];
  if (!move || move.hitboxes.length === 0) return null;

  // Hitbox windows are quoted in move frames, not action frames.
  const frame = moveFrameOf(f.actionFrame);
  const window = windowFor(move.hitboxes, frame);
  if (!window) return null;

  // The furthest live hitbox sets both reach and direction: it is the part of
  // the move a player has to respect, and the part they can see coming.
  const pivotX = toFloat(f.x);
  const pivotY = toFloat(f.y) + height * 0.55;

  let far: Hitbox | null = null;
  let farDist = -1;
  let damage = 0;
  for (const hb of window.boxes) {
    const dx = toFloat(hb.x);
    const dy = toFloat(hb.y) - height * 0.55;
    const d = Math.hypot(dx, dy) + toFloat(hb.radius);
    damage = Math.max(damage, toFloat(hb.damage));
    if (d > farDist) {
      farDist = d;
      far = hb;
    }
  }
  if (!far || farDist <= 0) return null;

  const dx = toFloat(far.x) * (f.facing >= 0 ? 1 : -1);
  const dy = toFloat(far.y) - height * 0.55;
  const direction = Math.atan2(dy, dx);

  const span = window.end - window.start + 1;
  const progress = (frame - window.start + 1) / (span + SWING_TAIL_FRAMES);
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;

  // Which way the swing travels.
  //
  // A forward or downward attack is an overhand: it starts above the target
  // line and finishes below it. An attack aimed above the shoulder is the
  // opposite — it starts in front and carries over the head to the back, the
  // way an up-smash does. Both are mirrored by facing, because "counterclockwise"
  // is upward in front of a fighter facing right and downward in front of one
  // facing left; without the mirror every attack swings the wrong way round
  // exactly half the time, which is the sort of thing nobody can name but
  // everybody feels.
  const rising = dy > height * 0.12;
  const sweepSign = (rising ? -1 : 1) * (f.facing >= 0 ? 1 : -1);
  const from = direction + HALF_SWEEP * sweepSign;
  const to = direction - HALF_SWEEP * sweepSign;

  const lead = Math.min(1, p / (1 - TRAIL_LAG));
  const trail = Math.max(0, (p - TRAIL_LAG) / (1 - TRAIL_LAG));
  const leadAngle = from + (to - from) * lead;
  const trailAngle = from + (to - from) * trail;

  const outer = farDist;
  // Heavier moves get a fatter band. 18% damage is about a smash attack.
  // Capped well short of the pivot: a band that reaches the middle stops being
  // a blade trail and becomes a bubble around the fighter.
  const thickness = Math.min(0.42, 0.2 + damage / 70);
  const inner = outer * (1 - thickness);

  const [bright, deep] = EFFECT_COLOURS[far.effect ?? "normal"] ?? EFFECT_COLOURS.normal;

  return {
    pivotX,
    pivotY,
    innerRadius: inner,
    outerRadius: outer,
    fromAngle: trailAngle,
    toAngle: leadAngle,
    // Full strength for exactly as long as the hitbox is live, then out over
    // the tail. Tying the fade to the hitbox rather than to the sweep is what
    // makes the graphic answer "can this still hit me?" honestly.
    alpha: Math.max(0, Math.min(1, 1 - (frame - window.end) / SWING_TAIL_FRAMES)),
    bright,
    deep,
    tipX: pivotX + Math.cos(leadAngle) * outer,
    tipY: pivotY + Math.sin(leadAngle) * outer,
  };
}

/** Paint one arc. Call before the fighter, so the blade passes behind them. */
export function drawSwingArc(ctx: CanvasRenderingContext2D, arc: SwingArc, cam: Camera): void {
  if (arc.alpha <= 0.01) return;

  const centre = worldToScreen(cam, arc.pivotX, arc.pivotY);
  const outer = arc.outerRadius * cam.zoom;
  const inner = arc.innerRadius * cam.zoom;
  if (outer <= 1) return;

  // World angles are y-up; canvas angles are y-down. Negating both endpoints
  // reverses their order too, so the sweep direction has to follow.
  const start = -arc.fromAngle;
  const end = -arc.toAngle;
  const backwards = end < start;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Hot core, coloured edges: the band fades in from nothing at the inside,
  // takes the effect's colour, whitens where the blade actually is, and takes
  // the colour back at the outer edge. A ramp that ends white instead reads as
  // a generic glow, and Mario's fire smash looked the same as Marth's sword.
  const gradient = ctx.createRadialGradient(centre.x, centre.y, inner, centre.x, centre.y, outer);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.45, arc.deep);
  gradient.addColorStop(0.8, arc.bright);
  gradient.addColorStop(1, arc.deep);

  ctx.globalAlpha = arc.alpha * 0.7;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, outer, start, end, backwards);
  ctx.arc(centre.x, centre.y, inner, end, start, !backwards);
  ctx.closePath();
  ctx.fill();

  // The leading edge, bright and hard, so the eye catches the front of the
  // swing rather than the middle of the smear.
  ctx.globalAlpha = arc.alpha * 0.9;
  ctx.strokeStyle = arc.bright;
  ctx.lineWidth = Math.max(1.5, cam.zoom * 0.16);
  ctx.beginPath();
  ctx.moveTo(centre.x + Math.cos(end) * inner, centre.y + Math.sin(end) * inner);
  ctx.lineTo(centre.x + Math.cos(end) * outer, centre.y + Math.sin(end) * outer);
  ctx.stroke();

  const tip = worldToScreen(cam, arc.tipX, arc.tipY);
  const spark = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, cam.zoom * 0.9);
  spark.addColorStop(0, arc.bright);
  spark.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = arc.alpha;
  ctx.fillStyle = spark;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, cam.zoom * 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
