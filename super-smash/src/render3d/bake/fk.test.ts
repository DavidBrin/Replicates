import { describe, expect, it } from "vitest";

import { BAKE_QUANTUM } from "@/engine/acmd/bakeCodec";
import { TOP_POSE, bonePoint } from "@/engine/acmd/bones";
import { ONE, fx } from "@/engine/fixed";
import { BASE_RIG } from "@/render/skeleton";
import { mTranslation } from "../math/rigid";
import { calibrate, restPose, retarget } from "../retarget/retarget";
import { buildRig } from "../skeleton/skeleton";
import { testSkeleton } from "../skeleton/testSkeleton";
import { IDENTITY_ROOT, sideBonePose, worldMatrices } from "./fk";

const rig = buildRig(testSkeleton());
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe("forward kinematics and the side-plane projection", () => {
  it("projects the model's identity frame onto Plan 2's root pose: script Z forward, Y up", () => {
    expect(sideBonePose(IDENTITY)).toEqual(TOP_POSE);
  });

  it("lands a bone-local point where bonePoint says, so baked limbs and root-bone scripts share one frame", () => {
    const world = worldMatrices(rig, retarget(calibrate(rig, BASE_RIG), BASE_RIG, { thighR: 2.6 }, 0), IDENTITY_ROOT);
    const knee = world[rig.byLower.get("kneer")!];
    const pose = sideBonePose(knee);
    // A point 1.5 down the shin (KneeR's +X), in model space and through the baked pose.
    const lx = 1.5;
    const model = [knee[0] * lx + knee[12], knee[1] * lx + knee[13], knee[2] * lx + knee[14]];
    const p = bonePoint(pose, fx(lx), 0, 0);
    expect(Math.abs(p.x - Math.round(model[2] * ONE))).toBeLessThanOrEqual(2 * BAKE_QUANTUM);
    expect(Math.abs(p.y - Math.round(model[1] * ONE))).toBeLessThanOrEqual(2 * BAKE_QUANTUM);
  });

  it("stores every number on the bake's 1/256-unit grid", () => {
    const pose = sideBonePose(worldMatrices(rig, restPose(rig), IDENTITY_ROOT)[rig.byLower.get("head")!]);
    for (const v of Object.values(pose)) expect(v % BAKE_QUANTUM).toBe(0);
  });

  it("rounds an off-grid translation to the nearest 1/256 unit", () => {
    // The test skeleton's own offsets sit on the grid, so the test above cannot see a missing round.
    const m = [...IDENTITY];
    m[13] = 0.1234; // 31.6 steps of 1/256 up
    m[14] = -0.1234; // and 31.6 steps back
    const pose = sideBonePose(m);
    expect(pose.ty).toBe(32 * BAKE_QUANTUM);
    expect(pose.tx).toBe(-32 * BAKE_QUANTUM);
  });

  it("applies the root transform: clip offsets, squash and the fighter's size", () => {
    const head = rig.byLower.get("head")!;
    const plain = mTranslation(worldMatrices(rig, restPose(rig), IDENTITY_ROOT)[head]);
    const moved = mTranslation(worldMatrices(rig, restPose(rig), { forward: 2, up: 1, squashForward: 1, squashUp: 0.5, scale: 1.08 })[head]);
    expect(moved[1]).toBeCloseTo(1 + plain[1] * 1.08 * 0.5, 9);
    expect(moved[2]).toBeCloseTo(2 + plain[2] * 1.08, 9);
  });
});
