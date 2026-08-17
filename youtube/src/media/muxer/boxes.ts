/**
 * Every ISO BMFF box this muxer writes, one function per box.
 *
 * The whole file is a transcription of the field tables in
 * `research/02-fmp4-hls-packaging.md` §1–§4, which were themselves built from
 * ISO/IEC 14496-12 and cross-checked against a shipping hand-written muxer. Each
 * function's comment names its section and repeats the field order, because the
 * only way to review byte-layout code is to read it against the table it came
 * from — and the table is not in the same repository as the code.
 *
 * The functions write into a shared `ByteWriter` rather than returning buffers.
 * A box tree assembled from returned `Uint8Array`s would copy every child into
 * its parent, so `moov` would be copied once per level of nesting — six levels
 * deep, for a structure whose sizes are known only from the inside out. Writing
 * forward and back-patching sizes copies nothing.
 *
 * Nothing here decides *what* to write. Durations arrive already in the right
 * timescale, sample flags already composed. That separation is what makes the
 * one place that converts microseconds (`microsecondsToTimescale`, below) the
 * only place a unit can be got wrong.
 */

import type { TrackConfig, TrackKind } from "../types";

import { ByteWriter, BOX_HEADER_SIZE, LARGE_BOX_HEADER_SIZE } from "./writer";

/* ----------------------------------------------------------------- time -- */

const MICROSECONDS_PER_SECOND = 1_000_000;

/**
 * The movie-wide timescale. Unrelated to any track's media timescale — it only
 * denominates `mvhd.duration` and `tkhd.duration`, which are coarse
 * informational fields (research §5.1). 1000 is what the reference muxer uses
 * and is deliberately *different* from every track timescale we choose, so that
 * confusing the two shows up immediately rather than by coincidence agreeing.
 */
export const DEFAULT_MOVIE_TIMESCALE = 1000;

/**
 * The single place in this muxer that converts WebCodecs' microseconds into a
 * timescale. Every other module takes timescale units already.
 *
 * `EncodedSample.timestampUs`/`durationUs` are integer microseconds
 * (research §5.1); a track timescale is ticks per second. Callers that need a
 * *sequence* of durations must not call this per sample and sum the results —
 * that accumulates one rounding error per frame. `planFragment` in
 * media-segment.ts rounds the running absolute position instead, so the errors
 * cancel (research §5.2).
 */
export function microsecondsToTimescale(microseconds: number, timescale: number): number {
  if (!Number.isFinite(microseconds) || !Number.isFinite(timescale) || timescale <= 0) {
    throw new Error(`Cannot convert ${microseconds}µs into a timescale of ${timescale}`);
  }
  // The recommended video timescale is exactly 1e6, which makes this the
  // identity function (research §5.1). Taking it as a special case is not an
  // optimisation — it keeps the common path exact instead of round-tripping
  // through a multiply and a divide that a float could perturb.
  if (timescale === MICROSECONDS_PER_SECOND) return Math.round(microseconds);

  const product = microseconds * timescale;
  if (!Number.isSafeInteger(Math.trunc(product))) {
    throw new Error(
      `Timescale conversion of ${microseconds}µs × ${timescale} exceeds 2^53 and would lose precision`,
    );
  }
  return Math.round(product / MICROSECONDS_PER_SECOND);
}

/* ---------------------------------------------------------- sample flags -- */

/**
 * The 32-bit `sample_flags` word, composed field by field (research §4):
 *
 *     bit(4)            reserved = 0
 *     unsigned int(2)   is_leading
 *     unsigned int(2)   sample_depends_on
 *     unsigned int(2)   sample_is_depended_on
 *     unsigned int(2)   sample_has_redundancy
 *     bit(3)            sample_padding_value
 *     bit(1)            sample_is_non_sync_sample
 *     unsigned int(16)  sample_degradation_priority
 *
 * Written as a composition rather than as two magic constants because the
 * inverted-flag bug (research §4, §10) is invisible in a hex literal and
 * obvious in `sampleIsNonSyncSample = isSync ? 0 : 1`. The constants below are
 * derived from this function, not typed out beside it.
 *
 * `sample_is_non_sync_sample` is the one that matters: **0 means the sample IS
 * a sync sample**. Get it backwards and the file plays perfectly from the
 * start and cannot be seeked, which is a bug that survives every casual test.
 */
export function sampleFlags(isSync: boolean): number {
  const isLeading = 0;
  const sampleDependsOn = isSync ? 2 : 1; // 2 = depends on nothing, 1 = depends on others
  const sampleIsDependedOn = 0; // 0 = unknown
  const sampleHasRedundancy = 0; // 0 = unknown
  const samplePaddingValue = 0;
  const sampleIsNonSyncSample = isSync ? 0 : 1;
  const sampleDegradationPriority = 0;

  return (
    ((isLeading & 0b11) << 26) |
    ((sampleDependsOn & 0b11) << 24) |
    ((sampleIsDependedOn & 0b11) << 22) |
    ((sampleHasRedundancy & 0b11) << 20) |
    ((samplePaddingValue & 0b111) << 17) |
    ((sampleIsNonSyncSample & 0b1) << 16) |
    (sampleDegradationPriority & 0xffff)
  ) >>>
    0;
}

/** `0x02000000` — what FFmpeg's `movenc.c` calls `MOV_FRAG_SAMPLE_FLAG_DEPENDS_NO`. */
export const SYNC_SAMPLE_FLAGS = sampleFlags(true);

