/**
 * Mario: the clips that are Mario’s rather than everybody’s.
 *
 * The shared library in `render/poses/` has one `fsmash` and one `neutralB`
 * for the whole roster, which is the right default — fifty clips across eight
 * rigs instead of four hundred hand-authored ones — and the wrong answer for
 * any move whose *shape* is the character. Whatever is named here wins over the
 * shared clip for this fighter alone; whatever is not named falls through
 * unchanged, so this file only ever holds the moves that earn their place.
 *
 * ── reading the angles ─────────────────────────────────────────────────────
 *
 * Everything is parent-relative and accumulates down the chain, which is the
 * one thing that makes these numbers hard to read, so the comments quote the
 * **accumulated** angle wherever it matters. 0° is up, 90° forward, 180° down,
 * 270° back. `footR` rests at −88° exactly like `footL` — the legs are not
 * individually mirrored, the whole rig is, once, at draw time.
 *
 * ── where the keys go ──────────────────────────────────────────────────────
 *
 * `strike` puts one key on the frame the hitbox goes live and `poseTimeFor`
 * stretches the wind-up and the recovery independently to make that true. What
 * it does *not* do is keep the fighter there, and `ease: "out"` is a cubic —
 * two frames past the strike key a clip is already a third of the way to the
 * next one. A hitbox that is live for five frames therefore gets one frame of
 * full extension and four of a fighter visibly putting the move away, which is
 * the difference between an attack you can see coming out and one that
 * flickers. So every clip below carries a second key at the *end* of its active
 * window, holding the extension, before anything recovers:
 *
 *   t(f) = strike + (1 − strike) × (f − firstActive) / (total − firstActive)
 *
 * The other half of the same problem is the tail. Mario's forward air is 59
 * frames and connects on 16; the remaining 43 frames are more than two thirds
 * of everything anyone ever sees of the move, and a single span from the
 * follow-through to a terminator at t = 1 crosses them at well under a degree
 * a frame, which reads as a freeze. Each clip gets two recovery keys.
 */

import { P, type PoseClip } from "../../poses/clip";
import type { PoseName } from "../../poses/library";

/**
 * Forward smash: the fire palm.
 *
 * The shared clip is a straight punch, and a punch is the one thing this is
 * not — the damage comes off an *open palm* thrust from the hip with a blast
 * of fire on it, which is why the far hitbox is a radius-5 sphere centred 8.6
 * units in front of him and the near one, the forearm, is the weaker half. So
 * the hand opens, the arm extends level at chest height, and the body drives
 * through behind it.
 *
 * The key at t = 0.165 is not decoration. `poseTimeFor` parks a charging smash
 * at `strike * 0.55`, and without a key there the charge holds a blend of the
 * wind-up and the extension — a man with his arm halfway out, which reads as
 * an attack that has already been thrown.
 */
const fsmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -20, head: 14, hip: 6,
        thighR: 158, shinR: 34, footR: -86,
        thighL: 206, shinL: 28, footL: -78,
        upperArmR: 226, forearmR: 58,
        upperArmL: 130, forearmL: -50,
      }),
      offsetX: -0.4,
      offsetY: -0.55,
      ease: "in",
    },
    // The charge, at strike × 0.55. Coiled over the rear foot, palm cocked
    // behind the hip, shoulders turned away, off hand up in guard.
    {
      t: 0.165,
      pose: P({
        torso: -32, head: 22, hip: 10,
        thighR: 146, shinR: 62, footR: -84,
        thighL: 212, shinL: 40, footL: -72,
        upperArmR: 246, forearmR: 72, handR: -18,
        upperArmL: 116, forearmL: -66,
      }),
      offsetX: -0.75,
      offsetY: -1.05,
      ease: "in",
    },
    // Contact, frame 15. Arm accumulated 24 + 66 = 90: dead level, straight
    // out from the shoulder at chest height, which is where the fire is.
    {
      t: 0.3,
      pose: P({
        torso: 24, head: -16, hip: -6,
        thighR: 128, shinR: 26, footR: -92,
        thighL: 228, shinL: 34, footL: -70,
        upperArmR: 66, forearmR: 0, handR: 0,
        upperArmL: 238, forearmL: -54,
      }),
      offsetX: 1.15,
      offsetY: -0.7,
      scaleX: 1.16,
      ease: "hold",
    },
    // Frame 17, the last live frame. Held: the palm has not moved, the weight
    // has finished arriving behind it.
    {
      t: 0.342,
      pose: P({
        torso: 22, head: -14, hip: -6,
        thighR: 128, shinR: 26, footR: -92,
        thighL: 228, shinL: 34, footL: -70,
        upperArmR: 68, forearmR: 2, handR: 0,
        upperArmL: 236, forearmL: -52,
      }),
      offsetX: 1.2,
      offsetY: -0.7,
      scaleX: 1.14,
      ease: "out",
    },
    // The palm stays out while the body unwinds first, which is both what a
    // shove does and what tells the opponent it is over.
    {
      t: 0.48,
      pose: P({
        torso: 12, head: -6, hip: -2,
        thighR: 140, shinR: 28, footR: -90,
        thighL: 214, shinL: 30, footL: -74,
        upperArmR: 84, forearmR: 10,
        upperArmL: 216, forearmL: -44,
      }),
      offsetX: 0.72,
      offsetY: -0.5,
    },
    {
      t: 0.68,
      pose: P({
        torso: 8, head: -2,
        thighR: 146, shinR: 26, footR: -88,
        thighL: 208, shinL: 26, footL: -78,
        upperArmR: 106, forearmR: -8,
        upperArmL: 206, forearmL: -40,
      }),
      offsetX: 0.4,
      offsetY: -0.35,
    },
    {
      t: 0.88,
      pose: P({ torso: 6, upperArmR: 124, forearmR: -24, upperArmL: 200, forearmL: -36 }),
      offsetX: 0.16,
      offsetY: -0.2,
    },
    { t: 1, pose: P({ torso: 4, upperArmR: 132, forearmR: -30, upperArmL: 198, forearmL: -34 }) },
  ],
};

/**
 * Up smash: the headbutt.
 *
 * Not a two-handed lift, which is what the shared clip is. Mario ducks and
 * then whips the crown of his head up through an arc, arms thrown down and
 * back as the counterweight — hence a hitbox at y 10.3, just above the head,
 * and only 2.5 units in front of him.
 */
const usmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 32, head: 12, hip: -8,
        thighR: 128, shinR: 106, footR: -78,
        thighL: 134, shinL: 104, footL: -76,
        upperArmR: 232, forearmR: 52,
        upperArmL: 240, forearmL: -48,
      }),
      offsetY: -1.55,
      ease: "in",
    },
    // Contact, frame 9. Torso arched back 18° with the head 22° forward of
    // it, so the crown leads, pointing up and a little in front — the hitbox.
    // On the toes, arms flung back and down.
    {
      t: 0.3,
      pose: P({
        torso: -18, head: 22, hip: 6,
        thighR: 174, shinR: 6, footR: -66,
        thighL: 188, shinL: 6, footL: -68,
        upperArmR: 218, forearmR: 30,
        upperArmL: 226, forearmL: -28,
      }),
      offsetY: 0.85,
      scaleY: 1.2,
      scaleX: 0.88,
      ease: "hold",
    },
    // Frame 12, the last live frame — still fully extended.
    {
      t: 0.368,
      pose: P({
        torso: -16, head: 20, hip: 6,
        thighR: 172, shinR: 8, footR: -68,
        thighL: 190, shinL: 8, footL: -70,
        upperArmR: 214, forearmR: 28,
        upperArmL: 222, forearmL: -26,
      }),
      offsetY: 0.8,
      scaleY: 1.18,
      scaleX: 0.89,
      ease: "out",
    },
    {
      t: 0.5,
      pose: P({
        torso: -2, head: 8,
        thighR: 162, shinR: 20, footR: -80,
        thighL: 198, shinL: 18, footL: -80,
        upperArmR: 192, forearmR: 8,
        upperArmL: 202, forearmL: -6,
      }),
      offsetY: 0.16,
      scaleY: 1.05,
    },
    {
      t: 0.72,
      pose: P({
        torso: 8, head: -4,
        thighR: 152, shinR: 30, footR: -84,
        upperArmR: 156, forearmR: -14,
        upperArmL: 206, forearmL: -12,
      }),
      offsetY: -0.25,
    },
    { t: 0.9, pose: P({ torso: 5, upperArmR: 136, forearmR: -28, upperArmL: 210, forearmL: -26 }) },
    { t: 1, pose: P({ torso: 4, upperArmR: 132, forearmR: -32, upperArmL: 212, forearmL: -28 }) },
  ],
};

/**
 * Down smash: the breakdance sweep.
 *
 * Two contacts, nine frames apart, on opposite sides — front on frame 5, back
 * on frame 14, and the back one hits harder. That timing *is* the animation:
 * he drops onto his hands, scythes the near leg out in front, then pivots over
 * the planted hands and brings it round behind. Frame 14 lands at
 * t = 0.18 + 0.82 × (13 − 4) / (43 − 4) ≈ 0.37, so the back sweep gets a key
 * of its own there and a held one just after it.
 *
 * `offsetY: −2.6` is what puts the hands on the floor rather than in the air.
 * The pelvis sits at a fixed 3.6 units up the `root` strut whatever the legs
 * do, so folding them does not lower him an inch; only `offsetY` does, and the
 * arms are 4.35 units long against a 7.7-unit shoulder height. Under −2.4 he
 * is a man crouching and gesturing at the ground.
 */
const dsmash: PoseClip = {
  loop: false,
  strike: 0.18,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 26, head: -18,
        thighR: 132, shinR: 96, footR: -78,
        thighL: 138, shinL: 92, footL: -76,
        upperArmR: 146, forearmR: -18,
        upperArmL: 152, forearmL: -16,
      }),
      offsetY: -1.25,
      ease: "in",
    },
    // Front sweep, frame 5. Torso back 26° so the planted hands end up behind
    // him; right leg accumulated 100 at the hip and 92 at the knee — straight
    // out in front, skimming the floor.
    {
      t: 0.18,
      pose: P({
        torso: -26, head: 22,
        thighR: 100, shinR: -8, footR: -22,
        thighL: 150, shinL: -80, footL: 40,
        upperArmR: 206, forearmR: -6,
        upperArmL: 210, forearmL: -8,
      }),
      offsetY: -2.6,
      offsetX: -0.3,
      ease: "hold",
    },
    {
      t: 0.201,
      pose: P({
        torso: -26, head: 22,
        thighR: 100, shinR: -8, footR: -22,
        thighL: 150, shinL: -80, footL: 40,
        upperArmR: 206, forearmR: -6,
        upperArmL: 210, forearmL: -8,
      }),
      offsetY: -2.6,
      offsetX: -0.3,
      ease: "in",
    },
    // Over the top of the pivot: knees in, weight passing across the hands.
    {
      t: 0.29,
      pose: P({
        torso: 4, head: -2,
        thighR: 140, shinR: -46, footR: 10,
        thighL: 176, shinL: -60, footL: 4,
        upperArmR: 178, forearmR: -10,
        upperArmL: 182, forearmL: -12,
      }),
      offsetY: -2.75,
      ease: "in",
    },
    // Back sweep, frame 14, the harder half. Torso forward 30° so the hands
    // are now in front; right leg accumulated 258 / 266 — straight out behind.
    {
      t: 0.37,
      pose: P({
        torso: 30, head: -24,
        thighR: 258, shinR: 8, footR: 24,
        thighL: 200, shinL: -145, footL: 35,
        upperArmR: 150, forearmR: -6,
        upperArmL: 154, forearmL: -8,
      }),
      offsetY: -2.6,
      offsetX: 0.3,
      ease: "hold",
    },
    {
      t: 0.392,
      pose: P({
        torso: 30, head: -24,
        thighR: 258, shinR: 8, footR: 24,
        thighL: 200, shinL: -145, footL: 35,
        upperArmR: 150, forearmR: -6,
        upperArmL: 154, forearmL: -8,
      }),
      offsetY: -2.6,
      offsetX: 0.3,
      ease: "out",
    },
    // Back onto the feet.
    {
      t: 0.55,
      pose: P({
        torso: 24, head: -18,
        thighR: 134, shinR: 96, footR: -78,
        thighL: 142, shinL: 90, footL: -76,
        upperArmR: 158, forearmR: -20,
        upperArmL: 164, forearmL: -18,
      }),
      offsetY: -1.5,
    },
    {
      t: 0.76,
      pose: P({
        torso: 16, head: -12,
        thighR: 142, shinR: 68, footR: -82,
        thighL: 150, shinL: 64, footL: -80,
        upperArmR: 148, forearmR: -26,
        upperArmL: 200, forearmL: -24,
      }),
      offsetY: -1.0,
    },
    { t: 0.92, pose: P({ torso: 8, thighR: 150, shinR: 42, thighL: 200, shinL: 38 }), offsetY: -0.5 },
    { t: 1, pose: P({ torso: 5, thighR: 154, shinR: 34, thighL: 202, shinL: 30 }), offsetY: -0.3 },
  ],
};

/**
 * Neutral air: the sex kick.
 *
 * The one aerial whose *frame data* is the animation. Eight percent on frames
 * 3–5 and five percent on 6–27, off the same hitbox in the same place: the leg
 * goes out on frame 3 and then simply stays there, decaying, for twenty-two
 * more frames. Frame 27 lands at t ≈ 0.61, so the leg is still out two thirds
 * of the way through the clip — a kick that snapped back would have nothing
 * left to carry the weak half.
 */
