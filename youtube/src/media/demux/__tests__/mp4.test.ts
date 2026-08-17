// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { TrackConfig } from "../../types";
import { ByteWriter } from "../../muxer/writer";
import {
  mdatHeaderSize,
  writeDinf,
  writeFtyp,
  writeMdhd,
  writeMvhd,
  writeSmhd,
  writeStsd,
  writeTkhd,
  writeVmhd,
  writeMdatHeader,
} from "../../muxer/boxes";
import { buildInitSegment } from "../../muxer/init-segment";
import { Mp4DemuxError, byteSourceFromBytes, openMp4, unitsToMicroseconds } from "../mp4";

/**
 * The file level: locating `moov`, reading `stsd`, and failing on the files
 * that are not what they claim.
 *
 * The fixture writer below builds a *progressive* MP4 — a real one, with real
 * chunk offsets pointing into a real `mdat` — because that is the only kind of
 * file this demuxer reads and there is no way to obtain one honestly except by
 * writing it. It reuses the muxer's box writers for everything the muxer
 * already writes (`ftyp`, `mvhd`, `tkhd`, `mdhd`, `stsd`) and hand-writes the
 * six sample-table boxes the muxer only ever emits empty. Nothing here is
 * downloaded.
 *
 * `roundtrip.test.ts` has a second, independently written fixture builder, and
 * that duplication is deliberate — see its header.
 */

/* -------------------------------------------------------------- fixtures -- */

const AVCC = Uint8Array.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x64, 0x01, 0x00, 0x02, 0x68, 0xee,
]);
const AAC_LC_48K_STEREO = Uint8Array.from([0x11, 0x90]);

const VIDEO_CONFIG: TrackConfig = {
  kind: "video",
  codec: "avc1.640028",
  description: AVCC,
  timescale: 30_000,
  width: 1280,
  height: 720,
};

const AUDIO_CONFIG: TrackConfig = {
  kind: "audio",
  codec: "mp4a.40.2",
  description: AAC_LC_48K_STEREO,
  timescale: 48_000,
  sampleRate: 48_000,
  channelCount: 2,
};

interface FixtureSample {
  readonly data: Uint8Array;
  readonly duration: number;
  readonly sync: boolean;
  readonly compositionOffset?: number;
}

interface FixtureTrack {
  readonly id: number;
  readonly handler: string;
  readonly timescale: number;
  readonly samples: readonly FixtureSample[];
  readonly samplesPerChunk: number;
  /** A `TrackConfig` writes `stsd` through the muxer; a function writes it raw. */
  readonly stsd: TrackConfig | ((w: ByteWriter) => void);
  readonly cttsVersion?: 0 | 1;
  readonly wideOffsets?: boolean;
  readonly edits?: readonly { segmentDuration: number; mediaTime: number }[];
  readonly width?: number;
  readonly height?: number;
  /** What `stsc` claims every chunk's sample description is. 1-based. */
  readonly sampleDescriptionIndex?: number;
}

interface FixtureOptions {
  readonly tracks: readonly FixtureTrack[];
  /** `moov` before `mdat` (a "fast start" file) rather than after it. */
  readonly moovFirst?: boolean;
  readonly movieTimescale?: number;
  /** A `free` box between `ftyp` and whatever follows, which real files carry. */
  readonly withFree?: boolean;
  /** Write `mdat` with `size = 0`, the legal "to end of file" form. */
  readonly mdatSizeZero?: boolean;
  /** Write `mdat` with a 64-bit `largesize`, which is legal at any size. */
  readonly mdatLargeSize?: boolean;
}

function bytesOf(length: number, seed: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i++) data[i] = (seed * 37 + i * 91 + (i >> 3)) & 0xff;
  return data;
}

function videoSamples(count: number, seed = 1): FixtureSample[] {
  return Array.from({ length: count }, (_, i) => ({
    data: bytesOf(i % 10 === 0 ? 400 + i : 60 + i, seed + i),
    duration: 1001,
    sync: i % 10 === 0,
  }));
}

function chunksOf<T>(items: readonly T[], per: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += per) chunks.push(items.slice(i, i + per));
  return chunks;
}

function writeFullBox(
  w: ByteWriter,
  type: string,
  version: number,
  body: (w: ByteWriter) => void,
): void {
  const start = w.beginFullBox(type, version, 0);
  body(w);
  w.endBox(start);
}

