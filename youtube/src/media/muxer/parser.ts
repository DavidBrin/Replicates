/**
 * A minimal ISO BMFF box parser, written so the muxer's tests can read its own
 * output back.
 *
 * This exists because of what the alternative assertion looks like. "The init
 * segment is 412 bytes" passes for the wrong reasons and fails for the wrong
 * reasons: it goes red on any deliberate change and green on a `tfdt` written
 * into the wrong `traf`. What catches real bugs is walking to
 * `moov.trak.mdia.minf.stbl.stsd.avc1.avcC` and asserting its payload equals
 * the description that went in — an assertion that names the thing it is
 * checking and cannot be satisfied by a coincidence.
 *
 * It is deliberately **strict**, and strictness is most of its value. Boxes
 * must tile their parent's payload exactly: no gaps, no overrun, no trailing
 * bytes. Every declared `size` is therefore checked against the sizes of its
 * siblings and children on the way past, which makes "parse the output" a
 * recursive size audit of the whole tree rather than a courtesy. A box that
 * declares one byte too many pushes its next sibling past the parent's end and
 * throws here, at the box that lied, instead of surfacing as a decode error in
 * a browser three layers away.
 *
 * It parses only what this muxer writes. That is not a limitation to apologise
 * for — a parser that tolerated boxes we never emit would have untested paths
 * in the code that validates our tested ones.
 *
 * **The demuxer reuses this, and that shaped two additions.** `src/media/demux`
 * reads progressive files nobody here wrote, which need boxes this muxer never
 * emits (`edts`, `hvc1`) and a header decoder it can point at sixteen bytes
 * pulled off a `Blob` rather than at a whole buffer. Both are additive:
 * `parseBoxes` takes *extra* container types per call, so the default set below
 * is still exactly what this muxer writes, and `readBoxHeader` is the header
 * decoder `parseRange` was already using, lifted out so there is one of it
 * rather than two.
 */

/* --------------------------------------------------------------- shapes -- */

export interface ParsedBox {
  readonly type: string;
  /** Absolute offset of this box's first byte within the buffer that was parsed. */
  readonly offset: number;
  /** The declared `size`, header included. */
  readonly size: number;
  /** 8, or 16 when the box used a 64-bit `largesize`. */
  readonly headerSize: number;
  /**
   * Absolute offset where children begin. For a leaf this equals the end of the
   * box; for a container with a fixed prefix (`stsd`, a sample entry) it is
   * past that prefix.
   */
  readonly childrenOffset: number;
  /** Everything after the header, to the end of the box. */
  readonly payload: Uint8Array;
  readonly children: readonly ParsedBox[];
}

/**
 * Container boxes, and how many payload bytes precede their children.
 *
 * Zero for a pure container. `stsd` and `dref` carry a `FullBox` header and an
 * entry count first. A sample entry carries the common 8-byte `SampleEntry`
 * prefix plus its type-specific body — 70 more bytes for a `VisualSampleEntry`,
 * 20 for an `AudioSampleEntry` (research §2) — before its codec configuration
 * box. Those two numbers are the parser's only structural assumption, and they
 * hold because nothing in either body is variable-length.
 */
const CONTAINER_PREFIXES: ReadonlyMap<string, number> = new Map([
  ["moov", 0],
  ["trak", 0],
  ["mdia", 0],
  ["minf", 0],
  ["dinf", 0],
  ["stbl", 0],
  ["mvex", 0],
  ["moof", 0],
  ["traf", 0],
  ["stsd", 8],
  ["dref", 8],
  ["avc1", 78],
  ["vp09", 78],
  ["av01", 78],
  ["mp4a", 28],
]);

/* --------------------------------------------------------------- parsing -- */

function readFourcc(view: DataView, at: number): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += String.fromCharCode(view.getUint8(at + i));
  return code;
}

