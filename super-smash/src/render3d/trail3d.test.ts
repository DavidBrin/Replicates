import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { DoubleSide, Vector3, type MeshBasicMaterial } from "three";

import { activeHitboxes, actionFrameOf } from "@/engine/hitbox";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { fighterPoser } from "./bake/bake";
import { createFighter3D } from "./fighter3d";
import { parseSkeletonFile } from "./skeleton/skeleton";
import { TRAIL_SAMPLES, createTrails3D, trailBoneOf, trailSample, type TrailSample } from "./trail3d";

const bake = readBakeFromDisk();
/** The game's own fighter: its limb-bone moves run their scripts, through the bake's bones. */
const def = (id: string) => withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);

describe("sword and kick trails (Plan 6, Task 34)", () => {
  it("follows the bone a limb move's boxes ride, and none for a root-bone move or a grab", () => {
    expect(trailBoneOf(def("link"), "ftilt")?.bone).toBe("sword2");
    expect(trailBoneOf(def("marth"), "fsmash")?.bone).toBe("sword1");
    expect(trailBoneOf(def("kirby"), "ftilt")?.bone).toBe("footl");
    // Link's up throw slashes upward with his sword: a swing, trailed like any other.
    expect(trailBoneOf(def("link"), "uthrow")?.bone).toBe("sword2");
    // Boxes on the body's root (`top`): Link's jab 1, Mario's pummel. A grab's boxes are catches.
    expect(trailBoneOf(def("link"), "jab1")).toBeNull();
    expect(trailBoneOf(def("mario"), "pummel")).toBeNull();
    expect(trailBoneOf(def("marth"), "grab")).toBeNull();
  });

  /**
   * The look, as numbers (ruling R-P6-6): on the tipper's first live frame the ribbon's
   * sample runs from Marth's hand, where the drawn `sword1` bone is, out to the tipper box,
   * the farthest of the blade's live boxes: the blade's length, not a smear at the hilt.
   */
  it("spans Marth's blade on his forward smash: from the drawn hand to the tipper, the farthest live box", () => {
    const marth = def("marth");
    const bone = trailBoneOf(marth, "fsmash")!;
    const move = marth.moves.fsmash!;
    const first = Math.min(...move.hitboxes.map((h) => h.startFrame));
    const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "marth.json"), "utf8")));
    const fighter = createFighter3D({ def: marth, port: 0, poser: fighterPoser(marth, skeleton), bake, model: { kind: "standIn", reason: "test" } });
    const f = makeFighter({ defId: "marth", x: fx(10), y: 0, facing: 1, grounded: true, action: "attack", move: "fsmash", actionFrame: actionFrameOf(first) });
    fighter.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });
    const hand = new Vector3();
    expect(fighter.bonePosition(bone.bone, hand)).toBe(true);
    const boxes = activeHitboxes(move, first);
    const sample = trailSample(bone, boxes, toFloat(f.x), toFloat(f.y), f.facing, { x: hand.x, y: hand.y, z: hand.z })!;
    expect(sample).not.toBeNull();
    expect(sample.inner).toEqual({ x: hand.x, y: hand.y, z: hand.z });
    const length = Math.hypot(sample.outer.x - sample.inner.x, sample.outer.y - sample.inner.y);
    expect(length).toBeGreaterThan(6);
    // The outer edge is the strongest box: the tipper.
    const tipper = boxes.filter((h) => bone.ids.has(h.id)).reduce((a, b) => (b.damage > a.damage ? b : a));
    expect(sample.outer.x).toBeCloseTo(toFloat(f.x) + toFloat(tipper.x), 6);
    expect(sample.outer.y).toBeCloseTo(toFloat(f.y) + toFloat(tipper.y), 6);
    fighter.dispose();
  });

  it("keeps the last TRAIL_SAMPLES samples, fading to the oldest, and draws in from its tail a sample a frame once the boxes end", () => {
    const trails = createTrails3D(4);
    const sample = (i: number): TrailSample => ({ inner: { x: i, y: 0, z: 0 }, outer: { x: i, y: 5, z: 0 } });
    for (let i = 0; i < TRAIL_SAMPLES + 3; i++) trails.push(0, sample(i));
    trails.update();
    expect(trails.samplesOf(0).map((s) => s.inner.x)).toEqual(Array.from({ length: TRAIL_SAMPLES }, (_, i) => i + 3));
    const alpha = trails.alphasOf(0);
    expect(alpha[alpha.length - 1]).toBeGreaterThan(alpha[0]);
    expect(trails.mesh.visible).toBe(true);
    trails.push(0, null);
    expect(trails.samplesOf(0).map((s) => s.inner.x)).toEqual(Array.from({ length: TRAIL_SAMPLES - 1 }, (_, i) => i + 4));
    for (let i = 0; i < TRAIL_SAMPLES; i++) trails.push(0, null);
    trails.update();
    expect(trails.samplesOf(0)).toEqual([]);
    expect(trails.mesh.visible).toBe(false);
    trails.dispose();
  });

  it("is one ribbon for every fighter, drawn in one pass: one draw call", () => {
    const trails = createTrails3D(4);
    const material = trails.mesh.material as MeshBasicMaterial;
    expect(trails.mesh.isMesh).toBe(true);
    // three draws a transparent double-sided material twice, back faces then front, unless single-pass.
    expect(material.transparent && material.side === DoubleSide).toBe(true);
    expect(material.forceSinglePass).toBe(true);
    trails.dispose();
  });
});
