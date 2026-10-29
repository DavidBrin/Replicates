// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import {
  ALPHA_CUTOFF,
  ALPHA_CUTOFF_OVERRIDES,
  JOINT_TOLERANCE,
  MAX_PRIMITIVES,
  alphaCutoffFor,
  alphaModeFor,
  alphaModes,
  optimizeGlb,
  skeletonRecord,
  verifyGlb,
} from "../../../scripts/models/glb.mjs";
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

// A skinned stand-in fighter: `Hip` at y 1, `Head` at y 2 (the two joints verify insists on).
const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const DUMP = { bones: [{ name: "Hip", world: translate(0, 1, 0) }, { name: "Head", world: translate(0, 2, 0) }] };
const WHITE = [1, 1, 1, 1];

/** A 4×4 grey RGBA PNG whose texel i has alpha `alpha(i)` (0–255). */
async function png(alpha: (i: number) => number): Promise<Uint8Array> {
  const raw = Buffer.alloc(16 * 4);
  for (let i = 0; i < 16; i++) raw.set([128, 128, 128, alpha(i)], i * 4);
  return new Uint8Array(await sharp(raw, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer());
}

interface MaterialSpec {
  /** The colour texture's alpha per texel; no texture when absent. */
  readonly alpha?: (i: number) => number;
  readonly factorAlpha?: number;
  /** As Blender writes it: BLEND for every material whose texture alpha is linked. */
  readonly mode?: "OPAQUE" | "MASK" | "BLEND";
}

interface Fixture {
  readonly materials: Record<string, MaterialSpec>;
  /** One triangle each, skinned to Hip and Head, with a COLOR_0 when `color0` is given. */
  readonly prims: readonly { readonly material: string; readonly color0?: readonly number[] }[];
  /** The Head joint's inverse bind translation y; −2 inverts its bind pose. */
  readonly headIbmY?: number;
}

async function fixtureDoc(f: Fixture): Promise<Document> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const hip = doc.createNode("Hip").setTranslation([0, 1, 0]);
  const head = doc.createNode("Head").setTranslation([0, 1, 0]);
  hip.addChild(head);
  const ibm = doc
    .createAccessor()
    .setType("MAT4")
    .setArray(new Float32Array([...translate(0, -1, 0), ...translate(0, f.headIbmY ?? -2, 0)]))
    .setBuffer(buffer);
  const skin = doc.createSkin("armature").addJoint(hip).addJoint(head).setInverseBindMatrices(ibm);
  const materials = new Map<string, ReturnType<Document["createMaterial"]>>();
  for (const [name, spec] of Object.entries(f.materials)) {
    const mat = doc.createMaterial(name).setBaseColorFactor([1, 1, 1, spec.factorAlpha ?? 1]).setAlphaMode(spec.mode ?? "BLEND");
    if (spec.alpha) mat.setBaseColorTexture(doc.createTexture(`${name}_col`).setImage(await png(spec.alpha)).setMimeType("image/png"));
    materials.set(name, mat);
  }
  const mesh = doc.createMesh("body");
  f.prims.forEach((p, k) => {
    const accessor = (type: "VEC3" | "VEC4", array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", accessor("VEC3", new Float32Array([k, 0, 0, k + 1, 0, 0, k, 1, 0])))
      .setAttribute("JOINTS_0", accessor("VEC4", new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])))
      .setAttribute("WEIGHTS_0", accessor("VEC4", new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])))
      .setMaterial(materials.get(p.material)!);
    if (p.color0) prim.setAttribute("COLOR_0", accessor("VEC4", new Float32Array([...p.color0, ...p.color0, ...p.color0])));
    mesh.addPrimitive(prim);
  });
  doc.createScene().addChild(hip).addChild(doc.createNode("body").setMesh(mesh).setSkin(skin));
  return doc;
}

async function fixtureGlb(name: string, f: Fixture): Promise<string> {
  const file = join(dir, `${name}.glb`);
  await new NodeIO().write(file, await fixtureDoc(f));
  return file;
}

