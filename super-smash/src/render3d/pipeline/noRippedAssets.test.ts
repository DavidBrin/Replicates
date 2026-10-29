// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseManifest, type ModelManifest } from "./manifest";

/**
 * The public repo must never hold a ripped model or texture (spec §3.1): a DMCA
 * notice against one would take down every replica in Replicates. The fetched
 * files live in `.model-cache/`, the built glbs in `public/models/`; both are
 * git-ignored, and this test fails if any tracked or staged file anywhere in the
 * repo is one of them.
 *
 * "One of them" is decided by the manifest, not by guessing at names: a file
 * is ripped if its name is one the manifest lists, or if its bytes hash to one
 * the manifest lists (a renamed copy), or if it is a format only the pipeline
 * makes (.blend, .glb, .gltf, .webp, .ktx2). A name pattern missed 17 of the
 * 114 real files (`eye_donkey_001.png`, `pikachu_facial_01_col.png`, …).
 *
 * The scan is the whole repo (`:/`), not just `super-smash/`: a file in `Risk/`
 * takes the same repo down. Paths are NUL-separated (`-z`) because git quotes a
 * name with a non-ASCII character, a tab, a quote or a backslash
 * (`"src/caf\303\251.glb"`), and the quoted form ends in `"`, which no extension
 * or prefix check would match.
 */

/** `super-smash/`: `pnpm test` runs here, as `layering.test.ts` and `envExample.test.ts` assume. */
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "scripts", "models", "manifest.json"))) {
  throw new Error(`noRippedAssets.test.ts: run from super-smash/ (${ROOT} has no scripts/models/manifest.json)`);
}
const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: ROOT, encoding: "utf8" }).trim();

const PIPELINE_ONLY = /\.(blend\d?|glb|gltf|webp|ktx2)$/i;
/** The two git-ignored output folders, at any depth and in any letter case. */
const IGNORED_OUTPUT = /(^|\/)(\.model-cache|public\/models)\//i;

/** Tracked paths that are ripped assets, with why. `stat`/`hash` are injected so the rule is testable without real files. */
export function rippedAssets(
  tracked: readonly string[],
  manifest: ModelManifest,
  size: (path: string) => number,
  hash: (path: string) => string,
): string[] {
  const names = new Set(manifest.files.map((f) => basename(f.path).toLowerCase()));
  const bySize = new Map<number, Set<string>>();
  for (const f of manifest.files) bySize.set(f.bytes, (bySize.get(f.bytes) ?? new Set()).add(f.sha256));
  const out: string[] = [];
  for (const path of tracked) {
    if (IGNORED_OUTPUT.test(path)) out.push(`${path} (git-ignored output)`);
    else if (PIPELINE_ONLY.test(path)) out.push(`${path} (pipeline-only format)`);
    else if (names.has(basename(path).toLowerCase())) out.push(`${path} (manifest file name)`);
    else {
      // Only a file of exactly a manifest size can have a manifest hash.
      const shas = bySize.get(size(path));
      if (shas?.has(hash(path))) out.push(`${path} (manifest file bytes)`);
    }
  }
  return out;
}

/** Every path in the index (tracked, staged, or force-added past .gitignore), repo-wide and relative to the repo root. */
function trackedPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = execFileSync("git", ["ls-files", "--cached", "-z", "--full-name", "--", ":/"], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

const manifest = parseManifest(JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8")));

describe("the ripped-asset rule", () => {
  const sizes: Record<string, number> = { "docs/a.png": 1168, "docs/b.png": 1168, "src/x.ts": 10 };
  const shas: Record<string, string> = { "docs/a.png": manifest.files.find((f) => f.bytes === 1168)?.sha256 ?? "", "docs/b.png": "0".repeat(64), "src/x.ts": "1".repeat(64) };
  const run = (paths: string[]) => rippedAssets(paths, manifest, (p) => sizes[p] ?? 0, (p) => shas[p] ?? "");

  it("catches names the old pattern missed, renamed copies, and pipeline formats", () => {
    expect(run(["public/eye_donkey_001.png", "art/pikachu_facial_01_col.png"])).toHaveLength(2);
    expect(run(["docs/a.png"])).toEqual(["docs/a.png (manifest file bytes)"]);
    expect(run(["x/fighter.webp", "y/z.ktx2", "a.glb", "b.blend"])).toHaveLength(4);
  });

  it("passes ordinary files, even one the size of a texture", () => {
    expect(run(["docs/b.png", "src/x.ts", "scripts/models/manifest.json"])).toEqual([]);
  });

  it("finds the git-ignored folders at any depth and in any case, and a pipeline format in any case", () => {
    expect(run(["super-smash/.model-cache/src/mario/x.png", "Risk/Public/Models/a.json", "x/.Model-Cache/y.txt"])).toHaveLength(3);
    expect(run(["a/b.GLB", "a/b.blend2", "a/b.Blend1"])).toHaveLength(3);
    expect(run(["super-smash/src/public/modelsets/a.json", "super-smash/docs/model-cache.md"])).toEqual([]);
  });
});

describe("no Nintendo-ripped asset is tracked", () => {
  it("ignores the model cache, the built models and Python bytecode", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    for (const rule of ["/.model-cache/", "/public/models/", "*.blend", "__pycache__/"]) expect(ignore).toContain(rule);
    const check = (p: string) => execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT, stdio: "pipe" });
    expect(() => check(".model-cache/src/mario/mario-c00.blend")).not.toThrow();
    expect(() => check("public/models/mario.0123abcd.glb")).not.toThrow();
    expect(() => check("public/models/index.json")).not.toThrow();
    expect(() => check("scripts/models/__pycache__/x.pyc")).not.toThrow();
  });

  it("tracks and stages none of the manifest's files, by name or by bytes, anywhere in the repo", () => {
    const sha = (p: string) => createHash("sha256").update(readFileSync(join(REPO_ROOT, p))).digest("hex");
    const size = (p: string) => {
      try {
        const st = statSync(join(REPO_ROOT, p));
        return st.isFile() ? st.size : -1; // a submodule or symlinked directory has no bytes to hash
      } catch {
        return -1; // staged for deletion
      }
    };
    expect(rippedAssets(trackedPaths(), manifest, size, sha)).toEqual([]);
  });

  it("sees a ripped file whose name git would quote, or that sits outside super-smash/", () => {
    // A scratch index (`GIT_INDEX_FILE`), filled with the real tree plus entries that point at
    // nothing (`--info-only`): the real index and the working tree are never touched.
    const dir = mkdtempSync(join(tmpdir(), "no-ripped-assets-"));
    try {
      const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index") };
      execFileSync("git", ["read-tree", "HEAD"], { cwd: ROOT, env, stdio: "pipe" });
      expect(rippedAssets(trackedPaths(env), manifest, () => -1, () => "")).toEqual([]);
      const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
      const planted = [
        "super-smash/src/café.glb", // git prints this as "super-smash/src/caf\303\251.glb", quotes included
        'super-smash/src/we"ird.glb',
        "super-smash/public/models/マリオ.png",
        "x-root.glb", // the repo root, outside super-smash/
        "Risk/model.blend",
      ];
      for (const p of planted) {
        execFileSync("git", ["update-index", "--add", "--info-only", "--cacheinfo", `100644,${EMPTY_BLOB},${p}`], { cwd: ROOT, env, stdio: "pipe" });
      }
      const flagged = rippedAssets(trackedPaths(env), manifest, () => -1, () => "").map((f) => f.replace(/ \(.*\)$/, ""));
      expect(flagged.sort()).toEqual([...planted].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