/** The `hdlr` the muxer writes takes only vide/soun; a fixture needs any. */
function writeRawHdlr(w: ByteWriter, handlerType: string): void {
  writeFullBox(w, "hdlr", 0, () => {
    w.u32(0);
    w.fourcc(handlerType);
    w.zeros(12);
    w.u8(0);
  });
}

function writeSampleTable(
  w: ByteWriter,
  track: FixtureTrack,
  chunkOffsets: readonly number[],
): void {
  const stbl = w.beginBox("stbl");

  if (typeof track.stsd === "function") track.stsd(w);
  else writeStsd(w, track.stsd);

  // `stts`: one entry per sample, uncompressed. The run-length compression is
  // exercised in sample-table.test.ts; here the point is the file, not the box.
  writeFullBox(w, "stts", 0, () => {
    w.u32(track.samples.length);
    for (const sample of track.samples) {
      w.u32(1);
      w.u32(sample.duration);
    }
  });

  if (track.cttsVersion !== undefined) {
    const version = track.cttsVersion;
    writeFullBox(w, "ctts", version, () => {
      w.u32(track.samples.length);
      for (const sample of track.samples) {
        w.u32(1);
        const offset = sample.compositionOffset ?? 0;
        if (version === 1) w.i32(offset);
        else w.u32(offset);
      }
    });
  }

  writeFullBox(w, "stsc", 0, () => {
    w.u32(1);
    w.u32(1); // first_chunk
    w.u32(track.samplesPerChunk);
    w.u32(track.sampleDescriptionIndex ?? 1);
  });

  writeFullBox(w, "stsz", 0, () => {
    w.u32(0); // sample_size 0 → the table form
    w.u32(track.samples.length);
    for (const sample of track.samples) w.u32(sample.data.byteLength);
  });

  if (track.wideOffsets) {
    writeFullBox(w, "co64", 0, () => {
      w.u32(chunkOffsets.length);
      for (const offset of chunkOffsets) w.u64(offset);
    });
  } else {
    writeFullBox(w, "stco", 0, () => {
      w.u32(chunkOffsets.length);
      for (const offset of chunkOffsets) w.u32(offset);
    });
  }

  // `stss` is omitted entirely when every sample is a sync sample, which is
  // what the format means by its absence (research §1.10).
  if (!track.samples.every((sample) => sample.sync)) {
    writeFullBox(w, "stss", 0, () => {
      const numbers = track.samples
        .map((sample, index) => (sample.sync ? index + 1 : 0))
        .filter((number) => number > 0);
      w.u32(numbers.length);
      for (const number of numbers) w.u32(number);
    });
  }

  w.endBox(stbl);
}

function writeTrak(
  w: ByteWriter,
  track: FixtureTrack,
  chunkOffsets: readonly number[],
  movieTimescale: number,
): void {
  const isVideo = track.handler === "vide";
  const durationUnits = track.samples.reduce((sum, sample) => sum + sample.duration, 0);

  const trak = w.beginBox("trak");
  writeTkhd(w, {
    trackId: track.id,
    kind: isVideo ? "video" : "audio",
    durationInMovieTimescale: Math.round((durationUnits / track.timescale) * movieTimescale),
    width: track.width ?? (isVideo ? 1280 : 0),
    height: track.height ?? (isVideo ? 720 : 0),
  });

  if (track.edits !== undefined) {
    const edts = w.beginBox("edts");
    writeFullBox(w, "elst", 0, () => {
      w.u32(track.edits?.length ?? 0);
      for (const edit of track.edits ?? []) {
        w.u32(edit.segmentDuration);
        w.i32(edit.mediaTime);
        w.i16(1);
        w.i16(0);
      }
    });
    w.endBox(edts);
  }

  const mdia = w.beginBox("mdia");
  writeMdhd(w, { timescale: track.timescale, duration: durationUnits });
  writeRawHdlr(w, track.handler);

  const minf = w.beginBox("minf");
  if (isVideo) writeVmhd(w);
  else writeSmhd(w);
  writeDinf(w);
  writeSampleTable(w, track, chunkOffsets);
  w.endBox(minf);

  w.endBox(mdia);
  w.endBox(trak);
}

