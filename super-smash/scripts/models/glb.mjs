/**
 * Shrink a Blender-exported fighter glb for the web, and prove what came out
 * (Plan 4). Used by `build.mjs`; also a CLI:
 *
 *   node scripts/models/glb.mjs optimize <in.glb> <out.glb>
 *   node scripts/models/glb.mjs verify <out.glb> <dump.json>
 *
 * optimize: dedup → drop a placeholder-white COLOR_0 → join a mesh's
 * primitives that share a material → prune → weld → alpha modes from the
 * colour alpha → textures to WebP ≤ 1024 px → meshopt (quantised
 * positions/normals/UVs/weights + EXT_meshopt_compression, decoded in the
 * browser by three's bundled MeshoptDecoder — no wasm to host).
 * verify: the R§4 budget per file (≤ 25 MiB, ≤ 120k triangles — a quarter of
 * the 500k scene budget per fighter, leaving the stage room), ≤ 12 primitives
 * (one draw call each: four fighters stay under half of the 100-call frame,
 * `renderer3d.test.ts`), no texture over 1024 px, every bone of the dump a
 * joint within `JOINT_TOLERANCE` of its bind pose, inverse bind matrices that
 * undo those joints, no BLEND material that is really opaque, and a face that
 * draws (`faceProblems`, Task 21b).
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, joinPrimitives, meshopt, prune, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

export const MAX_GLB_BYTES = 25 * 1024 * 1024;
export const MAX_TRIANGLES = 120_000;
export const MAX_TEXTURE = 1024;
/**
 * Draw calls per fighter: export_gltf.py joins the parts, one primitive per
 * material. The most are 9 (Fox: his body and fur card share a texture but not
 * its alpha; Marth: two flattened eyes, Task 21b).
 */
export const MAX_PRIMITIVES = 12;
/**
 * How far a glb joint may sit from the dump's bind pose (largest matrix entry).
 * Every joint of the eight fighters is within 7.5e-5 except Link's Sword1/Sword2
 * (5.4e-4 / 9.7e-4): glTF stores a node as translation, rotation and scale,
 * which cannot hold their authored 1.07e-3 shear. Twice the worst real case,
 * as Task 6's RIGID_TOLERANCE is.
 */
export const JOINT_TOLERANCE = 2e-3;
/**
 * How far apart the joints' `world · inverseBind` may be, relative to their
 * size. They are all one matrix (the mesh's bind transform; after meshopt, the
 * quantisation's), measured within 5.4e-4 (Link's Sword1) and 2e-5 elsewhere.
 */
export const INVERSE_BIND_TOLERANCE = 1e-2;
/** A texel below this alpha is a hole: glTF's default MASK cutoff. */
export const ALPHA_CUTOFF = 0.5;
/**
 * Cut-outs that look wrong at `ALPHA_CUTOFF`, with the cutoff that reads right,
 * by `<fighter>/<material>`. Found in the animation lab's model sheet (Plan 4,
 * Task 21): Donkey Kong's `alp` is the hair and fur-edge card, and at 0.5 his
 * hair is a speckle of strands over the void behind it (the sheet shows the
 * background through the scalp), while at 0.1 it is the mop, and the fur edges
 * at his wrists and ankles keep their ragged shape. Only the cutoff differs:
 * the material stays MASK, so it still writes depth. UNVERIFIED: by eye
 * (0.5, 0.25, 0.1, 0.02 and OPAQUE were looked at; BLEND made the head
 * see-through). Nothing else is overridden.
 *
 * Task 21b found what showed through his scalp: his body (opaque in its
 * source) was cut by this card's alpha, the same PNG's. With the body OPAQUE
 * the card covers only the fur (hair tuft, wrist and ankle edges), and 0.1 and
 * 0.5 look alike in close-ups; kept at 0.1 as Task 21 chose it.
 */