const nair: PoseClip = {
  loop: false,
  strike: 0.12,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 8, head: -6,
        thighR: 144, shinR: 58, footR: -84,
        thighL: 202, shinL: 44, footL: -80,
        upperArmR: 136, forearmR: -34,
        upperArmL: 220, forearmL: -28,
      }),
      ease: "in",
    },
    // Contact, frame 3. Right leg accumulated 124 / 116: out in front and
    // down, at the hip height the hitbox sits at, knee straight.
    {
      t: 0.12,
      pose: P({
        torso: 12, head: -10,
        thighR: 124, shinR: -8, footR: -34,
        thighL: 226, shinL: 26, footL: -74,
        upperArmR: 48, forearmR: 20,
        upperArmL: 296, forearmL: -18,
      }),
      offsetY: -0.25,
      scaleX: 1.18,
      scaleY: 0.94,
      ease: "hold",
    },
    // Frame 5, the last strong frame.
    {
      t: 0.161,
      pose: P({
        torso: 12, head: -10,
        thighR: 124, shinR: -8, footR: -34,
        thighL: 226, shinL: 26, footL: -74,
        upperArmR: 50, forearmR: 18,
        upperArmL: 294, forearmL: -16,
      }),
      offsetY: -0.25,
      scaleX: 1.17,
      scaleY: 0.94,
      ease: "out",
    },
    // The weak half. The leg is still out; the body has stopped driving it and
    // the arms have come down out of the counterbalance.
    {
      t: 0.611,
      pose: P({
        torso: 6, head: -4,
        thighR: 132, shinR: -2, footR: -46,
        thighL: 216, shinL: 30, footL: -76,
        upperArmR: 88, forearmR: 2,
        upperArmL: 268, forearmL: 0,
      }),
      scaleX: 1.08,
    },
    {
      t: 0.82,
      pose: P({
        torso: 4,
        thighR: 144, shinR: 20, footR: -70,
        thighL: 206, shinL: 30, footL: -78,
        upperArmR: 116, forearmR: -12,
        upperArmL: 244, forearmL: 8,
      }),
      scaleX: 1.02,
    },
    { t: 1, pose: P({ torso: 2, thighR: 150, shinR: 34, thighL: 202, shinL: 28, upperArmR: 134, upperArmL: 230 }) },
  ],
};

/**
 * Forward air: the overhead chop.
 *
 * A meteor, and the reason a Mario who reads your recovery ends the stock on
 * the spot — the hitbox that matters is the one on frames 17–20 at angle 280,
 * pointing almost straight down. That only makes sense on an arm swinging
 * *through* the horizontal on its way down, so the clip has to spend real time
 * above his head first: the raised-fist key is the whole read, and it is held
 * with `hold` rather than eased so the wind-up is a drawing rather than a
 * blur.
 */
const fair: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 4,
        thighR: 152, shinR: 44, footR: -78,
        thighL: 204, shinL: 38, footL: -78,
        upperArmR: 306, forearmR: 40,
        upperArmL: 168, forearmL: -28,
      }),
      ease: "in",
    },
    // Fist overhead: arm accumulated −20 + 10 = −10, straight up and a shade
    // behind, body arched back under it.
    {
      t: 0.16,
      pose: P({
        torso: -20, head: 16,
        thighR: 160, shinR: 40, footR: -76,
        thighL: 212, shinL: 36, footL: -78,
        upperArmR: 10, forearmR: -10, handR: 0,
        upperArmL: 176, forearmL: -34,
      }),
      offsetY: 0.3,
      scaleY: 1.09,
      ease: "hold",
    },
    {
      t: 0.22,
      pose: P({
        torso: -20, head: 16,
        thighR: 160, shinR: 40, footR: -76,
        thighL: 212, shinL: 36, footL: -78,
        upperArmR: 10, forearmR: -10, handR: 0,
        upperArmL: 176, forearmL: -34,
      }),
      offsetY: 0.3,
      scaleY: 1.09,
      ease: "in",
    },
    // Contact, frame 16. Arm accumulated 26 + 62 = 88 — level, at the top of
    // the downswing, which is the 12% first hit.
    {
      t: 0.3,
      pose: P({
        torso: 26, head: -20, hip: -6,
        thighR: 146, shinR: 42, footR: -66,
        thighL: 206, shinL: 38, footL: -70,
        upperArmR: 62, forearmR: 14, handR: 0,
        upperArmL: 190, forearmL: -44,
      }),
      offsetX: 0.4,
      offsetY: -0.25,
      scaleX: 1.1,
      ease: "linear",
    },
    // Frames 17–20, the meteor. The arm keeps going down through 120°: the
    // swing continues *through* the active window rather than stopping in it,
    // which is what a chop does and what makes the 280° angle legible.
    {
      t: 0.38,
      pose: P({
        torso: 32, head: -24, hip: -8,
        thighR: 142, shinR: 44, footR: -64,
        thighL: 208, shinL: 40, footL: -68,
        upperArmR: 106, forearmR: 22, handR: 0,
        upperArmL: 196, forearmL: -40,
      }),
      offsetX: 0.5,
      offsetY: -0.4,
      scaleX: 1.12,
      ease: "out",
    },
    // Past the bottom of the arc.
    {
      t: 0.52,
      pose: P({
        torso: 20, head: -14,
        thighR: 148, shinR: 42, footR: -70,
        upperArmR: 148, forearmR: 16,
        upperArmL: 204, forearmL: -34,
      }),
      offsetX: 0.24,
      offsetY: -0.2,
    },
    {
      t: 0.74,
      pose: P({
        torso: 10, head: -6,
        thighR: 152, shinR: 38, footR: -76,
        upperArmR: 160, forearmR: -6,
        upperArmL: 208, forearmL: -30,
      }),
      offsetX: 0.1,
    },
    { t: 0.92, pose: P({ torso: 6, upperArmR: 150, forearmR: -20, upperArmL: 210, forearmL: -28 }) },
    { t: 1, pose: P({ torso: 4, upperArmR: 146, forearmR: -24, upperArmL: 210, forearmL: -28 }) },
  ],
};

/**
 * Back air: the dropkick.
 *
 * Both feet, together, straight out behind at hip height — the hitbox is at
 * x −6.4, y 5.2, a long way back and level, and no bent-knee kick reaches it.
 * The feet keep their −88° rest angle relative to the shin on purpose: with
 * the legs pointing backwards that puts both soles facing backwards, which is
 * the whole shape of a dropkick.
 */
