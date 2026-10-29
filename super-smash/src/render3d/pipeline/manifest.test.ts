import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIGHTER_IDS } from "@/fighters";
import {
  FIGHTER_CODES,
  MODEL_SOURCE,
  c00Dir,
  cachePath,
  fileProblem,
  magicProblem,
  parseManifest,
  rawUrl,
  sortFiles,
  wantedFile,
  type ManifestFile,
} from "./manifest";

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

  it("refuses a cache path for a fighter that is not in the roster", () => {
    expect(() => cachePath({ fighter: "../../../tmp", path: "fighter/mario/model/body/c00/x.png" })).toThrow(/unknown fighter/);
    expect(() => cachePath({ fighter: "toString", path: "fighter/mario/model/body/c00/x.png" })).toThrow(/unknown fighter/);
  });
});

const MANIFEST_FILE = join(process.cwd(), "scripts", "models", "manifest.json");
const committedText = readFileSync(MANIFEST_FILE, "utf8");
const committed = parseManifest(JSON.parse(committedText));

/**
 * The anchors from the plan's Task 5 Step 5 (verified against GitLab on
 * 2026-10-24 and again at fetch time): 114 files, 82,191,933 bytes, the
 * per-fighter counts, the named sizes. R8 makes these, and the digest below, the
 * reference for the committed manifest. A deliberate re-fetch that changes any of
 * them must update this test in the same commit, after the plan's author agrees.
 */
describe("the committed manifest still holds the plan's anchors", () => {
  it("has 114 files, 82,191,933 bytes and the per-fighter counts", () => {
    expect(committed.files).toHaveLength(114);
    expect(committed.files.reduce((n, f) => n + f.bytes, 0)).toBe(82_191_933);
    const counts: Record<string, number> = {};
    for (const f of committed.files) counts[f.fighter] = (counts[f.fighter] ?? 0) + 1;
    expect(counts).toEqual({ kirby: 30, marth: 16, fox: 14, link: 13, donkeyKong: 12, mario: 11, pikachu: 9, samus: 9 });
  });

  it("has the named file sizes", () => {
    const sizeOf = (name: string) => committed.files.find((f) => f.path.endsWith("/" + name))?.bytes;
    expect(sizeOf("mario-c00.blend")).toBe(9_190_080);
    expect(sizeOf("alp_mario_002_col.png")).toBe(878);
    expect(sizeOf("deyes_eye_donkey_wd_col.png")).toBe(1_168);
    expect(sizeOf("eye_donkey_001.png")).toBe(9_995);
    const blends = committed.files.filter((f) => f.path.endsWith(".blend")).map((f) => f.bytes);
    expect(blends).toHaveLength(8);
    expect(Math.min(...blends)).toBe(4_295_156); // samus-c00.blend
    expect(Math.max(...blends)).toBe(9_983_644); // link-c00.blend
  });

  it("is byte-for-byte the manifest that was fetched and checked", () => {
    expect(createHash("sha256").update(committedText).digest("hex")).toBe("a1f3ebbc84ee9e8304c0348547f824192dd4ff9564380ed429a507bac54d6637");
  });

  it("is in the order the fetch script writes", () => {
    expect(committed.files).toEqual(sortFiles(committed.files));
  });
});

describe("parseManifest refuses a row that could reach outside the pinned c00 folders", () => {
  const withRow = (change: (rows: ManifestFile[]) => void, source?: Record<string, unknown>): unknown => {
    const rows = committed.files.map((f) => ({ ...f }));
    change(rows);
    return { ...committed, source: { ...committed.source, ...source }, files: rows };
  };
  const mario = "fighter/mario/model/body/c00/";
  /** The first row, with its path changed to `name` inside its own fighter's c00 folder. */
  const renamed = (name: string) => withRow((r) => void (r[0] = { ...r[0], path: c00Dir(FIGHTER_CODES[r[0].fighter]) + "/" + name }));
  const cases: Record<string, [unknown, RegExp]> = {
    "an unknown fighter id": [withRow((r) => void (r[0] = { ...r[0], fighter: "?", path: "fighter/?/model/body/c00/x.png" })), /unknown fighter/],
    "an inherited object key as a fighter": [withRow((r) => void (r[0] = { ...r[0], fighter: "toString" })), /unknown fighter/],
    "a byte count that is a string": [withRow((r) => void (r[0] = { ...r[0], bytes: "878" as unknown as number })), /byte count/],
    "a negative byte count": [withRow((r) => void (r[0] = { ...r[0], bytes: -1 })), /byte count/],
    "a fractional byte count": [withRow((r) => void (r[0] = { ...r[0], bytes: 1.5 })), /byte count/],
    "a path in another fighter's folder": [withRow((r) => void (r[0] = { ...r[0], path: `${mario}x_col.png` })), /directly in/],
    "a file in a subfolder": [renamed("sub/x_col.png"), /directly in/],
    "dot-dot segments": [renamed("../../../../../../evil/y.png"), /directly in/],
    "a script": [renamed("run.py"), /directly in/],
    "a normal map": [renamed("skin_001_nor.png"), /directly in/],
    "an odd file name": [renamed(".hidden.png"), /odd file name/],
    "the same path twice": [withRow((r) => void r.push({ ...r[0] })), /listed twice/],
    "a second .blend for a fighter": [withRow((r) => void r.push({ fighter: "mario", path: `${mario}other.blend`, bytes: 5, sha256: "a".repeat(64) })), /2 \.blend files for mario/],
    "a fighter with no .blend": [withRow((r) => void r.splice(0, r.length, ...r.filter((f) => !(f.fighter === "mario" && f.path.endsWith(".blend"))))), /no \.blend for mario/],
    "a different source project": [withRow(() => undefined, { project: "someone/else" }), /wrong source project/],
    "a different commit": [withRow(() => undefined, { commit: "master" }), /pinned to master/],
  };
  for (const [what, [manifest, error]] of Object.entries(cases)) {
    it(`refuses ${what}`, () => {
      expect(() => parseManifest(manifest)).toThrow(error);
    });
  }

  it("lets a partial manifest through only when asked, and still checks every row", () => {
    const some = { ...committed, files: committed.files.filter((f) => f.fighter === "mario") };
    expect(() => parseManifest(some)).toThrow(/no \.blend for donkeyKong/);
    expect(parseManifest(some, { requireAll: false }).files).toHaveLength(11);
    const bad = { ...some, files: [...some.files, { fighter: "mario", path: `${mario}x.png`, bytes: 0, sha256: "a".repeat(64) }] };
    expect(() => parseManifest(bad, { requireAll: false })).toThrow(/byte count/);
  });
});

describe("a download is checked for what it claims to be", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const html = new TextEncoder().encode("<!DOCTYPE html><html>Please sign in</html>");
  const blend = new TextEncoder().encode("BLENDER-v283RENDH");

  it("accepts a .blend and a PNG, and refuses an HTML page under either name", () => {
    expect(magicProblem("mario-c00.blend", blend)).toBeNull();
    expect(magicProblem("skin_mario_001_col.png", png)).toBeNull();
    expect(magicProblem("mario-c00.blend", html)).toMatch(/not a \.blend/);
    expect(magicProblem("skin_mario_001_col.png", html)).toMatch(/not a PNG/);
    expect(magicProblem("skin_mario_001_col.png", new Uint8Array())).toMatch(/not a PNG/);
  });
});