function writeMoov(
  options: FixtureOptions,
  chunkOffsetsPerTrack: readonly (readonly number[])[],
): Uint8Array {
  const movieTimescale = options.movieTimescale ?? 1000;
  // Integer arithmetic, deliberately: `units / timescale * movieTimescale` in
  // floats lands on 500.49999999999994 for this fixture's numbers and rounds
  // the wrong way, which would make the fixture's own duration unpredictable.
  const longestUnits = Math.max(
    ...options.tracks.map((track) =>
      Math.round(
        (track.samples.reduce((sum, sample) => sum + sample.duration, 0) * movieTimescale) /
          track.timescale,
      ),
    ),
  );

  const w = new ByteWriter(4096);
  const moov = w.beginBox("moov");
  writeMvhd(w, {
    timescale: movieTimescale,
    duration: longestUnits,
    nextTrackId: Math.max(...options.tracks.map((track) => track.id)) + 1,
  });
  for (const [index, track] of options.tracks.entries()) {
    writeTrak(w, track, chunkOffsetsPerTrack[index] ?? [], movieTimescale);
  }
  w.endBox(moov);
  return w.finish();
}

/**
 * A whole progressive MP4.
 *
 * Two passes over `moov`, because chunk offsets are **absolute file offsets**
 * and `moov`'s own size moves them whenever it precedes `mdat`. The first pass
 * writes zeroed offsets purely to measure; the second writes the real ones. The
 * sizes must agree — `stco` entries are fixed-width — and the assertion below
 * says so, because a fixture that silently mislaid a byte would produce
 * failures that looked like demuxer bugs.
 */
function buildProgressiveMp4(options: FixtureOptions): Uint8Array {
  const perTrackChunks = options.tracks.map((track) =>
    chunksOf(track.samples, track.samplesPerChunk),
  );

  // Round-robin interleave, which is what a real muxer does and what leaves a
  // track's chunks non-contiguous in the file.
  const emission: { track: number; chunk: number }[] = [];
  const deepest = Math.max(...perTrackChunks.map((chunks) => chunks.length));
  for (let chunk = 0; chunk < deepest; chunk++) {
    for (let track = 0; track < perTrackChunks.length; track++) {
      if (chunk < (perTrackChunks[track]?.length ?? 0)) emission.push({ track, chunk });
    }
  }

  const relativeOffsets = options.tracks.map(() => [] as number[]);
  let payloadBytes = 0;
  for (const { track, chunk } of emission) {
    relativeOffsets[track]?.push(payloadBytes);
    for (const sample of perTrackChunks[track]?.[chunk] ?? []) {
      payloadBytes += sample.data.byteLength;
    }
  }

  const ftypWriter = new ByteWriter(64);
  writeFtyp(ftypWriter);
  const ftyp = ftypWriter.finish();

  let free: Uint8Array = new Uint8Array(0);
  if (options.withFree) {
    const w = new ByteWriter(64);
    const start = w.beginBox("free");
    w.zeros(16);
    w.endBox(start);
    free = w.finish();
  }

  const probe = writeMoov(options, relativeOffsets);
  const mdatStart = ftyp.byteLength + free.byteLength + (options.moovFirst ? probe.byteLength : 0);
  const mdatHeaderBytes = options.mdatLargeSize ? 16 : mdatHeaderSize(payloadBytes);
  const payloadStart = mdatStart + mdatHeaderBytes;

  const absoluteOffsets = relativeOffsets.map((offsets) =>
    offsets.map((offset) => offset + payloadStart),
  );
  const moov = writeMoov(options, absoluteOffsets);
  if (moov.byteLength !== probe.byteLength) {
    throw new Error(`fixture moov moved between passes: ${probe.byteLength} → ${moov.byteLength}`);
  }

  const mdatWriter = new ByteWriter(payloadBytes + 32);
  if (options.mdatSizeZero) {
    mdatWriter.u32(0); // "to the end of the file"
    mdatWriter.fourcc("mdat");
  } else if (options.mdatLargeSize) {
    // `size = 1` then a 64-bit largesize. The muxer only writes this past
    // 4 GiB; the format allows it at any size, and a demuxer that only
    // recognised the 8-byte header would read the largesize as a box type.
    mdatWriter.u32(1);
    mdatWriter.fourcc("mdat");
    mdatWriter.u64(payloadBytes + 16);
  } else {
    writeMdatHeader(mdatWriter, payloadBytes);
  }
  for (const { track, chunk } of emission) {
    for (const sample of perTrackChunks[track]?.[chunk] ?? []) mdatWriter.bytes(sample.data);
  }
  const mdat = mdatWriter.finish();

  const parts = options.moovFirst
    ? [ftyp, free, moov, mdat]
    : [ftyp, free, mdat, moov];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const file = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.byteLength;
  }
  return file;
}

