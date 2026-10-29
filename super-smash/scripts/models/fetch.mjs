/**
 * Fetch the fighter models into the git-ignored `.model-cache/` (Plan 4).
 *
 *   node scripts/models/fetch.mjs                    # verify the cache, download what is missing
 *   node scripts/models/fetch.mjs --update-manifest  # list upstream, download, rewrite manifest.json
 *   node scripts/models/fetch.mjs --only mario       # one fighter
 *   node scripts/models/fetch.mjs --update-manifest --only mario --replace mario
 *
 * Only `scripts/models/manifest.json` (paths, sizes, SHA-256s) is ever
 * committed. A file whose hash differs from the manifest is deleted and the run
 * fails: upstream changing under us is a reason to stop, not to proceed.
 *
 * The plain run is also the cache's offline verify: with a complete, matching
 * cache it makes no request and prints `0 downloaded, 0 failed`. Anything that
 * reads `.model-cache/src/` (skeletons, build, check) should run it first,
 * since it is the only thing that re-hashes those files.
 *
 * `--update-manifest` never changes what the manifest already pins. The commit
 * is fixed, so any difference between upstream and an existing row (a changed
 * file, a missing one, an extra one) is refused and nothing is written, unless
 * that fighter is named with `--replace <fighterId>`; then review the diff
 * against the plan's anchors before committing. Every download is checked
 * (`BLENDER` / PNG signature) and the new manifest is parsed before any file or
 * the manifest is written. A GitLab rate limit (HTTP 429) is not retried: the
 * run stops with exit code 3 and says when the window resets.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  FIGHTER_CODES,
  MANIFEST_SCHEMA,
  MODEL_SOURCE,
  c00Dir,
  cachePath,
  fileProblem,
  magicProblem,
  parseManifest,
  rawUrl,
  sortFiles,
  treeUrl,
  wantedFile,
} from "../../src/render3d/pipeline/manifest.ts";

const DEFAULT_ROOT = join(import.meta.dirname, "..", "..");
/** One request, headers and body together: a `.blend` of 10 MB needs about 60 KB/s. */
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RETRY_DELAY_MS = 1000;
const USAGE = "usage: fetch.mjs [--update-manifest [--replace <fighterId>]...] [--only <fighterId>]";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1);

class UsageError extends Error {}
/** A refusal by design: the run stops with exit code 1 and nothing was written. */
class Refused extends Error {}
class RateLimited extends Error {}

function parseArgs(argv) {
  const opts = { update: false, only: null, replace: new Set() };
  const fighter = (flag, value) => {
    if (value === undefined || !Object.hasOwn(FIGHTER_CODES, value)) {
      throw new UsageError(`${flag} needs a fighter id: ${Object.keys(FIGHTER_CODES).join(", ")}`);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // `pnpm models:fetch -- --only mario` passes the separator through
    if (arg === "--update-manifest") opts.update = true;
    else if (arg === "--only") opts.only = fighter(arg, argv[++i]);
    else if (arg === "--replace") opts.replace.add(fighter(arg, argv[++i]));
    else throw new UsageError(`unknown argument "${arg}"`);
  }
  if (opts.replace.size > 0 && !opts.update) throw new UsageError("--replace only makes sense with --update-manifest");
  return opts;
}

/** One bounded request. A rate limit is never retried: each refused retry still counts against the quota. */
async function get(ctx, url) {
  const res = await ctx.fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(ctx.timeoutMs) });
  if (res.status === 429) {
    const reset = res.headers.get("ratelimit-resettime") ?? "unknown";
    throw new RateLimited(`GitLab is rate-limiting this IP (HTTP 429, Retry-After ${res.headers.get("retry-after") ?? "?"} s, window resets ${reset}). Run the same command again after that.`);
  }
  if (res.url && !res.url.startsWith("https://")) throw new Error(`${url}: redirected to a non-https URL`);
  return res;
}

