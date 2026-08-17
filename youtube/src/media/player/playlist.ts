/**
 * HLS playlist parsing — the reading half of `src/media/packager/hls.ts`.
 *
 * This is deliberately not an RFC 8216 implementation. We author every playlist
 * this parser will ever be handed, so the grammar it has to accept is the
 * grammar our own emitter produces: version 6, fMP4, `EXT-X-MAP`, fixed-duration
 * `EXTINF`, one `EXT-X-STREAM-INF` per rung, an `EXT-X-MEDIA` audio group and
 * optional subtitle group. That is a small corner of the RFC, and pretending
 * otherwise would mean shipping — and testing — code for byte ranges, key
 * rotation, discontinuities and low-latency parts that nothing in this
 * repository can emit. D9 in `DECISIONS.md` is exactly this argument.
 *
 * It shares no code with the emitter. A parser built from the emitter's own
 * formatting helpers would agree with it about a mistake, so the round-trip test
 * in `__tests__/playlist.test.ts` — generate with the packager, read back here —
 * only proves anything because the two were written independently from
 * RFC 8216 §4.
 *
 * **What it deliberately does not parse, and why the two lists differ.**
 *
 * Tags in `IGNORED_TAGS` change nothing about how the media is fetched or
 * decoded, so RFC 8216 §4.1's "clients MUST ignore unrecognized tags" is the
 * right treatment and they are skipped without comment. Anything *else* we do
 * not handle is skipped too, but recorded in `unknownTags` — because a packager
 * that starts emitting something new should be visible to a test rather than
 * invisible until a user reports it, and a list that also collects every
 * deliberately-ignored tag can never be asserted on.
 *
 * Tags in `REFUSED_TAGS` are the opposite case: ignoring one produces a player
 * that runs and is wrong. `EXT-X-KEY` means the segments are encrypted and we
 * would append ciphertext to a decoder. `EXT-X-DEFINE` means every URI in the
 * file contains a `{$name}` substitution we would fetch literally.
 * `EXT-X-BYTERANGE` means a segment is a slice of a larger resource and we would
 * fetch the whole thing. `EXT-X-DISCONTINUITY` means the timeline restarts and
 * appending across it without a `timestampOffset` reset silently corrupts the
 * buffer. Each of those is a loud failure here instead of a quiet one at
 * runtime.
 *
 * Citations are to RFC 8216 (HTTP Live Streaming) §4 and to
 * `research/03-mse-player-abr.md`.
 */

/* ------------------------------------------------------------------ errors -- */

/**
 * Every rejection this module makes, with the line that caused it.
 *
 * One error type rather than a hierarchy: the caller's options are the same for
 * all of them — fall back to the progressive rendition, or surface a failure —
 * and the distinguishing detail belongs in the message a bug report will carry.
 */
export class HlsParseError extends Error {
  /** 1-based, matching what a text editor shows. `undefined` for whole-file faults. */
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = "HlsParseError";
    this.line = line;
  }
}

/* -------------------------------------------------------------------- uris -- */

/**
 * A base we can hand `URL` when the playlist's own location is root-relative,
 * which it always is in this application: media is served from
 * `/api/media/videos/{id}/…` in development and from an R2 custom domain in
 * production, and only the latter is absolute.
 *
 * `URL` cannot resolve against a relative base at all, so the standard move is
 * to borrow an origin, resolve, and take it back off. The scheme is deliberately
 * one that cannot be fetched, so a leak of it into a request URL fails loudly at
 * the fetch rather than quietly hitting some real host.
 */
const RELATIVE_ORIGIN = "hls-relative://base";

const ABSOLUTE_URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Resolve a playlist-relative URI against the playlist's own location.
 *
 * Our emitter writes `video/720p/playlist.m3u8` and `seg-00001.m4s` — relative
 * to the file they appear in, per RFC 8216 §4.1 — so nothing works without this.
 * An absolute URI is returned untouched, which is what lets a deployment point
 * the master playlist at a CDN host the app process never sees.
 */
