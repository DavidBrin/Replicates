/**
 * Where the fighter models come from, and how a fetch proves it got them.
 *
 * Imported by `scripts/models/*.mjs` through Node's type stripping, so it has
 * no runtime imports, no enums and no parameter properties (as Plan 2's
 * `fighters/acmd/parse.ts`).
 *
 * The models are Worldblender's Blender re-exports of SSBU's own (README:
 * "near-straight imports from the original files"), pinned to one commit. They
 * are fetched into the git-ignored `.model-cache/`; only their SHA-256s are
 * committed (`scripts/models/manifest.json`), so the public repo never holds a
 * ripped file (spec §3.1) and a changed upstream file is refused, not used.
 */

export const MODEL_SOURCE = {
  project: "Worldblender/smash-ultimate-models-exported",
  projectId: 11666571,
  /** master as of 2026-10-24 (its last commit is 2021-11-01). */
  commit: "df76879171b064570b4e49a608c9f98211b33edb",
} as const;

/** Our fighter id → SSBU's fighter code (the folder under `fighter/`). */
export const FIGHTER_CODES: Readonly<Record<string, string>> = {
  mario: "mario",
  donkeyKong: "donkey",
  link: "link",
  samus: "samus",
  kirby: "kirby",
  fox: "fox",
  pikachu: "pikachu",
  marth: "marth",
};

export const MANIFEST_SCHEMA = 1;

export interface ManifestFile {
  readonly fighter: string;
  /** Path in the upstream repo. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ModelManifest {
  readonly schema: number;
  readonly source: typeof MODEL_SOURCE;
  readonly files: readonly ManifestFile[];
}

/** The c00 (default costume) body folder for a fighter code. */
export function c00Dir(code: string): string {
  return `fighter/${code}/model/body/c00`;
}

/**
 * The files a fighter needs: the .blend and every texture its materials can
 * reference. The .blend's materials use only colour maps (README "basic
 * materials"; verified on Mario's: ten `//*_col.png` image paths), so normal,
 * PRM and emissive maps are skipped. A few textures carry no suffix at all
 * (Donkey Kong's `eye_donkey_001.png`) and are kept.
 */
export function wantedFile(name: string): boolean {
  if (name.endsWith(".blend")) return true;
  return name.endsWith(".png") && !/_(nor|prm|emi)\.png$/.test(name);
}

export function rawUrl(path: string): string {
  return `https://gitlab.com/${MODEL_SOURCE.project}/-/raw/${MODEL_SOURCE.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function treeUrl(code: string): string {
  return `https://gitlab.com/api/v4/projects/${MODEL_SOURCE.projectId}/repository/tree?path=${encodeURIComponent(c00Dir(code))}&ref=${MODEL_SOURCE.commit}&per_page=100`;
}

/** Where a fetched file lives locally, relative to `super-smash/`. */
export function cachePath(file: Pick<ManifestFile, "fighter" | "path">): string {
  if (!Object.hasOwn(FIGHTER_CODES, file.fighter)) throw new Error(`refusing unknown fighter "${file.fighter}"`);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith(".")) throw new Error(`refusing odd file name "${name}"`);
  return `.model-cache/src/${file.fighter}/${name}`;
}

/**
 * Reads and checks a manifest. Every row must be a wanted file directly inside
 * its fighter's c00 folder at the pinned commit, with a real byte count and
 * SHA-256, and each fighter has exactly one .blend: the "never from master"
 * guarantee lives here, not only in the fetch script. `requireAll: false` lets
 * `--update-manifest --only <id>` check a manifest that does not yet hold all
 * eight fighters; every row is still checked.
 */