/** `0x01010000` — `DEPENDS_YES | IS_NON_SYNC`. */
export const NON_SYNC_SAMPLE_FLAGS = sampleFlags(false);

/* --------------------------------------------------------------- shared -- */

/**
 * The unity transformation matrix, in `mvhd` and `tkhd` (research §1.9).
 *
 * Cells 0, 1, 3, 4, 6, 7 are 16.16 fixed point; cells 2, 5, 8 are **2.30**,
 * which is why the last one is `0x40000000` and not `0x00010000`. A matrix with
 * `0x00010000` in the corner looks identity-ish to a reader and quietly scales
 * geometry in the minority of players that apply the matrix at all.
 */
const UNITY_MATRIX: readonly number[] = [
  0x0001_0000, 0x0000_0000, 0x0000_0000, //
  0x0000_0000, 0x0001_0000, 0x0000_0000, //
  0x0000_0000, 0x0000_0000, 0x4000_0000,
];

function writeMatrix(w: ByteWriter): void {
  for (const cell of UNITY_MATRIX) w.u32(cell);
}

/**
 * Packs an ISO-639-2/T code into `mdhd.language`: one zero pad bit then three
 * 5-bit characters, each `ASCII − 0x60` (research §1.7). `"und"` → `0x55C4`.
 *
 * `TrackConfig` carries no language, and inventing one would be worse than
 * declaring ignorance: `"und"` is the standard way to say the track's language
 * is undetermined, and a wrong `LANGUAGE` in a player's audio menu is a bug a
 * user can see.
 */
export function packLanguage(code: string): number {
  if (code.length !== 3) {
    throw new Error(`Language "${code}" is not a 3-character ISO-639-2/T code`);
  }
  let packed = 0;
  for (let i = 0; i < 3; i++) {
    const offset = code.charCodeAt(i) - 0x60;
    if (offset < 1 || offset > 26) {
      throw new Error(`Language "${code}" contains a character outside a-z`);
    }
    packed = (packed << 5) | offset;
  }
  return packed;
}

const UNDETERMINED_LANGUAGE = packLanguage("und");

function writeAsciiWithNul(w: ByteWriter, text: string): void {
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (char > 0x7f) throw new Error(`"${text}" is not ASCII`);
    w.u8(char);
  }
  w.u8(0);
}

/* ----------------------------------------------------------------- ftyp -- */

/**
 * `ftyp` — File Type Box, research §1.2. Not a `FullBox`.
 *
 *     major_brand: 'iso5'
 *     minor_version: u32
 *     compatible_brands[]: 'iso5', 'iso6', 'mp41'
 *
 * `iso5` is required to use `tfhd`'s `default-base-is-moof`, which we always
 * set. `iso6` claims `tfdt` on every `traf` and version-1 `trun`, both of which
 * we always emit — so the claim is accurate rather than aspirational. `mp41` is
 * for readers that recognise neither. Inventing a brand is an append error in
 * MSE (research §10), so these three and nothing else.
 */
export function writeFtyp(w: ByteWriter): void {
  const start = w.beginBox("ftyp");
  w.fourcc("iso5");
  w.u32(0x0000_0200); // minor_version, informative only
  w.fourcc("iso5");
  w.fourcc("iso6");
  w.fourcc("mp41");
  w.endBox(start);
}

/* ----------------------------------------------------------------- mvhd -- */

export interface MovieHeader {
  readonly timescale: number;
  /** In `timescale` units. Zero means unknown, which is legal while fragmenting. */
  readonly duration: number;
  readonly nextTrackId: number;
}

/**
 * `mvhd` — Movie Header Box, research §1.4. `FullBox` version 0.
 *
 *     creation_time u32 / modification_time u32 / timescale u32 / duration u32
 *     rate i32 (16.16) / volume i16 (8.8) / reserved u16 / reserved 2×u32
 *     matrix 9×i32 / pre_defined 6×u32 / next_track_ID u32
 *
 * Version 0 rather than 1: the 32-bit `duration` field holds 49 days at the
 * 1000 movie timescale, and `creation_time` is written as 0 rather than a real
 * 1904-epoch clock — a muxer output should be byte-identical for the same input
 * regardless of when it ran, because that is what makes a golden-file test
 * possible at all.
 */
export function writeMvhd(w: ByteWriter, header: MovieHeader): void {
  const start = w.beginFullBox("mvhd", 0, 0);
  w.u32(0); // creation_time
  w.u32(0); // modification_time
  w.u32(header.timescale);
  w.u32(header.duration);
  w.fixed16_16(1); // rate = 1.0, normal playback speed
  w.fixed8_8(1); // volume = 1.0
  w.zeros(2); // reserved
  w.zeros(8); // reserved 2×u32
  writeMatrix(w);
  w.zeros(24); // pre_defined 6×u32
  w.u32(header.nextTrackId);
  w.endBox(start);
}

/* ----------------------------------------------------------------- tkhd -- */

export interface TrackHeader {
  readonly trackId: number;
  readonly kind: TrackKind;
  /** **In the movie timescale**, not the track's — research §1.6. */
  readonly durationInMovieTimescale: number;
  readonly width: number;
  readonly height: number;
}

/** `track_enabled | track_in_movie | track_in_preview` — the documented default. */
const TKHD_FLAGS = 0x00_0007;

