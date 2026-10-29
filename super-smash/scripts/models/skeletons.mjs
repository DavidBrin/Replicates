/**
 * `pnpm models:skeletons`: read every fighter's bones, meshes and vertex
 * weights out of its cached .blend with the stdlib SDNA reader — no Blender —
 * into `.model-cache/dumps/<id>.sdna.json` (Plan 4 Task 6). The committed
 * skeletons are trimmed from these by
 *
 *   UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts
 *
 * The .blend is untrusted downloaded data. Before reading any file, this
 * re-hashes the cache against `scripts/models/manifest.json` by running the
 * fetch script's plain run, the cache's offline verify. A complete, matching
 * cache costs 0 requests; a missing file is fetched, and one whose hash differs
 * is deleted and fetched again. Only then does the reader run, isolated
 * (`python3 -I -B`), on bytes that are the pinned ones. It only parses them.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const CACHE = join(ROOT, ".model-cache");
const CODES = { mario: "mario", donkeyKong: "donkey", link: "link", samus: "samus", kirby: "kirby", fox: "fox", pikachu: "pikachu", marth: "marth" };

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : null;
const verify = spawnSync(
  process.execPath,
  ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "models", "fetch.mjs"), ...(only === null ? [] : ["--only", only])],
  { stdio: "inherit" },
);
if (verify.status !== 0) {
  console.error("models:skeletons: the model cache does not match scripts/models/manifest.json, so no .blend was read");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8"));
mkdirSync(join(CACHE, "dumps"), { recursive: true });

let failed = 0;
for (const id of Object.keys(CODES).filter((f) => only === null || f === only)) {
  const entry = manifest.files.find((f) => f.fighter === id && f.path.endsWith(".blend"));
  if (!entry) {
    console.error(`models:skeletons: manifest has no .blend for ${id}`);
    failed++;
    continue;
  }
  const blend = join(CACHE, "src", id, entry.path.slice(entry.path.lastIndexOf("/") + 1));
  const run = spawnSync(
    "python3",
    ["-I", "-B", join(ROOT, "scripts", "models", "skeleton_from_blend.py"), blend, "--fighter", id, "--code", CODES[id],
      "--meshes", join(ROOT, "scripts", "models", "meshes.json"), "--hurt", join(ROOT, "src", "render3d", "skeletons", "hurtBones.json"),
      "--out", join(CACHE, "dumps", `${id}.sdna.json`)],
    // The reader bounds every loop; the timeout is a second guard, far above its sub-second runs.
    { stdio: "inherit", timeout: 120_000 },
  );
  if (run.signal !== null) console.error(`models:skeletons: the reader was stopped (${run.signal}) on ${id}`);
  if (run.status !== 0) failed++;
}
if (failed > 0) {
  console.error(`models:skeletons: ${failed} fighter(s) failed`);
  process.exit(1);
}
