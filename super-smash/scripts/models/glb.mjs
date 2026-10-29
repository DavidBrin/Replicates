/**
 * Shrink a Blender-exported fighter glb for the web, and prove what came out
 * (Plan 4). Used by `build.mjs`; also a CLI:
 *
 *   node scripts/models/glb.mjs optimize <in.glb> <out.glb>
 *   node scripts/models/glb.mjs verify <out.glb> <dump.json>
 *
 * optimize: dedup → prune → weld → textures to WebP ≤ 1024 px → meshopt
 * (quantised positions/normals/UVs/weights + EXT_meshopt_compression, decoded
 * in the browser by three's bundled MeshoptDecoder — no wasm to host).
 * verify: the R§4 budget per file (≤ 25 MiB, ≤ 120k triangles — a quarter of
 * the 500k scene budget per fighter, leaving the stage room), ≤ 12 primitives
 * (one draw call each: four fighters stay under half of the 100-call frame,
 * `renderer3d.test.ts`), no texture over 1024 px, and every joint where the
 * bone dump says it is.
 */

import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

export const MAX_GLB_BYTES = 25 * 1024 * 1024;
export const MAX_TRIANGLES = 120_000;
export const MAX_TEXTURE = 1024;
/** Draw calls per fighter: export_gltf.py joins the parts, one primitive per texture (Fox and Marth: 10). */
export const MAX_PRIMITIVES = 12;

async function io() {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

export async function optimizeGlb(input, output) {
  const nio = await io();
  const doc = await nio.read(input);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
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
  for (const skin of doc.getRoot().listSkins()) for (const j of skin.listJoints()) joints.set(j.getName(), j);
  for (const bone of dump.bones) {
    const j = joints.get(bone.name);
    if (j === undefined) continue; // unweighted bones may be pruned from the skin; the bake reads the dump
    const m = j.getWorldMatrix();
    const off = Math.max(...m.map((v, i) => Math.abs(v - bone.world[i])));
    if (off > 1e-2) problems.push(`${file}: joint ${bone.name} is ${off.toFixed(4)} from the dump's bind pose`);
  }
  for (const name of ["Hip", "Head"]) if (!joints.has(name)) problems.push(`${file}: no ${name} joint`);
  return { problems, bytes, triangles: tris, primitives: prims, joints: joints.size };
}

// Run as a CLI. `pathToFileURL`, not "file://" + argv: the URL is percent-encoded,
// so a checkout path with a space ("Personal Projects") never matched and
// `verify` silently exited 0.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "optimize") await optimizeGlb(a, b);
  else if (cmd === "verify") {
    const r = await verifyGlb(a, JSON.parse(readFileSync(b, "utf8")));
    console.log(JSON.stringify({ bytes: r.bytes, triangles: r.triangles, primitives: r.primitives, joints: r.joints }));
    for (const p of r.problems) console.error(p);
    process.exit(r.problems.length ? 1 : 0);
  } else {
    console.error("usage: glb.mjs optimize <in> <out> | verify <glb> <dump>");
    process.exit(2);
  }
}