const bair: PoseClip = {
  loop: false,
  strike: 0.26,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 16, head: -14,
        thighR: 138, shinR: 82, footR: -84,
        thighL: 146, shinL: 78, footL: -82,
        upperArmR: 156, forearmR: -32,
        upperArmL: 162, forearmL: -30,
      }),
      ease: "in",
    },
    // Contact, frame 6. Legs accumulated 262 and 266 with the knees straight,
    // torso thrown 44° forward as the counterweight that lets him lie flat.
    {
      t: 0.26,
      pose: P({
        torso: 44, head: -36, hip: 14,
        thighR: 248, shinR: 8, footR: -88,
        thighL: 252, shinL: 6, footL: -88,
        upperArmR: 96, forearmR: -26,
        upperArmL: 102, forearmL: -28,
      }),
      offsetX: -0.6,
      offsetY: -0.5,
      scaleX: 1.22,
      ease: "hold",
    },
    // Frame 10, the last live frame — the legs have not come back yet.
    {
      t: 0.366,
      pose: P({
        torso: 42, head: -34, hip: 12,
        thighR: 246, shinR: 10, footR: -88,
        thighL: 250, shinL: 8, footL: -88,
        upperArmR: 100, forearmR: -24,
        upperArmL: 106, forearmL: -26,
      }),
      offsetX: -0.55,
      offsetY: -0.5,
      scaleX: 1.2,
      ease: "out",
    },
    {
      t: 0.54,
      pose: P({
        torso: 26, head: -20, hip: 6,
        thighR: 228, shinR: 24, footR: -86,
        thighL: 232, shinL: 22, footL: -86,
        upperArmR: 126, forearmR: -18,
        upperArmL: 132, forearmL: -20,
      }),
      offsetX: -0.24,
      scaleX: 1.07,
    },
    {
      t: 0.78,
      pose: P({
        torso: 16, head: -12,
        thighR: 208, shinR: 30, footR: -84,
        thighL: 212, shinL: 28, footL: -84,
        upperArmR: 146, forearmR: -22,
        upperArmL: 200, forearmL: -22,
      }),
      offsetX: -0.08,
    },
    { t: 1, pose: P({ torso: 10, thighR: 196, shinR: 32, thighL: 202, shinL: 28 }) },
  ],
};

/**
 * Up air: the bicycle kick.
 *
 * Mario's legs are 3.5 units long against a 12-unit body, so a leg raised
 * from a standing pelvis cannot physically reach the hitbox at y 11.4 — and a
 * leg lifted straight up in front of the chest is invisible anyway, because it
 * is the same blue as the dungarees and never breaks the silhouette. The move
 * is a somersault kick in the original, and rotating the *whole body* is what
 * makes both problems go away at once: `rotation: −1.0` lays him back through
 * 57°, the kicking leg swings up clear of everything, and the silhouette
 * changes completely for four frames, which is exactly what a juggle tool with
 * knockback growth 135 ought to look like.
 */
const uair: PoseClip = {
  loop: false,
  strike: 0.22,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 12, head: -10,
        thighR: 198, shinR: 36, footR: -84,
        thighL: 204, shinL: 42, footL: -82,
        upperArmR: 152, forearmR: -26,
        upperArmL: 208, forearmL: -22,
      }),
      rotation: -0.16,
      ease: "in",
    },
    // Contact, frame 4. Body laid back 57°, kicking leg accumulated 20 — up
    // and just forward of vertical, ahead of the torso rather than across it.
    {
      t: 0.22,
      pose: P({
        torso: -8, head: 10,
        thighR: 74, shinR: -8, footR: -42,
        thighL: 118, shinL: 16, footL: -80,
        upperArmR: 244, forearmR: 30,
        upperArmL: 210, forearmL: -34,
      }),
      rotation: -1.0,
      offsetY: 0.4,
      scaleY: 1.1,
      ease: "hold",
    },
    // Frame 7, the last live frame.
    {
      t: 0.307,
      pose: P({
        torso: -8, head: 10,
        thighR: 66, shinR: -6, footR: -44,
        thighL: 122, shinL: 18, footL: -80,
        upperArmR: 246, forearmR: 28,
        upperArmL: 212, forearmL: -32,
      }),
      rotation: -1.06,
      offsetY: 0.4,
      scaleY: 1.1,
      ease: "out",
    },
    // Round and down the far side of the arc: the leg carries on past vertical
    // while the body comes back upright, which is what makes it a kick rather
    // than a raised knee.
    {
      t: 0.46,
      pose: P({
        torso: -2, head: 6,
        thighR: 96, shinR: 4, footR: -70,
        thighL: 172, shinL: 24, footL: -82,
        upperArmR: 200, forearmR: 6,
        upperArmL: 214, forearmL: -14,
      }),
      rotation: -0.5,
      offsetY: 0.16,
      scaleY: 1.04,
    },
    {
      t: 0.7,
      pose: P({
        torso: 4, head: 0,
        thighR: 138, shinR: 26, footR: -82,
        thighL: 196, shinL: 26, footL: -82,
        upperArmR: 160, forearmR: -18,
        upperArmL: 206, forearmL: -18,
      }),
      rotation: -0.16,
    },
    { t: 0.9, pose: P({ torso: 2, thighR: 148, shinR: 32, thighL: 200, shinL: 28 }), rotation: -0.04 },
    { t: 1, pose: P({ torso: 0, thighR: 152, shinR: 30, thighL: 202, shinL: 26 }) },
  ],
};

/**
 * Down air: the corkscrew.
 *
 * Mario spins about his *own vertical axis*, arms out, drilling downward —
 * five weak set-knockback hits on frames 5, 7, 9, 11 and 13 that hold the
 * victim in the drill, then one launcher on frame 23 (t ≈ 0.61).
 *
 * `spin` is the wrong tool for it, and that is worth writing down because it
 * is the obvious one to reach for: `spin` rotates the rig in the *screen
 * plane*, so it would somersault him head over heels. A turn about the
 * vertical axis is a rotation out of the screen, which a 2D rig cannot do —
 * but it can fake it the way flat animation always has, by squashing the body
 * to nothing as it goes edge-on and swapping which arm is in front as it comes
 * round. That is the `scaleX` oscillation below: 1.06 → 0.32 → 1.06 with the
 * arms exchanged each half turn, `linear` throughout because a drill does not
 * accelerate. Four half-turns across the eighteen frames of drilling is a turn
 * every nine frames; faster than about six and the eye stops resolving the
 * direction and sees a smear.
 */
