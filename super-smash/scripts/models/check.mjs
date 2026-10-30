/**
 * Deploy guard (Plan 4): refuse to build a deploy whose models are missing,
 * changed since they were built, over Cloudflare's 25 MiB per-file limit,
 * built against a different skeleton than the committed bake (or with
 * `--allow-skeleton-drift`), built by another export pipeline than this
 * checkout's (`stamp.mjs`: a glb from before a `meshes.json` choice, a cut-out
 * override or an export rule changed, Task 21b) or by another Blender than
 * `BLENDER_VERSION`, or joined by a file `index.json` doesn't name — or whose
 * `public/models/` git would commit: anything in it that `git add` would take
 * or that is already tracked or staged. The ripped models are deployed from
 * local disk, never pushed to the public repo (spec §3.1).
 *
 * `next build` copies all of `public/` into the deploy, not just
 * `public/models/` (codex, plan-final: a glb copied to `public/audit.glb`
 * passed), so the whole tree is audited. Outside `public/models/` only the
 * bake and files the repo commits may deploy, and none may have a pipeline
 * format's name or a model's first bytes (`rippedFormats.mjs`); anywhere, no
 * file may have the bytes of a file the manifest pins (its size, then its
 * SHA-256), no file may be binary but the bake (`BINARY_ALLOW`) and the glbs
 * `index.json` names (a model compressed, archived or re-encoded hides its own
 * first bytes; codex re-confirm, P2), and no symbolic link may stand in for a
 * file. A file refused for what it is gets one reason and is told to delete
 * it; any other stray is told to be committed or deleted, or, when git
 * ignores it (a Finder `.DS_Store`), only to be deleted. When git cannot be
 * asked, no file is labelled either way: that refusal stands alone.
 *
 *   node scripts/models/check.mjs     # run by `pnpm run deploy` before `next build`
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { BAKE_PATH, PIPELINE_ONLY, SNIFF_BYTES, binaryAllowed, binaryKind, modelMagic } from "./rippedFormats.mjs";
import { BLENDER_VERSION, PIPELINE_INPUTS, blenderRelease, pipelineStamp } from "./stamp.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const FIGHTERS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"];
const MAX = 25 * 1024 * 1024;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const problems = [];

/** The NUL-separated paths a `git ls-files` lists under `path`, or null (and a problem) when git cannot answer. */
function gitList(args, path) {
  const r = spawnSync("git", ["ls-files", ...args, "-z", "--", path], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    problems.push(`cannot ask git what it would commit from ${path}/: ${r.error?.message ?? r.stderr.trim()}`);
    return null;
  }
  return r.stdout.split("\0").filter(Boolean);
}
// Every file `git add` would take (untracked and not ignored): checking one
// file's ignore status misses a rule like `!/public/models/*.glb`.
const addable = gitList(["--others", "--exclude-standard"], "public/models");
if (addable?.length) problems.push(`public/models/ has ${addable.length} file(s) git would commit (${addable.slice(0, 4).join(", ")}) — the folder must stay git-ignored (super-smash/.gitignore)`);
const tracked = addable === null ? null : gitList(["--cached"], "public/models");
if (tracked?.length) problems.push(`public/models/ has ${tracked.length} tracked or staged file(s) (${tracked.slice(0, 4).join(", ")}) — \`git rm --cached\` them; a ripped model must never be committed`);
/** The repo's own `public/` files (tracked or staged): what may deploy beside the models and the bake. */
const committed = new Set(addable === null ? [] : (gitList(["--cached"], "public") ?? []));
/** Files under `public/` that `git add` would take: any other file neither committed nor the bake is git-ignored. */
const untracked = new Set(addable === null ? [] : (gitList(["--others", "--exclude-standard"], "public") ?? []));

