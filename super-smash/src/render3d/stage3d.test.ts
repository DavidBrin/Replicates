import { describe, expect, it, vi } from "vitest";
import { Box3, Color, Mesh, Vector3, type Material } from "three";

import { fx, toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import type { StageDef } from "@/engine/types";
import { stagePaintFor } from "@/render/stageArt";
import { STAGES, allStageForms } from "@/stages";
import { LIP_HEIGHT, MAIN_DEPTH, MAIN_DEPTH_Z, createStage3D, prismGeometry } from "./stage3d";

/**
 * The stage's bodies, one per platform. The decorative underside (Plan 6, Task 33) is not one
 * of them: it is no surface, sits behind the play plane, and nothing the sim does meets it.
 */
const meshes = (s: ReturnType<typeof createStage3D>) => s.group.children.filter((c): c is Mesh => c instanceof Mesh && c.name !== "underside");

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

  it("draws a hard platform as exactly the sim's solid and a soft one as only a skin on its surface", () => {
    // The sim's hard platform is a wall-sided solid `HARD_PLATFORM_DEPTH` deep (R13):
    // what a fighter is pushed off, or bonks its head on, is what is drawn.
    expect(MAIN_DEPTH).toBe(toFloat(HARD_PLATFORM_DEPTH));
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      meshes(s).forEach((m, i) => {
        const p = stage.platforms[i];
        const label = `${stage.id} #${i}`;
        const box = new Box3().setFromObject(m);
        if (p.soft) {
          // The sim gives a soft platform no body: only its top surface. A skin, not a block.
          expect(box.max.y - box.min.y, label).toBeLessThanOrEqual(2);
          return;
        }
        expect(box.min.y, label).toBeCloseTo(toFloat(p.y - HARD_PLATFORM_DEPTH), 6);
        // Straight walls: every vertex, the bottom ones included, is at the span's edge.
        // A bounding box cannot see a taper (the top is the widest part), so look at each vertex.
        const pos = m.geometry.getAttribute("position");
        for (let v = 0; v < pos.count; v++) expect(Math.abs(pos.getX(v)), label).toBeCloseTo(toFloat(p.halfWidth), 6);
      });
      s.dispose();
    }
  });

  it("only moves the platforms that move", () => {
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      s.update(999);
      meshes(s).forEach((m, i) => {
        const p = stage.platforms[i];
        if (!p.motion) expect(m.position.x, `${stage.id} #${i}`).toBe(toFloat(p.x));
      });
      s.dispose();
    }
  });
});

/** Every triangle of a mesh with its stored and geometric normals, centroid and vertex colour. */
function triangles(m: Mesh) {
  const pos = m.geometry.getAttribute("position");
  const nor = m.geometry.getAttribute("normal");
  const col = m.geometry.getAttribute("color");
  const out: { geometric: Vector3; stored: Vector3; centroid: Vector3; colour: Color }[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const a = new Vector3().fromBufferAttribute(pos, t);
    const b = new Vector3().fromBufferAttribute(pos, t + 1);
    const c = new Vector3().fromBufferAttribute(pos, t + 2);
    out.push({
      geometric: new Vector3().subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize(),
      stored: new Vector3().fromBufferAttribute(nor, t),
      centroid: a.clone().add(b).add(c).divideScalar(3),
      colour: new Color().fromBufferAttribute(col, t),
    });
  }
  return out;
}

const sameColour = (got: Color, hex: string) => {
  const want = new Color(hex);
  expect(got.r).toBeCloseTo(want.r, 5);
  expect(got.g).toBeCloseTo(want.g, 5);
  expect(got.b).toBeCloseTo(want.b, 5);
};

