/**
 * `pnpm models:skeletons`: read every fighter's bones, meshes and vertex
 * weights out of its cached .blend with the stdlib SDNA reader — no Blender —
 * into `.model-cache/dumps/<id>.sdna.json` (Plan 4 Task 6). The committed
 * skeletons are trimmed from these by
 *
 *   UPDATE_SKELETONS=1 pnpm vitest run src/render3d/skeletons/skeletons.test.ts
 *
 * Needs only `pnpm models:fetch` first. The .blend is untrusted downloaded
 * data: the reader runs isolated (`python3 -I -B`) and only parses bytes.
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
    { stdio: "inherit" },
  );
  if (run.status !== 0) failed++;
}
if (failed > 0) {
  console.error(`models:skeletons: ${failed} fighter(s) failed`);
  process.exit(1);
}
