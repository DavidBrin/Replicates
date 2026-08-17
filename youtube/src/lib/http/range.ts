/**
 * `Range` and `Content-Range`, per RFC 9110 §14.
 *
 * This module is pure: no store, no filesystem, no `Request`. That is not
 * tidiness for its own sake — range arithmetic is where the off-by-ones live,
 * and the only way to test the interesting cases (a suffix range longer than
 * the object, a start one byte past the end, a zero-length object) exhaustively
 * is to be able to call the arithmetic without a 190 MB file behind it.
 *
 * Two things here are deliberate departures from the obvious implementation:
 *
 * - **A syntactically broken header is ignored, not rejected.** RFC 9110 §14.2
 *   is explicit that a server ignores a `Range` it cannot parse and answers
 *   with the whole representation. Returning `400` instead is a common bug and
 *   it breaks the client that sent the bad header *and* every proxy between.
 * - **Parsing is separated from resolution**, because resolution needs the
 *   object's size and parsing does not. A suffix range (`bytes=-500`) cannot be
 *   turned into absolute offsets without the size, but a bounded one can be
 *   passed straight to the store — which saves a `HeadObject` round trip on the
 *   overwhelmingly common case. See `src/app/api/media/[...key]/route.ts`.
 *
 * Research: `research/05-storage-and-delivery.md` §4 (what the server must do),
 * §4.2 (why Safari is the browser that actually enforces this).
 */

/**
 * One entry of a `byte-range-set` (RFC 9110 §14.1.1), before the object's size
 * is known.
 *
 * `suffix` is kept as its own variant rather than being normalised into
 * `bounded` with a negative start, because `bytes=-500` means "the last 500
 * bytes" and `bytes=500-` means "from byte 500". Collapsing them into one
 * representation is precisely the confusion that produces a player that seeks
 * to the wrong place, so the type refuses to allow it.
 */
export type RangeSpec =
  | { readonly kind: "bounded"; readonly start: number; readonly end?: number }
  | { readonly kind: "suffix"; readonly length: number };

/** Absolute, inclusive at both ends — the HTTP convention, matching `ByteRange`. */
export interface ResolvedRange {
  readonly start: number;
  readonly end: number;
}

/** What the caller should actually do about a `Range` header. */
export type RangeOutcome =
  | { readonly kind: "whole" }
  | { readonly kind: "partial"; readonly range: ResolvedRange }
  | { readonly kind: "unsatisfiable" };

/**
 * The largest positive integer JavaScript compares exactly. A `Range` header is
 * attacker-controlled and `parseInt` will happily hand back `1e20` for twenty
 * digits — a value whose comparisons against a file size are float arithmetic
 * and whose `+ 1` is itself. Saturating here keeps every comparison below exact
 * and gives the right answer anyway: saturated as a start it is past the end of
 * any object that exists (416), saturated as an end it clamps to the last byte.
 */
const MAX_POSITION = Number.MAX_SAFE_INTEGER;

/** `bytes=<set>`; the unit is case-insensitive (RFC 9110 §14.1). */
const RANGE_HEADER = /^\s*bytes\s*=\s*(\S.*?)\s*$/i;

/** `first-byte-pos "-" [ last-byte-pos ]`, or `"-" suffix-length`. */
const RANGE_SPEC = /^(\d*)-(\d*)$/;

// `bytes <start>-<end>/<total>`, or the `*` form a 416 sends back.
const CONTENT_RANGE = /^\s*bytes\s+(?:(\d+)-(\d+)|\*)\/(\d+|\*)\s*$/i;

/**
 * Parse a `Range` header into its specs, or `null` if there is nothing usable.
 *
 * `null` covers both "no header" and "a header I could not parse", because the
 * response is identical in both cases: 200 with the whole object. A caller that
 * wanted to tell them apart would only be able to use the difference to return
 * a 4xx, which §14.2 forbids.
 *
 * The whole header is discarded if any one spec in it is invalid, rather than
 * the invalid spec being skipped. `byte-range-set` is a single grammar
 * production; half of it parsing is not evidence that the client meant the half
 * that did.
 */
export function parseRangeHeader(
  header: string | null | undefined,
): readonly RangeSpec[] | null {
  if (!header) return null;

  const match = RANGE_HEADER.exec(header);
  if (!match) return null;
  const set = match[1];
  if (set === undefined) return null;

  const specs: RangeSpec[] = [];
  for (const raw of set.split(",")) {
    const spec = parseRangeSpec(raw.trim());
    if (!spec) return null;
    specs.push(spec);
  }
  return specs.length > 0 ? specs : null;
}

function parseRangeSpec(text: string): RangeSpec | null {
  const match = RANGE_SPEC.exec(text);
  if (!match) return null;

  const [, first = "", last = ""] = match;

  // `bytes=-` is neither form: no start, no suffix length. Invalid.
  if (first === "" && last === "") return null;

  if (first === "") {
    // Suffix. `bytes=-0` parses but can never be satisfied — that is a 416, not
    // a parse failure, so it survives to `resolveRangeSpec` rather than being
    // discarded here (discarding it would serve a 200 and a client asking for
    // the last zero bytes would get the entire file).
    return { kind: "suffix", length: position(last) };
  }

  const start = position(first);
  if (last === "") return { kind: "bounded", start };

  const end = position(last);
  // last-byte-pos < first-byte-pos makes the spec invalid (§14.1.1), which
  // invalidates the header — 200, not 416. `bytes=100-50` is a client bug, not
  // a request for something that does not exist.
  if (end < start) return null;

  return { kind: "bounded", start, end };
}

