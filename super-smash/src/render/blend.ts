/**
 * Cross-fading between clips.
 *
 * Every clip in the library is authored on its own, which means every one of
 * them starts from whatever pose it starts from and nothing joins them up. On
 * the frame a fighter stops running, the legs are mid-stride, far apart, torso
 * thrown forward — and on the next frame they are wherever the skid clip's
 * first key put them. The fighter does not decelerate into the skid, it cuts to
 * it, and the same cut happens at every one of the forty-odd state transitions
 * a match is made of. It is the difference between a game and a flipbook, and
 * it is invisible in a contact sheet because a contact sheet only ever shows one
 * clip at a time.
 *
 * `blendSamples` has existed since the pose library did, correct and tested and
 * called by nothing.
 *
 * ## What must not be blended
 *
 * Two kinds of change have to arrive on the frame they happen.
 *
 * An **attack** is timed against its own hitbox — the whole point of
 * `MoveTiming` is that the fighter is at full extension on the frame the hitbox
 * is live. Fading into a jab whose hitbox comes out on frame 2 would put the
 * fighter three-quarters of the way to a stance the move has already left.
 *
 * Anything **imposed** — a hit landing, a grab connecting, a shield breaking —
 * is the moment of impact, and impact that eases in is not impact. These are
 * exactly the transitions the eye is most attuned to, so a fade there costs
 * more than it buys everywhere else combined.
 *
 * Everything a fighter *chooses* — run into skid, fall into land, stand into
 * crouch — fades over four frames, which is long enough to remove the cut and
 * short enough that no pose arrives late enough to matter.
 */

import type { FighterState } from "@/engine/types";
import { blendSamples, type PoseSample } from "./poses/clip";
import type { PoseName } from "./poses/library";
import { POSE_LIBRARY } from "./poses/library";

/**
 * Frames a transition takes to fade.
 *
 * Four, because the shortest state anything fades into is the four-frame
 * landing and a fade longer than the state it enters would never finish.
 */
export const BLEND_FRAMES = 4;

export interface PoseBlend {
  /** The pose being faded out of, frozen at the frame the clip changed. */
  from: PoseSample | null;
  /** The clip currently playing, to notice when it changes. */
  name: PoseName | null;
  /** Simulation frame the change happened on. */
  since: number;
  /**
   * What was last actually drawn, which is what the next change fades from.
   *
   * The drawn pose rather than the raw sample, so that a transition interrupted
   * by another transition — landing straight into a dash, which happens
   * constantly — fades from where the fighter visibly is rather than from a
   * pose that was itself only half-arrived.
   */
  last: PoseSample | null;
}

export function createPoseBlends(ports = 4): PoseBlend[] {
  return Array.from({ length: ports }, () => ({
    from: null,
    name: null,
    since: 0,
    last: null,
  }));
}

/**
 * Whether arriving in this clip is something the fighter did, or something that
 * was done to them.
 */
function isImposed(action: FighterState["action"]): boolean {
  switch (action) {
    case "hitstun":
    case "tumble":
    case "grabbed":
    case "thrown":
    case "downed":
    case "shieldBroken":
    case "dead":
      return true;
    default:
      return false;
  }
}

/**
 * The pose to actually draw, faded out of whatever was on screen before it.
 *
 * Idempotent within a simulation frame: drawing the same frame twice — which
 * happens whenever the display runs ahead of the fixed-step simulation — must
 * not advance the fade or a fighter's transitions would run at monitor refresh
 * rate instead of at 60Hz.
 */
export function blendedPose(
  blends: PoseBlend[],
  fighter: Pick<FighterState, "port" | "action">,
  name: PoseName,
  sample: PoseSample,
  frame: number,
): PoseSample {
  const b = blends[fighter.port];
  if (!b) return sample;

  if (b.name !== name) {
    const snap = POSE_LIBRARY[name]?.strike !== undefined || isImposed(fighter.action);
    b.from = snap ? null : b.last;
    b.name = name;
    b.since = frame;
  }

  const t = b.from ? (frame - b.since) / BLEND_FRAMES : 1;
  if (t >= 1 || t < 0) b.from = null;

  const drawn = b.from ? blendSamples(b.from, sample, t) : sample;
  b.last = drawn;
  return drawn;
}
