// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document, NodeIO } from "@gltf-transform/core";
import { afterAll, describe, expect, it } from "vitest";

import { MAX_PRIMITIVES, verifyGlb } from "../../../scripts/models/glb.mjs";
import { MAX_FIGHTER_PRIMITIVES } from "../budget";

const dir = mkdtempSync(join(tmpdir(), "glb-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A one-triangle-per-primitive glb with `n` primitives on one mesh. */
async function glbWith(n: number): Promise<string> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh("body");
  for (let i = 0; i < n; i++) {
    const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
    mesh.addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos).setMaterial(doc.createMaterial(`m${i}`)));
  }
  doc.createScene().addChild(doc.createNode("body").setMesh(mesh));
  const file = join(dir, `p${n}.glb`);
  await new NodeIO().write(file, doc);
  return file;
}

describe("verifyGlb's draw-call cap", () => {
  it("passes a fighter drawn in MAX_PRIMITIVES (12) primitives", async () => {
    expect(MAX_PRIMITIVES).toBe(MAX_FIGHTER_PRIMITIVES); // the renderer's budget test assumes this cap
    const r = await verifyGlb(await glbWith(MAX_PRIMITIVES), { bones: [] });
    expect(r.primitives).toBe(MAX_PRIMITIVES);
    expect(r.problems.filter((p: string) => p.includes("primitives"))).toEqual([]);
  });

  it("fails one drawn in more — four fighters must stay a fraction of the 100-draw-call frame", async () => {
    const r = await verifyGlb(await glbWith(MAX_PRIMITIVES + 1), { bones: [] });
    expect(r.problems).toContainEqual(expect.stringContaining(`${MAX_PRIMITIVES + 1} primitives > ${MAX_PRIMITIVES}`));
  });
});
