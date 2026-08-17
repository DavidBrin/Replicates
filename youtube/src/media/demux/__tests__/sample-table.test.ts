// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ByteWriter } from "../../muxer/writer";
import { parseBoxes, type ParsedBox } from "../../muxer/parser";
import {
  buildSampleTable,
  decodeChunkOffsets,
  decodeCtts,
  decodeElst,
  decodeStsc,
  decodeStss,
  decodeStsz,
  decodeStts,
  isSyncSample,
} from "../sample-table";

/**
 * Each `stbl` box decoded in isolation, against a table built by hand with
 * answers worked out on paper.
 *
 * The fixtures here are deliberately *not* produced by anything that shares
 * code with the decoder. Every box below is a literal field-by-field write from
 * the layouts in research/02 §1.10 and ISO/IEC 14496-12 §8.6–8.7, so a decoder
 * that mirrors a bug in its own fixture generator has nowhere to hide. The
 * expected values are small enough to verify by inspection — a four-chunk file
 * whose sample offsets can be added up in your head is worth more here than a
 * realistic one whose expectations had to be computed by the thing under test.
 */

/* -------------------------------------------------------------- fixtures -- */

function boxOf(type: string, body: (w: ByteWriter) => void): ParsedBox {
  const w = new ByteWriter(256);
  const start = w.beginBox(type);
  body(w);
  w.endBox(start);
  const parsed = parseBoxes(w.finish())[0];
  if (parsed === undefined) throw new Error(`could not build a "${type}" box`);
  return parsed;
}

function fullBoxOf(
  type: string,
  version: number,
  body: (w: ByteWriter) => void,
): ParsedBox {
  return boxOf(type, (w) => {
    w.u8(version);
    w.u24(0);
    body(w);
  });
}

/** `stts`: entry_count, then (sample_count, sample_delta) pairs `[BMFF §8.6.1.2]`. */
function stts(entries: readonly [count: number, delta: number][]): ParsedBox {
  return fullBoxOf("stts", 0, (w) => {
    w.u32(entries.length);
    for (const [count, delta] of entries) {
      w.u32(count);
      w.u32(delta);
    }
  });
}

/** `ctts`: entry_count, then (sample_count, sample_offset) `[BMFF §8.6.1.3]`. */
function ctts(
  version: number,
  entries: readonly [count: number, offset: number][],
): ParsedBox {
  return fullBoxOf("ctts", version, (w) => {
    w.u32(entries.length);
    for (const [count, offset] of entries) {
      w.u32(count);
      // The whole point of the version: v0 writes this unsigned, v1 signed.
      // Written through the matching primitive so the fixture is honest about
      // which bytes a real muxer would have emitted.
      if (version === 1) w.i32(offset);
      else w.u32(offset);
    }
  });
}

/** `stsc`: (first_chunk, samples_per_chunk, sample_description_index) `[BMFF §8.7.4]`. */
function stsc(
  entries: readonly [first: number, perChunk: number, descriptionIndex?: number][],
): ParsedBox {
  return fullBoxOf("stsc", 0, (w) => {
    w.u32(entries.length);
    for (const [first, perChunk, descriptionIndex] of entries) {
      w.u32(first);
      w.u32(perChunk);
      w.u32(descriptionIndex ?? 1);
    }
  });
}

/** `stsz`: sample_size, sample_count, then the table iff sample_size is 0. */
function stsz(uniformSize: number, sizes: readonly number[]): ParsedBox {
  return stszRaw(uniformSize, sizes.length, sizes);
}

/** `stsz` with `sample_count` stated independently, so a fixture can lie. */
function stszRaw(
  uniformSize: number,
  sampleCount: number,
  sizes: readonly number[],
): ParsedBox {
  return fullBoxOf("stsz", 0, (w) => {
    w.u32(uniformSize);
    w.u32(sampleCount);
    if (uniformSize === 0) for (const size of sizes) w.u32(size);
  });
}

function stco(offsets: readonly number[]): ParsedBox {
  return fullBoxOf("stco", 0, (w) => {
    w.u32(offsets.length);
    for (const offset of offsets) w.u32(offset);
  });
}

function co64(offsets: readonly number[]): ParsedBox {
  return fullBoxOf("co64", 0, (w) => {
    w.u32(offsets.length);
    for (const offset of offsets) w.u64(offset);
  });
}

