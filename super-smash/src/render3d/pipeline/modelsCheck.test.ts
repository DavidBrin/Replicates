// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BLENDER_VERSION, PIPELINE_INPUTS, PIPELINE_PACKAGES, blenderRelease, pipelineStamp } from "../../../scripts/models/stamp.mjs";

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
 *
 * `next build` copies the rest of `public/` too (codex, plan-final: a glb
 * copied to `public/audit.glb` passed), so the guard audits the whole tree:
 * outside `public/models/` only the bake and committed files may deploy, and
 * none may have a pipeline format's name or a model's first bytes; anywhere,
 * no file may have a fetched model file's bytes. Every refusal is tested on
 * synthetic bytes: a magic number and a manifest row, never a model.
 */

const ROOT = process.cwd();
const FIGHTERS = ["mario", "donkeyKong", "link", "samus", "kirby", "fox", "pikachu", "marth"];
const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
/** A stand-in for a fetched model file: the throwaway manifest pins these bytes, so a file holding them counts as one. */
const FETCHED = Buffer.from("a synthetic fetched texture, not a model");
const MANIFEST = { schema: 1, files: [{ fighter: "mario", path: "fighter/mario/model/body/c00/a_synthetic_col.png", bytes: FETCHED.length, sha256: sha256(FETCHED) }] };
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
/** Write `bytes` at a repo path, making its folders. */
const put = (path: string, bytes: string | Buffer) => {
  mkdirSync(dirname(at(path)), { recursive: true });
  writeFileSync(at(path), bytes);
};
/** Stage a path: to the guard, a tracked or staged file is a committed one. */
const commit = (...paths: string[]) => void git("add", "-f", "--", ...paths);
/** The first bytes of each model or texture format, with filler: not a model, only its magic number. */
const MAGIC: Record<string, Buffer> = {
  glb: Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0, 20, 0, 0, 0]), Buffer.from("filler")]),
  blend: Buffer.from("BLENDER-v300REND filler"),
  ktx: Buffer.concat([Buffer.from([0xab]), Buffer.from("KTX 20"), Buffer.from([0xbb, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("filler")]),
  dds: Buffer.from("DDS |\0\0\0 filler"),
  webp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8 filler")]),
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "models-check-"));
  git("init", "-q");
  mkdirSync(at("scripts", "models"), { recursive: true });
  mkdirSync(at("public", "models"), { recursive: true });
  mkdirSync(at("src", "render3d", "skeletons"), { recursive: true });
  for (const script of ["check.mjs", "stamp.mjs", "rippedFormats.mjs"]) copyFileSync(join(ROOT, "scripts", "models", script), at("scripts", "models", script));
  copyFileSync(join(ROOT, ".gitignore"), at(".gitignore"));
  for (const input of PIPELINE_INPUTS) writeFileSync(at(input), `stand-in ${input}\n`);
  // The manifest is a pipeline input, and also what the guard compares every file's bytes against.
  writeFileSync(at("scripts", "models", "manifest.json"), JSON.stringify(MANIFEST, null, 2));
  const stamp = pipelineStamp(repo);
  const models: Record<string, unknown> = {};
  for (const id of FIGHTERS) {
    const skeleton = Buffer.from(JSON.stringify({ fighter: id }));
    writeFileSync(at("src", "render3d", "skeletons", `${id}.json`), skeleton);
    const glb = Buffer.from(`stand-in ${id}`);
    const file = `${id}.${sha256(glb).slice(0, 8)}.glb`;
    writeFileSync(at("public", "models", file), glb);
    models[id] = { file, bytes: glb.length, sha256: sha256(glb), skeleton: sha256(skeleton), pipeline: stamp, blender: "5.2.2 LTS" };
  }
  writeIndex({ schema: 1, models });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("models:check, the deploy guard", () => {
  it("passes eight fighters built against the committed skeletons, under the package's .gitignore", () => {
    expect(check()).toEqual({ status: 0, out: "models:check: all eight fighters built against the committed skeletons by this checkout's export pipeline; nothing else in public/ is a model\n" });
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

  it("refuses a model exported by another Blender, and one that recorded none (Task 21b fix round)", () => {
    const i = index();
    i.models.fox.blender = "4.2.1 LTS";
    delete i.models.link.blender;
    writeIndex(i);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain(`fox: exported by Blender 4.2.1 LTS, not ${BLENDER_VERSION} (BLENDER_VERSION in scripts/models/stamp.mjs) — run \`pnpm models\` with Blender ${BLENDER_VERSION}`);
    expect(r.out).toContain("link: built before builds recorded their Blender — run `pnpm models`");
    expect(r.out).not.toContain("mario:");
  });

  it("pins the one Blender release every glb is exported by, and reads it from the version a dump records", () => {
    expect(BLENDER_VERSION).toBe("5.2.2");
    expect(blenderRelease("5.2.2 LTS")).toBe("5.2.2");
    expect(blenderRelease("5.2.2")).toBe("5.2.2");
    expect(blenderRelease("5.2.20 LTS")).toBe("5.2.20");
    expect(blenderRelease("LTS")).toBeNull();
    expect(blenderRelease(undefined)).toBeNull();
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

describe("models:check, the rest of public/: next build deploys all of it (codex, plan-final)", () => {
  const OUTSIDE = "outside public/models/ — next build would deploy it; delete it";

  it("refuses a glb copied elsewhere in public/: codex's probe, public/audit.glb", () => {
    put("public/audit.glb", MAGIC.glb);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain(`public/audit.glb is a model or texture format ${OUTSIDE}`);
    expect(r.out).toContain(`public/audit.glb starts with glTF bytes (a glb) ${OUTSIDE}`);
    expect(r.out).toContain("public/audit.glb is neither a built model, the bake nor a committed file — next build would deploy it; commit it or delete it");
  });

  it("refuses every pipeline format by its name outside public/models/, committed or not, whatever its bytes", () => {
    const names = ["a.glb", "b.gltf", "c.blend", "d.blend1", "e.ktx2", "f.dds", "g.webp", "H.GLB"].map((n) => `public/assets/${n}`);
    for (const path of names) put(path, "plain text, not a model");
    commit(...names);
    const r = check();
    expect(r.status).toBe(1);
    for (const path of names) expect(r.out, path).toContain(`${path} is a model or texture format ${OUTSIDE}`);
    expect(r.out).not.toContain("starts with");
    expect(r.out).not.toContain("neither a built model");
  });

  it("refuses a model's first bytes under any name outside public/models/: a glb renamed .bin, a .blend, KTX, DDS and WebP textures", () => {
    const planted: [string, Buffer, string][] = [
      ["public/data/a.bin", MAGIC.glb, "glTF bytes (a glb)"],
      ["public/data/b.dat", MAGIC.blend, "BLENDER bytes (a .blend)"],
      ["public/data/c.png", MAGIC.ktx, "KTX bytes (a texture)"],
      ["public/data/d.txt", MAGIC.dds, "DDS bytes (a texture)"],
      ["public/data/e.jpg", MAGIC.webp, "RIFF/WEBP bytes (a WebP texture)"],
    ];
    for (const [path, bytes] of planted) put(path, bytes);
    // Committed, so the magic number is the only thing wrong with each.
    commit(...planted.map(([path]) => path));
    const r = check();
    expect(r.status).toBe(1);
    for (const [path, , kind] of planted) expect(r.out, path).toContain(`${path} starts with ${kind} ${OUTSIDE}`);
    expect(r.out).not.toContain("is a model or texture format");
    // A file that only starts like one is not: "RIFF" without "WEBP" is a WAV, and a short "glT" is not glTF.
    put("public/sounds/hit.wav", Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WAVEfmt ")]));
    put("public/data/short.txt", "glT");
    commit("public/sounds/hit.wav", "public/data/short.txt");
    expect(check().out).not.toMatch(/hit\.wav|short\.txt/);
  });

  it("refuses a file anywhere in public/ with a fetched model file's bytes (its size, then its SHA-256), models folder included", () => {
    put("public/icons/eye.png", FETCHED);
    put("public/icons/same-size.png", Buffer.alloc(FETCHED.length, 0x61)); // a manifest size, not a manifest hash
    commit("public/icons/eye.png", "public/icons/same-size.png");
    put("public/models/x_col.png", FETCHED);
    const r = check();
    expect(r.status).toBe(1);
    const fetched = "has the bytes of a fetched model file (fighter/mario/model/body/c00/a_synthetic_col.png) — next build would deploy it; delete it";
    expect(r.out).toContain(`public/icons/eye.png ${fetched}`);
    expect(r.out).toContain(`public/models/x_col.png ${fetched}`);
    expect(r.out).not.toContain("same-size.png");
  });

  it("deploys outside public/models/ only the bake and committed files: an untracked file or a .DS_Store is refused", () => {
    put("public/bake/roster.bin.gz", Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0])); // the bake, by path, committed or not
    put("public/icons/logo.svg", "<svg/>");
    commit("public/icons/logo.svg");
    expect(check().status).toBe(0);

    put("public/robots.txt", "User-agent: *");
    put("public/icons/.DS_Store", Buffer.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31])); // "Bud1", a Finder file
    const r = check();
    expect(r.status).toBe(1);
    for (const path of ["public/robots.txt", "public/icons/.DS_Store"]) {
      expect(r.out, path).toContain(`${path} is neither a built model, the bake nor a committed file — next build would deploy it; commit it or delete it`);
    }
    commit("public/robots.txt");
    expect(check().out).not.toContain("public/robots.txt");
  });

  it("refuses a symbolic link anywhere in public/: next build would deploy what it points at", () => {
    put("elsewhere/model.bin", MAGIC.glb);
    mkdirSync(at("public", "icons"), { recursive: true });
    symlinkSync(at("elsewhere", "model.bin"), at("public", "icons", "logo.png"));
    symlinkSync(at("elsewhere"), at("public", "linked"), "dir");
    const r = check();
    expect(r.status).toBe(1);
    for (const path of ["public/icons/logo.png", "public/linked"]) expect(r.out, path).toContain(`${path} is a symbolic link — next build would deploy what it points at; delete it`);
  });

  it("refuses a file nested under public/models/ that index.json does not name", () => {
    put("public/models/sub/fox.glb", "stray");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("public/models/ holds file(s) index.json does not name (sub/fox.glb)");
  });

  it("refuses when it cannot read the manifest it compares bytes against", () => {
    writeFileSync(at("scripts", "models", "manifest.json"), "not json");
    const r = check();
    expect(r.status).toBe(1);
    expect(r.out).toContain("cannot read scripts/models/manifest.json");
  });
});