describe("the 3D stage's paint and faces", () => {
  /** The top and deepest face of each stage's main platform, as the 2D art paints them (`stageArt.ts` PAINTS). */
  const PALETTE: Record<string, { top: string; deep: string }> = {
    battlefield: { top: "#6FA8D6", deep: "#16233A" },
    finalDestination: { top: "#8E6FD6", deep: "#1A1230" },
    smallBattlefield: { top: "#6FA8D6", deep: "#16233A" },
    smashville: { top: "#7ECB5A", deep: "#22401C" },
    townAndCity: { top: "#C9CEDA", deep: "#2A2F3E" },
    pokemonStadium2: { top: "#C8B58A", deep: "#3A3222" },
  };
  const NEUTRAL = { top: "#9AA4B2", deep: "#232833" };

  it("gives every stage its own palette, never the neutral fallback", () => {
    expect(Object.keys(PALETTE).sort()).toEqual(STAGES.map((st) => st.id).sort());
    const tops = new Set<string>();
    for (const stage of STAGES) {
      const paint = stagePaintFor(stage);
      expect(paint.top, stage.id).toBe(PALETTE[stage.id].top);
      expect(paint.deep, stage.id).toBe(PALETTE[stage.id].deep);
      expect(paint.top, stage.id).not.toBe(NEUTRAL.top);
      tops.add(paint.top);
    }
    // Five themes across six stages: the two Battlefield skins share one.
    expect(tops.size).toBe(5);
    // A theme nothing recognises falls back to neutral, and only then.
    expect(stagePaintFor({ theme: "no such theme" }).top).toBe(NEUTRAL.top);
  });

  it("paints a hard body's top, walls and underside in the stage's top, face and deep colours", () => {
    for (const stage of STAGES) {
      const paint = stagePaintFor(stage);
      const s = createStage3D(stage);
      meshes(s).forEach((m, i) => {
        const label = `${stage.id} #${i}`;
        const soft = stage.platforms[i].soft;
        let up = 0;
        let down = 0;
        let side = 0;
        for (const t of triangles(m)) {
          if (t.stored.y > 0.99) {
            up++;
            sameColour(t.colour, soft ? paint.softEdge : paint.top);
          } else if (t.stored.y < -0.99) {
            down++;
            sameColour(t.colour, soft ? paint.soft : paint.deep);
          } else {
            side++;
            expect(Math.abs(t.stored.y), label).toBeLessThan(1e-6);
            // A hard body's front face starts with the ledge lip, in the edge colour (Plan 6,
            // Task 33); every other wall triangle starts at a top corner, in the face colour.
            const lip = !soft && t.stored.z > 0.99 && t.centroid.y > -LIP_HEIGHT;
            sameColour(t.colour, soft ? paint.soft : lip ? paint.edge : paint.face);
          }
        }
        // A box: two triangles on the top, two underneath, eight on the walls, and a hard
        // body's two more for the lip, its front face split where the lip ends.
        expect([up, down, side], label).toEqual(soft ? [2, 2, 8] : [2, 2, 10]);
      });
      s.dispose();
    }
  });

  it("winds every face outward, so the top is seen from above and no face is culled from view", () => {
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      meshes(s).forEach((m, i) => {
        const centre = new Box3().setFromObject(m).getCenter(new Vector3()).sub(m.position);
        for (const t of triangles(m)) {
          expect(t.geometric.dot(t.stored), `${stage.id} #${i}`).toBeGreaterThan(0.999);
          expect(t.stored.dot(t.centroid.clone().sub(centre)), `${stage.id} #${i}`).toBeGreaterThan(0);
        }
      });
      s.dispose();
    }
  });

  it("can still taper a prism: the bottom narrows by the taper and the top stays full width", () => {
    const rgb = [0.5, 0.5, 0.5] as const;
    const g = prismGeometry(10, 8, 0.5, 6, rgb, rgb, rgb);
    const pos = g.getAttribute("position");
    for (let v = 0; v < pos.count; v++) {
      expect(Math.abs(pos.getX(v))).toBeCloseTo(pos.getY(v) === 0 ? 10 : 5, 6);
    }
    g.dispose();
  });
});