function stss(sampleNumbers: readonly number[]): ParsedBox {
  return fullBoxOf("stss", 0, (w) => {
    w.u32(sampleNumbers.length);
    for (const number of sampleNumbers) w.u32(number);
  });
}

/** `stbl` from whichever children the case needs. `stsd` is not one of them. */
function stbl(children: readonly ParsedBox[]): ParsedBox {
  const w = new ByteWriter(1024);
  const start = w.beginBox("stbl");
  for (const child of children) {
    w.u32(child.size);
    w.fourcc(child.type);
    w.bytes(child.payload);
  }
  w.endBox(start);
  const parsed = parseBoxes(w.finish())[0];
  if (parsed === undefined) throw new Error("could not build an stbl");
  return parsed;
}

/** Overwrites a `FullBox`'s `entry_count`, to fake the corruption. */
function withEntryCount(box: ParsedBox, count: number): ParsedBox {
  const bytes = Uint8Array.from([
    ...new Uint8Array(8), // size + type, rewritten below
    ...box.payload,
  ]);
  new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
  for (let i = 0; i < 4; i++) bytes[4 + i] = box.type.charCodeAt(i);
  new DataView(bytes.buffer).setUint32(12, count); // past size, type, version/flags
  const parsed = parseBoxes(bytes)[0];
  if (parsed === undefined) throw new Error("could not rebuild the box");
  return parsed;
}

/* ----------------------------------------------------------------- stts -- */

describe("stts — time to sample", () => {
  it("expands run-length durations into one delta per sample", () => {
    expect(decodeStts(stts([[3, 1024]]))).toEqual([{ sampleCount: 3, sampleDelta: 1024 }]);
  });

  it("carries several runs, which is what a variable-frame-rate track writes", () => {
    expect(
      decodeStts(
        stts([
          [10, 512],
          [1, 300],
          [4, 512],
        ]),
      ),
    ).toEqual([
      { sampleCount: 10, sampleDelta: 512 },
      { sampleCount: 1, sampleDelta: 300 },
      { sampleCount: 4, sampleDelta: 512 },
    ]);
  });

  it("reads an empty table as no entries rather than as an error", () => {
    expect(decodeStts(stts([]))).toEqual([]);
  });

  it("refuses an entry_count the box is too small to hold", () => {
    // The guard that matters: a corrupt count is caught by one comparison
    // against the box size, not by four billion iterations of a loop.
    expect(() => decodeStts(withEntryCount(stts([[1, 10]]), 0xffff_ffff))).toThrow(
      /declares 4294967295 entries/,
    );
  });
});

/* ----------------------------------------------------------------- ctts -- */

describe("ctts — composition offsets", () => {
  it("reads version 0 offsets as unsigned", () => {
    const decoded = decodeCtts(
      ctts(0, [
        [1, 0],
        [2, 3000],
      ]),
    );
    expect(decoded.version).toBe(0);
    expect(decoded.entries).toEqual([
      { sampleCount: 1, sampleOffset: 0 },
      { sampleCount: 2, sampleOffset: 3000 },
    ]);
  });

  it("reads version 1 offsets as signed, negatives included", () => {
    const decoded = decodeCtts(
      ctts(1, [
        [1, -1000],
        [1, 0],
        [1, 2000],
      ]),
    );
    expect(decoded.version).toBe(1);
    expect(decoded.entries.map((entry) => entry.sampleOffset)).toEqual([-1000, 0, 2000]);
  });

  it("does not read a version 1 box as unsigned", () => {
    /**
     * The bug this test exists for. A negative offset in a v1 box read as u32
     * comes back as ~4.29 billion, which at a 1e6 timescale throws that one
     * frame about 71 minutes into the future — the file plays normally until
     * the decoder reaches it and then stalls, with nothing in the box tree
     * wrong (research §10, and the same failure the muxer's `trun` guards).
     */
    const asSigned = decodeCtts(ctts(1, [[1, -1000]])).entries[0]?.sampleOffset;
    expect(asSigned).toBe(-1000);
    expect(asSigned).not.toBe(0xffff_ffff - 999);
  });

  it("refuses an entry_count the box is too small to hold", () => {
    expect(() => decodeCtts(withEntryCount(ctts(0, [[1, 0]]), 1_000_000))).toThrow(
      /declares 1000000 entries/,
    );
  });
});

