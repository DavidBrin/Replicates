import { describe, expect, it, vi } from "vitest";
import { Box3, Mesh } from "three";

import { fx, toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import type { StageDef } from "@/engine/types";
import { STAGES, allStageForms } from "@/stages";
import { MAIN_DEPTH, createStage3D } from "./stage3d";

const meshes = (s: ReturnType<typeof createStage3D>) => s.group.children.filter((c): c is Mesh => c instanceof Mesh);

describe("3D stages from the sim's platforms", () => {
  it("puts every platform's top surface exactly where the sim lands fighters", () => {
    for (const stage of STAGES) {
      const s = createStage3D(stage);
      const ms = meshes(s);
      expect(ms.length, stage.id).toBe(stage.platforms.length);
      ms.forEach((m, i) => {
        const p = stage.platforms[i];
        const box = new Box3().setFromObject(m);
        expect(box.max.y).toBeCloseTo(toFloat(p.y), 6);
        expect(box.max.x - box.min.x).toBeCloseTo(2 * toFloat(p.halfWidth), 6);
      });
      s.dispose();
    }
  });

  it("moves a moving platform with the sim's own platformCentreX", () => {
    const stage = STAGES.find((st) => st.platforms.some((p) => p.motion))!;
    const s = createStage3D(stage);
    const i = stage.platforms.findIndex((p) => p.motion);
    for (const frame of [0, 37, 240, 999]) {
      s.update(frame);
      expect(meshes(s)[i].position.x).toBeCloseTo(toFloat(platformCentreX(stage.platforms[i], frame)), 9);
    }
    s.dispose();
  });

  it("costs one draw call per platform and frees its GPU buffers on dispose", () => {
    const stage = STAGES[0];
    const s = createStage3D(stage);
    const ms = meshes(s);
    const spies = ms.map((m) => vi.spyOn(m.geometry, "dispose"));
    const material = vi.spyOn(ms[0].material as { dispose(): void }, "dispose");
    s.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
    expect(s.group.children).toHaveLength(0);
  });
});

describe("the 3D stage and the collision cannot disagree", () => {
  it("builds from whatever platforms the stage data holds, not from a stage it knows by name", () => {
    // A stage no file in `stages/` describes: if the 3D stage were authored per
    // stage id this would come out wrong; generated from `platforms` it cannot.
    const odd: StageDef = {
      id: "odd",
      name: "Odd",
      series: "test",
      theme: "neutral",
      blastZone: { left: fx(-200), right: fx(200), top: fx(200), bottom: fx(-100) },
      spawns: [{ x: fx(0), y: fx(5) }],
      platforms: [
        { x: fx(7.25), y: fx(-3.5), halfWidth: fx(31.5), soft: false, ledges: true },
        { x: fx(-12.125), y: fx(41.75), halfWidth: fx(9.875), soft: true, ledges: false },
      ],
    };
    const s = createStage3D(odd);
    const ms = meshes(s);
    expect(ms).toHaveLength(2);
    odd.platforms.forEach((p, i) => {
      const box = new Box3().setFromObject(ms[i]);
      expect(box.max.y).toBeCloseTo(toFloat(p.y), 6);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(toFloat(p.x), 6);
      expect((box.max.x - box.min.x) / 2).toBeCloseTo(toFloat(p.halfWidth), 6);
    });
    s.dispose();
  });

  it("holds for every form of every stage, centre and span included", () => {
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      const ms = meshes(s);
      expect(ms.length, stage.id).toBe(stage.platforms.length);
      ms.forEach((m, i) => {
        const p = stage.platforms[i];
        const box = new Box3().setFromObject(m);
        expect(box.max.y, `${stage.id} #${i}`).toBeCloseTo(toFloat(p.y), 6);
        expect(box.min.x, `${stage.id} #${i}`).toBeCloseTo(toFloat(p.x - p.halfWidth), 6);
        expect(box.max.x, `${stage.id} #${i}`).toBeCloseTo(toFloat(p.x + p.halfWidth), 6);
      });
      s.dispose();
    }
  });

  it("keeps a moving platform's whole span on the sim's, frame after frame", () => {
    const stage = STAGES.find((st) => st.platforms.some((p) => p.motion))!;
    const i = stage.platforms.findIndex((p) => p.motion);
    const p = stage.platforms[i];
    const s = createStage3D(stage);
    for (const frame of [0, 1, 59, 600, 1234, -7]) {
      s.update(frame);
      const box = new Box3().setFromObject(meshes(s)[i]);
      const cx = toFloat(platformCentreX(p, frame));
      expect(box.min.x).toBeCloseTo(cx - toFloat(p.halfWidth), 6);
      expect(box.max.x).toBeCloseTo(cx + toFloat(p.halfWidth), 6);
    }
    s.dispose();
  });

  it("never draws a solid body the sim does not have: a main body sits inside the sim's solid", () => {
    // The sim's hard platform is a wall-sided solid `HARD_PLATFORM_DEPTH` deep.
    // The drawn body tapers inside it, so a fighter is never visibly inside stage
    // that the collision lets them through.
    expect(MAIN_DEPTH).toBeLessThanOrEqual(toFloat(HARD_PLATFORM_DEPTH));
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      meshes(s).forEach((m, i) => {
        const p = stage.platforms[i];
        const box = new Box3().setFromObject(m);
        if (p.soft) {
          // A soft platform has no body in the sim at all: only its top surface.
          expect(box.max.y - box.min.y, `${stage.id} #${i}`).toBeLessThan(MAIN_DEPTH / 10);
        } else {
          expect(box.min.y, `${stage.id} #${i}`).toBeGreaterThanOrEqual(toFloat(p.y - HARD_PLATFORM_DEPTH));
          expect(box.min.x, `${stage.id} #${i}`).toBeGreaterThanOrEqual(toFloat(p.x - p.halfWidth));
          expect(box.max.x, `${stage.id} #${i}`).toBeLessThanOrEqual(toFloat(p.x + p.halfWidth));
        }
      });
      s.dispose();
    }
  });
});
