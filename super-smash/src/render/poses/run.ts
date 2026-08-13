import { P, type PoseClip } from "./clip";

/**
 * The run — eight drawings, and not one of them is a walk played faster.
 *
 * ## The clock is the ground, not the frame counter
 *
 * `period` below is dead weight: `run` is in `PACED_BY_SPEED`, so `poseTimeFor`
 * asks for `(actionFrame × |vx|) / STRIDE` and the cycle advances with *distance
 * covered*. Fox runs 2.402 units a frame and Kirby 1.727, so the same eight
 * drawings take fifteen frames on Fox and twenty-one on Kirby without either
 * clip knowing whose legs it is on.
 *
 * That is what makes the contact keys worth authoring properly. Because the
 * phase of the cycle is a function of position rather than of time, a foot
 * authored to travel backwards through its stance gives back the same fraction
 * of the body's advance for every fighter on the roster — so a foot that reads
 * as planted on one of them reads as planted on all of them. This one puts its
 * heel down a shade under two units ahead of the fighter's own position and
 * lifts its toe two-thirds of a unit behind it, travelling three and a third
 * units backwards along the floor in between, heel and toe both monotonic.
 *
 * It cannot be *stationary*, and no clip can make it so. `STRIDE` is 36 world
 * units a cycle — eighteen a step — against a leg a little over four units long,
 * because Ultimate's fighters cross several body-lengths a second at a scale
 * where they are a dozen units tall. Four units of leg cannot span an
 * eighteen-unit step, so a stance here can hand back three and a third of the
 * eighteen and no more. What is authorable is that the foot never travels
 * *forward* while it is down, which is the half of the illusion that survives.
 *
 * ## What makes it a run and not a fast walk
 *
 * A run is not defined by cadence — it is defined by the **flight phase**.
 * Walking always has a foot down and has two periods of double support; running
 * replaces those with two periods where neither foot is down, and that is the
 * whole distinction in the gait literature. Keys 3 and 7 are it: the stance foot
 * has toed off and folded away, the swing foot has its knee up and has not
 * arrived, and the lower of the two is a clear unit and a half off the floor.
 * Around them the pelvis falls four-fifths of a unit onto the next contact,
 * which is the other half of the read — vertical travel is three and a half
 * times the walk's, because a walk vaults over a straight leg and a run falls
 * onto a bent one.
 *
 * On top of that: the whole body is pitched forward about the feet by `root`
 * rather than folded at the waist by `torso` alone — the torso capsule is 3.2
 * long and 3.7 thick, so rotating it barely shows — and the shoulder swings
 * through 124° against the walk's 52°, elbows held between 34° and 62° of flex
 * the whole way round. That last bound is Donkey Kong's: his arms are 1.44× the
 * reference rig's and hang past his knees, so a key that lets an elbow open
 * swings a six-unit limb through the stage on him and reads as a normal arm on
 * everyone else.
 *
 * Both forearm angles are negative here, which departs from the rest of the
 * library. Elsewhere `forearmR` is positive and `forearmL` negative — a splay
 * inherited from the rest pose, where it separates the two arms in silhouette.
 * At a walk's ±8° nobody can tell; at this amplitude the positive side is an
 * elbow bending the wrong way, and it drove the near hand backwards past the hip
 * for half the cycle instead of forwards past the chest. Negative on both sides
 * is the direction an elbow actually goes.
 *
 * ## Eight keys, cut linearly
 *
 * Contact, down, toe-off, flight — twice, mirrored. That is the traditional run
 * cycle's drawing count, and at these cadences it lands one drawing every two to
 * three frames, which is the cadence such cycles have always been drawn at.
 *
 * Every span is `linear` rather than the default `smooth`. Smoothstep brings a
 * bone to a *stop* at each key, which is right for a pose that is arrived at and
 * wrong for a cycle: a running thigh is only ever momentarily still at the two
 * ends of its swing, and those are already keys 0 and 3. Easing the other six
 * would put a full stop in the middle of the swing four times a stride.
 *
 * Contacts sit on `t = 0` and `t = 0.5`, which is where `footPlanted` in
 * `vfx.ts` expects them — it puffs dust whenever the clip crosses a half-cycle.
 */
