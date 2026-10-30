/**
 * The export pipeline's stamp (Plan 4 Task 21b): one SHA-256 over everything
 * in this checkout that decides a fighter glb's bytes, given the pinned
 * downloads. `pnpm models` records it on each model it builds
 * (`public/models/index.json`, `models[id].pipeline`), and `models:check`
 * refuses a model whose stamp is not this checkout's — a glb built before an
 * export rule changed (a `meshes.json` choice, a cut-out override in
 * `glb.mjs`, the flattening in `export_gltf.py`) and still listed in the index
 * would otherwise deploy as if it were current.
 *
 * The inputs: the scripts and lists `build.mjs` runs, the manifest that pins
 * every downloaded file by SHA-256, the versions of the packages that write
 * the glb, and the Blender release that exports it (`BLENDER_VERSION`; each
 * model also records the version its dump says it was exported by, and
 * `models:check` refuses any other, Task 21b fix round). No other import:
 * `check.mjs` runs it alone.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Files, from the package root, whose bytes decide a glb's. */
export const PIPELINE_INPUTS = Object.freeze([
  "scripts/models/build.mjs",
  "scripts/models/export_gltf.py",
  "scripts/models/flatten_layers.py",
  "scripts/models/glb.mjs",
  "scripts/models/manifest.json",
  "scripts/models/meshes.json",
]);

/** The Blender release every glb is exported by (Task 7 installs it; its dump records `5.2.2 LTS`). */
export const BLENDER_VERSION = "5.2.2";

/** The release number in a Blender version string (`"5.2.2 LTS"` → `"5.2.2"`), or null. */
export function blenderRelease(version) {
  return typeof version === "string" ? (/^\d+\.\d+\.\d+/.exec(version)?.[0] ?? null) : null;
}

/** Packages whose versions decide a glb's bytes (the optimiser, its compressor and its texture encoder). */
export const PIPELINE_PACKAGES = Object.freeze(["@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions", "meshoptimizer", "sharp"]);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * The stamp of the pipeline in the package at `root`: a missing input or package counts as `missing`, never as an
 * error. `blender` is the release it exports with, `BLENDER_VERSION` unless a test asks about another.
 *
 * @param {string} root
 * @param {string} [blender]
 */
export function pipelineStamp(root, blender = BLENDER_VERSION) {
  const lines = [];
  for (const input of PIPELINE_INPUTS) {
    const file = join(root, input);
    lines.push(`${input}\t${existsSync(file) ? sha256(readFileSync(file)) : "missing"}`);
  }
  for (const pkg of PIPELINE_PACKAGES) {
    const file = join(root, "node_modules", pkg, "package.json");
    lines.push(`${pkg}@${existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : "missing"}`);
  }
  lines.push(`blender@${blender}`);
  return sha256(lines.join("\n") + "\n");
}
