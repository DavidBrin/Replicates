// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { EncodedSample, TrackConfig } from "../../types";
import { ByteWriter } from "../../muxer/writer";
import { writeMdatHeader, writeStsd } from "../../muxer/boxes";
import { TrackMuxer } from "../../muxer";
import { parseBoxes, parseTfhd, parseTrun, requireBox } from "../../muxer/parser";
import { byteSourceFromBytes, openMp4 } from "../mp4";

/**
 * Known samples in, container out, samples back — every byte, timestamp,
 * duration and sync flag recovered exactly.
 *
 * This is the test the rest of the directory exists to make possible. The
 * individual box decoders can each be right about their own table and still
 * produce a wrong sample, because a sample is the *join* of six tables and the
 * join is where the arithmetic lives. Only an end-to-end recovery can catch a
 * chunk walk that is off by one chunk, or a decode clock that is right until
 * the second `stts` run.
 *
 * **The fixture writer below is deliberately not the one in `mp4.test.ts`.**
 * It is a second, independently written progressive-MP4 writer: chunk-plan
 * driven rather than uniform-chunk driven, single-pass with `moov` last rather
 * than two-pass, run-length `stsc` rather than one entry. A round-trip test
 * whose writer shares code with its reader passes on compensating bugs — the
 * two halves agree on a wrong convention and nothing notices. Two writers that
 * were built from the field tables separately do not have that failure mode,
 * and the cost is a hundred lines of test fixture, which is the right price.
 */

/* ---------------------------------------------------------- sample source -- */

/** Deterministic, so a failure is reproducible; `Math.random()` is not. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SourceSample {
  readonly data: Uint8Array;
  /** In the track's own timescale. */
  readonly duration: number;
  readonly sync: boolean;
  /** Signed, in the track's own timescale. */
  readonly compositionOffset: number;
}

/**
 * A GOP with realistic size variation — a large keyframe then much smaller
 * delta frames. Uniform sizes would let a transposition in the chunk walk pass
 * unnoticed, which is precisely the bug this file is for.
 */
function gop(options: {
  count: number;
  duration: number;
  seed: number;
  gopLength?: number;
}): SourceSample[] {
  const random = mulberry32(options.seed);
  const gopLength = options.gopLength ?? 10;
  return Array.from({ length: options.count }, (_, i) => {
    const size = i % gopLength === 0 ? 900 + Math.floor(random() * 300) : 40 + Math.floor(random() * 160);
    const data = new Uint8Array(size);
    for (let b = 0; b < size; b++) data[b] = Math.floor(random() * 256);
    return { data, duration: options.duration, sync: i % gopLength === 0, compositionOffset: 0 };
  });
}

/* -------------------------------------------------------- fixture writer -- */

interface PlannedTrack {
  readonly id: number;
  readonly config: TrackConfig;
  readonly samples: readonly SourceSample[];
  /**
   * Samples per chunk, chunk by chunk. Uneven on purpose: it produces a
   * multi-entry `stsc` whose runs are found by grouping, and whose last run has
   * no terminator.
   */
  readonly chunkPlan: readonly number[];
  readonly cttsVersion?: 0 | 1;
  readonly wideOffsets?: boolean;
  /** Write `stsz` in the uniform form. Only valid when every sample is one size. */
  readonly uniformSizes?: boolean;
  /** Filler bytes written after each of this track's chunks. */
  readonly gapBytes?: number;
}

function fullBox(w: ByteWriter, type: string, version: number, body: () => void): void {
  const start = w.beginFullBox(type, version, 0);
  body();
  w.endBox(start);
}

/** Groups a chunk plan into `stsc` runs: consecutive equal counts collapse. */
function stscRuns(chunkPlan: readonly number[]): { firstChunk: number; perChunk: number }[] {
  const runs: { firstChunk: number; perChunk: number }[] = [];
  for (const [index, perChunk] of chunkPlan.entries()) {
    if (runs.at(-1)?.perChunk !== perChunk) runs.push({ firstChunk: index + 1, perChunk });
  }
  return runs;
}

