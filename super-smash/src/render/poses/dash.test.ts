import { describe, expect, it } from "vitest";
import { DASH_INTERRUPT_FRAME } from "@/engine/constants";
import { BASE_RIG, BONE_NAMES, resolve, type BoneName } from "../skeleton";
import { samplePose, type PoseSample } from "./clip";
import { dash } from "./dash";
import { run } from "./run";

/**
 * The dash lasts `DASH_INTERRUPT_FRAME` frames and `poseTimeFor` drives it at
 * `actionFrame / that`, so these are the fifteen samples the renderer takes —
 * and frame 15 is not among them, because that is the frame `dashStart` becomes
 * `run`. The last *drawn* frame is 14, which is what the handoff is judged on.
 */
const DRAWN = Array.from({ length: DASH_INTERRUPT_FRAME }, (_, f) =>
  samplePose(dash, f / DASH_INTERRUPT_FRAME),
);
const RUN_FIRST = samplePose(run, 0);
/**
 * One full lap of the run, for calibrating "how fast is fast" against it.
 *
 * At the *fastest* fighter's cadence, not at the clip's nominal `period`. The
 * run is paced by ground covered rather than by frames, so its cycle is about
 * fifteen frames for Fox and twenty-one for Kirby and the `period` field is
 * never what anybody actually sees. Calibrating against twenty understates how
 * fast the run really turns, and then holds the dash to a bar the thing it is
 * being compared to does not clear.
 */
const RUN_LAP_FRAMES = 15;
const RUN_LAP = Array.from({ length: RUN_LAP_FRAMES + 1 }, (_, f) =>
  samplePose(run, f / RUN_LAP_FRAMES),
);

function place(s: PoseSample) {
  const sk = resolve(BASE_RIG, s.angles, {
    x: 0,
    y: 0,
    scale: 1,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    facing: 1,
  });
  // Screen space is y-down and the pose offsets are applied by the caller, so
  // put both back to get "rig units forward of, and above, the fighter's feet".
  const at = (b: BoneName) => ({ x: s.offsetX + sk[b].x1, y: s.offsetY - sk[b].y1 });
  return { at, angle: (b: BoneName) => sk[b].angle };
}

const degrees = (radians: number) => (radians * 180) / Math.PI;

/** Largest change in any bone's on-screen orientation from one frame to the next. */
function fastestTurn(seq: readonly PoseSample[]): number {
  let worst = 0;
  for (let f = 1; f < seq.length; f++) {
    const a = place(seq[f - 1]);
    const b = place(seq[f]);
    for (const bone of BONE_NAMES) {
      worst = Math.max(worst, Math.abs(degrees(b.angle(bone) - a.angle(bone))));
    }
  }
  return worst;
}

/** How far the head is out in front of the pelvis — the lean, in rig units. */
function lean(s: PoseSample): number {
  const p = place(s);
  return p.at("head").x - p.at("root").x;
}

/** Which foot is in front, as a signed gap: positive when the near foot leads. */
function footGap(s: PoseSample): number {
  const p = place(s);
  return p.at("footR").x - p.at("footL").x;
}

describe("the initial dash", () => {
  it("hands over to the run without changing shape", () => {
    // Not "the numbers match run.ts" — the same *drawing*, which is what a
    // fighter crossing from `dashStart` into `run` on frame 15 has to see.
    const end = place(samplePose(dash, 1));
    const start = place(RUN_FIRST);
    for (const bone of BONE_NAMES) {
      expect(degrees(end.angle(bone) - start.angle(bone))).toBeCloseTo(0, 6);
      expect(end.at(bone).x).toBeCloseTo(start.at(bone).x, 6);
      expect(end.at(bone).y).toBeCloseTo(start.at(bone).y, 6);
    }
  });

  it("is already sitting on the run's first key by the last drawn frame", () => {
    // Frame 14 is drawn, frame 15 is the run's frame 0. Whatever distance is
    // left between them is a jump the eye sees in a single frame, so it has to
    // be small against how far a bone travels in a normal frame of running.
    const last = place(DRAWN[DRAWN.length - 1]);
    const next = place(RUN_FIRST);
    let worst = 0;
    for (const bone of BONE_NAMES) {
      worst = Math.max(worst, Math.abs(degrees(next.angle(bone) - last.angle(bone))));
    }
    expect(worst).toBeLessThan(fastestTurn(RUN_LAP) / 3);
  });

  it("never turns a bone faster than the run cycle already does", () => {
    expect(fastestTurn(DRAWN)).toBeLessThan(fastestTurn(RUN_LAP));
  });

  it("throws the body out ahead of the feet and then stands it back up", () => {
    const early = Math.max(...DRAWN.slice(0, 5).map(lean));
    const settled = lean(DRAWN[DRAWN.length - 1]);
    expect(early).toBeGreaterThan(2.5);
    // Within a third of a unit of the run's own posture, so the lean is spent
    // rather than being unwound by the handoff.
    expect(Math.abs(settled - lean(RUN_FIRST))).toBeLessThan(0.35);
    // And it comes out monotonically once the drive is past — a lean that
    // recovered and then dipped again would read as a stumble.
    for (let f = 5; f < DRAWN.length; f++) {
      expect(lean(DRAWN[f])).toBeLessThanOrEqual(lean(DRAWN[f - 1]) + 1e-9);
    }
  });

  it("starts low and crouched and rises into the run", () => {
    const head = (s: PoseSample) => place(s).at("head").y;
    expect(head(DRAWN[DRAWN.length - 1]) - head(DRAWN[0])).toBeGreaterThan(1.2);
  });

  it("opens from a standing footprint into a full stride by the drive", () => {
    expect(Math.abs(footGap(DRAWN[0]))).toBeLessThan(1.5);
    // A third of the way in, not merely by the last frame: a dash whose legs
    // only split once it is already running has no burst in it.
    expect(Math.abs(footGap(DRAWN[Math.floor(DRAWN.length / 3)]))).toBeGreaterThan(4);
  });

  it("takes exactly one stride, ending on the foot the run cycle expects", () => {
    // The run's first key has the near leg reaching forward. Arriving there
    // with the legs the other way round would put the handoff half a cycle out
    // and make the fighter skip.
    const crossings = DRAWN.filter(
      (s, f) => f > 0 && Math.sign(footGap(s)) !== Math.sign(footGap(DRAWN[f - 1])),
    ).length;
    expect(crossings).toBe(1);
    expect(Math.sign(footGap(DRAWN[DRAWN.length - 1]))).toBe(Math.sign(footGap(RUN_FIRST)));
  });

  it("keeps both feet on the floor rather than through it", () => {
    const lowest = Math.min(
      ...DRAWN.flatMap((s) => [place(s).at("footR").y, place(s).at("footL").y]),
    );
    expect(lowest).toBeGreaterThan(-0.25);
  });

  it("is a new drawing on every frame", () => {
    for (let f = 1; f < DRAWN.length; f++) {
      const a = place(DRAWN[f - 1]);
      const b = place(DRAWN[f]);
      const moved = Math.max(
        ...BONE_NAMES.map((bone) => Math.abs(degrees(b.angle(bone) - a.angle(bone)))),
      );
      expect(moved).toBeGreaterThan(1);
    }
  });
});
