// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  formatContentRange,
  formatRangeHeader,
  formatUnsatisfiedContentRange,
  parseContentRange,
  parseRangeHeader,
  rangeLength,
  resolveRangeHeader,
  resolveRangeSpec,
} from "@/lib/http/range";

/**
 * Every case here comes from RFC 9110 §14 or from research
 * §4.2's description of what Safari actually sends. The temptation with range
 * parsing is to test the three forms in the spec table and stop; the bugs are
 * all in the fourth column — the object that is empty, the client that asks for
 * more than exists, the header that is garbage.
 */

describe("parseRangeHeader", () => {
  it("parses the closed form", () => {
    expect(parseRangeHeader("bytes=0-499")).toEqual([
      { kind: "bounded", start: 0, end: 499 },
    ]);
  });

  it("parses the open-ended form with no end", () => {
    expect(parseRangeHeader("bytes=500-")).toEqual([
      { kind: "bounded", start: 500 },
    ]);
  });

  /**
   * The single most-confused form. `bytes=-500` is the *last* 500 bytes, not
   * "from byte 500" — a parser that reads it as the latter serves the wrong
   * region of the file with a 206 and a plausible `Content-Range`, so nothing
   * errors and the video simply decodes to noise.
   */
  it("parses the suffix form as a length, not a start", () => {
    expect(parseRangeHeader("bytes=-500")).toEqual([
      { kind: "suffix", length: 500 },
    ]);
  });

  it("accepts the unit case-insensitively and tolerates whitespace", () => {
    expect(parseRangeHeader("  BYTES = 0-1  ")).toEqual([
      { kind: "bounded", start: 0, end: 1 },
    ]);
  });

  it("parses a multi-range set into every spec it contains", () => {
    expect(parseRangeHeader("bytes=0-99, 200-299,-50")).toEqual([
      { kind: "bounded", start: 0, end: 99 },
      { kind: "bounded", start: 200, end: 299 },
      { kind: "suffix", length: 50 },
    ]);
  });

  it.each([
    ["absent", null],
    ["empty", ""],
    ["no set", "bytes="],
    ["no positions", "bytes=-"],
    ["not a number", "bytes=abc-def"],
    ["another unit", "items=0-10"],
    ["no unit", "0-10"],
    ["end before start", "bytes=100-50"],
    ["one bad spec among good ones", "bytes=0-99,nonsense"],
    ["negative", "bytes=--5"],
    ["trailing comma leaves an empty spec", "bytes=0-99,"],
  ])("ignores a header that is %s", (_label, header) => {
    expect(parseRangeHeader(header)).toBeNull();
  });

  /**
   * A 20-digit position is not a parse error, it is a number JavaScript can no
   * longer compare exactly. Saturating keeps `>= totalSize` and `Math.min`
   * meaningful; parsing it as `1e20` would make `end + 1 === end`.
   */
  it("saturates a position too large to be an exact integer", () => {
    expect(parseRangeHeader("bytes=0-99999999999999999999")).toEqual([
      { kind: "bounded", start: 0, end: Number.MAX_SAFE_INTEGER },
    ]);
  });
});

