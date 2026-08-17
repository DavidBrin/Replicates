// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  NON_SYNC_SAMPLE_FLAGS,
  SYNC_SAMPLE_FLAGS,
  TFHD_BASE_DATA_OFFSET_PRESENT,
  TFHD_FLAGS,
  TFHD_SAMPLE_DESCRIPTION_INDEX_PRESENT,
  TRUN_DATA_OFFSET_PRESENT,
  TRUN_FIRST_SAMPLE_FLAGS_PRESENT,
  TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT,
  TRUN_SAMPLE_DURATION_PRESENT,
  TRUN_SAMPLE_FLAGS_PRESENT,
  TRUN_SAMPLE_SIZE_PRESENT,
  sampleFlags,
} from "../boxes";
import {
  type FragmentSample,
  buildMediaSegment,
  computeMoofSize,
  planTrackFragment,
} from "../media-segment";
import {
  type ParsedBox,
  flattenBoxes,
  formatBoxTree,
  parseBoxes,
  parseMfhd,
  parseTfdt,
  parseTfhd,
  parseTrun,
  requireBox,
} from "../parser";

/**
 * The three bugs this file exists to catch, all of which leave a perfectly
 * well-formed box tree behind:
 *
 *   - a `data_offset` off by any number of bytes, which hands the decoder a
 *     shifted window and reads as a codec fault;
 *   - a `sample_is_non_sync_sample` bit set the wrong way, which plays fine
 *     from zero and cannot seek;
 *   - a missing `tfdt`, which core ISO BMFF permits and MSE rejects outright.
 *
 * None of them can be found by checking that the output parses. Each is checked
 * below against a value derived independently of the muxer's own arithmetic.
 */

/* -------------------------------------------------------------- fixtures -- */

/**
 * A sample whose bytes are a recognisable ramp, so that a byte range recovered
 * from `trun` can be matched back to the sample it should have come from rather
 * than merely being the right length.
 */
function sample(options: {
  size: number;
  isKeyFrame: boolean;
  duration?: number;
  compositionOffset?: number;
  seed?: number;
}): FragmentSample {
  const data = new Uint8Array(options.size);
  for (let i = 0; i < options.size; i++) data[i] = ((options.seed ?? 0) + i) & 0xff;
  return {
    data,
    size: options.size,
    duration: options.duration ?? 33_333,
    flags: sampleFlags(options.isKeyFrame),
    compositionOffset: options.compositionOffset ?? 0,
  };
}

/** A keyframe-led GOP: one large sync sample then delta frames of varying size. */
function gop(count: number, baseMediaDecodeTime = 0, trackId = 1) {
  const samples = [sample({ size: 4096, isKeyFrame: true, seed: 1 })];
  for (let i = 1; i < count; i++) {
    samples.push(sample({ size: 512 + i * 8, isKeyFrame: false, seed: i + 2 }));
  }
  return { id: trackId, baseMediaDecodeTime, samples };
}

function auditSizes(boxes: readonly ParsedBox[], totalBytes: number): void {
  expect(boxes.reduce((sum, box) => sum + box.size, 0)).toBe(totalBytes);
  for (const box of flattenBoxes(boxes)) {
    if (box.children.length === 0) continue;
    const prefixBytes = box.childrenOffset - box.offset;
    const childBytes = box.children.reduce((sum, child) => sum + child.size, 0);
    expect(prefixBytes + childBytes, `${box.type} declares size ${box.size}`).toBe(box.size);
  }
}

/* ------------------------------------------------------------------ tests -- */

