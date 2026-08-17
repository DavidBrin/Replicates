/**
 * A progressive MP4 demuxer: a `File` in, `TrackConfig` + `EncodedSample`s out.
 *
 * ## Why this exists at all
 *
 * WebCodecs decodes; it does not demux. `research/01-webcodecs-encode.md` §9.2
 * states the consequence plainly — to feed a `VideoDecoder` from a file the user
 * picked, *something* has to parse the container, find the codec configuration
 * record, and cut `mdat` into per-sample chunks. Without that, the only way to
 * get frames out of a file in a browser is `MediaStreamTrackProcessor` over a
 * `<video>`'s `captureStream()`, which delivers frames **at playback rate**: a
 * ten-minute upload takes ten minutes before a single encoder has finished
 * (§9.1). `decode-source.ts` implements both paths and says so.
 *
 * This is the other path. Push chunks as fast as they can be read, and the
 * pipeline runs as fast as the codecs allow rather than as fast as the video
 * plays. That is the difference between "encoding, about 40 seconds" and
 * "encoding, this will take about as long as your video", and it is the whole
 * reason a demuxer is worth writing by hand.
 *
 * ## Why by hand
 *
 * `mp4box.js` and `web-demuxer` are the usual answers and both are dependencies
 * this project does not take (`DECISIONS.md` D4, on the muxer, for the same
 * reasons). More to the point, the reciprocal already exists here: `src/media/
 * muxer` writes fMP4 and ships a strict box parser to read its own output back.
 * A demuxer is that parser plus `stbl`, and `stbl` is the only genuinely new
 * work — see `sample-table.ts`, which is where it lives.
 *
 * ## Streaming, not slurping
 *
 * The input is a {@link ByteSource}, not an `ArrayBuffer`. A user's upload is
 * routinely a gigabyte and `blob.arrayBuffer()` on a gigabyte is a tab that
 * dies before it has parsed a box. So: read sixteen bytes to walk the top-level
 * boxes, read `moov` whole because the sample tables are not optional, and then
 * read sample bytes in bounded runs as they are consumed.
 *
 * **`moov` is located by walking, never by position.** A file prepared for
 * streaming has `moov` before `mdat`; everything else — anything a camera, a
 * phone or a plain encoder wrote — has it at the *end*, because its size is not
 * known until the last sample is written. Assuming position two works on files
 * that have already been through a "fast start" pass and on nothing else.
 *
 * ## What comes out
 *
 * `EncodedSample`s in **decode order**, carrying **presentation** timestamps —
 * the two are different whenever `ctts` is present, and both are needed. A
 * decoder wants them in decode order and reorders internally using
 * `EncodedVideoChunk.timestamp`, which WebCodecs defines as the presentation
 * time. A muxer re-writing them wants the decode time back, which is
 * `timestampUs - compositionOffsetUs`. Carrying both facts is what makes the
 * demuxer → decoder → encoder → muxer round trip lossless in time.
 */

import type { EncodedSample, TrackConfig, TrackKind } from "../types";
import {
  BoxReader,
  parseBoxes,
  parseAudioSampleEntry,
  parseHdlr,
  parseMdhd,
  parseMvhd,
  parseTkhd,
  parseVisualSampleEntry,
  readBoxHeader,
  type ParsedBox,
} from "../muxer/parser";

import { buildSampleTable, decodeElst, isSyncSample, type EditList, type SampleTable } from "./sample-table";

/* --------------------------------------------------------------- errors -- */

/** Every failure in this module, so a caller can tell a bad file from a bug. */
export class Mp4DemuxError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "Mp4DemuxError";
    this.cause = cause;
  }
}

/* ---------------------------------------------------------- byte sources -- */

/**
 * Random access over bytes we decline to hold all of.
 *
 * A port rather than a `Blob` parameter for the usual two reasons: the tests can
 * drive it from a `Uint8Array` without arranging a `Blob`, and a future caller
 * with an HTTP range-request source plugs in without this file changing. The
 * `Blob` adapter is right below, and {@link openMp4} accepts either.
 */
export interface ByteSource {
  readonly byteLength: number;
  /** `[start, end)`. Must resolve to exactly `end - start` bytes or throw. */
  read(start: number, end: number): Promise<Uint8Array>;
}

/** The real one: a `File` from an `<input>`, read by range. */
export function byteSourceFromBlob(blob: Blob): ByteSource {
  return {
    byteLength: blob.size,
    async read(start, end) {
      const slice = blob.slice(start, end);
      return new Uint8Array(await slice.arrayBuffer());
    },
  };
}

/** For bytes already in memory — a small file, or a fixture. */
export function byteSourceFromBytes(bytes: Uint8Array): ByteSource {
  return {
    byteLength: bytes.byteLength,
    read(start, end) {
      return Promise.resolve(bytes.subarray(start, end));
    },
  };
}

/**
 * Duck-typed rather than `instanceof Blob`: a `File` from another realm — an
 * iframe, a worker's structured clone — fails the `instanceof` and is a
 * perfectly good `Blob`.
 */
function isByteSource(source: Blob | ByteSource): source is ByteSource {
  return typeof (source as Partial<ByteSource>).read === "function";
}

function toByteSource(source: Blob | ByteSource): ByteSource {
  return isByteSource(source) ? source : byteSourceFromBlob(source);
}

/* ------------------------------------------------------------ box layout -- */

