/**
 * marth: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 *
 * ## The tipper
 *
 * Everything Marth is rests on one fact: the point of Falchion does markedly
 * more than the rest of it. What is worth knowing — and what round one assumed
 * rather than checked — is how the real game *shows* that, because it is not
 * what you would guess. Ultimate draws the **same** `Slash` graphic for a tipper
 * and a sourspot; there is no separate tipper effect anywhere in the data. The
 * three things that actually differ are a permanent **bright motion trail
 * concentrated at the tip of the blade** (Lucina, tellingly, has an even trail
 * along her whole sword), a dedicated hit sound whose sample is literally named
 * "Marth Sword", and hitlag roughly **doubled** — 1.5× on a tippered smash
 * against 0.7× sourspotted, which is most of what "feels" like a tipper.
 *
 * This rebuild has no audio and does not control hitlag from here. So the trail
 * is reproduced (`paintEdge`) and the landed flash (`paintTip`) is an addition
 * standing in for the two channels that are missing. That is a deliberate
 * departure and it is the right one for a silent 2D game, but it should be
 * called what it is.
 *
 * `fighters/marth.ts` expresses the mechanic without a flag: two hitboxes on the
 * same frames, the tip placed further out and given the **lower `id`**, because
 * `bestHitbox` resolves overlaps by lowest id. Nothing else in the file says
 * "tipper".
 *
 * So the graphic uses the same rule the simulation does. `sweetspotOf` below
 * takes the live hitboxes on this frame, picks the lowest id — the one that
 * *would* win — and paints it only when some other live box sits closer to the
 * shoulder, i.e. only when there is genuinely a sweetspot to distinguish from a
 * sourspot. That makes the flash derived rather than authored: it cannot claim
 * a tipper on a move that has none, it moves if the frame data moves, and it
 * needs no per-move table.
 *
 * It falls out of that rule that the moves without a sweetspot paint nothing —
 * Dolphin Slash, whose two hitboxes never share a frame, and Counter, which has
 * one — and that Down Air flashes *below and behind* him on frame 11, because
 * on that one frame the lowest-id box is the meteor rather than the point. Both
 * are correct: they are what the engine would hit with.
 *
 * ## Live, landed, and beaten
 *
 * Round one could only ask whether the tip was **live**. `struckWith` now says
 * which box actually won the overlap, so the graphic distinguishes three states
 * rather than two — see `tipStrength`. The short version is that a bright point
 * on a sourspot hit is worse than no graphic at all, because it teaches the
 * player the opposite of the spacing the character is made of.
 */

