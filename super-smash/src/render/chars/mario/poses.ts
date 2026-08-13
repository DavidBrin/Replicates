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
 * The stand.
 *
 * The pose a player looks at more than any other, and until now Mario borrowed
 * the roster's shared one. The shared clip is a good breath cycle and a bad
 * Mario, and the reference says why: **Mario does not stand, he guards.**
 *
 * Measured off SmashWiki's own in-game idle capture (600×338, standing height
 * 260 px, so everything below is quoted as a fraction of his height and then
 * multiplied by the 11 units he is here):
 *
 * | What | Reference | Here |
 * |---|---|---|
 * | Hands | closed fists **in front of the chest**, 0.54 H | wrist 0.8 below the shoulder, 1.9 forward → 6.7 units |
 * | Elbows | flexed 80–100°, held close in | `forearm ≈ −124` off an upper arm hanging 5° back |
 * | Feet | staggered, outer edges 0.43 H apart | thighs ±26°, ankles ≈ 3.1 units apart |
 * | Knees | flexed even at his tallest | never straighter than 14° |
 * | Bob | whole upper body, ~0.11 H, feet planted | ≈ 0.085 H — see below |
 * | Head | tilts down at the bottom of the bob, level at the top | −4° to −8° |
 *
 * The elbow angle is chosen so the *forearm* is the readable part. The near
 * upper arm is `primary` red over a `primary` red torso and the rim pass only
 * outlines the figure's outside edge, so an upper arm lying against the chest
 * is not drawn at all — the first version of this guard was measured by a
 * critic as "arms hanging straight down, no elbow flex, no forearm", because
 * everything above the wrist was invisible. Hanging the upper arm nearly
 * vertical and taking the whole 124° of bend at the elbow puts the bare
 * skin-coloured forearm diagonally across the blue bib, where it is the one
 * limb segment on this fighter that always has contrast behind it.
 *
 * The fists are the whole point. Mario's three colours are red, blue and
 * white, and with the arms hanging the white is two gloves buried against the
 * dungarees — the silhouette is a red-and-blue column with a face on top.
 * Brought up into the guard they are two round white blobs at chest height
 * clear of the body, which is both what the reference shows and the single
 * biggest thing this clip does. The reference is emphatic that this is *not*
 * Link's or Falcon's wide braced stance: Mario is compact and upright with his
 * hands in close, bouncing on his toes rather than crouching to lunge.
 *
 * **The bob is `scaleY`, not `offsetY`, and that is forced.** The reference
 * measures cap and chest moving the same 28 px — a translation of the whole
 * upper body driven by knee flexion with the feet planted. Here the pelvis
 * sits at a fixed 3.6 units up the `root` strut whatever the legs do, so
 * folding them lowers nothing; only `offsetY` does, and `offsetY` takes the
 * feet with it. Buying 1.2 units of drop back by folding needs the thigh 50°
 * forward and the shin 30° back, which drags the ankle two thirds of a unit
 * across the stage every cycle. A skating foot is far more visible than a
 * shallow bounce, so `offsetY` is held all but constant (the four keys vary by
 * two hundredths of a unit, and the leg angles are chosen so that all four put
 * both ankles at the same height) and the cycle is carried by `scaleY`
 * 0.958 → 1.036, which stretches about the *feet* and so cannot lift them.
 *
 * That buys 1.07 units at the head — about 8.5% of his drawn height against
 * the reference's 11% — and costs a 5.6% squash on the head at the bottom of
 * the bounce, which reads as ordinary squash-and-stretch rather than as
 * deformation. The four `offsetY` values differ by two hundredths of a unit and
 * exist only to make the leg angles' own arithmetic come out level. What it does not
 * reproduce is the reference's *equal* cap and chest travel: under `scaleY` the
 * chest moves about half as far as the cap. That is the honest limit of a rig
 * whose pelvis height is a constant.
 *
 * `period` is 26. The reference derives ~24 frames from a 2-second capture
 * holding five cycles, and flags it as reasoned rather than measured; 26 keeps
 * the pace and stays off a round number so his cycle and everybody else's
 * drift apart on screen.
 *
 * The *rhythm* is inherited from the shared clip and deliberately not
 * reinvented, because its reasoning is right and dearly bought: nothing turns
 * round at the same instant as anything else, the key times are uneven so
 * there is no countable beat, and only one span is eased — smoothstep
 * everywhere brings the whole body to a halt four times a cycle, which is a
 * worse metronome than two keys.
 */