function writeTrackBoxes(
  w: ByteWriter,
  track: PlannedTrack,
  chunkOffsets: readonly number[],
  movieTimescale: number,
): void {
  const { samples } = track;
  const totalUnits = samples.reduce((sum, sample) => sum + sample.duration, 0);
  const isVideo = track.config.kind === "video";

  const trak = w.beginBox("trak");

  fullBox(w, "tkhd", 0, () => {
    w.u32(0);
    w.u32(0);
    w.u32(track.id);
    w.u32(0);
    w.u32(Math.round((totalUnits * movieTimescale) / track.config.timescale));
    w.zeros(8);
    w.i16(0); // layer
    w.i16(0); // alternate_group
    w.i16(isVideo ? 0 : 0x0100); // volume, 8.8
    w.u16(0);
    for (const cell of [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000]) w.u32(cell);
    w.fixed16_16(track.config.width ?? 0);
    w.fixed16_16(track.config.height ?? 0);
  });

  const mdia = w.beginBox("mdia");
  fullBox(w, "mdhd", 0, () => {
    w.u32(0);
    w.u32(0);
    w.u32(track.config.timescale);
    w.u32(totalUnits);
    w.u16(0x55c4); // "und"
    w.u16(0);
  });
  fullBox(w, "hdlr", 0, () => {
    w.u32(0);
    w.fourcc(isVideo ? "vide" : "soun");
    w.zeros(12);
    w.u8(0);
  });

  const minf = w.beginBox("minf");
  if (isVideo) {
    const vmhd = w.beginFullBox("vmhd", 0, 1);
    w.u16(0);
    w.zeros(6);
    w.endBox(vmhd);
  } else {
    fullBox(w, "smhd", 0, () => {
      w.i16(0);
      w.u16(0);
    });
  }
  const dinf = w.beginBox("dinf");
  fullBox(w, "dref", 0, () => {
    w.u32(1);
    const url = w.beginFullBox("url ", 0, 1);
    w.endBox(url);
  });
  w.endBox(dinf);

  const stbl = w.beginBox("stbl");
  writeStsd(w, track.config);

  // `stts`, run-length compressed for real: equal consecutive durations
  // collapse into one entry, which is what makes the expansion in the join
  // something worth testing rather than a copy.
  const sttsRuns: { count: number; delta: number }[] = [];
  for (const sample of samples) {
    const last = sttsRuns.at(-1);
    if (last?.delta === sample.duration) last.count++;
    else sttsRuns.push({ count: 1, delta: sample.duration });
  }
  fullBox(w, "stts", 0, () => {
    w.u32(sttsRuns.length);
    for (const run of sttsRuns) {
      w.u32(run.count);
      w.u32(run.delta);
    }
  });

  if (track.cttsVersion !== undefined) {
    const version = track.cttsVersion;
    const cttsRuns: { count: number; offset: number }[] = [];
    for (const sample of samples) {
      const last = cttsRuns.at(-1);
      if (last?.offset === sample.compositionOffset) last.count++;
      else cttsRuns.push({ count: 1, offset: sample.compositionOffset });
    }
    fullBox(w, "ctts", version, () => {
      w.u32(cttsRuns.length);
      for (const run of cttsRuns) {
        w.u32(run.count);
        if (version === 1) w.i32(run.offset);
        else w.u32(run.offset);
      }
    });
  }

  const runs = stscRuns(track.chunkPlan);
  fullBox(w, "stsc", 0, () => {
    w.u32(runs.length);
    for (const run of runs) {
      w.u32(run.firstChunk);
      w.u32(run.perChunk);
      w.u32(1);
    }
  });

  fullBox(w, "stsz", 0, () => {
    if (track.uniformSizes) {
      w.u32(samples[0]?.data.byteLength ?? 0);
      w.u32(samples.length);
      return;
    }
    w.u32(0);
    w.u32(samples.length);
    for (const sample of samples) w.u32(sample.data.byteLength);
  });

  if (track.wideOffsets) {
    fullBox(w, "co64", 0, () => {
      w.u32(chunkOffsets.length);
      for (const offset of chunkOffsets) w.u64(offset);
    });
  } else {
    fullBox(w, "stco", 0, () => {
      w.u32(chunkOffsets.length);
      for (const offset of chunkOffsets) w.u32(offset);
    });
  }

  if (!samples.every((sample) => sample.sync)) {
    const numbers = samples
      .map((sample, index) => (sample.sync ? index + 1 : 0))
      .filter((number) => number > 0);
    fullBox(w, "stss", 0, () => {
      w.u32(numbers.length);
      for (const number of numbers) w.u32(number);
    });
  }

  w.endBox(stbl);
  w.endBox(minf);
  w.endBox(mdia);
  w.endBox(trak);
}

