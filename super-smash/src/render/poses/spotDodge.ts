import { P, type PoseClip } from "./clip";

/**
 * The spot dodge — 24 frames, intangible on 3–20 (`SPOT_DODGE_FRAMES`,
 * `SPOT_DODGE_INTANGIBLE`).
 *
 * Ultimate calls it a sidestep and it is the shortest and fastest of the three
 * dodges: almost every character in the roster turns intangible on frame 3, and
 * the whole action is over in a little under half a second. Two facts about it
 * set the timing here. The first is that the intangibility is bought by being
 * early — three frames is the entire commitment, so the evasive shape has to be
 * finished by frame 3 or the drawing is lying about when the fighter stopped
 * being there. The second is dodge staling: spot dodge repeatedly and Ultimate
 * pushes the intangibility three frames later *and* stretches the animation,
 * which is the game saying out loud that the frames after the window are the
 * point of the move. Frames 21–23 are what an opponent is waiting on, so the
 * recovery is animated as an arrival rather than as a fade back to neutral.
 *
 * None of the ghosting is done here. `intangibleAlpha` blinks the fighter and
 * `trackAfterimages` drops a trail every other intangible frame, both driven off
 * the engine's window rather than off this clip. What is left to the pose is the
 * silhouette, and unlike a roll — which sells itself by travelling — a spot
 * dodge never leaves the spot. So the whole read is the shape changing: down a
 * fifth of standing height and in to narrower than the fighter stands, arrived
 * at in three frames, held, and given back over four.
 *
 * The feet stay flat through the crouch rather than rolling up onto the toes,
 * which is the less obvious of the two ways to draw a squat and the only one
 * that survives being shared. A toes-down foot hangs its whole length below the
 * ankle, and the eight rigs do not agree on that length — Kirby's feet are half
 * again as long as the reference humanoid's — so a pose planted on Mario buries
 * Kirby's foot in the floor. Held near horizontal, foot length barely moves the
 * lowest point and one `offsetY` per key plants all eight.
 */
export const spotDodge: PoseClip = {
  loop: false,
  keys: [
    // Frame 0, the break. Knees give and the guard closes, but the fighter is
    // still nearly standing height — the compress needs a tall frame to be
    // measured against, and the blend out of `idle` has to have somewhere to
    // land.
    {
      t: 0,
      pose: P({
        torso: 13, head: -11, hip: -4,
        thighR: 155, shinR: 40, footR: -102,
        thighL: 163, shinL: 36, footL: -96,
        upperArmR: 164, forearmR: -24,
        upperArmL: 194, forearmL: -28,
      }),
      offsetY: -0.15,
      scaleX: 0.94,
      scaleY: 0.98,
      ease: "out",
    },
    // Frame 1. Half way down, with the arms already folded across the chest and
    // the far shoulder dropped back.
    {
      t: 1 / 24,
      pose: P({
        torso: 21, head: -18, hip: -8,
        thighR: 138, shinR: 74, footR: -114,
        thighL: 146, shinL: 70, footL: -102,
        upperArmR: 160, forearmR: -128,
        upperArmL: 198, forearmL: -108,
      }),
      offsetY: -0.56,
      offsetX: -0.12,
      scaleX: 0.80,
      scaleY: 0.94,
      ease: "out",
    },
    // Frame 3, the first intangible frame and the frame the compressed shape
    // arrives on. Landing it here rather than a frame either side is the one
    // piece of timing this clip can be wrong about: the frame the engine stops
    // letting hitboxes touch the fighter is the frame the eye has to lose them
    // on.
    {
      t: 3 / 24,
      pose: P({
        torso: 26, head: -22, hip: -11,
        thighR: 138, shinR: 84, footR: -124,
        thighL: 146, shinL: 84, footL: -106,
        upperArmR: 160, forearmR: -150,
        upperArmL: 200, forearmL: -120,
      }),
      offsetY: -0.69,
      offsetX: -0.26,
      scaleX: 0.66,
      scaleY: 0.90,
      ease: "out",
    },
    // A moving hold. Eighteen frames is a third of the clip's length and far too
    // long for a dead drawing, but any real movement in here reads as the dodge
    // ending early and invites a punish that would not have worked. So the
    // fighter only sinks another finger's width into the compression and stays
    // there — enough that the shape breathes under the afterimages, not enough
    // to be mistaken for recovery.
    {
      t: 8 / 24,
      pose: P({
        torso: 28, head: -23, hip: -12,
        thighR: 137, shinR: 87, footR: -126,
        thighL: 145, shinL: 87, footL: -108,
        upperArmR: 158, forearmR: -152,
        upperArmL: 202, forearmL: -122,
      }),
      offsetY: -0.77,
      offsetX: -0.30,
      scaleX: 0.64,
      scaleY: 0.89,
      // Cubic-in, so the pose sits still for the first ten frames of the span
      // and only starts unwinding near the end of the intangible window.
      ease: "in",
    },
    // Frame 20, the last intangible frame — and the tell. The hips are already
    // lifting and the shoulders are coming back square; a player who has learned
    // to watch for this frame is reading it correctly, because one frame later
    // the fighter can be hit.
    {
      t: 20 / 24,
      pose: P({
        torso: 22, head: -18, hip: -9,
        thighR: 134, shinR: 84, footR: -112,
        thighL: 142, shinL: 80, footL: -98,
        upperArmR: 158, forearmR: -108,
        upperArmL: 198, forearmL: -94,
      }),
      offsetY: -0.61,
      offsetX: -0.16,
      scaleX: 0.74,
      scaleY: 0.92,
    },
    // Frame 22. Most of the height is back but the arms are still inside the
    // guard — the fighter is standing up a beat before they are ready to do
    // anything with it, which is the whole of what a punish window looks like.
    {
      t: 22 / 24,
      pose: P({
        torso: 10, head: -9, hip: -3,
        thighR: 152, shinR: 48, footR: -106,
        thighL: 160, shinL: 44, footL: -94,
        upperArmR: 162, forearmR: -34,
        upperArmL: 194, forearmL: -32,
      }),
      offsetY: -0.11,
      offsetX: -0.05,
      scaleX: 0.90,
      scaleY: 0.98,
      ease: "out",
    },
    // Frame 23, the last frame anything is drawn on: `poseTimeFor` divides by
    // `SPOT_DODGE_FRAMES`, so the clip is only ever sampled at n/24 and t = 1
    // belongs to whatever comes next. This key is therefore the standing shape
    // itself, close enough to `idle` that the cut costs nothing — and it is the
    // frame that tells the opponent the punish window is open.
    {
      t: 23 / 24,
      pose: P({
        torso: 4, head: -4,
        thighR: 174, shinR: 8, footR: -90,
        thighL: 182, shinL: -6, footL: -86,
        upperArmR: 166, forearmR: 14,
        upperArmL: 192, forearmL: -16,
      }),
    },
  ],
};