export const ALPHA_CUTOFF_OVERRIDES = Object.freeze({ "donkeyKong/alp": 0.1 });
/**
 * Face materials that ship with no colour texture, and why that is right, by
 * `<fighter>/<material>` (Task 21b). `prune()` folds a texture of one colour
 * into the colour factor, which draws the same.
 */
export const FACE_SOLID_COLOURS = Object.freeze({
  "mario/alp_mario_002": "Mario's moustache: a one-colour texture (sRGB 55/55/57), which prune() folds into the colour factor",
});
/** Skeleton drift: how far a committed bone may sit from Blender's dump (the dump's 6-decimal rounding is 5e-7). */
const SKELETON_TOLERANCE = 1e-4;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function io() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

/**
 * A pass: drop a COLOR_0 that is white everywhere. Blender 5.2's exporter
 * writes one on every primitive when no material reads vertex colour (to "keep
 * the material unchanged"); three.js would then switch `vertexColors` on to
 * multiply by 1.
 */
export function dropWhiteVertexColors() {
  return (doc) => {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const color = prim.getAttribute("COLOR_0");
        if (color === null) continue;
        let white = true;
        const el = [];
        for (let i = 0; i < color.getCount() && white; i++) white = color.getElement(i, el).every((v) => v >= 1 - 1e-6);
        if (white) prim.setAttribute("COLOR_0", null);
      }
    }
  };
}

/**
 * A pass: join each mesh's primitives that share a material, mode and vertex
 * layout into one draw call. gltf-transform's `join()` skips skinned nodes; one
 * mesh is one node and one skin, so nothing needs re-transforming. Blender
 * merges materials by image name and `dedup()` merges identical images after,
 * which left Donkey Kong two primitives on one material.
 */
export function joinByMaterial() {
  return (doc) => {
    const materials = doc.getRoot().listMaterials();
    for (const mesh of doc.getRoot().listMeshes()) {
      const groups = new Map();
      for (const prim of mesh.listPrimitives()) {
        if (prim.listTargets().length > 0) continue;
        const layout = prim
          .listSemantics()
          .sort()
          .map((s) => {
            const a = prim.getAttribute(s);
            return `${s}:${a.getType()}:${a.getComponentType()}:${a.getNormalized()}`;
          });
        const key = [materials.indexOf(prim.getMaterial()), prim.getMode(), prim.getIndices() !== null, ...layout].join("|");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(prim);
      }
      for (const prims of groups.values()) {
        if (prims.length < 2) continue;
        const joined = joinPrimitives(prims);
        for (const prim of prims) prim.dispose();
        mesh.addPrimitive(joined);
      }
    }
  };
}