/* ----------------------------------------------------------------- stsc -- */

describe("stsc — sample to chunk", () => {
  it("decodes the run-length entries as written", () => {
    expect(
      decodeStsc(
        stsc([
          [1, 4],
          [3, 2],
        ]),
      ),
    ).toEqual([
      { firstChunk: 1, samplesPerChunk: 4, sampleDescriptionIndex: 1 },
      { firstChunk: 3, samplesPerChunk: 2, sampleDescriptionIndex: 1 },
    ]);
  });

  it("refuses a first_chunk below 1, which is a 0-based reading of a 1-based field", () => {
    expect(() => decodeStsc(stsc([[0, 4]]))).toThrow(/first_chunk 0/);
  });

  it("refuses first_chunk values that do not strictly increase", () => {
    expect(() =>
      decodeStsc(
        stsc([
          [1, 4],
          [1, 2],
        ]),
      ),
    ).toThrow(/must strictly increase/);
  });
});

/* ----------------------------------------------------------------- stsz -- */

describe("stsz — sample sizes, in both of its forms", () => {
  it("reads the table form, where sample_size is 0", () => {
    const decoded = decodeStsz(stsz(0, [100, 250, 90]));
    expect(decoded.uniformSize).toBe(0);
    expect(decoded.sampleCount).toBe(3);
    expect(Array.from(decoded.sizes ?? [])).toEqual([100, 250, 90]);
  });

  it("reads the uniform form, where a non-zero sample_size means an empty table", () => {
    // Constant-bitrate audio writes this, and a reader that went looking for a
    // table anyway would read the next box's bytes as sample sizes.
    const box = stsz(1536, [0, 0, 0, 0, 0]);
    expect(box.payload.byteLength).toBe(12); // version/flags + two u32s, no table
    const decoded = decodeStsz(box);
    expect(decoded.uniformSize).toBe(1536);
    expect(decoded.sampleCount).toBe(5);
    expect(decoded.sizes).toBeUndefined();
  });

  it("refuses a table shorter than the sample count it declares", () => {
    expect(() => decodeStsz(stszRaw(0, 9, [1, 2, 3]))).toThrow(/declares 9 samples/);
  });
});

/* ---------------------------------------------------------- stco / co64 -- */

describe("stco and co64 — chunk offsets", () => {
  it("reads 32-bit offsets from stco", () => {
    expect(Array.from(decodeChunkOffsets(stco([48, 1024, 65_536])))).toEqual([
      48, 1024, 65_536,
    ]);
  });

  it("reads 64-bit offsets from co64, past where a u32 stops", () => {
    // The reason co64 exists: a file over 4 GiB cannot address its own chunks
    // with 32 bits, and a reader that assumed stco would read them as garbage.
    const beyondU32 = 0x1_0000_0000 + 12_345;
    expect(Array.from(decodeChunkOffsets(co64([48, beyondU32])))).toEqual([48, beyondU32]);
  });

  it("refuses an entry_count neither box could hold", () => {
    expect(() => decodeChunkOffsets(withEntryCount(stco([1, 2]), 500))).toThrow(
      /declares 500 entries/,
    );
    expect(() => decodeChunkOffsets(withEntryCount(co64([1, 2]), 500))).toThrow(
      /declares 500 entries/,
    );
  });
});

/* ----------------------------------------------------------------- stss -- */

describe("stss — sync samples", () => {
  it("reads the 1-based sample numbers as written", () => {
    expect(Array.from(decodeStss(stss([1, 31, 61])))).toEqual([1, 31, 61]);
  });

  it("refuses sample number 0, which is a 0-based reading of a 1-based field", () => {
    expect(() => decodeStss(stss([0, 30]))).toThrow(/sample number 0/);
  });
});

/* ----------------------------------------------------------------- elst -- */

