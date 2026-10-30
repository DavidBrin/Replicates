// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { BAKE_PATH, PIPELINE_ONLY, SNIFF_BYTES, binaryAllowed, binaryKind, compressedKind, modelMagic } from "../../../scripts/models/rippedFormats.mjs";
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
 * makes (.blend, .glb, .gltf, .webp, .ktx2, .dds), or if it starts with one of
 * those formats' magic numbers (a glb renamed `.bin`, a texture pulled out of
 * a glb). A name pattern missed 17 of the 114 real files (`eye_donkey_001.png`,
 * `pikachu_facial_01_col.png`, …). The names and the magic numbers are
 * `scripts/models/rippedFormats.mjs`, the list the deploy guard refuses too.
 *
 * A model compressed, archived or re-encoded keeps none of its own first bytes
 * (codex re-confirm, P2), so two rules do not ask what a file holds: in this
 * package, any compressed file is refused unless `COMPRESSED_ALLOW` lists it,
 * and any binary file unless `BINARY_ALLOW` does. A text file that is not UTF-8
 * (Latin-1, say) counts as binary here, refused as "not UTF-8 text": save it as
 * UTF-8, or list it in `BINARY_ALLOW` with its reason. Both rules stop at this
 * package (round 3b ruling): the sibling projects, which other sessions work
 * on, commit their own screenshots, captures, icons, sounds and archives (about
 * 500 binary files), and a new one there must not turn this package's tests
 * red. The rules above (names, magic numbers, manifest bytes) still cover them,
 * and the controller's pre-push scan backs this package's pushes.
 *
 * The scan is the whole repo (`:/`), not just `super-smash/`: a file in `Risk/`
 * takes the same repo down. Paths are NUL-separated (`-z`) because git quotes a
 * name with a non-ASCII character, a tab, a quote or a backslash
 * (`"src/caf\303\251.glb"`), and the quoted form ends in `"`, which no extension
 * or prefix check would match.
 *
 * "By bytes" reads the STAGED blobs (`ls-files --stage`, `cat-file`), never the
 * working tree: what `git commit` records is the blob in the index, and a file
 * that is staged and then deleted, edited or restored on disk still ships.
 */

/** `super-smash/`: `pnpm test` runs here, as `layering.test.ts` and `envExample.test.ts` assume. */
const ROOT = process.cwd();
if (!existsSync(join(ROOT, "scripts", "models", "manifest.json"))) {
  throw new Error(`noRippedAssets.test.ts: run from super-smash/ (${ROOT} has no scripts/models/manifest.json)`);
}

/**
 * The git-ignored output folders, at any depth and in any letter case: the two the model pipeline writes, and
 * `test-results/`, where the capture scripts and Playwright write the pictures they take of the models.
 */
const IGNORED_OUTPUT = /(^|\/)(\.model-cache|public\/models|test-results)\//i;
/**
 * A picture the animation tools take (`animsheet.mjs`, `fightsheet.mjs`): a render of a ripped model is the same
 * exposure as the model, so one is refused wherever it lies, whether it was force-added past .gitignore or written
 * by `--out` into a tracked folder.
 */
const CAPTURE_PNG = /(^|\/)(anim|fight)-[^/]*\.png$/i;
const GITLINK = "160000";
/** This package's folder in the repo (`super-smash/`), which the binary allowlist's paths are relative to. */
const PACKAGE = execFileSync("git", ["rev-parse", "--show-prefix"], { cwd: ROOT, encoding: "utf8" }).trim();
/** The compressed files this package may hold, from the repo root, each with why. Every other one in the package is refused. */
const COMPRESSED_ALLOW: ReadonlyMap<string, string> = new Map([[PACKAGE + BAKE_PATH, "the bone bake (BINARY_ALLOW)"]]);
const MAX_BUFFER = 1 << 30;