const idle: PoseClip = {
  loop: true,
  period: 26,
  keys: [
    {
      // Bottom of the bounce: knees at their deepest, chest hunched forward,
      // head tipped down, fists at their lowest. The body leaves here slowly —
      // this is the span the one ease is spent on.
      t: 0,
      pose: P({
        hip: 1.0, torso: 8.5, head: -8.0,
        thighL: 211.0, shinL: -12.0, footL: -78,
        thighR: 147.0, shinR: 12.0, footR: -98,
        upperArmL: 166.5, forearmL: -122.0,
        upperArmR: 175.5, forearmR: -126.0,
      }),
      offsetY: -0.464,
      scaleY: 0.944,
    },
    {
      // Top of the bounce at 38%. Legs at their straightest — still 26° of
      // splay and a few of knee, because the reference has him flexed even at
      // his tallest.
      t: 0.38,
      pose: P({
        hip: 0.0, torso: 4.0, head: -4.0,
        thighL: 206.0, shinL: 0.0, footL: -82,
        thighR: 154.0, shinR: 0.0, footR: -94,
        upperArmL: 172.0, forearmL: -124.0,
        upperArmR: 181.0, forearmR: -122.0,
      }),
      offsetY: -0.443,
      scaleY: 1.048,
      ease: "linear",
    },
    {
      // The head arrives late — still coming up as the body starts down, which
      // is the whole of what "the head has its own rhythm" amounts to. The near
      // fist is at the back of its own small drift here and the far one is not,
      // because nothing synchronises a standing person's arms.
      t: 0.62,
      pose: P({
        hip: -0.7, torso: 5.2, head: -6.6,
        thighL: 209.7, shinL: -6.0, footL: -80,
        thighR: 151.7, shinR: 6.0, footR: -96,
        upperArmL: 175.5, forearmL: -127.0,
        upperArmR: 177.5, forearmR: -119.0,
      }),
      offsetY: -0.449,
      scaleY: 1.016,
      ease: "linear",
    },
    {
      // A hair above the bottom, so the last span is a small recovery into the
      // settle rather than a fourth extreme.
      t: 0.82,
      pose: P({
        hip: 0.4, torso: 7.6, head: -7.0,
        thighL: 210.1, shinL: -9.0, footL: -79,
        thighR: 149.1, shinR: 9.0, footR: -97,
        upperArmL: 169.0, forearmL: -120.0,
        upperArmR: 179.0, forearmR: -128.0,
      }),
      offsetY: -0.456,
      scaleY: 0.958,
      ease: "linear",
    },
  ],
};

/**
 * Forward smash: the fire palm.
 *
 * The shared clip is a straight punch, and a punch is the one thing this is
 * not — the damage comes off an *open palm* thrust with a blast of fire on it,
 * which is why the far hitbox is a radius-5 sphere centred 8.6 units in front
 * of him and the near one, the forearm, is the weaker half.
 *
 * Frame-stepping the real animation changed three things round one had by
 * guesswork:
 *
 * **The wind-up leans away.** From about frame 7 he pitches his upper body
 * *backwards* and picks the front foot off the floor — this is the "deceptively
 * far" hurtbox retreat, and it is why the charge is safe to hold. Round one
 * coiled him over the rear foot without lifting anything, which reads as
 * crouching rather than as withdrawing.
 *
 * **The lunge is deep and it is low.** On frame 15 the front leg shoots out and
 * plants, the rear leg goes dead straight with the heel up, and his head ends
 * up *below* where it was at frame 13. Round one's contact key was 0.7 units
 * down; it is 1.6 now, with the legs 70° apart, and the difference is the
 * whole difference between a shove and a lunge.
 *
 * **The off hand stays home.** It is a closed fist tucked at the chest through
 * the entire thrust, not flung back as a counterweight. Round one had it at
 * 262° accumulated — straight out behind him — which is a boxer's cross, a
 * different move.
 *
 * The reference does the thrust on his far arm and this does it on the near
 * one, deliberately: far-side limbs are drawn behind the torso and shaded, so
 * the one shape the whole move is about would be the dimmest thing on screen
 * and half-buried. The near arm is the same gesture where a side-on camera can
 * see it.
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
      // Already a wound guard rather than a standing pose. `ease` here is
      // `linear`, not `in`: a cubic on this span holds him at the first key for
      // most of it, and with the first key sitting a couple of degrees off the
      // idle a critic timed the first *nine* of fifteen startup frames as
      // visually identical to standing still. A smash with no telegraph is not
      // just ugly, it is unreactable.
      t: 0,
      pose: P({
        torso: -18, head: 14, hip: 8,
        thighR: 150, shinR: 46, footR: -84,
        thighL: 208, shinL: 26, footL: -76,
        upperArmR: 190, forearmR: -122,
        upperArmL: 198, forearmL: -118,
      }),
      offsetX: -0.55,
      offsetY: -0.45,
      ease: "linear",
    },
    // The charge, at strike × 0.55: leaning away with the front foot off the
    // floor, both fists up in the guard, weight entirely on the back leg. The
    // hurtbox goes with him, which is the point of the pose.
    {
      t: 0.165,
      pose: P({
        torso: -30, head: 22, hip: 12,
        thighR: 122, shinR: 76, footR: -60,
        thighL: 214, shinL: 22, footL: -74,
        upperArmR: 214, forearmR: -96, handR: -14,
        upperArmL: 220, forearmL: -92,
      }),
      offsetX: -0.85,
      offsetY: -0.55,
      ease: "in",
    },
    // Contact, frame 15. The palm accumulated −8 + 26 + 78 = 96: just under
    // level, out from the shoulder at chest height, which is where the fire is
    // and which keeps the glove clear of his own nose. Front leg
    // planted 60° forward, rear leg straight back with the heel up, head lower
    // than it was two frames ago. Off fist closed at the chest.
    {
      t: 0.3,
      pose: P({
        torso: 26, head: -18, hip: -8,
        thighR: 118, shinR: 22, footR: -96,
        thighL: 240, shinL: 8, footL: -44,
        upperArmR: 78, forearmR: 4, handR: 0,
        upperArmL: 178, forearmL: -104,
      }),
      offsetX: 1.35,
      offsetY: -1.6,
      scaleX: 1.2,
      ease: "hold",
    },
    // Frame 17, the last live frame. Held: the palm has not moved, the weight
    // has finished arriving behind it.
    {
      t: 0.342,
      pose: P({
        torso: 24, head: -16, hip: -8,
        thighR: 118, shinR: 22, footR: -96,
        thighL: 240, shinL: 8, footL: -44,
        upperArmR: 80, forearmR: 4, handR: 0,
        upperArmL: 176, forearmL: -102,
      }),
      offsetX: 1.4,
      offsetY: -1.62,
      scaleX: 1.19,
      ease: "out",
    },
    // He sits in the lunge for another four frames — the reference has him
    // still down there at 21 and only rising from about 28 — so the palm and
    // the legs barely move and it is the shoulders that start to come back.
    {
      t: 0.44,
      pose: P({
        torso: 18, head: -12, hip: -6,
        thighR: 122, shinR: 26, footR: -94,
        thighL: 234, shinL: 12, footL: -50,
        upperArmR: 76, forearmR: 6,
        upperArmL: 176, forearmL: -98,
      }),
      offsetX: 1.25,
      offsetY: -1.5,
      scaleX: 1.16,
    },
    {
      t: 0.68,
      pose: P({
        torso: 8, head: -2,
        thighR: 138, shinR: 34, footR: -90,
        thighL: 216, shinL: 22, footL: -68,
        upperArmR: 120, forearmR: -40,
        upperArmL: 190, forearmL: -96,
      }),
      offsetX: 0.6,
      offsetY: -0.8,
    },
    {
      t: 0.88,
      pose: P({
        torso: 6,
        thighR: 150, shinR: 30, footR: -88,
        thighL: 206, shinL: 24, footL: -78,
        upperArmR: 178, forearmR: -86,
        upperArmL: 198, forearmL: -94,
      }),
      offsetX: 0.2,
      offsetY: -0.4,
    },
    { t: 1, pose: P({ torso: 5, upperArmR: 196, forearmR: -100, upperArmL: 202, forearmL: -98 }) },
  ],
};

/**
 * Up smash: the headbutt.
 *
 * Not a two-handed lift, which is what the shared clip is — and not the small
 * backward lean round one settled for either. Frame-stepping the real
 * animation shows how far the head actually travels, and it is the whole move:
 *
 * - **frames 5–8** he is folded almost double, backside up, with his head
 *   dropped *down and behind him* to about knee height — the cap is nearly on
 *   the floor at his heels — legs straddled wide and planted, one fist cocked
 *   high and forward, the other hand low near the head.
 * - **frames 9–12** the crown whips up and over in one arc, back to front, and
 *   the body extends onto the toes underneath it. The hitbox rides the `head`
 *   bone offset 2.5 units *forward* of its centre, so what makes contact is the
 *   forehead at the top of that arc.
 * - **frames 13–17** he has *overswung*: pitched forward with his head down in
 *   front and the arms counter-swung, one fist behind the shoulder.
 *
 * So the accumulated head angle runs −130° → +20° → +55° → +105°: a 235° sweep
 * where round one moved it 32° and read, correctly, as a man leaning back.
 * `head` carries the cap, the nose and the face, so all of that goes round with
 * it, which is what the original does too.
 *
 * The fold is expressed at the neck and the waist rather than with `rotation`,
 * because the feet stay planted and straddled the whole time and rotating the
 * body about the pelvis would take the legs with it.
 */