/**
 * Containers the muxer's parser does not know, because the muxer never writes
 * them.
 *
 * `parseBoxes` takes these per call rather than having them added to its own
 * table, which keeps its default set exactly "what this muxer emits" — the
 * property its header argues for. The numbers are payload bytes before the
 * children start, same as there: 0 for a pure container, 78 for the fixed
 * `VisualSampleEntry` body (research §2.1).
 *
 * `avc3`/`hev1` are the in-band-parameter-set variants of `avc1`/`hvc1`; the
 * sample entry layout is identical and only the bitstream convention differs,
 * which is the decoder's problem rather than ours.
 */
const DEMUX_CONTAINERS: ReadonlyMap<string, number> = new Map([
  ["edts", 0],
  ["avc3", 78],
  ["hvc1", 78],
  ["hev1", 78],
  ["vp08", 78],
]);

/**
 * A `moov` bigger than this is refused rather than read.
 *
 * The sample tables scale with the sample count, so a long track has a large
 * `moov` — a two-hour 30fps video runs to a few megabytes of `stsz` and `stco`
 * alone. 256 MiB is far past any real file and is here as a bound on what a
 * corrupt size field can make us allocate, not as a considered ceiling on
 * legitimate content. **Assumed, not measured.**
 */
const MAX_MOOV_BYTES = 256 * 1024 * 1024;

/** Enough top-level boxes for any real file; a bound on a pathological walk. */
const MAX_TOP_LEVEL_BOXES = 4096;

/**
 * How many bytes one sample read may pull, and how large a gap it will read
 * across to avoid a second round trip.
 *
 * Both matter because chunk sizes vary enormously between files: some
 * interleave a second of audio per chunk, some write one *sample* per chunk, and
 * in the second case a reader that issued one range per sample would make a
 * hundred thousand of them for a ten-minute video. Reading across a small gap
 * wastes a little bandwidth and saves a round trip.
 *
 * **Both numbers are assumed, not measured.** The honest experiment needs a real
 * file in a real browser with the network panel open, which this slice cannot
 * run. They are deliberately modest so that being wrong costs throughput rather
 * than memory.
 */
const SAMPLE_READ_BUDGET = 4 * 1024 * 1024;
const MAX_COALESCED_GAP = 256 * 1024;

/* ------------------------------------------------------------------ time -- */

/**
 * Timescale units to microseconds — the inverse of the muxer's
 * `microsecondsToTimescale`, and the only place this module converts.
 *
 * Written as whole seconds plus a remainder rather than as `units * 1e6 /
 * timescale`, because the obvious form overflows. At the recommended 1e6 video
 * timescale (research §5.1), `units * 1e6` passes 2^53 after about 2.5 hours of
 * media — inside the range of real uploads, and the failure is a timestamp that
 * is quietly wrong rather than an error. Splitting keeps every intermediate
 * under `timescale × 1e6` regardless of how long the file is.
 *
 * Negative values are real: a version-1 `ctts` can put a sample's composition
 * time before its decode time, so the sign is taken out and put back rather
 * than left to `Math.floor`, which rounds toward −∞ and would shift the whole
 * conversion by a tick for negative inputs.
 */
export function unitsToMicroseconds(units: number, timescale: number): number {
  if (!Number.isFinite(units) || !Number.isInteger(timescale) || timescale <= 0) {
    throw new Mp4DemuxError(`Cannot convert ${units} units at a timescale of ${timescale}`);
  }
  if (timescale > Number.MAX_SAFE_INTEGER / 1_000_000) {
    throw new Mp4DemuxError(`A timescale of ${timescale} cannot be converted without losing precision`);
  }
  if (timescale === 1_000_000) return Math.round(units);

  const sign = units < 0 ? -1 : 1;
  const magnitude = Math.abs(units);
  const seconds = Math.floor(magnitude / timescale);
  const remainder = magnitude - seconds * timescale;
  if (!Number.isSafeInteger(seconds * 1_000_000)) {
    throw new Mp4DemuxError(`${units} units at timescale ${timescale} exceeds 2^53 microseconds`);
  }
  return sign * (seconds * 1_000_000 + Math.round((remainder * 1_000_000) / timescale));
}

/**
 * The inverse, for the one value that arrives in microseconds and has to be
 * added to numbers in a track's own timescale: the edit-list shift.
 *
 * Split the same way and for the same reason — `microseconds × timescale`
 * overflows 2^53 for a long file at a fine timescale, and the whole point of
 * doing it in two parts is that neither part ever gets that large. The sign is
 * taken out and put back because an edit shift is legitimately negative when a
 * track's first edit trims its opening samples, and `Math.floor` on a negative
 * would bias the result by a tick.
 */
export function microsecondsToUnits(microseconds: number, timescale: number): number {
  if (!Number.isFinite(microseconds) || !Number.isInteger(timescale) || timescale <= 0) {
    throw new Mp4DemuxError(
      `Cannot convert ${microseconds}µs to a timescale of ${timescale}`,
    );
  }
  if (timescale === 1_000_000) return Math.round(microseconds);

  const sign = microseconds < 0 ? -1 : 1;
  const magnitude = Math.abs(microseconds);
  const seconds = Math.floor(magnitude / 1_000_000);
  const remainder = magnitude - seconds * 1_000_000;
  if (!Number.isSafeInteger(seconds * timescale)) {
    throw new Mp4DemuxError(
      `${microseconds}µs at timescale ${timescale} exceeds 2^53 units`,
    );
  }
  return sign * (seconds * timescale + Math.round((remainder * timescale) / 1_000_000));
}

/* ------------------------------------------------------------ edit lists -- */