/**
 * `ftyp`, then `mdat`, then `moov` — the ordinary layout, and the one that
 * needs no second pass: every chunk offset is already known by the time `moov`
 * is written.
 */
function buildFile(tracks: readonly PlannedTrack[], movieTimescale = 1000): Uint8Array {
  const perTrackChunks = tracks.map((track) => {
    const chunks: SourceSample[][] = [];
    let at = 0;
    for (const count of track.chunkPlan) {
      chunks.push(track.samples.slice(at, at + count));
      at += count;
    }
    if (at !== track.samples.length) {
      throw new Error(`chunk plan covers ${at} of track ${track.id}'s ${track.samples.length} samples`);
    }
    return chunks;
  });

  const ftyp = new ByteWriter(64);
  const ftypStart = ftyp.beginBox("ftyp");
  ftyp.fourcc("isom");
  ftyp.u32(0x200);
  ftyp.fourcc("isom");
  ftyp.fourcc("mp41");
  ftyp.endBox(ftypStart);
  const ftypBytes = ftyp.finish();

  // Interleave chunk by chunk across tracks, the way a real muxer does, so no
  // track's chunks are contiguous in the file.
  const emission: { track: number; chunk: number }[] = [];
  const deepest = Math.max(...perTrackChunks.map((chunks) => chunks.length));
  for (let chunk = 0; chunk < deepest; chunk++) {
    for (let track = 0; track < perTrackChunks.length; track++) {
      if (chunk < (perTrackChunks[track]?.length ?? 0)) emission.push({ track, chunk });
    }
  }

  let payloadBytes = 0;
  for (const { track, chunk } of emission) {
    for (const sample of perTrackChunks[track]?.[chunk] ?? []) payloadBytes += sample.data.byteLength;
    payloadBytes += tracks[track]?.gapBytes ?? 0;
  }

  const mdatHeader = new ByteWriter(16);
  writeMdatHeader(mdatHeader, payloadBytes);
  const mdatHeaderBytes = mdatHeader.finish();
  const payloadStart = ftypBytes.byteLength + mdatHeaderBytes.byteLength;

  const payload = new Uint8Array(payloadBytes);
  const chunkOffsets = tracks.map(() => [] as number[]);
  let at = 0;
  for (const { track, chunk } of emission) {
    chunkOffsets[track]?.push(payloadStart + at);
    for (const sample of perTrackChunks[track]?.[chunk] ?? []) {
      payload.set(sample.data, at);
      at += sample.data.byteLength;
    }
    // Filler between chunks, so the reader has to honour the offsets rather
    // than assume the samples are back to back.
    const gap = tracks[track]?.gapBytes ?? 0;
    for (let i = 0; i < gap; i++) payload[at + i] = 0xcd;
    at += gap;
  }

  const moov = new ByteWriter(4096);
  const moovStart = moov.beginBox("moov");
  fullBox(moov, "mvhd", 0, () => {
    moov.u32(0);
    moov.u32(0);
    moov.u32(movieTimescale);
    moov.u32(
      Math.max(
        ...tracks.map((track) =>
          Math.round(
            (track.samples.reduce((sum, sample) => sum + sample.duration, 0) * movieTimescale) /
              track.config.timescale,
          ),
        ),
      ),
    );
    moov.fixed16_16(1);
    moov.fixed8_8(1);
    moov.zeros(2);
    moov.zeros(8);
    for (const cell of [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000]) moov.u32(cell);
    moov.zeros(24);
    moov.u32(Math.max(...tracks.map((track) => track.id)) + 1);
  });
  for (const [index, track] of tracks.entries()) {
    writeTrackBoxes(moov, track, chunkOffsets[index] ?? [], movieTimescale);
  }
  moov.endBox(moovStart);
  const moovBytes = moov.finish();

  const file = new Uint8Array(payloadStart + payloadBytes + moovBytes.byteLength);
  file.set(ftypBytes, 0);
  file.set(mdatHeaderBytes, ftypBytes.byteLength);
  file.set(payload, payloadStart);
  file.set(moovBytes, payloadStart + payloadBytes);
  return file;
}

