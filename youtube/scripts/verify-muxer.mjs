/**
 * Builds a real fMP4 rendition from synthetic samples, writes it to disk, reads
 * it back, and reports what it checked.
 *
 * This exists for the reader who does not want to read the test suite. The
 * suite proves the muxer works; this shows it, in one screen: the box tree the
 * muxer produced, the offsets a demuxer would follow, and a list of the
 * specific claims that were verified against the bytes on disk rather than
 * against the muxer's own arithmetic.
 *
 * Everything here is checked the hard way. `trun.data_offset` is recomputed
 * from `mdat`'s parsed position; sample bytes are recovered by walking the
 * file's own pointers; `tfdt` continuity is recomputed from each segment's
 * `trun` durations. Nothing calls back into the code that produced the numbers.
 *
 * Usage: node scripts/verify-muxer.mjs
 *
 * The TypeScript sources are loaded through Vite's SSR module loader rather
 * than imported directly. Node's own type stripping cannot resolve the
 * extensionless relative imports the rest of the project uses, and adding
 * `.ts` extensions everywhere would need a tsconfig flag this repo does not
 * set — a shared file six other slices are building against. Vite is already
 * a devDependency, so this adds nothing to package.json.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

/* ------------------------------------------------------------- reporting -- */

const checks = [];

function check(claim, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ claim, pass, actual, expected });
  return pass;
}

function heading(text) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

/* ---------------------------------------------------------------- loading -- */

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const muxer = await server.ssrLoadModule("/src/media/muxer/index.ts");
const packager = await server.ssrLoadModule("/src/media/packager/index.ts");
await server.close();

const {
  TrackMuxer,
  formatBoxTree,
  parseBoxes,
  parseFtyp,
  parseMdhd,
  parseTfdt,
  parseTfhd,
  parseTkhd,
  parseTrex,
  parseTrun,
  requireBox,
  flattenBoxes,
} = muxer;

/* --------------------------------------------------------------- fixtures -- */

/**
 * A fabricated AVCDecoderConfigurationRecord — real structure, placeholder
 * SPS/PPS. The muxer copies it verbatim, so the bytes only have to be the right
 * shape for the round trip to be meaningful.
 */
const AVCC = Uint8Array.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x06, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x01, 0x00,
  0x04, 0x68, 0xeb, 0xe3, 0xcb,
]);

/** AudioSpecificConfig: AAC-LC, 48 kHz, stereo. */
const AAC_LC_48K_STEREO = Uint8Array.from([0x11, 0x90]);

const FRAME_DURATION_US = 33_367; // 30000/1001 fps, so nothing divides evenly
const FRAMES_PER_SEGMENT = 180; // ~6 seconds, Apple's recommended target
const SEGMENT_COUNT = 4;

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticGop(seed, startUs, count, frameDurationUs) {
  const random = prng(seed);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const size = i === 0 ? 9000 + Math.floor(random() * 2000) : 400 + Math.floor(random() * 900);
    const data = new Uint8Array(size);
    for (let b = 0; b < size; b++) data[b] = Math.floor(random() * 256);
    samples.push({
      data,
      timestampUs: startUs + i * frameDurationUs,
      durationUs: frameDurationUs,
      isKeyFrame: i === 0,
    });
  }
  return samples;
}

/* ------------------------------------------------------------------ build -- */

const video = new TrackMuxer({
  config: {
    kind: "video",
    codec: "avc1.640028",
    description: AVCC,
    timescale: 1_000_000,
    width: 1280,
    height: 720,
  },
  trackId: 1,
  movieTimescale: 1000,
});

const audio = new TrackMuxer({
  config: {
    kind: "audio",
    codec: "mp4a.40.2",
    description: AAC_LC_48K_STEREO,
    timescale: 48_000,
    sampleRate: 48_000,
    channelCount: 2,
  },
  trackId: 1,
  movieTimescale: 1000,
});