describe("resolveRangeSpec", () => {
  it("resolves a closed range unchanged when it fits", () => {
    expect(resolveRangeSpec({ kind: "bounded", start: 0, end: 499 }, 1000)).toEqual(
      { start: 0, end: 499 },
    );
  });

  it("resolves an open-ended range to the last byte", () => {
    expect(resolveRangeSpec({ kind: "bounded", start: 500 }, 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it("resolves a suffix range to the last N bytes", () => {
    expect(resolveRangeSpec({ kind: "suffix", length: 500 }, 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it("clamps a suffix longer than the object to the whole object", () => {
    expect(resolveRangeSpec({ kind: "suffix", length: 5000 }, 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  // An end past the end is a clamp, not an error (§14.1.1). Safari sends this.
  it("clamps an end past the end rather than refusing", () => {
    expect(
      resolveRangeSpec({ kind: "bounded", start: 900, end: 99999 }, 1000),
    ).toEqual({ start: 900, end: 999 });
  });

  // A start past the end has no bytes behind it at all: 416.
  it("refuses a start past the end", () => {
    expect(resolveRangeSpec({ kind: "bounded", start: 1000 }, 1000)).toBeNull();
  });

  it("refuses a start exactly one past the last byte", () => {
    expect(resolveRangeSpec({ kind: "bounded", start: 1000, end: 1000 }, 1000))
      .toBeNull();
  });

  it("allows a start on the last byte", () => {
    expect(resolveRangeSpec({ kind: "bounded", start: 999 }, 1000)).toEqual({
      start: 999,
      end: 999,
    });
  });

  it("refuses a zero-length suffix", () => {
    expect(resolveRangeSpec({ kind: "suffix", length: 0 }, 1000)).toBeNull();
  });

  /**
   * `bytes=0-` against a zero-byte object. There is no byte zero, so the only
   * correct answer is 416 — but the naive clamp computes `end = -1`, which
   * `fs.createReadStream` reads as "no end given" and answers with the whole
   * file. The filesystem adapter guards this too; both guards are deliberate.
   */
  it("refuses any range against a zero-length object", () => {
    expect(resolveRangeSpec({ kind: "bounded", start: 0 }, 0)).toBeNull();
    expect(resolveRangeSpec({ kind: "suffix", length: 10 }, 0)).toBeNull();
  });
});

describe("resolveRangeHeader", () => {
  it("serves the whole object when there is no header", () => {
    expect(resolveRangeHeader(null, 1000)).toEqual({ kind: "whole" });
  });

  // §14.2: an unparseable Range is ignored. 400 would be wrong.
  it("serves the whole object when the header is malformed", () => {
    expect(resolveRangeHeader("bytes=oops", 1000)).toEqual({ kind: "whole" });
  });

  /**
   * Research §4.2: Safari opens a video source by asking for as little as the
   * first two bytes, and treats anything other than a correct 206 as a source
   * it cannot use — it does not fall back to a full download, it moves on. This
   * is the exact request.
   */
  it("answers Safari's opening two-byte probe as a partial read", () => {
    expect(resolveRangeHeader("bytes=0-1", 190_120_000)).toEqual({
      kind: "partial",
      range: { start: 0, end: 1 },
    });
    expect(rangeLength({ start: 0, end: 1 })).toBe(2);
  });

  it("reports unsatisfiable when the object cannot serve the range", () => {
    expect(resolveRangeHeader("bytes=2000-", 1000)).toEqual({
      kind: "unsatisfiable",
    });
  });

  // The multi-range decision, asserted rather than described: one range, the
  // first one that the object can actually satisfy.
  it("serves only the first range of a multi-range request", () => {
    expect(resolveRangeHeader("bytes=0-99,500-599", 1000)).toEqual({
      kind: "partial",
      range: { start: 0, end: 99 },
    });
  });

  it("skips past an unsatisfiable spec to one that works", () => {
    expect(resolveRangeHeader("bytes=5000-6000,10-19", 1000)).toEqual({
      kind: "partial",
      range: { start: 10, end: 19 },
    });
  });

  it("is unsatisfiable only when no spec in the set can be served", () => {
    expect(resolveRangeHeader("bytes=5000-6000,7000-", 1000)).toEqual({
      kind: "unsatisfiable",
    });
  });
});

describe("formatting", () => {
  it("formats Content-Range for a 206", () => {
    expect(formatContentRange({ start: 0, end: 499 }, 1000)).toBe(
      "bytes 0-499/1000",
    );
  });

  it("formats Content-Range for a 416 so the client learns the size", () => {
    expect(formatUnsatisfiedContentRange(1000)).toBe("bytes */1000");
  });

  it("formats a request Range header, open-ended when there is no end", () => {
    expect(formatRangeHeader({ start: 0, end: 499 })).toBe("bytes=0-499");
    expect(formatRangeHeader({ start: 500 })).toBe("bytes=500-");
  });

  // Inclusive at both ends: 0-0 is one byte, not zero.
  it("counts an inclusive range's bytes", () => {
    expect(rangeLength({ start: 0, end: 0 })).toBe(1);
    expect(rangeLength({ start: 0, end: 499 })).toBe(500);
    expect(rangeLength({ start: 500, end: 999 })).toBe(500);
  });
});

describe("parseContentRange", () => {
  it("parses the satisfied form", () => {
    expect(parseContentRange("bytes 0-499/1000")).toEqual({
      start: 0,
      end: 499,
      total: 1000,
    });
  });

  it.each([
    ["the unsatisfied form", "bytes */1000"],
    ["an unknown total", "bytes 0-499/*"],
    ["a different unit", "items 0-1/2"],
    ["nonsense", "not a content range"],
    ["absent", undefined],
  ])("returns null for %s", (_label, header) => {
    expect(parseContentRange(header)).toBeNull();
  });
});
