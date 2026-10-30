/**
 * What a model or texture file looks like (Plan 4 final wave): by name, the
 * formats only the model pipeline fetches or makes; by content, the first
 * bytes each of them starts with. The deploy guard (`check.mjs`) refuses
 * either anywhere in `public/` outside `public/models/`, and the commit guard
 * (`src/render3d/pipeline/noRippedAssets.test.ts`) refuses either in any
 * staged file, so the two lists cannot drift apart; the controller's pre-push
 * scan checks the same ones. A name is easy to change and the bytes are not:
 * a glb renamed `.bin`, or a texture pulled out of one, keeps its magic. A
 * compressed or re-encoded one does not, and chasing every container's magic
 * number is an arms race, so both guards also refuse any binary file outside
 * an explicit allowlist (`binaryKind`, `BINARY_ALLOW`; codex re-confirm, P2).
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
 * The binary files this package may hold, from the package root, each with why.
 * Every other binary file is refused, by the commit guard on staged blobs and
 * by the deploy guard in `public/` (which also allows the glbs `index.json`
 * names). These are all the binary files the package commits (`git ls-files`,
 * 2026-10-29): it has no fonts, icons, sounds or favicon (`src/app/icon.svg`
 * is text). A new one is added here, with its reason, or it is refused.
 */
export const BINARY_ALLOW = Object.freeze([
  Object.freeze({
    shown: BAKE_PATH,
    match: /^public\/bake\/roster\.bin\.gz$/,
    why: "the bone bake: integers computed from the project's own clips on the committed skeletons, which the sim reads (D57)",
  }),
  Object.freeze({
    shown: "docs/screenshots/*.png",
    match: /^docs\/screenshots\/[^/]+\.png$/,
    why: "the README's screenshots, captured by e2e/screenshots.spec.ts with every model request answered 404, so they show only the stand-ins (D57)",
  }),
]);

/** Whether `path` (from the package root) is on `BINARY_ALLOW`. */
export function binaryAllowed(path) {
  return BINARY_ALLOW.some((entry) => entry.match.test(path));
}

/** How many leading bytes the binary sniff reads: the first 8 KB. */
export const SNIFF_BYTES = 8192;

/** Compressed containers by their first bytes. Brotli has no magic number; raw deflate has none either, and is caught as a NUL byte or as bytes that are not text. */
const COMPRESSED = [
  { kind: "gzip", is: (h) => h[0] === 0x1f && h[1] === 0x8b }, // RFC 1952
  // RFC 1950: CMF 0x78 (deflate, 32 KB window), and FLG chosen so the two bytes are a multiple of 31.
  { kind: "zlib", is: (h) => h.length >= 2 && h[0] === 0x78 && (0x78 * 256 + h[1]) % 31 === 0 },
  { kind: "zip", is: (h) => h[0] === 0x50 && h[1] === 0x4b && [0x0304, 0x0506, 0x0708].includes((h[2] << 8) | h[3]) },
  { kind: "zstd", is: (h) => h[0] === 0x28 && h[1] === 0xb5 && h[2] === 0x2f && h[3] === 0xfd },
  { kind: "xz", is: (h) => [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00].every((b, i) => h[i] === b) },
  { kind: "bzip2", is: (h) => h[0] === 0x42 && h[1] === 0x5a && h[2] === 0x68 && h[3] >= 0x31 && h[3] <= 0x39 }, // "BZh1".."BZh9"
  { kind: "7z", is: (h) => [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].every((b, i) => h[i] === b) },
];
const IMAGES = [
  { kind: "PNG image", is: (h) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => h[i] === b) },
  { kind: "JPEG image", is: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  { kind: "GIF image", is: (h) => [0x47, 0x49, 0x46, 0x38].every((b, i) => h[i] === b) && (h[4] === 0x37 || h[4] === 0x39) && h[5] === 0x61 }, // GIF87a, GIF89a
  { kind: "WebP image", is: (h) => [0x52, 0x49, 0x46, 0x46].every((b, i) => h[i] === b) && [0x57, 0x45, 0x42, 0x50].every((b, i) => h[8 + i] === b) },
];

/**
 * What compressed container `head` starts as (gzip, zlib, zip, zstd, xz,
 * bzip2, 7z), or null.
 *
 * @param {Uint8Array} head
 * @returns {string | null}
 */
export function compressedKind(head) {
  return COMPRESSED.find((c) => c.is(head))?.kind ?? null;
}

/**
 * Why `head` (a file's first `SNIFF_BYTES` bytes, or all of a shorter one) is
 * a binary file, or null for text: a compressed container's or an image's
 * magic number, a NUL byte, or bytes that are not UTF-8 text (every text file
 * in the repository is UTF-8; checked 2026-10-29). A cut-off character at the
 * end of the 8 KB is not counted against it.
 *
 * @param {Uint8Array} head
 * @returns {string | null}
 */
export function binaryKind(head) {
  const compressed = compressedKind(head);
  if (compressed !== null) return `${compressed}-compressed`;
  const image = IMAGES.find((i) => i.is(head));
  if (image !== undefined) return image.kind;
  if (head.includes(0)) return "a NUL byte";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
  } catch {
    return "not UTF-8 text";
  }
  return null;
}

/**
 * What model or texture file `head` (a file's first 12 bytes or more, or all of a shorter one; RIFF's form type
 * sits at bytes 8 to 11) starts as, or null: a binary glTF, a .blend, a KTX or DDS texture, or a WebP (`RIFF`, a
 * length, then `WEBP`).
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