/**
 * What the file's `elst` asks for, and the statement that we did not do it.
 *
 * ## This demuxer applies the reducible part, and says when it could not
 *
 * It used to apply nothing, and hand the caller two numbers with
 * `applied: false` so that acting on them was a decision. That is the right
 * shape for a library and it was the wrong shape here, for a reason nothing in
 * the type could show: **no caller ever read the field.** The transcode path
 * consumes `samples()` and nothing else, so the offset was computed on every
 * file that had one and discarded on every file that had one.
 *
 * The cost is not exotic. A leading empty edit (`media_time == -1`) is how a
 * track says "start me late", and every AAC track an Apple encoder writes
 * carries one to hide priming delay. Dropping it puts the audio ahead of the
 * video by the declared amount, for the whole file, on exactly the recordings
 * a phone produces.
 *
 * So `samples()` now shifts by {@link presentationOffsetUs}, trims before
 * {@link startTrimUs}, and reports {@link applied} accordingly. `false` means
 * the list is a genuine edit decision list — several real segments, cutting
 * the track into pieces — which cannot be reduced to an offset at all. That
 * case is still described rather than approximated, because a wrong
 * reconstruction is worse than an unhandled one.
 */
export interface EditListNotice extends EditList {
  /**
   * Whether `samples()` honoured this list.
   *
   * `true` for the reducible shapes: any number of leading empty edits, plus
   * at most one real edit. `false` for a multi-segment edit decision list,
   * where the two numbers below describe only the beginning and the rest is
   * the caller's problem to notice.
   */
  readonly applied: boolean;
  /**
   * How far the edit list would push this track's presentation, in microseconds
   * — the total duration of its leading empty edits.
   */
  readonly presentationOffsetUs: number;
  /**
   * Media time the first real edit starts at, in microseconds. Non-zero means
   * the file is asking for its own opening samples to be discarded.
   */
  readonly startTrimUs: number;
}

/**
 * Reduces an edit list to the two numbers `samples()` acts on.
 *
 * Only the leading empty edits and the first real edit are interpreted, so
 * `applied` is true exactly when there is nothing after that first real edit.
 * A list with several real segments is a genuine edit decision list, cannot be
 * reduced to an offset, and is reported unapplied.
 */
function summariseEditList(list: EditList, mediaTimescale: number, movieTimescale: number): EditListNotice {
  let presentationOffset = 0;
  let startTrimUs = 0;

  for (const entry of list.entries) {
    if (entry.mediaTime < 0) {
      // An empty edit: `segment_duration` of blank presentation, in the MOVIE
      // timescale — not the track's. Reading it in the track's is the same
      // silent mis-scaling `tkhd`/`mdhd` set up for the muxer (research §10).
      presentationOffset += unitsToMicroseconds(entry.segmentDuration, movieTimescale);
      continue;
    }
    startTrimUs = unitsToMicroseconds(entry.mediaTime, mediaTimescale);
    break;
  }

  // Reducible when at most one real edit exists: the empty ones compose into
  // the offset, and one real one composes into the trim. Two or more real
  // edits describe a timeline this cannot express.
  const realEdits = list.entries.filter((entry) => entry.mediaTime >= 0).length;

  return {
    ...list,
    applied: realEdits <= 1,
    presentationOffsetUs: presentationOffset,
    startTrimUs,
  };
}

/* --------------------------------------------------- codec configuration -- */

