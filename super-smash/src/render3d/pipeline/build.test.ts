// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Document, NodeIO } from "@gltf-transform/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BLENDER_VERSION, pipelineStamp } from "../../../scripts/models/stamp.mjs";

/**
 * `pnpm models` (`scripts/models/build.mjs`, Plan 4) run for real, on a stand-in: a copy of the build in a
 * throwaway folder under the git-ignored `.model-cache/` (inside the package, so its imports resolve), a fetch that
 * does nothing, and a fake Blender that writes a tiny skinned glb (not a model) and the dump it is told to, saying
 * whichever Blender release the test asks for. What is pinned:
 *
 * - the build refuses a glb exported by any Blender but `BLENDER_VERSION`, before anything is published (Task 21b
 *   re-review: only `models:check`'s half of that refusal had a test);
 * - Blender runs on the downloaded .blend with factory settings and with embedded Python off.
 */

const ROOT = process.cwd();
const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
/** The two joints `verifyGlb` insists on, where the fake glb has them. */
const BONES = [
  { name: "Hip", world: translate(0, 1, 0) },
  { name: "Head", world: translate(0, 2, 0) },
];

/** A one-triangle fighter skinned to `Hip` and `Head`, with one untextured opaque material. */
async function fakeGlb(file: string): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const hip = doc.createNode("Hip").setTranslation([0, 1, 0]);
  const head = doc.createNode("Head").setTranslation([0, 1, 0]);
  hip.addChild(head);
  const accessor = (type: "VEC3" | "VEC4" | "MAT4", array: Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const skin = doc
    .createSkin("armature")
    .addJoint(hip)
    .addJoint(head)
    .setInverseBindMatrices(accessor("MAT4", new Float32Array([...translate(0, -1, 0), ...translate(0, -2, 0)])));
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])))
    .setAttribute("JOINTS_0", accessor("VEC4", new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])))
    .setAttribute("WEIGHTS_0", accessor("VEC4", new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])))
    .setMaterial(doc.createMaterial("skin"));
  doc.createScene().addChild(hip).addChild(doc.createNode("body").setMesh(doc.createMesh("body").addPrimitive(prim)).setSkin(skin));
  await new NodeIO().write(file, doc);
}

let copy: string;
const at = (...path: string[]) => join(copy, ...path);

beforeEach(async () => {
  mkdirSync(join(ROOT, ".model-cache"), { recursive: true });
  copy = mkdtempSync(join(ROOT, ".model-cache", "build-test-"));
  mkdirSync(at("scripts", "models"), { recursive: true });
  mkdirSync(at("src", "render3d", "skeletons"), { recursive: true });
  for (const script of ["build.mjs", "glb.mjs", "stamp.mjs"]) copyFileSync(join(ROOT, "scripts", "models", script), at("scripts", "models", script));
  // The cache is already verified: the fetch the build runs first has nothing to do.
  writeFileSync(at("scripts", "models", "fetch.mjs"), "process.exit(0);\n");
  writeFileSync(at("scripts", "models", "manifest.json"), JSON.stringify({ schema: 1, files: [{ fighter: "mario", path: "fighter/mario/model/body/c00/mario-c00.blend", bytes: 1, sha256: "0".repeat(64) }] }));
  writeFileSync(at("src", "render3d", "skeletons", "mario.json"), JSON.stringify({ schema: 1, fighter: "mario", bones: BONES, hurt: [] }));
  await fakeGlb(at("fake.glb"));
  // The fake Blender: records its arguments, copies the fake glb to --glb and writes a dump to --dump, saying the
  // release in FAKE_BLENDER_VERSION (none when it is empty).
  writeFileSync(
    at("fake-blender.mjs"),
    `import { copyFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
writeFileSync(${JSON.stringify(at("blender-args.json"))}, JSON.stringify(args));
copyFileSync(${JSON.stringify(at("fake.glb"))}, arg("--glb"));
const version = process.env.FAKE_BLENDER_VERSION;
writeFileSync(arg("--dump"), JSON.stringify({ schema: 1, fighter: arg("--fighter"), ...(version ? { blender: version } : {}), bones: ${JSON.stringify(BONES)} }));
`,
  );
  writeFileSync(at("blender"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(at("fake-blender.mjs"))} "$@"\n`);
  chmodSync(at("blender"), 0o755);
});
afterEach(() => rmSync(copy, { recursive: true, force: true }));

/** `pnpm models -- --only mario` in the copy, with the fake Blender saying `version`. */
function build(version: string) {
  const env = { ...process.env, BLENDER: at("blender"), FAKE_BLENDER_VERSION: version };
  const r = spawnSync(process.execPath, [at("scripts", "models", "build.mjs"), "--only", "mario"], { cwd: copy, env, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}
const published = () => (existsSync(at("public", "models")) ? readdirSync(at("public", "models")).sort() : []);

describe("pnpm models (build.mjs) and the Blender it exports with", () => {
  it(`publishes a glb Blender ${BLENDER_VERSION} exported, recording the release and the pipeline's stamp`, { timeout: 60_000 }, () => {
    const r = build(`${BLENDER_VERSION} LTS`);
    expect(r.status, r.out).toBe(0);
    expect(published()).toEqual(["index.json", expect.stringMatching(/^mario\.[0-9a-f]{8}\.glb$/)]);
    const entry = JSON.parse(readFileSync(at("public", "models", "index.json"), "utf8")).models.mario;
    expect(entry).toMatchObject({ blender: `${BLENDER_VERSION} LTS`, pipeline: pipelineStamp(copy) });
  });

  it("refuses a glb any other Blender exported, before anything is published — another release, a longer one, or none", { timeout: 60_000 }, () => {
    for (const version of ["4.2.1 LTS", `${BLENDER_VERSION}0 LTS`, ""]) {
      const r = build(version);
      expect(r.status, version).toBe(1);
      expect(r.out, version).toContain(
        `pnpm models: mario: exported by Blender ${version || "undefined"}, not ${BLENDER_VERSION} (BLENDER_VERSION in scripts/models/stamp.mjs) — set BLENDER= to Blender ${BLENDER_VERSION}`,
      );
      expect(published(), version).toEqual([]);
    }
  });

  it("runs Blender on the downloaded .blend with factory settings and no embedded Python (the file is untrusted data)", { timeout: 60_000 }, () => {
    expect(build(`${BLENDER_VERSION} LTS`).status).toBe(0);
    const args: string[] = JSON.parse(readFileSync(at("blender-args.json"), "utf8"));
    const blend = args.indexOf(at(".model-cache", "src", "mario", "mario-c00.blend"));
    expect(blend).toBeGreaterThan(0);
    // Before the .blend: "Arguments are executed in the order they are given" (`blender --help`).
    expect(args.slice(0, blend)).toEqual(expect.arrayContaining(["--background", "--factory-startup", "--disable-autoexec"]));
    expect(args).toContain("--python-exit-code");
  });
});