export function resolveUri(uri: string, baseUri: string | undefined): string {
  if (baseUri === undefined || ABSOLUTE_URI.test(uri)) return uri;

  if (ABSOLUTE_URI.test(baseUri)) return new URL(uri, baseUri).toString();

  // A root-relative base keeps its leading slash; a bare-relative one is rooted
  // on the way in and unrooted on the way out, so `a/b.m3u8` + `c.m4s` stays
  // `a/c.m4s` rather than becoming `/a/c.m4s`.
  const rooted = baseUri.startsWith("/");
  const base = new URL(rooted ? baseUri : `/${baseUri}`, RELATIVE_ORIGIN);
  const resolved = new URL(uri, base).toString().slice(RELATIVE_ORIGIN.length);
  return rooted ? resolved : resolved.replace(/^\//, "");
}

/* --------------------------------------------------------------- lexing --- */

interface TagLine {
  readonly name: string;
  readonly value: string;
  readonly lineNumber: number;
}

type ParsedLine =
  | { readonly kind: "tag"; readonly tag: TagLine }
  | { readonly kind: "uri"; readonly uri: string; readonly lineNumber: number };

/**
 * Split a playlist into tags and URI lines.
 *
 * RFC 8216 §4.1: lines are terminated by LF or CRLF, blank lines are ignored,
 * and a line starting with `#` that is not a tag is a comment. The CRLF handling
 * matters more than it looks — a `\r` left on the end of a segment URI produces
 * a fetch for a path that does not exist, and the error names the *segment*
 * rather than the line ending.
 */
function* lex(text: string): Generator<ParsedLine> {
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const lineNumber = index + 1;
    if (line.length === 0) continue;

    if (line.startsWith("#EXT")) {
      const colon = line.indexOf(":");
      yield {
        kind: "tag",
        tag: {
          name: colon === -1 ? line.slice(1) : line.slice(1, colon),
          value: colon === -1 ? "" : line.slice(colon + 1),
          lineNumber,
        },
      };
      continue;
    }
    if (line.startsWith("#")) continue; // a comment
    yield { kind: "uri", uri: line, lineNumber };
  }
}

/**
 * Split an RFC 8216 §4.2 attribute list.
 *
 * The quoted-string handling is the whole reason this is not `split(",")`:
 * `CODECS="avc1.640028,mp4a.40.2"` is one attribute containing a comma, and a
 * naive split turns a two-codec variant into a variant with a codec called
 * `"avc1.640028` and an attribute called `mp4a.40.2"`. Both halves then fail
 * `MediaSource.isTypeSupported` and the rung is silently dropped from the
 * ladder — a bug that looks like a codec problem and is a parsing problem.
 */
function parseAttributes(value: string, lineNumber: number): Map<string, string> {
  const attributes = new Map<string, string>();
  let at = 0;

  while (at < value.length) {
    const equals = value.indexOf("=", at);
    if (equals === -1) {
      throw new HlsParseError(`Attribute "${value.slice(at)}" has no "="`, lineNumber);
    }
    const name = value.slice(at, equals);
    if (!/^[A-Z0-9-]+$/.test(name)) {
      throw new HlsParseError(`"${name}" is not an AttributeName`, lineNumber);
    }

    let raw: string;
    if (value[equals + 1] === '"') {
      const close = value.indexOf('"', equals + 2);
      if (close === -1) {
        throw new HlsParseError(`Unterminated quoted-string for ${name}`, lineNumber);
      }
      raw = value.slice(equals + 2, close);
      at = close + 1;
      if (at < value.length && value[at] !== ",") {
        throw new HlsParseError(`Junk after the quoted value of ${name}`, lineNumber);
      }
      at += 1;
    } else {
      const comma = value.indexOf(",", equals + 1);
      raw = comma === -1 ? value.slice(equals + 1) : value.slice(equals + 1, comma);
      at = comma === -1 ? value.length : comma + 1;
    }

    if (attributes.has(name)) {
      throw new HlsParseError(`Attribute ${name} appears twice`, lineNumber);
    }
    attributes.set(name, raw);
  }

  return attributes;
}