function videoTrack(overrides: Partial<FixtureTrack> = {}): FixtureTrack {
  return {
    id: 1,
    handler: "vide",
    timescale: 30_000,
    samples: videoSamples(25),
    samplesPerChunk: 5,
    stsd: VIDEO_CONFIG,
    ...overrides,
  };
}

function audioTrack(overrides: Partial<FixtureTrack> = {}): FixtureTrack {
  return {
    id: 2,
    handler: "soun",
    timescale: 48_000,
    samples: Array.from({ length: 40 }, (_, i) => ({
      data: bytesOf(384, 200 + i),
      duration: 1024,
      sync: true,
    })),
    samplesPerChunk: 8,
    stsd: AUDIO_CONFIG,
    ...overrides,
  };
}

function open(bytes: Uint8Array) {
  return openMp4(byteSourceFromBytes(bytes));
}

/* ------------------------------------------------------- finding the moov -- */

describe("locating moov", () => {
  it("finds a moov that sits after mdat, which is where most files put it", () => {
    // An encoder does not know moov's size until the last sample is written, so
    // unless something has run a "fast start" pass afterwards, moov is last. A
    // demuxer that assumed position two would work only on prepared files.
    const file = buildProgressiveMp4({ tracks: [videoTrack()] });
    expect(file.byteLength).toBeGreaterThan(1000);
    return expect(open(file)).resolves.toMatchObject({ byteLength: file.byteLength });
  });

  it("finds a moov that sits before mdat", async () => {
    const demuxed = await open(buildProgressiveMp4({ tracks: [videoTrack()], moovFirst: true }));
    expect(demuxed.tracks).toHaveLength(1);
    expect(demuxed.tracks[0]?.sampleCount).toBe(25);
  });

  it("walks past boxes it has no interest in", async () => {
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack()], withFree: true, moovFirst: true }),
    );
    expect(demuxed.tracks[0]?.sampleCount).toBe(25);
  });

  it("resolves an mdat that declares size 0, meaning to the end of the file", async () => {
    // Legal ISO BMFF §4.2 and what a streaming encoder that never seeked back
    // leaves behind. The muxer's parser refuses it, because the muxer never
    // writes one; the top-level walk has to accept it.
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack()], moovFirst: true, mdatSizeZero: true }),
    );
    expect(demuxed.tracks[0]?.sampleCount).toBe(25);
  });

  it("reads a box that carries a 64-bit largesize", async () => {
    // `size = 1` means the real size is the eight bytes after the type code
    // (BMFF §4.2). A walk that took the 8-byte header unconditionally would
    // read the top half of the largesize as the next box's size and land
    // nowhere. Only `mdat` plausibly needs this, and only past 4 GiB — which
    // is exactly why it is worth forcing at a size a test can build.
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack()], mdatLargeSize: true }),
    );
    const sizes: number[] = [];
    for await (const sample of demuxed.tracks[0]?.samples() ?? []) sizes.push(sample.data.byteLength);
    expect(sizes).toEqual(videoSamples(25).map((sample) => sample.data.byteLength));
  });

  it("reads the brands out of ftyp", async () => {
    const demuxed = await open(buildProgressiveMp4({ tracks: [videoTrack()] }));
    expect(demuxed.brands).toEqual(["iso5", "iso5", "iso6", "mp41"]);
  });

  it("reports the movie timescale and duration", async () => {
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack()], movieTimescale: 600 }),
    );
    expect(demuxed.movieTimescale).toBe(600);
    // 25 × 1001 ticks at 30000 is 0.8341̅6s, which the movie timescale of 600
    // can only express as 501 ticks — mvhd's duration is a coarse informational
    // field and this is what coarse costs (research §5.1). The track's own
    // duration, below, is exact.
    expect(demuxed.durationUs).toBe(835_000);
    expect(demuxed.tracks[0]?.durationUs).toBe(834_167);
  });
});

/* -------------------------------------------------------------- the Blob -- */

describe("reading from a Blob", () => {
  it("demuxes a File the same way it demuxes bytes, by range", async () => {
    // The path the app actually takes: a File from an <input>, never read whole.
    const bytes = buildProgressiveMp4({ tracks: [videoTrack({ samples: videoSamples(12) })] });
    const demuxed = await openMp4(new Blob([bytes as BlobPart]));
    const track = demuxed.tracks[0];
    expect(track).toBeDefined();

    const recovered: number[] = [];
    for await (const sample of track?.samples() ?? []) recovered.push(sample.data.byteLength);
    expect(recovered).toEqual(videoSamples(12).map((sample) => sample.data.byteLength));
  });
});