/** Up to three tries for a timeout, a dropped connection or a 5xx. Any other status (404, 403, ...) is final. */
async function download(ctx, url) {
  let problem = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await get(ctx, url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      problem = `HTTP ${res.status}`;
      if (res.status < 500) break;
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      problem = e instanceof Error ? e.message : String(e);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, ctx.retryDelayMs * attempt));
  }
  throw new Error(`${url}: ${problem}`);
}

/** The wanted files in a fighter's c00 folder at the pinned commit. The listing is untrusted: each entry must be exactly `<c00 folder>/<name>`. */
async function listUpstream(ctx, id) {
  const dir = c00Dir(FIGHTER_CODES[id]);
  const res = await get(ctx, treeUrl(FIGHTER_CODES[id]));
  if (!res.ok) throw new Error(`listing ${id}: HTTP ${res.status}`);
  if ((res.headers.get("x-next-page") ?? "") !== "") throw new Refused(`listing ${id}: more than one page of entries; the fetch reads only the first`);
  const entries = await res.json();
  if (!Array.isArray(entries)) throw new Refused(`listing ${id}: not a list`);
  const paths = [];
  for (const e of entries) {
    if (e === null || typeof e !== "object" || e.type !== "blob" || typeof e.name !== "string" || !wantedFile(e.name)) continue;
    if (e.path !== `${dir}/${e.name}`) throw new Refused(`listing ${id}: "${String(e.path)}" is not ${dir}/${e.name}`);
    paths.push(e.path);
  }
  return paths.sort();
}

/** Write verified bytes to the cache: to a temp name, then moved into place, so a killed run never leaves a half file. */
function writeCache(ctx, file, buf) {
  const dest = join(ctx.root, cachePath(file));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
}

/** How a fighter's freshly listed rows differ from the ones the manifest already pins. */
function differences(before, after) {
  const was = new Map(before.map((f) => [f.path, f]));
  const out = [];
  for (const f of after) {
    const old = was.get(f.path);
    if (!old) out.push(`${nameOf(f.path)} is new upstream`);
    else if (old.bytes !== f.bytes || old.sha256 !== f.sha256) out.push(`${nameOf(f.path)} is ${f.bytes} B, the manifest says ${old.bytes} B`);
    was.delete(f.path);
  }
  for (const path of was.keys()) out.push(`${nameOf(path)} is gone upstream`);
  return out;
}