function requireAttribute(
  attributes: ReadonlyMap<string, string>,
  name: string,
  tag: string,
  lineNumber: number,
): string {
  const value = attributes.get(name);
  if (value === undefined) {
    throw new HlsParseError(`${tag} is missing the required ${name} attribute`, lineNumber);
  }
  return value;
}

function parseDecimalInteger(text: string, what: string, lineNumber: number): number {
  if (!/^\d+$/.test(text)) {
    throw new HlsParseError(`${what} "${text}" is not a decimal-integer`, lineNumber);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new HlsParseError(`${what} "${text}" does not fit a safe integer`, lineNumber);
  }
  return value;
}

function parseDecimalFloat(text: string, what: string, lineNumber: number): number {
  const value = Number(text);
  if (text.trim() === "" || !Number.isFinite(value) || value < 0) {
    throw new HlsParseError(`${what} "${text}" is not a non-negative number`, lineNumber);
  }
  return value;
}

/* ------------------------------------------------------- refused / ignored -- */

/**
 * Tags whose presence means this parser cannot correctly play the playlist.
 *
 * The value is the reason, which goes straight into the error — a message that
 * says only "unsupported tag" leaves the reader to work out whether it is a
 * packager regression or a genuinely foreign playlist.
 */
const REFUSED_TAGS: ReadonlyMap<string, string> = new Map([
  ["EXT-X-KEY", "the segments are encrypted and this player has no key handling"],
  ["EXT-X-SESSION-KEY", "the segments are encrypted and this player has no key handling"],
  [
    "EXT-X-BYTERANGE",
    "the segment is a slice of a larger resource, and this player fetches whole segment URIs",
  ],
  [
    "EXT-X-DISCONTINUITY",
    "the timeline restarts, which needs a timestampOffset reset this player does not perform",
  ],
  [
    "EXT-X-DEFINE",
    "the URIs in this playlist carry {$name} substitutions this player would fetch literally",
  ],
  ["EXT-X-PART", "low-latency partial segments are not produced or consumed by this project"],
  ["EXT-X-PRELOAD-HINT", "low-latency preload hints are not produced or consumed by this project"],
]);

/**
 * Tags that are safe to skip, listed so that "we ignore it" is a decision on the
 * record rather than the absence of a branch.
 *
 * `EXT-X-MEDIA-SEQUENCE` is `0` on every VOD playlist we write, and this parser
 * indexes segments from zero unconditionally, so honouring it would change
 * nothing. `EXT-X-I-FRAME-STREAM-INF` describes a trick-play variant we do not
 * package. `EXT-X-PROGRAM-DATE-TIME` maps media time to wall-clock, which only
 * live playback uses. The rest are informational.
 */
const IGNORED_TAGS: ReadonlySet<string> = new Set([
  "EXT-X-MEDIA-SEQUENCE",
  "EXT-X-DISCONTINUITY-SEQUENCE",
  "EXT-X-I-FRAME-STREAM-INF",
  "EXT-X-PROGRAM-DATE-TIME",
  "EXT-X-DATERANGE",
  "EXT-X-START",
  "EXT-X-SESSION-DATA",
  "EXT-X-SERVER-CONTROL",
  "EXT-X-ALLOW-CACHE",
  "EXT-X-GAP",
  "EXT-X-BITRATE",
]);

function checkRefused(tag: TagLine): void {
  const reason = REFUSED_TAGS.get(tag.name);
  if (reason !== undefined) {
    throw new HlsParseError(`#${tag.name} is not supported: ${reason}`, tag.lineNumber);
  }
}

