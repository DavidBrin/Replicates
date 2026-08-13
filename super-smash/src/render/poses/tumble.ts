import { P, type PoseClip } from "./clip";
import { deg } from "../skeleton";

/**
 * Tumble — the loop above `TUMBLE_HITSTUN` frames of hitstun, which is every
 * kill and every hit big enough that the player is watching it to find out
 * whether they still have the stock.
 *
 * SmashWiki calls it "a defensive, rotating animation", and *defensive* is the
 * word that matters: tumble is the one reeling state a fighter can act out of —
 * jump, aerial, special, air dodge, and a tech on contact with any surface — so
 * this is not a corpse being thrown. It is somebody trying to get their limbs
 * back under them and not managing it, for about half a second at a time.
 *
 * ## One flail per revolution
 *
 * The limbs swing once per turn, and the 1:1 lock is not a stylistic choice:
 * gravity and drag point one way in the world, so in the *body's* frame they
 * sweep round once per revolution, and a limb left to itself swings once and
 * comes back where it started. A run cycle's alternating scissor would be wrong
 * here — alternation implies muscular control, and the whole read is that there
 * is none. What each joint gets instead is that same swing, arriving a little
 * later the further out it is: the knee peaks about three frames behind the
 * hip, the ankle about one behind the knee, and the far leg runs a quarter of a
 * cycle behind the near one so that no two limbs ever reach an extreme
 * together. That drag is most of what separates a person tumbling from a shape
 * rotating, and it is what the old two-key version had none of — two poses half
 * a cycle apart is a body held rigid inside a constant spin, which is what a
 * thrown ragdoll is.
 *
 * ## Thirty-two frames, and a turn that is not quite even
 *
 * 32 rather than 26, because 32 is `TUMBLE_HITSTUN`: the shortest hit that
 * tumbles at all now shows exactly one complete revolution, so nobody is ever
 * dropped out of tumble mid-turn, and a kill shot's 60-90 frames shows two or
 * three. It also drops the step from 13.9° a frame to 11.3°, which the eye can
 * still read as a body rather than a blur — and since the flail is locked to
 * the spin, the period sets the flail rate too. 1.9Hz is about as fast as an
 * arm actually thrashes.
 *
 * `spin` on its own turns the body at a dead constant rate, and easing the keys
 * does not redistribute it: `poseTimeFor` hands a looping clip a raw
 * `actionFrame / period` ramp, `poseSpinFor` multiplies that, and neither looks
 * at a keyframe. The per-key `rotation`, which the renderer adds on top of the
 * spin, is the only lever — so it carries ±9°, phased to run the body about 15%
 * fast at the frame its hands and feet sit closest to the pelvis and 15% slow
 * where they are furthest out. That is the skater's effect, and tying the rate
 * to the pose is what keeps the variation from reading as a wobble.
 *
 * `spin` has to stay a whole number: the ramp resets at every cycle boundary,
 * so a fractional turn would jump by its fraction each time round, on a clip
 * that repeats two or three times per launch. The pose crosses the same seam
 * safely because it is authored as continuous swings sampled at eight points,
 * which makes the seam just another sample; the spans are `linear` for the same
 * reason. `smooth` would park every joint at zero velocity every four frames,
 * and a continuous flail interrupted eight times a cycle shimmers.
 *
 * One thing deliberately absent: squash and stretch. `scaleX`/`scaleY` are
 * applied in world axes *after* the rotation is baked into the bone positions,
 * so a stretched key does not stretch along the fighter — it shears them as
 * they turn.
 */
export const tumble: PoseClip = {
  loop: true,
  period: 32,
  spin: -1,
  keys: [
    // f0 — knees folded under a curled torso, near arm thrown straight out
    // ahead. Hands and feet sit closest to the pelvis here, so the turn is at
    // its fastest.
    {
      t: 0,
      pose: P({
        torso: 13, head: 13,
        thighR: 159, shinR: 67, footR: -45,
        thighL: 236, shinL: 47, footL: -63,
        upperArmR: 101, forearmR: -4,
        upperArmL: 310, forearmL: 33,
      }),
      rotation: deg(-6.4),
      ease: "linear",
    },
    // f4 — the fold opens from the hips outward: the far knee is still coming
    // up as the near one starts to drop, both arms swinging overhead.
    {
      t: 0.125,
      pose: P({
        torso: -6, head: 23,
        thighR: 136, shinR: 54, footR: -46,
        thighL: 232, shinL: 65, footL: -50,
        upperArmR: 66, forearmR: -13,
        upperArmL: 300, forearmL: 51,
      }),
      rotation: deg(0),
      ease: "linear",
    },
    // f8 — arms at full stretch above the head with the torso arching back
    // under them: everything as far out as it gets, and the slowest turn.
    {
      t: 0.25,
      pose: P({
        torso: -23, head: 21,
        thighR: 121, shinR: 30, footR: -58,
        thighL: 215, shinL: 67, footL: -42,
        upperArmR: 47, forearmR: -34,
        upperArmL: 271, forearmL: 56,
      }),
      rotation: deg(6.4),
      ease: "linear",
    },
    // f12 — the near leg snaps straight out of the fold while the far one is
    // still folded, and the head lags the arch it is sitting on top of.
    {
      t: 0.375,
      pose: P({
        torso: -28, head: 8,
        thighR: 123, shinR: 10, footR: -73,
        thighL: 195, shinL: 52, footL: -45,
        upperArmR: 54, forearmR: -55,
        upperArmL: 240, forearmL: 46,
      }),
      rotation: deg(9),
      ease: "linear",
    },
    // f16 — half a turn, upside down. Legs long, elbows folding as the arms
    // fall back across the body.
    {
      t: 0.5,
      pose: P({
        torso: -17, head: -9,
        thighR: 141, shinR: 5, footR: -83,
        thighL: 184, shinL: 29, footL: -57,
        upperArmR: 83, forearmR: -64,
        upperArmL: 226, forearmL: 27,
      }),
      rotation: deg(6.4),
      ease: "linear",
    },
    // f20 — everything strung out along the body axis with the hands in at the
    // hips: the tightest the mass ever sits about the pivot, and the fastest.
    {
      t: 0.625,
      pose: P({
        torso: 2, head: -19,
        thighR: 164, shinR: 18, footR: -82,
        thighL: 188, shinL: 11, footL: -70,
        upperArmR: 118, forearmR: -55,
        upperArmL: 236, forearmL: 9,
      }),
      rotation: deg(0),
      ease: "linear",
    },
    // f24 — coming back round, the near knee folding first.
    {
      t: 0.75,
      pose: P({
        torso: 19, head: -17,
        thighR: 179, shinR: 42, footR: -70,
        thighL: 205, shinL: 9, footL: -78,
        upperArmR: 137, forearmR: -34,
        upperArmL: 265, forearmL: 4,
      }),
      rotation: deg(-6.4),
      ease: "linear",
    },
    // f28 — the far leg is a quarter of a cycle behind the near one and only
    // starting to fold, which is the whole drag showing in a single drawing.
    {
      t: 0.875,
      pose: P({
        torso: 24, head: -4,
        thighR: 177, shinR: 62, footR: -55,
        thighL: 225, shinL: 24, footL: -75,
        upperArmR: 130, forearmR: -13,
        upperArmL: 296, forearmL: 14,
      }),
      rotation: deg(-9),
      ease: "linear",
    },
  ],
};