function position(digits: string): number {
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : MAX_POSITION;
}

/**
 * Turn one spec into absolute offsets, or `null` if the object cannot satisfy
 * it.
 *
 * Two asymmetries worth stating, because they look like inconsistencies and are
 * not (§14.1.1):
 *
 * - A start past the end is **unsatisfiable** — there is no such byte.
 * - An end past the end is **clamped** — the client asked for more than exists
 *   and the rest of the object is the honest answer. Safari asks for
 *   `bytes=0-<something large>` routinely; answering 416 there is what makes a
 *   video refuse to play in Safari alone.
 */
export function resolveRangeSpec(
  spec: RangeSpec,
  totalSize: number,
): ResolvedRange | null {
  // A zero-length object satisfies no range at all, not even `bytes=0-`: there
  // is no byte zero to return. The filesystem adapter refuses this case too, so
  // the two agree rather than one of them inventing an empty 206.
  if (totalSize <= 0) return null;

  if (spec.kind === "suffix") {
    if (spec.length <= 0) return null;
    return { start: Math.max(0, totalSize - spec.length), end: totalSize - 1 };
  }

  if (spec.start >= totalSize) return null;
  return {
    start: spec.start,
    end: Math.min(spec.end ?? totalSize - 1, totalSize - 1),
  };
}

/**
 * The whole decision, for a caller that already knows the object's size.
 *
 * **Multi-range decision: we serve at most one range.** A request for
 * `bytes=0-99,500-599` gets a single `206` covering the first *satisfiable*
 * spec, not a `multipart/byteranges` body. RFC 9110 §14.2 permits this
 * explicitly ("a server MAY ignore the Range header field"), §15.3.7 does not
 * require multipart, and no media element sends multi-range: `<video>`, MSE and
 * Safari's window-fetching all send exactly one. Building and testing a
 * multipart encoder for a request this codebase never receives would be
 * unexercised code on the hot path of the only feature Safari is strict about.
 *
 * Taking the first *satisfiable* spec rather than flatly the first is the one
 * place the multi-range shortcut is not allowed to change the status code: 416
 * is only correct when the object can satisfy none of what was asked for.
 */
export function resolveRangeHeader(
  header: string | null | undefined,
  totalSize: number,
): RangeOutcome {
  const specs = parseRangeHeader(header);
  if (!specs) return { kind: "whole" };

  for (const spec of specs) {
    const range = resolveRangeSpec(spec, totalSize);
    if (range) return { kind: "partial", range };
  }
  return { kind: "unsatisfiable" };
}

/** `Content-Range` for a 206 (§14.4). */
export function formatContentRange(
  range: ResolvedRange,
  totalSize: number,
): string {
  return `bytes ${range.start}-${range.end}/${totalSize}`;
}

/**
 * `Content-Range` for a 416 (§14.4, §15.5.17).
 *
 * Required, not optional: it is how the client learns the real size and can
 * reissue a range that works. A 416 without it leaves a player retrying the
 * same impossible request.
 */
export function formatUnsatisfiedContentRange(totalSize: number): string {
  return `bytes */${totalSize}`;
}

/** The request-side header, for asking a backing store for a range. */
export function formatRangeHeader(range: {
  readonly start: number;
  readonly end?: number;
}): string {
  return `bytes=${range.start}-${range.end ?? ""}`;
}

/**
 * The number of bytes a 206 body actually carries.
 *
 * Its own function because `Content-Length` on a partial response is the length
 * of *this response*, not of the object, and writing `end - start` instead of
 * `end - start + 1` produces a response that is one byte short of its declared
 * length — which a browser reports as a network error, several layers from
 * here.
 */
export function rangeLength(range: ResolvedRange): number {
  return range.end - range.start + 1;
}

/**
 * Parse a `Content-Range` response header — the direction needed when *we* are
 * the client, reading a ranged `GetObject` back out of R2.
 *
 * Returns `null` for the `bytes * /<total>` unsatisfied form as well as for
 * anything unparseable: neither describes bytes that were returned.
 */
export function parseContentRange(
  header: string | null | undefined,
): { readonly start: number; readonly end: number; readonly total: number } | null {
  if (!header) return null;
  const match = CONTENT_RANGE.exec(header);
  if (!match) return null;

  const [, startText, endText, totalText] = match;
  if (startText === undefined || endText === undefined) return null;
  if (totalText === undefined || totalText === "*") return null;

  const start = Number.parseInt(startText, 10);
  const end = Number.parseInt(endText, 10);
  const total = Number.parseInt(totalText, 10);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  if (!Number.isSafeInteger(total) || end < start) return null;

  return { start, end, total };
}
