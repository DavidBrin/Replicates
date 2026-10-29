/**
 * `pnpm models`: fetch → Blender export → optimise → verify → publish, for
 * every fighter (Plan 4). Output is git-ignored: `public/models/<id>.<hash8>.glb`
 * and `public/models/index.json`; scratch work goes in `.model-cache/`.
 *
 *   pnpm models                       # all eight
 *   pnpm models -- --only mario       # one
 *   pnpm models -- --allow-skeleton-drift   # the spike, before skeletons are committed
 *
 * Blender: `$BLENDER`, else the portable copy Task 7 installs in
 * `.model-cache/tools/Blender.app`. Each glb records the SHA-256 of the
 * committed skeleton it matches, so `check.mjs` can refuse to deploy models
 * built against different bones than the committed bake.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { optimizeGlb, verifyGlb } from "./glb.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const CACHE = join(ROOT, ".model-cache");
const OUT = join(ROOT, "public", "models");
const BLENDER = process.env.BLENDER ?? join(CACHE, "tools", "Blender.app", "Contents", "MacOS", "Blender");
const CODES = { mario: "mario", donkeyKong: "donkey", link: "link", samus: "samus", kirby: "kirby", fox: "fox", pikachu: "pikachu", marth: "marth" };

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : null;
const allowDrift = argv.includes("--allow-skeleton-drift");
const fighters = Object.keys(CODES).filter((id) => only === null || id === only);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const die = (msg) => {
  console.error(`pnpm models: ${msg}`);
  process.exit(1);
};

if (!existsSync(BLENDER)) die(`no Blender at ${BLENDER} — Plan 4 Task 7 installs it (or set BLENDER=…)`);

const fetch = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "models", "fetch.mjs"), ...(only ? ["--only", only] : [])], { stdio: "inherit" });
if (fetch.status !== 0) die("fetch failed");

const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8"));
for (const dir of ["glb", "dumps"]) mkdirSync(join(CACHE, dir), { recursive: true });
mkdirSync(OUT, { recursive: true });
const indexFile = join(OUT, "index.json");
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : { schema: 1, models: {} };

for (const id of fighters) {
  const blendEntry = manifest.files.find((f) => f.fighter === id && f.path.endsWith(".blend"));
  if (!blendEntry) die(`manifest has no .blend for ${id}`);
  const blend = join(CACHE, "src", id, blendEntry.path.slice(blendEntry.path.lastIndexOf("/") + 1));
  const raw = join(CACHE, "glb", `${id}.raw.glb`);
  const opt = join(CACHE, "glb", `${id}.opt.glb`);
  const dumpFile = join(CACHE, "dumps", `${id}.json`);

  const blender = spawnSync(
    BLENDER,
    // The .blend is downloaded data: never let it run embedded Python. Factory
    // settings: no user preferences, add-ons or startup file shape the export.
    ["--background", "--factory-startup", "--disable-autoexec", blend, "--python-exit-code", "1", "--python", join(ROOT, "scripts", "models", "export_gltf.py"), "--",
      "--fighter", id, "--code", CODES[id], "--glb", raw, "--dump", dumpFile,
      "--meshes", join(ROOT, "scripts", "models", "meshes.json"), "--hurt", join(ROOT, "src", "render3d", "skeletons", "hurtBones.json")],
    { stdio: "inherit" },
  );
  if (blender.status !== 0) die(`Blender export failed for ${id}`);

  await optimizeGlb(raw, opt);
  const dump = JSON.parse(readFileSync(dumpFile, "utf8"));
  const report = await verifyGlb(opt, dump);
  if (report.problems.length > 0) die(report.problems.join("\n"));

  const skeletonFile = join(ROOT, "src", "render3d", "skeletons", `${id}.json`);
  let skeletonSha = null;
  if (existsSync(skeletonFile)) {
    const committed = JSON.parse(readFileSync(skeletonFile, "utf8"));
    const byName = new Map(dump.bones.map((b) => [b.name, b]));
    const drift = committed.bones.filter((b) => {
      const d = byName.get(b.name);
      return !d || d.world.some((v, i) => Math.abs(v - b.world[i]) > 1e-4);
    });
    if (drift.length > 0 && !allowDrift) {
      die(`${id}: ${drift.length} bones differ from src/render3d/skeletons/${id}.json (${drift.slice(0, 4).map((b) => b.name).join(", ")}…). Re-run UPDATE_SKELETONS=1 then UPDATE_BAKE=1 (Plan 4 Tasks 6 and 10).`);
    }
    skeletonSha = sha256(readFileSync(skeletonFile));
  } else if (!allowDrift) {
    die(`no committed skeleton for ${id} — during the spike pass --allow-skeleton-drift`);
  }

  const bytes = readFileSync(opt);
  const hash = sha256(bytes);
  const file = `${id}.${hash.slice(0, 8)}.glb`;
  for (const old of readdirSync(OUT)) if (old.startsWith(`${id}.`) && old.endsWith(".glb") && old !== file) rmSync(join(OUT, old));
  copyFileSync(opt, join(OUT, file));
  index.models[id] = { file, bytes: bytes.length, sha256: hash, skeleton: skeletonSha };
  console.log(`${id}: ${file}  ${(bytes.length / 1048576).toFixed(2)} MiB  ${report.triangles} tris  ${report.primitives} primitives  ${report.joints} joints`);
}

writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
console.log(`pnpm models: wrote ${Object.keys(index.models).length} model(s) to public/models/`);
