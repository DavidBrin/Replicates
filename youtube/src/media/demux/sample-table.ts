/**
 * `stbl` — the five or six parallel arrays a progressive MP4 stores its sample
 * table in, and the join that turns them back into samples.
 *
 * This is the whole difficulty of demuxing a non-fragmented file, and it is
 * worth being precise about why. A fragmented file states every sample's size,
 * duration and flags inline in `trun`, next to the bytes; the muxer in
 * `src/media/muxer` writes exactly that, and reading it back is a walk. A
 * progressive file states none of it inline. Instead it stores:
 *
 *     stts   run-length durations, in decode order
 *     ctts   run-length composition offsets, when decode ≠ presentation order
 *     stsc   run-length "chunks 5 through 11 hold 3 samples each"
 *     stsz   one size per sample — or one size for all of them
 *     stco   one file offset per chunk (co64 when the file is over 4 GiB)
 *     stss   the sample numbers that are sync samples — or nothing at all
 *
 * "Sample 4211 is at byte 108,553,102, is 1,204 bytes long, is not a keyframe,
 * decodes at tick 143,974,400 and presents 3,000 ticks later" is the join of
 * all six. None of them is indexed by sample number; three are run-length
 * encoded, one is indexed by *chunk*, and one may not be there.
 *
 * Everything here decodes into flat arrays rather than a lazy cursor. The
 * tables live in `moov`, which has to be read whole anyway before a single
 * sample can be located, so laziness would save nothing; and the arrays are
 * typed, so a two-hour 30fps track costs about 2 MB of index for a file three
 * orders of magnitude larger. `Float64Array` for offsets and decode times
 * because both legitimately exceed 2^32 — `co64` exists for exactly that
 * reason, and a 1e6 timescale passes 2^32 ticks after 71 minutes. A double
 * holds every integer to 2^53 exactly, which is the same ceiling
 * `BoxReader.u64` already enforces.
 *
 * Field layouts throughout are from ISO/IEC 14496-12 §8.6–8.7, cross-read
 * against `research/02-fmp4-hls-packaging.md` §1.10 — which documents these
 * boxes only in their *empty* form, because the muxer it was written for never
 * fills them. The empty forms there do fix the headers, and the muxer's
 * `writeStbl` is the other half of the check: an `stts` this file decodes is an
 * `stts` that file could have written.
 */

import { BoxReader, type ParsedBox } from "../muxer/parser";

/* ------------------------------------------------------------ primitives -- */

/**
 * Reads a `FullBox`'s version/flags and its `entry_count`, and refuses a count
 * the box is too small to hold.
 *
 * The guard is the reason this is a function rather than four lines repeated
 * six times. `entry_count` is a `u32` read straight out of a file we did not
 * write, and the loop that follows it allocates. Without the check, a single
 * corrupt byte turns into four billion iterations — the demuxer does not crash,
 * it *hangs*, which is strictly worse because there is nothing to report. With
 * it, the failure names the box and the impossible count.
 */
function readTableHeader(
  box: ParsedBox,
  expectedType: string | readonly string[],
  bytesPerEntry: number,
): { readonly reader: BoxReader; readonly version: number; readonly entryCount: number } {
  const accepted = typeof expectedType === "string" ? [expectedType] : expectedType;
  if (!accepted.includes(box.type)) {
    throw new Error(`Expected a "${accepted.join('" or "')}" box, got "${box.type}"`);
  }

  const reader = new BoxReader(box.payload);
  if (reader.remaining < 8) {
    throw new Error(`"${box.type}" is ${box.payload.byteLength} payload bytes, too small for a header`);
  }
  const version = reader.u8();
  reader.u24(); // flags — no box here defines any
  const entryCount = reader.u32();

  if (entryCount * bytesPerEntry > reader.remaining) {
    throw new Error(
      `"${box.type}" declares ${entryCount} entries of ${bytesPerEntry} bytes but has ` +
        `${reader.remaining} payload bytes left`,
    );
  }
  return { reader, version, entryCount };
}

/* ----------------------------------------------------------------- stts -- */

export interface TimeToSampleEntry {
  readonly sampleCount: number;
  /** The decode-time delta to the next sample, in the track's own timescale. */
  readonly sampleDelta: number;
}