const videoInput = [];
const videoSegments = [];
for (let i = 0; i < SEGMENT_COUNT; i++) {
  const samples = syntheticGop(
    i + 1,
    i * FRAMES_PER_SEGMENT * FRAME_DURATION_US,
    FRAMES_PER_SEGMENT,
    FRAME_DURATION_US,
  );
  videoInput.push(samples);
  videoSegments.push(video.packageSegment(samples));
}

for (let i = 0; i < SEGMENT_COUNT; i++) {
  // 1024 samples per AAC frame at 48 kHz is 21333.33µs; WebCodecs reports
  // integer microseconds, so 21333 is what actually arrives.
  audio.packageSegment(syntheticGop(100 + i, i * 281 * 21_333, 281, 21_333));
}

const videoInit = video.initSegment();
const audioInit = audio.initSegment();

/* ------------------------------------------------------------------ write -- */

const outputDir = mkdtempSync(join(tmpdir(), "verify-muxer-"));
writeFileSync(join(outputDir, "video-init.mp4"), videoInit);
writeFileSync(join(outputDir, "audio-init.mp4"), audioInit);
for (const [index, segment] of videoSegments.entries()) {
  writeFileSync(join(outputDir, `video-${index}.m4s`), segment.data);
}

const mediaPlaylist = packager.buildMediaPlaylist({
  segments: videoSegments.map((segment, index) => ({
    uri: `video-${index}.m4s`,
    durationSeconds: segment.durationSeconds,
  })),
  initSegmentUri: "video-init.mp4",
  playlistType: "VOD",
});
writeFileSync(join(outputDir, "video.m3u8"), mediaPlaylist);

const master = packager.buildLadderMaster({
  variants: [
    {
      rung: { name: "720p", width: 1280, height: 720, bitrate: 2_800_000, codec: "avc1.640028" },
      uri: "video.m3u8",
      frameRate: 30000 / 1001,
    },
  ],
  audio: {
    groupId: "aac-stereo",
    name: "English",
    uri: "audio.m3u8",
    codec: "mp4a.40.2",
    channels: "2",
    language: "en",
    bitrate: 128_000,
  },
});
writeFileSync(join(outputDir, "master.m3u8"), master);

/* ----------------------------------------------------------------- verify -- */

// Re-read everything from the parsed bytes. Nothing below consults the muxer.
const initBoxes = parseBoxes(videoInit);
const firstSegmentBoxes = parseBoxes(videoSegments[0].data);

heading(`Init segment — ${videoInit.byteLength} bytes`);
console.log(formatBoxTree(initBoxes));

heading(`Media segment 0 — ${videoSegments[0].data.byteLength} bytes`);
console.log(formatBoxTree(firstSegmentBoxes));

// 1. Every declared size is consistent with the tree, recursively.
let sizesConsistent =
  initBoxes.reduce((sum, box) => sum + box.size, 0) === videoInit.byteLength;
for (const bytes of [videoInit, audioInit, ...videoSegments.map((s) => s.data)]) {
  const boxes = parseBoxes(bytes);
  if (boxes.reduce((sum, box) => sum + box.size, 0) !== bytes.byteLength) sizesConsistent = false;
  for (const box of flattenBoxes(boxes)) {
    if (box.children.length === 0) continue;
    const prefix = box.childrenOffset - box.offset;
    const childBytes = box.children.reduce((sum, child) => sum + child.size, 0);
    if (prefix + childBytes !== box.size) sizesConsistent = false;
  }
}
check("every box's declared size equals its serialised length, recursively", sizesConsistent, true);

// 2. The init segment is exactly ftyp + moov, with brands we conform to.
check("init segment is ftyp + moov and nothing else", initBoxes.map((b) => b.type), [
  "ftyp",
  "moov",
]);
const ftyp = parseFtyp(requireBox(initBoxes, "ftyp"));
check("compatible brands are iso5, iso6, mp41", ftyp.compatibleBrands, ["iso5", "iso6", "mp41"]);