async function updateManifest(ctx, { only, replace }) {
  const manifestPath = join(ctx.root, "scripts", "models", "manifest.json");
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: [] };
  const oldFiles = old.files ?? [];
  const fighters = Object.keys(FIGHTER_CODES).filter((id) => only === null || id === only);

  // Everything is downloaded and checked in memory first; the disk is touched only after the whole result parses.
  const fetched = [];
  for (const id of fighters) {
    const rows = [];
    for (const path of await listUpstream(ctx, id)) {
      const buf = await download(ctx, rawUrl(path));
      const bad = magicProblem(nameOf(path), buf);
      if (bad) throw new Refused(`${path}: ${bad}`);
      rows.push({ fighter: id, path, bytes: buf.length, sha256: sha256(buf), buf });
      ctx.log(`${id}  ${nameOf(path)}  ${buf.length} B`);
    }
    const before = oldFiles.filter((f) => f.fighter === id);
    const changes = before.length > 0 && !replace.has(id) ? differences(before, rows) : [];
    if (changes.length > 0) {
      throw new Refused(
        `${id}: upstream differs from the manifest (${changes.join("; ")}). The commit is pinned, so this is not expected. ` +
          `Nothing was written. To accept it, run again with --replace ${id} and check the result against the plan's anchors.`,
      );
    }
    fetched.push(...rows);
  }

  const kept = oldFiles.filter((f) => !fighters.includes(f.fighter));
  const files = sortFiles([...kept, ...fetched.map((r) => ({ fighter: r.fighter, path: r.path, bytes: r.bytes, sha256: r.sha256 }))]);
  const manifest = { schema: MANIFEST_SCHEMA, source: MODEL_SOURCE, files };
  try {
    parseManifest(manifest, { requireAll: false });
  } catch (e) {
    throw new Refused(`the new manifest does not parse, nothing was written: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const row of fetched) writeCache(ctx, row, row.buf);
  for (const f of oldFiles) {
    // A replaced fighter's old file that upstream no longer lists would sit in the cache unverified.
    if (replace.has(f.fighter) && !files.some((g) => g.path === f.path)) rmSync(join(ctx.root, cachePath(f)), { force: true });
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  ctx.log(`manifest: ${files.length} files`);
  return 0;
}

async function verifyCache(ctx, { only }) {
  const manifestPath = join(ctx.root, "scripts", "models", "manifest.json");
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const fighters = Object.keys(FIGHTER_CODES).filter((id) => only === null || id === only);
  let fetched = 0;
  let failed = 0;
  let unlisted = 0;
  for (const file of manifest.files.filter((f) => fighters.includes(f.fighter))) {
    const dest = join(ctx.root, cachePath(file));
    if (existsSync(dest)) {
      const buf = readFileSync(dest);
      const problem = fileProblem(file, buf.length, sha256(buf));
      if (problem === null) continue;
      ctx.warn(`stale: ${problem} — deleting and fetching again`);
      rmSync(dest);
    }
    try {
      const buf = await download(ctx, rawUrl(file.path));
      const problem = fileProblem(file, buf.length, sha256(buf)) ?? magicProblem(nameOf(file.path), buf);
      if (problem) throw new Error(problem);
      writeCache(ctx, file, buf);
      fetched++;
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      ctx.warn(`FAILED ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }
  // Files in a fighter's cache folder that the manifest does not list were never verified (a killed update leaves some).
  for (const id of fighters) {
    const dir = join(ctx.root, ".model-cache", "src", id);
    if (!existsSync(dir)) continue;
    const listed = new Set(manifest.files.filter((f) => f.fighter === id).map((f) => nameOf(f.path)));
    for (const name of readdirSync(dir)) {
      if (listed.has(name)) continue;
      if (name.endsWith(".part")) rmSync(join(dir, name), { force: true });
      else {
        ctx.warn(`unlisted: .model-cache/src/${id}/${name} is not in the manifest and was never verified; delete it`);
        unlisted++;
      }
    }
  }
  ctx.log(`fetch: ${fetched} downloaded, ${failed} failed${unlisted > 0 ? `, ${unlisted} unlisted` : ""}, cache in .model-cache/src/`);
  return failed > 0 ? 1 : 0;
}

/**
 * Runs the script and returns its exit code. `fetchFn`, `root`, `log` and the
 * delays are injectable so the tests drive it with a stub and never touch the
 * network.
 *
 * @param {{ argv: string[], root?: string, fetchFn?: typeof fetch, log?: (line: string) => void, warn?: (line: string) => void, timeoutMs?: number, retryDelayMs?: number }} options
 * @returns {Promise<number>} 0 ok, 1 refused or failed, 2 bad arguments, 3 rate-limited
 */
export async function main({ argv, root = DEFAULT_ROOT, fetchFn = globalThis.fetch, log = console.log, warn = console.error, timeoutMs = DEFAULT_TIMEOUT_MS, retryDelayMs = DEFAULT_RETRY_DELAY_MS }) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    warn(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  const ctx = { root, fetchFn, log, warn, timeoutMs, retryDelayMs };
  try {
    return opts.update ? await updateManifest(ctx, opts) : await verifyCache(ctx, opts);
  } catch (e) {
    if (e instanceof RateLimited) {
      warn(e.message);
      return 3;
    }
    warn(e instanceof Refused ? `refused: ${e.message}` : `failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main({ argv: process.argv.slice(2) }));
