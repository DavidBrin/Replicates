/**
 * Deploy guard (Plan 4): refuse to build a deploy whose models are missing,
 * changed since they were built, over Cloudflare's 25 MiB per-file limit, or
 * built against a different skeleton than the committed bake — or whose
 * `public/models/` git would commit (not ignored, or a file in it tracked or
 * staged): the ripped models are deployed from local disk, never pushed to the
 * public repo (spec §3.1).
 *
 *   node scripts/models/check.mjs     # run by `pnpm run deploy` before `next build`
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const FIGHTERS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"];
const MAX = 25 * 1024 * 1024;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const problems = [];

const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
// The rules alone (`--no-index`; a staged file is caught below): exit 0 ignored, 1 not.
const ignored = git(["check-ignore", "--no-index", "-q", "--", "public/models/index.json"]);
if (ignored.status === 1) problems.push("public/models/ is not git-ignored — `git add` would commit the ripped models (super-smash/.gitignore)");
else if (ignored.status !== 0) problems.push(`cannot ask git whether public/models/ is ignored: ${ignored.error?.message ?? ignored.stderr.trim()}`);
const tracked = git(["ls-files", "--cached", "-z", "--", "public/models"]);
if (tracked.status !== 0) problems.push(`cannot list git's index for public/models/: ${tracked.error?.message ?? tracked.stderr.trim()}`);
else {
  const paths = tracked.stdout.split("\0").filter(Boolean);
  if (paths.length > 0) problems.push(`public/models/ has ${paths.length} tracked or staged file(s) (${paths.slice(0, 4).join(", ")}) — \`git rm --cached\` them; a ripped model must never be committed`);
}

const indexFile = join(ROOT, "public", "models", "index.json");
if (!existsSync(indexFile)) {
  problems.push("public/models/index.json is missing — run `pnpm models`");
} else {
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  for (const id of FIGHTERS) {
    const e = index.models?.[id];
    if (!e) {
      problems.push(`${id}: not built — run \`pnpm models\``);
      continue;
    }
    const file = join(ROOT, "public", "models", e.file);
    if (!existsSync(file)) {
      problems.push(`${id}: ${e.file} is missing — run \`pnpm models\``);
      continue;
    }
    const bytes = readFileSync(file);
    if (bytes.length > MAX) problems.push(`${id}: ${e.file} is ${bytes.length} bytes, over 25 MiB`);
    if (sha256(bytes) !== e.sha256) problems.push(`${id}: ${e.file} changed since it was built`);
    const skeleton = readFileSync(join(ROOT, "src", "render3d", "skeletons", `${id}.json`));
    if (e.skeleton !== sha256(skeleton)) problems.push(`${id}: built against another skeleton than the committed one — run \`pnpm models\``);
  }
}

if (problems.length > 0) {
  console.error(`models:check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("models:check: all eight fighters built against the committed skeletons");