/* ------------------------------------------------------------- shorthands -- */

const AVCC = Uint8Array.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x64, 0x01, 0x00, 0x02, 0x68, 0xee,
]);
const AAC_LC_48K_STEREO = Uint8Array.from([0x11, 0x90]);

/** A 1e6 timescale makes ticks and microseconds the same number, so the
 * expected timestamps below can be read off the durations by hand. */
const VIDEO: TrackConfig = {
  kind: "video",
  codec: "avc1.640028",
  description: AVCC,
  timescale: 1_000_000,
  width: 1280,
  height: 720,
};

const AUDIO: TrackConfig = {
  kind: "audio",
  codec: "mp4a.40.2",
  description: AAC_LC_48K_STEREO,
  timescale: 48_000,
  sampleRate: 48_000,
  channelCount: 2,
};

async function collect(file: Uint8Array, trackIndex = 0): Promise<EncodedSample[]> {
  const demuxed = await openMp4(byteSourceFromBytes(file));
  const track = demuxed.tracks[trackIndex];
  if (track === undefined) throw new Error(`no track ${trackIndex}`);
  const samples: EncodedSample[] = [];
  for await (const sample of track.samples()) samples.push(sample);
  return samples;
}

function bytesOf(samples: readonly { data: Uint8Array }[]): number[][] {
  return samples.map((sample) => [...sample.data]);
}

/* ------------------------------------------------------------------ tests -- */