/** How many texels of an encoded image (PNG, WebP, …) have alpha below `cutoff`, and how many it has. */
async function alphaCount(image, name, cutoff) {
  if (image === null) throw new Error(`texture ${name} has no image data`);
  const { data } = await sharp(Buffer.from(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let below = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < cutoff * 255) below++;
  return { below, texels: data.length / 4 };
}

/** How many texels of an encoded image have alpha below `ALPHA_CUTOFF`. */
async function holesIn(image, name) {
  return (await alphaCount(image, name, ALPHA_CUTOFF)).below;
}

/**
 * The glTF alpha mode a material's colour alpha calls for. BLEND only for a
 * translucent factor (`prune()` folds a solid texture into one: Fox's scouter,
 * 0.851) — the one see-through a texture's holes cannot express; MASK at
 * `ALPHA_CUTOFF` when texels of the colour texture fall below it (hair, fur,
 * eyes cut out of cards); else OPAQUE, partial alpha above the cutoff included
 * (Marth's def_marth_001 is 213–255 and his clothes must not turn see-through).
 * Blender exports BLEND for every material whose alpha is linked, and three.js
 * draws BLEND without depth writes, so a body would sort wrongly against itself.
 * Only those are decided here: a material Blender exports OPAQUE has a source
 * that never reads its texture's alpha (`alphaModes`).
 */
export function alphaModeFor(factorAlpha, holes) {
  if (factorAlpha < 1) return "BLEND";
  return holes > 0 ? "MASK" : "OPAQUE";
}

/**
 * The cutoff a MASK material of `fighter` is exported with: its override, else `ALPHA_CUTOFF`.
 *
 * @param {string | null} fighter
 * @param {string} material
 */
export function alphaCutoffFor(fighter, material) {
  return Object.hasOwn(ALPHA_CUTOFF_OVERRIDES, `${fighter}/${material}`) ? ALPHA_CUTOFF_OVERRIDES[`${fighter}/${material}`] : ALPHA_CUTOFF;
}

/**
 * A pass: set the alpha mode of every material whose alpha export_gltf.py
 * linked (Blender writes those BLEND) with `alphaModeFor`, and a MASK
 * material's cutoff with `alphaCutoffFor` (`fighter` names whose glb this is;
 * without one, every cutoff is the default). A material that arrives OPAQUE
 * stays OPAQUE: its source never reads its texture's alpha, whatever that
 * alpha holds (Donkey Kong's body reads, with its alpha ignored, the PNG whose
 * alpha is his fur card's mask; cut by it, his scalp and temples showed the
 * background, Task 21b). Run after `prune()`, which turns solid textures into
 * factors.
 *
 * @param {string | null} [fighter]
 */
export function alphaModes(fighter = null) {
  return async (doc) => {
    const holesOf = new Map();
    for (const mat of doc.getRoot().listMaterials()) {
      if (mat.getAlphaMode() === "OPAQUE") continue;
      const tex = mat.getBaseColorTexture();
      if (tex !== null && !holesOf.has(tex)) holesOf.set(tex, await holesIn(tex.getImage(), tex.getName()));
      const mode = alphaModeFor(mat.getBaseColorFactor()[3], tex === null ? 0 : holesOf.get(tex));
      mat.setAlphaMode(mode);
      if (mode === "MASK") mat.setAlphaCutoff(alphaCutoffFor(fighter, mat.getName()));
    }
  };
}

/**
 * What is wrong with a built glb's face, empty when nothing (Task 21b). The
 * dump (export_gltf.py's) marks the neutral face's meshes (`face`) and names
 * the glb materials each draws with; a material flattened from two layers
 * carries its `layers`. A fighter must have a face, an eye among it, every
 * face mesh drawn, and every face material: in the glb; with a colour texture,
 * or a reason in `FACE_SOLID_COLOURS`; not fully transparent; never BLEND (a
 * face part drawn without depth writes sorts wrongly against the head); and
 * OPAQUE when flattened (its source mixed colour only, never alpha) or when
 * its source reads no alpha (the dump's `alpha: false`).
 */
export async function faceProblems(doc, dump) {
  const who = dump.fighter ?? "?";
  const faces = dump.meshes.filter((m) => m.face);
  if (faces.length === 0) return [`${who}: the dump names no face mesh (meshes.json \`face\`) — a fighter must not export without its face`];
  const problems = [];
  if (!faces.some((m) => /eye/i.test(m.name))) problems.push(`${who}: no eye among its face meshes (${faces.map((m) => m.name).join(", ")})`);
  const byName = new Map(doc.getRoot().listMaterials().map((m) => [m.getName(), m]));
  const layered = new Set((dump.materials ?? []).filter((m) => m.layers).map((m) => m.name));
  const noAlpha = new Set((dump.materials ?? []).filter((m) => m.alpha === false).map((m) => m.name));
  const checked = new Set();
  for (const mesh of faces) {
    if (!mesh.kept && !mesh.drawOnly) {
      problems.push(`${who}: face mesh ${mesh.name} is not drawn`);
      continue;
    }
    if (!mesh.materials?.length) {
      problems.push(`${who}: face mesh ${mesh.name} draws with no material`);
      continue;
    }
    for (const name of mesh.materials) {
      const mat = byName.get(name);
      if (mat === undefined) {
        problems.push(`${who}: face mesh ${mesh.name} draws with ${name}, which the glb does not have`);
        continue;
      }
      if (checked.has(name)) continue;
      checked.add(name);
      const tex = mat.getBaseColorTexture();
      if (tex === null && !Object.hasOwn(FACE_SOLID_COLOURS, `${who}/${name}`)) {
        problems.push(`${who}: face material ${name} has no colour texture, and FACE_SOLID_COLOURS states no reason`);
      }
      const mode = mat.getAlphaMode();
      if (mode === "BLEND") problems.push(`${who}: face material ${name} is BLEND — a face part drawn without depth writes sorts wrongly against the head`);
      else if (layered.has(name) && mode !== "OPAQUE") problems.push(`${who}: face material ${name} layers two textures into one and must be OPAQUE, not ${mode}`);
      else if (noAlpha.has(name) && mode !== "OPAQUE") problems.push(`${who}: face material ${name} reads no alpha in its source and must be OPAQUE, not ${mode}`);
      if (mode === "MASK") {
        // A texel draws when its alpha times the factor's reaches the cutoff.
        const cutoff = mat.getAlphaCutoff();
        const factor = mat.getBaseColorFactor()[3];
        let cut = factor < cutoff;
        if (!cut && tex !== null) {
          const { below, texels } = await alphaCount(tex.getImage(), tex.getName(), cutoff / factor);
          cut = below === texels;
        }
        if (cut) problems.push(`${who}: face material ${name} is fully transparent (MASK at ${cutoff} cuts every texel)`);
      }
    }
  }
  return problems;
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string | null} [fighter] whose glb this is, for its cut-out overrides (`ALPHA_CUTOFF_OVERRIDES`)
 */
export async function optimizeGlb(input, output, fighter = null) {
  const nio = await io();
  const doc = await nio.read(input);
  await doc.transform(
    dedup(),
    dropWhiteVertexColors(),
    joinByMaterial(),
    prune(),
    weld(),
    alphaModes(fighter),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [MAX_TEXTURE, MAX_TEXTURE] }),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  await nio.write(output, doc);
}

