import { P, type PoseClip } from "./clip";

/**
 * The pivot out of a run — eleven frames, and the facing has *already* flipped.
 *
 * `states.ts` assigns `f.facing = intent.x` and only then enters `turnaround`,
 * so the renderer mirrors the fighter to the new direction on frame 0 and holds
 * it there for the whole clip. Nothing in this file can turn the body; it can
 * only make the body look like it got there. That is the one thing about this
 * animation the next reader will get wrong, and everything below follows from it.
 *
 * Frame 0 is therefore the *run's stride reflected* — every angle negated, which
 * is the same drawing the run was making the frame before, because a mirrored
 * pose drawn facing right is an unmirrored pose drawn facing left. On the flip
 * frame the silhouette does not change at all. Only the head is already looking
 * the new way, and it stays looking that way throughout: the player has turned,
 * and over the next ten frames the body catches up with them.
 *
 * Ultimate is why this state exists. Reversing during the initial dash is free
 * for the whole cast — the interrupt is frame 15 for everybody, which is what
 * makes dash-dancing universal — but once the run phase has begun a reversal has
 * to be paid for with this animation. The wiki's other number sets the first
 * beat: a turnaround dash has three frames of delay before the fighter
 * accelerates, against one for an ordinary dash. So frames 0-2 commit to nothing
 * at all. They are a brake, played over the top of the traction the engine is
 * still applying in the *old* direction, because `turnaround` falls through to
 * `applyTraction` and the fighter really is still sliding backwards under it.
 *
 * `scaleX` is the turn. The rig mirrors but cannot rotate about its own vertical,
 * so a body caught part-way round has to be a body squeezed horizontally: full
 * width square-on at frames 0 and 10, 0.46 edge-on at frame 4. The squeeze also
 * pays for the frame it brackets. Knees bend backwards on a fighter facing away
 * and forwards on one facing you, so every shin angle in the clip has to cross
 * zero somewhere; it crosses between frames 3 and 4, where the body is a sliver
 * and the inversion cannot be read. At full width it would be a fighter whose
 * legs snap inside out.
 *
 * The feet barely move, because in a real pivot they do not — the planted foot
 * stays where it is and the body rotates over it. Every foot angle here was
 * chosen from its *accumulated* angle for that reason, so the right foot points
 * the old way from frame 0 to frame 10 while the leg above it swings from behind
 * the hips to in front of them. It ends pointing backwards, which is exactly
 * where `BASE_RIG` rests it: the idle stance a fighter drops into is the stance
 * the pivot left them standing in.
 *
 * Height was picked against the floor rather than by eye. `root` is a fixed
 * strut, so bending the knees lifts the *feet* rather than dropping the hips,
 * and every `offsetY` here is whatever puts the lower toe back on the ground
 * plus a deliberate few tenths. That gives the clip its rhythm without anyone
 * having to author it: down into the brake at frame 2, up onto the toe through
 * the turn, down again onto the new lead leg at frame 8.
 *
 * The clip is only ever sampled at eleven instants — `poseTimeFor` hands back
 * `actionFrame / 11` — so an ease is invisible on any span with a single frame
 * inside it, where smooth and linear agree at the midpoint anyway. The one that
 * matters is the settle, which holds two: `out` gets frame 10 to within a degree
 * of the stand instead of halfway to it. Nothing blends between clips, and
 * whatever gap is left on frame 10 is a snap the moment `stand` takes over.
 */