describe("bytes", () => {
  it("recovers every sample's bytes exactly, across an uneven chunk plan", async () => {
    // 60 samples in chunks of 7, 7, 7, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3 —
    // three `stsc` runs, the last of which has no terminator and covers the
    // majority of the file.
    const samples = gop({ count: 60, duration: 33_333, seed: 7 });
    const chunkPlan = [7, 7, 7, ...Array.from({ length: 13 }, () => 3)];
    const file = buildFile([{ id: 1, config: VIDEO, samples, chunkPlan }]);

    const recovered = await collect(file);
    expect(recovered).toHaveLength(60);
    expect(bytesOf(recovered)).toEqual(bytesOf(samples));
  });

  it("recovers bytes when the chunks are not adjacent in the file", async () => {
    // Padding between chunks: a reader that walked forward from the first
    // offset instead of consulting `stco` per chunk would return filler.
    const samples = gop({ count: 24, duration: 33_333, seed: 11 });
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: Array.from({ length: 12 }, () => 2), gapBytes: 97 },
    ]);
    expect(bytesOf(await collect(file))).toEqual(bytesOf(samples));
  });

  it("recovers bytes with one sample per chunk, which is the many-reads case", async () => {
    const samples = gop({ count: 40, duration: 33_333, seed: 13 });
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: Array.from({ length: 40 }, () => 1) },
    ]);
    expect(bytesOf(await collect(file))).toEqual(bytesOf(samples));
  });

  it("recovers both tracks' bytes from an interleaved file", async () => {
    // Two tracks whose chunks alternate. Every one of track 2's offsets sits
    // after some of track 1's bytes, which is where a reader that treated a
    // chunk offset as relative to anything would go wrong for exactly one track.
    const video = gop({ count: 30, duration: 33_333, seed: 17 });
    const audio: SourceSample[] = Array.from({ length: 48 }, (_, i) => ({
      data: new Uint8Array(300 + (i % 7)).fill((i * 13) & 0xff),
      duration: 1024,
      sync: true,
      compositionOffset: 0,
    }));
    const file = buildFile([
      { id: 1, config: VIDEO, samples: video, chunkPlan: Array.from({ length: 6 }, () => 5) },
      { id: 2, config: AUDIO, samples: audio, chunkPlan: Array.from({ length: 6 }, () => 8) },
    ]);

    expect(bytesOf(await collect(file, 0))).toEqual(bytesOf(video));
    expect(bytesOf(await collect(file, 1))).toEqual(bytesOf(audio));
  });

  it("recovers bytes when the chunk offsets are 64-bit", async () => {
    const samples = gop({ count: 20, duration: 33_333, seed: 19 });
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: [6, 6, 8], wideOffsets: true },
    ]);
    expect(bytesOf(await collect(file))).toEqual(bytesOf(samples));
  });

  it("recovers bytes from an stsz in its uniform form", async () => {
    const samples: SourceSample[] = Array.from({ length: 20 }, (_, i) => ({
      data: new Uint8Array(512).fill((i * 31) & 0xff),
      duration: 1024,
      sync: true,
      compositionOffset: 0,
    }));
    const file = buildFile([
      { id: 1, config: AUDIO, samples, chunkPlan: [5, 5, 5, 5], uniformSizes: true },
    ]);
    expect(bytesOf(await collect(file))).toEqual(bytesOf(samples));
  });
});

describe("time", () => {
  it("recovers durations and timestamps exactly at a 1e6 timescale", async () => {
    const samples = gop({ count: 30, duration: 33_333, seed: 23 });
    const file = buildFile([{ id: 1, config: VIDEO, samples, chunkPlan: [10, 10, 10] }]);
    const recovered = await collect(file);

    expect(recovered.map((sample) => sample.durationUs)).toEqual(
      Array.from({ length: 30 }, () => 33_333),
    );
    // No `ctts`, so presentation time is the running sum of the durations.
    expect(recovered.map((sample) => sample.timestampUs)).toEqual(
      Array.from({ length: 30 }, (_, i) => i * 33_333),
    );
    expect(recovered.every((sample) => sample.compositionOffsetUs === undefined)).toBe(true);
  });

  it("converts a non-microsecond timescale without accumulating error", async () => {
    // 90 kHz, the classic transport timescale, where 1 tick is 11.1̅µs and no
    // sample duration lands on a whole microsecond. The expected values below
    // are computed here, from the tick counts, rather than by the demuxer.
    const timescale = 90_000;
    const samples: SourceSample[] = Array.from({ length: 50 }, (_, i) => ({
      data: new Uint8Array(64).fill(i),
      duration: 3003, // 29.97fps at 90kHz
      sync: i === 0,
      compositionOffset: 0,
    }));
    const file = buildFile([
      { id: 1, config: { ...VIDEO, timescale }, samples, chunkPlan: [25, 25] },
    ]);
    const recovered = await collect(file);

    for (const [i, sample] of recovered.entries()) {
      expect(sample.timestampUs, `sample ${i}`).toBe(Math.round((i * 3003 * 1_000_000) / timescale));
      expect(sample.durationUs, `sample ${i}`).toBe(Math.round((3003 * 1_000_000) / timescale));
    }
    // 50 frames of 3003 ticks is 150150 ticks, which is 1.668̅ seconds — and
    // the last timestamp is that minus one frame, exactly, not one microsecond
    // less after fifty roundings.
    expect(recovered.at(-1)?.timestampUs).toBe(Math.round((49 * 3003 * 1_000_000) / timescale));
  });

  it("recovers a variable frame rate, where stts has several runs", async () => {
    const durations = [33_333, 33_333, 33_333, 50_000, 50_000, 16_667, 33_333, 33_333];
    const samples: SourceSample[] = durations.map((duration, i) => ({
      data: new Uint8Array(32).fill(i),
      duration,
      sync: i === 0,
      compositionOffset: 0,
    }));
    const file = buildFile([{ id: 1, config: VIDEO, samples, chunkPlan: [4, 4] }]);
    const recovered = await collect(file);

    expect(recovered.map((sample) => sample.durationUs)).toEqual(durations);
    let expected = 0;
    for (const [i, sample] of recovered.entries()) {
      expect(sample.timestampUs, `sample ${i}`).toBe(expected);
      expected += durations[i] ?? 0;
    }
  });
});

