import { P, type PoseClip } from "./clip";

/**
 * The first jump, from the frame the three-frame jumpsquat releases.
 *
 * Ultimate front-loads a full hop: SmashWiki's jump article calls it "jump
 * initial height" — the first four frames climb at roughly 1.5-3x the speed the
 * rest of the rise gets, and short hops and air jumps get none of it. So the
 * whole extension is spent by t=0.15 and the remaining five sixths are a coast.
 * That is also the only honest way to author this. `jump` has no fixed length,
 * so `poseTimeFor` runs the clip over thirty frames and then holds; how much of
 * it a fighter actually sees is `fullHopVelocity / gravity`, which is eighteen
 * frames for Fox and thirty-one for Samus.
 *
 * The arms scissor rather than reach: the near one drives up in front, the far
 * one keeps going the way the jumpsquat had already swept it, back and over.
 * Both arms straight overhead is the more obvious drawing and it does not work
 * on this rig — an arm is 4.35 units from a shoulder 8.5 up, and Mario's crown
 * is at 13.6, so the hands physically cannot clear the head and instead sit on
 * the face as two circles the size of it.
 *
 * The coast is `linear` rather than eased. A smoothstep over seventeen frames
 * spends the last ten of them under half a degree a frame, and the rise turns
 * back into the frozen photograph it used to be.
 *
 * The last key *is* `fall`'s opening drawing. The rise cuts to `fall` the frame
 * vertical speed crosses zero and nothing blends the two clips, so the coast is
 * shaped to arrive there rather than to be a nice drawing in its own right.
 */
export const rise: PoseClip = {
  loop: false,
  keys: [
    // The frame after the unload, and picked up from it: `jumpSquat`'s last key
    // is already opening the legs, already stretched to 1.16 and already has the
    // arms scissoring, so this carries all three on rather than restating them.
    // `out`, because the jumpsquat has just held one shape for three frames and
    // a second held shape on top of it would kill the launch.
    {
      t: 0,
      pose: P({
        torso: 10, head: -8,
        thighR: 166, shinR: 20, footR: -70,
        thighL: 176, shinL: 16, footL: -74,
        upperArmR: 118, forearmR: -22,
        upperArmL: 228, forearmL: 26,
      }),
      offsetY: 0.45,
      scaleX: 0.90,
      scaleY: 1.16,
      ease: "out",
    },
    // Full extension: toes pointed, near arm raised and bent, trailing arm swept
    // back and over. The tallest the fighter gets all jump — the ankles finish
    // extending after the feet have left the floor, which is the only reason the
    // peak is here and not on the jumpsquat's own last drawing.
    {
      t: 0.15,
      pose: P({
        torso: 0, head: 3,
        thighR: 172, shinR: 6, footR: -30,
        thighL: 190, shinL: 2, footL: -34,
        upperArmR: 46, forearmR: 24,
        upperArmL: 292, forearmL: 16,
      }),
      offsetY: 0.95,
      scaleX: 0.87,
      scaleY: 1.18,
      ease: "linear",
    },
    // The burst is over and the body stops fighting the climb.
    {
      t: 0.42,
      pose: P({
        torso: -3, head: 5,
        thighR: 164, shinR: 26, footR: -56,
        thighL: 202, shinL: 12, footL: -66,
        upperArmR: 70, forearmR: 2,
        upperArmL: 280, forearmL: 18,
      }),
      offsetY: 0.5,
      scaleX: 0.96,
      scaleY: 1.08,
      ease: "linear",
    },
    // `fall`'s opening drawing, to the degree. Which frame of the coast the
    // handover lands on is `fullHopVelocity / gravity` and differs across the
    // cast by thirteen frames, so the tail converges on that shape instead of
    // meeting it at one point: the worst crossover in the roster is Fox's, at
    // t=0.6, and even there no bone is more than a dozen degrees out.
    {
      t: 1,
      pose: P({
        torso: 0, head: 2,
        thighR: 160, shinR: 34, footR: -72,
        thighL: 198, shinL: 28, footL: -80,
        upperArmR: 88, forearmR: -6,
        upperArmL: 274, forearmL: 10,
      }),
      offsetY: 0.3,
      scaleX: 0.97,
      scaleY: 1.05,
    },
  ],
};