// 3. mvex/trex — without which the file reads as having zero samples.
check(
  "moov declares mvex, so the file is understood as fragmented",
  requireBox(initBoxes, "moov.mvex").children.map((b) => b.type),
  ["trex"],
);
check(
  "trex.track_ID matches tkhd.track_ID",
  parseTrex(requireBox(initBoxes, "moov.mvex.trex")).trackId,
  parseTkhd(requireBox(initBoxes, "moov.trak.tkhd")).trackId,
);

// 4. tkhd.duration is in the movie timescale, mdhd.duration in the track's.
const tkhd = parseTkhd(requireBox(initBoxes, "moov.trak.tkhd"));
const mdhd = parseMdhd(requireBox(initBoxes, "moov.trak.mdia.mdhd"));
const elapsedUs = SEGMENT_COUNT * FRAMES_PER_SEGMENT * FRAME_DURATION_US;
check(
  "tkhd.duration is in the movie timescale (1000)",
  tkhd.duration,
  Math.round((elapsedUs * 1000) / 1_000_000),
);
check("mdhd.duration is in the track timescale (1e6)", [mdhd.timescale, mdhd.duration], [
  1_000_000,
  elapsedUs,
]);

// 5. The codec configuration record survived verbatim.
check(
  "avcC payload is byte-identical to the description supplied",
  [...requireBox(initBoxes, "moov.trak.mdia.minf.stbl.stsd.avc1.avcC").payload],
  [...AVCC],
);
check(
  "the audio init segment carries the AudioSpecificConfig inside esds",
  [
    ...requireBox(parseBoxes(audioInit), "moov.trak.mdia.minf.stbl.stsd.mp4a.esds").payload.slice(
      35,
      37,
    ),
  ],
  [...AAC_LC_48K_STEREO],
);

// 6. tfdt on every traf, version 1, and continuous across segments.
let everyTrafHasTfdt = true;
let tfdtVersion = 1;
let expectedDecodeTime = 0;
let tfdtContinuous = true;
for (const segment of videoSegments) {
  const boxes = parseBoxes(segment.data);
  for (const traf of requireBox(boxes, "moof").children.filter((b) => b.type === "traf")) {
    const tfdtBox = traf.children.find((b) => b.type === "tfdt");
    if (!tfdtBox) {
      everyTrafHasTfdt = false;
      continue;
    }
    const tfdt = parseTfdt(tfdtBox);
    tfdtVersion = tfdt.version;
    if (tfdt.baseMediaDecodeTime !== expectedDecodeTime) tfdtContinuous = false;

    // Advance by what this fragment's own trun says it holds, which is the
    // consistency Apple's rule 7.3 demands between consecutive segments.
    const tfhd = parseTfhd(requireBox([traf], "traf.tfhd"));
    const trun = parseTrun(requireBox([traf], "traf.trun"));
    for (const sample of trun.samples) {
      expectedDecodeTime += sample.duration ?? tfhd.defaultSampleDuration;
    }
  }
}
check("every traf carries a tfdt", everyTrafHasTfdt, true);
check("tfdt uses version 1, so a long stream cannot overflow it", tfdtVersion, 1);
check(
  "tfdt runs continuously across segments, with no drift",
  [tfdtContinuous, expectedDecodeTime],
  [true, Math.round(elapsedUs)],
);

// 7. trun.data_offset, recomputed from mdat's own parsed position.
let offsetsCorrect = true;
for (const segment of videoSegments) {
  const boxes = parseBoxes(segment.data);
  const moof = requireBox(boxes, "moof");
  const mdat = requireBox(boxes, "mdat");
  const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
  if (trun.dataOffset !== mdat.offset + mdat.headerSize - moof.offset) offsetsCorrect = false;
}
check("trun.data_offset points at the first byte of mdat's payload", offsetsCorrect, true);

