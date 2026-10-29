// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The capture scripts photograph the fighters' models (Plan 4), and a picture of
 * a Nintendo model is as unshippable as the model: the repo is public, and a
 * takedown of one would take every replica in it down. So a capture must land
 * somewhere git ignores, by default, however the script is run: never the
 * package root, where it would ride along in the next `git add`.
 */

const ROOT = process.cwd();
const script = (name: string) => readFileSync(join(ROOT, "scripts", name), "utf8");
const ignored = (path: string) => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

describe("where the capture scripts write by default", () => {
  for (const [name, example] of [
    ["animsheet.mjs", "test-results/anim/anim-mario-attack.png"],
    ["fightsheet.mjs", "test-results/anim/fight-mario-fsmash.png"],
  ] as const) {
    it(`${name} writes into the git-ignored test-results/anim/, not the package root`, () => {
      expect(script(name)).toMatch(/flag\("out",\s*join\("test-results",\s*"anim",/);
      expect(ignored(example)).toBe(true);
    });
  }

  it("no capture script's old default (a PNG in the package root) is left", () => {
    // `anim-*.png` was ignored only by the repo's root .gitignore, and `fight-*.png` by nothing at all.
    for (const name of ["animsheet.mjs", "fightsheet.mjs"]) expect(script(name)).not.toMatch(/flag\("out",\s*`/);
  });

  it("a stray capture in the package root is ignored too, for a run that picks its own relative --out", () => {
    expect(ignored("anim-mario-land.png")).toBe(true);
    expect(ignored("fight-mario-fsmash.png")).toBe(true);
  });
});
