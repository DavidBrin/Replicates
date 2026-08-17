/**
 * The byte writer every box in this muxer is serialised through.
 *
 * ISO BMFF is big-endian throughout — "network order" — and every field is a
 * fixed-width integer at a fixed offset (research/02-fmp4-hls-packaging.md,
 * preamble). So this is deliberately not a general-purpose buffer library: it
 * is a cursor with one method per field width the format actually uses, which
 * lets a box constructor in `boxes.ts` read as the spec's own field table, top
 * to bottom, with nothing between the table and the bytes.
 *
 * Three design points, each with a plausible alternative that was rejected:
 *
 * **Growth by doubling into a fresh `ArrayBuffer`, not a resizable one.** An
 * `ArrayBuffer` with `maxByteLength` would avoid the copies, but its `DataView`
 * bounds-checks against a length that can move underneath it, and we would
 * still have to pick a ceiling. The copy happens O(log n) times per segment.
 * Not measured, and deliberately so: the number cannot matter at these sizes,
 * and pretending to have measured it would be worse than admitting that.
 *
 * **Box sizes are back-patched; forward offsets are not.** A box header must
 * declare its own total length before its children exist, so `beginBox` /
 * `endBox` record the header position and overwrite the size field once the box
 * closes. That is purely local bookkeeping over bytes already written — no
 * seeking, no second pass, no output withheld. The one field that genuinely
 * points at bytes that do not exist yet, `trun.data_offset`, is deliberately
 * NOT handled this way; `media-segment.ts` explains why it is computed
 * analytically instead (research §3.6, resolution A).
 *
 * **`finish()` hands back a buffer the output exactly fills.** The tempting
 * shape is to always return `subarray(0, length)` and never copy — a media
 * segment is mostly `mdat`, and copying it would double peak memory for no
 * gain. But a `Uint8Array` that is a *window* onto a larger buffer is a foot-gun
 * for every downstream consumer that reaches for `.buffer`, and these bytes are
 * the artifact five other slices handle. So the view is returned only when it
 * spans the whole allocation, and a right-sized copy otherwise. `buildMediaSegment`
 * sizes its writer exactly, so the large case never copies; an init segment is
 * a few hundred bytes and copies once.
 */

/** Every ISO BMFF type code is exactly four characters. */
const FOURCC_LENGTH = 4;

/** `size` and `type` — the header every box starts with `[BMFF §4.2]`. */
export const BOX_HEADER_SIZE = 8;

/**
 * A box whose `size` is `1` carries a 64-bit `largesize` after the type code
 * instead `[BMFF §4.2]`. Only `mdat` can plausibly need it here, and only for a
 * fragment past 4 GiB.
 */
export const LARGE_BOX_HEADER_SIZE = 16;

const U32_MAX = 0xffff_ffff;

export class ByteWriter {
  #bytes: Uint8Array;
  #view: DataView;
  #length = 0;
  #finished = false;

  constructor(initialCapacity = 8192) {
    const buffer = new ArrayBuffer(Math.max(64, initialCapacity));
    this.#bytes = new Uint8Array(buffer);
    this.#view = new DataView(buffer);
  }

  /** Bytes written so far. Also the offset the next write lands at. */
  get length(): number {
    return this.#length;
  }

