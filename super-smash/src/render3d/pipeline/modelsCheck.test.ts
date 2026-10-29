// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PIPELINE_INPUTS, PIPELINE_PACKAGES, pipelineStamp } from "../../../scripts/models/stamp.mjs";

/**
 * The deploy guard, `scripts/models/check.mjs` (Plan 4 Task 8), run for real:
 * a copy in a throwaway git repo with this package's own `.gitignore`, eight
 * stand-in glbs (a few bytes each, not models), stand-ins for the export
 * pipeline's inputs (a line of text each) and the `index.json` naming them.
 * `pnpm run deploy` runs it before `next build`, which copies everything in
 * `public/models/` into the deploy — so it must refuse whatever git would
 * commit, whatever the index doesn't name, any build not made against the
 * committed skeletons, and any build made by another export pipeline than
 * this checkout's (Task 21b: a glb from before an export rule changed).
 */

const ROOT = process.cwd();
const FIGHTERS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"];
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
/** No inherited GIT_DIR / GIT_INDEX_FILE may point the probe at the real repo. */
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) as NodeJS.ProcessEnv;

let repo: string;
const at = (...path: string[]) => join(repo, ...path);
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
const check = () => {
  const r = spawnSync(process.execPath, [at("scripts", "models", "check.mjs")], { cwd: repo, env, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
};
const index = () => JSON.parse(readFileSync(at("public", "models", "index.json"), "utf8"));
const writeIndex = (i: unknown) => writeFileSync(at("public", "models", "index.json"), JSON.stringify(i, null, 2));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "models-check-"));
  git("init", "-q");
  mkdirSync(at("scripts", "models"), { recursive: true });
  mkdirSync(at("public", "models"), { recursive: true });
  mkdirSync(at("src", "render3d", "skeletons"), { recursive: true });
  copyFileSync(join(ROOT, "scripts", "models", "check.mjs"), at("scripts", "models", "check.mjs"));
  copyFileSync(join(ROOT, "scripts", "models", "stamp.mjs"), at("scripts", "models", "stamp.mjs"));
  copyFileSync(join(ROOT, ".gitignore"), at(".gitignore"));
  for (const input of PIPELINE_INPUTS) writeFileSync(at(input), `stand-in ${input}\n`);
  const stamp = pipelineStamp(repo);
  const models: Record<string, unknown> = {};
  for (const id of FIGHTERS) {
    const skeleton = Buffer.from(JSON.stringify({ fighter: id }));
    writeFileSync(at("src", "render3d", "skeletons", `${id}.json`), skeleton);
    const glb = Buffer.from(`stand-in ${id}`);
    const file = `${id}.${sha256(glb).slice(0, 8)}.glb`;
    writeFileSync(at("public", "models", file), glb);
    models[id] = { file, bytes: glb.length, sha256: sha256(glb), skeleton: sha256(skeleton), pipeline: stamp };
  }
  writeIndex({ schema: 1, models });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("models:check, the deploy guard", () => {
  it("passes eight fighters built against the committed skeletons, under the package's .gitignore", () => {
    expect(check()).toEqual({ status: 0, out: "models:check: all eight fighters built against the committed skeletons by this checkout's export pipeline\n" });
  });

  it("refuses when git would commit a model — a rule that re-includes the glbs while index.json stays ignored", () => {
    writeFileSync(at(".gitignore"), "/public/models/*\n!/public/models/*.glb\n");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/public\/models\/ has 8 file\(s\) git would commit \(public\/models\/donkeyKong\.[0-9a-f]{8}\.glb, /);
  });

  it("refuses when there is no ignore rule at all", () => {
    writeFileSync(at(".gitignore"), "node_modules/\n");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("public/models/ has 9 file(s) git would commit");
  });

  it("refuses a model that is tracked or staged", () => {
    git("add", "-f", `public/models/${index().models.mario.file}`);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("public/models/ has 1 tracked or staged file(s)");
  });

  it("refuses a file index.json does not name — next build would deploy it", () => {
    writeFileSync(at("public", "models", "body_col.png"), "stray");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("public/models/ holds file(s) index.json does not name (body_col.png)");
  });

  it("refuses a build made with --allow-skeleton-drift (its skeleton is recorded as null)", () => {
    const i = index();
    i.models.fox.skeleton = null;
    writeIndex(i);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("fox: built with --allow-skeleton-drift or without a committed skeleton");
  });

  it("refuses a missing index, an unbuilt fighter, a model changed since it was built and another skeleton", () => {
    const i = index();
    delete i.models.kirby;
    writeIndex(i);
    appendFileSync(at("public", "models", i.models.mario.file), "x");
    writeFileSync(at("src", "render3d", "skeletons", "link.json"), "{}");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("kirby: not built");
    expect(r.out).toContain(`mario: ${i.models.mario.file} changed since it was built`);
    expect(r.out).toContain("link: built against another skeleton than the committed one");

    rmSync(at("public", "models", "index.json"));
    expect(check()).toMatchObject({ status: 1, out: expect.stringContaining("public/models/index.json is missing") });
  });

  it("refuses every model built before an export rule changed: meshes.json, glb.mjs's cut-out overrides, export_gltf.py", () => {
    for (const input of ["scripts/models/meshes.json", "scripts/models/glb.mjs", "scripts/models/export_gltf.py"]) {
      const before = readFileSync(at(input));
      appendFileSync(at(input), "a changed rule\n");
      const r = check();
      expect(r.status, input).toBe(1);
      for (const id of FIGHTERS) expect(r.out, `${input} ${id}`).toContain(`${id}: built by another export pipeline than this checkout's (${PIPELINE_INPUTS.join(", ")}, or a pipeline package) — run \`pnpm models\``);
      writeFileSync(at(input), before);
    }
    expect(check().status).toBe(0);
  });

  it("refuses a model built with another version of a pipeline package, and one built before the stamp existed", () => {
    mkdirSync(at("node_modules", "sharp"), { recursive: true });
    writeFileSync(at("node_modules", "sharp", "package.json"), JSON.stringify({ name: "sharp", version: "0.35.4" }));
    const i = index();
    const stamp = pipelineStamp(repo);
    for (const id of FIGHTERS) i.models[id].pipeline = stamp;
    delete i.models.link.pipeline;
    writeIndex(i);
    let r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("link: built before export builds were stamped — run `pnpm models`");
    expect(r.out).not.toContain("mario:");

    writeFileSync(at("node_modules", "sharp", "package.json"), JSON.stringify({ name: "sharp", version: "0.35.5" }));
    r = check();
    expect(r.out).toContain("mario: built by another export pipeline than this checkout's");
  });

  it("stamps exactly the inputs that decide a glb's bytes, and moves with each one", () => {
    expect(PIPELINE_INPUTS).toEqual([
      "scripts/models/build.mjs",
      "scripts/models/export_gltf.py",
      "scripts/models/flatten_layers.py",
      "scripts/models/glb.mjs",
      "scripts/models/manifest.json",
      "scripts/models/meshes.json",
    ]);
    expect(PIPELINE_PACKAGES).toEqual(["@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions", "meshoptimizer", "sharp"]);
    const stamp = pipelineStamp(repo);
    expect(stamp).toMatch(/^[0-9a-f]{64}$/);
    expect(pipelineStamp(repo)).toBe(stamp);
    const seen = new Set([stamp]);
    for (const input of PIPELINE_INPUTS) {
      const before = readFileSync(at(input));
      writeFileSync(at(input), "changed\n");
      seen.add(pipelineStamp(repo));
      writeFileSync(at(input), before);
    }
    expect(seen.size).toBe(PIPELINE_INPUTS.length + 1);
    expect(pipelineStamp(repo)).toBe(stamp);
  });

  it("refuses outside a git checkout: it cannot tell what would be committed", () => {
    rmSync(at(".git"), { recursive: true, force: true });
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("cannot ask git");
  });
});