describe("elst — edit lists", () => {
  it("decodes a version 0 entry", () => {
    const box = fullBoxOf("elst", 0, (w) => {
      w.u32(1);
      w.u32(5000); // segment_duration, in the MOVIE timescale
      w.i32(1024); // media_time, in the TRACK's media timescale
      w.i16(1);
      w.i16(0);
    });
    expect(decodeElst(box)).toEqual({
      version: 0,
      entries: [{ segmentDuration: 5000, mediaTime: 1024, mediaRate: 1 }],
    });
  });

  it("decodes a version 1 entry, and an empty edit's media_time of -1", () => {
    // media_time == -1 is the "empty edit" that delays a track by
    // segment_duration — the shape an encoder emits to signal priming delay.
    const box = fullBoxOf("elst", 1, (w) => {
      w.u32(2);
      w.u64(1000);
      w.i32(-1); // media_time is i64 in v1: high word…
      w.i32(-1); // …and low word. -1 as a 64-bit two's complement.
      w.i16(1);
      w.i16(0);
      w.u64(9000);
      w.i32(0);
      w.i32(0);
      w.i16(1);
      w.i16(0);
    });
    expect(decodeElst(box).entries).toEqual([
      { segmentDuration: 1000, mediaTime: -1, mediaRate: 1 },
      { segmentDuration: 9000, mediaTime: 0, mediaRate: 1 },
    ]);
  });
});

/* ------------------------------------------------------------ the join -- */