describe("composition offsets", () => {
  it("recovers genuinely negative offsets from a version 1 ctts", async () => {
    /**
     * An open GOP: sample 2's composition time precedes its decode time. The
     * whole reason `ctts` has two versions (research §5.4). Read as unsigned,
     * −20000 becomes 4,294,947,296 ticks — at this timescale, 71 minutes into
     * the future for one frame of a one-second clip.
     */
    const offsets = [0, 60_000, -20_000, -20_000, 0, 30_000];
    const samples: SourceSample[] = offsets.map((compositionOffset, i) => ({
      data: new Uint8Array(48).fill(i + 1),
      duration: 33_333,
      sync: i === 0,
      compositionOffset,
    }));
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: [3, 3], cttsVersion: 1 },
    ]);
    const recovered = await collect(file);

    expect(recovered.map((sample) => sample.compositionOffsetUs)).toEqual([
      undefined, 60_000, -20_000, -20_000, undefined, 30_000,
    ]);
    // `timestampUs` is the PRESENTATION time — decode time plus the offset —
    // and the decode time is recoverable as the difference. Both facts survive.
    expect(recovered.map((sample) => sample.timestampUs)).toEqual([
      0, 33_333 + 60_000, 66_666 - 20_000, 99_999 - 20_000, 133_332, 166_665 + 30_000,
    ]);
  });

  it("reads a version 0 ctts as unsigned, which is what it is", async () => {
    const samples: SourceSample[] = [0, 3000, 0, 3000].map((compositionOffset, i) => ({
      data: new Uint8Array(16).fill(i),
      duration: 1000,
      sync: true,
      compositionOffset,
    }));
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: [4], cttsVersion: 0 },
    ]);
    expect((await collect(file)).map((sample) => sample.compositionOffsetUs)).toEqual([
      undefined, 3000, undefined, 3000,
    ]);
  });
});

describe("sync samples", () => {
  it("recovers the keyframe flag from stss", async () => {
    const samples = gop({ count: 30, duration: 33_333, seed: 29, gopLength: 10 });
    const file = buildFile([{ id: 1, config: VIDEO, samples, chunkPlan: [10, 10, 10] }]);
    expect((await collect(file)).map((sample) => sample.isKeyFrame)).toEqual(
      samples.map((sample) => sample.sync),
    );
  });

  it("reports every sample as a keyframe when there is no stss at all", async () => {
    // All-intra footage — a screen recording, a capture card, ProRes. The box
    // is absent because there is nothing to distinguish, and absence means
    // "all", not "none" (research §1.10). A reader that got this backwards
    // would decide the file had no seek point and refuse to start it.
    const samples: SourceSample[] = Array.from({ length: 12 }, (_, i) => ({
      data: new Uint8Array(200).fill(i),
      duration: 40_000,
      sync: true,
      compositionOffset: 0,
    }));
    const file = buildFile([{ id: 1, config: VIDEO, samples, chunkPlan: [4, 4, 4] }]);

    const demuxed = await openMp4(byteSourceFromBytes(file));
    expect(demuxed.tracks[0]?.sampleTable.syncFlags).toBeUndefined();
    expect((await collect(file)).every((sample) => sample.isKeyFrame)).toBe(true);
  });
});