const usmash: PoseClip = {
  loop: false,
  strike: 0.3,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 16, head: -10, hip: -6,
        thighR: 138, shinR: 74, footR: -86,
        thighL: 218, shinL: 62, footL: -80,
        upperArmR: 176, forearmR: -70,
        upperArmL: 190, forearmL: -66,
      }),
      offsetY: -1.1,
      ease: "in",
    },
    // Folded over, frames 5–8 — the shape `poseTimeFor` holds the charge on.
    // Chest accumulated −105 and the head another 25 past it, so the crown is
    // behind his heels at about knee height. Legs straddled 30° either way and
    // flat on the floor. Near fist cocked high and forward; far hand low.
    {
      t: 0.165,
      pose: P({
        torso: -96, head: -22, hip: 0,
        thighR: 150, shinR: 4, footR: -100,
        thighL: 210, shinL: -4, footL: -76,
        upperArmR: 132, forearmR: -15,
        upperArmL: 292, forearmL: 4,
      }),
      offsetY: 0.55,
      offsetX: 0.2,
      ease: "in",
    },
    // Contact, frame 9. Head accumulated 4 − 18 + 34 = 20: up and just forward
    // of vertical, which with the hitbox's own 2.5-unit forward offset puts the
    // forehead exactly where the sphere is. On the toes, arms counter-swung
    // down and back clear of the body.
    {
      t: 0.3,
      pose: P({
        torso: -18, head: 34, hip: 4,
        thighR: 172, shinR: 6, footR: -60,
        thighL: 190, shinL: 6, footL: -64,
        upperArmR: 254, forearmR: 16,
        upperArmL: 260, forearmL: -12,
      }),
      offsetY: 0.75,
      scaleY: 1.2,
      scaleX: 0.88,
      ease: "hold",
    },
    // Frame 12, the last live frame. The head has carried another 35° over the
    // top rather than stopping dead at the contact — the arc keeps going, which
    // is what makes it a swing and not a pose.
    {
      t: 0.368,
      pose: P({
        torso: 0, head: 55, hip: 0,
        thighR: 168, shinR: 10, footR: -66,
        thighL: 194, shinL: 10, footL: -70,
        upperArmR: 246, forearmR: 14,
        upperArmL: 254, forearmL: -10,
      }),
      offsetY: 0.55,
      scaleY: 1.16,
      scaleX: 0.9,
      ease: "out",
    },
    // Frames 13–17: overswung. Pitched forward, head down in front, near fist
    // thrown back behind the shoulder.
    {
      t: 0.5,
      pose: P({
        torso: 42, head: 63, hip: -8,
        thighR: 146, shinR: 40, footR: -84,
        thighL: 208, shinL: 34, footL: -78,
        upperArmR: 268, forearmR: 20,
        upperArmL: 116, forearmL: -30,
      }),
      offsetY: -0.9,
      scaleX: 1.06,
    },
    {
      t: 0.72,
      pose: P({
        torso: 34, head: 20,
        thighR: 144, shinR: 56, footR: -84,
        thighL: 210, shinL: 48, footL: -80,
        upperArmR: 214, forearmR: -20,
        upperArmL: 168, forearmL: -50,
      }),
      offsetY: -1.05,
    },
    { t: 0.9, pose: P({ torso: 14, head: -4, upperArmR: 200, forearmR: -70, upperArmL: 196, forearmL: -78 }), offsetY: -0.6 },
    { t: 1, pose: P({ torso: 8, head: -6, upperArmR: 200, forearmR: -100, upperArmL: 202, forearmL: -98 }) },
  ],
};