import { toFloat } from "@/engine/fixed";
import type { Hitbox, MoveSlot } from "@/engine/types";
import {
  NOTHING,
  crescent,
  glow,
  type FxContext,
  type FxFn,
  type ProjectilePainter,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";

/** Frames the flash lingers after its hitbox has gone. */
const TIP_TAIL = 4;

/** The colour of the point. Cyan-white, and nothing else on him is this colour. */
const TIP_HOT = "#F2FDFF";
const TIP_COOL = "#5FD8FF";

/**
 * The hitbox that would win an overlap on this frame, if there is a sweetspot
 * to be had.
 *
 * Mirrors `bestHitbox` in `engine/hitbox.ts` — lowest id wins — and then asks
 * one further question the engine does not have to: is there another live box
 * *closer in*? Without that, every single-hitbox move would flash as though its
 * whole blade were a sweetspot, which is exactly the lie this graphic exists to
 * avoid telling.
 *
 * "Closer in" is measured from the shoulder rather than along x, because Up
 * Smash's tip is high rather than far — x = 1.5, y = 17 — and a horizontal test
 * would pick the scooping hitbox at his ankles instead.
 */
function sweetspotOf(boxes: readonly Hitbox[], shoulder: number): { tip: Hitbox; inner: Hitbox } | null {
  let best: Hitbox | null = null;
  for (const hb of boxes) {
    if (hb.grabbing) continue;
    if (best === null || hb.id < best.id) best = hb;
  }
  if (best === null) return null;
  const tip = best;
  const reach = (hb: Hitbox) => Math.hypot(toFloat(hb.x), toFloat(hb.y) - shoulder);
  const far = reach(tip);
  // The nearest-in box that is genuinely closer. It is both the test for "is
  // there a sweetspot at all" and, because it sits on the body of the blade, the
  // inner end of the segment the edge-light runs along.
  let inner: Hitbox | null = null;
  for (const hb of boxes) {
    if (hb.grabbing || hb.id === tip.id) continue;
    if (reach(hb) >= far - 0.5) continue;
    if (inner === null || reach(hb) > reach(inner)) inner = hb;
  }
  return inner === null ? null : { tip, inner };
}

/** Live hitboxes on `frame`, counted the way the frame data is. */
function liveOn(boxes: readonly Hitbox[], frame: number): Hitbox[] {
  return boxes.filter((hb) => frame >= hb.startFrame && frame <= hb.endFrame);
}

/**
 * The window `frame` is inside, or has just left, for a given sweetspot.
 *
 * Returned as a strength 0..1 so the flash is full while the hitbox is live and
 * fades over the tail — the same contract the swing arc uses, and for the same
 * reason: the graphic has to answer "can this still hit me?" honestly.
 */
function strengthFor(hb: Hitbox, frame: number): number {
  if (frame < hb.startFrame) return 0;
  if (frame <= hb.endFrame) return 1;
  const over = frame - hb.endFrame;
  return over > TIP_TAIL ? 0 : 1 - over / TIP_TAIL;
}

/**
 * How bright the point is on this frame, given what the swing has hit.
 *
 * Three states, not two, and getting that wrong is the whole character.
 *
 * `struckWith` is the id of the box the simulation resolved the overlap to,
 * which is the tipper mechanic itself rather than a proxy for it. Before it
 * existed the only honest signal was `f.hitlag > 0` — the attacker freezes on
 * any connection — so the flash bloomed identically whether Marth had landed
 * the point or the handle.
 *
 * That was fixed, and a second version of the same lie survived it: the marker
 * was still painted *at full brightness* on every frame the tip hitbox was
 * live, and the bloom on a real tipper was 1.45× of it. A fight capture at two
 * spacings settles what that looks like. Walking into Donkey Kong and swinging
 * deals 16.4 — the 13% body hit — and the picture is a hard cyan-white star
 * sitting on the point of the blade, which is the picture of a tipper. Standing
 * back and swinging deals 22.7, the 18% tip, and looks no different. A player
 * cannot learn spacing from a graphic that says the same thing both times.
 *
 * So:
 *
 * - **nothing connected yet** (`null`, and every frame before contact) — a dim
 *   gleam. The tip hitbox *is* live, and marking where it is is the honest
 *   affordance: this is the part of the blade that pays. Small and faint,
 *   because it is an invitation, not a result.
 * - **the tip won** — the full flash, twice the length and four times the
 *   alpha, plus a ring the dim state never draws. Different in *shape*, so it
 *   reads at a glance rather than needing the two side by side.
 * - **something else won** — nothing. The point did not do the work and must
 *   not claim it. This is the state that used to be indistinguishable from a
 *   tipper and is now the one that is unmistakably not one.
 *
 * `undefined` means no cosmetic state was supplied at all — the animation lab —
 * and only there is `hitlag` worth falling back to. `null` is the simulation
 * saying this swing has connected with nothing, which a shield hit also
 * produces: it freezes the attacker without a hit event, so falling back on
 * `hitlag` there bloomed a sourspot that had been shielded.
 */
function tipStrength(c: FxContext, hb: Hitbox): number {
  const hit = c.struckWith;
  if (hit === undefined) return c.f.hitlag > 0 ? 1 : 0.42;
  if (hit === hb.id) return 1;
  if (hit === null) return 0.42;
  return 0; // a different box won this swing — the point stays dark
}

/**
 * The bright edge on the outer blade.
 *
 * This is the part the real game actually has, and round one did not. SmashWiki
 * on Marth's tipper, verbatim: it "is indicated by a **bright motion trail at
 * the tip of his sword**", against Lucina, who has "an even motion trail across
 * her entire sword". So the tell is not a flash on a landed hit — it is a
 * permanent gradient on the swing itself, on every swing, saying *this* end of
 * the blade is the end that pays. On a landed hit Ultimate draws the same
 * `Slash` graphic for tip and body and separates them by sound (a sample
 * literally named "Marth Sword") and by hitlag, which is roughly doubled. This
 * rebuild has neither, which is exactly why the landed flash below is an
 * addition rather than a reproduction — and why this streak, which is not, has
 * to carry the everyday read.
 *
 * The segment is derived, not authored: the sourspot hitbox sits on the body of
 * the blade and the sweetspot on its outer end, so the line between them *is*
 * the outer blade, in whatever direction the move happens to be swinging. Three
 * glows along it, growing outward, is a gradient rather than three beads,
 * because `glow` is a radial falloff and they overlap.
 */
function paintEdge(c: FxContext, inner: Hitbox, tip: Hitbox, k: number): void {
  const { ctx, u, dir, x, y } = c;
  const ix = x + dir * toFloat(inner.x) * u;
  const iy = y - toFloat(inner.y) * u;
  const tx = x + dir * toFloat(tip.x) * u;
  const ty = y - toFloat(tip.y) * u;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 4; i++) {
    // Start a fifth of the way out rather than at the inner box: the crossover
    // in the real data is around 60% of the blade, and a streak that reaches the
    // guard is Lucina's.
    const along = 0.2 + (i / 3) * 1.05;
    const w = 0.55 + along * 0.7;
    glow(
      ctx,
      ix + (tx - ix) * along,
      iy + (ty - iy) * along,
      u * w,
      withAlpha(TIP_COOL, (0.1 + 0.13 * along) * k),
    );
  }
  ctx.restore();
}