function requireHeader(text: string): void {
  // RFC 8216 §4.3.1.1: the EXTM3U tag "MUST be the first line of every Media
  // Playlist and every Master Playlist". A file that fails this is usually an
  // error page with a 200 status, which is why the check is worth making
  // explicit rather than letting a later tag-missing error stand in for it.
  const first = text.split("\n", 1)[0] ?? "";
  const header = first.endsWith("\r") ? first.slice(0, -1) : first;
  if (header !== "#EXTM3U") {
    throw new HlsParseError(
      `A playlist must begin with #EXTM3U, not ${JSON.stringify(header.slice(0, 40))}`,
      1,
    );
  }
}

/* -------------------------------------------------------- media playlist --- */

export interface PlaylistSegment {
  /** Zero-based, and the same index in every rendition — the packager guarantees it. */
  readonly index: number;
  /** Already resolved against the playlist's own location. */
  readonly uri: string;
  readonly durationSeconds: number;
  /** Presentation time of this segment's first frame, summed from the EXTINFs. */
  readonly startSeconds: number;
  readonly title: string | undefined;
}

export interface MediaPlaylist {
  readonly version: number;
  readonly targetDurationSeconds: number;
  readonly playlistType: "VOD" | "EVENT" | undefined;
  /** The `EXT-X-MAP` URI, resolved. Required for fMP4; absent for WebVTT. */
  readonly initSegmentUri: string | undefined;
  readonly segments: readonly PlaylistSegment[];
  readonly endList: boolean;
  readonly totalDurationSeconds: number;
  /**
   * The shared `EXTINF` of every segment but the last, when there is one.
   *
   * This is what makes `segmentIndexAt` O(1) rather than a binary search
   * (research §5): our encoder cuts on a fixed 2s grid, so the index covering a
   * seek target is a division. `null` means the durations are irregular and the
   * lookup falls back to a scan — which our packager never produces, but a
   * hand-edited playlist could, and a wrong answer here is a seek to the wrong
   * place rather than an error.
   */
  readonly uniformSegmentDurationSeconds: number | null;
  /**
   * Tag names this parser does not recognise at all.
   *
   * Excludes `IGNORED_TAGS`, which are recognised and deliberately not acted on.
   * The distinction is the whole value of the field: a name appearing here means
   * our own packager emitted something nobody taught the parser about, which is
   * a regression worth failing a test over — and it is invisible if every skipped
   * tag lands in the same list.
   */
  readonly unknownTags: readonly string[];
}

const UNIFORM_DURATION_TOLERANCE_SECONDS = 1e-6;

/**
 * fMP4 media needs an `EXT-X-MAP`; WebVTT does not.
 *
 * The check keys off the segment extension rather than the version, because a
 * subtitle playlist and a video playlist are both `EXT-X-VERSION:6` from our
 * emitter and only the video one carries an init segment. Getting this wrong in
 * the permissive direction is the failure worth catching: appending `moof`/`mdat`
 * with no preceding `moov` throws inside `appendBuffer` with a message that
 * blames the segment.
 */
function looksLikeFragmentedMp4(uri: string): boolean {
  return /\.(m4s|mp4|m4v|m4a|cmf[vat])(\?|$)/i.test(uri);
}

