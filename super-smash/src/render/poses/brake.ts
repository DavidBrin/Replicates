import { P, type PoseClip } from "./clip";

/**
 * The skid: everything between a full run and a standstill, in four frames.
 *
 * Ultimate raised traction across the whole cast so far that its *lowest* value
 * sits above SSB4's highest, and the skid is what that change looks like — the
 * fighter plants and is stopped, rather than drifting to a halt. The real game
 * gives each character their own skid length; here everyone shares these four
 * frames. It is also actionable throughout, so nobody ever watches the end of
 * it; the tail of this clip is a hand-off, not a beat.
 *
 * Four frames is sixty-seven milliseconds and the renderer only ever asks for
 * `actionFrame / 4`, so the clip is sampled at exactly four instants and no
 * others. That makes this four drawings cut against each other rather than a
 * blend — keys sit on the frame grid, and every span holds so that nothing can
 * interpolate a shoe that swings from toe-up to toe-down between two of them.
 *
 * One frame plants, two dig, one settles. The dig gets half the clip and the
 * middle of it because it is the only shape the eye can catch at this length,
 * and it gets *two* frames rather than one because a single frame of a pose
 * reads as a flicker in the silhouette rather than as a pose. The two are not
 * identical: the hips keep sinking and both feet gather in, which is the slide
 * losing speed rather than a photograph waiting for its turn to end. Shoulders
 * go forward, back, further back, upright across the four, and that reversal
 * against the direction of travel is the whole read.
 *
 * The last frame is within a few degrees of `idle`'s first, because nothing
 * blends between clips — whatever gap is left here is a snap at the moment the
 * fighter comes to rest.
 */
export const brake: PoseClip = {
  loop: false,
  keys: [
    // The plant. Still the run's forward lean and the run's arm opposition —
    // near arm back — but the lead heel has already been thrown out in front of
    // the mass it has to stop. Both arms reverse on the next frame, which is a
    // bigger swing than anything else in the clip and reads as the jolt.
    {
      t: 0,
      pose: P({
        torso: 14, head: -12, hip: 0,
        thighR: 141, shinR: 30, footR: -96,
        thighL: 189, shinL: 53, footL: -84,
        upperArmR: 208, forearmR: 34,
        upperArmL: 138, forearmL: -34,
      }),
      offsetY: -0.19,
      ease: "hold",
    },
    // The dig. Shoulders a full unit behind the pelvis, lead leg braced nearly
    // straight with the toe lifted off the heel, trailing leg bent and dragging
    // its toe two units back.
    {
      t: 0.25,
      pose: P({
        torso: -16, head: 16, hip: -4,
        thighR: 147, shinR: 22, footR: -113,
        thighL: 184, shinL: 73, footL: -103,
        upperArmR: 105, forearmR: -14,
        upperArmL: 240, forearmL: 22,
      }),
      offsetY: -0.28,
      scaleX: 1.05,
      scaleY: 0.95,
      ease: "hold",
    },
    // The same drawing, a notch lower and a notch shorter: the last of the
    // momentum going into the knees.
    {
      t: 0.5,
      pose: P({
        torso: -18, head: 20, hip: -6,
        thighR: 136, shinR: 49, footR: -133,
        thighL: 176, shinL: 87, footL: -116,
        upperArmR: 98, forearmR: -18,
        upperArmL: 244, forearmL: 26,
      }),
      offsetY: -0.40,
      scaleX: 1.07,
      scaleY: 0.93,
      ease: "hold",
    },
    // Stood up, feet gathered, a few degrees of give still in the knees.
    {
      t: 0.75,
      pose: P({
        torso: 5, head: -5, hip: -1,
        thighR: 172, shinR: 11, footR: -88,
        thighL: 187, shinL: -8, footL: -81,
        upperArmR: 172, forearmR: 20,
        upperArmL: 191, forearmL: -20,
      }),
      offsetY: -0.05,
      ease: "hold",
    },
  ],
};
