// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { main } from "../../../scripts/models/fetch.mjs";
import { FIGHTER_CODES, MANIFEST_SCHEMA, MODEL_SOURCE, c00Dir, sortFiles, type ManifestFile } from "./manifest";

/**
 * `scripts/models/fetch.mjs` driven in-process against a stubbed `fetch` and a
 * temp root: no request ever leaves the machine, and the synthetic "models" are
 * a few bytes behind a real `BLENDER` / PNG signature. What is pinned here is
 * the safety of the update path (it must never change what the manifest pins, or
 * record a page as a model) and of the verify path.
 */

const roots: string[] = [];
beforeAll(() => {
  // Any code path that forgot to use the injected fetch would reach for this one.
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is off in this test");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (tag: string) => Buffer.concat([PNG_HEAD, Buffer.from(tag)]);
const blend = (tag: string) => Buffer.from(`BLENDER-v283${tag}`);

type Upstream = Map<string, Buffer>;
const idOf = (path: string) => Object.keys(FIGHTER_CODES).find((id) => path.startsWith(c00Dir(FIGHTER_CODES[id]) + "/")) ?? "?";

/** Eight fighters, each with a .blend and two colour maps. */
function upstream(): Upstream {
  const up: Upstream = new Map();
  for (const [id, code] of Object.entries(FIGHTER_CODES)) {
    const dir = c00Dir(code);
    up.set(`${dir}/${code}-c00.blend`, blend(id));
    up.set(`${dir}/skin_${code}_001_col.png`, png(`${id} skin`));
    up.set(`${dir}/eye_${code}_001_col.png`, png(`${id} eye`));
  }
  return up;
}

const rowsOf = (up: Upstream): ManifestFile[] => sortFiles([...up].map(([path, buf]) => ({ fighter: idOf(path), path, bytes: buf.length, sha256: sha(buf) })));
const manifestText = (files: ManifestFile[]) => JSON.stringify({ schema: MANIFEST_SCHEMA, source: MODEL_SOURCE, files }, null, 2) + "\n";

interface World {
  root: string;
  manifest: string;
  read: () => string;
  cacheFiles: () => string[];
}

/** A temp root holding the manifest for `up` (all eight fighters), and, with `cached`, the matching cache. */
function world(up: Upstream, { cached = false, manifest = true } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "fetch-test-"));
  roots.push(root);
  const manifestPath = join(root, "scripts", "models", "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  if (manifest) writeFileSync(manifestPath, manifestText(rowsOf(up)));
  if (cached) {
    for (const [path, buf] of up) {
      const dest = join(root, ".model-cache", "src", idOf(path), basename(path));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
    }
  }
  const cacheFiles = () => {
    const src = join(root, ".model-cache", "src");
    if (!existsSync(src)) return [];
    return readdirSync(src, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(basename(e.parentPath), e.name)).sort();
  };
  return { root, manifest: manifestPath, read: () => readFileSync(manifestPath, "utf8"), cacheFiles };
}

interface Stub {
  fetchFn: typeof fetch;
  calls: string[];
}

/** GitLab, as far as the script uses it: a tree listing per c00 folder and raw files at the pinned commit. */
function stub(up: Upstream, tweak: (url: URL) => Response | undefined = () => undefined): Stub {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(String(input));
    const custom = tweak(url);
    if (custom) return custom;
    if (url.pathname.endsWith("/repository/tree")) {
      const dir = url.searchParams.get("path");
      return Response.json([...up.keys()].filter((p) => dirname(p) === dir).map((p) => ({ type: "blob", name: basename(p), path: p })));
    }
    const prefix = `/${MODEL_SOURCE.project}/-/raw/${MODEL_SOURCE.commit}/`;
    const buf = url.pathname.startsWith(prefix) ? up.get(decodeURIComponent(url.pathname.slice(prefix.length))) : undefined;
    return buf ? new Response(new Uint8Array(buf)) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function run(w: World, argv: string[], s: Stub) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({ argv, root: w.root, fetchFn: s.fetchFn, log: (l) => out.push(l), warn: (l) => err.push(l), retryDelayMs: 0, timeoutMs: 5000 });
  return { code, out, err: err.join("\n"), calls: s.calls };
}

const MARIO_SKIN = `${c00Dir("mario")}/skin_mario_001_col.png`;
const MARIO_EYE = `${c00Dir("mario")}/eye_mario_001_col.png`;
const MARIO_BLEND = `${c00Dir("mario")}/mario-c00.blend`;

describe("--update-manifest never changes what the manifest pins", () => {
  it("rewrites the identical manifest for an unchanged fighter, and fills the cache from verified bytes", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    const r = await run(w, ["--", "--update-manifest", "--only", "mario"], stub(up));
    expect(r.code).toBe(0);
    expect(r.out.at(-1)).toBe("manifest: 24 files");
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual(["mario/eye_mario_001_col.png", "mario/mario-c00.blend", "mario/skin_mario_001_col.png"]);
    expect(readFileSync(join(w.root, ".model-cache", "src", "mario", "mario-c00.blend"))).toEqual(up.get(MARIO_BLEND));
  });

  it("refuses a file whose bytes changed upstream, and writes nothing", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    up.set(MARIO_SKIN, png("something else entirely"));
    const r = await run(w, ["--update-manifest", "--only", "mario"], stub(up));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/mario: upstream differs from the manifest \(skin_mario_001_col\.png is \d+ B, the manifest says \d+ B\)/);
    expect(r.err).toMatch(/--replace mario/);
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual([]);
  });

  it("refuses a file that is gone upstream, and a new one", async () => {
    const gone = upstream();
    const w1 = world(gone);
    gone.delete(MARIO_EYE);
    const r1 = await run(w1, ["--update-manifest", "--only", "mario"], stub(gone));
    expect(r1.code).toBe(1);
    expect(r1.err).toMatch(/eye_mario_001_col\.png is gone upstream/);

    const extra = upstream();
    const w2 = world(extra);
    const before = w2.read();
    extra.set(`${c00Dir("mario")}/more_mario_col.png`, png("extra"));
    const r2 = await run(w2, ["--update-manifest", "--only", "mario"], stub(extra));
    expect(r2.code).toBe(1);
    expect(r2.err).toMatch(/more_mario_col\.png is new upstream/);
    expect(w2.read()).toBe(before);
    expect(w2.cacheFiles()).toEqual([]);
  });

  it("accepts a change only for the fighter named with --replace, and leaves every other row alone", async () => {
    const up = upstream();
    const w = world(up);
    const before = JSON.parse(w.read()) as { files: ManifestFile[] };
    up.set(MARIO_SKIN, png("a re-exported skin"));

    const wrong = await run(w, ["--update-manifest", "--only", "mario", "--replace", "link"], stub(up));
    expect(wrong.code).toBe(1);

    const r = await run(w, ["--update-manifest", "--only", "mario", "--replace", "mario"], stub(up));
    expect(r.code).toBe(0);
    const after = JSON.parse(w.read()) as { files: ManifestFile[] };
    const changed = after.files.filter((f, i) => JSON.stringify(f) !== JSON.stringify(before.files[i]));
    expect(changed.map((f) => f.path)).toEqual([MARIO_SKIN]);
    expect(changed[0].sha256).toBe(sha(up.get(MARIO_SKIN)!));
    expect(after.files).toHaveLength(before.files.length);
  });

  it("removes a replaced fighter's cache file that upstream no longer lists", async () => {
    const up = upstream();
    const w = world(up, { cached: true });
    up.delete(MARIO_EYE);
    const r = await run(w, ["--update-manifest", "--only", "mario", "--replace", "mario"], stub(up));
    expect(r.code).toBe(0);
    expect(w.cacheFiles().filter((f) => f.startsWith("mario/"))).toEqual(["mario/mario-c00.blend", "mario/skin_mario_001_col.png"]);
  });

  it("refuses an HTML page served as a .blend, replace or not, and records nothing", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    up.set(MARIO_BLEND, Buffer.from("<html>Please sign in</html>"));
    for (const extra of [[], ["--replace", "mario"]]) {
      const r = await run(w, ["--update-manifest", "--only", "mario", ...extra], stub(up));
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/mario-c00\.blend does not start with BLENDER: not a \.blend file/);
    }
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual([]);
  });

  it("refuses an HTML page served as a texture", async () => {
    const up = upstream();
    const w = world(up);
    up.set(MARIO_SKIN, Buffer.from("<html>429 Too Many Requests</html>"));
    const r = await run(w, ["--update-manifest", "--only", "mario", "--replace", "mario"], stub(up));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not a PNG/);
  });

  it("parses the new manifest before writing anything, and refuses one that does not", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    up.delete(MARIO_BLEND);
    const r = await run(w, ["--update-manifest", "--only", "mario", "--replace", "mario"], stub(up));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/does not parse, nothing was written: manifest: no \.blend for mario/);
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual([]);
  });

  it("builds a first manifest one fighter at a time", async () => {
    const up = upstream();
    const w = world(up, { manifest: false });
    expect((await run(w, ["--update-manifest", "--only", "mario"], stub(up))).code).toBe(0);
    expect((JSON.parse(w.read()) as { files: ManifestFile[] }).files.map((f) => f.fighter)).toEqual(["mario", "mario", "mario"]);
    expect((await run(w, ["--update-manifest", "--only", "link"], stub(up))).code).toBe(0);
    const files = (JSON.parse(w.read()) as { files: ManifestFile[] }).files;
    expect(files.map((f) => f.fighter)).toEqual(["link", "link", "link", "mario", "mario", "mario"]);
  });

  it("refuses a listing entry whose path is not the folder's own, and a listing with more pages", async () => {
    const up = upstream();
    const w = world(up);
    const bad = stub(up, (url) =>
      url.pathname.endsWith("/repository/tree") ? Response.json([{ type: "blob", name: "x_col.png", path: "fighter/mario/model/body/c00/../../../evil/x_col.png" }]) : undefined,
    );
    const r1 = await run(w, ["--update-manifest", "--only", "mario", "--replace", "mario"], bad);
    expect(r1.code).toBe(1);
    expect(r1.err).toMatch(/is not fighter\/mario\/model\/body\/c00\/x_col\.png/);

    const paged = stub(up, (url) => (url.pathname.endsWith("/repository/tree") ? Response.json([], { headers: { "x-next-page": "2" } }) : undefined));
    const r2 = await run(w, ["--update-manifest", "--only", "mario", "--replace", "mario"], paged);
    expect(r2.code).toBe(1);
    expect(r2.err).toMatch(/more than one page/);
  });

  it("stops at once on a rate limit, says when it resets, and leaves nothing behind", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    const limited = stub(up, () => new Response("", { status: 429, headers: { "retry-after": "1616", "ratelimit-resettime": "Thu, 29 Oct 2026 11:00:00 GMT" } }));
    const r = await run(w, ["--update-manifest", "--only", "mario"], limited);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/rate-limiting this IP \(HTTP 429, Retry-After 1616 s, window resets Thu, 29 Oct 2026 11:00:00 GMT\)/);
    expect(r.calls).toHaveLength(1);
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual([]);
  });

  it("stops at once when a file download, not just a listing, is rate-limited", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    const limitedRaw = () => stub(up, (url) => (url.pathname.includes("/-/raw/") ? new Response("", { status: 429, headers: { "retry-after": "60" } }) : undefined));
    const r = await run(w, ["--update-manifest", "--only", "mario"], limitedRaw());
    expect(r.code).toBe(3);
    expect(r.calls).toHaveLength(2); // the listing, then the first file, never retried
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual([]);
    const verify = await run(w, ["--only", "mario"], limitedRaw());
    expect(verify.code).toBe(3);
    expect(verify.calls).toHaveLength(1);
  });

  it("writes nothing when a later fighter is rate-limited: no half-verified files in the cache", async () => {
    const up = upstream();
    const w = world(up);
    const before = w.read();
    // Fighters go in roster order (mario first); donkeyKong's listing is refused.
    const limited = stub(up, (url) =>
      url.pathname.endsWith("/repository/tree") && url.searchParams.get("path") === c00Dir("donkey") ? new Response("", { status: 429 }) : undefined,
    );
    const r = await run(w, ["--update-manifest"], limited);
    expect(r.code).toBe(3);
    expect(r.calls.length).toBeGreaterThan(4); // mario's listing and files went through first
    expect(w.read()).toBe(before);
    expect(w.cacheFiles()).toEqual([]);
  });
});