describe("shape", () => {
  it("is a moof followed by a single mdat", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(10)] }));
    expect(boxes.map((box) => box.type)).toEqual(["moof", "mdat"]);
  });

  it("declares every box's size correctly, recursively", () => {
    const bytes = buildMediaSegment({
      sequenceNumber: 4,
      tracks: [gop(30), { ...gop(12, 0, 2), id: 2 }],
    });
    auditSizes(parseBoxes(bytes), bytes.byteLength);
  });

  it("orders tfhd, tfdt and trun the way the spec requires", () => {
    // `tfdt` "must be positioned after tfhd and before the first trun"
    // (research §3.5). The order is a requirement, not a convention.
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(5)] }));
    expect(requireBox(boxes, "moof").children.map((b) => b.type)).toEqual(["mfhd", "traf"]);
    expect(requireBox(boxes, "moof.traf").children.map((b) => b.type)).toEqual([
      "tfhd",
      "tfdt",
      "trun",
    ]);
  });

  it("numbers fragments from one, file-wide", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 7, tracks: [gop(3)] }));
    expect(parseMfhd(requireBox(boxes, "moof.mfhd")).sequenceNumber).toBe(7);
  });
});

describe("tfdt", () => {
  it("is present on every traf", () => {
    // MSE lists a missing `tfdt` on any `traf` as an append-error condition,
    // overriding core ISO BMFF's "Mandatory: No" (research §6.2).
    const boxes = parseBoxes(
      buildMediaSegment({
        sequenceNumber: 1,
        tracks: [gop(6, 0, 1), { ...gop(4, 0, 2), id: 2 }],
      }),
    );
    const trafs = requireBox(boxes, "moof").children.filter((box) => box.type === "traf");
    expect(trafs).toHaveLength(2);
    for (const traf of trafs) {
      expect(traf.children.map((box) => box.type), formatBoxTree([traf])).toContain("tfdt");
    }
  });

  it("uses version 1, so a long stream cannot overflow it", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(3)] }));
    expect(parseTfdt(requireBox(boxes, "moof.traf.tfdt")).version).toBe(1);
  });

  it("carries a decode time past 2^32, which version 0 could not", () => {
    // 90 minutes at a 1e6 timescale. Version 0 overflows at ~71 minutes
    // (research §5.3), so this value is only expressible because of version 1.
    const baseMediaDecodeTime = 5_400_000_000;
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 900, tracks: [gop(5, baseMediaDecodeTime)] }),
    );
    expect(parseTfdt(requireBox(boxes, "moof.traf.tfdt")).baseMediaDecodeTime).toBe(
      baseMediaDecodeTime,
    );
  });

  it("carries each track's own decode time, not a shared one", () => {
    const boxes = parseBoxes(
      buildMediaSegment({
        sequenceNumber: 2,
        // Same wall-clock position, different timescales: 6s at 1e6 and at 48000.
        tracks: [gop(5, 6_000_000, 1), { ...gop(5, 288_000, 2), id: 2 }],
      }),
    );
    expect(parseTfdt(requireBox(boxes, "moof.traf[0].tfdt")).baseMediaDecodeTime).toBe(6_000_000);
    expect(parseTfdt(requireBox(boxes, "moof.traf[1].tfdt")).baseMediaDecodeTime).toBe(288_000);
  });
});

describe("tfhd", () => {
  it("sets default-base-is-moof and all three defaults, and nothing else", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(8)] }));
    const tfhd = parseTfhd(requireBox(boxes, "moof.traf.tfhd"));

    expect(tfhd.flags).toBe(0x020038);
    expect(tfhd.flags).toBe(TFHD_FLAGS);
    // Mixing anchoring conventions desyncs one track and leaves the other
    // perfect, which makes it maddening to isolate (research §10).
    expect(tfhd.flags & TFHD_BASE_DATA_OFFSET_PRESENT).toBe(0);
    expect(tfhd.baseDataOffset).toBeUndefined();
    // The sample description index always comes from `trex`, which is always 1.
    expect(tfhd.flags & TFHD_SAMPLE_DESCRIPTION_INDEX_PRESENT).toBe(0);
  });

  it("takes its defaults from the second sample, not the keyframe", () => {
    // A GOP-aligned fragment opens on the one sample that differs from every
    // other, so sample 1 is the representative one (research §3.3).
    const track = gop(6);
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [track] }));
    const tfhd = parseTfhd(requireBox(boxes, "moof.traf.tfhd"));

    expect(tfhd.defaultSampleSize).toBe(track.samples[1]?.size);
    expect(tfhd.defaultSampleFlags).toBe(NON_SYNC_SAMPLE_FLAGS);
    expect(tfhd.defaultSampleDuration).toBe(33_333);
  });

  it("carries the track's own ID", () => {
    const boxes = parseBoxes(
      buildMediaSegment({
        sequenceNumber: 1,
        tracks: [gop(3, 0, 1), { ...gop(3, 0, 2), id: 2 }],
      }),
    );
    expect(parseTfhd(requireBox(boxes, "moof.traf[0].tfhd")).trackId).toBe(1);
    expect(parseTfhd(requireBox(boxes, "moof.traf[1].tfhd")).trackId).toBe(2);
  });
});