/* ------------------------------------------------------------ stsd → config -- */

describe("the track configuration", () => {
  it("recovers avc1's codec string and avcC verbatim", async () => {
    const demuxed = await open(buildProgressiveMp4({ tracks: [videoTrack()] }));
    const config = demuxed.tracks[0]?.config;
    // avcC bytes 1..3 are profile_idc 0x64, constraints 0x00, level 0x28
    // (research §7.1.1) — the same string the muxer was handed going in.
    expect(config?.codec).toBe("avc1.640028");
    expect(Array.from(config?.description ?? [])).toEqual(Array.from(AVCC));
    expect(config?.width).toBe(1280);
    expect(config?.height).toBe(720);
    expect(config?.timescale).toBe(30_000);
    expect(config?.kind).toBe("video");
  });

  it("recovers mp4a's AudioSpecificConfig out of the esds descriptor nest", async () => {
    const demuxed = await open(buildProgressiveMp4({ tracks: [audioTrack()] }));
    const config = demuxed.tracks[0]?.config;
    // 0x11 0x90 is AAC-LC (audioObjectType 2) at 48 kHz stereo, and the string
    // is built from the descriptor rather than from the sample entry.
    expect(config?.codec).toBe("mp4a.40.2");
    expect(Array.from(config?.description ?? [])).toEqual([0x11, 0x90]);
    expect(config?.sampleRate).toBe(48_000);
    expect(config?.channelCount).toBe(2);
  });

  it("recovers vp09's profile, level and bit depth from vpcC", async () => {
    const vp9: TrackConfig = {
      kind: "video",
      codec: "vp09.00.10.08",
      timescale: 30_000,
      width: 640,
      height: 360,
    };
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack({ stsd: vp9, width: 640, height: 360 })] }),
    );
    // The muxer synthesised vpcC from the codec string; reading it back must
    // produce the string it was synthesised from.
    expect(demuxed.tracks[0]?.config.codec).toBe("vp09.00.10.08");
  });

  it("recovers av01's profile, level, tier and bit depth from av1C", async () => {
    // av1C for profile 0, level 4 (0x04), Main tier, 8-bit: the marker/version
    // byte then the two packed bytes, then an empty configOBUs (research §2.3).
    const av1C = Uint8Array.from([0x81, 0x04, 0x00, 0x00]);
    const av1: TrackConfig = {
      kind: "video",
      codec: "av01.0.04M.08",
      description: av1C,
      timescale: 30_000,
      width: 640,
      height: 360,
    };
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack({ stsd: av1, width: 640, height: 360 })] }),
    );
    expect(demuxed.tracks[0]?.config.codec).toBe("av01.0.04M.08");
    expect(Array.from(demuxed.tracks[0]?.config.description ?? [])).toEqual(Array.from(av1C));
  });

  it("recovers hvc1's codec string from hvcC, which the muxer cannot write", async () => {
    /**
     * The one codec string with no corroborating source in this repository —
     * research §7.1.1 covers avc1/vp09/av01/mp4a and stops. It is here because
     * a phone's camera roll is HEVC. The record below is the 23-byte fixed
     * prefix of an HEVCDecoderConfigurationRecord for Main profile, level 3.1:
     *
     *   [0]  configurationVersion = 1
     *   [1]  profile_space 0, tier 0 (L), profile_idc 1
     *   [2…5] compatibility flags 0x60000000, which reverses to 0x6
     *   [6…11] constraint flags 0xB0 then five zero bytes, which are dropped
     *   [12] level_idc = 93 (level 3.1)
     */
    const hvcC = Uint8Array.from([
      0x01, 0x01, 0x60, 0x00, 0x00, 0x00, 0xb0, 0x00, 0x00, 0x00, 0x00, 0x00, 93, 0xf0, 0x00,
      0xfc, 0xfd, 0xf8, 0xf8, 0x00, 0x00, 0x0f, 0x00,
    ]);
    const demuxed = await open(
      buildProgressiveMp4({
        tracks: [
          videoTrack({
            stsd: (w) => writeRawStsd(w, "hvc1", "hvcC", hvcC, 1920, 1080),
            width: 1920,
            height: 1080,
          }),
        ],
      }),
    );
    expect(demuxed.tracks[0]?.config.codec).toBe("hvc1.1.6.L93.B0");
    expect(Array.from(demuxed.tracks[0]?.config.description ?? [])).toEqual(Array.from(hvcC));
  });

  it("takes the stsd entry stsc names, not the first one", async () => {
    // A track with two sample entries whose chunks all reference the second.
    // Rare, but the failure is total: the first entry's avcC is a different
    // profile and level, so a reader that always took entry 1 would configure
    // the decoder from parameter sets that do not describe these samples.
    const decoy = Uint8Array.from([0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x00, 0x01, 0x00]);
    const demuxed = await open(
      buildProgressiveMp4({
        tracks: [
          videoTrack({
            sampleDescriptionIndex: 2,
            stsd: (w) => {
              writeFullBox(w, "stsd", 0, () => {
                w.u32(2);
                writeVisualEntry(w, "avc1", "avcC", decoy, 640, 360);
                writeVisualEntry(w, "avc1", "avcC", AVCC, 1280, 720);
              });
            },
          }),
        ],
      }),
    );
    expect(demuxed.tracks[0]?.config.codec).toBe("avc1.640028");
    expect(Array.from(demuxed.tracks[0]?.config.description ?? [])).toEqual(Array.from(AVCC));
  });

  it("falls back to the media timescale for an audio rate the sample entry cannot hold", async () => {
    // `AudioSampleEntry.samplerate` is 16.16, so 96000 does not fit at all; a
    // real 96 kHz file writes 0 there and means "take mdhd's timescale".
    const demuxed = await open(
      buildProgressiveMp4({
        tracks: [
          audioTrack({
            timescale: 96_000,
            stsd: (w) => writeRawAudioStsd(w, 0, 2, AAC_LC_48K_STEREO),
          }),
        ],
      }),
    );
    expect(demuxed.tracks[0]?.config.sampleRate).toBe(96_000);
  });
});