describe("the configuration survives the round trip", () => {
  it("returns the avcC that went into stsd, byte for byte", async () => {
    const samples = gop({ count: 8, duration: 33_333, seed: 31 });
    const file = buildFile([{ id: 1, config: VIDEO, samples, chunkPlan: [4, 4] }]);
    const demuxed = await openMp4(byteSourceFromBytes(file));

    expect(Array.from(demuxed.tracks[0]?.config.description ?? [])).toEqual(Array.from(AVCC));
    expect(demuxed.tracks[0]?.config.codec).toBe(VIDEO.codec);
    expect(demuxed.tracks[0]?.config.timescale).toBe(VIDEO.timescale);
    expect(demuxed.tracks[0]?.config.width).toBe(1280);
    expect(demuxed.tracks[0]?.config.height).toBe(720);
  });

  it("returns the AudioSpecificConfig the muxer nested inside esds", async () => {
    // The muxer writes the four-descriptor nest of research §2.4; this digs the
    // same two bytes back out of it. The two functions are inverses and this is
    // the assertion that says so.
    const samples: SourceSample[] = Array.from({ length: 6 }, (_, i) => ({
      data: new Uint8Array(256).fill(i),
      duration: 1024,
      sync: true,
      compositionOffset: 0,
    }));
    const file = buildFile([{ id: 1, config: AUDIO, samples, chunkPlan: [3, 3] }]);
    const demuxed = await openMp4(byteSourceFromBytes(file));

    expect(Array.from(demuxed.tracks[0]?.config.description ?? [])).toEqual([0x11, 0x90]);
    expect(demuxed.tracks[0]?.config.codec).toBe("mp4a.40.2");
    expect(demuxed.tracks[0]?.config.sampleRate).toBe(48_000);
    expect(demuxed.tracks[0]?.config.channelCount).toBe(2);
  });
});