const OPAQUE_SKIN: Fixture = { materials: { skin: { alpha: () => 255, mode: "OPAQUE" } }, prims: [{ material: "skin" }] };

describe("verifyGlb's skeleton checks", () => {
  it("passes a skinned fighter whose joints and inverse binds match the dump", async () => {
    const r = await verifyGlb(await fixtureGlb("fine", OPAQUE_SKIN), DUMP);
    expect(r.problems).toEqual([]);
    expect(r.joints).toBe(2);
  });

  it("holds every joint to JOINT_TOLERANCE (2e-3) of the dump's bind pose — Link's swords, the worst real case, are 9.7e-4", async () => {
    expect(JOINT_TOLERANCE).toBe(2e-3);
    const file = await fixtureGlb("joints", OPAQUE_SKIN);
    const headAt = (y: number) => ({ bones: [DUMP.bones[0], { name: "Head", world: translate(0, y, 0) }] });
    expect((await verifyGlb(file, headAt(2.0015))).problems).toEqual([]);
    expect((await verifyGlb(file, headAt(2.003))).problems).toContainEqual(expect.stringContaining("joint Head is 0.0030 from the dump's bind pose"));
  });

  it("refuses a dump bone the skin lacks instead of skipping it", async () => {
    const r = await verifyGlb(await fixtureGlb("missing", OPAQUE_SKIN), { bones: [...DUMP.bones, { name: "Extra", world: translate(0, 3, 0) }] });
    expect(r.problems).toContainEqual(expect.stringContaining("no joint for bone Extra"));
  });

  it("refuses an inverse bind matrix that does not undo its joint's bind pose", async () => {
    const r = await verifyGlb(await fixtureGlb("ibm", { ...OPAQUE_SKIN, headIbmY: -2.5 }), DUMP);
    expect(r.problems).toContainEqual(expect.stringContaining("inverse bind matrix of joint Head"));
  });
});