const dair: PoseClip = {
  loop: false,
  strike: 0.14,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 150, shinR: 60, footR: -80,
        thighL: 206, shinL: 56, footL: -80,
        upperArmR: 146, forearmR: -34,
        upperArmL: 212, forearmL: 30,
      }),
      ease: "in",
    },
    // Into the drill, frame 5: legs together and straight, arms out level.
    {
      t: 0.14,
      pose: P({
        torso: 2, head: -2,
        thighR: 178, shinR: 2, footR: -104,
        thighL: 182, shinL: 2, footL: -102,
        upperArmR: 88, forearmR: 6,
        upperArmL: 272, forearmL: -6,
      }),
      scaleX: 1.06,
      scaleY: 1.1,
      ease: "linear",
    },
    {
      t: 0.255,
      pose: P({
        torso: 0, head: 0,
        thighR: 180, shinR: 0, footR: -100,
        thighL: 180, shinL: 0, footL: -100,
        upperArmR: 122, forearmR: -32,
        upperArmL: 238, forearmL: 32,
      }),
      scaleX: 0.32,
      scaleY: 1.12,
      ease: "linear",
    },
    {
      t: 0.37,
      pose: P({
        torso: -2, head: 2,
        thighR: 182, shinR: -2, footR: -98,
        thighL: 178, shinL: 2, footL: -102,
        upperArmR: 272, forearmR: -6,
        upperArmL: 88, forearmL: 6,
      }),
      scaleX: 1.06,
      scaleY: 1.1,
      ease: "linear",
    },
    {
      t: 0.485,
      pose: P({
        torso: 0, head: 0,
        thighR: 180, shinR: 0, footR: -100,
        thighL: 180, shinL: 0, footL: -100,
        upperArmR: 238, forearmR: 32,
        upperArmL: 122, forearmL: -32,
      }),
      scaleX: 0.32,
      scaleY: 1.12,
      ease: "linear",
    },
    // The launcher, frame 23. The drill opens out — arms and legs flung wide —
    // which is the only silhouette change in the move and therefore the only
    // frame a player can read as "that was the hit".
    {
      t: 0.609,
      pose: P({
        torso: 8, head: -6,
        thighR: 158, shinR: 14, footR: -90,
        thighL: 204, shinL: 12, footL: -90,
        upperArmR: 54, forearmR: 26,
        upperArmL: 306, forearmL: -26,
      }),
      scaleX: 1.2,
      scaleY: 1.0,
      ease: "out",
    },
    {
      t: 0.78,
      pose: P({
        torso: 4, head: -2,
        thighR: 164, shinR: 20, footR: -92,
        thighL: 198, shinL: 18, footL: -92,
        upperArmR: 92, forearmR: 6,
        upperArmL: 268, forearmL: -6,
      }),
      scaleX: 1.08,
    },
    { t: 0.92, pose: P({ torso: 2, thighR: 168, shinR: 22, thighL: 192, shinL: 20, upperArmR: 118, upperArmL: 242 }) },
    { t: 1, pose: P({ torso: 0, thighR: 170, shinR: 22, thighL: 190, shinL: 20, upperArmR: 128, upperArmL: 232 }) },
  ],
};

/**
 * Forward tilt: the kick.
 *
 * The shared `ftilt` is a straight arm, and Mario's is a leg — the hitbox
 * hangs off `kneer` in the original's script and sits at (6.4, 4.4), which is
 * hip height and well out in front. It also angles up or down with the stick,
 * so the neutral version reads best as a level roundhouse rather than a
 * stamp.
 */
const ftilt: PoseClip = {
  loop: false,
  strike: 0.32,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 200, shinR: 44, footR: -84,
        thighL: 178, shinL: 6, footL: -86,
        upperArmR: 150, forearmR: -40,
        upperArmL: 196, forearmL: -30,
      }),
      offsetX: -0.2,
      ease: "in",
    },
    // Contact, frame 5. Kicking leg accumulated 108 / 100 — out at hip height
    // with the knee all but straight, torso leaned back to counterweight it,
    // planted leg taking everything.
    {
      t: 0.32,
      pose: P({
        torso: -18, head: 16, hip: 8,
        thighR: 100, shinR: -8, footR: -30,
        thighL: 186, shinL: 10, footL: -86,
        upperArmR: 214, forearmR: 34,
        upperArmL: 150, forearmL: -46,
      }),
      offsetX: 0.35,
      scaleX: 1.12,
      ease: "hold",
    },
    // Frame 7, the last live frame.
    {
      t: 0.376,
      pose: P({
        torso: -16, head: 14, hip: 8,
        thighR: 102, shinR: -6, footR: -32,
        thighL: 186, shinL: 10, footL: -86,
        upperArmR: 210, forearmR: 32,
        upperArmL: 152, forearmL: -44,
      }),
      offsetX: 0.35,
      scaleX: 1.11,
      ease: "out",
    },
    {
      t: 0.54,
      pose: P({
        torso: -6, head: 6, hip: 4,
        thighR: 132, shinR: 24, footR: -70,
        thighL: 184, shinL: 12, footL: -86,
        upperArmR: 178, forearmR: 8,
        upperArmL: 176, forearmL: -34,
      }),
      offsetX: 0.16,
    },
    { t: 0.8, pose: P({ torso: 2, thighR: 150, shinR: 34, thighL: 198, shinL: 24 }) },
    { t: 1, pose: P({ torso: 3, upperArmR: 140, forearmR: -28, upperArmL: 200, forearmL: -30 }) },
  ],
};

/**
 * Neutral special: Fireball.
 *
 * A thrown object, not a strike — the move has **no hitbox of its own**, which
 * has a consequence for the timing that catches everyone: `moveTimingFor`
 * derives `firstActive` from hitboxes, finds none, and `poseTimeFor` falls
 * back to `actionFrame / total`. So `strike` does nothing here and every `t`
 * below is literally the fraction of 49 frames it happens at. The fireball
 * spawns on frame 17, which is t = 17/49 ≈ 0.347, and that is where the hand
 * has to be open and forward — a key one frame either side of it is a fireball
 * that appears out of a fist.
 *
 * It goes out underarm. That is the character of the move and the reason it
 * bounces along the ground instead of flying flat: the release is low, the arm
 * comes up through it, and the ball leaves at chest height on a rising arc.
 *
 * Two details are from reference rather than from guessing, and both change
 * the shape. The **wind-up** is the underarm part and the follow-through is
 * not — the arm draws back and down past the hip, scoops forward, and *stops*
 * at chest height with the palm open; there is no bowler's finish above the
 * head. And the **elbow stays bent** at the release, with the off arm flung up
 * and back beside the head absorbing the momentum, which is what makes the
 * silhouette asymmetric enough to read at a glance. `spawnFrame` is compared
 * against `moveFrameOf(actionFrame)`, so the ball appears on actionFrame 16,
 * i.e. t = 16/49 = 0.327 — not 17/49.
 */