/**
 * `tkhd` — Track Header Box, research §1.6. `FullBox` version 0, flags 0x7.
 *
 *     creation_time u32 / modification_time u32 / track_ID u32 / reserved u32
 *     duration u32 / reserved 2×u32 / layer i16 / alternate_group i16
 *     volume i16 (8.8) / reserved u16 / matrix 9×i32
 *     width u32 (16.16) / height u32 (16.16)
 *
 * **`duration` is in `mvhd.timescale`.** The field name gives no hint of that
 * and the neighbouring `mdhd.duration` is in the track's own timescale, so
 * reusing the track timescale here by habit is a documented silent-drift bug
 * (research §10). The parameter is named for the unit for that reason.
 *
 * `width`/`height` are 16.16 fixed point here, unlike the plain integers in the
 * visual sample entry — these are display dimensions and can carry a
 * non-square pixel aspect; those are the coded dimensions and cannot.
 */
export function writeTkhd(w: ByteWriter, header: TrackHeader): void {
  const start = w.beginFullBox("tkhd", 0, TKHD_FLAGS);
  w.u32(0); // creation_time
  w.u32(0); // modification_time
  w.u32(header.trackId);
  w.u32(0); // reserved
  w.u32(header.durationInMovieTimescale);
  w.zeros(8); // reserved 2×u32
  w.i16(0); // layer
  w.i16(0); // alternate_group
  w.fixed8_8(header.kind === "audio" ? 1 : 0); // volume: full for audio, 0 for video
  w.u16(0); // reserved
  writeMatrix(w);
  w.fixed16_16(header.width);
  w.fixed16_16(header.height);
  w.endBox(start);
}

/* ----------------------------------------------------------------- mdhd -- */

export interface MediaHeader {
  readonly timescale: number;
  /** In this box's own `timescale` — research §1.7. */
  readonly duration: number;
}

/**
 * `mdhd` — Media Header Box, research §1.7. `FullBox` version 0.
 *
 *     creation_time u32 / modification_time u32 / timescale u32 / duration u32
 *     language u16 (1 pad bit + 3×5 bits) / pre_defined u16
 */
export function writeMdhd(w: ByteWriter, header: MediaHeader): void {
  const start = w.beginFullBox("mdhd", 0, 0);
  w.u32(0); // creation_time
  w.u32(0); // modification_time
  w.u32(header.timescale);
  w.u32(header.duration);
  w.u16(UNDETERMINED_LANGUAGE);
  w.u16(0); // pre_defined
  w.endBox(start);
}

/* ----------------------------------------------------------------- hdlr -- */

/**
 * `hdlr` — Handler Reference Box, research §1.7.
 *
 *     pre_defined u32 / handler_type 4cc / reserved 3×u32 / name (NUL-terminated)
 *
 * `name` is purely diagnostic — it is what shows up beside the track in
 * `ffprobe` output, and that is its entire job.
 */
export function writeHdlr(w: ByteWriter, kind: TrackKind): void {
  const start = w.beginFullBox("hdlr", 0, 0);
  w.u32(0); // pre_defined
  w.fourcc(kind === "video" ? "vide" : "soun");
  w.zeros(12); // reserved 3×u32
  writeAsciiWithNul(w, kind === "video" ? "VideoHandler" : "SoundHandler");
  w.endBox(start);
}

/* ---------------------------------------------------------- vmhd / smhd -- */

/**
 * `vmhd` — Video Media Header, research §1.8. **flags must be 1**, which the
 * spec calls out explicitly and which nearly every other box contradicts by
 * using 0. A `vmhd` with flags 0 is malformed.
 *
 *     graphicsmode u16 = 0 (copy) / opcolor 3×u16 = 0
 */
export function writeVmhd(w: ByteWriter): void {
  const start = w.beginFullBox("vmhd", 0, 1);
  w.u16(0); // graphicsmode
  w.zeros(6); // opcolor
  w.endBox(start);
}

/**
 * `smhd` — Sound Media Header, research §1.8. flags 0, unlike `vmhd`.
 *
 *     balance i16 (8.8) = 0 (centred) / reserved u16
 */
export function writeSmhd(w: ByteWriter): void {
  const start = w.beginFullBox("smhd", 0, 0);
  w.fixed8_8(0); // balance
  w.u16(0); // reserved
  w.endBox(start);
}

/* ----------------------------------------------------------------- dinf -- */

/**
 * `dinf` → `dref` → `url `, research §1.9.
 *
 * The `url ` fourcc has a trailing space, and its flags of `0x000001` mean
 * "self-contained": the media data is in this same file. With that flag set the
 * `location` string is *omitted entirely* — "no string (not even an empty one)
 * shall be supplied" — so the box is 12 bytes and its body is nothing but the
 * version/flags word.
 */
export function writeDinf(w: ByteWriter): void {
  const dinf = w.beginBox("dinf");
  const dref = w.beginFullBox("dref", 0, 0);
  w.u32(1); // entry_count
  const url = w.beginFullBox("url ", 0, 1); // 1 = media is in this file
  w.endBox(url);
  w.endBox(dref);
  w.endBox(dinf);
}

/* --------------------------------------------------- codec config boxes -- */

/** The four sample entry types this project negotiates against the browser. */
export type SampleEntryType = "avc1" | "vp09" | "av01" | "mp4a";

const SAMPLE_ENTRY_TYPES = new Set<string>(["avc1", "vp09", "av01", "mp4a"]);

