// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The deploy guard, `scripts/models/check.mjs` (Plan 4 Task 8), run for real:
 * a copy in a throwaway git repo with this package's own `.gitignore`, eight
 * stand-in glbs (a few bytes each, not models) and the `index.json` naming
 * them. `pnpm run deploy` runs it before `next build`, which copies everything
 * in `public/models/` into the deploy — so it must refuse whatever git would
 * commit, whatever the index doesn't name, and any build not made against the
 * committed skeletons.
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
  copyFileSync(join(ROOT, ".gitignore"), at(".gitignore"));
  const models: Record<string, unknown> = {};
  for (const id of FIGHTERS) {
    const skeleton = Buffer.from(JSON.stringify({ fighter: id }));
    writeFileSync(at("src", "render3d", "skeletons", `${id}.json`), skeleton);
    const glb = Buffer.from(`stand-in ${id}`);
    const file = `${id}.${sha256(glb).slice(0, 8)}.glb`;
    writeFileSync(at("public", "models", file), glb);
    models[id] = { file, bytes: glb.length, sha256: sha256(glb), skeleton: sha256(skeleton) };
  }
  writeIndex({ schema: 1, models });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("models:check, the deploy guard", () => {
  it("passes eight fighters built against the committed skeletons, under the package's .gitignore", () => {
    expect(check()).toEqual({ status: 0, out: "models:check: all eight fighters built against the committed skeletons\n" });
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

  it("refuses outside a git checkout: it cannot tell what would be committed", () => {
    rmSync(at(".git"), { recursive: true, force: true });
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("cannot ask git");
  });
});
