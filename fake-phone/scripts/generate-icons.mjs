/**
 * Generates the PWA icon set as real PNGs, with no dependencies.
 *
 * Icons are generated rather than committed as binaries for the same reason the
 * ringtone is (see `generate-audio.mjs`): every asset in this repo should be
 * original, reproducible, and free of third-party licensing. `node:zlib` gives
 * us the deflate stream a PNG needs, and the rest of the format is a handful of
 * length-prefixed, CRC-checked chunks.
 *
 * The mark is a beacon — concentric rings radiating from a filled centre. It
 * reads as "a signal going out" at 512px and as a warm dot at 32px, and it is
 * deliberately not a phone handset: the app's icon should not announce what it
 * is to someone glancing at the home screen over your shoulder.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const GROUND = [0x0b, 0x0b, 0x0f];
const ACCENT = [0xff, 0xb3, 0x40];

/* ------------------------------------------------------------------- png -- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes RGB pixel rows as a PNG. `pixels` is a flat RGB byte array. */
function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  // 10..12: compression, filter, interlace — all zero (the only values PNG
  // defines), so the allocation's zero-fill already has them right.

  // Each scanline is prefixed with a filter-type byte; 0 = None. Filtering
  // would compress better, but these are flat-colour icons and the files are
  // already ~2KB.
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ mark -- */

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** 0 → 1 over an edge one pixel wide, so rings are anti-aliased. */
function coverage(distance, radius, halfWidth, feather) {
  const edge = Math.abs(distance - radius);
  return 1 - Math.min(1, Math.max(0, (edge - halfWidth) / feather));
}

function renderMark(size) {
  const pixels = new Uint8Array(size * size * 3);
  const centre = (size - 1) / 2;
  const unit = size / 100;
  const feather = Math.max(1, unit * 0.9);

  // A filled core plus two rings, each dimmer than the last — the signal
  // getting weaker as it travels outward.
  const rings = [
    { radius: 30 * unit, halfWidth: 3.2 * unit, alpha: 0.85 },
    { radius: 43 * unit, halfWidth: 2.6 * unit, alpha: 0.5 },
  ];
  const coreRadius = 14 * unit;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);

      let alpha = 1 - Math.min(1, Math.max(0, (distance - coreRadius) / feather));
      for (const ring of rings) {
        alpha = Math.max(alpha, coverage(distance, ring.radius, ring.halfWidth, feather) * ring.alpha);
      }

      const [r, g, b] = mix(GROUND, ACCENT, alpha);
      const offset = (y * size + x) * 3;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ main -- */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  // iOS ignores the manifest's icons for the home-screen tile and uses this.
  { size: 180, name: "apple-touch-icon.png" },
];

for (const { size, name } of targets) {
  const png = encodePng(size, renderMark(size));
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`wrote public/icons/${name} (${size}×${size}, ${png.length} bytes)`);
}
