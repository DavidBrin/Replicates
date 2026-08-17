// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ByteWriter } from "../writer";

/**
 * The writer is the one place where an endianness mistake would be invisible
 * everywhere else — every box would still have the right *shape*, with the
 * right number of bytes in the right places, and every field would read back as
 * a byte-swapped number. So these tests assert the bytes, literally, rather
 * than round-tripping through a reader that could share the same bug.
 *
 * The box-header cases matter for a different reason. `beginBox`/`endBox` is
 * the only back-patching in this muxer, and a size patched at the wrong offset
 * corrupts whatever field happens to live there instead — a `moov` whose first
 * child's size is overwritten, say, which parses as a completely different tree
 * rather than as an error.
 */

function written(build: (w: ByteWriter) => void, capacity?: number): Uint8Array {
  const w = new ByteWriter(capacity);
  build(w);
  return w.finish();
}

describe("integer primitives", () => {
  it("writes unsigned integers most significant byte first", () => {
    expect([...written((w) => w.u8(0xab))]).toEqual([0xab]);
    expect([...written((w) => w.u16(0x1234))]).toEqual([0x12, 0x34]);
    expect([...written((w) => w.u24(0x020038))]).toEqual([0x02, 0x00, 0x38]);
    expect([...written((w) => w.u32(0x01020304))]).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it("writes the sample-flags words the spec calls for", () => {
    // 0x02000000 (sync) and 0x01010000 (non-sync) — research §4.
    expect([...written((w) => w.u32(0x02000000))]).toEqual([0x02, 0x00, 0x00, 0x00]);
    expect([...written((w) => w.u32(0x01010000))]).toEqual([0x01, 0x01, 0x00, 0x00]);
  });

  it("writes signed integers in two's complement, big-endian", () => {
    // `pre_defined = -1` in every VisualSampleEntry.
    expect([...written((w) => w.i16(-1))]).toEqual([0xff, 0xff]);
    expect([...written((w) => w.i32(-2))]).toEqual([0xff, 0xff, 0xff, 0xfe]);
    // A plausible `trun.data_offset`, which is signed but positive in practice.
    expect([...written((w) => w.i32(120))]).toEqual([0x00, 0x00, 0x00, 0x78]);
  });

  it("writes 64-bit values, which is what tfdt version 1 needs", () => {
    expect([...written((w) => w.u64(0))]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // 2 hours at a 1e6 timescale — past 2^32, which is the whole reason for v1.
    expect([...written((w) => w.u64(7_200_000_000))]).toEqual([
      0x00, 0x00, 0x00, 0x01, 0xad, 0x27, 0x48, 0x00,
    ]);
  });

  it("refuses a 64-bit value that cannot survive the round trip", () => {
    expect(() => written((w) => w.u64(Number.MAX_SAFE_INTEGER + 2))).toThrow(/safe unsigned/);
    expect(() => written((w) => w.u64(-1))).toThrow(/safe unsigned/);
  });
});

describe("fourcc", () => {
  it("writes four ASCII characters", () => {
    expect([...written((w) => w.fourcc("moof"))]).toEqual([0x6d, 0x6f, 0x6f, 0x66]);
  });

  it("keeps the trailing space in the `url ` box type", () => {
    // The space is part of the type code, not padding — research §1.9.
    expect([...written((w) => w.fourcc("url "))]).toEqual([0x75, 0x72, 0x6c, 0x20]);
  });

  it("rejects a type code that is not exactly four characters", () => {
    expect(() => written((w) => w.fourcc("url"))).toThrow(/4 characters/);
    expect(() => written((w) => w.fourcc("moovv"))).toThrow(/4 characters/);
  });

  it("rejects a non-ASCII type code", () => {
    expect(() => written((w) => w.fourcc("moöv"))).toThrow(/ASCII/);
  });
});

describe("fixed point", () => {
  it("writes 16.16 values", () => {
    // `mvhd.rate` = 1.0, and the 72dpi resolutions in a VisualSampleEntry.
    expect([...written((w) => w.fixed16_16(1))]).toEqual([0x00, 0x01, 0x00, 0x00]);
    expect([...written((w) => w.fixed16_16(72))]).toEqual([0x00, 0x48, 0x00, 0x00]);
    expect([...written((w) => w.fixed16_16(1920))]).toEqual([0x07, 0x80, 0x00, 0x00]);
  });

  it("writes 8.8 values, signed", () => {
    expect([...written((w) => w.fixed8_8(1))]).toEqual([0x01, 0x00]);
    expect([...written((w) => w.fixed8_8(0))]).toEqual([0x00, 0x00]);
    expect([...written((w) => w.fixed8_8(-1))]).toEqual([0xff, 0x00]);
  });
});

describe("bulk writes", () => {
  it("copies a byte array verbatim", () => {
    const description = Uint8Array.from([0x01, 0x64, 0x00, 0x28]);
    expect([...written((w) => w.bytes(description))]).toEqual([0x01, 0x64, 0x00, 0x28]);
  });

  it("writes runs of zeros for reserved fields", () => {
    expect([...written((w) => w.zeros(6))]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("grows without losing or reordering anything already written", () => {
    // Deliberately far past the minimum capacity, so growth happens repeatedly.
    const bytes = written((w) => {
      for (let i = 0; i < 5000; i++) w.u16(i & 0xffff);
    }, 1);

    expect(bytes.byteLength).toBe(10_000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 5000; i++) {
      expect(view.getUint16(i * 2)).toBe(i & 0xffff);
    }
  });

  /**
   * The growth test above passes with `bytes()` broken, and that is the point
   * of these two.
   *
   * `u16` and friends take the offset from `#reserve` into a local before
   * touching `#view`, so growth is safe for them. `bytes()` and `zeros()` used
   * to be written as `this.#bytes.set(source, this.#reserve(n))`, where the
   * receiver is evaluated first and a growing reserve then replaces it — the
   * write went to the abandoned array. Nothing here reached that path, because
   * the default capacity fits every segment this project writes and the only
   * growth case in the suite used primitives.
   *
   * So the case below starts from a capacity of 1 and hands over a payload
   * that cannot fit. Reintroducing the old line makes it throw `RangeError` —
   * checked, not assumed.
   *
   * The `zeros()` case that follows is **not** a regression test and is
   * labelled so it is never mistaken for one. Under the old line it passed
   * too: `fill` clamps rather than throwing, and the buffer it should have
   * written to was freshly allocated and already zero. It is kept because it
   * pins the offset arithmetic — a `fill` starting one byte early would eat
   * the marker — but the correctness of `zeros()` rests on reading the code,
   * not on this assertion.
   */
  it("copies a byte array that forces the buffer to grow", () => {
    const payload = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
    const bytes = written((w) => w.bytes(payload), 1);

    expect(bytes.byteLength).toBe(300);
    expect([...bytes]).toEqual([...payload]);
  });

  it("writes a zero run that forces the buffer to grow", () => {
    // Preceded by a marker byte: a `fill` against a stale receiver would leave
    // the tail untouched, and a `fill` with the wrong start would eat this.
    const bytes = written((w) => {
      w.u8(0xab);
      w.zeros(300);
    }, 1);

    expect(bytes.byteLength).toBe(301);
    expect(bytes[0]).toBe(0xab);
    expect(bytes.subarray(1).every((b) => b === 0)).toBe(true);
  });
});

describe("box headers", () => {
  it("back-patches a box size over the placeholder", () => {
    const bytes = written((w) => {
      const start = w.beginBox("mdat");
      w.u32(0xdeadbeef);
      w.endBox(start);
    });

    expect([...bytes]).toEqual([
      0x00, 0x00, 0x00, 0x0c, // size = 12
      0x6d, 0x64, 0x61, 0x74, // 'mdat'
      0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  it("writes the version and flags of a FullBox", () => {
    const bytes = written((w) => {
      const start = w.beginFullBox("tfhd", 0, 0x020038);
      w.endBox(start);
    });

    expect([...bytes]).toEqual([
      0x00, 0x00, 0x00, 0x0c, // size = 12
      0x74, 0x66, 0x68, 0x64, // 'tfhd'
      0x00, // version
      0x02, 0x00, 0x38, // flags
    ]);
  });

  it("patches nested boxes at their own offsets", () => {
    // The failure this guards against: an inner `endBox` patching the outer
    // box's size field, or vice versa. Both produce a tree that still parses.
    const bytes = written((w) => {
      const outer = w.beginBox("moov");
      const inner = w.beginBox("mvex");
      const leaf = w.beginBox("trex");
      w.u32(1);
      w.endBox(leaf);
      w.endBox(inner);
      w.endBox(outer);
    });

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0)).toBe(28); // moov: 8 + 20
    expect(view.getUint32(8)).toBe(20); // mvex: 8 + 12
    expect(view.getUint32(16)).toBe(12); // trex: 8 + 4
    expect(bytes.byteLength).toBe(28);
  });

  it("reports the offset a box will be closed at", () => {
    const w = new ByteWriter();
    w.u32(0);
    expect(w.beginBox("free")).toBe(4);
    expect(w.length).toBe(12);
  });
});

describe("finish", () => {
  it("hands back exactly the bytes written", () => {
    const w = new ByteWriter(4096);
    w.u32(0x11223344);
    expect(w.finish().byteLength).toBe(4);
  });

  it("hands back a buffer the output exactly fills", () => {
    // Otherwise `result.buffer` carries trailing slack, which is a trap for
    // every downstream consumer that reaches past the view.
    for (const capacity of [64, 4096, 1]) {
      const w = new ByteWriter(capacity);
      for (let i = 0; i < 100; i++) w.u16(i);
      const bytes = w.finish();
      expect(bytes.byteOffset, `capacity ${capacity}`).toBe(0);
      expect(bytes.buffer.byteLength, `capacity ${capacity}`).toBe(bytes.byteLength);
      expect(bytes.byteLength, `capacity ${capacity}`).toBe(200);
    }
  });

  it("refuses to be written to afterwards, so the view stays valid", () => {
    const w = new ByteWriter();
    const bytes = w.finish();
    expect(() => w.u8(1)).toThrow(/after finish/);
    expect(bytes.byteLength).toBe(0);
  });
});