/**
 * Down smash: the breakdance sweep.
 *
 * Two contacts, nine frames apart, on opposite sides — front on frame 5, back
 * on frame 14, and the back one hits harder. Round one read that as two
 * separate kicks from a crouch. Frame-stepping the original shows it is one
 * continuous rotation with his body **flat along the floor the whole time**:
 *
 * - **frame 5**: down on *one* planted hand, palm flat, torso horizontal a
 *   hand's width off the ground, head low and *behind* him next to that hand,
 *   both legs shot straight out **in front** along the floor.
 * - **frames 7–13**: he rolls over the planted hand, legs lifting and coming
 *   round.
 * - **frame 14**: the exact mirror — head low and in *front*, legs swept low
 *   **behind**, the supporting hand now under his chest.
 *
 * So the two hits are the two ends of one turn, not two swings, and the shape
 * is horizontal rather than crouched. `rotation` does that: laying the body
 * −77° at the first contact and +89° at the second puts the head at floor
 * height at either end with the legs out along the ground, and posing an
 * ordinary straight body inside that frame is far easier to get right than
 * fighting sixteen bone angles into a horizontal line.
 *
 * The half-turn between them goes through upright rather than through
 * inverted, which is the compromise this rig forces: laid out, his head is 5.5
 * units from the pelvis and his arms are 4.35, so a genuine handstand puts his
 * cap through the stage. Passing through upright would read as standing up,
 * which is the one thing it must not do — so the midpoint carries
 * `scaleY: 0.62`, squashing him into a ball rolling across his own hands
 * instead of a man standing between two kicks.
 *
 * `offsetY: −1.5` is what puts him on the floor rather than in the air: the
 * pelvis sits at a fixed 3.6 units up the `root` strut whatever the legs do, so
 * folding them lowers nothing. That drops the pelvis to 2.1 units, which lays
 * the legs along the ground where the hitboxes are (y 3.6 in the original's
 * units, a shade under two here) and still leaves the head and the supporting
 * glove above the stage. It was 0.5 lower for a round, and a critic measured
 * the glove seventeen percent of his own height underground: the arm reaches
 * 4.35 units and, laid out, the shoulder is barely two above the floor, so the
 * supporting elbow has to be *bent* rather than hanging straight down. That is
 * what the 300/16 is.
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
        upperArmR: 168, forearmR: -60,
        upperArmL: 174, forearmL: -56,
      }),
      offsetY: -1.3,
      ease: "in",
    },
    // Front sweep, frame 5. Body laid back 86° so the head is at floor height
    // behind him; legs at 176/180 in the body frame, which after the rotation
    // is dead level along the ground in front — where the two spheres at
    // (12.5, 3.6) and (7.0, 3.6) are. Near arm at 266 accumulated, i.e.
    // straight down in world space: the planted hand.
    {
      t: 0.18,
      pose: P({
        torso: 0, head: 8,
        thighR: 176, shinR: 4, footR: -96,
        thighL: 182, shinL: -2, footL: -84,
        upperArmR: 300, forearmR: 16,
        upperArmL: 326, forearmL: -20,
      }),
      rotation: -1.35,
      offsetY: -1.5,
      offsetX: -0.4,
      ease: "hold",
    },
    {
      t: 0.201,
      pose: P({
        torso: 0, head: 8,
        thighR: 176, shinR: 4, footR: -96,
        thighL: 182, shinL: -2, footL: -84,
        upperArmR: 300, forearmR: 16,
        upperArmL: 326, forearmL: -20,
      }),
      rotation: -1.35,
      offsetY: -1.5,
      offsetX: -0.4,
      ease: "in",
    },
    // Over the top of the roll, frame 9. Knees tucked to the chest, both hands
    // down, and squashed to 62% so he passes across his own hands as a ball
    // rather than briefly standing up between the two hits.
    {
      t: 0.285,
      pose: P({
        torso: 10, head: -8,
        thighR: 118, shinR: 128, footR: -70,
        thighL: 126, shinL: 124, footL: -68,
        upperArmR: 214, forearmR: -30,
        upperArmL: 220, forearmL: -26,
      }),
      rotation: 0.1,
      offsetY: -2.0,
      scaleY: 0.62,
      scaleX: 1.14,
      ease: "in",
    },
    // Back sweep, frame 14, the harder half. The mirror of frame 5: laid the
    // other way at +96°, head low and in front, legs level along the ground
    // behind, supporting hand under the chest.
    {
      t: 0.369,
      pose: P({
        torso: 0, head: -8,
        thighR: 180, shinR: 0, footR: -84,
        thighL: 186, shinL: -4, footL: -96,
        upperArmR: 60, forearmR: -16,
        upperArmL: 34, forearmL: 20,
      }),
      rotation: 1.55,
      offsetY: -1.5,
      offsetX: 0.4,
      ease: "hold",
    },
    {
      t: 0.392,
      pose: P({
        torso: 0, head: -8,
        thighR: 180, shinR: 0, footR: -84,
        thighL: 186, shinL: -4, footL: -96,
        upperArmR: 60, forearmR: -16,
        upperArmL: 34, forearmL: 20,
      }),
      rotation: 1.55,
      offsetY: -1.5,
      offsetX: 0.4,
      ease: "out",
    },
    // He does not stand up on the frame the hitbox ends — the original is still
    // down on all fours at 42, one frame before it is actionable — so the tail
    // comes up through a low four-point crouch rather than snapping to idle.
    {
      t: 0.6,
      pose: P({
        torso: 34, head: -26,
        thighR: 124, shinR: 116, footR: -74,
        thighL: 132, shinL: 112, footL: -72,
        upperArmR: 148, forearmR: -22,
        upperArmL: 156, forearmL: -18,
      }),
      rotation: 0.5,
      offsetY: -2.1,
    },
    {
      t: 0.8,
      pose: P({
        torso: 30, head: -22,
        thighR: 130, shinR: 104, footR: -76,
        thighL: 138, shinL: 100, footL: -74,
        upperArmR: 160, forearmR: -46,
        upperArmL: 168, forearmL: -42,
      }),
      rotation: 0.24,
      offsetY: -1.8,
    },
    { t: 0.93, pose: P({ torso: 18, thighR: 142, shinR: 72, thighL: 198, shinL: 60 }), offsetY: -1.0 },
    { t: 1, pose: P({ torso: 10, thighR: 150, shinR: 46, thighL: 202, shinL: 38 }), offsetY: -0.5 },
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
 * below is literally the fraction of 49 frames it happens at. `spawnFrame` is
 * compared against `moveFrameOf(actionFrame)`, so the ball appears on
 * actionFrame 16, i.e. t = 16/49 = 0.327 — not 17/49 — and that is where the
 * hand has to be open and forward.
 *
 * **It is not an underarm toss.** Round one authored it as one, reasoning back
 * from the fact that the fireball bounces along the ground. That reasoning is
 * wrong twice over: the ball leaves at *chest-to-shoulder height* — measured
 * at about 65% of his standing height off the official screenshot, and the
 * projectile's own spawn offset here is (5.2, 6.4) — and it bounces because it
 * launches 10° *downward* under gravity, not because it was rolled.
 *
 * What the animation actually is, from the official 1080p screenshot, Ultimate
 * Frame Data's pose render and the in-game capture stepped frame by frame:
 *
 * - **wind-up**: both fists come up near the chest and chin, elbows tucked —
 *   the same boxing guard he idles in, wound harder: higher fists, shoulders
 *   turned further away and the weight further back, because the idle *is*
 *   that guard and a wind-up that only differs from standing still by a couple
 *   of degrees is a move with no telegraph.
 * - **release**: he sinks into a **deep forward lunge**, front foot planted
 *   well forward with the knee bent, rear leg straight back with the heel
 *   lifted, torso pitched 20–30° over it.
 * - the throwing arm comes forward and slightly **up**, ending **open-palmed
 *   beside his own face** at chin-to-eye height. The elbow stays bent; it is a
 *   short compact shove, not a full extension.
 * - the **off hand is flung back and up behind him**, open, as the
 *   counterweight to the lunge.
 *
 * That last pair is what makes the silhouette read at a glance: one hand
 * forward high, one hand back high, and the body driving through underneath.
 */
