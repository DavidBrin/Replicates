// @vitest-environment node
/**
 * The Node this project is pinned to (`package.json` `engines.node`, `.nvmrc`),
 * and why it is pinned. The bake (`public/bake/roster.bin.gz`) is computed with
 * float maths (`Math.sin`, `Math.atan2`, `Math.hypot`… in the retargeter and the
 * forward kinematics), whose last bits the language leaves to the engine, and
 * `BAKE_DIGEST` pins its bytes: under another V8 the same clips could bake to
 * other bytes, and `UPDATE_BAKE=1` would no longer regenerate it byte for byte.
 * One major, the one it was baked with. The model scripts also need Node 24.2
 * or later for `import.meta.main`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const engines = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
const nvmrc = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();

describe("the pinned Node", () => {
  it("is one major, the same in package.json and .nvmrc, and at least 24.2", () => {
    const pin = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(engines ?? "");
    expect(pin, `engines.node ${engines}: a caret range, one major`).not.toBeNull();
    const [major, minor] = [Number(pin![1]), Number(pin![2])];
    expect(nvmrc).toBe(String(major));
    expect(major > 24 || (major === 24 && minor >= 2), `engines.node ${engines}`).toBe(true);
  });

  it("is the Node running this suite", () => {
    expect(process.versions.node.split(".")[0], "run the Node in .nvmrc (nvm use)").toBe(nvmrc);
  });
});
