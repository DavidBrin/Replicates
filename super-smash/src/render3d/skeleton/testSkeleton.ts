/**
 * An invented, SSBU-shaped skeleton for tests — so every module can be proven
 * before the Blender spike has produced a real one, and without a single
 * Nintendo-derived number in a fixture.
 *
 * It copies the *conventions* the spike's dump uses (verified on the real
 * Mario dump, Plan 4 Task 4): bind pose is a T-pose; +Y up, +Z forward, +X the
 * fighter's left; spine bones' local +X points up; limb bones' local +X points
 * along the limb toward the child; names are SSBU's (`Hip`, `KneeR`, `HandL`).
 * The proportions are round numbers, not Mario's.
 */

import type { HurtCapsule, SkeletonBone, SkeletonFile } from "./skeleton";
import { SKELETON_SCHEMA } from "./skeleton";
import { normalize, type Vec3 } from "../math/rigid";

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A bone whose local X is `x` and local Y is `y` (re-orthogonalised), at `at`. */
function bone(name: string, parent: string | null, at: Vec3, x: Vec3, y: Vec3): SkeletonBone {
  const X = normalize(x);
  const Z = normalize(cross(X, y));
  const Y = cross(Z, X);
  return { name, parent, world: [...X, 0, ...Y, 0, ...Z, 0, at[0], at[1], at[2], 1] };
}

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FWD: Vec3 = [0, 0, 1];
const BACK: Vec3 = [0, 0, -1];
const LEFT: Vec3 = [1, 0, 0];
const RIGHT: Vec3 = [-1, 0, 0];

export function testSkeleton(fighter = "test"): SkeletonFile {
  const bones: SkeletonBone[] = [
    bone("Trans", null, [0, 0, 0], LEFT, UP),
    bone("Rot", "Trans", [0, 6, 0], LEFT, UP),
    bone("Hip", "Rot", [0, 5.5, 0], UP, FWD),
    bone("Waist", "Hip", [0, 6.5, 0], UP, FWD),
    bone("Bust", "Waist", [0, 8, 0], UP, FWD),
    bone("Neck", "Bust", [0, 9, 0], UP, FWD),
    bone("Head", "Neck", [0, 10, 0], UP, FWD),
    bone("ClavicleC", "Bust", [0, 8.7, 0], LEFT, FWD),
    bone("ClavicleL", "ClavicleC", [1, 8.7, 0], LEFT, FWD),
    bone("ShoulderL", "ClavicleL", [2, 8.7, 0], LEFT, FWD),
    bone("ArmL", "ShoulderL", [3.8, 8.7, 0], LEFT, FWD),
    bone("HandL", "ArmL", [5.4, 8.7, 0], LEFT, DOWN),
    bone("HaveL", "HandL", [6.8, 8.6, 0], LEFT, UP),
    bone("ClavicleR", "ClavicleC", [-1, 8.7, 0], RIGHT, FWD),
    bone("ShoulderR", "ClavicleR", [-2, 8.7, 0], RIGHT, FWD),
    bone("ArmR", "ShoulderR", [-3.8, 8.7, 0], RIGHT, FWD),
    bone("HandR", "ArmR", [-5.4, 8.7, 0], RIGHT, DOWN),
    bone("HaveR", "HandR", [-6.8, 8.6, 0], RIGHT, UP),
    bone("LegC", "Hip", [0, 5.5, 0], LEFT, UP),
    bone("LegL", "LegC", [1.2, 5.5, 0], DOWN, BACK),
    bone("KneeL", "LegL", [1.2, 3.4, 0], DOWN, BACK),
    bone("FootL", "KneeL", [1.2, 1.5, 0], DOWN, BACK),
    bone("ToeL", "FootL", [1.2, 0.8, 1.3], FWD, DOWN),
    bone("LegR", "LegC", [-1.2, 5.5, 0], DOWN, BACK),
    bone("KneeR", "LegR", [-1.2, 3.4, 0], DOWN, BACK),
    bone("FootR", "KneeR", [-1.2, 1.5, 0], DOWN, BACK),
    bone("ToeR", "FootR", [-1.2, 0.8, 1.3], FWD, DOWN),
    bone("Throw", "Rot", [0, 0, 0], LEFT, UP),
  ];
  const hurt: HurtCapsule[] = [
    { bone: "Head", x1: 0.5, x2: 2.5, r: 2 },
    { bone: "Bust", x1: -1.5, x2: 1, r: 2 },
    { bone: "Hip", x1: -0.5, x2: 1, r: 1.8 },
    { bone: "ShoulderL", x1: 0, x2: 1.8, r: 0.8 },
    { bone: "ArmL", x1: 0, x2: 2.2, r: 0.8 },
    { bone: "ShoulderR", x1: 0, x2: 1.8, r: 0.8 },
    { bone: "ArmR", x1: 0, x2: 2.2, r: 0.8 },
    { bone: "LegL", x1: 0, x2: 2.1, r: 1 },
    { bone: "KneeL", x1: 0, x2: 2.4, r: 0.9 },
    { bone: "LegR", x1: 0, x2: 2.1, r: 1 },
    { bone: "KneeR", x1: 0, x2: 2.4, r: 0.9 },
  ];
  return { schema: SKELETON_SCHEMA, fighter, bones, hurt };
}