/**
 * A `VisualSampleEntry` with an arbitrary fourcc and configuration box, for the
 * codecs the muxer's `writeStsd` cannot produce. Layout from research §2.1: the
 * 8-byte common prefix, then 70 fixed bytes, then the config box.
 */
function writeVisualEntry(
  w: ByteWriter,
  entryType: string,
  configType: string,
  record: Uint8Array,
  width: number,
  height: number,
): void {
  const entry = w.beginBox(entryType);
  w.zeros(6);
  w.u16(1); // data_reference_index
  w.u16(0);
  w.u16(0);
  w.zeros(12);
  w.u16(width);
  w.u16(height);
  w.fixed16_16(72);
  w.fixed16_16(72);
  w.u32(0);
  w.u16(1); // frame_count
  w.zeros(32); // compressorname
  w.u16(0x0018); // depth
  w.i16(-1);
  const config = w.beginBox(configType);
  w.bytes(record);
  w.endBox(config);
  w.endBox(entry);
}

/** A one-entry visual `stsd` around {@link writeVisualEntry}. */
function writeRawStsd(
  w: ByteWriter,
  entryType: string,
  configType: string,
  record: Uint8Array,
  width: number,
  height: number,
): void {
  writeFullBox(w, "stsd", 0, () => {
    w.u32(1);
    writeVisualEntry(w, entryType, configType, record, width, height);
  });
}

/** An `mp4a` entry whose declared sample rate the caller controls. */
function writeRawAudioStsd(
  w: ByteWriter,
  sampleRate: number,
  channelCount: number,
  audioSpecificConfig: Uint8Array,
): void {
  writeFullBox(w, "stsd", 0, () => {
    w.u32(1);
    const entry = w.beginBox("mp4a");
    w.zeros(6);
    w.u16(1);
    w.u16(0);
    w.u16(0);
    w.u32(0);
    w.u16(channelCount);
    w.u16(16);
    w.u16(0);
    w.u16(0);
    w.u32(sampleRate * 0x1_0000);
    // A minimal esds, with the *minimal* descriptor lengths rather than the
    // 4-byte padded form the muxer writes — real files use both.
    writeFullBox(w, "esds", 0, () => {
      const dsi = audioSpecificConfig.byteLength;
      w.u8(0x03);
      w.u8(3 + 2 + 13 + dsi + 2 + 1);
      w.u16(1);
      w.u8(0);
      w.u8(0x04);
      w.u8(13 + 2 + dsi);
      w.u8(0x40);
      w.u8(0x15);
      w.u24(0);
      w.u32(0);
      w.u32(0);
      w.u8(0x05);
      w.u8(dsi);
      w.bytes(audioSpecificConfig);
      w.u8(0x06);
      w.u8(1);
      w.u8(0x02);
    });
    w.endBox(entry);
  });
}

