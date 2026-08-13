import { P, type PoseClip } from "./clip";

/**
 * The walk cycle: contact, pass, contact-mirrored, pass.
 *
 * ## `period: 32` does not time this clip
 *
 * Read this before changing a number. Nothing here is paced in frames.
 * `poseTimeFor` routes `walk` through `PACED_BY_SPEED` and drives it as
 * `(actionFrame × |vx|) / STRIDE`, so clip time is *ground covered*: one cycle
 * is 36 world units for everybody, which comes out at 24 frames on Fox, 27 on
 * Donkey Kong, 32 on Mario and 37 on Kirby. `period` is kept because 36 is
 * Mario's walk speed across it — that is where the constant came from — and
 * because the animation lab falls back to it for a fighter held at zero speed.
 * Editing it changes nothing that anybody sees.
 *
 * ## The stance foot is authored as a position, not as an angle
 *
 * A foot looks planted when it does not move relative to the *ground*, so its
 * backward travel in rig space has to be spent against the body's forward
 * travel — and only a distance-paced cycle makes that trade the same for every
 * fighter, because only then does every fighter's cycle buy the same 36 units.
 * So the legs were solved from ankle targets rather than dialled in as angles.
 * The right ankle strikes 1.60 units ahead of the pelvis, passes 0.37 behind
 * it, and leaves 2.11 behind: 3.71 units swept backwards over the half cycle it
 * is down, at a rate that holds within a sixth of itself until the foot starts
 * rolling onto its toe, and within a quarter counting that.
 *
 * That is nearly the whole excursion available. The leg is 4.1 long and hangs
 * from a pelvis 4.2 up, so a foot at ground level is already a nearly straight
 * leg, and every extra unit of stride has to be bought by dropping the hip.
 * Which is also where the bob comes from, and why it is not a decoration: the
 * knee carries only 14° at the strike and 23° at the pass, and the pelvis
 * *vaults over* that near-straight leg on an arc a shade over four units,
 * sitting lowest when the leg is furthest from vertical (the contacts) and
 * highest when it is under the body (the passes). Inverted
 * pendulum, straight out of the gait literature. `offsetY` is that arc, and it
 * cannot be raised without either shortening the stride or floating the foot.
 *
 * It does not plant the foot completely, and no arrangement of these keys can.
 * 36 units a cycle is 18 a step against a fighter about 12 units tall — three
 * body-heights of ground per two steps, some six times a human's stride for its
 * size, because Smash characters genuinely do move that fast relative to
 * themselves. The 3.71-unit sweep cancels between a sixth and a fifth of it
 * across the roster (Kirby 16%, Mario 17%, DK 19%, Fox 21%). The rest is a
 * slide that lives in `STRIDE` being a flat 36 for a cast whose legs differ by
 * a factor of two, not in the poses — see the note in `timing.ts`.
 *
 * ## Why every span is `linear`
 *
 * Against the `smooth` default, and for the stance foot's sake. Smoothstep
 * brings a limb to a dead stop at each key, which on a two-dozen-frame cycle is
 * a stall every six frames on the one chain that must keep moving backwards at
 * a steady rate or the fighter reads as skating. The cost is that the bob is a
 * triangle rather than a sine; at 0.3 units over six frames that corner is
 * invisible, and a stalling foot is not.
 *
 * ## The shapes
 *
 * Ultimate's walk is a spacing tool, not a way of getting anywhere. It is the
 * movement that keeps tilts and smashes available where a dash does not, it has
 * three speeds off how far the stick is tilted, and a player is walking because
 * they want to shift a foot's worth of distance while staying ready — so it is
 * authored deliberate and upright, a 7° lean and no lope.
 *
 * The feet roll rather than holding one angle: heel strike with the toe 14° up,
 * flat and loaded through midstance, then the heel lifts and the ankle
 * plantarflexes 38° so the last thing on the ground is the toe. One foot is
 * always down — a walk has no flight phase, which is the thing that separates
 * it at a glance from `run` next door — and at the contacts both are, which is
 * the double-support beat. The swing foot passes with its sole eight tenths of
 * a unit clear of the standing one; the version this replaces passed the swing
 * toe *through* the floor, and floated both feet at the contacts besides.
 *
 * Arms counter-swing at ±26° from the shoulder, with the elbow nearly straight
 * on purpose. `forearmR` is positive and `forearmL` negative for the same bend
 * — the library's convention, kept here because `blend.ts` eases `idle` into
 * this clip on every step a player takes and idle bends them ±16 the same way.
 * The catch is that it is not a true mirror: it swings the two elbows to
 * opposite sides of the body, which biases the hands and drifts the moment they
 * cross about 3% of a cycle late. Small elbows keep that under a frame. Fixing
 * it properly means changing the convention across the whole library at once.
 */
export const walk: PoseClip = {
  loop: true,
  period: 32,
  keys: [
    // Contact, and the bottom of the bob. Right heel down and forward with the
    // toe still up, left up on its toe behind: both feet on the ground.
    {
      t: 0,
      ease: "linear",
      pose: P({
        torso: 7,
        head: -6,
        thighR: 150, shinR: 14, footR: -88,
        thighL: 193, shinL: 42, footL: -107,
        upperArmR: 206, forearmR: 8,
        upperArmL: 154, forearmL: -8,
      }),
      offsetY: -0.3,
    },
    // Pass, and the top of it. Right leg carrying and nearly straight, left
    // knee crossing it with the foot lifted clear.
    {
      t: 0.25,
      ease: "linear",
      pose: P({
        torso: 6,
        head: -5,
        thighR: 174, shinR: 23, footR: -106,
        thighL: 148, shinL: 78, footL: -142,
        upperArmR: 180, forearmR: 8,
        upperArmL: 180, forearmL: -8,
      }),
      offsetY: 0,
    },
    {
      t: 0.5,
      ease: "linear",
      pose: P({
        torso: 7,
        head: -6,
        thighR: 193, shinR: 42, footR: -107,
        thighL: 150, shinL: 14, footL: -88,
        upperArmR: 154, forearmR: 8,
        upperArmL: 206, forearmL: -8,
      }),
      offsetY: -0.3,
    },
    {
      t: 0.75,
      ease: "linear",
      pose: P({
        torso: 6,
        head: -5,
        thighR: 148, shinR: 78, footR: -142,
        thighL: 174, shinL: 23, footL: -106,
        upperArmR: 180, forearmR: 8,
        upperArmL: 180, forearmL: -8,
      }),
      offsetY: 0,
    },
  ],
};