const neutralB: PoseClip = {
  loop: false,
  strike: 0.327,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 4, head: -4,
        thighR: 158, shinR: 4, footR: -92,
        thighL: 202, shinL: -2, footL: -84,
        upperArmR: 200, forearmR: -108,
        upperArmL: 204, forearmL: -104,
      }),
      ease: "in",
    },
    // Guard. Both fists up at the chin, elbows in, weight settling onto the
    // back foot — wound, but not yet committed to anything.
    {
      t: 0.2,
      pose: P({
        torso: -20, head: 18, hip: 8,
        thighR: 172, shinR: 26, footR: -84,
        thighL: 212, shinL: 16, footL: -74,
        upperArmR: 224, forearmR: -128, handR: -16,
        upperArmL: 228, forearmL: -122,
      }),
      offsetX: -0.75,
      offsetY: -0.55,
      ease: "hold",
    },
    {
      t: 0.26,
      pose: P({
        torso: -20, head: 18, hip: 8,
        thighR: 172, shinR: 26, footR: -84,
        thighL: 212, shinL: 16, footL: -74,
        upperArmR: 224, forearmR: -128, handR: -16,
        upperArmL: 228, forearmL: -122,
      }),
      offsetX: -0.75,
      offsetY: -0.55,
      ease: "in",
    },
    // Release, actionFrame 16. Palm accumulated 22 + 18 + 55 = 95 at the wrist
    // with the elbow still bent: an open hand out beside his face, 3.6 units
    // forward of the shoulder and a shade above it, which is where the
    // projectile's (5.2, 6.4) spawn is. Off hand flung back and up. Deep lunge
    // under both, rear heel lifted.
    {
      t: 0.327,
      pose: P({
        torso: 22, head: -12, hip: -6,
        thighR: 124, shinR: 22, footR: -94,
        thighL: 236, shinL: 8, footL: -46,
        upperArmR: 64, forearmR: 38, handR: 14,
        upperArmL: 268, forearmL: 30,
      }),
      offsetX: 0.9,
      offsetY: -1.15,
      scaleX: 1.1,
      ease: "hold",
    },
    // Frames 17–21. A degree of settle and nothing else: the release reads as
    // *held* for its five frames, which is what the original does.
    {
      t: 0.42,
      pose: P({
        torso: 20, head: -10, hip: -5,
        thighR: 126, shinR: 22, footR: -94,
        thighL: 234, shinL: 9, footL: -48,
        upperArmR: 66, forearmR: 36, handR: 11,
        upperArmL: 264, forearmL: 28,
      }),
      offsetX: 0.88,
      offsetY: -1.12,
      scaleX: 1.09,
      ease: "out",
    },
    // The unwind starts from the middle out — hips first, then the shoulders.
    // The palm is the last thing to leave.
    {
      t: 0.58,
      pose: P({
        torso: 14, head: -6, hip: -2,
        thighR: 138, shinR: 26, footR: -90,
        thighL: 220, shinL: 14, footL: -62,
        upperArmR: 58, forearmR: 20,
        upperArmL: 232, forearmL: -20,
      }),
      offsetX: 0.5,
      offsetY: -0.7,
    },
    {
      t: 0.74,
      pose: P({
        torso: 6,
        thighR: 150, shinR: 22, footR: -88,
        thighL: 208, shinL: 12, footL: -76,
        upperArmR: 140, forearmR: -60,
        upperArmL: 214, forearmL: -80,
      }),
      offsetX: 0.2,
      offsetY: -0.3,
    },
    { t: 0.92, pose: P({ torso: 4, upperArmR: 188, forearmR: -96, upperArmL: 206, forearmL: -98 }) },
    { t: 1, pose: P({ torso: 4, upperArmR: 200, forearmR: -106, upperArmL: 204, forearmL: -102 }) },
  ],
};