describe("streaming, not slurping", () => {
  /** A `ByteSource` that records what was asked of it. */
  function countingSource(bytes: Uint8Array) {
    const ranges: [number, number][] = [];
    return {
      ranges,
      get bytesRead(): number {
        return ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
      },
      source: {
        byteLength: bytes.byteLength,
        read(start: number, end: number) {
          ranges.push([start, end]);
          return Promise.resolve(bytes.subarray(start, end));
        },
      },
    };
  }

  /** 20 single-sample chunks, half a megabyte of filler between each. */
  function scatteredFile(): Uint8Array {
    const samples: SourceSample[] = Array.from({ length: 20 }, (_, i) => ({
      data: new Uint8Array(1000).fill(i),
      duration: 33_333,
      sync: i === 0,
      compositionOffset: 0,
    }));
    return buildFile([
      {
        id: 1,
        config: VIDEO,
        samples,
        chunkPlan: Array.from({ length: 20 }, () => 1),
        gapBytes: 512 * 1024,
      },
    ]);
  }

  it("opens a file without reading its mdat", async () => {
    // The claim the whole ByteSource design rests on: a gigabyte upload is
    // opened by reading a few box headers and `moov`, not by materialising it.
    // Here `moov` is about two kilobytes against a ten-megabyte file.
    const file = scatteredFile();
    const counted = countingSource(file);
    await openMp4(counted.source);

    expect(file.byteLength).toBeGreaterThan(10_000_000);
    expect(counted.bytesRead).toBeLessThan(file.byteLength / 100);
  });

  it("reads sample bytes and not the space between them", async () => {
    // Twenty samples of a thousand bytes each, separated by half a megabyte.
    // A reader that coalesced across those gaps would pull ten megabytes to
    // deliver twenty kilobytes — correct output, ruinous throughput, and
    // invisible to every other test in this file.
    const file = scatteredFile();
    const counted = countingSource(file);
    const demuxed = await openMp4(counted.source);
    const before = counted.bytesRead;

    const track = demuxed.tracks[0];
    const collected: EncodedSample[] = [];
    for await (const sample of track?.samples() ?? []) collected.push(sample);

    expect(collected).toHaveLength(20);
    const sampleBytes = collected.reduce((sum, sample) => sum + sample.data.byteLength, 0);
    expect(counted.bytesRead - before).toBeLessThan(sampleBytes * 2);
  });

  it("batches contiguous samples into far fewer reads than there are samples", async () => {
    const samples = gop({ count: 120, duration: 33_333, seed: 41 });
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: Array.from({ length: 24 }, () => 5) },
    ]);
    const counted = countingSource(file);
    const demuxed = await openMp4(counted.source);
    const before = counted.ranges.length;

    for await (const _ of demuxed.tracks[0]?.samples() ?? []) void _;

    // Every sample is contiguous with the next, so the whole track is one read.
    expect(counted.ranges.length - before).toBe(1);
  });

  it("stops early when the caller aborts", async () => {
    const samples = gop({ count: 60, duration: 33_333, seed: 43 });
    const file = buildFile([
      { id: 1, config: VIDEO, samples, chunkPlan: Array.from({ length: 30 }, () => 2) },
    ]);
    const demuxed = await openMp4(byteSourceFromBytes(file));
    const controller = new AbortController();

    let seen = 0;
    await expect(
      (async () => {
        for await (const _ of demuxed.tracks[0]?.samples({ signal: controller.signal }) ?? []) {
          void _;
          if (++seen === 5) controller.abort();
        }
      })(),
    ).rejects.toThrow(/aborted after \d+ samples/);
    expect(seen).toBe(5);
  });
});

describe("demuxer to muxer", () => {
  it("hands the muxer samples it packages without translation", async () => {
    /**
     * The seam the whole slice exists for: `EncodedSample` out of the demuxer
     * is `EncodedSample` into the muxer, with no adapter between them. In the
     * real pipeline a decoder and an encoder sit in the middle; here they are
     * skipped so that what is being tested is the *types* fitting, not a codec.
     *
     * The recovery walk below is the muxer's fragmented one — `moof` offset
     * plus `trun.data_offset`, forward by each sample's size — so a byte that
     * survives this has been through a progressive sample table and a
     * fragmented track run and come out the same.
     */
    const original = gop({ count: 24, duration: 33_333, seed: 37, gopLength: 24 });
    const file = buildFile([{ id: 1, config: VIDEO, samples: original, chunkPlan: [8, 8, 8] }]);

    const demuxed = await openMp4(byteSourceFromBytes(file));
    const track = demuxed.tracks[0];
    if (track === undefined) throw new Error("no video track");

    const samples: EncodedSample[] = [];
    for await (const sample of track.samples()) samples.push(sample);

    const muxer = new TrackMuxer({ config: track.config });
    const segment = muxer.packageSegment(samples);

    const boxes = parseBoxes(segment.data);
    const moof = requireBox(boxes, "moof");
    const tfhd = parseTfhd(requireBox(boxes, "moof.traf.tfhd"));
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));

    let at = moof.offset + (trun.dataOffset ?? 0);
    const remuxed = trun.samples.map((sample) => {
      const size = sample.size ?? tfhd.defaultSampleSize ?? 0;
      const bytes = segment.data.subarray(at, at + size);
      at += size;
      return [...bytes];
    });

    expect(remuxed).toEqual(bytesOf(original));
    expect(segment.durationSeconds).toBeCloseTo((24 * 33_333) / 1_000_000, 9);
  });
});