export interface BoxHeader {
  readonly type: string;
  /**
   * The declared total size, header included. **Zero is passed through**, not
   * rejected: `size == 0` means "to the end of the enclosing container"
   * `[BMFF §4.2]`, and only the caller knows where that end is. `parseRange`
   * refuses it (see below); the demuxer's top-level walk resolves it against
   * the file length.
   */
  readonly size: number;
  /** 8, or 16 when the box used a 64-bit `largesize`. */
  readonly headerSize: number;
}

/**
 * Decodes one box header at `at`, reading no further than `end`.
 *
 * Split out of `parseRange` so the demuxer can decode a header from sixteen
 * bytes read off a `Blob` without materialising the gigabyte behind it.
 * `baseOffset` only appears in error messages, so that a header read from a
 * slab of a large file still reports where in the *file* the bad box is.
 */
export function readBoxHeader(
  view: DataView,
  at: number,
  end: number,
  baseOffset = 0,
): BoxHeader {
  if (end - at < 8) {
    throw new Error(
      `Truncated box at ${baseOffset + at}: ${end - at} bytes left, a header needs 8`,
    );
  }
  const declared = view.getUint32(at);
  const type = readFourcc(view, at + 4);

  if (declared !== 1) return { type, size: declared, headerSize: 8 };

  // size == 1 means a 64-bit `largesize` follows the type code.
  if (end - at < 16) {
    throw new Error(`Truncated largesize header for "${type}" at ${baseOffset + at}`);
  }
  const large = view.getBigUint64(at + 8);
  if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Box "${type}" at ${baseOffset + at} declares an unreadable largesize`);
  }
  return { type, size: Number(large), headerSize: 16 };
}

/**
 * Container types the demuxer adds on top of {@link CONTAINER_PREFIXES}, or any
 * other caller's equivalent. Same shape: type code → payload bytes before the
 * children start.
 */
export interface ParseOptions {
  readonly extraContainers?: ReadonlyMap<string, number>;
}

/**
 * Parses a run of sibling boxes that must exactly fill `[start, end)`.
 *
 * `baseOffset` is the absolute position of `bytes[0]`, so that every reported
 * offset is into the original buffer no matter how deep the recursion is —
 * which is what lets a test compute `trun.data_offset` against the real
 * position of `mdat` rather than against a relative one it would have to
 * reconstruct.
 */
function parseRange(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  baseOffset: number,
  extraContainers: ReadonlyMap<string, number> | undefined,
): ParsedBox[] {
  const boxes: ParsedBox[] = [];
  let at = start;

  while (at < end) {
    const { type, size, headerSize } = readBoxHeader(view, at, end, baseOffset);

    if (size === 0) {
      // "extends to end of file" — legal ISO BMFF, never emitted by this muxer,
      // and accepting it would mean this parser could not detect a zeroed size.
      throw new Error(`Box "${type}" at ${baseOffset + at} declares size 0`);
    }

    if (size < headerSize) {
      throw new Error(
        `Box "${type}" at ${baseOffset + at} declares size ${size}, below its ${headerSize}-byte header`,
      );
    }
    if (at + size > end) {
      throw new Error(
        `Box "${type}" at ${baseOffset + at} declares size ${size} and overruns its parent by ${at + size - end} bytes`,
      );
    }

    const prefix = extraContainers?.get(type) ?? CONTAINER_PREFIXES.get(type);
    const childrenAt = at + headerSize + (prefix ?? 0);
    if (prefix !== undefined && childrenAt > at + size) {
      throw new Error(
        `Container "${type}" at ${baseOffset + at} is ${size} bytes, too small for its ${prefix}-byte prefix`,
      );
    }

    boxes.push({
      type,
      offset: baseOffset + at,
      size,
      headerSize,
      childrenOffset: baseOffset + (prefix === undefined ? at + size : childrenAt),
      payload: bytes.subarray(at + headerSize, at + size),
      children:
        prefix === undefined
          ? []
          : parseRange(bytes, view, childrenAt, at + size, baseOffset, extraContainers),
    });

    at += size;
  }

  return boxes;
}

/** Parses a buffer of top-level boxes, which must tile it exactly. */
export function parseBoxes(
  bytes: Uint8Array,
  baseOffset = 0,
  options: ParseOptions = {},
): ParsedBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return parseRange(bytes, view, 0, bytes.byteLength, baseOffset, options.extraContainers);
}

/* ------------------------------------------------------------- navigation -- */

/**
 * Walks a dotted path: `"moov.trak.mdia.minf.stbl.stsd.avc1.avcC"`.
 *
 * A repeated type is indexed — `"moov.trak[1].tkhd"` is the audio track — since
 * a movie with two `trak`s is exactly where a path that silently took the first
 * match would assert the wrong thing and pass.
 */
export function findBox(boxes: readonly ParsedBox[], path: string): ParsedBox | undefined {
  let current: readonly ParsedBox[] = boxes;
  let found: ParsedBox | undefined;

  for (const segment of path.split(".")) {
    const match = /^([\w ]{4})(?:\[(\d+)\])?$/.exec(segment);
    if (!match) throw new Error(`"${segment}" is not a box type, optionally indexed`);
    const [, type, index] = match;
    const wanted = index === undefined ? 0 : Number.parseInt(index, 10);

    const candidates = current.filter((box) => box.type === type);
    found = candidates[wanted];
    if (found === undefined) return undefined;
    current = found.children;
  }

  return found;
}

/** `findBox`, but a missing box is a failure rather than an `undefined`. */
export function requireBox(boxes: readonly ParsedBox[], path: string): ParsedBox {
  const box = findBox(boxes, path);
  if (box === undefined) {
    throw new Error(`No box at "${path}" in tree:\n${formatBoxTree(boxes)}`);
  }
  return box;
}

/** Every box in the tree, parents before children. */
export function flattenBoxes(boxes: readonly ParsedBox[]): ParsedBox[] {
  const flat: ParsedBox[] = [];
  const visit = (nodes: readonly ParsedBox[]): void => {
    for (const node of nodes) {
      flat.push(node);
      visit(node.children);
    }
  };
  visit(boxes);
  return flat;
}

/** The box tree, one line per box, indented by depth. */
export function formatBoxTree(boxes: readonly ParsedBox[], depth = 0): string {
  return boxes
    .map((box) => {
      const line = `${"  ".repeat(depth)}${box.type} size=${box.size}`;
      const children = box.children.length > 0 ? `\n${formatBoxTree(box.children, depth + 1)}` : "";
      return line + children;
    })
    .join("\n");
}

/* ---------------------------------------------------------------- fields -- */

/** A cursor over a box payload. Big-endian, like everything else here. */
export class BoxReader {
  #view: DataView;
  #at = 0;

  constructor(payload: Uint8Array) {
    this.#view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  get offset(): number {
    return this.#at;
  }

  /**
   * Payload bytes left to read.
   *
   * The demuxer needs this *before* it trusts an `entry_count`. A corrupt
   * `stts` declaring 2^32 entries is not a `RangeError` four billion iterations
   * later — it is a table whose declared size exceeds the box that contains it,
   * which is checkable in one comparison and is the difference between failing
   * cleanly and hanging.
   */
  get remaining(): number {
    return this.#view.byteLength - this.#at;
  }

  u8(): number {
    return this.#view.getUint8(this.#at++);
  }

  u16(): number {
    const value = this.#view.getUint16(this.#at);
    this.#at += 2;
    return value;
  }

  u24(): number {
    return (this.u8() << 16) | (this.u8() << 8) | this.u8();
  }

  u32(): number {
    const value = this.#view.getUint32(this.#at);
    this.#at += 4;
    return value;
  }

  i16(): number {
    const value = this.#view.getInt16(this.#at);
    this.#at += 2;
    return value;
  }

  i32(): number {
    const value = this.#view.getInt32(this.#at);
    this.#at += 4;
    return value;
  }

  u64(): number {
    const value = this.#view.getBigUint64(this.#at);
    this.#at += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`64-bit field ${value} exceeds 2^53 and cannot be read as a number`);
    }
    return Number(value);
  }

  /**
   * `elst`'s version-1 `media_time` is the format's only signed 64-bit field,
   * and its sign carries meaning: **-1 marks an empty edit**, the encoder's way
   * of saying "delay this track" rather than "start it here". Read unsigned it
   * becomes 2^64 − 1 and the edit looks like a seek past the end of time.
   */
  i64(): number {
    const value = this.#view.getBigInt64(this.#at);
    this.#at += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`64-bit field ${value} exceeds 2^53 and cannot be read as a number`);
    }
    return Number(value);
  }

  fourcc(): string {
    const code = readFourcc(this.#view, this.#at);
    this.#at += 4;
    return code;
  }

  skip(count: number): void {
    this.#at += count;
  }
}

export interface FullBoxHeader {
  readonly version: number;
  readonly flags: number;
}

export function readFullBoxHeader(box: ParsedBox): FullBoxHeader {
  const r = new BoxReader(box.payload);
  return { version: r.u8(), flags: r.u24() };
}

/* -------------------------------------------------------- typed decoders -- */

export interface ParsedFtyp {
  readonly majorBrand: string;
  readonly minorVersion: number;
  readonly compatibleBrands: readonly string[];
}

export function parseFtyp(box: ParsedBox): ParsedFtyp {
  const r = new BoxReader(box.payload);
  const majorBrand = r.fourcc();
  const minorVersion = r.u32();
  const compatibleBrands: string[] = [];
  while (r.offset < box.payload.byteLength) compatibleBrands.push(r.fourcc());
  return { majorBrand, minorVersion, compatibleBrands };
}

export interface ParsedMvhd {
  readonly version: number;
  readonly timescale: number;
  readonly duration: number;
  readonly rate: number;
  readonly matrix: readonly number[];
  readonly nextTrackId: number;
}

export function parseMvhd(box: ParsedBox): ParsedMvhd {
  const r = new BoxReader(box.payload);
  const version = r.u8();
  r.u24();
  if (version === 1) {
    r.u64();
    r.u64();
  } else {
    r.u32();
    r.u32();
  }
  const timescale = r.u32();
  const duration = version === 1 ? r.u64() : r.u32();
  const rate = r.i32();
  r.i16(); // volume
  r.skip(2 + 8); // reserved
  const matrix: number[] = [];
  for (let i = 0; i < 9; i++) matrix.push(r.u32());
  r.skip(24); // pre_defined
  return { version, timescale, duration, rate, matrix, nextTrackId: r.u32() };
}

export interface ParsedTkhd {
  readonly version: number;
  readonly flags: number;
  readonly trackId: number;
  /** In the **movie** timescale — research §1.6. */
  readonly duration: number;
  readonly volume: number;
  readonly matrix: readonly number[];
  /** 16.16 fixed point, decoded. */
  readonly width: number;
  readonly height: number;
}

export function parseTkhd(box: ParsedBox): ParsedTkhd {
  const r = new BoxReader(box.payload);
  const version = r.u8();
  const flags = r.u24();
  if (version === 1) {
    r.u64();
    r.u64();
  } else {
    r.u32();
    r.u32();
  }
  const trackId = r.u32();
  r.u32(); // reserved
  const duration = version === 1 ? r.u64() : r.u32();
  r.skip(8); // reserved
  r.i16(); // layer
  r.i16(); // alternate_group
  const volume = r.i16() / 0x100;
  r.skip(2); // reserved
  const matrix: number[] = [];
  for (let i = 0; i < 9; i++) matrix.push(r.u32());
  return {
    version,
    flags,
    trackId,
    duration,
    volume,
    matrix,
    width: r.u32() / 0x1_0000,
    height: r.u32() / 0x1_0000,
  };
}

export interface ParsedMdhd {
  readonly version: number;
  /** **This track's own** timescale — research §1.7. */
  readonly timescale: number;
  /** In the timescale above. */
  readonly duration: number;
  /** The three unpacked ISO-639-2/T characters. */
  readonly language: string;
}

export function parseMdhd(box: ParsedBox): ParsedMdhd {
  const r = new BoxReader(box.payload);
  const version = r.u8();
  r.u24();
  if (version === 1) {
    r.u64();
    r.u64();
  } else {
    r.u32();
    r.u32();
  }
  const timescale = r.u32();
  const duration = version === 1 ? r.u64() : r.u32();
  const packed = r.u16();
  const language = [10, 5, 0]
    .map((shift) => String.fromCharCode(((packed >> shift) & 0x1f) + 0x60))
    .join("");
  return { version, timescale, duration, language };
}

export interface ParsedHdlr {
  readonly handlerType: string;
  readonly name: string;
}

export function parseHdlr(box: ParsedBox): ParsedHdlr {
  const r = new BoxReader(box.payload);
  r.u8();
  r.u24();
  r.u32(); // pre_defined
  const handlerType = r.fourcc();
  r.skip(12); // reserved
  let name = "";
  while (r.offset < box.payload.byteLength) {
    const char = r.u8();
    if (char === 0) break;
    name += String.fromCharCode(char);
  }
  return { handlerType, name };
}

export interface ParsedStsd {
  readonly entryCount: number;
  readonly entries: readonly ParsedBox[];
}

export function parseStsd(box: ParsedBox): ParsedStsd {
  const r = new BoxReader(box.payload);
  r.u8();
  r.u24();
  return { entryCount: r.u32(), entries: box.children };
}

export interface ParsedVisualSampleEntry {
  readonly dataReferenceIndex: number;
  readonly width: number;
  readonly height: number;
  readonly horizontalResolution: number;
  readonly verticalResolution: number;
  readonly frameCount: number;
  readonly depth: number;
}

export function parseVisualSampleEntry(box: ParsedBox): ParsedVisualSampleEntry {
  const r = new BoxReader(box.payload);
  r.skip(6); // reserved
  const dataReferenceIndex = r.u16();
  r.skip(2 + 2 + 12); // pre_defined, reserved, pre_defined
  const width = r.u16();
  const height = r.u16();
  const horizontalResolution = r.u32() / 0x1_0000;
  const verticalResolution = r.u32() / 0x1_0000;
  r.u32(); // reserved
  const frameCount = r.u16();
  r.skip(32); // compressorname
  return {
    dataReferenceIndex,
    width,
    height,
    horizontalResolution,
    verticalResolution,
    frameCount,
    depth: r.u16(),
  };
}

export interface ParsedAudioSampleEntry {
  readonly dataReferenceIndex: number;
  readonly channelCount: number;
  readonly sampleSize: number;
  /** Decoded from the 16.16 field, so `48000` rather than `0xBB800000`. */
  readonly sampleRate: number;
}

export function parseAudioSampleEntry(box: ParsedBox): ParsedAudioSampleEntry {
  const r = new BoxReader(box.payload);
  r.skip(6); // reserved
  const dataReferenceIndex = r.u16();
  r.skip(2 + 2 + 4); // version, revision_level, vendor
  const channelCount = r.u16();
  const sampleSize = r.u16();
  r.skip(2 + 2); // compression_id, packet_size
  return {
    dataReferenceIndex,
    channelCount,
    sampleSize,
    sampleRate: r.u32() / 0x1_0000,
  };
}

export interface ParsedTrex {
  readonly trackId: number;
  readonly defaultSampleDescriptionIndex: number;
  readonly defaultSampleDuration: number;
  readonly defaultSampleSize: number;
  readonly defaultSampleFlags: number;
}

export function parseTrex(box: ParsedBox): ParsedTrex {
  const r = new BoxReader(box.payload);
  r.u8();
  r.u24();
  return {
    trackId: r.u32(),
    defaultSampleDescriptionIndex: r.u32(),
    defaultSampleDuration: r.u32(),
    defaultSampleSize: r.u32(),
    defaultSampleFlags: r.u32(),
  };
}

export function parseMfhd(box: ParsedBox): { readonly sequenceNumber: number } {
  const r = new BoxReader(box.payload);
  r.u8();
  r.u24();
  return { sequenceNumber: r.u32() };
}

export interface ParsedTfhd {
  readonly flags: number;
  readonly trackId: number;
  readonly baseDataOffset: number | undefined;
  readonly sampleDescriptionIndex: number | undefined;
  readonly defaultSampleDuration: number | undefined;
  readonly defaultSampleSize: number | undefined;
  readonly defaultSampleFlags: number | undefined;
}

export function parseTfhd(box: ParsedBox): ParsedTfhd {
  const r = new BoxReader(box.payload);
  r.u8();
  const flags = r.u24();
  const trackId = r.u32();
  return {
    flags,
    trackId,
    baseDataOffset: flags & 0x00_0001 ? r.u64() : undefined,
    sampleDescriptionIndex: flags & 0x00_0002 ? r.u32() : undefined,
    defaultSampleDuration: flags & 0x00_0008 ? r.u32() : undefined,
    defaultSampleSize: flags & 0x00_0010 ? r.u32() : undefined,
    defaultSampleFlags: flags & 0x00_0020 ? r.u32() : undefined,
  };
}

export interface ParsedTfdt {
  readonly version: number;
  readonly baseMediaDecodeTime: number;
}

export function parseTfdt(box: ParsedBox): ParsedTfdt {
  const r = new BoxReader(box.payload);
  const version = r.u8();
  r.u24();
  return { version, baseMediaDecodeTime: version === 1 ? r.u64() : r.u32() };
}

export interface ParsedTrunSample {
  readonly duration: number | undefined;
  readonly size: number | undefined;
  readonly flags: number | undefined;
  readonly compositionOffset: number | undefined;
}

export interface ParsedTrun {
  readonly version: number;
  readonly flags: number;
  readonly sampleCount: number;
  readonly dataOffset: number | undefined;
  readonly firstSampleFlags: number | undefined;
  readonly samples: readonly ParsedTrunSample[];
}

/**
 * Decodes a `trun`, keeping absent optional fields as `undefined` rather than
 * substituting the `tfhd` default. A test that wants the effective value has to
 * reach for the default explicitly, which is the point: "the size is 4096" and
 * "the size field is absent and the default is 4096" are different facts, and a
 * parser that merged them could not tell a missing flag bit from a present one.
 */
export function parseTrun(box: ParsedBox): ParsedTrun {
  const r = new BoxReader(box.payload);
  const version = r.u8();
  const flags = r.u24();
  const sampleCount = r.u32();
  const dataOffset = flags & 0x00_0001 ? r.i32() : undefined;
  const firstSampleFlags = flags & 0x00_0004 ? r.u32() : undefined;

  const samples: ParsedTrunSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    samples.push({
      duration: flags & 0x00_0100 ? r.u32() : undefined,
      size: flags & 0x00_0200 ? r.u32() : undefined,
      flags: flags & 0x00_0400 ? r.u32() : undefined,
      // Version 1 makes this signed; version 0 leaves it unsigned. Reading it
      // with the wrong signedness is the reader-side half of the bug in §10.
      compositionOffset:
        flags & 0x00_0800 ? (version === 1 ? r.i32() : r.u32()) : undefined,
    });
  }

  return { version, flags, sampleCount, dataOffset, firstSampleFlags, samples };
}
