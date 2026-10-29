// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The public repo must never hold a ripped model or texture (spec §3.1): a DMCA
 * notice against one would take down every replica in Replicates. The fetched
 * files live in `.model-cache/`, the built glbs in `public/models/`; both are
 * git-ignored, and this test fails if anything there, or any file in a format
 * only the model pipeline makes, is ever tracked or staged. Task 5 extends it
 * to every file the manifest lists, by name and by bytes.
 */

const ROOT = process.cwd();

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

  it("tracks and stages nothing from the cache or the built models, and no pipeline-only format", () => {
    const tracked = execFileSync("git", ["ls-files", "--cached", "--", "."], { cwd: ROOT, encoding: "utf8" }).split("\n");
    const bad = tracked.filter(
      (f) => /\.(blend|blend1|glb|gltf|webp|ktx2)$/i.test(f) || f.startsWith(".model-cache/") || f.startsWith("public/models/"),
    );
    expect(bad).toEqual([]);
  });
});
