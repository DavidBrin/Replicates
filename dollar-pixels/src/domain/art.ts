/**
 * Validation of what a buyer puts in their blocks: a caption, a colour, and
 * optionally a tile image.
 *
 * The tile rules matter more than they look. The image arrives as a data URL
 * from the browser, which means the declared MIME type is attacker-controlled
 * and the declared dimensions are whatever the client felt like claiming. So
 * we decode the PNG header ourselves and measure it (DECISIONS D14).
 */

import { rectPixelSize, type BlockRect } from "./geometry";

export const CAPTION_MIN = 1;
export const CAPTION_MAX = 60;

/** Decoded bytes, not base64 characters. 96 KB is generous for a tiny tile. */
export const MAX_TILE_BYTES = 96 * 1024;

const HEX_COLOUR_RE = /^#[0-9a-f]{6}$/;

/**
 * C0 controls and DEL.
 *
 * Written as escapes rather than a literal range: the literal form is
 * invisible in an editor, survives a copy-paste only by luck, and silently
 * becomes an empty character class if anything normalises the file.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A palette that reads as the era without being unusable. Not enforced — a hint. */
export const SUGGESTED_COLOURS = [
  "#c0182b",
  "#e2761b",
  "#d9ab22",
  "#1f9d2f",
  "#0a7cff",
  "#000099",
  "#7b2d8b",
  "#1b1b1b",
  "#7a7a7a",
  "#ffffff",
] as const;

export type ArtError =
  | "caption-empty"
  | "caption-too-long"
  | "caption-control-chars"
  | "colour-invalid"
  | "tile-not-data-url"
  | "tile-not-png"
  | "tile-corrupt"
  | "tile-too-large"
  | "tile-wrong-size";

export function artErrorMessage(error: ArtError, expected?: { width: number; height: number }): string {
  switch (error) {
    case "caption-empty":
      return "Give your blocks a caption.";
    case "caption-too-long":
      return `Captions are ${CAPTION_MAX} characters or fewer.`;
    case "caption-control-chars":
      return "Captions cannot contain control characters.";
    case "colour-invalid":
      return "Pick a colour in #rrggbb form.";
    case "tile-not-data-url":
      return "The tile must be an inline image.";
    case "tile-not-png":
      return "Tiles must be PNG. Animated formats are not accepted.";
    case "tile-corrupt":
      return "That image could not be read.";
    case "tile-too-large":
      return `Tiles must be under ${Math.floor(MAX_TILE_BYTES / 1024)} KB.`;
    case "tile-wrong-size":
      return expected
        ? `The tile must be exactly ${expected.width} x ${expected.height} pixels — the size you are buying.`
        : "The tile must be exactly the size you are buying.";
  }
}

/* --------------------------------------------------------------- caption -- */

export function normaliseCaption(input: string): string {
  // Collapse whitespace so a caption cannot be padded into looking like a
  // different length than it renders at.
  return input.replace(/\s+/g, " ").trim();
}

export function validateCaption(caption: string): ArtError | null {
  if (caption.length < CAPTION_MIN) return "caption-empty";
  if (caption.length > CAPTION_MAX) return "caption-too-long";
  if (CONTROL_CHARS.test(caption)) return "caption-control-chars";
  return null;
}

/* ---------------------------------------------------------------- colour -- */

export function normaliseColour(input: string): string {
  const trimmed = input.trim().toLowerCase();
  // Accept the #rgb shorthand a colour input might produce, expand it once here.
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return trimmed;
}

export function validateColour(colour: string): ArtError | null {
  return HEX_COLOUR_RE.test(colour) ? null : "colour-invalid";
}

/* ------------------------------------------------------------------ tile -- */

const PNG_PREFIX = "data:image/png;base64,";

/** The eight bytes every PNG starts with. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface TileMeta {
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

/**
 * Decode just enough of a PNG to know its real size.
 *
 * IHDR is always the first chunk and its width and height are big-endian
 * 32-bit integers at fixed offsets 16 and 20. That is all we need, and reading
 * only the header means a malicious payload never gets decoded.
 */
export function readPngMeta(dataUrl: string): TileMeta | ArtError {
  if (!dataUrl.startsWith("data:")) return "tile-not-data-url";
  if (!dataUrl.startsWith(PNG_PREFIX)) return "tile-not-png";

  const base64 = dataUrl.slice(PNG_PREFIX.length);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return "tile-corrupt";
  }

  if (bytes.length > MAX_TILE_BYTES) return "tile-too-large";
  // 8 magic + 4 length + 4 "IHDR" + 8 dimensions = 24 bytes minimum.
  if (bytes.length < 24) return "tile-corrupt";
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return "tile-not-png";
  }
  if (
    bytes[12] !== 0x49 || // I
    bytes[13] !== 0x48 || // H
    bytes[14] !== 0x44 || // D
    bytes[15] !== 0x52 //    R
  ) {
    return "tile-corrupt";
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) return "tile-corrupt";

  return { width, height, bytes: bytes.length };
}

/** Full check: the tile must be a PNG measuring exactly what was bought. */
export function validateTile(dataUrl: string, rect: BlockRect): ArtError | null {
  const meta = readPngMeta(dataUrl);
  if (typeof meta === "string") return meta;
  const expected = rectPixelSize(rect);
  if (meta.width !== expected.width || meta.height !== expected.height) {
    return "tile-wrong-size";
  }
  return null;
}

/**
 * Base64 -> bytes without depending on `atob` or `Buffer`.
 *
 * This module is imported by the browser, by route handlers and by tests under
 * three different runtimes; picking either global would make it environment
 * dependent for no gain.
 */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, "");
  if (clean.length % 4 !== 0) throw new Error("bad base64 length");

  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;

  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let o = 0;

  for (let i = 0; i < clean.length; i += 4) {
    let chunk = 0;
    for (let j = 0; j < 4; j++) {
      const ch = clean[i + j];
      const v = ch === "=" ? 0 : B64.indexOf(ch);
      if (v < 0) throw new Error("bad base64 character");
      chunk = (chunk << 6) | v;
    }
    if (o < out.length) out[o++] = (chunk >> 16) & 0xff;
    if (o < out.length) out[o++] = (chunk >> 8) & 0xff;
    if (o < out.length) out[o++] = chunk & 0xff;
  }

  return out;
}