/** A path in the index and the blob git would commit for it. */
interface IndexEntry {
  readonly path: string;
  readonly mode: string;
  readonly id: string;
}

/**
 * Index entries that are ripped assets, with why. `size`, `hash` and `head` (the blob's first `SNIFF_BYTES` bytes)
 * take a blob id and are injected so the rule is testable without real blobs.
 */
export function rippedAssets(
  entries: readonly Pick<IndexEntry, "path" | "id">[],
  manifest: ModelManifest,
  size: (id: string) => number,
  hash: (id: string) => string,
  head: (id: string) => Uint8Array,
): string[] {
  const names = new Set(manifest.files.map((f) => basename(f.path).toLowerCase()));
  const bySize = new Map<number, Set<string>>();
  for (const f of manifest.files) bySize.set(f.bytes, (bySize.get(f.bytes) ?? new Set()).add(f.sha256));
  const out: string[] = [];
  for (const { path, id } of entries) {
    if (IGNORED_OUTPUT.test(path)) out.push(`${path} (git-ignored output)`);
    else if (PIPELINE_ONLY.test(path)) out.push(`${path} (pipeline-only format)`);
    else if (CAPTURE_PNG.test(path)) out.push(`${path} (animation-tool capture)`);
    else if (names.has(basename(path).toLowerCase())) out.push(`${path} (manifest file name)`);
    else {
      // A model's magic number under a harmless name (outside public/models/: inside it, the folder rule above fired).
      const first = head(id);
      const magic = modelMagic(first);
      // Only a blob of exactly a manifest size can have a manifest hash.
      const shas = bySize.get(size(id));
      const inPackage = path.startsWith(PACKAGE);
      const compressed = inPackage ? compressedKind(first) : null;
      const binary = inPackage && !binaryAllowed(path.slice(PACKAGE.length)) ? binaryKind(first) : null;
      if (magic !== null) out.push(`${path} (model bytes: ${magic})`);
      else if (shas?.has(hash(id))) out.push(`${path} (manifest file bytes)`);
      else if (compressed !== null && !COMPRESSED_ALLOW.has(path)) out.push(`${path} (compressed: ${compressed}; a compressed file hides what it holds, and only the listed ones may be)`);
      else if (binary !== null) out.push(`${path} (binary outside the allowlist: ${binary})`);
    }
  }
  return out;
}

/** Every entry in the index (tracked, staged, or force-added past .gitignore), repo-wide, paths relative to the repo root. */
function indexEntries(env: NodeJS.ProcessEnv): IndexEntry[] {
  const out = execFileSync("git", ["ls-files", "--cached", "--stage", "-z", "--full-name", "--", ":/"], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    maxBuffer: MAX_BUFFER,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf("\t"); // "<mode> <blob id> <stage>\t<path>"
      const [mode, id] = record.slice(0, tab).split(" ");
      return { mode, id, path: record.slice(tab + 1) };
    });
}

/**
 * The size and first `SNIFF_BYTES` bytes of each blob, from one `cat-file --batch` (every staged blob in the repo,
 * about 180 MB in 3,300 blobs today, read in well under a second). A blob git cannot find is left out.
 */
function blobs(ids: readonly string[], env: NodeJS.ProcessEnv): Map<string, { size: number; head: Uint8Array }> {
  const unique = [...new Set(ids)];
  const found = new Map<string, { size: number; head: Uint8Array }>();
  if (unique.length === 0) return found;
  const out = execFileSync("git", ["cat-file", "--batch"], { cwd: ROOT, env, input: unique.join("\n") + "\n", maxBuffer: MAX_BUFFER });
  // Each object is "<id> <type> <size>\n", its bytes, then "\n"; one git cannot find is "<id> missing\n" alone.
  for (let at = 0; at < out.length; ) {
    const eol = out.indexOf(0x0a, at);
    const [id, type, size] = out.subarray(at, eol).toString("latin1").split(" ");
    at = eol + 1;
    if (size === undefined) continue;
    const bytes = Number(size);
    if (type === "blob") found.set(id, { size: bytes, head: out.subarray(at, at + Math.min(bytes, SNIFF_BYTES)) });
    at += bytes + 1;
  }
  return found;
}