describe("the ledge lip, the shaded walls and the underside (Plan 6, Task 33)", () => {
  const bf = STAGES.find((st) => st.id === "battlefield")!;
  const fd = STAGES.find((st) => st.id === "finalDestination")!;
  /** The main body's mesh, as the stage builds it. */
  const mainMesh = (stage: StageDef): Mesh => meshes(createStage3D(stage))[stage.platforms.findIndex((p) => !p.soft)];
  /** Vertex `i`'s colour is `hex`, to float32's precision. */
  const isColour = (m: Mesh, i: number, hex: string): boolean => {
    const c = m.geometry.getAttribute("color");
    const want = new Color(hex);
    return Math.abs(c.getX(i) - want.r) < 1e-5 && Math.abs(c.getY(i) - want.g) < 1e-5 && Math.abs(c.getZ(i) - want.b) < 1e-5;
  };

  it("paints the top band of a hard body's front face in the stage's edge colour: the ledge lip", () => {
    const paint = stagePaintFor(bf);
    const m = mainMesh(bf);
    const pos = m.geometry.getAttribute("position");
    const lip = [...Array(pos.count).keys()].filter((i) => pos.getZ(i) === MAIN_DEPTH_Z / 2 && isColour(m, i, paint.edge));
    expect(lip.length).toBe(6);
    expect(lip.every((i) => pos.getY(i) >= -LIP_HEIGHT - 1e-5)).toBe(true);
  });

  it("shades a hard body's walls from the face colour at the top to the deep colour at the bottom", () => {
    const paint = stagePaintFor(fd);
    const m = mainMesh(fd);
    const pos = m.geometry.getAttribute("position");
    const normal = m.geometry.getAttribute("normal");
    const walls = [...Array(pos.count).keys()].filter((i) => Math.abs(normal.getY(i)) < 1e-6);
    const bottom = walls.filter((i) => pos.getY(i) === -MAIN_DEPTH);
    const above = walls.filter((i) => pos.getY(i) > -MAIN_DEPTH && !isColour(m, i, paint.edge));
    // Four walls, each two triangles with three corners on the bottom edge between them.
    expect(bottom.length).toBe(12);
    expect(bottom.every((i) => isColour(m, i, paint.deep))).toBe(true);
    expect(above.every((i) => isColour(m, i, paint.face))).toBe(true);
  });

  it("hangs a decorative tapered underside behind the play plane, under Battlefield's floor, and none under Final Destination's", () => {
    const s = createStage3D(bf);
    const under = s.group.children.find((o) => o.name === "underside");
    expect(under).toBeDefined();
    const box = new Box3().setFromObject(under!);
    const main = bf.platforms.find((p) => !p.soft)!;
    // Wholly behind the play plane, so a fighter under the stage is drawn in front of it.
    expect(box.max.z).toBeLessThan(0);
    // Hung from the body's bottom (Battlefield's floor is at 0.111), and tapering 34 below it.
    expect(box.max.y).toBeCloseTo(toFloat(main.y) - MAIN_DEPTH, 5);
    expect(box.min.y).toBeCloseTo(toFloat(main.y) - MAIN_DEPTH - 34, 5);
    s.dispose();
    expect(createStage3D(fd).group.children.some((o) => o.name === "underside")).toBe(false);
  });

  /**
   * Ruling D11 (Plan 6, Task 33): the stage's depth toward the camera is decoration, so it
   * never hides the play plane. Drawn first and writing no depth, it is covered by every
   * fighter, shield and spark, a fighter hugging a wall below the ledge included.
   */
  it("draws every stage mesh first, writing no depth (ruling D11)", () => {
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      for (const m of s.group.children as Mesh[]) {
        expect((m.material as Material).depthWrite, stage.id).toBe(false);
        expect(m.renderOrder, stage.id).toBeLessThan(0);
      }
      s.dispose();
    }
  });
});