/** Every file and symbolic link under `dir`, by its path from the package root (`public/…`). */
function walk(dir, rel, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(join(dir, entry.name), path, out);
    else out.push({ path, abs: join(dir, entry.name), link: entry.isSymbolicLink() });
  }
  return out;
}
const PUBLIC = walk(join(ROOT, "public"), "public");
/** The glbs `index.json` names, by path: binary, and allowed. Null without an index, which is refused already. */
let indexedGlbs = null;

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
    if (e.blender === undefined) problems.push(`${id}: built before builds recorded their Blender — run \`pnpm models\``);
    else if (blenderRelease(e.blender) !== BLENDER_VERSION) problems.push(`${id}: exported by Blender ${e.blender}, not ${BLENDER_VERSION} (BLENDER_VERSION in scripts/models/stamp.mjs) — run \`pnpm models\` with Blender ${BLENDER_VERSION}`);
  }
  const named = new Set(["index.json", ...Object.values(index.models ?? {}).map((e) => e.file)]);
  indexedGlbs = new Set(Object.values(index.models ?? {}).map((e) => `public/models/${e.file}`));
  const stray = PUBLIC.map((f) => f.path).filter((p) => p.startsWith("public/models/") && !named.has(p.slice("public/models/".length)));
  if (stray.length > 0) problems.push(`public/models/ holds file(s) index.json does not name (${stray.map((p) => p.slice("public/models/".length)).join(", ")}) — next build would deploy them; delete them`);
}

/** The manifest's files by size, then SHA-256: a file with one's bytes is a fetched model file under another name. */
function manifestBySize() {
  const bySize = new Map();
  try {
    const files = JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8")).files;
    if (!Array.isArray(files)) throw new Error("it has no files list");
    for (const f of files) bySize.set(f.bytes, (bySize.get(f.bytes) ?? new Map()).set(f.sha256, f.path));
  } catch (e) {
    problems.push(`cannot read scripts/models/manifest.json, which every file in public/ is compared against: ${e.message}`);
  }
  return bySize;
}
const fetched = manifestBySize();

/** A file's first `SNIFF_BYTES` bytes (fewer if it is shorter). */
function headOf(abs) {
  const fd = openSync(abs, "r");
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    return head.subarray(0, readSync(fd, head, 0, SNIFF_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

/** Whether git answered: when it could not be asked, no file is labelled committed, untracked or ignored. */
const gitAnswered = addable !== null;

for (const { path, abs, link } of PUBLIC) {
  if (link) {
    problems.push(`${path} is a symbolic link — next build would deploy what it points at; delete it`);
    continue;
  }
  const outside = !path.startsWith("public/models/");
  const ship = "next build would deploy it; delete it";
  const head = headOf(abs);
  /** What is wrong with what the file is: each refusal says only to delete it. */
  const ripped = [];
  if (outside && PIPELINE_ONLY.test(path)) ripped.push(`${path} is a model or texture format outside public/models/ — ${ship}`);
  const magic = outside ? modelMagic(head) : null;
  if (magic !== null) ripped.push(`${path} starts with ${magic} outside public/models/ — ${ship}`);
  // Only a file of exactly a manifest size can have a manifest hash, so only those are read whole.
  const shas = fetched.get(statSync(abs).size);
  const source = shas === undefined ? undefined : shas.get(sha256(readFileSync(abs)));
  if (source !== undefined) ripped.push(`${path} has the bytes of a fetched model file (${source}) — ${ship}`);
  if (ripped.length > 0) {
    problems.push(...ripped);
    continue;
  }
  // Any other binary file: a model compressed, archived or re-encoded hides its own first bytes, so a binary
  // file is listed or refused. Inside public/models/ without an index, the missing index is the refusal.
  const binary = binaryKind(head);
  const allowed = binaryAllowed(path) || (indexedGlbs === null ? !outside : indexedGlbs.has(path));
  if (binary !== null && !allowed) {
    problems.push(`${path} is a binary file (${binary}) and neither the bake nor an indexed glb — ${ship}`);
    continue;
  }
  if (outside && gitAnswered && path !== BAKE_PATH && !committed.has(path)) {
    // A git-ignored file (a Finder `.DS_Store`) cannot be committed, and `git status` never shows it.
    if (untracked.has(path)) problems.push(`${path} is neither a built model, the bake nor a committed file — next build would deploy it; commit it or delete it`);
    else problems.push(`${path} is git-ignored, so it cannot be committed, and is neither a built model nor the bake — ${ship}`);
  }
}

if (problems.length > 0) {
  console.error(`models:check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("models:check: all eight fighters built against the committed skeletons by this checkout's export pipeline; nothing else in public/ is a model");
