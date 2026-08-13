import { describe, expect, it } from "vitest";

import { BLEND_FRAMES, blendedPose, clipFrameFor, createPoseBlends } from "./blend";
import { POSE_LIBRARY, samplePose, type PoseSample } from "./poses";
import type { PoseName } from "./poses";
import type { FighterState } from "@/engine/types";
import type { BoneName } from "./skeleton";

const who = (over: Partial<Pick<FighterState, "port" | "action">> = {}) => ({
  port: over.port ?? 0,
  action: over.action ?? ("stand" as FighterState["action"]),
});

const at = (name: PoseName, t = 0) => samplePose(POSE_LIBRARY[name], t);

/** Total angular difference between two poses, over the bones they share. */
function distance(a: PoseSample, b: PoseSample): number {
  let sum = 0;
  for (const bone of Object.keys(a.angles) as BoneName[]) {
    const x = a.angles[bone];
    const y = b.angles[bone];
    if (x !== undefined && y !== undefined) sum += Math.abs(x - y);
  }
  return sum;
}

/** Drive a fighter through `frames` of one clip, returning what was drawn. */
function play(
  blends: ReturnType<typeof createPoseBlends>,
  name: PoseName,
  frames: readonly number[],
  fighter = who(),
): PoseSample[] {
  return frames.map((frame) => blendedPose(blends, fighter, name, at(name), frame));
}

describe("cross-fading between clips", () => {
  it("arrives at the new clip rather than stopping short", () => {
    const b = createPoseBlends();
    play(b, "idle", [0, 1, 2]);
    const during = play(b, "crouch", [3, 4, 5, 6, 7]);
    const settled = during[during.length - 1];
    expect(distance(settled, at("crouch"))).toBeCloseTo(0, 6);
  });

  it("does not jump to the new clip on the frame it changes", () => {
    const b = createPoseBlends();
    play(b, "idle", [0, 1, 2]);
    const [first] = play(b, "crouch", [3]);
    // Nearer to where it came from than to where it is going.
    expect(distance(first, at("idle"))).toBeLessThan(distance(first, at("crouch")));
  });

  it("moves closer to the target on every frame of the fade", () => {
    const b = createPoseBlends();
    play(b, "idle", [0]);
    const frames = Array.from({ length: BLEND_FRAMES + 1 }, (_, i) => i + 1);
    const distances = play(b, "crouch", frames).map((p) => distance(p, at("crouch")));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1] + 1e-9);
    }
  });

  it("snaps into an attack, because an attack is timed against its hitbox", () => {
    const b = createPoseBlends();
    play(b, "idle", [0, 1, 2]);
    const [first] = play(b, "fsmash", [3], who({ action: "attack" }));
    expect(distance(first, at("fsmash"))).toBeCloseTo(0, 6);
  });

  it("snaps into a hit, because impact that eases in is not impact", () => {
    const b = createPoseBlends();
    play(b, "idle", [0, 1, 2]);
    const [first] = play(b, "hitstun", [3], who({ action: "hitstun" }));
    expect(distance(first, at("hitstun"))).toBeCloseTo(0, 6);
  });

  it("does not advance when the same simulation frame is drawn twice", () => {
    const b = createPoseBlends();
    play(b, "idle", [0]);
    const once = blendedPose(b, who(), "crouch", at("crouch"), 1);
    const twice = blendedPose(b, who(), "crouch", at("crouch"), 1);
    expect(distance(once, twice)).toBeCloseTo(0, 9);
  });

  it("keeps each port's transition to itself", () => {
    const b = createPoseBlends();
    play(b, "idle", [0], who({ port: 0 }));
    play(b, "crouch", [0], who({ port: 1 }));
    const p0 = blendedPose(b, who({ port: 0 }), "idle", at("idle"), 1);
    expect(distance(p0, at("idle"))).toBeCloseTo(0, 6);
  });

  it("fades from where the fighter visibly is when a transition is interrupted", () => {
    const b = createPoseBlends();
    play(b, "idle", [0]);
    // Interrupted one frame into the idle-to-crouch fade.
    const mid = blendedPose(b, who(), "crouch", at("crouch"), 1);
    const [next] = play(b, "run", [2]);
    // Not from the crouch it never reached, and not from the idle it had left.
    expect(distance(next, mid)).toBeLessThan(distance(next, at("crouch")));
    expect(distance(next, mid)).toBeLessThan(distance(next, at("run")));
  });
});

describe("a clip's own clock", () => {
  const falling = (actionFrame: number) => ({ port: 0, action: "fall" as const, actionFrame });

  it("counts from the action while the clip and the action agree", () => {
    const b = createPoseBlends();
    for (let n = 0; n < 20; n++) {
      expect(clipFrameFor(b, falling(n), "fall", n)).toBe(n);
    }
  });

  it("restarts when the clip changes without the action restarting", () => {
    // Fast-falling is a flag on a fighter who is already falling, so a player
    // who presses down twenty frames in would otherwise enter the dive
    // two-thirds of the way through it and never see the snap.
    const b = createPoseBlends();
    for (let n = 0; n < 20; n++) clipFrameFor(b, falling(n), "fall", n);
    expect(clipFrameFor(b, falling(20), "fastFall", 20)).toBe(0);
    expect(clipFrameFor(b, falling(21), "fastFall", 21)).toBe(1);
    expect(clipFrameFor(b, falling(22), "fastFall", 22)).toBe(2);
  });

  it("keeps each port on its own clock", () => {
    const b = createPoseBlends();
    for (let n = 0; n < 10; n++) {
      clipFrameFor(b, { ...falling(n), port: 0 }, "fall", n);
      clipFrameFor(b, { ...falling(n), port: 1 }, "fall", n);
    }
    expect(clipFrameFor(b, { ...falling(10), port: 0 }, "fastFall", 10)).toBe(0);
    expect(clipFrameFor(b, { ...falling(10), port: 1 }, "fall", 10)).toBe(10);
  });
});