  #reserve(extra: number): number {
    if (this.#finished) {
      throw new Error("ByteWriter: written to after finish()");
    }
    const needed = this.#length + extra;
    if (needed > this.#bytes.byteLength) {
      let capacity = this.#bytes.byteLength;
      while (capacity < needed) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.#bytes);
      this.#bytes = grown;
      this.#view = new DataView(grown.buffer);
    }
    const at = this.#length;
    this.#length = needed;
    return at;
  }

  /* --------------------------------------------------------- primitives -- */

  /*
   * Every method below takes the offset from `#reserve` on its own line before
   * touching `#view`. That is not a style preference. Written as
   * `this.#view.setUint16(this.#reserve(2), value)` the member expression is
   * evaluated before the argument, so a `#reserve` call that grows the buffer
   * replaces `#view` *after* the old one has already been captured — and the
   * write lands in the abandoned buffer, or throws, depending on where the
   * boundary fell. The suite caught this on the growth case and nowhere else.
   */

  u8(value: number): void {
    const at = this.#reserve(1);
    this.#view.setUint8(at, value);
  }

  u16(value: number): void {
    const at = this.#reserve(2);
    this.#view.setUint16(at, value);
  }

  /**
   * The 24-bit `flags` half of a `FullBox` header, and nothing else — ISO BMFF
   * has no other 24-bit field. `DataView` has no `setUint24`, so it is three
   * explicit bytes, most significant first.
   */
  u24(value: number): void {
    const at = this.#reserve(3);
    this.#view.setUint8(at, (value >>> 16) & 0xff);
    this.#view.setUint8(at + 1, (value >>> 8) & 0xff);
    this.#view.setUint8(at + 2, value & 0xff);
  }

  u32(value: number): void {
    const at = this.#reserve(4);
    this.#view.setUint32(at, value);
  }

  i16(value: number): void {
    const at = this.#reserve(2);
    this.#view.setInt16(at, value);
  }

  /** `trun.data_offset` and `sample_composition_time_offset` are both signed. */
  i32(value: number): void {
    const at = this.#reserve(4);
    this.#view.setInt32(at, value);
  }

  /**
   * `tfdt` version 1 and `mdat`'s `largesize` are the only 64-bit fields we
   * write. The safe-integer guard is not defensive noise: a `baseMediaDecodeTime`
   * past 2^53 would silently lose its low bits crossing `BigInt`, and the
   * symptom would be a seek that lands in the wrong place hours into a stream.
   */
  u64(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`ByteWriter: ${value} is not a safe unsigned 64-bit value`);
    }
    const at = this.#reserve(8);
    this.#view.setBigUint64(at, BigInt(value));
  }

  /** A four-character type code or brand, ASCII. `"url "` has a real space. */
  fourcc(code: string): void {
    if (code.length !== FOURCC_LENGTH) {
      throw new Error(`ByteWriter: fourcc "${code}" is not 4 characters`);
    }
    const at = this.#reserve(FOURCC_LENGTH);
    for (let i = 0; i < FOURCC_LENGTH; i++) {
      const char = code.charCodeAt(i);
      if (char > 0x7f) {
        throw new Error(`ByteWriter: fourcc "${code}" is not ASCII`);
      }
      this.#view.setUint8(at + i, char);
    }
  }

  /**
   * The two methods below are the ones the note above was written about, and
   * for a while they were the two that ignored it.
   *
   * `this.#bytes.set(source, this.#reserve(n))` reads as though the reserve
   * happens first, because it is written first left-to-right *inside* the
   * call. It does not. JavaScript evaluates the callee — `this.#bytes.set`,
   * and with it the `this` the method will run against — before it evaluates
   * any argument, so a `#reserve` that grows the buffer swaps `#bytes` for a
   * new array *after* `set` has already bound the old one. The write lands in
   * the abandoned buffer and is silently dropped, or throws `RangeError`,
   * depending on whether the old array happened to be long enough.
   *
   * Neither case was reachable from the test suite: `ByteWriter` is
   * constructed with a capacity that fits every init segment this project
   * writes, so no `bytes()` call had ever crossed a growth boundary. A codec
   * description a few hundred bytes long — an `avcC` for a high-profile
   * stream, or any `hvcC` — is all it takes.
   *
   * **`zeros()` had the identical shape and was harmless**, which is worth
   * recording rather than quietly fixing. `fill` clamps out-of-range indices
   * instead of throwing, so the write to the abandoned array did nothing —
   * and the grown array it should have written to is a fresh `Uint8Array`,
   * already zero. The bug and its absence of symptoms coincided exactly. It is
   * corrected because the next person to copy this line will not be filling
   * with zero, and the growth test below cannot tell the two versions apart.
   */
  bytes(source: Uint8Array): void {
    const at = this.#reserve(source.byteLength);
    this.#bytes.set(source, at);
  }

  /** Reserved and pre_defined runs, which ISO BMFF has a great many of. */
  zeros(count: number): void {
    const at = this.#reserve(count);
    this.#bytes.fill(0, at, this.#length);
  }

  /* -------------------------------------------------------- fixed point -- */

  /**
   * 16.16 fixed point: `mvhd.rate`, `tkhd.width`/`height`, the visual sample
   * entry's resolutions, and six of the nine matrix cells `[BMFF §8.2.2.2]`.
   */
  fixed16_16(value: number): void {
    this.u32(Math.round(value * 0x1_0000));
  }

  /**
   * 8.8 fixed point: `mvhd.volume`, `tkhd.volume`, `smhd.balance`. Signed —
   * `smhd.balance` is negative for a leftward pan.
   */
  fixed8_8(value: number): void {
    this.i16(Math.round(value * 0x100));
  }

  /* -------------------------------------------------------------- boxes -- */

  /**
   * Opens a box: writes a placeholder `size` and the type code, and hands back
   * the offset to close it at. Layout, in order:
   *
   *     size: u32   (patched by endBox)
   *     type: 4 chars
   */
  beginBox(type: string): number {
    const start = this.#length;
    this.u32(0);
    this.fourcc(type);
    return start;
  }

  /**
   * Opens a `FullBox`: a box plus a version byte and 24 flag bits
   * `[BMFF §4.2]`. Every box in this muxer is one or the other and the
   * distinction is load-bearing — `ftyp`, `moov`, `trak` and the sample entries
   * are plain boxes, and writing a version/flags word into one of those shifts
   * every field after it by four bytes.
   */
  beginFullBox(type: string, version: number, flags: number): number {
    const start = this.beginBox(type);
    this.u8(version);
    this.u24(flags);
    return start;
  }

  /** Back-patches the `size` field written by `beginBox`. */
  endBox(start: number): void {
    const size = this.#length - start;
    if (size > U32_MAX) {
      throw new Error(
        `ByteWriter: box at ${start} is ${size} bytes and needs a 64-bit largesize`,
      );
    }
    this.#view.setUint32(start, size);
  }

  /* ------------------------------------------------------------- output -- */

  /**
   * The bytes written, in a buffer they exactly fill — so `result.buffer` is
   * the output and nothing else. The writer is dead afterwards: any further
   * write throws rather than mutating a buffer somebody else now holds.
   */
  finish(): Uint8Array {
    this.#finished = true;
    if (this.#length === this.#bytes.byteLength) return this.#bytes;
    return this.#bytes.slice(0, this.#length);
  }
}