describe("the join — every table at once", () => {
  /**
   * Nine samples in four chunks, laid out so that every arithmetic mistake
   * produces a different wrong answer:
   *
   *   chunk 1 @ 100: samples 1,2,3   sizes 10, 20, 30
   *   chunk 2 @ 400: samples 4,5,6   sizes 40, 50, 60
   *   chunk 3 @ 700: samples 7,8     sizes 70, 80
   *   chunk 4 @ 900: samples 9       size  90
   *
   * The `stsc` says "chunks 1..2 hold 3 samples, chunks 3.. hold 2" — and the
   * last run has no terminator, so chunk 4 is only reachable by treating the
   * final entry as running to the end of the chunk offset table.
   */
  const NINE_SAMPLES = stbl([
    stts([[9, 512]]),
    stsc([
      [1, 3],
      [3, 2],
    ]),
    stsz(0, [10, 20, 30, 40, 50, 60, 70, 80, 90]),
    stco([100, 400, 700, 900]),
  ]);

  it("places every sample at its chunk offset plus the sizes before it", () => {
    const table = buildSampleTable(NINE_SAMPLES);
    expect(table.sampleCount).toBe(9);
    expect(Array.from(table.offsets)).toEqual([
      100, 110, 130, // chunk 1
      400, 440, 490, // chunk 2
      700, 770, // chunk 3
      900, // chunk 4
    ]);
    expect(Array.from(table.sizes)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it("runs the last stsc entry to the end of the chunk table", () => {
    // Chunk 4 exists only in `stco`; nothing in `stsc` mentions it. A reader
    // that stopped at the last `first_chunk` would silently lose sample 9 —
    // the classic off-by-one, and one that truncates a video rather than
    // failing.
    const table = buildSampleTable(NINE_SAMPLES);
    expect(table.offsets[8]).toBe(900);
    expect(table.sizes[8]).toBe(90);
  });

  it("accumulates decode times from the stts deltas", () => {
    const table = buildSampleTable(NINE_SAMPLES);
    expect(Array.from(table.decodeTimes)).toEqual([
      0, 512, 1024, 1536, 2048, 2560, 3072, 3584, 4096,
    ]);
    expect(table.totalDuration).toBe(9 * 512);
  });

  it("treats a missing stss as every sample being a sync sample", () => {
    // Not "no keyframes" — the opposite. All-intra footage writes no `stss` at
    // all, and a reader that took absence for emptiness would decide the file
    // had no seek points and could not start playback anywhere.
    const table = buildSampleTable(NINE_SAMPLES);
    expect(table.syncFlags).toBeUndefined();
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => isSyncSample(table, i))).toEqual(
      Array.from({ length: 9 }, () => true),
    );
  });

  it("marks only the listed samples as sync when stss is present", () => {
    const table = buildSampleTable(
      stbl([
        stts([[9, 512]]),
        stsc([[1, 3]]),
        stsz(0, [10, 20, 30, 40, 50, 60, 70, 80, 90]),
        stco([100, 400, 700]),
        stss([1, 7]),
      ]),
    );
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => isSyncSample(table, i))).toEqual([
      true, false, false, false, false, false, true, false, false,
    ]);
  });

  it("expands the uniform stsz form across chunks", () => {
    const table = buildSampleTable(
      stbl([
        stts([[6, 1024]]),
        stsc([[1, 2]]),
        stsz(500, [0, 0, 0, 0, 0, 0]),
        stco([1000, 3000, 5000]),
      ]),
    );
    expect(Array.from(table.sizes)).toEqual([500, 500, 500, 500, 500, 500]);
    expect(Array.from(table.offsets)).toEqual([1000, 1500, 3000, 3500, 5000, 5500]);
  });

  it("carries signed composition offsets through to the joined table", () => {
    const table = buildSampleTable(
      stbl([
        stts([[4, 100]]),
        ctts(1, [
          [1, 200],
          [1, -100],
          [2, 0],
        ]),
        stsc([[1, 4]]),
        stsz(0, [1, 2, 3, 4]),
        stco([8]),
      ]),
    );
    expect(Array.from(table.compositionOffsets ?? [])).toEqual([200, -100, 0, 0]);
  });

  it("leaves compositionOffsets absent when the track has no ctts at all", () => {
    expect(buildSampleTable(NINE_SAMPLES).compositionOffsets).toBeUndefined();
  });

  it("takes stsz.sample_count as authoritative when the last chunk is short", () => {
    // Eight samples in chunks of three: the interleaver filled two chunks and
    // left the third holding two. `stsc` still says three-per-chunk, so the
    // chunk walk describes nine. `stsz` is the count that is right.
    const table = buildSampleTable(
      stbl([
        stts([[8, 10]]),
        stsc([[1, 3]]),
        stsz(100, new Array<number>(8).fill(0)),
        stco([0, 1000, 2000]),
      ]),
    );
    expect(table.sampleCount).toBe(8);
    expect(Array.from(table.offsets)).toEqual([
      0, 100, 200, 1000, 1100, 1200, 2000, 2100,
    ]);
  });

  it("refuses a table whose chunks cannot hold the samples stsz declares", () => {
    // The other direction is not recoverable: samples exist that no chunk
    // addresses, so there is no offset to give them.
    expect(() =>
      buildSampleTable(
        stbl([
          stts([[8, 10]]),
          stsc([[1, 2]]),
          stsz(100, new Array<number>(8).fill(0)),
          stco([0, 1000]),
        ]),
      ),
    ).toThrow(/chunks describe 4 samples but stsz declares 8/);
  });

  it("stops walking chunks once stsz's sample count is reached", () => {
    // The surplus-chunk case again, but with the surplus in whole chunks: a
    // `stco` longer than the samples need must not run past the arrays.
    const table = buildSampleTable(
      stbl([
        stts([[2, 10]]),
        stsc([[1, 2]]),
        stsz(50, [0, 0]),
        stco([0, 1000, 2000, 3000]),
      ]),
    );
    expect(Array.from(table.offsets)).toEqual([0, 50]);
  });

  it("refuses an stts that does not cover every sample", () => {
    expect(() =>
      buildSampleTable(
        stbl([
          stts([[3, 10]]),
          stsc([[1, 9]]),
          stsz(100, new Array<number>(9).fill(0)),
          stco([0]),
        ]),
      ),
    ).toThrow(/stts describes 3 samples but stsz declares 9/);
  });

  it("refuses a chunk that references a second stsd entry", () => {
    // We write exactly one sample entry and read exactly one. A file whose
    // chunks switch description mid-track would need a second `TrackConfig`,
    // and quietly using the first one would decode the tail with the wrong
    // parameter sets.
    expect(() =>
      buildSampleTable(
        stbl([
          stts([[4, 10]]),
          stsc([
            [1, 2, 1],
            [2, 2, 2],
          ]),
          stsz(100, new Array<number>(4).fill(0)),
          stco([0, 500]),
        ]),
      ),
    ).toThrow(/sample_description_index/);
  });

  it("refuses an stbl missing a table it cannot do without", () => {
    expect(() => buildSampleTable(stbl([stts([[1, 10]]), stsc([[1, 1]])]))).toThrow(
      /has no stsz/,
    );
    expect(() => buildSampleTable(stbl([stts([[1, 10]]), stsz(1, [0])]))).toThrow(
      /has no stsc/,
    );
  });
});
