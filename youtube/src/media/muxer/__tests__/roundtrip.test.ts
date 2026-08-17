// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { EncodedSample, TrackConfig } from "../../types";
import { MEDIA_CLOCK_START, buildMediaSegment, planFragment } from "../media-segment";
import { TrackMuxer } from "../index";
import { microsecondsToTimescale } from "../boxes";
import { parseBoxes, parseTfdt, parseTfhd, parseTrun, requireBox } from "../parser";

/**
 * The end-to-end check: synthetic samples in, bytes out, samples back.
 *
 * Recovery here deliberately mimics a demuxer rather than the muxer. It starts
 * at `moof`'s offset, adds `trun.data_offset`, and walks forward by the sizes
 * in `trun` — it never looks at where `mdat` actually is. So if `data_offset`
 * were wrong by even one byte, or a sample size were transposed, the recovered
 * bytes would not equal the bytes that went in, and the box tree would still be
 * flawless. That is the property being tested: not that the file parses, but
 * that a reader following the file's own pointers finds the right bytes.
 */

/* -------------------------------------------------------------- fixtures -- */

const AVCC = Uint8Array.from([0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x64, 0x01, 0x00, 0x02, 0x68, 0xee]);
const AAC_LC_48K_STEREO = Uint8Array.from([0x11, 0x90]);