/**
 * Side special: Cape.
 *
 * A matador's flourish. The 7% is beside the point — the move reverses the
 * victim's facing and reflects projectiles — so what it has to read as is a
 * *sweep across the body*, not a strike at something.
 *
 * The reference corrects one assumption that shaped the whole of round one:
 * **the cape is not in his hand.** It is generated on frame 1, fastened at his
 * throat with a small red clasp, hangs down his back and whips round on its
 * own. So the arm is not carrying anything and does not have to pretend to —
 * it is the *shoulder rotation* that drags the cloth, and the hand is free.
 *
 * What the body does: he sinks into a deep forward lunge — front foot planted,
 * rear leg extended with the heel up, the same lunge as the fireball — and
 * turns his torso from side-on toward the camera as the arm sweeps across the
 * front and up, finishing forward at chest-to-head height. The other hand stays
 * a closed fist at the chest. The sweep is **across the chest and never over
 * the head**: both damage hitboxes and the reflector sit at y ≈ 6.5–6.7, a
 * shade under half his height.
 *
 * The turn toward the camera is the one thing a side-on rig cannot say, so it
 * is carried by `scaleX` rather than faked with bones: 0.94 while he is closed
 * off and 1.16 as the shoulders come round, which is the same device the down
 * air uses for a rotation out of the screen plane.
 */