export function parseMediaPlaylist(text: string, baseUri?: string): MediaPlaylist {
  requireHeader(text);

  let version: number | undefined;
  let targetDuration: number | undefined;
  let playlistType: "VOD" | "EVENT" | undefined;
  let initSegmentUri: string | undefined;
  let endList = false;
  const segments: PlaylistSegment[] = [];
  const unknownTags: string[] = [];

  let pending: { duration: number; title: string | undefined; lineNumber: number } | undefined;
  let elapsed = 0;

  for (const line of lex(text)) {
    if (line.kind === "uri") {
      if (pending === undefined) {
        throw new HlsParseError(
          `URI "${line.uri}" is not preceded by an #EXTINF`,
          line.lineNumber,
        );
      }
      if (endList) {
        throw new HlsParseError(`A segment follows #EXT-X-ENDLIST`, line.lineNumber);
      }
      segments.push({
        index: segments.length,
        uri: resolveUri(line.uri, baseUri),
        durationSeconds: pending.duration,
        startSeconds: elapsed,
        title: pending.title,
      });
      elapsed += pending.duration;
      pending = undefined;
      continue;
    }

    const { tag } = line;
    checkRefused(tag);

    switch (tag.name) {
      case "EXTM3U":
        continue;
      case "EXT-X-VERSION":
        version = parseDecimalInteger(tag.value, "EXT-X-VERSION", tag.lineNumber);
        continue;
      case "EXT-X-TARGETDURATION":
        targetDuration = parseDecimalInteger(
          tag.value,
          "EXT-X-TARGETDURATION",
          tag.lineNumber,
        );
        continue;
      case "EXT-X-PLAYLIST-TYPE":
        if (tag.value !== "VOD" && tag.value !== "EVENT") {
          throw new HlsParseError(
            `EXT-X-PLAYLIST-TYPE "${tag.value}" is neither VOD nor EVENT`,
            tag.lineNumber,
          );
        }
        playlistType = tag.value;
        continue;
      case "EXT-X-MAP": {
        const attributes = parseAttributes(tag.value, tag.lineNumber);
        if (attributes.has("BYTERANGE")) {
          throw new HlsParseError(
            "#EXT-X-MAP carries a BYTERANGE, and this player fetches whole init segments",
            tag.lineNumber,
          );
        }
        const uri = requireAttribute(attributes, "URI", "#EXT-X-MAP", tag.lineNumber);
        initSegmentUri = resolveUri(uri, baseUri);
        continue;
      }
      case "EXTINF": {
        const comma = tag.value.indexOf(",");
        if (comma === -1) {
          // The comma is not optional even with no title: the tag's value is
          // `<duration>,[<title>]` and its absence usually means a truncated
          // write rather than a stylistic choice.
          throw new HlsParseError("#EXTINF has no comma before its title", tag.lineNumber);
        }
        const duration = parseDecimalFloat(
          tag.value.slice(0, comma),
          "EXTINF duration",
          tag.lineNumber,
        );
        const title = tag.value.slice(comma + 1);
        pending = { duration, title: title === "" ? undefined : title, lineNumber: tag.lineNumber };
        continue;
      }
      case "EXT-X-ENDLIST":
        endList = true;
        continue;
      case "EXT-X-INDEPENDENT-SEGMENTS":
        // A media-playlist-level restatement of the master's tag. It asserts
        // what our muxer already enforces, so there is nothing to record.
        continue;
      default:
        // RFC 8216 §4.1 requires clients to ignore unrecognized tags. Both cases
        // do; only the genuinely unrecognised one is *recorded*, so that
        // `unknownTags` means "our packager emitted something this parser has
        // never been taught" rather than "a tag appeared", which is the only
        // reading a test can usefully assert on.
        if (!IGNORED_TAGS.has(tag.name)) unknownTags.push(tag.name);
        continue;
    }
  }

  if (pending !== undefined) {
    // The single most likely malformed input in production: a playlist
    // truncated by a partial write or a proxy that cut the response short.
    throw new HlsParseError(
      "The playlist ends with an #EXTINF that has no URI after it",
      pending.lineNumber,
    );
  }
  if (segments.length === 0) {
    throw new HlsParseError("A media playlist needs at least one segment");
  }
  if (targetDuration === undefined) {
    throw new HlsParseError("#EXT-X-TARGETDURATION is REQUIRED (RFC 8216 §4.3.3.1)");
  }
  const firstSegment = segments[0];
  if (initSegmentUri === undefined && firstSegment !== undefined) {
    if (looksLikeFragmentedMp4(firstSegment.uri)) {
      throw new HlsParseError(
        `This playlist's segments are fMP4 ("${firstSegment.uri}") but it has no #EXT-X-MAP, ` +
          "so there is no initialization segment to configure the decoder with",
      );
    }
  }

  return {
    version: version ?? 1,
    targetDurationSeconds: targetDuration,
    playlistType,
    initSegmentUri,
    segments,
    endList,
    totalDurationSeconds: elapsed,
    uniformSegmentDurationSeconds: uniformDuration(segments),
    unknownTags,
  };
}

