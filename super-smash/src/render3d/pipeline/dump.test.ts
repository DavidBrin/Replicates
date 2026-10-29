import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { testSkeleton } from "../skeleton/testSkeleton";
import { DUMP_SCHEMA, RIGID_TOLERANCE_DUMP, parseBoneDump, skeletonFromDump, type BoneDump } from "./dump";

/** A dump shaped exactly as export_gltf.py writes it, on the invented skeleton. */
function dump(over: Partial<BoneDump> = {}): BoneDump {
  const s = testSkeleton("mario");
  return {
    schema: DUMP_SCHEMA,
    fighter: "mario",
    code: "mario",
    blender: "5.2.2",
    blend: "mario-c00.blend",
    space: "ssbu-model",
    bones: s.bones,
    hurt: s.hurt,
    meshes: [
      { name: "c00bodyShape", kept: true, verts: 2664, polys: 4124 },
      { name: "Mario_FaceN_VIS_O_OBJShape", kept: true, verts: 209, polys: 302 },
      { name: "Mario_Blink_VIS_O_OBJShape", kept: false, verts: 70, polys: 96 },
    ],
    materials: [{ name: "skin_mario_001", image: "skin_mario_001_col.png" }],
    ...over,
  } as BoneDump;
}

const moveBone = (d: BoneDump, name: string, x: number, y: number, z: number) =>
  d.bones.map((b) => (b.name === name ? { ...b, world: [...b.world.slice(0, 12), x, y, z, 1] } : b));

describe("the Blender spike's bone dump", () => {
  it("accepts the schema export_gltf.py writes", () => {
    expect(parseBoneDump(dump()).fighter).toBe("mario");
  });

  it("refuses a dump still in Blender's Z-up space (head not above the hips)", () => {
    const d = dump();
    expect(() => parseBoneDump({ ...d, bones: moveBone(d, "Head", 0, 0, 10) })).toThrow(/mario: up is not \+Y/);
  });

  it("refuses a mirrored dump (toes behind the ankles)", () => {
    const d = dump();
    expect(() => parseBoneDump({ ...d, bones: moveBone(d, "ToeL", 1.2, 0.8, -1.3) })).toThrow(/forward is not \+Z \(ToeL/);
  });

  it("admits SSBU's authored helper-bone residue (4.28e-3, measured) up to RIGID_TOLERANCE_DUMP, and never a mirror", () => {
    expect(RIGID_TOLERANCE_DUMP).toBe(5e-3);
    const d = dump();
    const withKneeL = (edit: (w: number[]) => number[]) => ({ ...d, bones: d.bones.map((b) => (b.name === "KneeL" ? { ...b, world: edit([...b.world]) } : b)) });
    const longX = (f: number) => (w: number[]) => w.map((v, i) => (i < 3 ? v * f : v));
    const shearXZ = (s: number) => (w: number[]) => w.map((v, i) => (i >= 8 && i < 11 ? v + s * w[i - 8] : v));
    // Mario's H_LegL: X 4.28e-3 long.
    expect(() => parseBoneDump(withKneeL(longX(1 + 4.28e-3)))).not.toThrow();
    expect(() => parseBoneDump(withKneeL(longX(1 + 4.5e-3)))).not.toThrow();
    expect(() => parseBoneDump(withKneeL(shearXZ(4.5e-3)))).not.toThrow();
    expect(() => parseBoneDump(withKneeL(longX(1 + 6e-3)))).toThrow(/bone "KneeL" world matrix is scaled: its X axis has length 1\.006/);
    expect(() => parseBoneDump(withKneeL(shearXZ(6e-3)))).toThrow(/bone "KneeL" world matrix is sheared: its X and Z axes/);
    expect(() => parseBoneDump(withKneeL((w) => w.map((v, i) => (i >= 8 && i < 11 ? -v : v))))).toThrow(/bone "KneeL" world matrix is a mirror image/);
  });

  it("refuses a dump that kept no mesh, has no materials or too few hurt capsules", () => {
    expect(() => parseBoneDump(dump({ meshes: [] }))).toThrow(/no mesh kept/);
    expect(() => parseBoneDump(dump({ materials: [] }))).toThrow(/no materials/);
    expect(() => parseBoneDump(dump({ hurt: dump().hurt.slice(0, 3) }))).toThrow(/only 3 hurt capsules/);
  });

  it("trims to the needed bones and their ancestors, rounded to five decimals", () => {
    const s = skeletonFromDump(dump(), new Set(["kneer", "head"]));
    expect(s.bones.map((b) => b.name)).toEqual(["Trans", "Rot", "Hip", "Waist", "Bust", "Neck", "Head", "LegC", "LegR", "KneeR"]);
    for (const b of s.bones) for (const v of b.world) expect(Math.round(v * 1e5) / 1e5).toBe(v);
  });
});

describe("the local dumps (when `pnpm models:skeletons` or `pnpm models` has run)", () => {
  const dir = join(process.cwd(), ".model-cache", "dumps");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const read = (f: string) => parseBoneDump(JSON.parse(readFileSync(join(dir, f), "utf8")));
  it.skipIf(files.length === 0)("all parse, so a bad export fails here before it reaches the bake", () => {
    for (const f of files) expect(read(f).fighter).toBe(f.replace(/(\.sdna)?\.json$/, ""));
  });

  // Blender (Task 8) and the stdlib reader (Task 6) read the same .blend; the
  // committed skeletons come from the reader, the glbs from Blender. They must agree.
  const pairs = files.filter((f) => f.endsWith(".sdna.json") && files.includes(f.replace(".sdna.json", ".json")));
  it.skipIf(pairs.length === 0)("Blender's dump and the SDNA reader's agree on every bone, kept mesh and hurt capsule", () => {
    for (const f of pairs) {
      const sdna = read(f);
      const blender = read(f.replace(".sdna.json", ".json"));
      const byName = new Map(blender.bones.map((b) => [b.name, b]));
      expect(sdna.bones.map((b) => b.name).sort(), sdna.fighter).toEqual(blender.bones.map((b) => b.name).sort());
      for (const b of sdna.bones) {
        const off = Math.max(...b.world.map((v, i) => Math.abs(v - byName.get(b.name)!.world[i])));
        expect(off, `${sdna.fighter} ${b.name}`).toBeLessThan(1e-4);
      }
      const kept = (d: BoneDump) => d.meshes.filter((m) => m.kept).map((m) => m.name).sort();
      expect(kept(sdna), sdna.fighter).toEqual(kept(blender));
      expect(sdna.hurt.map((h) => h.bone), sdna.fighter).toEqual(blender.hurt.map((h) => h.bone));
      sdna.hurt.forEach((h, i) => {
        const o = blender.hurt[i];
        expect(Math.max(Math.abs(h.x1 - o.x1), Math.abs(h.x2 - o.x2), Math.abs(h.r - o.r)), `${sdna.fighter} ${h.bone}`).toBeLessThan(1e-3);
      });
    }
  });
});