/** Scan the index `env` points at (the real one unless a scratch `GIT_INDEX_FILE` is given). */
function scan(env: NodeJS.ProcessEnv = process.env, against: ModelManifest = manifest): string[] {
  const entries = indexEntries(env);
  // A gitlink (a submodule) names a commit in another repository, not a blob here.
  const found = blobs(entries.filter((e) => e.mode !== GITLINK).map((e) => e.id), env);
  const sha = (id: string) => createHash("sha256").update(execFileSync("git", ["cat-file", "blob", id], { cwd: ROOT, env, maxBuffer: MAX_BUFFER })).digest("hex");
  return rippedAssets(entries, against, (id) => found.get(id)?.size ?? -1, sha, (id) => found.get(id)?.head ?? new Uint8Array());
}

const manifest = parseManifest(JSON.parse(readFileSync(join(ROOT, "scripts", "models", "manifest.json"), "utf8")));

describe("the ripped-asset rule", () => {
  const sizes: Record<string, number> = { "docs/a.png": 1168, "docs/b.png": 1168, "src/x.ts": 10 };
  const shas: Record<string, string> = { "docs/a.png": manifest.files.find((f) => f.bytes === 1168)?.sha256 ?? "", "docs/b.png": "0".repeat(64), "src/x.ts": "1".repeat(64) };
  /** First bytes by path: each model format's magic number with filler, and two that only start like one. */
  const heads: Record<string, Uint8Array> = {
    "docs/a.bin": Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0]), Buffer.from("filler")]),
    "Risk/b.dat": Buffer.from("BLENDER-v300REND"),
    "art/c.png": Buffer.concat([Buffer.from([0xab]), Buffer.from("KTX 20"), Buffer.from([0xbb, 0x0d, 0x0a, 0x1a, 0x0a])]),
    "art/d.txt": Buffer.from("DDS |\0\0\0"),
    "e.jpg": Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8 ")]),
    "sounds/hit.wav": Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WAVEfmt ")]),
    "docs/short.txt": Buffer.from("glT"),
    "art/fox.glb.gz": gzipSync("glTF a glb, compressed"),
    "super-smash/public/bake/roster.bin.gz": gzipSync("the bake"),
    "Risk/public/bake/roster.bin.gz": gzipSync("another package's file of the same name"),
    "super-smash/docs/not-gzip.txt": Buffer.from([0x1f, 0x41, 0x42, 0x43]),
    "super-smash/art/fox.glb.gz": gzipSync("glTF a glb, compressed"),
    // Binary under this package's paths, and the same kinds elsewhere (codex re-confirm, P2).
    "super-smash/src/data.bin": deflateSync(Buffer.concat([Buffer.from("glTF"), Buffer.alloc(64, 0x41)])),
    "super-smash/public/pack.dat": Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("a zip entry")]),
    "Risk/frame.bin": Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from("a zstd frame")]),
    "super-smash/README.bin": Buffer.from("text, then a NUL\0"),
    "super-smash/src/notes.md": Buffer.from([0x68, 0x69, 0xc3, 0x28]),
    "super-smash/public/icons/logo.png": Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("an image nobody listed")]),
    "super-smash/docs/screenshots/new.png": Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("a README screenshot")]),
    "Risk/docs/screenshots/board.png": Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("another project's screenshot")]),
    "Risk/research/map-data/naturalearth/ne_110m_admin_0_countries.zip": Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("Natural Earth")]),
  };
  // A blob id stands for its path here; the real wiring is exercised against git below.
  const run = (paths: string[]) =>
    rippedAssets(
      paths.map((path) => ({ path, id: path })),
      manifest,
      (id) => sizes[id] ?? 0,
      (id) => shas[id] ?? "",
      (id) => heads[id] ?? new Uint8Array(),
    );

  it("catches names the old pattern missed, renamed copies, and pipeline formats", () => {
    expect(run(["public/eye_donkey_001.png", "art/pikachu_facial_01_col.png"])).toHaveLength(2);
    expect(run(["docs/a.png"])).toEqual(["docs/a.png (manifest file bytes)"]);
    expect(run(["x/fighter.webp", "y/z.ktx2", "a.glb", "b.blend"])).toHaveLength(4);
  });

  it("refuses a capture of the models, and anything under test-results/, wherever it lies", () => {
    expect(
      run(["super-smash/test-results/anim/anim-mario-attack.png", "Risk/test-results/x.txt", "super-smash/fight-mario-fsmash.png", "docs/shots/ANIM-link-land.PNG", "docs/fight-samus-neutralB.png"]),
    ).toEqual([
      "super-smash/test-results/anim/anim-mario-attack.png (git-ignored output)",
      "Risk/test-results/x.txt (git-ignored output)",
      "super-smash/fight-mario-fsmash.png (animation-tool capture)",
      "docs/shots/ANIM-link-land.PNG (animation-tool capture)",
      "docs/fight-samus-neutralB.png (animation-tool capture)",
    ]);
    // Not a capture: other pictures, and names that only start like one.
    expect(run(["docs/screenshots/title.png", "super-smash/docs/screenshots/match.png", "docs/animation.png", "docs/anim-notes.md", "docs/animal-fight.png", "src/test-results.ts"])).toEqual([]);
  });

  it("catches every name the deploy guard and the pre-push scan refuse, .dds included (final review M5)", () => {
    expect(run(["t/a.dds", "t/B.DDS", "t/c.webp", "t/d.ktx2", "t/e.gltf"])).toEqual([
      "t/a.dds (pipeline-only format)",
      "t/B.DDS (pipeline-only format)",
      "t/c.webp (pipeline-only format)",
      "t/d.ktx2 (pipeline-only format)",
      "t/e.gltf (pipeline-only format)",
    ]);
  });

  it("catches a model's first bytes under any name: a glb renamed .bin, a .blend, KTX, DDS and WebP textures (final review M5)", () => {
    expect(run(["docs/a.bin", "Risk/b.dat", "art/c.png", "art/d.txt", "e.jpg"])).toEqual([
      "docs/a.bin (model bytes: glTF bytes (a glb))",
      "Risk/b.dat (model bytes: BLENDER bytes (a .blend))",
      "art/c.png (model bytes: KTX bytes (a texture))",
      "art/d.txt (model bytes: DDS bytes (a texture))",
      "e.jpg (model bytes: RIFF/WEBP bytes (a WebP texture))",
    ]);
    // Only starting like one is not enough: a WAV is RIFF too, and three bytes are not glTF.
    expect(run(["sounds/hit.wav", "docs/short.txt"])).toEqual([]);
  });

  it("catches a gzip file in this package but the bake: compression hides a model's own first bytes (fw2 re-review)", () => {
    // gzip is both bytes, 1f 8b: 1f alone (text after it) is not.
    expect(run(["super-smash/art/fox.glb.gz", "super-smash/public/bake/roster.bin.gz", "super-smash/docs/not-gzip.txt"])).toEqual([
      "super-smash/art/fox.glb.gz (compressed: gzip; a compressed file hides what it holds, and only the listed ones may be)",
    ]);
  });

  it("keeps the compression and binary rules to this package: a sibling project's archive or picture is its own (round 3b ruling)", () => {
    // Other sessions work on the siblings; a new zip there must not turn this package's tests red.
    expect(run(["art/fox.glb.gz", "Risk/public/bake/roster.bin.gz", "Risk/frame.bin", "Risk/research/map-data/naturalearth/ne_110m_admin_0_countries.zip", "Risk/docs/screenshots/board.png"])).toEqual([]);
    expect(run(["super-smash/art/fox.glb.gz", "super-smash/public/pack.dat"])).toEqual([
      "super-smash/art/fox.glb.gz (compressed: gzip; a compressed file hides what it holds, and only the listed ones may be)",
      "super-smash/public/pack.dat (compressed: zip; a compressed file hides what it holds, and only the listed ones may be)",
    ]);
  });

  it("catches any compressed or binary file in this package but the listed ones (codex re-confirm, P2)", () => {
    expect(
      run([
        "super-smash/src/data.bin",
        "super-smash/public/pack.dat",
        "super-smash/README.bin",
        "super-smash/src/notes.md",
        "super-smash/public/icons/logo.png",
        "super-smash/docs/screenshots/new.png",
      ]),
    ).toEqual([
      "super-smash/src/data.bin (compressed: zlib; a compressed file hides what it holds, and only the listed ones may be)",
      "super-smash/public/pack.dat (compressed: zip; a compressed file hides what it holds, and only the listed ones may be)",
      "super-smash/README.bin (binary outside the allowlist: a NUL byte)",
      "super-smash/src/notes.md (binary outside the allowlist: not UTF-8 text)",
      "super-smash/public/icons/logo.png (binary outside the allowlist: PNG image)",
    ]);
  });

  it("passes ordinary files, even one the size of a texture", () => {
    expect(run(["docs/b.png", "src/x.ts", "scripts/models/manifest.json"])).toEqual([]);
  });

  it("finds the git-ignored folders at any depth and in any case, and a pipeline format in any case", () => {
    expect(run(["super-smash/.model-cache/src/mario/x.png", "Risk/Public/Models/a.json", "x/.Model-Cache/y.txt"])).toHaveLength(3);
    expect(run(["a/b.GLB", "a/b.blend2", "a/b.Blend1", "a/b.blend12"])).toHaveLength(4);
    expect(run(["super-smash/src/public/modelsets/a.json", "super-smash/docs/model-cache.md"])).toEqual([]);
  });

  it("matches a manifest name whatever its case", () => {
    expect(run(["Risk/EYE_DONKEY_001.PNG", "x/Mario-C00.Blend.txt"])).toEqual(["Risk/EYE_DONKEY_001.PNG (manifest file name)"]);
  });
});