/**
 * Maps an RFC 6381 codec string onto its `stsd` sample entry fourcc.
 *
 * The prefix *is* the fourcc for all four codecs we support, which is not a
 * coincidence — RFC 6381 defines the first component of a codec string as the
 * sample entry's four-character code. The set is closed on purpose: an
 * unrecognised `format` in a `SampleEntry` means neither the description nor
 * its samples may be decoded (research §10), and a player reports that as a
 * black rectangle with no error, so it is much better caught here.
 */
export function sampleEntryTypeFor(codec: string): SampleEntryType {
  const prefix = codec.split(".")[0]?.toLowerCase() ?? "";
  if (!SAMPLE_ENTRY_TYPES.has(prefix)) {
    throw new Error(
      `Unsupported codec "${codec}": expected one of avc1, vp09, av01, mp4a`,
    );
  }
  return prefix as SampleEntryType;
}

/**
 * `avcC` — AVCDecoderConfigurationRecord, research §2.1. Not a `FullBox`.
 *
 * Written verbatim from `TrackConfig.description`, never rebuilt. A
 * `VideoEncoder` configured with `avc: { format: "avc" }` emits SPS/PPS *only*
 * through `decoderConfig.description` — they are not in the bitstream at all —
 * so the bytes we are handed are the authoritative record and any field we
 * "corrected" would be a corruption. This also sidesteps the documented FFmpeg
 * bug where the High-profile chroma/bit-depth extension is omitted: whatever
 * the encoder emitted, we pass through.
 */
function writeAvcC(w: ByteWriter, description: Uint8Array): void {
  const start = w.beginBox("avcC");
  w.bytes(description);
  w.endBox(start);
}

/**
 * `av1C` — AV1CodecConfigurationRecord, research §2.3. Not a `FullBox`.
 *
 * Also verbatim, and here it is not merely preferable but the only correct
 * option: `seq_profile`, `seq_level_idx_0`, `high_bitdepth`, the chroma
 * subsampling bits and the trailing `configOBUs` all come from the Sequence
 * Header OBU in the bitstream and **cannot be derived from the codec string**.
 * The reference muxer's own source admits it stubs these to zero. A synthesised
 * `av1C` produces a stream that parses and does not decode.
 */
function writeAv1C(w: ByteWriter, description: Uint8Array): void {
  const start = w.beginBox("av1C");
  w.bytes(description);
  w.endBox(start);
}

/**
 * `vpcC` — VPCodecConfigurationBox, research §2.2. `FullBox` **version 1**;
 * version 0 is deprecated.
 *
 *     profile u8 / level u8
 *     bitDepth(4) chromaSubsampling(3) videoFullRangeFlag(1)
 *     colourPrimaries u8 / transferCharacteristics u8 / matrixCoefficients u8
 *     codecInitializationDataSize u16 = 0
 *
 * This is the one codec where a caller-supplied `description` may legitimately
 * not exist: research §2.2 records that WebCodecs hands back no structured VP9
 * decoder config, only the codec string, and the reference muxer parses the
 * string for exactly this reason. So `description` still wins when present —
 * and when it is absent we parse `vp09.PP.LL.DD…` rather than refuse, because
 * unlike `av1C` every mandatory field of this record *is* in the string.
 *
 * The optional colour block defaults to `2` = "unspecified" rather than to a
 * guess at BT.709. Declaring the wrong primaries shifts colour on a display
 * that honours them; declaring them unknown does not.
 */
function writeVpcC(w: ByteWriter, config: TrackConfig): void {
  const start = w.beginFullBox("vpcC", 1, 0);
  if (config.description) {
    w.bytes(config.description);
  } else {
    const parsed = parseVp9CodecString(config.codec);
    w.u8(parsed.profile);
    w.u8(parsed.level);
    w.u8(
      ((parsed.bitDepth & 0xf) << 4) |
        ((parsed.chromaSubsampling & 0x7) << 1) |
        (parsed.videoFullRangeFlag & 0x1),
    );
    w.u8(parsed.colourPrimaries);
    w.u8(parsed.transferCharacteristics);
    w.u8(parsed.matrixCoefficients);
    w.u16(0); // codecInitializationDataSize — VP9 needs no extra blob
  }
  w.endBox(start);
}

interface Vp9CodecParameters {
  readonly profile: number;
  readonly level: number;
  readonly bitDepth: number;
  readonly chromaSubsampling: number;
  readonly colourPrimaries: number;
  readonly transferCharacteristics: number;
  readonly matrixCoefficients: number;
  readonly videoFullRangeFlag: number;
}

/** `vp09.PP.LL.DD[.CC.cp.tc.mc.F]` — research §7.1.1. */
function parseVp9CodecString(codec: string): Vp9CodecParameters {
  const parts = codec.split(".");
  const [, profile, level, bitDepth] = parts;
  if (profile === undefined || level === undefined || bitDepth === undefined) {
    throw new Error(
      `VP9 codec string "${codec}" is missing profile/level/bitDepth, and no description was supplied`,
    );
  }
  const optional = (index: number, fallback: number): number => {
    const raw = parts[index];
    return raw === undefined ? fallback : Number.parseInt(raw, 10);
  };
  return {
    profile: Number.parseInt(profile, 10),
    level: Number.parseInt(level, 10),
    bitDepth: Number.parseInt(bitDepth, 10),
    chromaSubsampling: optional(4, 0), // 4:2:0
    colourPrimaries: optional(5, 2), // 2 = unspecified
    transferCharacteristics: optional(6, 2),
    matrixCoefficients: optional(7, 2),
    videoFullRangeFlag: optional(8, 0),
  };
}