describe("sample flags", () => {
  it("composes the two words the standard specifies", () => {
    // sample_depends_on=2 with sample_is_non_sync_sample=0 for a keyframe;
    // sample_depends_on=1 with sample_is_non_sync_sample=1 for a delta frame.
    expect(SYNC_SAMPLE_FLAGS).toBe(0x02000000);
    expect(NON_SYNC_SAMPLE_FLAGS).toBe(0x01010000);
    expect(sampleFlags(true)).toBe(0x02000000);
    expect(sampleFlags(false)).toBe(0x01010000);
    // The bit that decides seekability: 0 means the sample IS a sync sample.
    expect((SYNC_SAMPLE_FLAGS >>> 16) & 1).toBe(0);
    expect((NON_SYNC_SAMPLE_FLAGS >>> 16) & 1).toBe(1);
  });

  it("marks the keyframe sync and every delta frame non-sync, as exact words", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(5)] }));
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    const tfhd = parseTfhd(requireBox(boxes, "moof.traf.tfhd"));

    // Sample 0's flags ride in `first_sample_flags`; the rest take the default.
    expect(trun.flags & TRUN_FIRST_SAMPLE_FLAGS_PRESENT).toBeTruthy();
    expect(trun.firstSampleFlags).toBe(0x02000000);
    expect(tfhd.defaultSampleFlags).toBe(0x01010000);
    // Mutually exclusive with first-sample-flags, so absent here.
    expect(trun.flags & TRUN_SAMPLE_FLAGS_PRESENT).toBe(0);
  });

  it("falls back to a per-sample flags table when a second keyframe appears", () => {
    // Two GOPs in one fragment: `first_sample_flags` can only override sample 0,
    // so the whole table has to be written out.
    const samples = [
      sample({ size: 900, isKeyFrame: true }),
      sample({ size: 300, isKeyFrame: false }),
      sample({ size: 800, isKeyFrame: true }),
      sample({ size: 310, isKeyFrame: false }),
    ];
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 1, tracks: [{ id: 1, baseMediaDecodeTime: 0, samples }] }),
    );
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));

    expect(trun.flags & TRUN_SAMPLE_FLAGS_PRESENT).toBeTruthy();
    expect(trun.flags & TRUN_FIRST_SAMPLE_FLAGS_PRESENT).toBe(0);
    expect(trun.samples.map((s) => s.flags)).toEqual([
      0x02000000, 0x01010000, 0x02000000, 0x01010000,
    ]);
  });

  it("writes no flag overrides at all when every sample is a keyframe", () => {
    const samples = [0, 1, 2].map((i) => sample({ size: 700 + i, isKeyFrame: true }));
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 1, tracks: [{ id: 1, baseMediaDecodeTime: 0, samples }] }),
    );
    expect(parseTfhd(requireBox(boxes, "moof.traf.tfhd")).defaultSampleFlags).toBe(0x02000000);
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    expect(trun.flags & (TRUN_SAMPLE_FLAGS_PRESENT | TRUN_FIRST_SAMPLE_FLAGS_PRESENT)).toBe(0);
  });
});