export const turn: PoseClip = {
  loop: false,
  keys: [
    // Frame 0. The run, reflected: leaning into the direction of travel, lead
    // foot reaching out into it, trailing leg folded up behind, and airborne,
    // because a stride is. Nothing here belongs to the new direction but the head.
    {
      t: 0,
      pose: P({
        hip: 2, torso: -20, head: 22,
        thighR: 236, shinR: -34, footR: -106,
        thighL: 138, shinL: -52, footL: 52,
        upperArmR: 130, forearmR: -50,
        upperArmL: 236, forearmL: 54,
      }),
      offsetX: -0.2,
      offsetY: 0.05,
    },
    // Frame 2. The check. Sole flat, knee taking the load, hips sunk to their
    // lowest and still behind the plant. The shoulders have started to come
    // round; the fighter has not started to go anywhere.
    {
      t: 2 / 11,
      pose: P({
        hip: -6, torso: -13, head: 21,
        thighR: 216, shinR: -18, footR: -108,
        thighL: 154, shinL: -34, footL: 14,
        upperArmR: 119, forearmR: -30,
        upperArmL: 245, forearmL: 38,
      }),
      offsetX: -0.55,
      offsetY: -0.47,
      scaleX: 0.8,
      scaleY: 1.02,
    },
    // Frame 4. Edge-on: narrowest, tallest, legs straight and gathered under the
    // hips with the heel off the floor, both elbows clamped in. A body rotating
    // about its own axis rises and pulls its arms to it, and this is the only
    // frame in which the fighter is doing neither one direction nor the other.
    {
      t: 4 / 11,
      pose: P({
        hip: 0, torso: -2, head: 2,
        thighR: 190, shinR: 8, footR: -84,
        thighL: 178, shinL: 10, footL: -76,
        upperArmR: 154, forearmR: -24,
        upperArmL: 202, forearmL: 28,
      }),
      offsetX: -0.08,
      offsetY: 0.31,
      scaleX: 0.46,
      scaleY: 1.06,
    },
    // Frame 5. The far side of the same instant, and a second drawing rather
    // than a held one — the lean has crossed through vertical, the swing leg has
    // passed behind the pivot foot and the shoulders are already opening. One
    // frame of a shape reads as a flicker; two read as a body going through.
    {
      t: 5 / 11,
      pose: P({
        hip: 2, torso: 8, head: -8,
        thighR: 176, shinR: 16, footR: -80,
        thighL: 190, shinL: 20, footL: -108,
        upperArmR: 160, forearmR: -12,
        upperArmL: 180, forearmL: 20,
      }),
      offsetX: 0.06,
      offsetY: 0.2,
      scaleX: 0.58,
      scaleY: 1.04,
    },
    // Frame 7. Opening out, weight coming forward over the foot that never
    // moved. The knees are now bent the way they bend for a fighter facing you,
    // which is the half of the inversion the squeeze was hiding.
    {
      t: 7 / 11,
      pose: P({
        hip: -2, torso: 14, head: -8,
        thighR: 160, shinR: 26, footR: -90,
        thighL: 196, shinL: 16, footL: -112,
        upperArmR: 168, forearmR: 0,
        upperArmL: 164, forearmL: 18,
      }),
      offsetX: 0.28,
      offsetY: -0.14,
      scaleX: 0.86,
    },
    // Frame 8. The catch: a run's worth of momentum arriving on the new lead leg
    // and being absorbed. The only squash in the clip, the deepest hips, and the
    // shoulders a hair past square — a turn that stops exactly at square reads as
    // one that was aimed rather than one that was thrown. Ultimate lets this be
    // cancelled into any ground move with the momentum kept, so the back half is
    // a fighter arriving somewhere usable, not a flourish.
    {
      t: 8 / 11,
      pose: P({
        hip: -4, torso: 20, head: -10,
        thighR: 152, shinR: 36, footR: -96,
        thighL: 202, shinL: 20, footL: -122,
        upperArmR: 176, forearmR: 10,
        upperArmL: 148, forearmL: 20,
      }),
      offsetX: 0.16,
      offsetY: -0.5,
      scaleX: 1.08,
      scaleY: 0.94,
      ease: "out",
    },
    // The middle of `idle`'s breath, and not its first key: `poseTimeFor` drives
    // the stand off the *global* frame plus the port offset, so the fighter
    // arrives at whatever phase of the loop happens to be running and there is no
    // first frame to aim at. Landing on the mean halves the worst case.
    //
    // Every bone is named, including the feet, which idle leaves at their rest
    // angles: a bone one key omits holds the value it had, so leaving the legs
    // out here would carry the pivot's crossed stance into the stand.
    {
      t: 1,
      pose: P({
        hip: 0, torso: 5, head: -5,
        thighR: 174, shinR: 8, footR: -92,
        thighL: 182, shinL: 0, footL: -88,
        upperArmR: 164, forearmR: 18,
        upperArmL: 193, forearmL: -18,
      }),
      offsetX: 0,
      offsetY: 0.05,
    },
  ],
};