describe("alpha modes, decided from the colour alpha at export", () => {
  it("alphaModeFor: BLEND only for a translucent factor, MASK for texels below the cutoff, else OPAQUE", () => {
    expect(ALPHA_CUTOFF).toBe(0.5);
    expect(alphaModeFor(1, 0)).toBe("OPAQUE");
    expect(alphaModeFor(1, 3)).toBe("MASK");
    expect(alphaModeFor(0.851, 0)).toBe("BLEND"); // Fox's scouter
    expect(alphaModeFor(0.851, 3)).toBe("BLEND");
  });

  it("alphaModes reads each texture: Marth's 213–255 cloth is OPAQUE, a cut-out is MASK at 0.5, the scouter BLEND", async () => {
    const doc = await fixtureDoc({
      materials: {
        def_marth_001: { alpha: (i) => (i % 2 ? 213 : 255) },
        hair: { alpha: (i) => (i < 6 ? 0 : 255) },
        scouter: { factorAlpha: 0.851 },
        edge128: { alpha: () => 128 },
        edge127: { alpha: (i) => (i === 0 ? 127 : 255) },
      },
      prims: [{ material: "def_marth_001" }],
    });
    await doc.transform(alphaModes());
    const mode = (name: string) => doc.getRoot().listMaterials().find((m) => m.getName() === name)!;
    expect(mode("def_marth_001").getAlphaMode()).toBe("OPAQUE");
    expect(mode("hair").getAlphaMode()).toBe("MASK");
    expect(mode("hair").getAlphaCutoff()).toBe(0.5);
    expect(mode("scouter").getAlphaMode()).toBe("BLEND");
    expect(mode("edge128").getAlphaMode()).toBe("OPAQUE");
    expect(mode("edge127").getAlphaMode()).toBe("MASK");
  });

  it("a cut-out the lab showed wrong has its own cutoff, named by fighter and material; every other material keeps 0.5", async () => {
    // Donkey Kong's `alp` is the hair and fur-edge card. At 0.5 the hair is a speckle of strands over the void
    // (the animation lab's model sheet, Plan 4 Task 21); at 0.1 it is the mop. UNVERIFIED: by eye.
    expect(ALPHA_CUTOFF_OVERRIDES).toEqual({ "donkeyKong/alp": 0.1 });
    expect(alphaCutoffFor("donkeyKong", "alp")).toBe(0.1);
    expect(alphaCutoffFor("donkeyKong", "body")).toBe(ALPHA_CUTOFF);
    // The same material name on another fighter is another material.
    expect(alphaCutoffFor("mario", "alp")).toBe(ALPHA_CUTOFF);
    expect(alphaCutoffFor(null, "alp")).toBe(ALPHA_CUTOFF);
    expect(alphaCutoffFor("toString", "constructor")).toBe(ALPHA_CUTOFF);

    const spec = { materials: { alp: { alpha: (i: number) => (i < 6 ? 0 : 255) }, hair: { alpha: (i: number) => (i < 6 ? 0 : 255) } }, prims: [{ material: "alp" }] };
    const cutoffs = async (fighter?: string) => {
      const doc = await fixtureDoc(spec);
      await doc.transform(alphaModes(fighter));
      const by = (name: string) => doc.getRoot().listMaterials().find((m) => m.getName() === name)!;
      return [by("alp").getAlphaMode(), by("alp").getAlphaCutoff(), by("hair").getAlphaMode(), by("hair").getAlphaCutoff()];
    };
    expect(await cutoffs("donkeyKong")).toEqual(["MASK", 0.1, "MASK", 0.5]);
    expect(await cutoffs("mario")).toEqual(["MASK", 0.5, "MASK", 0.5]);
    expect(await cutoffs()).toEqual(["MASK", 0.5, "MASK", 0.5]);
  });

  it("verify refuses a BLEND material that is effectively opaque (three.js would draw it without depth writes)", async () => {
    const opaqueBlend = await verifyGlb(await fixtureGlb("blend-opaque", { materials: { cloth: { alpha: (i) => (i % 2 ? 213 : 255), mode: "BLEND" } }, prims: [{ material: "cloth" }] }), DUMP);
    expect(opaqueBlend.problems).toContainEqual(expect.stringContaining("material cloth is BLEND but nothing in it is below alpha 0.5"));
    const scouter = await verifyGlb(await fixtureGlb("blend-scouter", { materials: { scouter: { factorAlpha: 0.851, mode: "BLEND" } }, prims: [{ material: "scouter" }] }), DUMP);
    expect(scouter.problems).toEqual([]);
  });
});

describe("optimizeGlb", () => {
  const decoderIo = async () => {
    await MeshoptDecoder.ready;
    return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  };

  it("joins a mesh's primitives that share a material, drops a white COLOR_0, sets the alpha modes, and still verifies", async () => {
    const input = await fixtureGlb("to-optimize", {
      materials: { skin: { alpha: (i) => (i % 2 ? 213 : 255) }, hair: { alpha: (i) => (i < 6 ? 0 : 255) } },
      prims: [
        { material: "skin", color0: WHITE },
        { material: "skin", color0: WHITE },
        { material: "hair", color0: [0.5, 0.5, 0.5, 1] },
      ],
    });
    const output = join(dir, "optimized.glb");
    await optimizeGlb(input, output);
    const prims = (await (await decoderIo()).read(output)).getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    expect(prims.map((p) => [p.getMaterial()!.getName(), p.getMaterial()!.getAlphaMode(), p.getAttribute("COLOR_0") !== null]).sort()).toEqual([
      ["hair", "MASK", true], // a real vertex colour stays
      ["skin", "OPAQUE", false], // two primitives, one draw call; Blender's placeholder white COLOR_0 gone
    ]);
    expect((await verifyGlb(output, DUMP)).problems).toEqual([]);
  });
});