export const run: PoseClip = {
  loop: true,
  // Ignored — see above. Kept because the animation lab falls back to it for a
  // fighter held at zero speed, whose cycle would otherwise have no length.
  period: 20,
  keys: [
    // Contact. Heel down, toe up, knee only 14° bent so the leg has somewhere to
    // give; the other leg is already past it, folded heel-to-hip. The far arm is
    // at its forward extreme, which is the arm that goes with this leg.
    {
      t: 0,
      pose: P({
        root: 7, hip: -6, torso: 17, head: -13,
        thighR: 152, shinR: 14, footR: -98,
        thighL: 183, shinL: 115, footL: -141,
        upperArmR: 216, forearmR: -36,
        upperArmL: 98, forearmL: -62,
      }),
      offsetY: -0.2,
      ease: "linear",
    },
    // Down. The bottom: foot flat and under the hips, knee folded to 49° taking
    // the landing, pelvis a quarter-unit below the contact and squashed a little
    // wider. This is the only key where the rig is shorter than it stands.
    {
      t: 0.125,
      pose: P({
        root: 8, hip: -4, torso: 15, head: -11,
        thighR: 156, shinR: 49, footR: -122,
        thighL: 146, shinL: 108, footL: -128,
        upperArmR: 177, forearmR: -46,
        upperArmL: 131, forearmL: -56,
      }),
      offsetY: -0.34,
      scaleX: 1.02,
      scaleY: 0.98,
      ease: "linear",
    },
    // Toe-off. The knee has straightened back out and the ankle has driven the
    // body up onto the toe — the pelvis is now higher than it is standing still,
    // which is where most of the bob comes from.
    {
      t: 0.25,
      pose: P({
        root: 6, hip: -8, torso: 19, head: -15,
        thighR: 201, shinR: 17, footR: -87,
        thighL: 141, shinL: 72, footL: -111,
        upperArmR: 123, forearmR: -58,
        upperArmL: 187, forearmL: -44,
      }),
      offsetY: 0.26,
      ease: "linear",
    },
    // Flight. Nothing is touching the floor: the near heel has flicked up behind
    // the thigh, the far knee is driving through and its shin has not swung out
    // yet. Top of the arc, stretched, and the drawing that says "run".
    {
      t: 0.375,
      pose: P({
        root: 7, hip: -7, torso: 18, head: -14,
        thighR: 206, shinR: 78, footR: -144,
        thighL: 128, shinL: 60, footL: -104,
        upperArmR: 100, forearmR: -62,
        upperArmL: 222, forearmL: -34,
      }),
      offsetY: 0.52,
      scaleX: 0.98,
      scaleY: 1.02,
      ease: "linear",
    },
    // The same four again with the legs and arms exchanged.
    {
      t: 0.5,
      pose: P({
        root: 7, hip: -6, torso: 17, head: -13,
        thighR: 183, shinR: 115, footR: -141,
        thighL: 152, shinL: 14, footL: -98,
        upperArmR: 98, forearmR: -62,
        upperArmL: 216, forearmL: -36,
      }),
      offsetY: -0.2,
      ease: "linear",
    },
    {
      t: 0.625,
      pose: P({
        root: 8, hip: -4, torso: 15, head: -11,
        thighR: 146, shinR: 108, footR: -128,
        thighL: 156, shinL: 49, footL: -122,
        upperArmR: 131, forearmR: -56,
        upperArmL: 177, forearmL: -46,
      }),
      offsetY: -0.34,
      scaleX: 1.02,
      scaleY: 0.98,
      ease: "linear",
    },
    {
      t: 0.75,
      pose: P({
        root: 6, hip: -8, torso: 19, head: -15,
        thighR: 141, shinR: 72, footR: -111,
        thighL: 201, shinL: 17, footL: -87,
        upperArmR: 187, forearmR: -44,
        upperArmL: 123, forearmL: -58,
      }),
      offsetY: 0.26,
      ease: "linear",
    },
    {
      t: 0.875,
      pose: P({
        root: 7, hip: -7, torso: 18, head: -14,
        thighR: 128, shinR: 60, footR: -104,
        thighL: 206, shinL: 78, footL: -144,
        upperArmR: 222, forearmR: -34,
        upperArmL: 100, forearmL: -62,
      }),
      offsetY: 0.52,
      scaleX: 0.98,
      scaleY: 1.02,
      ease: "linear",
    },
  ],
};