/**
 * The shared segment duration, or `null` if the list is irregular.
 *
 * The final segment is allowed to be *shorter* and nothing else is: a VOD asset
 * almost never divides evenly into 2s, so treating a short tail as irregular
 * would throw away the O(1) lookup on essentially every real video.
 */
function uniformDuration(segments: readonly PlaylistSegment[]): number | null {
  const first = segments[0];
  if (first === undefined) return null;
  const candidate = first.durationSeconds;
  if (candidate <= 0) return null;

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1;
    const difference = segment.durationSeconds - candidate;
    if (Math.abs(difference) <= UNIFORM_DURATION_TOLERANCE_SECONDS) continue;
    if (isLast && difference < 0) continue;
    return null;
  }
  return candidate;
}

/**
 * Which segment covers a presentation time, or `null` if the time is outside the
 * asset.
 *
 * Research §5 calls this out as a direct payoff of controlling the packager:
 * fixed segment durations make the seek-target lookup a division rather than the
 * binary search a generic HLS player needs over variable `EXTINF`s. The scan
 * fallback exists so an irregular playlist gives a right answer slowly rather
 * than a wrong answer quickly.
 */
export function segmentIndexAt(playlist: MediaPlaylist, seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds >= playlist.totalDurationSeconds) return null;

  const uniform = playlist.uniformSegmentDurationSeconds;
  if (uniform !== null) {
    const index = Math.floor(seconds / uniform);
    return index < playlist.segments.length ? index : null;
  }

  for (const segment of playlist.segments) {
    if (seconds < segment.startSeconds + segment.durationSeconds) return segment.index;
  }
  return null;
}

/* ------------------------------------------------------- master playlist --- */

export type PlaylistRenditionType = "AUDIO" | "VIDEO" | "SUBTITLES" | "CLOSED-CAPTIONS";

export interface PlaylistRendition {
  readonly type: PlaylistRenditionType;
  readonly groupId: string;
  readonly name: string;
  readonly uri: string | undefined;
  readonly language: string | undefined;
  readonly isDefault: boolean;
  readonly autoselect: boolean;
  readonly forced: boolean;
  readonly channels: string | undefined;
  readonly characteristics: readonly string[];
}

export interface PlaylistVariant {
  readonly uri: string;
  readonly bandwidth: number;
  readonly averageBandwidth: number | undefined;
  readonly resolution: { readonly width: number; readonly height: number } | undefined;
  readonly codecs: readonly string[];
  readonly frameRate: number | undefined;
  readonly audioGroupId: string | undefined;
  readonly subtitlesGroupId: string | undefined;
}

export interface MasterPlaylist {
  readonly version: number;
  readonly independentSegments: boolean;
  /** Ascending by `BANDWIDTH`, which is the order the ABR selector wants. */
  readonly variants: readonly PlaylistVariant[];
  readonly renditions: readonly PlaylistRendition[];
  readonly unknownTags: readonly string[];
}

function parseBoolean(attributes: ReadonlyMap<string, string>, name: string): boolean {
  return attributes.get(name) === "YES";
}