function primitives(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) n += mesh.listPrimitives().length;
  return n;
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : (prim.getAttribute("POSITION")?.getCount() ?? 0);
      n += Math.floor(count / 3);
    }
  }
  return n;
}

/** Column-major 4×4 product a · b. */
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** Problems with a built glb, empty when it is fit to ship. */
export async function verifyGlb(file, dump) {
  const problems = [];
  const bytes = statSync(file).size;
  if (bytes > MAX_GLB_BYTES) problems.push(`${file}: ${bytes} bytes > 25 MiB (Workers static assets limit)`);
  const doc = await (await io()).read(file);
  const tris = triangles(doc);
  if (tris > MAX_TRIANGLES) problems.push(`${file}: ${tris} triangles > ${MAX_TRIANGLES}`);
  const prims = primitives(doc);
  if (prims > MAX_PRIMITIVES) problems.push(`${file}: ${prims} primitives > ${MAX_PRIMITIVES} (did export_gltf.py join the meshes?)`);
  for (const tex of doc.getRoot().listTextures()) {
    const size = tex.getSize();
    if (size && Math.max(size[0], size[1]) > MAX_TEXTURE) problems.push(`${file}: texture ${tex.getName()} is ${size[0]}×${size[1]}`);
  }
  if (doc.getRoot().listSkins().length === 0) problems.push(`${file}: no skin`);
  const joints = new Map();
  for (const skin of doc.getRoot().listSkins()) {
    for (const j of skin.listJoints()) joints.set(j.getName(), j);
    // Skinning draws a vertex at Σ w · world(joint) · inverseBind(joint): at the
    // bind pose every joint's product must be the same matrix.
    const ibm = skin.getInverseBindMatrices();
    if (ibm === null) {
      problems.push(`${file}: skin ${skin.getName()} has no inverse bind matrices`);
      continue;
    }
    const products = skin.listJoints().map((j, k) => multiply(j.getWorldMatrix(), ibm.getElement(k, [])));
    if (products.length === 0) continue;
    const size = Math.max(...products[0].map(Math.abs));
    skin.listJoints().forEach((j, k) => {
      const off = Math.max(...products[k].map((v, i) => Math.abs(v - products[0][i]))) / size;
      if (off > INVERSE_BIND_TOLERANCE) problems.push(`${file}: the inverse bind matrix of joint ${j.getName()} is ${off.toFixed(4)} (relative) from undoing its bind pose`);
    });
  }
  for (const bone of dump.bones) {
    const j = joints.get(bone.name);
    if (j === undefined) {
      problems.push(`${file}: no joint for bone ${bone.name}`);
      continue;
    }
    const m = j.getWorldMatrix();
    const off = Math.max(...m.map((v, i) => Math.abs(v - bone.world[i])));
    if (off > JOINT_TOLERANCE) problems.push(`${file}: joint ${bone.name} is ${off.toFixed(4)} from the dump's bind pose`);
  }
  for (const name of ["Hip", "Head"]) if (!joints.has(name)) problems.push(`${file}: no ${name} joint`);
  // export_gltf.py's dumps always list meshes; a bones-only dump checks the skeleton alone.
  if (Array.isArray(dump.meshes)) problems.push(...(await faceProblems(doc, dump)));
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getAlphaMode() !== "BLEND" || mat.getBaseColorFactor()[3] < 1) continue;
    const tex = mat.getBaseColorTexture();
    if (tex === null || (await holesIn(tex.getImage(), tex.getName())) === 0) {
      problems.push(`${file}: material ${mat.getName()} is BLEND but nothing in it is below alpha ${ALPHA_CUTOFF} — three.js would draw it without depth writes`);
    }
  }
  return { problems, bytes, triangles: tris, primitives: prims, joints: joints.size };
}