/* ----------------------------------------------------------- co64 and elst -- */

describe("chunk offsets and edit lists", () => {
  it("reads a file whose chunk offsets are 64-bit", async () => {
    const demuxed = await open(
      buildProgressiveMp4({ tracks: [videoTrack({ wideOffsets: true })] }),
    );
    const track = demuxed.tracks[0];
    const sizes: number[] = [];
    for await (const sample of track?.samples() ?? []) sizes.push(sample.data.byteLength);
    expect(sizes).toEqual(videoSamples(25).map((sample) => sample.data.byteLength));
  });

  it("detects an edit list, reports what it asks for, and states that it was not applied", async () => {
    // An empty edit (media_time -1) of 40ms in the movie timescale, then the
    // real one. This is the shape an encoder writes for priming delay, and the
    // one case where ignoring an edit list actually shifts a whole track.
    const demuxed = await open(
      buildProgressiveMp4({
        movieTimescale: 1000,
        tracks: [
          videoTrack({
            edits: [
              { segmentDuration: 40, mediaTime: -1 },
              { segmentDuration: 800, mediaTime: 3003 },
            ],
          }),
        ],
      }),
    );
    const edit = demuxed.tracks[0]?.editList;
    expect(edit?.applied).toBe(false);
    expect(edit?.entries).toHaveLength(2);
    expect(edit?.presentationOffsetUs).toBe(40_000); // 40 ticks at the MOVIE timescale
    expect(edit?.startTrimUs).toBe(100_100); // 3003 ticks at the TRACK's 30000
  });

  it("leaves editList undefined when the file has no edts", async () => {
    const demuxed = await open(buildProgressiveMp4({ tracks: [videoTrack()] }));
    expect(demuxed.tracks[0]?.editList).toBeUndefined();
  });
});

/* ----------------------------------------------------------- what it skips -- */

describe("tracks it will not read", () => {
  it("skips a subtitle track and says why, without failing the file", async () => {
    const demuxed = await open(
      buildProgressiveMp4({
        tracks: [
          videoTrack(),
          audioTrack({
            id: 3,
            handler: "sbtl",
            samples: [{ data: bytesOf(20, 5), duration: 1000, sync: true }],
            samplesPerChunk: 1,
          }),
        ],
      }),
    );
    expect(demuxed.tracks.map((track) => track.id)).toEqual([1]);
    expect(demuxed.skippedTracks).toEqual([
      { id: 3, handlerType: "sbtl", reason: 'handler "sbtl" is neither vide nor soun' },
    ]);
  });

  it("skips a track whose sample entry it cannot configure a decoder from", async () => {
    const demuxed = await open(
      buildProgressiveMp4({
        tracks: [
          videoTrack(),
          audioTrack({
            id: 4,
            stsd: (w) => writeRawStsd(w, "Opus", "dOps", Uint8Array.from([0, 1]), 0, 0),
          }),
        ],
      }),
    );
    expect(demuxed.tracks.map((track) => track.id)).toEqual([1]);
    expect(demuxed.skippedTracks[0]?.reason).toMatch(/Sample entry "Opus" is not one this demuxer reads/);
  });

  it("refuses the whole file when nothing in it is readable", async () => {
    await expect(
      open(
        buildProgressiveMp4({
          tracks: [
            videoTrack({
              stsd: (w) => writeRawStsd(w, "Opus", "dOps", Uint8Array.from([0, 1]), 0, 0),
            }),
          ],
        }),
      ),
    ).rejects.toThrow(/No track in this file can be demuxed.*Opus/s);
  });

  it("refuses a fragmented file by name rather than reading it as an empty one", async () => {
    // The muxer's own init segment: a moov with mvex and formally empty sample
    // tables (research §1.10). A demuxer that just read the tables would find
    // zero samples and report a valid, silent, blank video.
    const init = buildInitSegment({
      tracks: [{ id: 1, config: { ...VIDEO_CONFIG, timescale: 1_000_000 } }],
      durationUs: 6_000_000,
    });
    await expect(open(init)).rejects.toThrow(/fragmented file.*moof/s);
  });
});

/* ------------------------------------------------------- corrupt and short -- */