const neutralB: PoseClip = {
  loop: false,
  strike: 0.327,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -6, head: 4,
        thighR: 152, shinR: 30, footR: -86,
        thighL: 204, shinL: 26, footL: -80,
        upperArmR: 176, forearmR: 10,
        upperArmL: 186, forearmL: -22,
      }),
      ease: "in",
    },
    // Cocked. Arm accumulated 210 + 44 = 254: drawn back and *below* the hip,
    // which is what makes the throw underarm rather than a shove.
    {
      t: 0.2,
      pose: P({
        torso: -16, head: 12, hip: 6,
        thighR: 162, shinR: 36, footR: -84,
        thighL: 208, shinL: 30, footL: -76,
        upperArmR: 226, forearmR: 44, handR: -20,
        upperArmL: 158, forearmL: -40,
      }),
      offsetX: -0.4,
      offsetY: -0.35,
      ease: "hold",
    },
    {
      t: 0.26,
      pose: P({
        torso: -16, head: 12, hip: 6,
        thighR: 162, shinR: 36, footR: -84,
        thighL: 208, shinL: 30, footL: -76,
        upperArmR: 226, forearmR: 44, handR: -20,
        upperArmL: 158, forearmL: -40,
      }),
      offsetX: -0.4,
      offsetY: -0.35,
      ease: "in",
    },
    // Release, actionFrame 16. Arm accumulated 28 + 108 − 60 = 76 at the wrist
    // with the elbow still bent: an open palm out in front at chest height,
    // where the projectile's spawn offset (5.2, 6.4) actually is. Off arm up
    // and back beside the head.
    {
      t: 0.327,
      pose: P({
        torso: 28, head: -14, hip: -6,
        thighR: 146, shinR: 26, footR: -78,
        thighL: 220, shinL: 24, footL: -110,
        upperArmR: 108, forearmR: -60, handR: 16,
        upperArmL: 252, forearmL: 70,
      }),
      offsetX: 0.45,
      offsetY: -0.45,
      scaleX: 1.05,
      ease: "hold",
    },
    // Frames 17–21. One degree of settle and nothing else: the `out` ease has
    // nowhere to go, so the release reads as *held* for its five frames, which
    // is what the original does.
    {
      t: 0.42,
      pose: P({
        torso: 26, head: -12, hip: -5,
        thighR: 148, shinR: 25, footR: -78,
        thighL: 218, shinL: 23, footL: -110,
        upperArmR: 111, forearmR: -57, handR: 12,
        upperArmL: 249, forearmL: 66,
      }),
      offsetX: 0.42,
      offsetY: -0.42,
      scaleX: 1.03,
      ease: "out",
    },
    // The unwind starts from the middle out — hips first, then the shoulders.
    // The palm is the last thing to leave.
    {
      t: 0.58,
      pose: P({
        torso: 16, head: -6, hip: -2,
        thighR: 154, shinR: 22, footR: -84,
        thighL: 208, shinL: 18, footL: -104,
        upperArmR: 126, forearmR: -40, handR: 4,
        upperArmL: 226, forearmL: 26,
      }),
      offsetX: 0.26,
      offsetY: -0.24,
    },
    {
      t: 0.74,
      pose: P({
        torso: 4,
        thighR: 150, shinR: 26, footR: -86,
        upperArmR: 96, forearmR: -18,
        upperArmL: 196, forearmL: -34,
      }),
      offsetX: 0.14,
    },
    { t: 0.92, pose: P({ torso: 3, upperArmR: 126, forearmR: -26, upperArmL: 198, forearmL: -32 }) },
    { t: 1, pose: P({ torso: 2, upperArmR: 134, forearmR: -28, upperArmL: 198, forearmL: -30 }) },
  ],
};

/**
 * Side special: Cape.
 *
 * A matador's flourish. The 7% is beside the point — the move reverses the
 * victim's facing and reflects projectiles — so what it has to read as is a
 * *sweep across the body*, not a strike at something. The near arm starts
 * folded across the chest with the cape gathered behind, and the whole torso
 * turns through the swing: shoulders from 30° closed to 26° open, which is
 * what carries the cape rather than the arm alone.
 */
const sideB: PoseClip = {
  loop: false,
  strike: 0.34,
  keys: [
    {
      t: 0,
      pose: P({
        torso: -8, head: 6,
        thighR: 154, shinR: 28, footR: -86,
        thighL: 204, shinL: 26, footL: -80,
        upperArmR: 148, forearmR: -60,
        upperArmL: 190, forearmL: -20,
      }),
      ease: "in",
    },
    // Gathered. Arm folded across the chest, shoulders turned away, weight on
    // the back foot — everything wound one way so the sweep can go the other.
    {
      t: 0.2,
      pose: P({
        torso: -20, head: 16, hip: 8,
        thighR: 164, shinR: 32, footR: -84,
        thighL: 208, shinL: 28, footL: -76,
        upperArmR: 172, forearmR: -84, handR: -20,
        upperArmL: 176, forearmL: -30,
      }),
      offsetX: -0.45,
      ease: "in",
    },
    // Contact, frame 12. Arm accumulated 26 + 58 = 84 and swung wide out
    // front, torso driven through it — the cape is at the far end of that arc.
    {
      t: 0.34,
      pose: P({
        torso: 26, head: -18, hip: -6,
        thighR: 132, shinR: 30, footR: -88,
        thighL: 222, shinL: 30, footL: -72,
        upperArmR: 58, forearmR: 22, handR: 0,
        upperArmL: 226, forearmL: -56,
      }),
      offsetX: 0.85,
      scaleX: 1.14,
      ease: "hold",
    },
    // Frame 14, the last live frame.
    {
      t: 0.395,
      pose: P({
        torso: 24, head: -16, hip: -6,
        thighR: 134, shinR: 30, footR: -88,
        thighL: 220, shinL: 30, footL: -72,
        upperArmR: 66, forearmR: 26, handR: 0,
        upperArmL: 222, forearmL: -54,
      }),
      offsetX: 0.9,
      scaleX: 1.13,
      ease: "out",
    },
    {
      t: 0.56,
      pose: P({
        torso: 14, head: -8,
        thighR: 142, shinR: 28, footR: -86,
        thighL: 212, shinL: 28, footL: -76,
        upperArmR: 96, forearmR: 14,
        upperArmL: 208, forearmL: -44,
      }),
      offsetX: 0.5,
    },
    {
      t: 0.78,
      pose: P({
        torso: 8, head: -2,
        upperArmR: 122, forearmR: -8,
        upperArmL: 202, forearmL: -36,
      }),
      offsetX: 0.24,
    },
    { t: 0.94, pose: P({ torso: 5, upperArmR: 134, forearmR: -22, upperArmL: 200, forearmL: -32 }), offsetX: 0.1 },
    { t: 1, pose: P({ torso: 4, upperArmR: 138, forearmR: -26, upperArmL: 200, forearmL: -30 }) },
  ],
};

/**
 * Up special: Super Jump Punch.
 *
 * The hitbox is live on **frame 3** of 55, so `poseTimeFor` compresses the
 * wind-up into two frames and gives the other fifty-two to the rise and the
 * fall. That is the right shape for the move and the wrong shape to author
 * carelessly: the crouch is a flicker, the punch is everything.
 *
 * The engine supplies the actual travel (`momentum` at frame 4, held twelve
 * frames), so `offsetY` here is only the body's own extension out of the
 * crouch — a couple of units, not the height of the jump. Adding the jump here
 * as well would draw him a body-length above where the simulation says he is.
 */
