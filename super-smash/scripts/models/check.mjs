/**
 * Deploy guard (Plan 4): refuse to build a deploy whose models are missing,
 * changed since they were built, over Cloudflare's 25 MiB per-file limit,
 * built against a different skeleton than the committed bake (or with
 * `--allow-skeleton-drift`), built by another export pipeline than this
 * checkout's (`stamp.mjs`: a glb from before a `meshes.json` choice, a cut-out
 * override or an export rule changed, Task 21b), or joined by a file `index.json` doesn't name
 * (`next build` copies all of `public/models/` into the deploy) — or whose
 * `public/models/` git would commit: anything in it that `git add` would take
 * or that is already tracked or staged. The ripped models are deployed from
 * local disk, never pushed to the public repo (spec §3.1).
 *
 *   node scripts/models/check.mjs     # run by `pnpm run deploy` before `next build`
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PIPELINE_INPUTS, pipelineStamp } from "./stamp.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const FIGHTERS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"];
const MAX = 25 * 1024 * 1024;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const problems = [];

/** The NUL-separated paths a `git ls-files` lists, or null (and a problem) when git cannot answer. */
function gitList(args) {
  const r = spawnSync("git", ["ls-files", ...args, "-z", "--", "public/models"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    problems.push(`cannot ask git what it would commit from public/models/: ${r.error?.message ?? r.stderr.trim()}`);
    return null;
  }
  return r.stdout.split("\0").filter(Boolean);
}
// Every file `git add` would take (untracked and not ignored): checking one
// file's ignore status misses a rule like `!/public/models/*.glb`.
const addable = gitList(["--others", "--exclude-standard"]);
if (addable?.length) problems.push(`public/models/ has ${addable.length} file(s) git would commit (${addable.slice(0, 4).join(", ")}) — the folder must stay git-ignored (super-smash/.gitignore)`);
const tracked = addable === null ? null : gitList(["--cached"]);
if (tracked?.length) problems.push(`public/models/ has ${tracked.length} tracked or staged file(s) (${tracked.slice(0, 4).join(", ")}) — \`git rm --cached\` them; a ripped model must never be committed`);

const indexFile = join(ROOT, "public", "models", "index.json");
if (!existsSync(indexFile)) {
  problems.push("public/models/index.json is missing — run `pnpm models`");
} else {
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  const stamp = pipelineStamp(ROOT);
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
    if (e.skeleton === null) problems.push(`${id}: built with --allow-skeleton-drift or without a committed skeleton — not deployable, run \`pnpm models\``);
    else if (e.skeleton !== sha256(skeleton)) problems.push(`${id}: built against another skeleton than the committed one — run \`pnpm models\``);
    if (e.pipeline === undefined) problems.push(`${id}: built before export builds were stamped — run \`pnpm models\``);
    else if (e.pipeline !== stamp) problems.push(`${id}: built by another export pipeline than this checkout's (${PIPELINE_INPUTS.join(", ")}, or a pipeline package) — run \`pnpm models\``);
  }
  const named = new Set(["index.json", ...Object.values(index.models ?? {}).map((e) => e.file)]);
  const stray = readdirSync(join(ROOT, "public", "models")).filter((f) => !named.has(f));
  if (stray.length > 0) problems.push(`public/models/ holds file(s) index.json does not name (${stray.join(", ")}) — next build would deploy them; delete them`);
}

if (problems.length > 0) {
  console.error(`models:check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("models:check: all eight fighters built against the committed skeletons by this checkout's export pipeline");