export function parseMasterPlaylist(text: string, baseUri?: string): MasterPlaylist {
  requireHeader(text);

  let version: number | undefined;
  let independentSegments = false;
  const variants: PlaylistVariant[] = [];
  const renditions: PlaylistRendition[] = [];
  const unknownTags: string[] = [];

  let pendingVariant:
    | { attributes: Map<string, string>; lineNumber: number }
    | undefined;

  for (const line of lex(text)) {
    if (line.kind === "uri") {
      if (pendingVariant === undefined) {
        throw new HlsParseError(
          `URI "${line.uri}" is not preceded by an #EXT-X-STREAM-INF`,
          line.lineNumber,
        );
      }
      variants.push(
        buildVariant(pendingVariant.attributes, line.uri, pendingVariant.lineNumber, baseUri),
      );
      pendingVariant = undefined;
      continue;
    }

    const { tag } = line;
    checkRefused(tag);

    switch (tag.name) {
      case "EXTM3U":
        continue;
      case "EXT-X-VERSION":
        version = parseDecimalInteger(tag.value, "EXT-X-VERSION", tag.lineNumber);
        continue;
      case "EXT-X-INDEPENDENT-SEGMENTS":
        independentSegments = true;
        continue;
      case "EXT-X-MEDIA":
        renditions.push(
          buildRendition(parseAttributes(tag.value, tag.lineNumber), tag.lineNumber, baseUri),
        );
        continue;
      case "EXT-X-STREAM-INF":
        if (pendingVariant !== undefined) {
          throw new HlsParseError(
            "An #EXT-X-STREAM-INF is not followed by a URI",
            pendingVariant.lineNumber,
          );
        }
        pendingVariant = {
          attributes: parseAttributes(tag.value, tag.lineNumber),
          lineNumber: tag.lineNumber,
        };
        continue;
      default:
        if (!IGNORED_TAGS.has(tag.name)) unknownTags.push(tag.name);
        continue;
    }
  }

  if (pendingVariant !== undefined) {
    throw new HlsParseError(
      "The playlist ends with an #EXT-X-STREAM-INF that has no URI after it",
      pendingVariant.lineNumber,
    );
  }
  if (variants.length === 0) {
    throw new HlsParseError("A master playlist needs at least one variant");
  }

  for (const variant of variants) {
    assertGroupExists(variant, variant.audioGroupId, "AUDIO", renditions);
    assertGroupExists(variant, variant.subtitlesGroupId, "SUBTITLES", renditions);
  }

  // Ascending, and stable within a tie so two rungs that happen to measure the
  // same never swap order between two reads of the same file.
  variants.sort((a, b) => a.bandwidth - b.bandwidth);

  return {
    version: version ?? 1,
    independentSegments,
    variants,
    renditions,
    unknownTags,
  };
}

function buildVariant(
  attributes: ReadonlyMap<string, string>,
  uri: string,
  lineNumber: number,
  baseUri: string | undefined,
): PlaylistVariant {
  const bandwidth = parseDecimalInteger(
    requireAttribute(attributes, "BANDWIDTH", "#EXT-X-STREAM-INF", lineNumber),
    "BANDWIDTH",
    lineNumber,
  );
  if (bandwidth <= 0) {
    throw new HlsParseError(`BANDWIDTH ${bandwidth} is not positive`, lineNumber);
  }

  // RFC 8216 says CODECS is SHOULD; Apple's authoring spec says MUST, and our
  // own emitter refuses to write a variant without it. Requiring it here means
  // `MediaSource.isTypeSupported` can filter the ladder before a byte is
  // fetched, which is the whole point of the attribute.
  const codecs = requireAttribute(attributes, "CODECS", "#EXT-X-STREAM-INF", lineNumber)
    .split(",")
    .map((codec) => codec.trim())
    .filter((codec) => codec.length > 0);
  if (codecs.length === 0) {
    throw new HlsParseError("CODECS is present but empty", lineNumber);
  }

  const resolutionText = attributes.get("RESOLUTION");
  let resolution: { width: number; height: number } | undefined;
  if (resolutionText !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(resolutionText);
    if (!match) {
      throw new HlsParseError(`RESOLUTION "${resolutionText}" is not WxH`, lineNumber);
    }
    resolution = { width: Number(match[1]), height: Number(match[2]) };
  }

  const averageBandwidthText = attributes.get("AVERAGE-BANDWIDTH");
  const frameRateText = attributes.get("FRAME-RATE");

  return {
    uri: resolveUri(uri, baseUri),
    bandwidth,
    averageBandwidth:
      averageBandwidthText === undefined
        ? undefined
        : parseDecimalInteger(averageBandwidthText, "AVERAGE-BANDWIDTH", lineNumber),
    resolution,
    codecs,
    frameRate:
      frameRateText === undefined
        ? undefined
        : parseDecimalFloat(frameRateText, "FRAME-RATE", lineNumber),
    audioGroupId: attributes.get("AUDIO"),
    subtitlesGroupId: attributes.get("SUBTITLES"),
  };
}

