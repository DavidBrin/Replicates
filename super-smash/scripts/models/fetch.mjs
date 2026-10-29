/**
 * Fetch the fighter models into the git-ignored `.model-cache/` (Plan 4).
 *
 *   node scripts/models/fetch.mjs                    # verify the cache, download what is missing
 *   node scripts/models/fetch.mjs --update-manifest  # list upstream, download, rewrite manifest.json
 *   node scripts/models/fetch.mjs --only mario       # one fighter
 *
 * Only `scripts/models/manifest.json` (paths, sizes, SHA-256s) is ever
 * committed. A file whose hash differs from the manifest is deleted and the run
 * fails: upstream changing under us is a reason to stop, not to proceed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  FIGHTER_CODES,
  MANIFEST_SCHEMA,
  MODEL_SOURCE,
  cachePath,
  fileProblem,
  parseManifest,
  rawUrl,
  treeUrl,
  wantedFile,
} from "../../src/render3d/pipeline/manifest.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const MANIFEST = join(ROOT, "scripts", "models", "manifest.json");
const argv = process.argv.slice(2);
const update = argv.includes("--update-manifest");
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? argv[onlyAt + 1] : null;
if (only !== null && !(only in FIGHTER_CODES)) {
  console.error(`unknown fighter "${only}". Try one of: ${Object.keys(FIGHTER_CODES).join(", ")}`);
  process.exit(1);
}
const fighters = Object.keys(FIGHTER_CODES).filter((id) => only === null || id === only);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** A hung connection is cut off after this, headers and body together. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * One bounded GitLab request. A rate limit (HTTP 429) is not retried: GitLab
 * refuses every request until its window resets, and each refused retry still
 * counts against the quota. Say when to come back and stop.
 */
async function get(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 429) {
    const reset = res.headers.get("ratelimit-resettime") ?? "unknown";
    console.error(`GitLab is rate-limiting this IP (HTTP 429, Retry-After ${res.headers.get("retry-after") ?? "?"} s, window resets ${reset}). Run the same command again after that.`);
    process.exit(3);
  }
  return res;
}

/** Up to three tries for a timeout, a dropped connection or a 5xx; a 404 is final. */
async function download(url) {
  let problem = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await get(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      problem = `HTTP ${res.status}`;
      if (res.status === 404) break;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  throw new Error(`${url}: ${problem}`);
}

async function listUpstream(id) {
  const res = await get(treeUrl(FIGHTER_CODES[id]));
  if (!res.ok) throw new Error(`listing ${id}: HTTP ${res.status}`);
  const entries = await res.json();
  return entries.filter((e) => e.type === "blob" && wantedFile(e.name)).map((e) => e.path).sort();
}

/** Download to a temp name, check, then move into place: a killed run never leaves a half file. */
async function fetchTo(file, check) {
  const dest = join(ROOT, cachePath(file));
  mkdirSync(dirname(dest), { recursive: true });
  const buf = await download(rawUrl(file.path));
  const problem = check(buf);
  if (problem) throw new Error(problem);
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
  return buf;
}

if (update) {
  const old = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { files: [] };
  const kept = (old.files ?? []).filter((f) => !fighters.includes(f.fighter));
  const files = [...kept];
  for (const id of fighters) {
    for (const path of await listUpstream(id)) {
      const buf = await fetchTo({ fighter: id, path }, () => null);
      files.push({ fighter: id, path, bytes: buf.length, sha256: sha256(buf) });
      console.log(`${id}  ${path.slice(path.lastIndexOf("/") + 1)}  ${buf.length} B`);
    }
  }
  files.sort((a, b) => a.fighter.localeCompare(b.fighter) || a.path.localeCompare(b.path));
  writeFileSync(MANIFEST, JSON.stringify({ schema: MANIFEST_SCHEMA, source: MODEL_SOURCE, files }, null, 2) + "\n");
  console.log(`manifest: ${files.length} files`);
  process.exit(0);
}

const manifest = parseManifest(JSON.parse(readFileSync(MANIFEST, "utf8")));
let fetched = 0;
let failed = 0;
for (const file of manifest.files.filter((f) => fighters.includes(f.fighter))) {
  const dest = join(ROOT, cachePath(file));
  if (existsSync(dest)) {
    const buf = readFileSync(dest);
    const problem = fileProblem(file, buf.length, sha256(buf));
    if (problem === null) continue;
    console.error(`stale: ${problem} — deleting and fetching again`);
    rmSync(dest);
  }
  try {
    await fetchTo(file, (buf) => fileProblem(file, buf.length, sha256(buf)));
    fetched++;
  } catch (e) {
    console.error(`FAILED ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}
console.log(`fetch: ${fetched} downloaded, ${failed} failed, cache in .model-cache/src/`);
process.exit(failed > 0 ? 1 : 0);