const upB: PoseClip = {
  loop: false,
  strike: 0.14,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 22, head: -18, hip: -8,
        thighR: 126, shinR: 108, footR: -76,
        thighL: 132, shinL: 104, footL: -74,
        upperArmR: 208, forearmR: 40,
        upperArmL: 216, forearmL: -38,
      }),
      offsetY: -1.5,
      ease: "in",
    },
    // Contact, frame 3. Fist accumulated −12 + 6 = −6: straight up past the
    // ear, body stretched out under it, legs trailing and toes pointed. The
    // shape of hitting a block from below.
    {
      t: 0.14,
      pose: P({
        torso: -12, head: 10,
        thighR: 186, shinR: 4, footR: -118,
        thighL: 192, shinL: 4, footL: -116,
        upperArmR: 6, forearmR: -6, handR: 0,
        upperArmL: 202, forearmL: -34,
      }),
      offsetY: 0.9,
      scaleY: 1.2,
      scaleX: 0.86,
      ease: "hold",
    },
    // Frames 4–16, the rising column of coin hits. The fist stays up: he is
    // travelling, not swinging.
    {
      t: 0.383,
      pose: P({
        torso: -8, head: 8,
        thighR: 190, shinR: 6, footR: -116,
        thighL: 194, shinL: 6, footL: -114,
        upperArmR: 2, forearmR: -4, handR: 0,
        upperArmL: 206, forearmL: -30,
      }),
      offsetY: 1.0,
      scaleY: 1.22,
      scaleX: 0.85,
      ease: "hold",
    },
    // Frames 17–18, the launcher at the top of the column.
    {
      t: 0.416,
      pose: P({
        torso: -4, head: 6,
        thighR: 186, shinR: 10, footR: -112,
        thighL: 196, shinL: 8, footL: -110,
        upperArmR: 352, forearmR: 4, handR: 0,
        upperArmL: 214, forearmL: -26,
      }),
      offsetY: 1.05,
      scaleY: 1.22,
      scaleX: 0.86,
      ease: "out",
    },
    // Over the top: the arm comes down, the knees come up, and he starts to
    // tumble — which is where the fifty-five frames actually go.
    {
      t: 0.62,
      pose: P({
        torso: 10, head: -6,
        thighR: 158, shinR: 44, footR: -88,
        thighL: 200, shinL: 40, footL: -86,
        upperArmR: 46, forearmR: 24,
        upperArmL: 268, forearmL: -20,
      }),
      offsetY: 0.4,
      scaleY: 1.06,
    },
    {
      t: 0.84,
      pose: P({
        torso: 18, head: -12,
        thighR: 142, shinR: 70, footR: -84,
        thighL: 196, shinL: 60, footL: -84,
        upperArmR: 108, forearmR: 10,
        upperArmL: 250, forearmL: -6,
      }),
      offsetY: -0.1,
    },
    { t: 1, pose: P({ torso: 12, thighR: 148, shinR: 54, thighL: 200, shinL: 48, upperArmR: 132, upperArmL: 232 }) },
  ],
};

/**
 * Down special: F.L.U.D.D.
 *
 * The other move with **no hitboxes at all**, and deliberately so — it deals
 * no damage, it charges and then pushes. Same consequence as Fireball: no
 * `firstActive`, so the clip runs linearly across 48 frames and every `t` is
 * the fraction it happens at.
 *
 * Three beats. He turns away and hunches over the pump to charge it (frames
 * 0–14), holds there (14–21, `hold` so the charge is a drawing rather than a
 * drift), then plants both feet, braces, and takes the recoil (22 on).
 */
const downB: PoseClip = {
  loop: false,
  // The frame the water starts, which for a move with no hitbox is a literal
  // fraction of the 48 and has to be the same number `fx.ts` opens the stream
  // on. They were 0.46 and 0.52 for a while: the brace arrived six frames
  // before the water and read as a flinch.
  strike: 0.52,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 6, head: -6,
        thighR: 152, shinR: 30, footR: -86,
        thighL: 204, shinL: 26, footL: -80,
        upperArmR: 160, forearmR: -30,
        upperArmL: 200, forearmL: -26,
      }),
      ease: "in",
    },
    // Charging. Hunched over the pump, both hands down on it, knees soft.
    {
      t: 0.29,
      pose: P({
        torso: 30, head: -24, hip: -6,
        thighR: 140, shinR: 72, footR: -82,
        thighL: 148, shinL: 68, footL: -80,
        upperArmR: 128, forearmR: -46,
        upperArmL: 134, forearmL: -44,
      }),
      offsetY: -1.25,
      ease: "hold",
    },
    {
      t: 0.44,
      pose: P({
        torso: 30, head: -24, hip: -6,
        thighR: 140, shinR: 72, footR: -82,
        thighL: 148, shinL: 68, footL: -80,
        upperArmR: 128, forearmR: -46,
        upperArmL: 134, forearmL: -44,
      }),
      offsetY: -1.25,
      ease: "in",
    },
    // Firing. Braced wide, weight on the back foot, both hands out on the
    // nozzle, leaning *away* from the stream — this is recoil, not a lunge.
    {
      t: 0.52,
      pose: P({
        torso: -14, head: 12, hip: 8,
        thighR: 124, shinR: 44, footR: -80,
        thighL: 226, shinL: 40, footL: -70,
        upperArmR: 100, forearmR: -18,
        upperArmL: 106, forearmL: -20,
      }),
      offsetX: -0.4,
      offsetY: -1.05,
      scaleX: 1.12,
      ease: "hold",
    },
    {
      t: 0.78,
      pose: P({
        torso: -12, head: 10, hip: 8,
        thighR: 126, shinR: 44, footR: -80,
        thighL: 224, shinL: 40, footL: -70,
        upperArmR: 104, forearmR: -16,
        upperArmL: 110, forearmL: -18,
      }),
      offsetX: -0.5,
      offsetY: -1.05,
      scaleX: 1.11,
      ease: "out",
    },
    {
      t: 0.94,
      pose: P({
        torso: 4, head: -2,
        thighR: 146, shinR: 40, footR: -84,
        thighL: 208, shinL: 34, footL: -78,
        upperArmR: 134, forearmR: -28,
        upperArmL: 198, forearmL: -26,
      }),
      offsetY: -0.5,
    },
    { t: 1, pose: P({ torso: 4, thighR: 150, shinR: 32, thighL: 204, shinL: 28 }), offsetY: -0.3 },
  ],
};

/**
 * Up tilt: the sweeping uppercut.
 *
 * Seven active frames — 5 to 11, which is a very long window for a tilt — and
 * knockback growth 130 on 5.5%. That is the shape of a combo starter, and it
 * is also the reason the arm must keep *travelling* through the whole window
 * rather than arriving and stopping: frame 11 lands at t ≈ 0.45, so the two
 * held keys below are 20% of the clip apart and the fist covers 40° between
 * them. An uppercut that finishes on frame 5 and then waits is a fighter
 * holding his arm in the air for six frames.
 */