/**
 * What `index.json` records as the skeleton a glb was built against: the
 * committed skeleton file's SHA-256 when every committed bone is where
 * Blender's dump has it, else null — `models:check` refuses null, so a build
 * made with `--allow-skeleton-drift` (or with no committed skeleton) is never
 * deployable. `drift` names the bones that moved (null: no committed file).
 */
export function skeletonRecord(committedBytes, dump) {
  if (committedBytes === null) return { sha: null, drift: null };
  const committed = JSON.parse(committedBytes.toString("utf8"));
  const byName = new Map(dump.bones.map((b) => [b.name, b]));
  const drift = committed.bones
    .filter((b) => {
      const d = byName.get(b.name);
      return !d || d.world.some((v, i) => Math.abs(v - b.world[i]) > SKELETON_TOLERANCE);
    })
    .map((b) => b.name);
  return { sha: drift.length === 0 ? sha256(committedBytes) : null, drift };
}

// Run as a CLI. `import.meta.main` (Node ≥ 24.2), not a comparison with argv:
// the URL is percent-encoded and symlink-resolved, so a checkout path with a
// space or one reached through a symlink (macOS's /tmp) never matched, and
// `verify` exited 0 without checking anything.
if (import.meta.main) {
  const [cmd, a, b, fighter] = process.argv.slice(2);
  if (cmd === "optimize") await optimizeGlb(a, b, fighter);
  else if (cmd === "verify") {
    const r = await verifyGlb(a, JSON.parse(readFileSync(b, "utf8")));
    console.log(JSON.stringify({ bytes: r.bytes, triangles: r.triangles, primitives: r.primitives, joints: r.joints }));
    for (const p of r.problems) console.error(p);
    process.exit(r.problems.length ? 1 : 0);
  } else {
    console.error("usage: glb.mjs optimize <in> <out> [fighter] | verify <glb> <dump>");
    process.exit(2);
  }
}