const sideB: PoseClip = {
  loop: false,
  strike: 0.34,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 2, head: -2,
        thighR: 158, shinR: 4, footR: -92,
        thighL: 202, shinL: -2, footL: -84,
        upperArmR: 200, forearmR: -106,
        upperArmL: 204, forearmL: -102,
      }),
      ease: "in",
    },
    // Gathered. Near arm folded across the chest, shoulders closed off and
    // narrowed, weight on the back foot — everything wound one way so the
    // sweep can go the other, and the cape is still hanging down his back.
    {
      t: 0.2,
      pose: P({
        torso: -18, head: 14, hip: 8,
        thighR: 168, shinR: 20, footR: -88,
        thighL: 206, shinL: 14, footL: -78,
        upperArmR: 186, forearmR: -128, handR: -18,
        upperArmL: 212, forearmL: -96,
      }),
      offsetX: -0.5,
      offsetY: -0.25,
      scaleX: 0.94,
      ease: "in",
    },
    // Contact, frame 12. Arm accumulated 24 + 46 = 70 and swung wide out front
    // at chest height, torso driven through it and opened out to the camera.
    // Off fist closed at the chest.
    {
      t: 0.34,
      pose: P({
        torso: 24, head: -16, hip: -6,
        thighR: 126, shinR: 22, footR: -94,
        thighL: 234, shinL: 8, footL: -48,
        upperArmR: 46, forearmR: 24, handR: 0,
        upperArmL: 172, forearmL: -110,
      }),
      offsetX: 1.0,
      offsetY: -1.05,
      scaleX: 1.16,
      ease: "hold",
    },
    // Frame 14, the last live frame.
    {
      t: 0.395,
      pose: P({
        torso: 22, head: -14, hip: -6,
        thighR: 128, shinR: 22, footR: -94,
        thighL: 232, shinL: 8, footL: -50,
        upperArmR: 54, forearmR: 28, handR: 0,
        upperArmL: 170, forearmL: -108,
      }),
      offsetX: 1.05,
      offsetY: -1.05,
      scaleX: 1.15,
      ease: "out",
    },
    {
      t: 0.56,
      pose: P({
        torso: 12, head: -6,
        thighR: 140, shinR: 26, footR: -90,
        thighL: 218, shinL: 14, footL: -66,
        upperArmR: 96, forearmR: 4,
        upperArmL: 182, forearmL: -104,
      }),
      offsetX: 0.55,
      offsetY: -0.6,
      scaleX: 1.06,
    },
    {
      t: 0.78,
      pose: P({
        torso: 6, head: -2,
        upperArmR: 156, forearmR: -60,
        upperArmL: 196, forearmL: -100,
      }),
      offsetX: 0.24,
      offsetY: -0.25,
    },
    { t: 0.94, pose: P({ torso: 4, upperArmR: 190, forearmR: -96, upperArmL: 202, forearmL: -100 }), offsetX: 0.1 },
    { t: 1, pose: P({ torso: 3, upperArmR: 198, forearmR: -104, upperArmL: 203, forearmL: -102 }) },
  ],
};

/**
 * Up special: Super Jump Punch.
 *
 * The hitbox is live on **frame 3** of 55, so `poseTimeFor` compresses the
 * wind-up into two frames and gives the other fifty-two to the rise and the
 * fall. That is the right shape for the move — the reference is explicit that
 * there is no crouch worth speaking of, because three frames of startup leaves
 * no room for one — and the wrong shape to author carelessly: the crouch is a
 * flicker, the punch is everything.
 *
 * **The fist punches diagonally, not straight up.** Round one had the arm at
 * 12° *behind* vertical, which put the glove directly beside the cap: at match
 * scale the whole move read as Mario growing a second white bobble on his hat.
 * The reference settles it twice over — SmashWiki has him jumping "diagonally
 * upwards with a more vertical range than horizontal", and the engine's own
 * boxes reach four units in front of him at both the chest and the head tier.
 * At 32° forward of vertical the fist clears both the front and the top of
 * the cap — which is the tightest this rig allows, because the head is 5.0
 * units from the shoulder to its crown against an arm that reaches 5.45 with
 * the glove. The head is laid 28° back under it, which buys the horizontal
 * clearance and is also what a person looking up at their own fist does.
 *
 * Straight up is *not* available and it is worth writing down why: the port
 * tag sits directly over the head, and the figure is drawn under it like
 * everything else, so a fist on the vertical spends the whole rise behind the
 * tag. Punching up-and-forward is both what the reference describes and the
 * only place the glove is visible.
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
        torso: 20, head: -16, hip: -8,
        thighR: 128, shinR: 104, footR: -76,
        thighL: 134, shinL: 100, footL: -74,
        upperArmR: 196, forearmR: 46,
        upperArmL: 214, forearmL: -38,
      }),
      offsetY: -1.35,
      ease: "in",
    },
    // Contact, frame 3. Fist accumulated −6 + 40 = 34: up and well forward of
    // the cap, elbow locked out, head laid back under it. Body stretched, legs
    // trailing, toes pointed — the shape of hitting a block from below and a
    // little ahead.
    {
      t: 0.14,
      pose: P({
        torso: -8, head: -20,
        thighR: 186, shinR: 4, footR: -118,
        thighL: 192, shinL: 4, footL: -116,
        upperArmR: 44, forearmR: -4, handR: 0,
        upperArmL: 208, forearmL: -84,
      }),
      offsetY: 0.9,
      scaleY: 1.2,
      scaleX: 0.86,
      ease: "linear",
    },
    // Frames 4–16, the rising column of coin hits. The fist stays out in front
    // and above — he is travelling, not swinging — but the span into here is
    // `linear`, not `hold`. Held, this key and the contact key are the same
    // drawing for thirteen consecutive frames, and a critic looking at the
    // capture said flatly that the move had no animation in it: same bounding
    // box, same glove, frame after frame. The legs trail further, the body
    // stretches another two percent and the fist creeps toward vertical, which
    // is little enough to still read as one held shape and enough to stop it
    // being a photograph.
    {
      t: 0.383,
      pose: P({
        torso: -6, head: -19,
        thighR: 198, shinR: 10, footR: -122,
        thighL: 202, shinL: 10, footL: -120,
        upperArmR: 38, forearmR: -8, handR: 0,
        upperArmL: 214, forearmL: -76,
      }),
      offsetY: 1.05,
      scaleY: 1.24,
      scaleX: 0.84,
      ease: "hold",
    },
    // Frames 17–18, the launcher at the top of the column. The arm reaches its
    // furthest — 3° from vertical and still ahead of him — which is where the
    // 9-unit finishing sphere is.
    {
      t: 0.416,
      pose: P({
        torso: -4, head: -18,
        thighR: 186, shinR: 10, footR: -112,
        thighL: 196, shinL: 8, footL: -110,
        upperArmR: 30, forearmR: -6, handR: 0,
        upperArmL: 214, forearmL: -74,
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
 * The other move with **no hitboxes at all**, and deliberately so — it deals no
 * damage, it charges and then pushes. Same consequence as Fireball: no
 * `firstActive`, so the clip runs linearly across 48 frames and every `t` is
 * the fraction it happens at.
 *
 * Three beats. He hunches over the pack to charge it, holds there (`hold`, so
 * the charge is a drawing rather than a drift), then **brings the nozzle up
 * beside his head in both hands** and takes the recoil.
 *
 * That last pose is the correction round one needed. The reference is explicit
 * that *Smash*'s F.L.U.D.D. is used differently from *Sunshine*'s: rather than
 * firing from over and behind his head, Mario **grabs the nozzle and holds it
 * next to his head**, one hand on the nozzle and one on a handle. Round one
 * had both hands out at hip height in front of a nozzle drawn over his
 * shoulder, so the two never met and the water appeared to come out of his
 * face. Here both hands accumulate to about 75° at the wrist — 2.7 units
 * forward of the shoulder and 2.5 above it — which is exactly beside the head
 * and exactly where `fx.ts` draws the grip.
 *
 * `strike` is 21/48. For a move with no hitbox that is a literal fraction and
 * it has to be the same frame `fx.ts` opens the water on; the reference puts
 * the first pump on frame 21, and round one had the brace at 0.52 — four
 * frames early, which read as a flinch before anything happened.
 */