describe("files that are not what they claim", () => {
  it("refuses a file with no moov", async () => {
    const w = new ByteWriter(256);
    writeFtyp(w);
    writeMdatHeader(w, 16);
    w.zeros(16);
    await expect(open(w.finish())).rejects.toThrow(/no moov box/);
  });

  it("refuses a file too short to hold a box header", async () => {
    await expect(open(new Uint8Array(4))).rejects.toThrow(/cannot contain a single box header/);
  });

  it("refuses a box that declares more bytes than the file has", async () => {
    // The shape of a truncated download: every header is intact and the last
    // box runs off the end. Reading it as if it were whole is exactly the
    // out-of-bounds read this refuses to make.
    const file = buildProgressiveMp4({ tracks: [videoTrack()] });
    await expect(open(file.subarray(0, file.byteLength - 40))).rejects.toThrow(
      /runs \d+ bytes past the end of a \d+-byte file; it is truncated/,
    );
  });

  it("refuses a box whose declared size cannot hold its own header", async () => {
    const file = buildProgressiveMp4({ tracks: [videoTrack()], moovFirst: true });
    const broken = file.slice();
    new DataView(broken.buffer).setUint32(0, 3); // ftyp claims three bytes
    await expect(open(broken)).rejects.toThrow(/below its 8-byte header/);
  });

  it("terminates rather than looping when a box declares zero-length progress", async () => {
    // Two guards meet here: `size` below the header is refused outright, so
    // there is no path on which the walk advances by nothing. The test is that
    // it *returns* — a demuxer that hung would fail this by timeout, which is
    // the failure mode worth having a test for.
    const w = new ByteWriter(64);
    w.u32(4); // a size smaller than the 8-byte header it sits in
    w.fourcc("junk");
    w.zeros(16);
    await expect(open(w.finish())).rejects.toThrow(Mp4DemuxError);
  });

  it("skips a track whose sample table points outside the file", async () => {
    // Caught once at open rather than mid-transcode. The chunk offsets are
    // absolute file offsets, so a moov transplanted onto a shorter mdat — or a
    // fabricated one — addresses bytes that are not there.
    const file = buildProgressiveMp4({ tracks: [videoTrack()], moovFirst: true });
    const broken = file.slice();
    // Find the stco payload and push its first entry past the end of the file.
    const stco = indexOfFourcc(broken, "stco");
    new DataView(broken.buffer).setUint32(stco + 12, broken.byteLength + 1024);
    await expect(open(broken)).rejects.toThrow(/points outside the file/);
  });

  it("refuses a moov whose children do not tile it", async () => {
    const file = buildProgressiveMp4({ tracks: [videoTrack()], moovFirst: true });
    const broken = file.slice();
    const mvhd = indexOfFourcc(broken, "mvhd");
    new DataView(broken.buffer).setUint32(mvhd - 4, 4096); // mvhd overruns moov
    await expect(open(broken)).rejects.toThrow(/does not parse/);
  });
});

function indexOfFourcc(bytes: Uint8Array, fourcc: string): number {
  const codes = [...fourcc].map((char) => char.charCodeAt(0));
  for (let i = 0; i + 4 <= bytes.byteLength; i++) {
    if (codes.every((code, offset) => bytes[i + offset] === code)) return i;
  }
  throw new Error(`no "${fourcc}" in the fixture`);
}

/* ------------------------------------------------------------ conversion -- */

describe("timescale conversion", () => {
  it("is the identity at a 1e6 timescale, like the muxer's forward direction", () => {
    expect(unitsToMicroseconds(33_333, 1_000_000)).toBe(33_333);
  });

  it("stays exact past where units × 1e6 would leave the safe integer range", () => {
    // Three hours at a 1e6 timescale is 1.08e10 units; times 1e6 that is 1.08e16,
    // well past 2^53 ≈ 9.007e15. The split-seconds form has no such ceiling.
    const threeHours = 3 * 3600 * 90_000;
    expect(unitsToMicroseconds(threeHours, 90_000)).toBe(3 * 3600 * 1_000_000);
    expect(unitsToMicroseconds(90_000 * 12_345 + 45_000, 90_000)).toBe(12_345_500_000);
  });

  it("rounds a negative composition offset symmetrically about zero", () => {
    // Math.floor would push a negative down a tick and shift every B-frame in
    // the file by one, in the direction nothing else compensates for.
    expect(unitsToMicroseconds(-1, 3)).toBe(-333_333);
    expect(unitsToMicroseconds(1, 3)).toBe(333_333);
  });

  it("refuses a timescale that cannot be converted without losing precision", () => {
    expect(() => unitsToMicroseconds(1, 10_000_000_000)).toThrow(/losing precision/);
  });
});