/**
 * The four-byte expandable length used by every descriptor inside `esds`:
 * three continuation bytes then the value (research §2.4).
 *
 * `0x80 0x80 0x80 0x20` decodes to `0x20`, because each byte contributes seven
 * bits and the top bit means "another byte follows". It is not size-minimal —
 * one byte would do — but it is fixed-width, which is what every production
 * muxer emits and therefore what every parser is exercised against.
 */
function writeDescriptorHeader(w: ByteWriter, tag: number, length: number): void {
  if (length > 0x7f) {
    throw new Error(
      `esds descriptor 0x${tag.toString(16)} is ${length} bytes; the fixed 4-byte length encoding holds 127`,
    );
  }
  w.u8(tag);
  w.u8(0x80);
  w.u8(0x80);
  w.u8(0x80);
  w.u8(length);
}

/**
 * `esds` — ES Descriptor Box, research §2.4. `FullBox` version 0.
 *
 * The payload is a nest of MPEG-4 descriptors, each `tag + 4-byte length`:
 *
 *     ES_Descr (0x03)               ES_ID u16 = 1, flags u8 = 0
 *       DecoderConfigDescr (0x04)   objectTypeIndication u8 = 0x40 (MPEG-4 Audio)
 *                                   streamType/upStream/reserved u8 = 0x15
 *                                   bufferSizeDB u24, maxBitrate u32, avgBitrate u32
 *         DecSpecificInfo (0x05)    the AudioSpecificConfig, verbatim
 *       SLConfigDescr (0x06)        predefined u8 = 0x02 ("MP4 file")
 *
 * **The research doc is internally inconsistent here and this follows the other
 * side of it.** §2.4 field 12 describes `SLConfigDescrTag` as a 2-byte
 * `tag + len` header, but field 1's `ES_Descr` length of `0x20 + description
 * .length` only adds up if the SL descriptor uses the same 4-byte encoding as
 * its three siblings (3 + 5 + 18 + n + 6 = 32 + n). The cross-checked reference
 * implementation emits `06 80 80 80 01 02`, six bytes, which agrees with the
 * length. So: all four descriptors use the 4-byte form, and the lengths below
 * are computed from the content rather than copied from the table, so the two
 * cannot drift apart again.
 *
 * `maxBitrate`/`avgBitrate` are written as 0. They are informational, and this
 * seam carries no measured bitrate — `TrackConfig` has no such field, and a
 * plausible-looking invented number is worse than a declared unknown.
 */
function writeEsds(w: ByteWriter, description: Uint8Array): void {
  const start = w.beginFullBox("esds", 0, 0);

  const decoderSpecificLength = description.byteLength;
  const decoderConfigLength = 13 + 5 + decoderSpecificLength;
  const slConfigLength = 1;
  const esDescriptorLength = 3 + (5 + decoderConfigLength) + (5 + slConfigLength);

  writeDescriptorHeader(w, 0x03, esDescriptorLength);
  w.u16(1); // ES_ID
  w.u8(0); // flags: no stream dependency, no URL, no OCR

  writeDescriptorHeader(w, 0x04, decoderConfigLength);
  w.u8(0x40); // objectTypeIndication: MPEG-4 Audio (ISO/IEC 14496-3)
  w.u8(0x15); // streamType 5 (Audio) << 2 | upStream 0 << 1 | reserved 1
  w.u24(0); // bufferSizeDB
  w.u32(0); // maxBitrate — not measured at this seam
  w.u32(0); // avgBitrate — likewise

  writeDescriptorHeader(w, 0x05, decoderSpecificLength);
  w.bytes(description); // AudioSpecificConfig, straight from the encoder

  writeDescriptorHeader(w, 0x06, slConfigLength);
  w.u8(0x02); // predefined: "MP4 file"

  w.endBox(start);
}

/* ----------------------------------------------------------------- stsd -- */

function requireDescription(config: TrackConfig, boxName: string): Uint8Array {
  if (!config.description || config.description.byteLength === 0) {
    throw new Error(
      `Track "${config.codec}" needs a decoder configuration record for its ${boxName} box; ` +
        `pass TrackConfig.description (WebCodecs supplies it as decoderConfig.description)`,
    );
  }
  return config.description;
}

/**
 * The `VisualSampleEntry` shared by `avc1`, `vp09` and `av01`, research §2.1.
 *
 *     reserved 6 bytes / data_reference_index u16 = 1     (common SampleEntry)
 *     pre_defined u16 / reserved u16 / pre_defined 3×u32
 *     width u16 / height u16
 *     horizresolution u32 (16.16) = 72dpi / vertresolution u32 = 72dpi
 *     reserved u32 / frame_count u16 = 1
 *     compressorname 32 bytes (Pascal string; all-zero = empty)
 *     depth u16 = 0x18 / pre_defined i16 = -1
 *     <codec configuration box>
 *
 * 78 bytes of body before the config box, every time — the parser depends on
 * that being fixed, and it is: nothing above is variable-length.
 */