function hex(byte: number): string {
  return byte.toString(16).padStart(2, "0");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/**
 * The MPEG-4 expandable descriptor length: seven bits per byte, top bit means
 * "another follows" (research §2.4 describes the fixed 4-byte form the muxer
 * writes; real files use the minimal form, so both are read here).
 */
function readDescriptorLength(reader: BoxReader): number {
  let length = 0;
  for (let i = 0; i < 4; i++) {
    const byte = reader.u8();
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return length;
  }
  return length;
}

interface AudioSpecificConfigRecord {
  readonly objectTypeIndication: number;
  readonly config: Uint8Array;
}

/**
 * Digs the `AudioSpecificConfig` out of an `esds`.
 *
 * The nest is `ES_Descr(0x03) → DecoderConfigDescr(0x04) → DecSpecificInfo
 * (0x05)`, and the payload of that last one is exactly what WebCodecs' encoder
 * hands back as `decoderConfig.description` and what the muxer's `writeEsds`
 * takes (research §2.4). So this is the precise inverse of that function, and
 * the round trip through both is a byte-for-byte identity — which is what the
 * roundtrip suite asserts rather than assumes.
 *
 * `ES_Descr`'s three conditional fields are the part a shortcut gets wrong: the
 * flags byte can be followed by a stream dependency, a URL, or an OCR stream,
 * and skipping a fixed three bytes lands mid-descriptor on any file that uses
 * them.
 */
function parseEsds(box: ParsedBox): AudioSpecificConfigRecord {
  const reader = new BoxReader(box.payload);
  reader.u8(); // version
  reader.u24(); // flags

  if (reader.u8() !== 0x03) {
    throw new Mp4DemuxError("esds does not begin with an ES_Descriptor (tag 0x03)");
  }
  readDescriptorLength(reader);
  reader.u16(); // ES_ID
  const flags = reader.u8();
  if (flags & 0x80) reader.u16(); // dependsOn_ES_ID
  if (flags & 0x40) reader.skip(reader.u8()); // URL, length-prefixed
  if (flags & 0x20) reader.u16(); // OCR_ES_Id

  if (reader.u8() !== 0x04) {
    throw new Mp4DemuxError("esds has no DecoderConfigDescriptor (tag 0x04)");
  }
  readDescriptorLength(reader);
  const objectTypeIndication = reader.u8();
  reader.u8(); // streamType / upStream / reserved
  reader.u24(); // bufferSizeDB
  reader.u32(); // maxBitrate
  reader.u32(); // avgBitrate

  if (reader.remaining < 2 || reader.u8() !== 0x05) {
    throw new Mp4DemuxError(
      "esds has no DecSpecificInfo (tag 0x05); the AudioSpecificConfig a decoder needs is not in this file",
    );
  }
  const length = readDescriptorLength(reader);
  if (length > reader.remaining) {
    throw new Mp4DemuxError(`esds DecSpecificInfo declares ${length} bytes, past the end of the box`);
  }
  const start = box.payload.byteOffset + reader.offset;
  return {
    objectTypeIndication,
    config: new Uint8Array(box.payload.buffer.slice(start, start + length)),
  };
}

/** The codec configuration box a sample entry must carry, by entry type. */
const CONFIG_BOX_BY_ENTRY: ReadonlyMap<string, string> = new Map([
  ["avc1", "avcC"],
  ["avc3", "avcC"],
  ["hvc1", "hvcC"],
  ["hev1", "hvcC"],
  ["vp08", "vpcC"],
  ["vp09", "vpcC"],
  ["av01", "av1C"],
  ["mp4a", "esds"],
]);

interface CodecDescription {
  readonly codec: string;
  readonly description: Uint8Array;
}

function copyOf(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * The RFC 6381 codec string and the decoder configuration record, from a
 * sample entry.
 *
 * The string formats are research §7.1.1's, which covers `avc1`, `vp09`, `av01`
 * and `mp4a` — the four the muxer writes. HEVC is the one that is *not* in that
 * table and is here anyway, because a phone's camera roll is HEVC and refusing
 * it would refuse the single most common upload after H.264. Its construction is
 * transcribed from ISO/IEC 14496-15 Annex E and RFC 6381 §3.3, and unlike every
 * other layout in this directory it has **no corroborating source inside this
 * repository and has not been checked against real footage here.** That is
 * stated rather than smoothed over: if an iPhone file is rejected by
 * `VideoDecoder.isConfigSupported`, this string is the first thing to doubt.
 * The `hvcC` bytes it sits beside are copied verbatim and are not in doubt.
 */
function readCodecDescription(entry: ParsedBox): CodecDescription {
  const wanted = CONFIG_BOX_BY_ENTRY.get(entry.type);
  if (wanted === undefined) {
    throw new Mp4DemuxError(
      `Sample entry "${entry.type}" is not one this demuxer reads (avc1, avc3, hvc1, hev1, ` +
        `vp08, vp09, av01, mp4a). Its samples cannot be decoded without knowing its configuration record.`,
    );
  }
  const configBox = entry.children.find((box) => box.type === wanted);
  if (configBox === undefined) {
    throw new Mp4DemuxError(
      `Sample entry "${entry.type}" carries no "${wanted}" box, so this track has no decoder ` +
        `configuration record. A stream cannot be decoded from the bitstream alone here.`,
    );
  }

  switch (entry.type) {
    case "avc1":
    case "avc3": {
      // "avc1." + the three bytes profile_idc, constraint flags, level_idc,
      // read straight out of avcC (research §7.1.1, RFC 6381 §3.3).
      const record = configBox.payload;
      if (record.byteLength < 4) {
        throw new Mp4DemuxError(`avcC is ${record.byteLength} bytes, too short to name a profile`);
      }
      const codec = `${entry.type}.${hex(record[1] ?? 0)}${hex(record[2] ?? 0)}${hex(record[3] ?? 0)}`;
      return { codec, description: copyOf(record) };
    }

    case "hvc1":
    case "hev1":
      return { codec: hevcCodecString(entry.type, configBox), description: copyOf(configBox.payload) };

    case "vp08":
    case "vp09": {
      // `vpcC` is a FullBox v1; the record proper starts after version/flags,
      // and that is also exactly what the muxer's `writeVpcC` writes from
      // `TrackConfig.description`. So the description round-trips.
      const record = configBox.payload.subarray(4);
      if (record.byteLength < 3) {
        throw new Mp4DemuxError(`vpcC body is ${record.byteLength} bytes, too short to read`);
      }
      const profile = record[0] ?? 0;
      const level = record[1] ?? 0;
      const bitDepth = (record[2] ?? 0) >> 4;
      return {
        codec: `${entry.type}.${pad2(profile)}.${pad2(level)}.${pad2(bitDepth)}`,
        description: copyOf(record),
      };
    }

    case "av01": {
      // `av01.P.LLT.DD` (research §7.1.1). The fields are bit-packed into
      // av1C's second and third bytes; none of them is derivable from anywhere
      // else, which is the point research §2.3 makes at length.
      const record = configBox.payload;
      if (record.byteLength < 4) {
        throw new Mp4DemuxError(`av1C is ${record.byteLength} bytes, too short to read`);
      }
      const second = record[1] ?? 0;
      const third = record[2] ?? 0;
      const seqProfile = second >> 5;
      const seqLevelIdx = second & 0x1f;
      const tier = (third & 0x80) !== 0 ? "H" : "M";
      const highBitDepth = (third & 0x40) !== 0;
      const twelveBit = (third & 0x20) !== 0;
      const bitDepth = seqProfile === 2 && highBitDepth ? (twelveBit ? 12 : 10) : highBitDepth ? 10 : 8;
      return {
        codec: `av01.${seqProfile}.${pad2(seqLevelIdx)}${tier}.${pad2(bitDepth)}`,
        description: copyOf(record),
      };
    }

    case "mp4a": {
      const { objectTypeIndication, config } = parseEsds(configBox);
      if (objectTypeIndication !== 0x40) {
        // 0x40 is MPEG-4 Audio. Anything else here is MP3 (0x6b), MPEG-2 AAC
        // (0x67) or something rarer, and the `.AOT` suffix does not apply.
        return { codec: `mp4a.${hex(objectTypeIndication)}`, description: config };
      }
      const first = config[0] ?? 0;
      let audioObjectType = first >> 3;
      if (audioObjectType === 31) {
        // The escape: 5 bits of 31, then 6 more encoding AOT − 32
        // (research §2.4's AudioSpecificConfig layout).
        const second = config[1] ?? 0;
        audioObjectType = 32 + (((first & 0x07) << 3) | (second >> 5));
      }
      return { codec: `mp4a.40.${audioObjectType}`, description: config };
    }

    default:
      throw new Mp4DemuxError(`Sample entry "${entry.type}" has no codec string rule`);
  }
}

/**
 * `hvc1.` / `hev1.` + profile space and idc, reversed compatibility flags,
 * tier and level, then the constraint bytes with trailing zeroes dropped —
 * e.g. `hvc1.1.6.L93.B0`.
 *
 * The compatibility flags are printed **bit-reversed**, which is the one part
 * nobody guesses: the record stores them MSB-first and RFC 6381 asks for them
 * in the opposite order, so the familiar `0x60000000` becomes `6`.
 *
 * `HEVCDecoderConfigurationRecord` layout `[ISO14496-15 §8.3.3.1]`:
 *
 *     configurationVersion u8
 *     general_profile_space(2) general_tier_flag(1) general_profile_idc(5)
 *     general_profile_compatibility_flags u32
 *     general_constraint_indicator_flags 6 bytes
 *     general_level_idc u8
 */
function hevcCodecString(entryType: string, hvcC: ParsedBox): string {
  const record = hvcC.payload;
  if (record.byteLength < 13) {
    throw new Mp4DemuxError(`hvcC is ${record.byteLength} bytes, too short to name a profile`);
  }
  const packed = record[1] ?? 0;
  const profileSpace = packed >> 6;
  const tier = (packed & 0x20) !== 0 ? "H" : "L";
  const profileIdc = packed & 0x1f;

  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  const flags = view.getUint32(2);
  let reversed = 0;
  for (let bit = 0; bit < 32; bit++) reversed = (reversed << 1) | ((flags >>> bit) & 1);

  // Uppercase, and trailing zero bytes dropped: `…L93.B0`, never `…L93.b0.00`.
  // Browsers parse these case-insensitively, but the canonical form is what
  // gets compared against `MediaSource.isTypeSupported` strings by hand.
  const constraints: string[] = [];
  for (let i = 0; i < 6; i++) constraints.push(hex(record[6 + i] ?? 0).toUpperCase());
  while (constraints.length > 0 && constraints.at(-1) === "00") constraints.pop();

  const space = ["", "A", "B", "C"][profileSpace] ?? "";
  const level = record[12] ?? 0;
  return [
    `${entryType}.${space}${profileIdc}`,
    (reversed >>> 0).toString(16),
    `${tier}${level}`,
    ...constraints,
  ].join(".");
}

/* ---------------------------------------------------------------- tracks -- */

export interface SampleReadOptions {
  readonly signal?: AbortSignal;
}

/** A track the demuxer read past but will not produce samples for, and why. */
export interface SkippedTrack {
  readonly id: number;
  readonly handlerType: string;
  readonly reason: string;
}

/**
 * One readable track: its `TrackConfig`, and its samples on demand.
 *
 * The sample *index* is built at open time and held; the sample *bytes* are not.
 * That split is the whole streaming story — the index for a two-hour track is a
 * couple of megabytes of typed arrays, and the bytes are the gigabyte we decline
 * to hold.
 */
export class DemuxedTrack {
  readonly id: number;
  readonly kind: TrackKind;
  readonly config: TrackConfig;
  readonly editList: EditListNotice | undefined;

  readonly #source: ByteSource;
  readonly #table: SampleTable;

  constructor(options: {
    id: number;
    kind: TrackKind;
    config: TrackConfig;
    editList: EditListNotice | undefined;
    source: ByteSource;
    table: SampleTable;
  }) {
    this.id = options.id;
    this.kind = options.kind;
    this.config = options.config;
    this.editList = options.editList;
    this.#source = options.source;
    this.#table = options.table;
  }

  get sampleCount(): number {
    return this.#table.sampleCount;
  }

  /** Σ the `stts` deltas, converted. The media's own length, before any edit. */
  get durationUs(): number {
    return unitsToMicroseconds(this.#table.totalDuration, this.config.timescale);
  }

  /** The decoded index, for callers that want to seek or measure before reading. */
  get sampleTable(): SampleTable {
    return this.#table;
  }

  /**
   * Every sample, in decode order, reading the file in bounded runs.
   *
   * Samples in one chunk are contiguous by construction, so a run is usually a
   * whole chunk or several; the budget caps how much is in flight and the gap
   * limit decides when to bridge two chunks rather than issue a second read.
   * Neither affects what comes out, only how many reads produce it.
   */
  async *samples(options: SampleReadOptions = {}): AsyncGenerator<EncodedSample, void, void> {
    const { offsets, sizes, decodeTimes, durations, compositionOffsets } = this.#table;
    const { timescale } = this.config;
    const total = this.#table.sampleCount;

    /**
     * The edit list as a single signed shift, in this track's own timescale.
     *
     * A leading empty edit moves presentation *later* by its duration; a first
     * real edit whose `media_time` is past zero moves it *earlier*, because
     * the samples before that point are being discarded. They compose, and one
     * addition applies both. A sample that lands before zero after the shift
     * is one the edit asked to drop, and is skipped in the loop below.
     */
    const edit = this.editList;
    const editShiftUnits =
      edit === undefined
        ? 0
        : microsecondsToUnits(edit.presentationOffsetUs - edit.startTrimUs, timescale);

    let index = 0;
    while (index < total) {
      const runStart = offsets[index] ?? 0;
      let runEnd = runStart + (sizes[index] ?? 0);
      let last = index;

      while (last + 1 < total) {
        const nextStart = offsets[last + 1] ?? 0;
        const nextEnd = nextStart + (sizes[last + 1] ?? 0);
        // Chunks need not be in file order, and a backwards step ends the run
        // rather than growing it into a read that spans the whole file.
        if (nextStart < runEnd) break;
        if (nextStart - runEnd > MAX_COALESCED_GAP) break;
        if (nextEnd - runStart > SAMPLE_READ_BUDGET) break;
        runEnd = nextEnd;
        last++;
      }

      const bytes = await this.#source.read(runStart, runEnd);
      if (bytes.byteLength !== runEnd - runStart) {
        throw new Mp4DemuxError(
          `Read of [${runStart}, ${runEnd}) returned ${bytes.byteLength} bytes; the file is shorter than its sample table says`,
        );
      }

      for (let at = index; at <= last; at++) {
        // Checked per sample, not per read. A read run can be thousands of
        // samples at a 4 MiB budget, and an abort that only took effect at the
        // next range request would be an abort the caller could not feel.
        if (options.signal?.aborted) {
          throw new Mp4DemuxError(`Demux of track ${this.id} aborted after ${at} samples`);
        }
        const start = (offsets[at] ?? 0) - runStart;
        const size = sizes[at] ?? 0;
        const compositionOffset = compositionOffsets?.[at] ?? 0;
        const presentation = (decodeTimes[at] ?? 0) + compositionOffset;

        /**
         * The edit list, applied here rather than described and dropped.
         *
         * This demuxer used to decode `elst`, compute exactly these two
         * numbers, hand them out on `DemuxedTrack.editList` with
         * `applied: false`, and leave acting on them to the caller. The
         * comment defending that is careful and it is the right shape for a
         * library — but **no caller ever read the field**. The transcode path
         * takes `samples()` and nothing else, so the offset was computed and
         * discarded on every file that had one.
         *
         * The case it costs is not exotic. A leading empty edit
         * (`media_time == -1`) is how a track says "start me late", and every
         * AAC track from an Apple encoder carries one to hide priming delay.
         * Ignoring it puts audio ahead of video by the declared amount for the
         * whole file — a fixed lip-sync error, present from the first frame,
         * on exactly the recordings a phone produces.
         *
         * Only the reducible part is applied: the leading empty edits become a
         * shift, and a first real edit starting inside the media becomes a
         * trim. A multi-entry list that genuinely cuts the track into pieces
         * cannot be reduced to two numbers, and is still reported rather than
         * approximated — see {@link EditListNotice}.
         */
        const shifted = presentation + editShiftUnits;
        if (shifted < 0) continue;

        yield {
          // `slice`, not `subarray`. A view would pin the whole read buffer for
          // as long as any one sample of it is alive, so holding a single frame
          // would hold megabytes — the same foot-gun `ByteWriter.finish` argues
          // against handing out, for the same reason.
          data: bytes.slice(start, start + size),
          timestampUs: unitsToMicroseconds(shifted, timescale),
          durationUs: unitsToMicroseconds(durations[at] ?? 0, timescale),
          isKeyFrame: isSyncSample(this.#table, at),
          ...(compositionOffset === 0
            ? {}
            : { compositionOffsetUs: unitsToMicroseconds(compositionOffset, timescale) }),
        };
      }

      index = last + 1;
    }
  }
}

/* ------------------------------------------------------------------ file -- */

export interface Mp4File {
  readonly byteLength: number;
  /** `ftyp`'s major brand first, then its compatible brands. Empty if there is no `ftyp`. */
  readonly brands: readonly string[];
  readonly movieTimescale: number;
  /** `mvhd.duration`, converted. The movie's declared length, edits included. */
  readonly durationUs: number;
  readonly tracks: readonly DemuxedTrack[];
  /**
   * Tracks in the file this demuxer produces nothing for. Subtitle and timecode
   * tracks land here as a matter of course; so does a video track in a codec we
   * cannot configure a decoder for. Reading this is how a caller finds out that
   * a file was *partly* understood.
   */
  readonly skippedTracks: readonly SkippedTrack[];
}

interface TopLevelBox {
  readonly type: string;
  readonly offset: number;
  readonly size: number;
}

/**
 * Walks the top-level boxes by header alone, reading sixteen bytes at a time.
 *
 * This is the part that must not assume a layout. `moov` is at the end of any
 * file whose encoder did not know its final size up front — which is most of
 * them — and it is at the front of any file that has been through a fast-start
 * pass. Both are ordinary. So the walk records everything and the caller picks.
 *
 * A `size` of 0 means "to the end of the file" `[BMFF §4.2]`, which is legal and
 * which the muxer's parser refuses because the muxer never writes it. Here it is
 * resolved against the real file length — an `mdat` written by a streaming
 * encoder that never went back to patch its size is exactly this, and it is
 * always the last box, so the walk ends there.
 */
async function walkTopLevelBoxes(source: ByteSource): Promise<TopLevelBox[]> {
  const boxes: TopLevelBox[] = [];
  let at = 0;

  while (at < source.byteLength) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) {
      throw new Mp4DemuxError(
        `More than ${MAX_TOP_LEVEL_BOXES} top-level boxes; this is not a file we can make sense of`,
      );
    }
    const headerEnd = Math.min(at + 16, source.byteLength);
    const slab = await source.read(at, headerEnd);
    const view = new DataView(slab.buffer, slab.byteOffset, slab.byteLength);
    const header = readBoxHeader(view, 0, slab.byteLength, at);

    // Resolved here, not in the parser: only this walk knows where the file ends.
    const size = header.size === 0 ? source.byteLength - at : header.size;
    if (size < header.headerSize) {
      throw new Mp4DemuxError(
        `Box "${header.type}" at ${at} declares ${size} bytes, below its ${header.headerSize}-byte header`,
      );
    }
    if (at + size > source.byteLength) {
      throw new Mp4DemuxError(
        `Box "${header.type}" at ${at} declares ${size} bytes and runs ${at + size - source.byteLength} ` +
          `bytes past the end of a ${source.byteLength}-byte file; it is truncated`,
      );
    }

    boxes.push({ type: header.type, offset: at, size });
    at += size;
  }

  return boxes;
}

/**
 * Reads a file's `moov` and builds a track per readable `trak`.
 *
 * Fails when *no* track is readable, and only then. A file with H.264 video and
 * an audio track in something exotic is still worth transcoding, so an
 * unreadable track is recorded on {@link Mp4File.skippedTracks} rather than
 * thrown — but a file with nothing readable in it throws, carrying every reason
 * it collected, because the alternative is handing back an `Mp4File` with an
 * empty `tracks` array and letting the caller discover the problem later and
 * further away.
 */
export async function openMp4(input: Blob | ByteSource): Promise<Mp4File> {
  const source = toByteSource(input);
  if (source.byteLength < 8) {
    throw new Mp4DemuxError(`A ${source.byteLength}-byte file cannot contain a single box header`);
  }

  const topLevel = await walkTopLevelBoxes(source);
  const moovBox = topLevel.find((box) => box.type === "moov");
  if (moovBox === undefined) {
    throw new Mp4DemuxError(
      `This file has no moov box (top level: ${topLevel.map((b) => b.type).join(", ") || "nothing"}). ` +
        `Without it there is no sample table, and nothing in the file says where any sample begins.`,
    );
  }
  if (moovBox.size > MAX_MOOV_BYTES) {
    throw new Mp4DemuxError(`moov declares ${moovBox.size} bytes, past the ${MAX_MOOV_BYTES}-byte ceiling`);
  }

  const moovBytes = await source.read(moovBox.offset, moovBox.offset + moovBox.size);
  let moov: ParsedBox;
  try {
    moov = requireOne(parseBoxes(moovBytes, moovBox.offset, { extraContainers: DEMUX_CONTAINERS }));
  } catch (error) {
    throw new Mp4DemuxError(`moov at byte ${moovBox.offset} does not parse`, error);
  }

  const mvhd = moov.children.find((box) => box.type === "mvhd");
  if (mvhd === undefined) throw new Mp4DemuxError("moov has no mvhd; the movie declares no timescale");
  const movie = parseMvhd(mvhd);
  const fragmented = moov.children.some((box) => box.type === "mvex");

  const ftyp = topLevel.find((box) => box.type === "ftyp");
  const brands = ftyp === undefined ? [] : await readBrands(source, ftyp);

  const tracks: DemuxedTrack[] = [];
  const skippedTracks: SkippedTrack[] = [];

  for (const trak of moov.children.filter((box) => box.type === "trak")) {
    const built = buildTrack(trak, source, movie.timescale, fragmented);
    if ("reason" in built) skippedTracks.push(built);
    else tracks.push(built);
  }

  if (tracks.length === 0) {
    const reasons = skippedTracks.map((track) => `track ${track.id}: ${track.reason}`);
    throw new Mp4DemuxError(
      `No track in this file can be demuxed.${reasons.length > 0 ? ` ${reasons.join("; ")}` : ""}`,
    );
  }

  return {
    byteLength: source.byteLength,
    brands,
    movieTimescale: movie.timescale,
    durationUs: unitsToMicroseconds(movie.duration, movie.timescale),
    tracks,
    skippedTracks,
  };
}

function requireOne(boxes: readonly ParsedBox[]): ParsedBox {
  const first = boxes[0];
  if (first === undefined || boxes.length !== 1) {
    throw new Mp4DemuxError(`Expected exactly one box, parsed ${boxes.length}`);
  }
  return first;
}

/**
 * `ftyp`'s major brand then its compatible brands (research §1.2).
 *
 * Read whole rather than by prefix, with a ceiling: `ftyp` is a couple of dozen
 * bytes in every real file, so a declared size past the cap is a corrupt field
 * rather than an unusual movie, and allocating what it asked for is how a bad
 * size becomes a memory problem. Brands are informational here — nothing in the
 * demuxer branches on them — but "we could not read them" is still a sentence
 * worth saying out loud rather than an empty array nobody questions.
 */
const MAX_FTYP_BYTES = 4096;

async function readBrands(source: ByteSource, ftyp: TopLevelBox): Promise<string[]> {
  if (ftyp.size > MAX_FTYP_BYTES) {
    throw new Mp4DemuxError(
      `ftyp declares ${ftyp.size} bytes; a file type box is a few dozen, so this size is not credible`,
    );
  }
  const bytes = await source.read(ftyp.offset, ftyp.offset + ftyp.size);
  const box = parseBoxes(bytes)[0];
  // major_brand + minor_version is the minimum; a shorter one names nothing.
  if (box === undefined || box.payload.byteLength < 8) return [];

  const reader = new BoxReader(box.payload);
  const brands = [reader.fourcc()];
  reader.u32(); // minor_version
  while (reader.remaining >= 4) brands.push(reader.fourcc());
  return brands;
}

/**
 * One `trak` → a {@link DemuxedTrack}, or the reason there is not one.
 *
 * Returning the reason instead of throwing is what lets a partly-understood file
 * still be useful. Every branch below produces a sentence naming the track and
 * what stopped it, because these strings are the only thing a caller has when a
 * file does not work.
 */
function buildTrack(
  trak: ParsedBox,
  source: ByteSource,
  movieTimescale: number,
  fragmented: boolean,
): DemuxedTrack | SkippedTrack {
  const tkhdBox = trak.children.find((box) => box.type === "tkhd");
  const mdia = trak.children.find((box) => box.type === "mdia");
  if (tkhdBox === undefined || mdia === undefined) {
    return { id: 0, handlerType: "", reason: "trak has no tkhd or no mdia" };
  }
  const tkhd = parseTkhd(tkhdBox);

  const hdlrBox = mdia.children.find((box) => box.type === "hdlr");
  const mdhdBox = mdia.children.find((box) => box.type === "mdhd");
  const minf = mdia.children.find((box) => box.type === "minf");
  if (hdlrBox === undefined || mdhdBox === undefined || minf === undefined) {
    return { id: tkhd.trackId, handlerType: "", reason: "mdia has no hdlr, mdhd or minf" };
  }

  const handlerType = parseHdlr(hdlrBox).handlerType;
  const kind: TrackKind | undefined =
    handlerType === "vide" ? "video" : handlerType === "soun" ? "audio" : undefined;
  if (kind === undefined) {
    // Subtitle, timecode, chapter and metadata tracks all land here. Extremely
    // common, entirely uninteresting to a transcoder, and not an error.
    return {
      id: tkhd.trackId,
      handlerType,
      reason: `handler "${handlerType}" is neither vide nor soun`,
    };
  }

  const stbl = minf.children.find((box) => box.type === "stbl");
  if (stbl === undefined) {
    return { id: tkhd.trackId, handlerType, reason: "minf has no stbl" };
  }

  try {
    const mdhd = parseMdhd(mdhdBox);
    const table = buildSampleTable(stbl);

    if (table.sampleCount === 0) {
      return {
        id: tkhd.trackId,
        handlerType,
        reason: fragmented
          ? "its sample table is empty and the movie has an mvex, so this is a fragmented file — " +
            "the samples are in moof boxes, which this demuxer does not read"
          : "its sample table is empty",
      };
    }

    // Every offset checked once, here, rather than trusted at read time. A
    // sample table that points past the end of the file is the shape a truncated
    // download has, and catching it at open turns a mid-transcode failure into a
    // refusal to start.
    for (let i = 0; i < table.sampleCount; i++) {
      const start = table.offsets[i] ?? 0;
      const end = start + (table.sizes[i] ?? 0);
      if (start < 0 || end > source.byteLength) {
        return {
          id: tkhd.trackId,
          handlerType,
          reason:
            `sample ${i} spans [${start}, ${end}) but the file is ${source.byteLength} bytes; ` +
            `the sample table points outside the file`,
        };
      }
    }

    const stsd = stbl.children.find((box) => box.type === "stsd");
    const entry = stsd?.children[table.sampleDescriptionIndex - 1];
    if (entry === undefined) {
      return {
        id: tkhd.trackId,
        handlerType,
        reason: `stsd has no entry ${table.sampleDescriptionIndex}`,
      };
    }
    const { codec, description } = readCodecDescription(entry);

    const edts = trak.children.find((box) => box.type === "edts");
    const elst = edts?.children.find((box) => box.type === "elst");
    const editList =
      elst === undefined
        ? undefined
        : summariseEditList(decodeElst(elst), mdhd.timescale, movieTimescale);

    return new DemuxedTrack({
      id: tkhd.trackId,
      kind,
      config: buildTrackConfig(kind, codec, description, mdhd.timescale, entry, tkhd),
      editList,
      source,
      table,
    });
  } catch (error) {
    return {
      id: tkhd.trackId,
      handlerType,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildTrackConfig(
  kind: TrackKind,
  codec: string,
  description: Uint8Array,
  timescale: number,
  entry: ParsedBox,
  tkhd: ReturnType<typeof parseTkhd>,
): TrackConfig {
  if (kind === "video") {
    const visual = parseVisualSampleEntry(entry);
    // The sample entry's dimensions are the **coded** ones; `tkhd`'s are display
    // geometry in 16.16 and may carry a non-square pixel aspect (research §1.6).
    // An encoder wants the coded pair, so `tkhd` is only a fallback for the
    // files — rare, but real — that leave the sample entry at 0×0.
    return {
      kind,
      codec,
      description,
      timescale,
      width: visual.width || Math.round(tkhd.width),
      height: visual.height || Math.round(tkhd.height),
    };
  }

  const audio = parseAudioSampleEntry(entry);
  // `AudioSampleEntry.samplerate` is 16.16 and so cannot express a rate above
  // 65535 at all; files at 96 kHz write 0 and expect the reader to take the
  // media timescale, which for audio is conventionally the sample rate
  // (research §5.1). The muxer refuses to *write* such a rate for the same
  // reason; here we have to read one.
  return {
    kind,
    codec,
    description,
    timescale,
    sampleRate: audio.sampleRate || timescale,
    channelCount: audio.channelCount,
  };
}