/**
 * The second jump: a forward somersault.
 *
 * SmashWiki's midair jump article splits the cast three ways — most twist or
 * flip, a few inflate (Kirby, Jigglypuff, Dedede) and the winged ones flap. A
 * flip is the one that survives being shared by eight rigs, and it is the only
 * one the spin channel can say: keyframe rotation interpolates the short way
 * round, so a whole turn has to be declared as `spin` and integrated over clip
 * time instead.
 *
 * The tuck borrows `roll`'s geometry — hip rolled back, knees to the chest,
 * hands at the shins, and a *uniform* shrink. Uniform matters twice: it is the
 * only squash that survives being rotated (`resolve` applies scale in screen
 * axes, after the spin), and a curled body that does not also get smaller reads
 * as a fighter bending over rather than balling up.
 *
 * That ball is then held from t=0.17 to t=0.62 and the kick-out is crammed into
 * the last third, because the spin is integrated linearly over clip time and
 * gets cut off the frame the fighter stops rising. Fox's air jump is eighteen
 * frames and reaches only three fifths of the revolution before `fall` takes
 * over; a ball reads at any angle and a figure with its legs out does not, so
 * the legs stay in until the turn is nearly finished.
 *
 * The arms and torso start where `fall` leaves them and the legs go first,
 * because an air jump is taken out of a fall or out of a rise and never off the
 * ground. There is no jumpsquat to snap out of, so the initiation has to come
 * from the knees; the far arm stays looser than the near one through the tuck,
 * which both keeps the entry frame off the 45-degrees-a-frame ceiling and reads
 * as an arm on the other side of the body rather than a mirror of this one.
 */
export const doubleJump: PoseClip = {
  loop: false,
  spin: 1,
  keys: [
    // The kick-over: near knee drives up, far leg trails, arms fold in from
    // wherever the fall had them.
    {
      t: 0,
      pose: P({
        torso: 14, head: -16, hip: -4,
        thighR: 132, shinR: 46, footR: -60,
        thighL: 174, shinL: 36, footL: -68,
        upperArmR: 128, forearmR: -44,
        upperArmL: 224, forearmL: 22,
      }),
      offsetY: 0.35,
      scaleX: 0.96,
      scaleY: 1.04,
      ease: "out",
    },
    {
      t: 0.17,
      pose: P({
        torso: 34, head: -30, hip: -12,
        thighR: 102, shinR: 116, footR: -58,
        thighL: 110, shinL: 110, footL: -54,
        upperArmR: 96, forearmR: -102,
        upperArmL: 150, forearmL: -60,
      }),
      offsetY: -0.4,
      scaleX: 0.92,
      scaleY: 0.92,
    },
    // Held for half the clip. The ball barely changes and the spin turns it, so
    // the eye reads a somersault and not a fighter waving their legs about.
    {
      t: 0.62,
      pose: P({
        torso: 30, head: -26, hip: -10,
        thighR: 110, shinR: 108, footR: -60,
        thighL: 118, shinL: 102, footL: -56,
        upperArmR: 104, forearmR: -96,
        upperArmL: 156, forearmL: -56,
      }),
      offsetY: -0.3,
      scaleX: 0.94,
      scaleY: 0.94,
    },
    // The kick-out, at about three quarters of a turn: legs snap long, arms
    // fling apart. This is the frame that says the flip is over.
    {
      t: 0.86,
      pose: P({
        torso: -8, head: 10,
        thighR: 176, shinR: 8, footR: -46,
        thighL: 194, shinL: 6, footL: -52,
        upperArmR: 56, forearmR: -12,
        upperArmL: 306, forearmL: 12,
      }),
      offsetY: 0.3,
    },
    {
      t: 1,
      pose: P({
        torso: 0, head: 2,
        thighR: 160, shinR: 34, footR: -72,
        thighL: 198, shinL: 28, footL: -80,
        upperArmR: 88, forearmR: -6,
        upperArmL: 274, forearmL: 10,
      }),
      offsetY: 0.3,
      scaleX: 0.97,
      scaleY: 1.05,
    },
  ],
};