function writeVisualSampleEntry(
  w: ByteWriter,
  type: SampleEntryType,
  config: TrackConfig,
): void {
  const width = config.width;
  const height = config.height;
  if (width === undefined || height === undefined) {
    throw new Error(`Video track "${config.codec}" needs width and height`);
  }

  const start = w.beginBox(type);
  w.zeros(6); // reserved
  w.u16(1); // data_reference_index → the single dref entry
  w.u16(0); // pre_defined
  w.u16(0); // reserved
  w.zeros(12); // pre_defined 3×u32
  w.u16(width);
  w.u16(height);
  w.fixed16_16(72); // horizresolution
  w.fixed16_16(72); // vertresolution
  w.u32(0); // reserved
  w.u16(1); // frame_count: one frame per sample
  w.zeros(32); // compressorname
  w.u16(0x0018); // depth: 24-bit colour, no alpha
  w.i16(-1); // pre_defined

  switch (type) {
    case "avc1":
      writeAvcC(w, requireDescription(config, "avcC"));
      break;
    case "av01":
      writeAv1C(w, requireDescription(config, "av1C"));
      break;
    case "vp09":
      writeVpcC(w, config);
      break;
    default:
      throw new Error(`${type} is not a visual sample entry`);
  }

  w.endBox(start);
}

/**
 * `mp4a` — `AudioSampleEntry`, research §2.4.
 *
 *     reserved 6 bytes / data_reference_index u16 = 1     (common SampleEntry)
 *     version u16 / revision_level u16 / vendor u32
 *     channelcount u16 / samplesize u16 = 16
 *     compression_id u16 / packet_size u16
 *     samplerate u32 — the rate in the high 16 bits, i.e. rate × 65536
 *     <esds>
 *
 * The research table gives `samplerate` as "fixed 16.16, e.g. 48000 →
 * 0x00480000", then corrects itself in the same cell. `0x00480000` is 72.0 —
 * the resolution constant from the visual entry, copied by mistake. 48000 in
 * this field is `0xBB800000`. The integer part lives in the top 16 bits, so the
 * field cannot express a rate above 65535 at all; the guard below says so out
 * loud rather than silently truncating.
 */
function writeAudioSampleEntry(w: ByteWriter, config: TrackConfig): void {
  const { sampleRate, channelCount } = config;
  if (sampleRate === undefined || channelCount === undefined) {
    throw new Error(`Audio track "${config.codec}" needs sampleRate and channelCount`);
  }
  if (sampleRate > 0xffff) {
    throw new Error(
      `AudioSampleEntry cannot express a sample rate of ${sampleRate}: the field holds 16 integer bits`,
    );
  }

  const start = w.beginBox("mp4a");
  w.zeros(6); // reserved
  w.u16(1); // data_reference_index
  w.u16(0); // version
  w.u16(0); // revision_level
  w.u32(0); // vendor
  w.u16(channelCount);
  w.u16(16); // samplesize
  w.u16(0); // compression_id
  w.u16(0); // packet_size
  w.u32(sampleRate * 0x1_0000); // samplerate, 16.16
  writeEsds(w, requireDescription(config, "esds"));
  w.endBox(start);
}

/**
 * `stsd` — Sample Description Box, research §2. `FullBox` version 0.
 *
 *     entry_count u32 = 1 / <one SampleEntry>
 *
 * Exactly one entry, for the lifetime of the track. A rung switch produces a
 * whole new init segment rather than a second entry here — that is what CMAF
 * requires (research §8) and what MSE's `changeType()` flow expects (§6.3).
 */
export function writeStsd(w: ByteWriter, config: TrackConfig): void {
  const start = w.beginFullBox("stsd", 0, 0);
  w.u32(1); // entry_count
  const type = sampleEntryTypeFor(config.codec);
  if (type === "mp4a") {
    writeAudioSampleEntry(w, config);
  } else {
    writeVisualSampleEntry(w, type, config);
  }
  w.endBox(start);
}

/* ----------------------------------------------------------------- stbl -- */

/**
 * `stbl` and its four formally-empty tables, research §1.10.
 *
 *     stsd — the codec, and the only non-empty box here
 *     stts — entry_count = 0
 *     stsc — entry_count = 0
 *     stsz — sample_size = 0, sample_count = 0   (two count-like fields)
 *     stco — entry_count = 0
 *
 * They are present and empty because `stbl` is mandatory and its children are
 * mandatory; the samples arrive later in fragments. `stss` is omitted entirely
 * — its absence means "every sample is a sync sample", which is meaningless for
 * a table with no samples and irrelevant for a fragmented file, where sync is
 * signalled per-sample in `trun`.
 */
export function writeStbl(w: ByteWriter, config: TrackConfig): void {
  const stbl = w.beginBox("stbl");
  writeStsd(w, config);

  const stts = w.beginFullBox("stts", 0, 0);
  w.u32(0); // entry_count
  w.endBox(stts);

  const stsc = w.beginFullBox("stsc", 0, 0);
  w.u32(0); // entry_count
  w.endBox(stsc);

  const stsz = w.beginFullBox("stsz", 0, 0);
  w.u32(0); // sample_size: 0 = "sizes vary, see the table"
  w.u32(0); // sample_count
  w.endBox(stsz);

  const stco = w.beginFullBox("stco", 0, 0);
  w.u32(0); // entry_count
  w.endBox(stco);

  w.endBox(stbl);
}

/* ----------------------------------------------------------------- trex -- */

/**
 * `trex` — Track Extends Box, research §1.11. `FullBox` version 0.
 *
 *     track_ID u32 / default_sample_description_index u32 = 1
 *     default_sample_duration u32 / default_sample_size u32 / default_sample_flags u32
 *
 * The three defaults are zero because every `tfhd` we write supplies its own
 * (see `writeTfhd`), so a conformant reader never consults these. `trex` still
 * has to exist: its parent `mvex` is what tells a reader that movie fragments
 * are coming. Without `mvex` the reader sees `moov`'s empty sample tables,
 * concludes the file genuinely has zero samples, and plays a permanent blank
 * with no error anywhere (research §10).
 */