/**
 * `stts` — Decoding Time to Sample `[BMFF §8.6.1.2]`.
 *
 *     entry_count u32
 *     per entry: sample_count u32, sample_delta u32
 *
 * Constant-frame-rate video is one entry for the whole track; a variable-rate
 * capture is one per rate change. The deltas are *decode* deltas — presentation
 * order is this plus `ctts`, never this alone.
 */
export function decodeStts(box: ParsedBox): readonly TimeToSampleEntry[] {
  const { reader, entryCount } = readTableHeader(box, "stts", 8);
  const entries: TimeToSampleEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    entries.push({ sampleCount: reader.u32(), sampleDelta: reader.u32() });
  }
  return entries;
}

/* ----------------------------------------------------------------- ctts -- */

export interface CompositionOffsetEntry {
  readonly sampleCount: number;
  /** `CT(n) = DT(n) + offset`. Signed only when the box is version 1. */
  readonly sampleOffset: number;
}

export interface CompositionOffsets {
  readonly version: number;
  readonly entries: readonly CompositionOffsetEntry[];
}

/**
 * `ctts` — Composition Time to Sample `[BMFF §8.6.1.3]`.
 *
 *     entry_count u32
 *     per entry: sample_count u32, sample_offset u32 (v0) / i32 (v1)
 *
 * **The version decides the signedness, and getting it wrong is silent.**
 * Version 0 offsets are unsigned because CT ≥ DT always holds for a closed GOP;
 * version 1 allows an open GOP, where a frame's composition time may precede
 * its decode time, and encodes that as a negative i32 (research §5.4). Read a
 * version-1 box as unsigned and a −1000 becomes 4,294,966,296 — at a 1e6
 * timescale, one frame thrown 71 minutes into the future. The file plays
 * perfectly until the decoder reaches it. Nothing in the box tree is wrong.
 *
 * This is the reader-side twin of the `trun` version bug the muxer's
 * `writeTrun` guards against (research §10), and it is why the version is kept
 * on the result rather than discarded after use.
 */
export function decodeCtts(box: ParsedBox): CompositionOffsets {
  const { reader, version, entryCount } = readTableHeader(box, "ctts", 8);
  const entries: CompositionOffsetEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    entries.push({
      sampleCount: reader.u32(),
      sampleOffset: version === 1 ? reader.i32() : reader.u32(),
    });
  }
  return { version, entries };
}

/* ----------------------------------------------------------------- stsc -- */

export interface SampleToChunkEntry {
  /** 1-based. This entry describes every chunk from here to the next entry. */
  readonly firstChunk: number;
  readonly samplesPerChunk: number;
  /** 1-based index into `stsd`. */
  readonly sampleDescriptionIndex: number;
}

/**
 * `stsc` — Sample to Chunk `[BMFF §8.7.4]`.
 *
 *     entry_count u32
 *     per entry: first_chunk u32, samples_per_chunk u32, sample_description_index u32
 *
 * The most error-prone box in the set, for one reason: **the last entry has no
 * terminator.** An entry says "from chunk `first_chunk` onwards", and the run
 * ends where the *next* entry's `first_chunk` begins — except for the last,
 * which runs to the end of the chunk offset table. A reader that walks pairs of
 * entries processes every chunk but the last group's, which on a typical file
 * means the video is complete except for its final seconds. It decodes, it
 * plays, it is just short — the failure mode that gets shipped.
 *
 * Both fields are validated here rather than at the join, because a
 * `first_chunk` of 0 is the signature of a 0-based reading of a 1-based field
 * and it is much cheaper to catch as a malformed box than as an off-by-one in
 * every offset downstream.
 */
export function decodeStsc(box: ParsedBox): readonly SampleToChunkEntry[] {
  const { reader, entryCount } = readTableHeader(box, "stsc", 12);
  const entries: SampleToChunkEntry[] = [];
  let previousFirstChunk = 0;

  for (let i = 0; i < entryCount; i++) {
    const firstChunk = reader.u32();
    const samplesPerChunk = reader.u32();
    const sampleDescriptionIndex = reader.u32();

    if (firstChunk < 1) {
      throw new Error(`stsc entry ${i} has first_chunk ${firstChunk}; chunks are numbered from 1`);
    }
    if (firstChunk <= previousFirstChunk) {
      throw new Error(
        `stsc entry ${i} has first_chunk ${firstChunk} after ${previousFirstChunk}; ` +
          `first_chunk must strictly increase or the runs overlap`,
      );
    }
    previousFirstChunk = firstChunk;
    entries.push({ firstChunk, samplesPerChunk, sampleDescriptionIndex });
  }
  return entries;
}