/** A scratch index over a scratch object directory (the repo's own as an alternate): the real index, objects and tree are never touched. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "no-ripped-assets-"));
  const objects = join(dir, "objects");
  mkdirSync(objects);
  const realObjects = resolve(ROOT, execFileSync("git", ["rev-parse", "--git-path", "objects"], { cwd: ROOT, encoding: "utf8" }).trim());
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index"), GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: realObjects };
  const git = (args: string[], input?: string | Buffer) => execFileSync("git", args, { cwd: ROOT, env, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git(["read-tree", "HEAD"]);
  const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";
  return {
    env,
    /** Write `bytes` as a blob into the scratch object directory only. */
    blob: (bytes: string | Buffer) => git(["hash-object", "-w", "--stdin"], bytes).trim(),
    /** Stage `id` at `path` (replacing a tracked entry there, if any) without any working-tree file. */
    plant: (path: string, id = EMPTY_BLOB, mode = "100644") => void git(["update-index", "--add", "--info-only", "--cacheinfo", `${mode},${id},${path}`]),
    head: () => git(["rev-parse", "HEAD"]).trim(),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("no Nintendo-ripped asset is tracked", () => {
  it("ignores the model cache, the built models and Python bytecode", () => {
    const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
    for (const rule of ["/.model-cache/", "/public/models/", "*.blend", "*.blend1", "__pycache__/"]) expect(ignore).toContain(rule);
    const check = (p: string) => execFileSync("git", ["check-ignore", "-q", "--no-index", p], { cwd: ROOT, stdio: "pipe" });
    // `*.blend` alone ignores a .blend, so the cache rule is proven on files it alone covers: a texture and the Blender install.
    expect(() => check(".model-cache/src/mario/alp_mario_002_col.png")).not.toThrow();
    expect(() => check(".model-cache/tools/Blender.app/Contents/MacOS/Blender")).not.toThrow();
    expect(() => check(".model-cache/src/mario/mario-c00.blend")).not.toThrow();
    expect(() => check("scripts/anywhere/old.blend1")).not.toThrow();
    expect(() => check("public/models/mario.0123abcd.glb")).not.toThrow();
    expect(() => check("public/models/index.json")).not.toThrow();
    expect(() => check("scripts/models/__pycache__/x.pyc")).not.toThrow();
  });

  it("tracks and stages none of the manifest's files, by name or by bytes, anywhere in the repo", () => {
    expect(scan()).toEqual([]);
  });

  it("sees a ripped file whose name git would quote, or that sits outside super-smash/", () => {
    const s = scratch();
    try {
      expect(scan(s.env)).toEqual([]);
      const planted = [
        "super-smash/src/café.glb", // git prints this as "super-smash/src/caf\303\251.glb", quotes included
        'super-smash/src/we"ird.glb',
        "super-smash/public/models/マリオ.png",
        "x-root.glb", // the repo root, outside super-smash/
        "Risk/model.blend",
      ];
      for (const p of planted) s.plant(p);
      const flagged = scan(s.env).map((f) => f.replace(/ \(.*\)$/, ""));
      expect(flagged.sort()).toEqual([...planted].sort());
    } finally {
      s.cleanup();
    }
  });

  it("sees a capture force-added past .gitignore, or written into a tracked folder", () => {
    const s = scratch();
    try {
      expect(scan(s.env)).toEqual([]);
      const planted = [
        "super-smash/test-results/anim/anim-mario-attack.png", // `git add -f` of the capture scripts' default output
        "super-smash/fight-link-fsmash.png", // a package-root capture
        "super-smash/docs/screenshots/anim-kirby-land.png", // `--out` into a tracked folder
        "super-smash/test-results/.last-run.json", // anything Playwright leaves there
      ];
      for (const p of planted) s.plant(p);
      s.plant("super-smash/docs/screenshots/title.png"); // an ordinary picture is not one
      expect(scan(s.env).map((f) => f.replace(/ \(.*\)$/, "")).sort()).toEqual([...planted].sort());
    } finally {
      s.cleanup();
    }
  });

  it("sees model bytes staged under a harmless name anywhere in the repo, never the working tree (final review M5)", () => {
    const s = scratch();
    try {
      expect(scan(s.env)).toEqual([]);
      const planted: [string, Buffer][] = [
        ["super-smash/public/audit.bin", Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0]), Buffer.from("a glb renamed")])],
        ["super-smash/docs/screenshots/eye.png", Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8 a texture pulled out")])],
        ["Risk/notes.txt", Buffer.from("BLENDER-v300 a renamed .blend")],
        ["x-root.dat", Buffer.concat([Buffer.from([0xab]), Buffer.from("KTX 20"), Buffer.from([0xbb])])],
        ["super-smash/src/a.json", Buffer.from("DDS |\0\0\0 a texture")],
      ];
      for (const [path, bytes] of planted) s.plant(path, s.blob(bytes));
      // RIFF but not WebP: a WAV is no model. In another project, where only these rules apply (in this package any
      // binary file outside the allowlist is refused anyway).
      s.plant("Risk/public/sounds/hit.wav", s.blob(Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WAVEfmt ")])));
      const flagged = scan(s.env);
      expect(flagged.every((f) => f.includes(" (model bytes: "))).toBe(true);
      expect(flagged.map((f) => f.slice(0, f.indexOf(" (model bytes: "))).sort()).toEqual(planted.map(([path]) => path).sort());
      for (const [path] of planted) expect(existsSync(join(ROOT, "..", path))).toBe(false);
    } finally {
      s.cleanup();
    }
  });

  it("sees a compressed or binary blob staged outside the allowlists, under any name (codex re-confirm, P2)", () => {
    const s = scratch();
    try {
      expect(scan(s.env)).toEqual([]);
      const planted: [string, Buffer][] = [
        ["super-smash/src/data.bin", deflateSync(Buffer.concat([Buffer.from("glTF"), Buffer.alloc(64, 0x41)]))],
        ["super-smash/docs/archive.txt", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("a zip entry")])],
        ["super-smash/src/frame.bin", Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from("a zstd frame")])],
        ["super-smash/public/blob.json", Buffer.from("text, then a NUL\0")],
      ];
      for (const [path, bytes] of planted) s.plant(path, s.blob(bytes));
      // A new README screenshot is allowed; a sibling project's own picture and archive are its own (round 3b ruling).
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("a picture")]);
      s.plant("super-smash/docs/screenshots/new.png", s.blob(png));
      s.plant("Risk/docs/screenshots/new.png", s.blob(png));
      s.plant("Risk/frame.bin", s.blob(Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from("a zstd frame")])));
      s.plant("Risk/research/new-map.zip", s.blob(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("a zip entry")])));
      expect(scan(s.env).map((f) => f.slice(0, f.indexOf(" ("))).sort()).toEqual(planted.map(([path]) => path).sort());
    } finally {
      s.cleanup();
    }
  });

  it("sees a gzip staged in this package but the bake: a glb compressed hides its own magic (fw2 re-review)", () => {
    const s = scratch();
    try {
      expect(scan(s.env)).toEqual([]);
      const glb = gzipSync(Buffer.concat([Buffer.from("glTF"), Buffer.from("a glb")]));
      const planted = ["super-smash/public/fox.glb.gz", "super-smash/docs/screenshots/match.png", "super-smash/assets.tar.gz"];
      for (const path of planted) s.plant(path, s.blob(glb));
      // A new bake staged over the committed one is the one gzip allowed; a sibling's archive is the sibling's.
      s.plant("super-smash/public/bake/roster.bin.gz", s.blob(gzipSync("a new bake")));
      s.plant("Risk/assets.tar.gz", s.blob(glb));
      const flagged = scan(s.env);
      expect(flagged.every((f) => f.includes(" (compressed: gzip; "))).toBe(true);
      expect(flagged.map((f) => f.slice(0, f.indexOf(" (compressed: "))).sort()).toEqual([...planted].sort());
    } finally {
      s.cleanup();
    }
  });

  it("reads the staged blob, not the working tree: a file with a manifest file's bytes is caught under any name", () => {
    const s = scratch();
    try {
      // The manifest gets one synthetic row, so no ripped bytes are needed: any blob whose size and SHA-256 equal it counts.
      const hello = { fighter: "mario", path: "fighter/mario/model/body/c00/a_synthetic_col.png", bytes: 5, sha256: createHash("sha256").update("hello").digest("hex") };
      const against: ModelManifest = { ...manifest, files: [...manifest.files, hello] };
      const blob = s.blob("hello");
      expect(scan(s.env, against)).toEqual([]);

      s.plant("docs/harmless.txt", blob); // staged, and there is no such file on disk at all
      s.plant("super-smash/package.json", blob); // staged over a tracked file whose working copy is untouched and different
      s.plant("vendor/submodule", s.head(), GITLINK); // a gitlink holds a commit id and must not break the scan
      expect(scan(s.env, against).sort()).toEqual(["docs/harmless.txt (manifest file bytes)", "super-smash/package.json (manifest file bytes)"]);
      expect(existsSync(join(ROOT, "..", "docs", "harmless.txt"))).toBe(false);
    } finally {
      s.cleanup();
    }
  });
});
