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
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.startsWith(".")) throw new Error(`refusing odd file name "${name}"`);
  return `.model-cache/src/${file.fighter}/${name}`;
}

export function parseManifest(json: unknown): ModelManifest {
  const m = json as Partial<ModelManifest> | null;
  if (m === null || typeof m !== "object" || m.schema !== MANIFEST_SCHEMA) throw new Error("manifest: wrong schema");
  if (m.source?.commit !== MODEL_SOURCE.commit) throw new Error(`manifest: pinned to ${String(m.source?.commit)}, code pins ${MODEL_SOURCE.commit}`);
  if (!Array.isArray(m.files)) throw new Error("manifest: no files");
  for (const id of Object.keys(FIGHTER_CODES)) {
    if (!m.files.some((f) => f.fighter === id && f.path.endsWith(".blend"))) throw new Error(`manifest: no .blend for ${id}`);
  }
  for (const f of m.files) {
    if (!/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(`manifest: ${f.path} has no sha256`);
    if (!f.path.startsWith(c00Dir(FIGHTER_CODES[f.fighter] ?? "?") + "/")) throw new Error(`manifest: ${f.path} is outside ${f.fighter}'s c00 folder`);
    cachePath(f);
  }
  return m as ModelManifest;
}

/** Why a downloaded or cached file is not the one the manifest pins, or null if it is. */
export function fileProblem(want: ManifestFile, bytes: number, sha256: string): string | null {
  if (bytes !== want.bytes) return `${want.path}: ${bytes} bytes, manifest says ${want.bytes}`;
  if (sha256 !== want.sha256) return `${want.path}: sha256 ${sha256.slice(0, 12)}…, manifest says ${want.sha256.slice(0, 12)}…`;
  return null;
}