// 8. Sample flags: the exact words, not a derived boolean.
const firstTrun = parseTrun(requireBox(firstSegmentBoxes, "moof.traf.trun"));
const firstTfhd = parseTfhd(requireBox(firstSegmentBoxes, "moof.traf.tfhd"));
check(
  "the leading keyframe is flagged 0x02000000 (sync)",
  `0x${(firstTrun.firstSampleFlags >>> 0).toString(16).padStart(8, "0")}`,
  "0x02000000",
);
check(
  "delta frames default to 0x01010000 (depends-on, non-sync)",
  `0x${(firstTfhd.defaultSampleFlags >>> 0).toString(16).padStart(8, "0")}`,
  "0x01010000",
);
check("tfhd flags are default-base-is-moof plus the three defaults", `0x${firstTfhd.flags.toString(16)}`, "0x20038");

// 9. Byte recovery: walk the file's own pointers, like a demuxer would.
let recoveredBytes = 0;
let recoveryExact = true;
for (const [index, segment] of videoSegments.entries()) {
  const boxes = parseBoxes(segment.data);
  const moof = requireBox(boxes, "moof");
  const traf = requireBox(boxes, "moof.traf");
  const tfhd = parseTfhd(requireBox([traf], "traf.tfhd"));
  const trun = parseTrun(requireBox([traf], "traf.trun"));

  let at = moof.offset + trun.dataOffset;
  for (const [sampleIndex, sample] of trun.samples.entries()) {
    const size = sample.size ?? tfhd.defaultSampleSize;
    const recovered = segment.data.subarray(at, at + size);
    const original = videoInput[index][sampleIndex].data;
    if (recovered.byteLength !== original.byteLength) recoveryExact = false;
    else {
      for (let b = 0; b < size; b++) {
        if (recovered[b] !== original[b]) {
          recoveryExact = false;
          break;
        }
      }
    }
    recoveredBytes += size;
    at += size;
  }
}
check(
  "every sample's bytes are recovered exactly by following trun's own offsets",
  recoveryExact,
  true,
);

// 10. The playlist's target duration is not below any of its own EXTINFs.
const extinfs = mediaPlaylist
  .split("\n")
  .filter((line) => line.startsWith("#EXTINF:"))
  .map((line) => Number(line.slice("#EXTINF:".length).split(",")[0]));
const target = Number(
  mediaPlaylist
    .split("\n")
    .find((line) => line.startsWith("#EXT-X-TARGETDURATION:"))
    .slice("#EXT-X-TARGETDURATION:".length),
);
check(
  "EXT-X-TARGETDURATION is at least every EXTINF in its own playlist",
  extinfs.every((duration) => duration <= target),
  true,
);

/* ----------------------------------------------------------------- report -- */

heading("Playlists");
console.log(master.trimEnd());
console.log();
console.log(mediaPlaylist.trimEnd());

heading("Verified");
for (const { claim, pass, actual, expected } of checks) {
  console.log(`  [${pass ? "ok" : "FAIL"}] ${claim}`);
  if (!pass) {
    console.log(`         expected ${JSON.stringify(expected)}`);
    console.log(`         actual   ${JSON.stringify(actual)}`);
  }
}

const failed = checks.filter((entry) => !entry.pass).length;
heading("Summary");
console.log(
  `  tracks        1 video (avc1, 1e6 timescale) + 1 audio (mp4a, 48000 timescale, ${audio.segmentCount} segments)`,
);
console.log(
  `  video         ${SEGMENT_COUNT} segments, ${FRAMES_PER_SEGMENT} frames each, ${(
    elapsedUs / 1e6
  ).toFixed(3)}s at 30000/1001 fps`,
);
console.log(`  sample bytes  ${recoveredBytes.toLocaleString("en-US")} recovered and compared`);
console.log(`  written to    ${outputDir}`);
console.log(`  checks        ${checks.length - failed}/${checks.length} passed`);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