export function parseManifest(json: unknown, options: { requireAll?: boolean } = {}): ModelManifest {
  const requireAll = options.requireAll ?? true;
  const m = json as Partial<ModelManifest> | null;
  if (m === null || typeof m !== "object" || m.schema !== MANIFEST_SCHEMA) throw new Error("manifest: wrong schema");
  if (m.source?.commit !== MODEL_SOURCE.commit) throw new Error(`manifest: pinned to ${String(m.source?.commit)}, code pins ${MODEL_SOURCE.commit}`);
  if (m.source.project !== MODEL_SOURCE.project || m.source.projectId !== MODEL_SOURCE.projectId) throw new Error("manifest: wrong source project");
  if (!Array.isArray(m.files)) throw new Error("manifest: no files");
  const paths = new Set<string>();
  const blends = new Map<string, number>();
  for (const f of m.files) {
    if (f === null || typeof f !== "object") throw new Error("manifest: a row is not an object");
    if (typeof f.fighter !== "string" || !Object.hasOwn(FIGHTER_CODES, f.fighter)) throw new Error(`manifest: unknown fighter ${JSON.stringify(f.fighter)}`);
    if (typeof f.path !== "string") throw new Error(`manifest: a ${f.fighter} row has no path`);
    if (!Number.isSafeInteger(f.bytes) || f.bytes <= 0) throw new Error(`manifest: ${f.path} has no valid byte count`);
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`manifest: ${f.path} has no sha256`);
    const dir = c00Dir(FIGHTER_CODES[f.fighter]) + "/";
    const name = f.path.slice(dir.length);
    if (!f.path.startsWith(dir) || name.includes("/") || !wantedFile(name)) {
      throw new Error(`manifest: ${f.path} is not a .blend or colour map directly in ${f.fighter}'s c00 folder`);
    }
    cachePath(f);
    if (paths.has(f.path)) throw new Error(`manifest: ${f.path} is listed twice`);
    paths.add(f.path);
    if (name.endsWith(".blend")) blends.set(f.fighter, (blends.get(f.fighter) ?? 0) + 1);
  }
  const fighters = requireAll ? Object.keys(FIGHTER_CODES) : [...new Set(m.files.map((f) => f.fighter))];
  for (const id of fighters) {
    const n = blends.get(id) ?? 0;
    if (n === 0) throw new Error(`manifest: no .blend for ${id}`);
    if (n > 1) throw new Error(`manifest: ${n} .blend files for ${id}, expected one`);
  }
  return m as ModelManifest;
}

const ORDER = new Intl.Collator("en-US");

/**
 * The manifest's row order: by fighter, then path, under a fixed en-US collation
 * (not the machine's locale), so a rerun on another machine rewrites the same
 * bytes. It is the order the committed manifest was written in; plain code-unit
 * order would move 8 rows and change the file's digest.
 */
export function sortFiles(files: readonly ManifestFile[]): ManifestFile[] {
  return [...files].sort((a, b) => ORDER.compare(a.fighter, b.fighter) || ORDER.compare(a.path, b.path));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Why a downloaded file is not what its name says (an HTML sign-in or error
 * page served with a 200, say), or null. Checked before a file is accepted, so
 * a manifest can never record a page as `mario-c00.blend`.
 */
export function magicProblem(name: string, bytes: Uint8Array): string | null {
  if (name.endsWith(".blend")) {
    const ok = "BLENDER".split("").every((c, i) => bytes[i] === c.charCodeAt(0));
    return ok ? null : `${name} does not start with BLENDER: not a .blend file`;
  }
  if (name.endsWith(".png")) {
    return PNG_SIGNATURE.every((b, i) => bytes[i] === b) ? null : `${name} does not start with the PNG signature: not a PNG`;
  }
  return null;
}

/** Why a downloaded or cached file is not the one the manifest pins, or null if it is. */
export function fileProblem(want: ManifestFile, bytes: number, sha256: string): string | null {
  if (bytes !== want.bytes) return `${want.path}: ${bytes} bytes, manifest says ${want.bytes}`;
  if (sha256 !== want.sha256) return `${want.path}: sha256 ${sha256.slice(0, 12)}…, manifest says ${want.sha256.slice(0, 12)}…`;
  return null;
}