export function writeTrex(w: ByteWriter, trackId: number): void {
  const start = w.beginFullBox("trex", 0, 0);
  w.u32(trackId);
  w.u32(1); // default_sample_description_index → the single stsd entry
  w.u32(0); // default_sample_duration
  w.u32(0); // default_sample_size
  w.u32(0); // default_sample_flags
  w.endBox(start);
}

/* ----------------------------------------------------------------- mfhd -- */

/** Header + version/flags + `sequence_number`. Fixed, hence a constant. */
export const MFHD_SIZE = BOX_HEADER_SIZE + 4 + 4;

/**
 * `mfhd` — Movie Fragment Header, research §3.2. `FullBox` version 0.
 *
 *     sequence_number u32
 *
 * File-wide and 1-based, not per-track, so a reader can tell a dropped fragment
 * from a reordered one.
 */
export function writeMfhd(w: ByteWriter, sequenceNumber: number): void {
  const start = w.beginFullBox("mfhd", 0, 0);
  w.u32(sequenceNumber);
  w.endBox(start);
}

/* ----------------------------------------------------------------- tfhd -- */

export const TFHD_BASE_DATA_OFFSET_PRESENT = 0x00_0001;
export const TFHD_SAMPLE_DESCRIPTION_INDEX_PRESENT = 0x00_0002;
export const TFHD_DEFAULT_SAMPLE_DURATION_PRESENT = 0x00_0008;
export const TFHD_DEFAULT_SAMPLE_SIZE_PRESENT = 0x00_0010;
export const TFHD_DEFAULT_SAMPLE_FLAGS_PRESENT = 0x00_0020;
export const TFHD_DURATION_IS_EMPTY = 0x01_0000;
export const TFHD_DEFAULT_BASE_IS_MOOF = 0x02_0000;

/**
 * The flag combination this muxer always writes: `default-base-is-moof` plus
 * all three per-fragment defaults (research §3.3).
 *
 * `base-data-offset-present` is deliberately absent. It is an alternative
 * anchoring convention, and mixing the two across the tracks of one `moof`
 * desyncs exactly one of them while the other plays perfectly — the kind of
 * bug where the symptom and the cause are in different tracks (research §10).
 * Choosing one convention unconditionally is what makes that impossible.
 */
export const TFHD_FLAGS =
  TFHD_DEFAULT_BASE_IS_MOOF |
  TFHD_DEFAULT_SAMPLE_FLAGS_PRESENT |
  TFHD_DEFAULT_SAMPLE_SIZE_PRESENT |
  TFHD_DEFAULT_SAMPLE_DURATION_PRESENT;

/** The byte cost of `TFHD_FLAGS`: header + version/flags + track_ID + 3 defaults. */
export const TFHD_SIZE = BOX_HEADER_SIZE + 4 + 4 + 12;

export interface TrackFragmentHeader {
  readonly trackId: number;
  readonly defaultSampleDuration: number;
  readonly defaultSampleSize: number;
  readonly defaultSampleFlags: number;
}

/**
 * `tfhd` — Track Fragment Header, research §3.3. `FullBox`, flags `0x020038`.
 *
 *     track_ID u32
 *     default_sample_duration u32 / default_sample_size u32 / default_sample_flags u32
 */
export function writeTfhd(w: ByteWriter, header: TrackFragmentHeader): void {
  const start = w.beginFullBox("tfhd", 0, TFHD_FLAGS);
  w.u32(header.trackId);
  w.u32(header.defaultSampleDuration);
  w.u32(header.defaultSampleSize);
  w.u32(header.defaultSampleFlags);
  w.endBox(start);
}

/* ----------------------------------------------------------------- tfdt -- */

/** Header + version/flags + a 64-bit `baseMediaDecodeTime`. */
export const TFDT_SIZE = BOX_HEADER_SIZE + 4 + 8;

/**
 * `tfdt` — Track Fragment Base Media Decode Time, research §3.5. Version 1.
 *
 *     baseMediaDecodeTime u64, in this track's own mdhd timescale
 *
 * Two things about this box are load-bearing.
 *
 * **It is not optional.** ISO/IEC 14496-12 marks it `Mandatory: No`, but the
 * W3C byte-stream format lists "at least one Track Fragment Box does not
 * contain a Track Fragment Decode Time Box" as an append-error condition — MSE
 * overrides the core spec, and a muxer that follows only the core spec's
 * reading produces segments browsers flatly refuse (research §6.2, §10). So
 * every `traf` this muxer writes has one, unconditionally.
 *
 * **Version 1, always.** The 32-bit field overflows at 2^32 timescale units,
 * which at the recommended 1e6 video timescale is 71 minutes — inside the range
 * of ordinary content. The cost of the extra four bytes per fragment is
 * nothing; the cost of the overflow is a stream that breaks only for long
 * videos, which is the worst kind of bug to find in production.
 */
export function writeTfdt(w: ByteWriter, baseMediaDecodeTime: number): void {
  const start = w.beginFullBox("tfdt", 1, 0);
  w.u64(baseMediaDecodeTime);
  w.endBox(start);
}

/* ----------------------------------------------------------------- trun -- */

