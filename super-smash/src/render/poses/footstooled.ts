import { P, type PoseClip } from "./clip";

/**
 * Stood on: a grounded fighter someone footstool-jumped off (Plan 5, Task 17).
 *
 * SmashWiki "Footstool Jump" (https://www.ssbwiki.com/Footstool_Jump): "When used
 * on a grounded opponent, it briefly freezes the opponent while they are in an
 * animation of the player bouncing off their head." Until Task 17 the
 * footstooled fighter played the grab's struggle (`grabbed`), which floats a unit
 * off the floor and thrashes against a grip that is not there.
 *
 * So: crushed down under the feet that land on the head, at once — it is done to
 * the fighter, so it arrives without a fade (`blend.ts`) — springing back a
 * little as the jumper leaves, stunned low through the freeze, and standing back
 * up into idle on its last frames. Played once across the freeze
 * (`FOOTSTOOL_GROUND_FRAMES`, 30, the state's length in `statusDuration` and
 * `actionDurationFor`).
 *
 * Presentation choice, every number: no source publishes the animation. Built
 * on the crouch's geometry (`crouch.ts`), which is what keeps the boots on the
 * stage: the depth is bought with squash about the feet and the knees' fold, not
 * with `offsetY`, which slides the feet into the floor. The head nods down under
 * the weight and the arms fly out, which is the read at a distance: something
 * landed on this fighter.
 */
export const footstooled: PoseClip = {
  loop: false,
  keys: [
    // The stomp: deeper than the crouch settles, the head driven down, the arms
    // thrown out from the shoulders.
    {
      t: 0,
      pose: P({
        hip: -3.2, torso: 15, head: 16,
        thighR: 127.6, shinR: 99.3, footR: -130.6,
        thighL: 136.4, shinL: 93.5, footL: -133.6,
        upperArmR: 128, forearmR: -34,
        upperArmL: 228, forearmL: -30,
      }),
      offsetY: -0.72, scaleX: 1.16, scaleY: 0.72,
      ease: "out",
    },
    // The jumper is gone: the body springs back up a little.
    {
      t: 0.14,
      pose: P({
        hip: -3.4, torso: 12, head: 6,
        thighR: 131.8, shinR: 91, footR: -126.8,
        thighL: 140.5, shinL: 85, footL: -129.5,
        upperArmR: 146, forearmR: -20,
        upperArmL: 212, forearmL: -26,
      }),
      offsetY: -0.62, scaleX: 1.09, scaleY: 0.82,
    },
    // Stunned, low, the head hanging: most of the freeze.
    {
      t: 0.6,
      pose: P({
        hip: -3.2, torso: 14, head: 9,
        thighR: 130, shinR: 94, footR: -128,
        thighL: 138.5, shinL: 88, footL: -131,
        upperArmR: 158, forearmR: -10,
        upperArmL: 200, forearmL: -24,
      }),
      offsetY: -0.66, scaleX: 1.1, scaleY: 0.8,
    },
    // Standing up the way `crouchEnd` does: the hips rise out from under a chest
    // still folded over them, the feet kept flat on the way.
    {
      t: 0.8,
      pose: P({
        hip: -2.7, torso: 12, head: -9.8,
        thighR: 146.2, shinR: 62.8, footR: -113.6,
        thighL: 154.6, shinL: 56.1, footL: -115.4,
        upperArmR: 160.4, forearmR: -4.3,
        upperArmL: 197.2, forearmL: -22.8,
      }),
      offsetY: -0.37, scaleX: 1.066, scaleY: 0.868,
    },
    // Up, on idle's mid-breath stance, as `crouchEnd` finishes: idle is next.
    {
      t: 0.93,
      pose: P({
        hip: 0.1, torso: 4.8, head: -4.8,
        thighR: 174, shinR: 8, footR: -88,
        thighL: 182, shinL: 0, footL: -88,
        upperArmR: 164, forearmR: 19,
        upperArmL: 193, forearmL: -18,
      }),
      offsetY: -0.01, scaleX: 1, scaleY: 1,
    },
  ],
};