describe("trun.data_offset", () => {
  /**
   * The offset is recomputed here from the parsed box positions alone —
   * `mdat`'s own offset plus its own header size, minus `moof`'s offset — so
   * the assertion shares nothing with `computeMoofSize`. If the size model and
   * the serialiser ever disagree, this fails even though the segment parses.
   */
  function mdatPayloadOffsetFromMoof(boxes: readonly ParsedBox[]): number {
    const moof = requireBox(boxes, "moof");
    const mdat = requireBox(boxes, "mdat");
    return mdat.offset + mdat.headerSize - moof.offset;
  }

  it("points at the first byte of mdat's payload", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(24)] }));
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));

    expect(trun.flags & TRUN_DATA_OFFSET_PRESENT).toBeTruthy();
    expect(trun.dataOffset).toBe(mdatPayloadOffsetFromMoof(boxes));
  });

  it("includes mdat's own 8-byte header, which is where off-by-N bugs come from", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(24)] }));
    const moof = requireBox(boxes, "moof");
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    // Forgetting the header is the single most common cause of a wrong offset
    // (research §10), and it lands exactly 8 bytes short.
    expect(trun.dataOffset).toBe(moof.size + 8);
  });

  it("advances each later track's offset past the earlier tracks' bytes", () => {
    const video = gop(20, 0, 1);
    const audio = { ...gop(9, 0, 2), id: 2 };
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 3, tracks: [video, audio] }),
    );

    const base = mdatPayloadOffsetFromMoof(boxes);
    const videoBytes = video.samples.reduce((sum, s) => sum + s.size, 0);

    expect(parseTrun(requireBox(boxes, "moof.traf[0].trun")).dataOffset).toBe(base);
    expect(parseTrun(requireBox(boxes, "moof.traf[1].trun")).dataOffset).toBe(base + videoBytes);
  });

  it("predicts moof's size exactly, which is what makes a single pass possible", () => {
    const tracks = [gop(31, 0, 1), { ...gop(17, 0, 2), id: 2 }];
    const bytes = buildMediaSegment({ sequenceNumber: 1, tracks });
    const predicted = computeMoofSize(tracks.map(planTrackFragment));
    expect(requireBox(parseBoxes(bytes), "moof").size).toBe(predicted);
  });
});

describe("trun optional fields", () => {
  it("omits sample-duration-present when every duration is the same", () => {
    // Four bytes per sample per needless field: at 30fps and six seconds that
    // is 720 bytes of nothing, per fragment, per rung.
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(30)] }));
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    expect(trun.flags & TRUN_SAMPLE_DURATION_PRESENT).toBe(0);
    expect(trun.samples.every((s) => s.duration === undefined)).toBe(true);
  });

  it("writes sample-duration-present as soon as one duration differs", () => {
    const samples = [
      sample({ size: 400, isKeyFrame: true, duration: 33_333 }),
      sample({ size: 200, isKeyFrame: false, duration: 33_333 }),
      sample({ size: 200, isKeyFrame: false, duration: 33_334 }),
    ];
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 1, tracks: [{ id: 1, baseMediaDecodeTime: 0, samples }] }),
    );
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    expect(trun.flags & TRUN_SAMPLE_DURATION_PRESENT).toBeTruthy();
    expect(trun.samples.map((s) => s.duration)).toEqual([33_333, 33_333, 33_334]);
  });

  it("writes sample-size-present, because frame sizes always vary", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(12)] }));
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    expect(trun.flags & TRUN_SAMPLE_SIZE_PRESENT).toBeTruthy();
    expect(trun.samples[0]?.size).toBe(4096);
  });

  it("omits sample-size-present when every sample really is the same size", () => {
    // Not hypothetical: constant-bitrate AAC frames are frequently identical.
    const samples = [0, 1, 2, 3].map(() => sample({ size: 384, isKeyFrame: true, duration: 1024 }));
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 1, tracks: [{ id: 1, baseMediaDecodeTime: 0, samples }] }),
    );
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    expect(trun.flags & TRUN_SAMPLE_SIZE_PRESENT).toBe(0);
    expect(parseTfhd(requireBox(boxes, "moof.traf.tfhd")).defaultSampleSize).toBe(384);
  });

  it("omits composition-time-offsets when decode order matches presentation order", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(8)] }));
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));
    expect(trun.flags & TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT).toBe(0);
  });

  it("writes signed composition offsets under trun version 1 when B-frames exist", () => {
    /**
     * The closed-GOP example from the standard, research §5.4: frames stored in
     * decode order I1 P4 B2 B3, each shifted to its presentation slot by an
     * offset. The negative value is the case version 0 would reinterpret as a
     * huge positive u32 and throw ~71 minutes into the future (research §10).
     */
    const samples = [
      sample({ size: 900, isKeyFrame: true, duration: 10, compositionOffset: 10 }),
      sample({ size: 300, isKeyFrame: false, duration: 10, compositionOffset: 30 }),
      sample({ size: 200, isKeyFrame: false, duration: 10, compositionOffset: 0 }),
      sample({ size: 210, isKeyFrame: false, duration: 10, compositionOffset: -10 }),
    ];
    const boxes = parseBoxes(
      buildMediaSegment({ sequenceNumber: 1, tracks: [{ id: 1, baseMediaDecodeTime: 0, samples }] }),
    );
    const trun = parseTrun(requireBox(boxes, "moof.traf.trun"));

    expect(trun.version).toBe(1);
    expect(trun.flags & TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT).toBeTruthy();
    expect(trun.samples.map((s) => s.compositionOffset)).toEqual([10, 30, 0, -10]);
  });

  it("always writes data-offset-present", () => {
    const boxes = parseBoxes(buildMediaSegment({ sequenceNumber: 1, tracks: [gop(2)] }));
    expect(parseTrun(requireBox(boxes, "moof.traf.trun")).flags & TRUN_DATA_OFFSET_PRESENT)
      .toBeTruthy();
  });
});