export const TRUN_DATA_OFFSET_PRESENT = 0x00_0001;
export const TRUN_FIRST_SAMPLE_FLAGS_PRESENT = 0x00_0004;
export const TRUN_SAMPLE_DURATION_PRESENT = 0x00_0100;
export const TRUN_SAMPLE_SIZE_PRESENT = 0x00_0200;
export const TRUN_SAMPLE_FLAGS_PRESENT = 0x00_0400;
export const TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT = 0x00_0800;

export interface TrackRunSample {
  /** In the track's own timescale. */
  readonly duration: number;
  readonly size: number;
  readonly flags: number;
  /** Signed, in the track's own timescale. Zero unless the stream has B-frames. */
  readonly compositionOffset: number;
}

export interface TrackRun {
  readonly flags: number;
  /** From the first byte of the enclosing `moof`, because `default-base-is-moof`. */
  readonly dataOffset: number;
  readonly firstSampleFlags: number | undefined;
  readonly samples: readonly TrackRunSample[];
}

/** How many 4-byte per-sample fields `flags` asks for. */
export function trunPerSampleFieldCount(flags: number): number {
  let count = 0;
  if (flags & TRUN_SAMPLE_DURATION_PRESENT) count++;
  if (flags & TRUN_SAMPLE_SIZE_PRESENT) count++;
  if (flags & TRUN_SAMPLE_FLAGS_PRESENT) count++;
  if (flags & TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT) count++;
  return count;
}

/**
 * The serialised size of a `trun` with these flags and this many samples,
 * without serialising it. This is what makes the forward-only `data_offset`
 * computation possible — see `computeMoofSize` in media-segment.ts.
 */
export function trunSize(flags: number, sampleCount: number): number {
  const header = BOX_HEADER_SIZE + 4 + 4; // box header, version/flags, sample_count
  const dataOffset = flags & TRUN_DATA_OFFSET_PRESENT ? 4 : 0;
  const firstSampleFlags = flags & TRUN_FIRST_SAMPLE_FLAGS_PRESENT ? 4 : 0;
  return (
    header + dataOffset + firstSampleFlags + sampleCount * trunPerSampleFieldCount(flags) * 4
  );
}

/**
 * `trun` — Track Fragment Run, research §3.4. **Version 1**, always.
 *
 *     sample_count u32
 *     data_offset i32                      (flag 0x000001)
 *     first_sample_flags u32               (flag 0x000004)
 *     per sample:
 *       sample_duration u32                (flag 0x000100)
 *       sample_size u32                    (flag 0x000200)
 *       sample_flags u32                   (flag 0x000400)
 *       sample_composition_time_offset i32 (flag 0x000800)
 *
 * Version 1 makes the composition offset signed. We currently never write a
 * negative one — the encoder is configured for zero-B-frame output — but a
 * negative value in a version-0 `trun` is reinterpreted as a huge positive u32,
 * which throws a single frame ~71 minutes into the future and stalls playback
 * exactly when it reaches that frame (research §10). Version 1 costs nothing
 * and closes that off before the encoder settings ever change.
 */
export function writeTrun(w: ByteWriter, run: TrackRun): void {
  const start = w.beginFullBox("trun", 1, run.flags);
  w.u32(run.samples.length);
  if (run.flags & TRUN_DATA_OFFSET_PRESENT) w.i32(run.dataOffset);
  if (run.flags & TRUN_FIRST_SAMPLE_FLAGS_PRESENT) {
    if (run.firstSampleFlags === undefined) {
      throw new Error("trun sets first-sample-flags-present but supplied no value");
    }
    w.u32(run.firstSampleFlags);
  }
  for (const sample of run.samples) {
    if (run.flags & TRUN_SAMPLE_DURATION_PRESENT) w.u32(sample.duration);
    if (run.flags & TRUN_SAMPLE_SIZE_PRESENT) w.u32(sample.size);
    if (run.flags & TRUN_SAMPLE_FLAGS_PRESENT) w.u32(sample.flags);
    if (run.flags & TRUN_SAMPLE_COMPOSITION_TIME_OFFSETS_PRESENT) {
      w.i32(sample.compositionOffset);
    }
  }
  w.endBox(start);
}

/* ----------------------------------------------------------------- mdat -- */

/**
 * The `mdat` header, written by hand rather than through `beginBox`/`endBox`
 * because the payload length is already known and because this is the one box
 * that can plausibly need a 64-bit `largesize`:
 *
 *     size u32 = 1 / type 'mdat' / largesize u64      (payload ≥ 4 GiB)
 *     size u32 / type 'mdat'                          (otherwise)
 *
 * Returns the header size it wrote, which the caller has already predicted —
 * `mdatHeaderSize` below is the prediction, and `data_offset` depends on it
 * being right. Forgetting to add this header to the offset is named in the
 * research as the single most common cause of an off-by-N `data_offset`.
 */
export function mdatHeaderSize(payloadBytes: number): number {
  return payloadBytes + BOX_HEADER_SIZE > 0xffff_ffff
    ? LARGE_BOX_HEADER_SIZE
    : BOX_HEADER_SIZE;
}

export function writeMdatHeader(w: ByteWriter, payloadBytes: number): number {
  const headerSize = mdatHeaderSize(payloadBytes);
  if (headerSize === LARGE_BOX_HEADER_SIZE) {
    w.u32(1); // size = 1 signals a 64-bit largesize after the type
    w.fourcc("mdat");
    w.u64(payloadBytes + LARGE_BOX_HEADER_SIZE);
  } else {
    w.u32(payloadBytes + BOX_HEADER_SIZE);
    w.fourcc("mdat");
  }
  return headerSize;
}