const downB: PoseClip = {
  loop: false,
  strike: 0.4375,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 6, head: -6,
        thighR: 158, shinR: 4, footR: -92,
        thighL: 202, shinL: -2, footL: -84,
        upperArmR: 200, forearmR: -106,
        upperArmL: 204, forearmL: -102,
      }),
      ease: "in",
    },
    // Charging. Hunched over the pack, both hands low on it, knees soft.
    {
      t: 0.26,
      pose: P({
        torso: 30, head: -24, hip: -6,
        thighR: 140, shinR: 72, footR: -82,
        thighL: 148, shinL: 68, footL: -80,
        upperArmR: 148, forearmR: -70,
        upperArmL: 154, forearmL: -66,
      }),
      offsetY: -1.25,
      ease: "hold",
    },
    {
      t: 0.38,
      pose: P({
        torso: 30, head: -24, hip: -6,
        thighR: 140, shinR: 72, footR: -82,
        thighL: 148, shinL: 68, footL: -80,
        upperArmR: 148, forearmR: -70,
        upperArmL: 154, forearmL: -66,
      }),
      offsetY: -1.25,
      ease: "in",
    },
    // Firing, frame 21. Both hands up on the nozzle beside his head — wrists
    // accumulated −12 + 22 + 65 = 75 — braced wide with the weight on the back
    // foot and leaning *away* from the muzzle. This is recoil, not a lunge:
    // a full-charge shot shoves him backwards faster than he can fly forwards.
    {
      t: 0.4375,
      pose: P({
        torso: -12, head: 12, hip: 8,
        thighR: 126, shinR: 44, footR: -80,
        thighL: 228, shinL: 34, footL: -66,
        upperArmR: 22, forearmR: 65,
        upperArmL: 28, forearmL: 62,
      }),
      offsetX: -0.5,
      offsetY: -1.0,
      scaleX: 1.12,
      ease: "hold",
    },
    {
      t: 0.78,
      pose: P({
        torso: -10, head: 10, hip: 8,
        thighR: 128, shinR: 44, footR: -80,
        thighL: 226, shinL: 34, footL: -66,
        upperArmR: 26, forearmR: 62,
        upperArmL: 32, forearmL: 59,
      }),
      offsetX: -0.6,
      offsetY: -1.0,
      scaleX: 1.11,
      ease: "out",
    },
    {
      t: 0.94,
      pose: P({
        torso: 4, head: -2,
        thighR: 146, shinR: 20, footR: -88,
        thighL: 208, shinL: 12, footL: -78,
        upperArmR: 160, forearmR: -80,
        upperArmL: 196, forearmL: -92,
      }),
      offsetY: -0.5,
    },
    { t: 1, pose: P({ torso: 4, thighR: 156, shinR: 6, thighL: 202, shinL: -2 }), offsetY: -0.3 },
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
  idle,
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