describe("optimizeGlb for a named fighter", () => {
  it("applies that fighter's cut-out override to its material, and only to it", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const input = await fixtureGlb("fighter-override", {
      // Different textures, or `dedup()` would fold the two materials into one.
      materials: { alp: { alpha: (i) => (i < 6 ? 0 : 255) }, hair: { alpha: (i) => (i < 9 ? 0 : 255) } },
      prims: [{ material: "alp" }, { material: "hair" }],
    });
    const cutoffs = async (name: string, fighter?: string) => {
      const output = join(dir, `${name}.glb`);
      await optimizeGlb(input, output, fighter);
      const mats = (await io.read(output)).getRoot().listMaterials();
      return mats.map((m) => [m.getName(), m.getAlphaMode(), m.getAlphaCutoff()]).sort();
    };
    expect(await cutoffs("kong", "donkeyKong")).toEqual([["alp", "MASK", 0.1], ["hair", "MASK", 0.5]]);
    expect(await cutoffs("anyone")).toEqual([["alp", "MASK", 0.5], ["hair", "MASK", 0.5]]);
  });

  it("`pnpm models` names the fighter it is building, or no override would ever apply", () => {
    expect(readFileSync(join(process.cwd(), "scripts", "models", "build.mjs"), "utf8")).toContain("await optimizeGlb(raw, opt, id);");
  });
});

describe("skeletonRecord: which committed skeleton index.json says a glb was built against", () => {
  const committed = Buffer.from(JSON.stringify({ schema: 1, fighter: "mario", bones: DUMP.bones, hurt: [] }));
  const sha = createHash("sha256").update(committed).digest("hex");

  it("is the committed file's SHA-256 when every committed bone is where Blender's dump has it", () => {
    expect(skeletonRecord(committed, DUMP)).toEqual({ sha, drift: [] });
  });

  it("is null when a bone drifted, so models:check refuses an --allow-skeleton-drift build", () => {
    const moved = { bones: [DUMP.bones[0], { name: "Head", world: translate(0, 2.0002, 0) }] };
    expect(skeletonRecord(committed, moved)).toEqual({ sha: null, drift: ["Head"] });
    expect(skeletonRecord(committed, { bones: [DUMP.bones[0]] })).toEqual({ sha: null, drift: ["Head"] });
  });

  it("is null when there is no committed skeleton", () => {
    expect(skeletonRecord(null, DUMP)).toEqual({ sha: null, drift: null });
  });
});

describe("the verify CLI never passes silently", () => {
  const ROOT = process.cwd();
  const runVerify = (script: string, glb: string, dump: string) =>
    spawnSync(process.execPath, [script, "verify", glb, dump], { encoding: "utf8" });

  it("fails a bad glb when run through a symlinked directory or from a real path with a space", async () => {
    const bad = await glbWith(MAX_PRIMITIVES + 1);
    const dump = join(dir, "empty-dump.json");
    writeFileSync(dump, JSON.stringify({ bones: [] }));

    // A symlink (as macOS's /tmp is): node resolves the script's real path, argv keeps the link.
    const linked = mkdtempSync(join(tmpdir(), "glb cli link "));
    symlinkSync(join(ROOT, "scripts", "models"), join(linked, "models"), "dir");
    // A real path with a space, inside the package so the script's imports resolve.
    mkdirSync(join(ROOT, ".model-cache"), { recursive: true });
    const spaced = mkdtempSync(join(ROOT, ".model-cache", "glb cli "));
    copyFileSync(join(ROOT, "scripts", "models", "glb.mjs"), join(spaced, "glb.mjs"));
    try {
      for (const script of [join(linked, "models", "glb.mjs"), join(spaced, "glb.mjs")]) {
        const r = runVerify(script, bad, dump);
        expect(r.status, script).toBe(1);
        expect(r.stderr, script).toContain(`${MAX_PRIMITIVES + 1} primitives > ${MAX_PRIMITIVES}`);
      }
      // …and still runs (prints the summary, exits 0) on a fit glb.
      writeFileSync(join(dir, "dump.json"), JSON.stringify(DUMP));
      const ok = runVerify(join(linked, "models", "glb.mjs"), await fixtureGlb("cli-fine", OPAQUE_SKIN), join(dir, "dump.json"));
      expect(ok.status).toBe(0);
      expect(JSON.parse(ok.stdout)).toMatchObject({ primitives: 1, joints: 2 });
    } finally {
      rmSync(linked, { recursive: true, force: true });
      rmSync(spaced, { recursive: true, force: true });
    }
  });
});