/**
 * Paint the point of the blade.
 *
 * A four-point star rather than a blob: the long axis lies along the line from
 * the shoulder through the hitbox, which is the blade, so the flash reads as
 * *the end of the sword* and not as a light bulb hovering nearby. The cross
 * spike is a third of the length, which is what stops it reading as a lens
 * flare pasted on top.
 */
function paintTip(c: FxContext, hb: Hitbox, k: number, s: number): void {
  const { ctx, u, dir, x, y, height } = c;
  const px = x + dir * toFloat(hb.x) * u;
  const py = y - toFloat(hb.y) * u;
  const sx = x;
  // 0.68 rather than `swing.ts`'s 0.55. That pivot is a compromise across eight
  // rigs; this one only has to serve Marth, whose shoulder sits at 9.6 of the
  // 14.1 rig units between his feet and his crown. Getting it wrong does not
  // move the flash — it tilts the star off the line of the blade, which is the
  // one thing that makes it read as a sword's point rather than a firefly.
  const sy = y - height * 0.68 * u;
  const angle = Math.atan2(py - sy, px - sx);

  // Alpha falls faster than size, so the dim state is a gleam rather than a
  // small bright star. `s²` at s = 0.42 is a sixth of the brightness on a
  // shape 40% of the length, which is the difference between "the point is
  // here" and "the point landed".
  const a = k * s * s;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  glow(ctx, px, py, u * 2.6 * s, withAlpha(TIP_COOL, 0.5 * a));

  ctx.translate(px, py);
  ctx.rotate(angle);
  const long = u * 4.2 * s;
  const back = u * 1.6 * s;
  const cross = u * 1.3 * s;
  const waist = u * 0.36 * s;

  ctx.beginPath();
  ctx.moveTo(long, 0);
  ctx.lineTo(0, -waist);
  ctx.lineTo(-back, 0);
  ctx.lineTo(0, waist);
  ctx.closePath();
  ctx.fillStyle = withAlpha(TIP_HOT, 0.95 * a);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, -cross);
  ctx.lineTo(waist * 0.8, 0);
  ctx.lineTo(0, cross);
  ctx.lineTo(-waist * 0.8, 0);
  ctx.closePath();
  ctx.fillStyle = withAlpha(TIP_COOL, 0.9 * a);
  ctx.fill();

  // The rings, only on a landed tipper. A second *shape* rather than more of
  // the first one: two stars of different sizes are told apart by comparison,
  // and there is nothing to compare against in the third of a second a hit
  // lasts.
  //
  // They are sized to escape the opponent, not to fit the blade. A tipper's
  // hitbox is by definition *inside* somebody, `over` only lifts this above
  // Marth's own body, and the fighter it landed on is drawn afterwards — so a
  // ring that fits within the victim's silhouette is a ring nobody sees. Donkey
  // Kong is 3.2 world units of half-width and the outer ring is 5.2, which
  // clears the widest hurtbox on the roster. Cyan carries it: white-on-cream is
  // what the first version was, and against DK it vanished.
  if (s > 0.8) {
    ctx.rotate(-angle);
    ctx.lineWidth = u * 0.42;
    ctx.strokeStyle = withAlpha(TIP_HOT, 0.75 * k);
    ctx.beginPath();
    ctx.arc(0, 0, u * 3.0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = u * 0.26;
    ctx.strokeStyle = withAlpha(TIP_COOL, 0.7 * k);
    ctx.beginPath();
    ctx.arc(0, 0, u * 5.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * The tipper flash, for any move that has a sweetspot.
 *
 * One function on every slot rather than a hand-written effect per move: the
 * geometry all comes from the move's own hitboxes, so a per-move version would
 * be fourteen copies of the same six lines with fourteen chances to mistype a
 * coordinate.
 */
const tipper: FxFn = (c) => {
  const move = c.f.move ? c.def.moves[c.f.move] : undefined;
  if (!move) return NOTHING;

  // A charging smash is parked on its own first live frame, and its hitbox is
  // not live at all.
  //
  // `states.ts` holds a chargeable move at `startFrame − 1` while the button is
  // down, so `c.frame` reads as the first live frame for as long as the charge
  // lasts — up to sixty frames. A capture of a held Shield Breaker showed the
  // result: a fixed cyan sheen sitting on the point for a full second next to a
  // charge glow that was supposed to be the only thing growing, and telling the
  // opponent the tip could hit them when the engine had frozen the clock.
  //
  // There is no field that says "pinned", so the test is the pin's own
  // signature: a chargeable move, a charge in progress, and the clock sitting
  // exactly on the first live frame. It costs the flash on the genuine first
  // active frame of a *released* charged smash, one frame of a four-frame
  // window, because on that frame the two states are not distinguishable from
  // here. That is the cheaper of the two errors.
  const live = move.hitboxes.filter((hb) => !hb.grabbing);
  if (live.length === 0) return NOTHING;
  const opens = Math.min(...live.map((hb) => hb.startFrame));
  if (move.chargeable && c.f.charge > 0 && c.frame === opens) return NOTHING;

  const shoulder = c.height * 0.55;
  // Every window, not only the live one: Down Smash's back hit and Neutral Air's
  // second swing are separate sweetspots fifteen frames apart, and a flash that
  // only knew about the first would say the blade was cold for the second.
  for (const hb of move.hitboxes) {
    const k = strengthFor(hb, c.frame);
    if (k <= 0) continue;
    // Re-derive the winner from the frame this box *started* on, so a box still
    // in its tail is judged against the company it actually kept.
    const at = Math.min(c.frame, hb.endFrame);
    const pair = sweetspotOf(liveOn(move.hitboxes, at), shoulder);
    if (pair === null || pair.tip !== hb) continue;
    const s = tipStrength(c, hb);
    if (s <= 0) continue;
    const { inner } = pair;
    // `over`, not under. The point of the blade is not always out in clear air:
    // Down Air's meteor sits below and *behind* his own legs, Up Air's and Up
    // Smash's tips are inside the head-and-shoulders region, and Neutral Air's
    // second sweetspot is behind his back. Painted under the figure those are a
    // flash the fighter is standing on top of.
    c.over(() => {
      paintEdge(c, inner, hb, k);
      paintTip(c, hb, k, s);
    });
  }
  return NOTHING;
};

/**
 * Shield Breaker's charge.
 *
 * The move's whole point is shield damage, and the thing a player has to read is
 * *how long it has been held* — 25 shield damage at frame 19, 50 at frame 79.
 * So the graphic grows with the charge instead of pulsing on its own clock, and
 * it lives on the blade rather than round the body.
 *
 * ## Two corrections this round
 *
 * **Where.** The line below is measured off the clip's charge pose, and that
 * pose moved: the chamber used to be a lean-back with the blade level at the
 * ribs and is now a forward crouch with the hilt beside the chest and the blade
 * running forward and slightly *above* horizontal. The old coordinates left the
 * glow two world units under the blade — a row of faint dots floating in front
 * of his belt, which is what a match capture showed. The charge freezes the clip
 * at `strike × 0.55 = 0.165`, and `ease: "in"` makes that 17% of the way to the
 * lunge, so the endpoints here are the chamber's own hilt and point nudged that
 * far along.
 *
 * **What colour.** Blue-white was a guess. The in-game charge sheathes the blade
 * in a **violet/magenta** glow streaming pink-white sparks off it, and the
 * release flashes a gold-white lance along the thrust. Violet also does
 * something useful beyond accuracy: nothing else on Marth is violet, where
 * blue-white sat on top of a blue fighter carrying a white sword.
 */
const shieldBreakerCharge: FxFn = (c) => {
  const { ctx, u, dir, x, y, frame, f } = c;
  if (f.charge <= 0 && frame > 18) return NOTHING;
  const held = Math.min(1, (f.charge > 0 ? f.charge : frame) / 60);
  const k = 0.25 + held * 0.75;
  // In front of him, not behind. This is light *on the blade*, and the blade at
  // the charge pose is chambered across his own chest — under the figure, the
  // inner third of it was painted into him and only the outer part showed, which
  // made a charge that grows from the hilt outward look like one that starts a
  // third of the way along.
  c.over(() => {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const along = i / 5;
      // Hilt (1.4, 9.4) to point (7.5, 10.4), in world units, off the clip.
      const px = x + dir * u * (1.4 + along * 6.1);
      const py = y - u * (9.4 + along * 1.0);
      glow(ctx, px, py, u * (0.55 + k * 0.8), withAlpha("#C77BFF", 0.13 + k * 0.26));
      // The sparks are pink-white and they gather at the point, which is the end
      // that is about to arrive.
      if (along > 0.55) glow(ctx, px, py, u * (0.22 + k * 0.36), withAlpha("#FFE2F6", 0.16 + k * 0.4));
    }
    ctx.restore();
  });
  return NOTHING;
};

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  jab1: tipper,
  jab2: tipper,
  ftilt: tipper,
  utilt: tipper,
  dtilt: tipper,
  dashAttack: tipper,
  fsmash: tipper,
  usmash: tipper,
  dsmash: tipper,
  nair: tipper,
  fair: tipper,
  bair: tipper,
  uair: tipper,
  dair: tipper,
  sideB: tipper,

  neutralB: (c) => {
    shieldBreakerCharge(c);
    return tipper(c) ?? NOTHING;
  },

  /**
   * Marth, Counter. Three beats, and none of them is a lamp on his chest.
   *
   * The colours are the reference's rather than invented. Ultimate's counter
   * trigger is a **violet/purple starburst** over the body, and the returned
   * slash draws a broad **cyan-white crescent** ending in a cyan shockwave ring.
   * Round one had a gold ward and a white cut, which were plausible and were
   * nobody's.
   *
   *   frames 4-8    the gleam of the blade arriving into the guard, run along
   *                 the blade itself. The stance forms on frame 4, which is the
   *                 clip's strike key.
   *   frames 6-27   the documented counter window: a dim violet edge on the
   *                 blade, pulsing slowly. Faint on purpose — a counter that
   *                 announced itself would be telling the opponent what the move
   *                 is for — and violet because that is the colour the trigger
   *                 will be, so the two read as one move.
   *   frames 33-44  the riposte: the starburst first, then the crescent sweeping
   *                 214° → 100° (down behind, under, out forward) with the
   *                 trailing edge two frames behind the leading one, then the
   *                 ring. No hitbox lives there, so `swing.ts` draws nothing of
   *                 its own and this is the whole graphic of the cut.
   *
   * The blade's rig-unit endpoints below are measured off the clip's own guard
   * key rather than guessed, which is why they moved this round: the guard used
   * to point down and *forward* and now rakes down and back.
   */
  downB: (c) => {
    const { ctx, x, y, u, dir, frame } = c;
    if (frame < 4 || (frame > 27 && frame < 33) || frame > 44) return NOTHING;

    // Rig units to world units — `scale` in `rig.ts`. The pose library is
    // authored in rig units and `u` is pixels per *world* unit, so every length
    // below is a measurement taken off the clip's own keys.
    const s = u * 1.16;
    const px = (rx: number) => x + dir * rx * s;
    const py = (ry: number) => y - ry * s;

    // Falchion in the guard pose, hilt to point, in rig units.
    const HILT_X = -0.09;
    const HILT_Y = 5.09;
    const TIP_X = -2.67;
    const TIP_Y = 0.52;
    /** Light run along the blade — four overlapping falloffs, not four beads. */
    const alongBlade = (colour: string, a: number, w: number) => {
      for (let i = 0; i < 4; i++) {
        const k = i / 3;
        glow(
          ctx,
          px(HILT_X + (TIP_X - HILT_X) * k),
          py(HILT_Y + (TIP_Y - HILT_Y) * k),
          w * s * (0.55 + 0.5 * k),
          withAlpha(colour, a),
        );
      }
    };

    // Canvas angle of a rig-space bone angle (degrees, 0 = up, clockwise
    // positive facing right). Facing is a multiply on the forward component,
    // which is the same rule `resolve` mirrors the rig under — never a branch.
    // Every angle asked for lies in 100°..214°, which maps into the lower
    // half-plane in both facings, so the wedge never straddles ±π and min/max
    // is enough to pick the short way round.
    const ang = (a: number) => {
      const r = (a * Math.PI) / 180;
      return Math.atan2(-Math.cos(r), dir * Math.sin(r));
    };
    const band = (cx: number, cy: number, r: number, w: number, a: number, b: number, fill: string) => {
      crescent(ctx, cx, cy, r * s, w * s, Math.min(a, b), Math.max(a, b));
      ctx.fillStyle = fill;
      ctx.fill();
    };

    // The two cuts go **over** the figure: both are the blade travelling
    // through the space his body occupies, and under it the frame-4 gleam lost
    // its inner half to his chest — the half nearest the hilt, and therefore the
    // half that says which way the blade is pointing. The held ward is split
    // across both layers; see below.
    if (frame <= 8) {
      const k = 1 - (frame - 4) / 5;
      const a = k * k;
      c.over(() => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        alongBlade("#FFFFFF", 0.4 * a, 0.85);
        alongBlade("#BFE9FF", 0.3 * a, 1.5);
        // The point, not the body: this is the bit that says "sword".
        glow(ctx, px(TIP_X), py(TIP_Y), 1.7 * s * (0.6 + 0.7 * k), withAlpha("#FFFFFF", 0.8 * a));
        ctx.restore();
      });
    }

    if (frame >= 6 && frame <= 27) {
      const hold = Math.min(1, (frame - 5) / 3, (28 - frame) / 4);
      const pulse = 0.74 + 0.26 * Math.cos((frame - 6) * 0.42);
      // Split across the two layers, and each half is where it has to be.
      //
      // Three captures went into this. At 0.16 alpha and a blade-width radius
      // it could not be seen at all; `lighter` over an already near-white blade
      // adds nothing at the centre, so all of the violet was landing where it
      // could not show. The **halo** is the part that reads, and it reads
      // because it is wide enough to fall on the dark to each side of the blade
      // — that is under the figure, which is also where `specialFx.test.ts`
      // expects this move to paint. The small pale **core** has to go over,
      // because its whole job is to sit on top of Falchion.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      alongBlade("#8A4FD8", 0.62 * hold * pulse, 2.4);
      ctx.restore();
      c.over(() => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        alongBlade("#E4C8FF", 0.22 * hold * pulse, 0.8);
        ctx.restore();
      });
    }

    if (frame >= 33) {
      const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
      const lead = clamp((frame - 32.5) / 4.5);
      const trail = clamp((frame - 34.5) / 4.5);
      const fade = Math.min(1, (45 - frame) / 6);
      const burst = clamp((36 - frame) / 3);
      c.over(() => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // The trigger: a violet starburst over the body, brief and first.
        if (burst > 0) {
          glow(ctx, px(0.6), py(8.0), 4.6 * s * (0.5 + 0.6 * burst), withAlpha("#B77BFF", 0.45 * burst));
          glow(ctx, px(0.6), py(8.0), 2.2 * s, withAlpha("#F0E0FF", 0.5 * burst));
        }
        // …then the cut: 214° → 100°, the point dropping behind, passing under
        // and coming out forward, following the clip's own load-to-extension arc.
        const cx = px(-0.9 + 2.8 * lead);
        const cy = py(8.8);
        const a1 = ang(214 - 114 * lead);
        const a2 = ang(214 - 114 * trail);
        band(cx, cy, 7.8, 3.4, a1, a2, withAlpha("#FFFFFF", 0.52 * fade));
        band(cx, cy, 9.3, 1.6, a1, a2, withAlpha("#7FE9FF", 0.5 * fade));
        // The shockwave, once the sweep has arrived.
        if (lead >= 1) {
          const ring = clamp((frame - 37) / 6);
          ctx.lineWidth = u * 0.3;
          ctx.strokeStyle = withAlpha("#7FE9FF", 0.42 * (1 - ring));
          ctx.beginPath();
          ctx.arc(px(6.6), py(6.4), u * (1.4 + 5.2 * ring), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {};