describe("mdat", () => {
  it("concatenates every track's samples in the order the trafs appear", () => {
    const video = gop(4, 0, 1);
    const audio = { ...gop(3, 0, 2), id: 2 };
    const bytes = buildMediaSegment({ sequenceNumber: 1, tracks: [video, audio] });
    const mdat = requireBox(parseBoxes(bytes), "mdat");

    const expected = [...video.samples, ...audio.samples].flatMap((s) => [...s.data]);
    expect([...mdat.payload]).toEqual(expected);
  });

  it("declares an mdat size that covers its header and every sample byte", () => {
    const track = gop(15);
    const bytes = buildMediaSegment({ sequenceNumber: 1, tracks: [track] });
    const mdat = requireBox(parseBoxes(bytes), "mdat");
    const sampleBytes = track.samples.reduce((sum, s) => sum + s.size, 0);
    expect(mdat.size).toBe(8 + sampleBytes);
    expect(bytes.byteLength).toBe(requireBox(parseBoxes(bytes), "moof").size + mdat.size);
  });
});

describe("rejections", () => {
  it("refuses a segment with no traf", () => {
    expect(() => buildMediaSegment({ sequenceNumber: 1, tracks: [] })).toThrow(/at least one traf/);
  });

  it("refuses a traf with no samples", () => {
    expect(() =>
      buildMediaSegment({ sequenceNumber: 1, tracks: [{ id: 1, baseMediaDecodeTime: 0, samples: [] }] }),
    ).toThrow(/no samples/);
  });

  it("refuses a sequence number below one", () => {
    expect(() => buildMediaSegment({ sequenceNumber: 0, tracks: [gop(2)] })).toThrow(
      /positive integer/,
    );
  });

  it("refuses a sample whose declared size disagrees with its bytes", () => {
    // A mismatch would shift every subsequent sample's byte range while leaving
    // the box tree intact — the same failure mode as a wrong `data_offset`.
    const bad: FragmentSample = { ...sample({ size: 100, isKeyFrame: true }), size: 99 };
    expect(() =>
      buildMediaSegment({
        sequenceNumber: 1,
        tracks: [{ id: 1, baseMediaDecodeTime: 0, samples: [bad] }],
      }),
    ).toThrow(/declares 99 bytes but carries 100/);
  });
});
