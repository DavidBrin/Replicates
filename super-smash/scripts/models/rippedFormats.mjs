/**
 * What a model or texture file looks like (Plan 4 final wave): by name, the
 * formats only the model pipeline fetches or makes; by content, the first
 * bytes each of them starts with. The deploy guard (`check.mjs`) refuses
 * either anywhere in `public/` outside `public/models/`, and the commit guard
 * (`src/render3d/pipeline/noRippedAssets.test.ts`) refuses either in any
 * staged file, so the two lists cannot drift apart; the controller's pre-push
 * scan checks the same ones. A name is easy to change and the bytes are not:
 * a glb renamed `.bin`, or a texture pulled out of one, keeps its magic. A
 * compressed one does not, so both guards also refuse any gzip but the bake
 * (`isGzip`, `BAKE_PATH`; final wave part 2 re-review).
 *
 * No imports, so `check.mjs` can run it from any copy.
 */

/** A file name in a format only the pipeline fetches or makes: Blender's files and their backups, glTF, and the textures (WebP, KTX2, DDS). */
export const PIPELINE_ONLY = /\.(blend\d*|glb|gltf|webp|ktx2|dds)$/i;

/** Signatures at the start of a file, with what a file that starts so is. */
const SIGNATURES = [
  { bytes: [0x67, 0x6c, 0x54, 0x46], kind: "glTF bytes (a glb)" }, // "glTF"
  { bytes: [0x42, 0x4c, 0x45, 0x4e, 0x44, 0x45, 0x52], kind: "BLENDER bytes (a .blend)" }, // "BLENDER"
  { bytes: [0xab, 0x4b, 0x54, 0x58], kind: "KTX bytes (a texture)" }, // "«KTX"
  { bytes: [0x44, 0x44, 0x53, 0x20], kind: "DDS bytes (a texture)" }, // "DDS "
];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** The one gzip file the repo commits and a deploy carries, from the package root: the bone bake. */
export const BAKE_PATH = "public/bake/roster.bin.gz";

/**
 * Whether `head` starts with gzip's magic number (RFC 1952 §2.3.1). Compression
 * hides the first bytes of whatever is inside, a glb's glTF among them, so any
 * gzip but the bake is refused rather than opened.
 *
 * @param {Uint8Array} head
 */
export function isGzip(head) {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

/** How many leading bytes `modelMagic` reads: RIFF's form type sits at bytes 8 to 11. */
export const MAGIC_BYTES = 12;

/**
 * What model or texture file `head` (a file's first `MAGIC_BYTES` bytes, or all of a shorter one) starts as, or
 * null: a binary glTF, a .blend, a KTX or DDS texture, or a WebP (`RIFF`, a length, then `WEBP`).
 *
 * @param {Uint8Array} head
 * @returns {string | null}
 */
export function modelMagic(head) {
  const at = (sig, from = 0) => sig.every((b, i) => head[from + i] === b);
  for (const { bytes, kind } of SIGNATURES) if (at(bytes)) return kind;
  if (at(RIFF) && at(WEBP, 8)) return "RIFF/WEBP bytes (a WebP texture)";
  return null;
}