/* ----------------------------------------------------------------- stsz -- */

export interface SampleSizes {
  readonly sampleCount: number;
  /** Non-zero when every sample is this size and {@link sizes} is absent. */
  readonly uniformSize: number;
  /** One entry per sample, or `undefined` in the uniform form. */
  readonly sizes: Uint32Array | undefined;
}

/**
 * `stsz` — Sample Size `[BMFF §8.7.3]`. Two count-like fields, and they mean
 * different things (research §1.10).
 *
 *     sample_size u32
 *     sample_count u32
 *     per sample (only when sample_size == 0): entry_size u32
 *
 * **A non-zero `sample_size` means the table is not there.** Every sample is
 * that many bytes and the box ends after twelve payload bytes. Uncompressed
 * audio and some CBR encoders write this form. A reader that always walked the
 * table would run straight off the end of the box and read the neighbouring
 * `stco`'s chunk offsets as sample sizes — plausible numbers, catastrophic
 * result — so the two forms are distinguished here and `sizes` is genuinely
 * absent rather than synthesised, to make the distinction impossible to ignore
 * at the call site.
 *
 * `stsz` is also the authority on how many samples the track has. `stts`,
 * `stsc` and `ctts` all state counts of their own and all three are checked
 * against this one at the join.
 */
export function decodeStsz(box: ParsedBox): SampleSizes {
  if (box.type !== "stsz") throw new Error(`Expected an "stsz" box, got "${box.type}"`);

  const reader = new BoxReader(box.payload);
  if (reader.remaining < 12) {
    throw new Error(`"stsz" is ${box.payload.byteLength} payload bytes, too small for its header`);
  }
  reader.u8(); // version
  reader.u24(); // flags
  const uniformSize = reader.u32();
  const sampleCount = reader.u32();

  if (uniformSize !== 0) return { sampleCount, uniformSize, sizes: undefined };

  if (sampleCount * 4 > reader.remaining) {
    throw new Error(
      `"stsz" declares ${sampleCount} samples with a size table but has ${reader.remaining} ` +
        `payload bytes left, enough for ${Math.floor(reader.remaining / 4)}`,
    );
  }
  const sizes = new Uint32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) sizes[i] = reader.u32();
  return { sampleCount, uniformSize, sizes };
}

/* ---------------------------------------------------------- stco / co64 -- */

/**
 * `stco` / `co64` — Chunk Offset `[BMFF §8.7.5]`. Absolute offsets **into the
 * file**, not into `mdat`.
 *
 *     entry_count u32
 *     per entry: chunk_offset u32 (stco) / u64 (co64)
 *
 * They are the same box with two widths, and which one a file uses is not a
 * stylistic choice: past 4 GiB a 32-bit offset cannot address its own chunks,
 * so `co64` is what a long or high-bitrate upload carries. Handling only `stco`
 * works on every test file anyone would hand-make and fails on the real ones,
 * which is the wrong way round — hence one function that takes either.
 *
 * That the offsets are file-absolute is also why relocating `mdat` invalidates
 * them, and why a file with `moov` moved to the front by a "fast start" tool
 * has every one of these rewritten. We only read them, so this is a note rather
 * than a hazard: the offsets are used exactly as found.
 */
export function decodeChunkOffsets(box: ParsedBox): Float64Array {
  const wide = box.type === "co64";
  const { reader, entryCount } = readTableHeader(box, ["stco", "co64"], wide ? 8 : 4);
  const offsets = new Float64Array(entryCount);
  for (let i = 0; i < entryCount; i++) offsets[i] = wide ? reader.u64() : reader.u32();
  return offsets;
}

/* ----------------------------------------------------------------- stss -- */