describe("the verify run", () => {
  it("makes no request for a complete, matching cache, and says 0 downloaded", async () => {
    const up = upstream();
    const w = world(up, { cached: true });
    const s = stub(up);
    const r = await run(w, ["--"], s);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.out).toEqual(["fetch: 0 downloaded, 0 failed, cache in .model-cache/src/"]);
  });

  it("deletes a stale file and fetches it again", async () => {
    const up = upstream();
    const w = world(up, { cached: true });
    const stale = join(w.root, ".model-cache", "src", "mario", "skin_mario_001_col.png");
    writeFileSync(stale, Buffer.concat([readFileSync(stale), Buffer.from("x")]));
    const r = await run(w, ["--only", "mario"], stub(up));
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/stale: .*skin_mario_001_col\.png: \d+ bytes, manifest says \d+ — deleting and fetching again/);
    expect(r.out).toEqual(["fetch: 1 downloaded, 0 failed, cache in .model-cache/src/"]);
    expect(readFileSync(stale)).toEqual(up.get(MARIO_SKIN));
  });

  it("keeps nothing that fails its check: no file and no .part", async () => {
    const up = upstream();
    const w = world(up);
    const wrong = upstream();
    for (const [p] of wrong) wrong.set(p, p.endsWith(".blend") ? blend("changed") : png("changed"));
    const r = await run(w, ["--only", "mario"], stub(wrong));
    expect(r.code).toBe(1);
    expect(r.out).toEqual(["fetch: 0 downloaded, 3 failed, cache in .model-cache/src/"]);
    expect(w.cacheFiles()).toEqual([]);
  });

  it("retries a 5xx or a dropped connection three times, but never a 403 or a 404", async () => {
    const up = upstream();
    const w = world(up);
    const rawOnly = (status: number) => stub(up, (url) => (url.pathname.includes("/-/raw/") ? new Response("", { status }) : undefined));
    const r403 = await run(w, ["--only", "mario"], rawOnly(403));
    expect(r403.calls).toHaveLength(3); // one request per file
    const r404 = await run(w, ["--only", "mario"], rawOnly(404));
    expect(r404.calls).toHaveLength(3);
    const r500 = await run(w, ["--only", "mario"], rawOnly(500));
    expect(r500.calls).toHaveLength(9); // three tries per file
    const dropped = stub(up, () => {
      throw new TypeError("fetch failed");
    });
    const rDrop = await run(w, ["--only", "mario"], dropped);
    expect(rDrop.code).toBe(1);
    expect(rDrop.calls).toHaveLength(9);
  });

  it("refuses a redirect to a non-https URL", async () => {
    const up = upstream();
    const w = world(up);
    const plain = stub(up, (url) => {
      if (!url.pathname.includes("/-/raw/")) return undefined;
      const res = new Response(new Uint8Array(png("x")));
      Object.defineProperty(res, "url", { value: "http://gitlab.com/elsewhere" });
      return res;
    });
    const r = await run(w, ["--only", "mario"], plain);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/redirected to a non-https URL/);
    expect(w.cacheFiles()).toEqual([]);
  });

  it("says so about a cache file the manifest does not list, and clears a leftover .part", async () => {
    const up = upstream();
    const w = world(up, { cached: true });
    const dir = join(w.root, ".model-cache", "src", "mario");
    writeFileSync(join(dir, "unknown_col.png"), png("from an aborted update"));
    writeFileSync(join(dir, "skin_mario_001_col.png.part"), "half");
    const r = await run(w, [], stub(up));
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/unlisted: \.model-cache\/src\/mario\/unknown_col\.png is not in the manifest and was never verified/);
    expect(r.out).toEqual(["fetch: 0 downloaded, 0 failed, 1 unlisted, cache in .model-cache/src/"]);
    expect(readdirSync(dir)).not.toContain("skin_mario_001_col.png.part");
    expect(readdirSync(dir)).toContain("unknown_col.png");
  });
});

describe("the command line", () => {
  it("refuses an argument it does not know, or a fighter that is not in the roster, before any request", async () => {
    const up = upstream();
    const w = world(up);
    for (const argv of [["--only=mario"], ["--only", "toString"], ["--only"], ["--only", "nobody"], ["--bogus"], ["--replace", "mario"], ["--update-manifest", "--replace", "constructor"]]) {
      const s = stub(up);
      const r = await run(w, argv, s);
      expect({ argv, code: r.code, calls: s.calls.length }).toEqual({ argv, code: 2, calls: 0 });
      expect(r.err).toMatch(/usage: fetch\.mjs/);
    }
  });
});