const VIDEO_CONFIG: TrackConfig = {
  kind: "video",
  codec: "avc1.640028",
  description: AVCC,
  timescale: 1_000_000,
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

/** A deterministic PRNG: `Math.random()` would make a failure unreproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A GOP of encoded samples with realistic size variation — a large keyframe
 * followed by delta frames an order of magnitude smaller. Uniform-size samples
 * would let a size transposition pass unnoticed.
 */
function encodeGop(options: {
  count: number;
  startUs: number;
  frameDurationUs: number;
  seed: number;
}): EncodedSample[] {
  const random = mulberry32(options.seed);
  const samples: EncodedSample[] = [];
  for (let i = 0; i < options.count; i++) {
    const size = i === 0 ? 3000 + Math.floor(random() * 500) : 200 + Math.floor(random() * 400);
    const data = new Uint8Array(size);
    for (let b = 0; b < size; b++) data[b] = Math.floor(random() * 256);
    samples.push({
      data,
      timestampUs: options.startUs + i * options.frameDurationUs,
      durationUs: options.frameDurationUs,
      isKeyFrame: i === 0,
    });
  }
  return samples;
}

/**
 * Walks a media segment the way a player's demuxer would: `moof` position plus
 * `trun.data_offset`, then forward by each sample's effective size. Falls back
 * to `tfhd`'s defaults exactly where the format says to.
 */
function recoverSamples(segment: Uint8Array): Uint8Array[][] {
  const boxes = parseBoxes(segment);
  const moof = requireBox(boxes, "moof");

  return moof.children
    .filter((box) => box.type === "traf")
    .map((traf) => {
      const tfhd = parseTfhd(requireBox([traf], "traf.tfhd"));
      const trun = parseTrun(requireBox([traf], "traf.trun"));
      let at = moof.offset + (trun.dataOffset ?? 0);

      return trun.samples.map((sample) => {
        const size = sample.size ?? tfhd.defaultSampleSize;
        if (size === undefined) throw new Error("Neither trun nor tfhd gives this sample a size");
        const bytes = segment.subarray(at, at + size);
        at += size;
        return bytes;
      });
    });
}

/** The same walk, for durations, which is how `tfdt` continuity is checked. */
function recoverDurations(segment: Uint8Array): number[][] {
  const boxes = parseBoxes(segment);
  return requireBox(boxes, "moof")
    .children.filter((box) => box.type === "traf")
    .map((traf) => {
      const tfhd = parseTfhd(requireBox([traf], "traf.tfhd"));
      const trun = parseTrun(requireBox([traf], "traf.trun"));
      return trun.samples.map((sample) => {
        const duration = sample.duration ?? tfhd.defaultSampleDuration;
        if (duration === undefined) throw new Error("No duration for this sample");
        return duration;
      });
    });
}

/* ------------------------------------------------------------------ tests -- */

describe("byte recovery", () => {
  it("recovers every sample's bytes exactly, following the file's own pointers", () => {
    const samples = encodeGop({ count: 60, startUs: 0, frameDurationUs: 33_333, seed: 7 });
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    const segment = muxer.packageSegment(samples);

    const recovered = recoverSamples(segment.data);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toHaveLength(60);
    for (let i = 0; i < samples.length; i++) {
      expect([...(recovered[0]?.[i] ?? [])], `sample ${i}`).toEqual([...(samples[i]?.data ?? [])]);
    }
  });

  it("recovers both tracks' bytes when they share one mdat", () => {
    // The second track's `data_offset` has to skip the first track's bytes as
    // well as `moof` and `mdat`'s header — the case where offset arithmetic
    // goes wrong for exactly one of the two tracks (research §3.6).
    const video = encodeGop({ count: 12, startUs: 0, frameDurationUs: 33_333, seed: 11 });
    const audio = encodeGop({ count: 20, startUs: 0, frameDurationUs: 21_333, seed: 12 });

    const videoPlan = planFragment(video, VIDEO_CONFIG.timescale, MEDIA_CLOCK_START);
    const audioPlan = planFragment(audio, AUDIO_CONFIG.timescale, MEDIA_CLOCK_START);
    const bytes = buildMediaSegment({
      sequenceNumber: 1,
      tracks: [
        { id: 1, baseMediaDecodeTime: videoPlan.baseMediaDecodeTime, samples: videoPlan.samples },
        { id: 2, baseMediaDecodeTime: audioPlan.baseMediaDecodeTime, samples: audioPlan.samples },
      ],
    });

    const recovered = recoverSamples(bytes);
    expect(recovered.map((track) => track.length)).toEqual([12, 20]);
    expect([...(recovered[0]?.[0] ?? [])]).toEqual([...(video[0]?.data ?? [])]);
    expect([...(recovered[0]?.[11] ?? [])]).toEqual([...(video[11]?.data ?? [])]);
    expect([...(recovered[1]?.[0] ?? [])]).toEqual([...(audio[0]?.data ?? [])]);
    expect([...(recovered[1]?.[19] ?? [])]).toEqual([...(audio[19]?.data ?? [])]);
  });

  it("recovers sizes from the tfhd default when trun omits the size table", () => {
    // Constant-size samples put the size in `tfhd` and nowhere else; a reader
    // that only looked at `trun` would read zero-length samples.
    const samples: EncodedSample[] = [0, 1, 2, 3, 4].map((i) => ({
      data: Uint8Array.from(Array.from({ length: 384 }, (_, b) => (i * 31 + b) & 0xff)),
      timestampUs: i * 21_333,
      durationUs: 21_333,
      isKeyFrame: true,
    }));

    const muxer = new TrackMuxer({ config: AUDIO_CONFIG });
    const segment = muxer.packageSegment(samples);
    const trun = parseTrun(requireBox(parseBoxes(segment.data), "moof.traf.trun"));
    expect(trun.samples.every((s) => s.size === undefined)).toBe(true);

    const recovered = recoverSamples(segment.data);
    for (let i = 0; i < samples.length; i++) {
      expect([...(recovered[0]?.[i] ?? [])], `sample ${i}`).toEqual([...(samples[i]?.data ?? [])]);
    }
  });

  it("recovers bytes from the last segment of a long sequence, not just the first", () => {
    // Every offset in a later fragment is identical arithmetic on a different
    // `moof` size, and a sequence-dependent bug would only show up here.
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    const packaged: { input: EncodedSample[]; segment: Uint8Array }[] = [];
    for (let i = 0; i < 8; i++) {
      const input = encodeGop({
        count: 10 + i * 3, // a different sample count per segment, so moof's size moves
        startUs: i * 2_000_000,
        frameDurationUs: 33_333,
        seed: 100 + i,
      });
      packaged.push({ input, segment: muxer.packageSegment(input).data });
    }

    const last = packaged.at(-1);
    if (last === undefined) throw new Error("no segments were packaged");

    const recovered = recoverSamples(last.segment);
    expect(recovered[0]).toHaveLength(last.input.length);
    for (let i = 0; i < last.input.length; i++) {
      expect([...(recovered[0]?.[i] ?? [])], `sample ${i}`).toEqual([...(last.input[i]?.data ?? [])]);
    }
  });
});

describe("the decode clock", () => {
  it("starts at zero and accumulates the durations actually written", () => {
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    const segments = [0, 1, 2, 3].map((i) =>
      muxer.packageSegment(
        encodeGop({ count: 30, startUs: i * 1_000_000, frameDurationUs: 33_333, seed: 20 + i }),
      ),
    );

    let expected = 0;
    for (const segment of segments) {
      const boxes = parseBoxes(segment.data);
      expect(parseTfdt(requireBox(boxes, "moof.traf.tfdt")).baseMediaDecodeTime).toBe(expected);
      // Advance by what this segment's own `trun` says it contains — the same
      // sum Apple requires the next segment's `tfdt` to be consistent with
      // (research §7.2, rule 7.3).
      expected += (recoverDurations(segment.data)[0] ?? []).reduce((a, b) => a + b, 0);
    }
    expect(muxer.baseMediaDecodeTime).toBe(expected);
  });

  it("numbers fragments and segments from the right bases", () => {
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    const first = muxer.packageSegment(
      encodeGop({ count: 5, startUs: 0, frameDurationUs: 33_333, seed: 1 }),
    );
    const second = muxer.packageSegment(
      encodeGop({ count: 5, startUs: 166_665, frameDurationUs: 33_333, seed: 2 }),
    );

    // `PackagedSegment.index` is 0-based; `mfhd.sequence_number` is 1-based.
    expect([first.index, second.index]).toEqual([0, 1]);
    expect(muxer.segmentCount).toBe(2);
    const sequence = (bytes: Uint8Array): number =>
      new DataView(requireBox(parseBoxes(bytes), "moof.mfhd").payload.buffer).getUint32(
        requireBox(parseBoxes(bytes), "moof.mfhd").payload.byteOffset + 4,
      );
    expect(sequence(first.data)).toBe(1);
    expect(sequence(second.data)).toBe(2);
  });

  it("reports each segment's start and duration in seconds", () => {
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    const first = muxer.packageSegment(
      encodeGop({ count: 180, startUs: 0, frameDurationUs: 33_333, seed: 3 }),
    );
    const second = muxer.packageSegment(
      encodeGop({ count: 180, startUs: 5_999_940, frameDurationUs: 33_333, seed: 4 }),
    );

    expect(first.startSeconds).toBe(0);
    expect(first.durationSeconds).toBeCloseTo(5.99994, 5);
    // The second segment starts exactly where the first ended — no gap, no
    // overlap, which is what keeps two SourceBuffers' ranges aligned (§10).
    expect(second.startSeconds).toBeCloseTo(first.durationSeconds, 9);
  });
});

describe("timescale conversion and drift", () => {
  it("passes microseconds through unchanged at a 1e6 timescale", () => {
    // The recommended video timescale makes the conversion the identity
    // function, so no rounding exists to accumulate (research §5.1).
    expect(microsecondsToTimescale(33_333, 1_000_000)).toBe(33_333);
    expect(microsecondsToTimescale(7_200_000_000, 1_000_000)).toBe(7_200_000_000);
  });

  it("keeps the running position exact at every fragment boundary", () => {
    /**
     * The invariant that defines error diffusion (research §5.2): after any
     * number of samples, the accumulated position in timescale units equals the
     * single rounding of the exact accumulated microseconds. Per-sample
     * rounding cannot satisfy this — its error grows with the sample count.
     */
    const timescale = 90_000;
    let clock = MEDIA_CLOCK_START;
    let elapsedUs = 0;

    for (let segment = 0; segment < 40; segment++) {
      const samples = encodeGop({
        count: 30,
        startUs: elapsedUs,
        frameDurationUs: 33_367, // 30000/1001 fps, which divides into nothing
        seed: 500 + segment,
      });
      const plan = planFragment(samples, timescale, clock);
      expect(plan.baseMediaDecodeTime).toBe(microsecondsToTimescale(elapsedUs, timescale));

      elapsedUs += samples.reduce((sum, s) => sum + s.durationUs, 0);
      clock = plan.clock;
      expect(clock.elapsedUnits).toBe(microsecondsToTimescale(elapsedUs, timescale));
    }
  });

  it("does not drift the way per-sample rounding does", () => {
    /**
     * A deliberately coarse timescale, so the effect is measurable in a short
     * test rather than after an hour of video. The mechanism is identical at
     * any timescale — this one just makes 1200 frames enough to see it.
     *
     * 33_333µs per frame at a timescale of 1000 is 33.333 ticks. Rounded per
     * sample that is 33, and 1200 of them come to 39_600 ticks. The true
     * elapsed time is 39_999.6 ticks, which rounds once to 40_000. Four tenths
     * of a second lost over forty — a full 1%, so audio would be a second
     * behind video after about a minute and a half.
     */
    const coarse = 1000;
    const frames = 1200;
    const frameDurationUs = 33_333;

    const samples = encodeGop({ count: frames, startUs: 0, frameDurationUs, seed: 42 });
    const plan = planFragment(samples, coarse, MEDIA_CLOCK_START);

    const naive = frames * Math.round((frameDurationUs * coarse) / 1_000_000);
    const diffused = plan.samples.reduce((sum, s) => sum + s.duration, 0);

    expect(naive).toBe(39_600);
    expect(diffused).toBe(40_000); // round(1200 × 33333 × 1000 / 1e6) = round(39_999.6)
    expect(diffused - naive).toBe(400);
    // And the diffused total is the single rounding of the exact position.
    expect(diffused).toBe(microsecondsToTimescale(frames * frameDurationUs, coarse));
  });

  it("gives AAC frames exact integer durations at a sample-rate timescale", () => {
    // 1024 samples per frame at 48000 Hz is exactly 1024 ticks, always, with no
    // rounding anywhere — which is why the spec recommends the sample rate as
    // the audio timescale (research §5.1).
    const frameDurationUs = Math.round((1024 / 48_000) * 1_000_000); // 21333
    const samples = encodeGop({ count: 200, startUs: 0, frameDurationUs, seed: 9 });
    const plan = planFragment(samples, 48_000, MEDIA_CLOCK_START);

    const durations = new Set(plan.samples.map((s) => s.duration));
    // 21333µs is itself a rounding of 21333.33µs, so the tick durations
    // alternate between 1023 and 1024 rather than being uniformly 1024 — the
    // conversion is faithful to the input, and does not invent precision the
    // input never had.
    expect([...durations].sort((a, b) => a - b)).toEqual([1023, 1024]);
    expect(plan.clock.elapsedUnits).toBe(microsecondsToTimescale(200 * frameDurationUs, 48_000));
  });

  it("refuses a conversion that would silently lose precision", () => {
    // 2^53 microseconds is 285 years, so this is unreachable in practice; the
    // guard exists because the failure would be a wrong seek, not an error.
    expect(() => microsecondsToTimescale(Number.MAX_SAFE_INTEGER, 90_000)).toThrow(/2\^53/);
  });
});

describe("segment rules", () => {
  it("refuses a video segment that does not start on a keyframe", () => {
    // "Video segments MUST start with an IDR frame" (research §7.2), and after
    // a `changeType()` MSE has nowhere else for playback to resume (§6.3).
    const samples = encodeGop({ count: 5, startUs: 0, frameDurationUs: 33_333, seed: 1 });
    const notKeyed = samples.map((s) => ({ ...s, isKeyFrame: false }));
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    expect(() => muxer.packageSegment(notKeyed)).toThrow(/must start with a keyframe/);
  });

  it("allows an audio segment to start anywhere, because every AAC frame is a sync sample", () => {
    const samples = encodeGop({ count: 4, startUs: 0, frameDurationUs: 21_333, seed: 2 });
    const muxer = new TrackMuxer({ config: AUDIO_CONFIG });
    expect(() => muxer.packageSegment(samples.map((s) => ({ ...s, isKeyFrame: false })))).not.toThrow();
  });

  it("refuses an empty segment", () => {
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    expect(() => muxer.packageSegment([])).toThrow(/at least one sample/);
  });
});

describe("the init segment and the media segments agree", () => {
  it("stamps the packaged duration into moov when none was declared up front", () => {
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG, movieTimescale: 1000 });
    for (let i = 0; i < 3; i++) {
      muxer.packageSegment(
        encodeGop({ count: 30, startUs: i * 999_990, frameDurationUs: 33_333, seed: 60 + i }),
      );
    }

    const boxes = parseBoxes(muxer.initSegment());
    // 90 frames × 33_333µs = 2.99997s → 3000 movie-timescale ticks, and the
    // full microsecond count in the track's own timescale.
    expect(
      new DataView(
        requireBox(boxes, "moov.trak.mdia.mdhd").payload.buffer,
        requireBox(boxes, "moov.trak.mdia.mdhd").payload.byteOffset + 16,
        4,
      ).getUint32(0),
    ).toBe(2_999_970);
    expect(muxer.baseMediaDecodeTime).toBe(2_999_970);
  });

  it("declares zero when the init segment is built before anything is packaged", () => {
    const muxer = new TrackMuxer({ config: VIDEO_CONFIG });
    const boxes = parseBoxes(muxer.initSegment());
    const mdhd = requireBox(boxes, "moov.trak.mdia.mdhd");
    expect(
      new DataView(mdhd.payload.buffer, mdhd.payload.byteOffset + 16, 4).getUint32(0),
    ).toBe(0);
  });

  it("uses the track_ID from the init segment in every fragment", () => {
    const muxer = new TrackMuxer({ config: AUDIO_CONFIG, trackId: 2 });
    const segment = muxer.packageSegment(
      encodeGop({ count: 4, startUs: 0, frameDurationUs: 21_333, seed: 5 }),
    );
    expect(parseTfhd(requireBox(parseBoxes(segment.data), "moof.traf.tfhd")).trackId).toBe(2);
  });
});