/**
 * `stss` — Sync Sample `[BMFF §8.6.2]`. **1-based** sample numbers, ascending.
 *
 *     entry_count u32
 *     per entry: sample_number u32
 *
 * Its *absence* is the case worth stating: "if this box is not present, every
 * sample is a sync sample" `[BMFF §8.6.2.1]`, which research §1.10 records for
 * the muxer's benefit and which is a live case here. All-intra footage — ProRes,
 * a screen recording, anything from a hardware capture card — has no `stss`
 * because there is nothing to distinguish. A reader that mapped "no box" onto
 * "no keyframes" would conclude the track had no seek point at all and refuse
 * to start it. So absence is handled at the join, and this function is only
 * reached when the box exists.
 */
export function decodeStss(box: ParsedBox): Uint32Array {
  const { reader, entryCount } = readTableHeader(box, "stss", 4);
  const numbers = new Uint32Array(entryCount);
  for (let i = 0; i < entryCount; i++) {
    const number = reader.u32();
    if (number < 1) {
      throw new Error(`stss entry ${i} is sample number 0; sync samples are numbered from 1`);
    }
    numbers[i] = number;
  }
  return numbers;
}

/* ----------------------------------------------------------------- elst -- */

export interface EditListEntry {
  /** In the **movie** timescale — `mvhd.timescale`, not the track's. */
  readonly segmentDuration: number;
  /** In the **track's media** timescale. `-1` marks an empty edit. */
  readonly mediaTime: number;
  /** The 16.16 `media_rate`, decoded. `1` is normal speed. */
  readonly mediaRate: number;
}

export interface EditList {
  readonly version: number;
  readonly entries: readonly EditListEntry[];
}

/**
 * `elst` — Edit List, inside `edts` `[BMFF §8.6.6]`.
 *
 *     entry_count u32
 *     per entry: segment_duration u64/u32, media_time i64/i32,
 *                media_rate_integer i16, media_rate_fraction i16
 *
 * The two time fields are in **different timescales** — `segment_duration` in
 * the movie's, `media_time` in the track's — which is the same trap `tkhd` and
 * `mdhd` set for the muxer (research §1.6, §10) and is why they are named for
 * their units here.
 *
 * What the demuxer does with this is documented at {@link decodeElst}'s caller
 * in `mp4.ts`: it is reported and not applied. Decoding it is still the
 * prerequisite for saying anything honest about it.
 */
export function decodeElst(box: ParsedBox): EditList {
  // v0 entries are 12 bytes, v1 entries 20. The header check needs the width,
  // and the width needs the version, so the smaller one is used for the guard
  // and the real width is checked as the loop reads.
  const { reader, version, entryCount } = readTableHeader(box, "elst", 12);
  const entryBytes = version === 1 ? 20 : 12;
  if (entryCount * entryBytes > reader.remaining) {
    throw new Error(
      `"elst" version ${version} declares ${entryCount} entries of ${entryBytes} bytes but has ` +
        `${reader.remaining} payload bytes left`,
    );
  }

  const entries: EditListEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const segmentDuration = version === 1 ? reader.u64() : reader.u32();
    const mediaTime = version === 1 ? reader.i64() : reader.i32();
    const mediaRate = reader.i16() + reader.i16() / 0x1_0000;
    entries.push({ segmentDuration, mediaTime, mediaRate });
  }
  return { version, entries };
}

/* ------------------------------------------------------------- the join -- */

export interface SampleTable {
  readonly sampleCount: number;
  /** Absolute byte offset in the file, per sample, in decode order. */
  readonly offsets: Float64Array;
  readonly sizes: Uint32Array;
  /** Cumulative decode time from 0, in the track's own timescale. */
  readonly decodeTimes: Float64Array;
  /** The `stts` delta, in the track's own timescale. */
  readonly durations: Uint32Array;
  /**
   * Composition offsets, in the track's own timescale, or `undefined` when the
   * track has no `ctts` — which is the ordinary case and means decode order is
   * presentation order.
   *
   * `Float64Array` rather than `Int32Array`, and the reason is the version
   * split {@link decodeCtts} exists to honour. A version-1 offset is `i32` and
   * fits. A version-0 offset is **u32**, and its top half does not: an offset
   * of `0x80000000` lands in an `Int32Array` as −2,147,483,648, turning a frame
   * that should be presented far in the future into one presented far in the
   * past. Storing both in a float keeps every legal value of either version
   * exactly — u32 and i32 are both well inside 2^53 — instead of picking one
   * version's width and silently corrupting the other's.
   */
  readonly compositionOffsets: Float64Array | undefined;
  /**
   * 1 per sync sample, or `undefined` when there was no `stss` — which means
   * **every** sample is one. Use {@link isSyncSample} rather than reading this,
   * so the absent case cannot be read as the empty case.
   */
  readonly syncFlags: Uint8Array | undefined;
  /** The single `stsd` entry every chunk referenced, 1-based. */
  readonly sampleDescriptionIndex: number;
  /** Σ durations, in the track's own timescale. */
  readonly totalDuration: number;
}