function buildRendition(
  attributes: ReadonlyMap<string, string>,
  lineNumber: number,
  baseUri: string | undefined,
): PlaylistRendition {
  const type = requireAttribute(attributes, "TYPE", "#EXT-X-MEDIA", lineNumber);
  if (
    type !== "AUDIO" &&
    type !== "VIDEO" &&
    type !== "SUBTITLES" &&
    type !== "CLOSED-CAPTIONS"
  ) {
    throw new HlsParseError(`#EXT-X-MEDIA TYPE "${type}" is not one of the four`, lineNumber);
  }

  const uri = attributes.get("URI");
  if (type === "SUBTITLES" && uri === undefined) {
    throw new HlsParseError("A SUBTITLES rendition needs a URI", lineNumber);
  }

  const characteristics = attributes.get("CHARACTERISTICS");
  const isDefault = parseBoolean(attributes, "DEFAULT");

  return {
    type,
    groupId: requireAttribute(attributes, "GROUP-ID", "#EXT-X-MEDIA", lineNumber),
    name: requireAttribute(attributes, "NAME", "#EXT-X-MEDIA", lineNumber),
    uri: uri === undefined ? undefined : resolveUri(uri, baseUri),
    language: attributes.get("LANGUAGE"),
    isDefault,
    // RFC 8216 §4.3.4.1: DEFAULT=YES implies AUTOSELECT=YES. Our emitter always
    // writes both, so this is for playlists we did not write.
    autoselect: isDefault || parseBoolean(attributes, "AUTOSELECT"),
    forced: parseBoolean(attributes, "FORCED"),
    channels: attributes.get("CHANNELS"),
    characteristics:
      characteristics === undefined ? [] : characteristics.split(",").map((c) => c.trim()),
  };
}

function assertGroupExists(
  variant: PlaylistVariant,
  groupId: string | undefined,
  type: PlaylistRenditionType,
  renditions: readonly PlaylistRendition[],
): void {
  if (groupId === undefined) return;
  const found = renditions.some((r) => r.type === type && r.groupId === groupId);
  if (!found) {
    // A dangling group reference is the one master-playlist fault that produces
    // silent audio rather than an error: the variant plays, the audio group is
    // never resolved, and nothing anywhere reports why.
    throw new HlsParseError(
      `Variant "${variant.uri}" references ${type} group "${groupId}", which no #EXT-X-MEDIA declares`,
    );
  }
}

/**
 * The default audio rendition of a group, which is what we actually play.
 *
 * Our packager emits exactly one audio rendition and marks it `DEFAULT=YES`, so
 * this is a lookup rather than a selection algorithm. The fallback to the first
 * member of the group covers a playlist that declares a group and marks nothing
 * default, which RFC 8216 permits and our emitter never writes.
 */
export function defaultRenditionFor(
  master: MasterPlaylist,
  type: PlaylistRenditionType,
  groupId: string | undefined,
): PlaylistRendition | undefined {
  if (groupId === undefined) return undefined;
  const group = master.renditions.filter((r) => r.type === type && r.groupId === groupId);
  return group.find((r) => r.isDefault) ?? group[0];
}
