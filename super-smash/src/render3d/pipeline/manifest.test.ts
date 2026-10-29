import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTER_IDS } from "@/fighters";
import { FIGHTER_CODES, MODEL_SOURCE, cachePath, fileProblem, parseManifest, rawUrl, wantedFile } from "./manifest";

describe("the model manifest", () => {
  it("names a code for every fighter in the roster", () => {
    expect(Object.keys(FIGHTER_CODES).sort()).toEqual([...FIGHTER_IDS].sort());
  });

  it("fetches the blend and colour maps, not normal/PRM/emissive maps", () => {
    expect(wantedFile("mario-c00.blend")).toBe(true);
    expect(wantedFile("skin_mario_001_col.png")).toBe(true);
    expect(wantedFile("eye_donkey_001.png")).toBe(true);
    expect(wantedFile("skin_mario_001_nor.png")).toBe(false);
    expect(wantedFile("skin_mario_001_prm.png")).toBe(false);
    expect(wantedFile("met_samus_001_emi.png")).toBe(false);
  });

  it("downloads from the pinned commit, never from master", () => {
    expect(rawUrl("fighter/mario/model/body/c00/mario-c00.blend")).toBe(
      `https://gitlab.com/${MODEL_SOURCE.project}/-/raw/${MODEL_SOURCE.commit}/fighter/mario/model/body/c00/mario-c00.blend`,
    );
  });

  it("keeps every cached file inside .model-cache/ (no path tricks from upstream names)", () => {
    expect(cachePath({ fighter: "mario", path: "fighter/mario/model/body/c00/mario-c00.blend" })).toBe(".model-cache/src/mario/mario-c00.blend");
    expect(() => cachePath({ fighter: "mario", path: "fighter/mario/model/body/c00/..blend" })).toThrow(/odd file name/);
  });

  it("says which file is wrong and how", () => {
    const want = { fighter: "mario", path: "a/b.blend", bytes: 10, sha256: "a".repeat(64) };
    expect(fileProblem(want, 10, "a".repeat(64))).toBeNull();
    expect(fileProblem(want, 9, "a".repeat(64))).toMatch(/9 bytes, manifest says 10/);
    expect(fileProblem(want, 10, "b".repeat(64))).toMatch(/sha256 bbbbbbbbbbbb/);
  });

  it("commits a manifest of hashes for all eight fighters, pinned to the same commit", () => {
    const m = parseManifest(JSON.parse(readFileSync(join(process.cwd(), "scripts", "models", "manifest.json"), "utf8")));
    expect(new Set(m.files.map((f) => f.fighter)).size).toBe(8);
  });
});