/** Whether sample `index` may be decoded from cold. Absent `stss` ⇒ all of them. */
export function isSyncSample(table: SampleTable, index: number): boolean {
  return table.syncFlags === undefined || table.syncFlags[index] === 1;
}

function child(stbl: ParsedBox, type: string): ParsedBox | undefined {
  return stbl.children.find((box) => box.type === type);
}

/**
 * Joins `stbl`'s tables into one sample per row.
 *
 * The order of work is forced by the data: chunk offsets and `stsc` give every
 * sample a *position*, `stsz` gives it a *size* (and the position of the next
 * sample in the same chunk), `stts` gives it a *time*, `ctts` shifts that time,
 * and `stss` marks it. Only the first two are coupled — a sample's offset is
 * its chunk's offset plus the sizes of the samples before it *in that chunk*,
 * which is why sizes are resolved before offsets rather than beside them.
 *
 * Every count is cross-checked against `stsz.sample_count`, in both directions
 * where both are recoverable. A table that disagrees with itself is a table
 * where some samples would be silently dropped or silently invented, and this
 * is the last point at which that is visible as a contradiction rather than as
 * a shorter video.
 */
export function buildSampleTable(stbl: ParsedBox): SampleTable {
  if (stbl.type !== "stbl") throw new Error(`Expected an "stbl" box, got "${stbl.type}"`);

  const stszBox = child(stbl, "stsz");
  if (stszBox === undefined) {
    throw new Error("This track's stbl has no stsz; there is no way to size its samples");
  }
  const stscBox = child(stbl, "stsc");
  if (stscBox === undefined) {
    throw new Error("This track's stbl has no stsc; there is no way to group its samples");
  }
  const chunkOffsetBox = child(stbl, "stco") ?? child(stbl, "co64");
  if (chunkOffsetBox === undefined) {
    throw new Error("This track's stbl has no stco or co64; there is no way to locate its chunks");
  }
  const sttsBox = child(stbl, "stts");
  if (sttsBox === undefined) {
    throw new Error("This track's stbl has no stts; there is no way to time its samples");
  }

  const { sampleCount, uniformSize, sizes: sizeTable } = decodeStsz(stszBox);
  const chunkOffsets = decodeChunkOffsets(chunkOffsetBox);
  const stscEntries = decodeStsc(stscBox);

  const sizes = sizeTable ?? new Uint32Array(sampleCount).fill(uniformSize);
  const offsets = new Float64Array(sampleCount);

  /* ---- chunks ---- */

  if (sampleCount > 0 && stscEntries.length === 0) {
    throw new Error(`stsc is empty but stsz declares ${sampleCount} samples`);
  }
  const firstEntry = stscEntries[0];
  if (firstEntry !== undefined && firstEntry.firstChunk !== 1) {
    throw new Error(
      `stsc starts at chunk ${firstEntry.firstChunk}; chunks 1..${firstEntry.firstChunk - 1} ` +
        `would hold samples no entry describes`,
    );
  }

  const sampleDescriptionIndex = firstEntry?.sampleDescriptionIndex ?? 1;
  let written = 0;

  for (const [index, entry] of stscEntries.entries()) {
    if (entry.sampleDescriptionIndex !== sampleDescriptionIndex) {
      throw new Error(
        `stsc entry ${index} uses sample_description_index ${entry.sampleDescriptionIndex} ` +
          `where earlier chunks used ${sampleDescriptionIndex}; this demuxer reads one stsd ` +
          `entry per track, and switching mid-track would need a second decoder config`,
      );
    }
    // The off-by-one this box is famous for: the run ends at the next entry's
    // `first_chunk`, and the **last** entry has no next — it runs to the end of
    // the chunk offset table.
    const nextFirstChunk = stscEntries[index + 1]?.firstChunk ?? chunkOffsets.length + 1;
    if (nextFirstChunk > chunkOffsets.length + 1) {
      throw new Error(
        `stsc entry ${index + 1} starts at chunk ${nextFirstChunk} but the file has only ` +
          `${chunkOffsets.length} chunks`,
      );
    }

    for (let chunk = entry.firstChunk; chunk < nextFirstChunk && written < sampleCount; chunk++) {
      let at = chunkOffsets[chunk - 1] ?? 0;
      for (let i = 0; i < entry.samplesPerChunk; i++) {
        // A final chunk may be partly filled: an interleaver that writes three
        // samples a chunk and has eight to place leaves the last holding two,
        // and `stsc` still says three. `stsz.sample_count` is the authority, so
        // the surplus is dropped rather than read from beyond the table.
        if (written >= sampleCount) break;
        offsets[written] = at;
        at += sizes[written] ?? 0;
        written++;
      }
    }
  }

  if (written !== sampleCount) {
    throw new Error(
      `stsc and stco chunks describe ${written} samples but stsz declares ${sampleCount}; ` +
        `${sampleCount - written} samples have no chunk to live in and no offset to read from`,
    );
  }

  /* ---- times ---- */

  /**
   * The run counts are summed and compared *before* the table is expanded.
   *
   * The expansion loop stops at `sampleCount`, so it can only ever detect a
   * table that describes too **few** samples. A table describing too many —
   * `stsz.sample_count` of 1 against an `stts` run of 2 — filled the arrays
   * exactly, left `sample === sampleCount`, and passed. The contradiction
   * disappeared silently, taking a real sample's timing with it, and every
   * downstream calculation then worked from a track one frame shorter than the
   * file says it is.
   *
   * Both directions are a malformed file, and neither should be guessed at.
   */
  const sttsEntries = decodeStts(sttsBox);
  const sttsTotal = sttsEntries.reduce((sum, entry) => sum + entry.sampleCount, 0);
  if (sttsTotal !== sampleCount) {
    throw new Error(
      `stts describes ${sttsTotal} samples but stsz declares ${sampleCount}`,
    );
  }

  const durations = new Uint32Array(sampleCount);
  const decodeTimes = new Float64Array(sampleCount);
  let sample = 0;
  let clock = 0;
  for (const entry of sttsEntries) {
    for (let i = 0; i < entry.sampleCount && sample < sampleCount; i++) {
      decodeTimes[sample] = clock;
      durations[sample] = entry.sampleDelta;
      clock += entry.sampleDelta;
      sample++;
    }
  }

  /* ---- composition offsets ---- */

  const cttsBox = child(stbl, "ctts");
  let compositionOffsets: Float64Array | undefined;
  if (cttsBox !== undefined) {
    // Summed first, for the same reason as `stts` above: the expansion loop
    // can only notice a table that is short.
    const cttsEntries = decodeCtts(cttsBox).entries;
    const cttsTotal = cttsEntries.reduce((sum, entry) => sum + entry.sampleCount, 0);
    if (cttsTotal !== sampleCount) {
      throw new Error(
        `ctts describes ${cttsTotal} samples but stsz declares ${sampleCount}`,
      );
    }

    compositionOffsets = new Float64Array(sampleCount);
    let at = 0;
    for (const entry of cttsEntries) {
      for (let i = 0; i < entry.sampleCount && at < sampleCount; i++) {
        compositionOffsets[at] = entry.sampleOffset;
        at++;
      }
    }
  }

  /* ---- sync samples ---- */

  const stssBox = child(stbl, "stss");
  let syncFlags: Uint8Array | undefined;
  if (stssBox !== undefined) {
    syncFlags = new Uint8Array(sampleCount);
    for (const number of decodeStss(stssBox)) {
      if (number > sampleCount) {
        throw new Error(`stss names sample ${number} but the track has ${sampleCount}`);
      }
      syncFlags[number - 1] = 1;
    }
  }

  return {
    sampleCount,
    offsets,
    sizes,
    decodeTimes,
    durations,
    compositionOffsets,
    syncFlags,
    sampleDescriptionIndex,
    totalDuration: clock,
  };
}