const utilt: PoseClip = {
  loop: false,
  strike: 0.28,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 16, head: -12, hip: -4,
        thighR: 144, shinR: 56, footR: -84,
        thighL: 152, shinL: 52, footL: -82,
        upperArmR: 186, forearmR: 54,
        upperArmL: 178, forearmL: -38,
      }),
      offsetY: -0.75,
      ease: "in",
    },
    // Contact, frame 5. Fist accumulated −14 + 26 = 12: up past the ear and a
    // shade forward, which is the hitbox at (1.4, 10.6).
    {
      t: 0.28,
      pose: P({
        torso: -14, head: 14, hip: 4,
        thighR: 166, shinR: 14, footR: -78,
        thighL: 194, shinL: 12, footL: -80,
        upperArmR: 26, forearmR: -14, handR: 0,
        upperArmL: 200, forearmL: -30,
      }),
      offsetY: 0.5,
      scaleY: 1.12,
      scaleX: 0.94,
      ease: "linear",
    },
    // Frame 11, the last live frame — the arm has carried on over to
    // accumulated −22, up and behind, which is where an uppercut finishes.
    {
      t: 0.453,
      pose: P({
        torso: -20, head: 18, hip: 6,
        thighR: 170, shinR: 12, footR: -76,
        thighL: 192, shinL: 10, footL: -78,
        upperArmR: 350, forearmR: -6, handR: 0,
        upperArmL: 212, forearmL: -22,
      }),
      offsetY: 0.62,
      scaleY: 1.14,
      scaleX: 0.93,
      ease: "out",
    },
    {
      t: 0.62,
      pose: P({
        torso: -6, head: 8,
        thighR: 158, shinR: 22, footR: -82,
        thighL: 198, shinL: 20, footL: -82,
        upperArmR: 320, forearmR: 8,
        upperArmL: 206, forearmL: -18,
      }),
      offsetY: 0.2,
      scaleY: 1.04,
    },
    { t: 0.84, pose: P({ torso: 4, upperArmR: 260, forearmR: 20, upperArmL: 202, forearmL: -26 }) },
    { t: 1, pose: P({ torso: 3, upperArmR: 160, forearmR: -20, upperArmL: 200, forearmL: -30 }) },
  ],
};

/**
 * Down tilt: the low sweep.
 *
 * Two hitboxes on the same leg — 7% at the shin and 5% at the toe, the outer
 * one carrying a 40% trip chance the schema has no field for. Both sit at
 * y 1.0–1.6, which is ankle height, so the leg has to be genuinely flat along
 * the floor rather than a knee-height poke, and he has to be low enough that
 * it looks like it came from a crouch.
 */
const dtilt: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 26, head: -20,
        thighR: 128, shinR: 104, footR: -76,
        thighL: 134, shinL: 100, footL: -74,
        upperArmR: 158, forearmR: -30,
        upperArmL: 164, forearmL: -28,
      }),
      offsetY: -1.6,
      ease: "in",
    },
    // Contact, frame 5. Kicking leg accumulated 116 / 106 — out low and
    // almost straight; support leg folded right under him; hands down for
    // balance.
    {
      t: 0.3,
      pose: P({
        torso: 22, head: -16, hip: -6,
        thighR: 122, shinR: -10, footR: -26,
        thighL: 140, shinL: -76, footL: 34,
        upperArmR: 176, forearmR: 34,
        upperArmL: 192, forearmL: -40,
      }),
      offsetY: -2.35,
      offsetX: 0.4,
      scaleX: 1.16,
      ease: "hold",
    },
    {
      t: 0.361,
      pose: P({
        torso: 22, head: -16, hip: -6,
        thighR: 120, shinR: -10, footR: -24,
        thighL: 140, shinL: -76, footL: 34,
        upperArmR: 178, forearmR: 34,
        upperArmL: 192, forearmL: -40,
      }),
      offsetY: -2.35,
      offsetX: 0.45,
      scaleX: 1.16,
      ease: "out",
    },
    {
      t: 0.54,
      pose: P({
        torso: 24, head: -18,
        thighR: 132, shinR: 62, footR: -78,
        thighL: 138, shinL: 90, footL: -60,
        upperArmR: 166, forearmR: 6,
        upperArmL: 180, forearmL: -32,
      }),
      offsetY: -1.9,
      offsetX: 0.16,
    },
    { t: 0.8, pose: P({ torso: 24, thighR: 130, shinR: 100, thighL: 136, shinL: 96 }), offsetY: -1.6 },
    { t: 1, pose: P({ torso: 22, thighR: 130, shinR: 102, thighL: 136, shinL: 98 }), offsetY: -1.6 },
  ],
};

/**
 * Dash attack: the slide.
 *
 * Not a lunging punch. The frame data is unusual and it describes the move
 * exactly: 8% on frames 6–9, then a *sixteen-frame* 6% hitbox on 10–25 in the
 * same place. Nothing swings for sixteen frames — that is a body sliding along
 * the floor with the hitbox travelling on it. So the clip dives on frame 6 and
 * then holds the slide, losing speed, until frame 25 (t ≈ 0.69), and only then
 * gets up.
 *
 * `rotation` does the diving. Posing a horizontal body out of bone angles
 * alone means fighting every one of them; tipping the root 40° forward and
 * then posing a normal-looking body inside that frame is both easier to read
 * and easier to get right.
 */
const dashAttack: PoseClip = {
  loop: false,
  strike: 0.24,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 26, head: -20, hip: -6,
        thighR: 138, shinR: 62, footR: -78,
        thighL: 214, shinL: 46, footL: -72,
        upperArmR: 206, forearmR: 40,
        upperArmL: 150, forearmL: -38,
      }),
      offsetX: 0.2,
      offsetY: -0.5,
      ease: "in",
    },
    // Contact, frame 6. Body tipped 40° into the dive, both arms out in front,
    // legs trailing straight behind — the whole fighter is one line.
    {
      t: 0.24,
      pose: P({
        torso: 8, head: -4, hip: -6,
        thighR: 168, shinR: 14, footR: -96,
        thighL: 176, shinL: 12, footL: -94,
        upperArmR: 122, forearmR: -14,
        upperArmL: 128, forearmL: -16,
      }),
      rotation: 0.7,
      offsetX: 1.3,
      offsetY: -1.5,
      scaleX: 1.16,
      ease: "linear",
    },
    // Frame 25, the end of the slide. Still flat, still forward, but the
    // shoulders have come up a little as the friction takes it.
    {
      t: 0.69,
      pose: P({
        torso: 4, head: 0, hip: -4,
        thighR: 162, shinR: 22, footR: -92,
        thighL: 180, shinL: 18, footL: -90,
        upperArmR: 136, forearmR: -8,
        upperArmL: 142, forearmL: -10,
      }),
      rotation: 0.6,
      offsetX: 1.6,
      offsetY: -1.45,
      scaleX: 1.1,
      ease: "out",
    },
    // Up onto the feet.
    {
      t: 0.86,
      pose: P({
        torso: 22, head: -16,
        thighR: 138, shinR: 76, footR: -80,
        thighL: 200, shinL: 56, footL: -80,
        upperArmR: 150, forearmR: -24,
        upperArmL: 190, forearmL: -22,
      }),
      rotation: 0.2,
      offsetX: 0.8,
      offsetY: -1.0,
    },
    { t: 1, pose: P({ torso: 12, thighR: 148, shinR: 48, thighL: 202, shinL: 40 }), offsetX: 0.4, offsetY: -0.5 },
  ],
};

export const poses: Partial<Record<PoseName, PoseClip>> = {
  fsmash,
  usmash,
  dsmash,
  nair,
  fair,
  bair,
  uair,
  dair,
  ftilt,
  utilt,
  dtilt,
  dashAttack,
  neutralB,
  sideB,
  upB,
  downB,
};
