/**
 * HLS playlist emission — the master (multivariant) playlist and the media
 * playlists it points at.
 *
 * Playlists are plain text, which makes them look like the easy half of this
 * slice and makes them the half where mistakes are cheapest to ship. A playlist
 * with a missing `CODECS` attribute, a `TARGETDURATION` one second short, or a
 * `SUBTITLES` group nothing declares is still a well-formed text file that a
 * lenient player will happily start playing — and then stall, or refuse to
 * offer captions, or be rejected outright by Apple's validator while working in
 * Chrome. So the emitters below validate as they go and throw rather than
 * producing a plausible file.
 *
 * Every rule is cited to `research/02-fmp4-hls-packaging.md` §7, which
 * distinguishes throughout between what RFC 8216 requires and what Apple's
 * authoring specification additionally requires. Where they differ we follow
 * Apple, because Apple's is the stricter set and a file that satisfies it
 * satisfies both.
 */

import type { LadderRung } from "../types";

/**
 * `EXT-X-MAP` — and therefore fMP4 media — requires protocol version 6
 * (research §7.2). Version 5 would do only for an I-frame-only playlist, which
 * this project does not produce.
 */
export const HLS_VERSION_FMP4 = 6;

/** RFC 6381 prefixes that mean "this elementary stream carries video". */
const VIDEO_CODEC_PREFIXES = ["avc1", "avc3", "hvc1", "hev1", "vp09", "vp08", "av01"];

function isVideoCodec(codec: string): boolean {
  const prefix = codec.split(".")[0]?.toLowerCase() ?? "";
  return VIDEO_CODEC_PREFIXES.includes(prefix);
}

/* ------------------------------------------------------------ formatting -- */

/**
 * A quoted-string attribute value. RFC 8216 §4.2 gives quoted-strings no escape
 * mechanism at all, so a `"`, CR or LF inside one cannot be represented — a
 * rendition named `He said "hi"` would silently terminate the attribute early
 * and shift every attribute after it. Rejecting is the only correct handling.
 */
function quoted(value: string): string {
  if (/["\r\n]/.test(value)) {
    throw new Error(
      `HLS attribute value ${JSON.stringify(value)} contains a quote or newline, which a quoted-string cannot carry`,
    );
  }
  return `"${value}"`;
}

/**
 * `EXTINF` durations "SHOULD be a floating point" (research §7.2). Five decimal
 * places is what the worked example uses, and it is enough to express the
 * 1/1.001 NTSC ratios — 6.006 — exactly.
 */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`EXTINF duration ${seconds} is not a non-negative number`);
  }
  return seconds.toFixed(5);
}

/** `FRAME-RATE` is a decimal to three places: 29.97 → `29.970`. */
function formatFrameRate(fps: number): string {
  return fps.toFixed(3);
}

function attributes(pairs: readonly (readonly [string, string | undefined])[]): string {
  return pairs
    .filter((pair): pair is readonly [string, string] => pair[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
}

/* -------------------------------------------------------- media playlist -- */

export interface MediaPlaylistSegment {
  readonly uri: string;
  readonly durationSeconds: number;
  /** The optional `EXTINF` title, after the comma. Rarely used; never required. */
  readonly title?: string;
}

export interface MediaPlaylistOptions {
  readonly segments: readonly MediaPlaylistSegment[];
  /**
   * `EXT-X-MAP` URI — the init segment. Required for fMP4 media ("If using
   * fMP4, EXT-X-MAP tags MUST be present"), and correctly absent for a WebVTT
   * subtitle playlist, whose segments are plain `.vtt` files (research §7.3).
   */
  readonly initSegmentUri?: string;
  readonly version?: number;
  /** `VOD` for finished content. Apple: "you MUST add … VOD" (research §7.2). */
  readonly playlistType?: "VOD" | "EVENT";
  /** `EXT-X-ENDLIST`. True for VOD; false while a live playlist is still growing. */
  readonly endList?: boolean;
}

/**
 * The `EXT-X-TARGETDURATION` for a segment list: the maximum `EXTINF`, rounded
 * **up**.
 *
 * RFC 8216 §4.3.3.1 states the constraint the other way around — every
 * `EXTINF`, *rounded to the nearest integer*, must be ≤ the target — so
 * `round(max)` is technically conforming and is what the research's own worked
 * example shows (6.006-second segments under `TARGETDURATION:6`). We take
 * `ceil` instead, which is strictly safer: it satisfies the RFC's rule as well,
 * it additionally satisfies the plain reading that no segment may be longer
 * than the target, and it never lands below an actual `EXTINF`. The cost is one
 * extra second of declared target on NTSC-rate content, which affects nothing a
 * player does. The benefit is that the value cannot be invalid.
 */
export function targetDurationFor(segments: readonly MediaPlaylistSegment[]): number {
  if (segments.length === 0) {
    throw new Error("A media playlist needs at least one segment to have a target duration");
  }
  let longest = 0;
  for (const segment of segments) {
    if (!Number.isFinite(segment.durationSeconds) || segment.durationSeconds < 0) {
      throw new Error(`Segment "${segment.uri}" has an invalid duration`);
    }
    longest = Math.max(longest, segment.durationSeconds);
  }
  // A sub-second final segment must not produce a target of 0: the tag is a
  // positive integer, and 0 would be below every EXTINF in the list.
  return Math.max(1, Math.ceil(longest));
}

/**
 * Emits one media playlist.
 *
 * Tag order is not decorative. `EXT-X-MAP` applies to every segment that
 * follows it, so it has to precede the first `EXTINF`; `EXT-X-ENDLIST` closes
 * the list and has to come last.
 */
export function buildMediaPlaylist(options: MediaPlaylistOptions): string {
  const { segments } = options;
  if (segments.length === 0) {
    throw new Error("A media playlist needs at least one segment");
  }

  const lines: string[] = ["#EXTM3U", `#EXT-X-VERSION:${options.version ?? HLS_VERSION_FMP4}`];
  lines.push(`#EXT-X-TARGETDURATION:${targetDurationFor(segments)}`);
  if (options.playlistType) lines.push(`#EXT-X-PLAYLIST-TYPE:${options.playlistType}`);
  if (options.initSegmentUri !== undefined) {
    lines.push(`#EXT-X-MAP:URI=${quoted(options.initSegmentUri)}`);
  }

  for (const segment of segments) {
    if (segment.uri.length === 0 || /[\r\n]/.test(segment.uri)) {
      throw new Error(`Segment URI ${JSON.stringify(segment.uri)} is empty or spans lines`);
    }
    // The trailing comma is required even with no title: the tag's value is
    // `<duration>,[<title>]` and a parser looks for the separator.
    lines.push(`#EXTINF:${formatDuration(segment.durationSeconds)},${segment.title ?? ""}`);
    lines.push(segment.uri);
  }

  if (options.endList ?? true) lines.push("#EXT-X-ENDLIST");

  return `${lines.join("\n")}\n`;
}

/* ------------------------------------------------------- master playlist -- */

export type RenditionType = "AUDIO" | "VIDEO" | "SUBTITLES" | "CLOSED-CAPTIONS";

export interface Rendition {
  readonly type: RenditionType;
  readonly groupId: string;
  readonly name: string;
  /** Required for `SUBTITLES`; forbidden for `CLOSED-CAPTIONS` (research §7.3). */
  readonly uri?: string;
  /** RFC 5646, e.g. `en`. */
  readonly language?: string;
  readonly isDefault?: boolean;
  readonly autoselect?: boolean;
  /** `SUBTITLES` only. Marks plot-essential captions shown regardless of preference. */
  readonly forced?: boolean;
  /** Audio only, e.g. `"2"`. "SHOULD" for all audio; required to disambiguate. */
  readonly channels?: string;
  readonly characteristics?: readonly string[];
  /**
   * The RFC 6381 codec of this rendition's media. Not an HLS attribute — it is
   * carried here so that the constraint in research §7.3 can be checked: every
   * variant referencing a group "MUST have a CODECS attribute that lists every
   * sample format present in any Rendition in the Group".
   */
  readonly codec?: string;
}

export interface VariantStream {
  readonly uri: string;
  /** Peak segment bitrate. RFC: MUST be present, always. */
  readonly bandwidth: number;
  readonly averageBandwidth?: number;
  readonly resolution?: { readonly width: number; readonly height: number };
  /** One RFC 6381 string per elementary stream, audio group included. */
  readonly codecs: readonly string[];
  readonly frameRate?: number;
  readonly audioGroupId?: string;
  readonly subtitlesGroupId?: string;
}

export interface MasterPlaylistOptions {
  readonly variants: readonly VariantStream[];
  readonly renditions?: readonly Rendition[];
  readonly version?: number;
  /**
   * `EXT-X-INDEPENDENT-SEGMENTS`: every segment starts with a keyframe, so a
   * player may begin at any of them. True by construction here — `TrackMuxer`
   * refuses a video segment that does not start on a keyframe.
   */
  readonly independentSegments?: boolean;
}

function renditionLine(rendition: Rendition): string {
  if (rendition.type === "SUBTITLES" && rendition.uri === undefined) {
    throw new Error(`Subtitle rendition "${rendition.name}" needs a URI`);
  }
  if (rendition.type === "CLOSED-CAPTIONS" && rendition.uri !== undefined) {
    throw new Error(`Closed-caption rendition "${rendition.name}" must not carry a URI`);
  }
  if (rendition.forced !== undefined && rendition.type !== "SUBTITLES") {
    throw new Error(`FORCED is only valid on a SUBTITLES rendition, not ${rendition.type}`);
  }
  // "If DEFAULT=YES then AUTOSELECT must also be YES." Rather than silently
  // upgrading, an explicit `autoselect: false` beside `isDefault: true` is
  // contradictory input and says so.
  if (rendition.isDefault === true && rendition.autoselect === false) {
    throw new Error(
      `Rendition "${rendition.name}" is DEFAULT=YES but AUTOSELECT=NO, which RFC 8216 forbids`,
    );
  }
  const autoselect = rendition.autoselect ?? rendition.isDefault ?? false;

  return `#EXT-X-MEDIA:${attributes([
    ["TYPE", rendition.type],
    ["GROUP-ID", quoted(rendition.groupId)],
    ["NAME", quoted(rendition.name)],
    ["LANGUAGE", rendition.language === undefined ? undefined : quoted(rendition.language)],
    ["DEFAULT", rendition.isDefault ? "YES" : undefined],
    ["AUTOSELECT", autoselect ? "YES" : undefined],
    ["FORCED", rendition.forced === undefined ? undefined : rendition.forced ? "YES" : "NO"],
    ["CHANNELS", rendition.channels === undefined ? undefined : quoted(rendition.channels)],
    [
      "CHARACTERISTICS",
      rendition.characteristics === undefined
        ? undefined
        : quoted(rendition.characteristics.join(",")),
    ],
    ["URI", rendition.uri === undefined ? undefined : quoted(rendition.uri)],
  ])}`;
}

function validateGroupReference(
  variant: VariantStream,
  groupId: string | undefined,
  type: RenditionType,
  renditions: readonly Rendition[],
): void {
  if (groupId === undefined) return;
  const group = renditions.filter((r) => r.type === type && r.groupId === groupId);
  if (group.length === 0) {
    throw new Error(
      `Variant "${variant.uri}" references ${type} group "${groupId}", which no EXT-X-MEDIA declares`,
    );
  }
  // Research §7.3: the variant's CODECS must list every sample format present
  // in the group, even though the group's bytes live in another playlist. A
  // player that filters variants by CODECS would otherwise discard a variant
  // whose audio it can in fact decode — or keep one whose audio it cannot.
  for (const rendition of group) {
    if (rendition.codec !== undefined && !variant.codecs.includes(rendition.codec)) {
      throw new Error(
        `Variant "${variant.uri}" references group "${groupId}" whose rendition "${rendition.name}" ` +
          `is ${rendition.codec}, but its CODECS list is ${variant.codecs.join(",")}`,
      );
    }
  }
}

function variantLines(variant: VariantStream, renditions: readonly Rendition[]): string[] {
  if (!Number.isInteger(variant.bandwidth) || variant.bandwidth <= 0) {
    throw new Error(`Variant "${variant.uri}" needs a positive integer BANDWIDTH`);
  }
  if (variant.codecs.length === 0) {
    // RFC 8216 says SHOULD; Apple 9.3 says MUST, and a variant with no CODECS
    // forces every player to download a segment before it can decide whether it
    // can play it at all.
    throw new Error(`Variant "${variant.uri}" needs a CODECS attribute`);
  }
  if (variant.codecs.some(isVideoCodec) && variant.resolution === undefined) {
    throw new Error(
      `Variant "${variant.uri}" carries video and so needs RESOLUTION (Apple 9.2)`,
    );
  }
  validateGroupReference(variant, variant.audioGroupId, "AUDIO", renditions);
  validateGroupReference(variant, variant.subtitlesGroupId, "SUBTITLES", renditions);

  const tag = `#EXT-X-STREAM-INF:${attributes([
    ["BANDWIDTH", String(variant.bandwidth)],
    [
      "AVERAGE-BANDWIDTH",
      variant.averageBandwidth === undefined ? undefined : String(variant.averageBandwidth),
    ],
    [
      "RESOLUTION",
      variant.resolution === undefined
        ? undefined
        : `${variant.resolution.width}x${variant.resolution.height}`,
    ],
    [
      "FRAME-RATE",
      variant.frameRate === undefined ? undefined : formatFrameRate(variant.frameRate),
    ],
    ["CODECS", quoted(variant.codecs.join(","))],
    ["AUDIO", variant.audioGroupId === undefined ? undefined : quoted(variant.audioGroupId)],
    [
      "SUBTITLES",
      variant.subtitlesGroupId === undefined ? undefined : quoted(variant.subtitlesGroupId),
    ],
  ])}`;

  return [tag, variant.uri];
}

/**
 * Emits the master playlist: the `EXT-X-MEDIA` rendition groups first, then one
 * `EXT-X-STREAM-INF` + URI pair per variant.
 *
 * Groups first because a variant's `AUDIO`/`SUBTITLES` attribute is a forward
 * reference otherwise, and while the RFC does not order the tags, every
 * published example puts them this way and a player reading in one pass has
 * strictly less to remember.
 */
export function buildMasterPlaylist(options: MasterPlaylistOptions): string {
  const { variants } = options;
  const renditions = options.renditions ?? [];
  if (variants.length === 0) {
    throw new Error("A master playlist needs at least one variant");
  }

  // "At most one rendition per group may be DEFAULT=YES" — two would leave the
  // player to pick, and it would pick differently from another player.
  const defaultsByGroup = new Map<string, string>();
  for (const rendition of renditions) {
    if (rendition.isDefault !== true) continue;
    const key = `${rendition.type}:${rendition.groupId}`;
    const existing = defaultsByGroup.get(key);
    if (existing !== undefined) {
      throw new Error(
        `Group "${rendition.groupId}" has two DEFAULT=YES renditions: "${existing}" and "${rendition.name}"`,
      );
    }
    defaultsByGroup.set(key, rendition.name);
  }

  const lines: string[] = ["#EXTM3U", `#EXT-X-VERSION:${options.version ?? HLS_VERSION_FMP4}`];
  if (options.independentSegments ?? true) lines.push("#EXT-X-INDEPENDENT-SEGMENTS");
  for (const rendition of renditions) lines.push(renditionLine(rendition));
  for (const variant of variants) lines.push(...variantLines(variant, renditions));

  return `${lines.join("\n")}\n`;
}

/* ---------------------------------------------------------------- ladder -- */

export interface LadderVariantSource {
  readonly rung: LadderRung;
  /** The rung's media playlist, relative to the master. */
  readonly uri: string;
  /**
   * Measured peak segment bitrate, if it has been measured. When omitted, the
   * rung's *target* bitrate stands in — an assumption, not a measurement, and
   * an optimistic one: `BANDWIDTH` is defined as the peak and a VBR encoder's
   * peak segment runs above its target. Pass the measured value once segments
   * exist.
   */
  readonly bandwidth?: number;
  readonly averageBandwidth?: number;
  readonly frameRate?: number;
}

export interface LadderAudioGroup {
  readonly groupId: string;
  readonly name: string;
  readonly uri: string;
  readonly codec: string;
  readonly channels?: string;
  readonly language?: string;
  /** Added to every variant's `BANDWIDTH`, since the audio is played alongside. */
  readonly bitrate?: number;
}

export interface LadderSubtitleGroup {
  readonly groupId: string;
  readonly renditions: readonly Rendition[];
}

export interface LadderMasterOptions {
  readonly variants: readonly LadderVariantSource[];
  readonly audio?: LadderAudioGroup;
  readonly subtitles?: LadderSubtitleGroup;
}

/**
 * Builds a master playlist from ladder rungs, a shared audio rendition and
 * optional subtitle renditions — the shape research §7.4 works through and §9
 * argues for.
 *
 * The audio bitrate is added into each variant's `BANDWIDTH` because the
 * attribute means "peak segment bitrate across any playable combination of
 * renditions in this variant": the client will be fetching the audio playlist
 * at the same time, and a `BANDWIDTH` that ignores it under-states what the
 * variant actually costs, which biases the player's ABR decision upward exactly
 * when the connection is marginal.
 */
export function buildLadderMaster(options: LadderMasterOptions): string {
  const { audio, subtitles } = options;

  const renditions: Rendition[] = [];
  if (audio) {
    renditions.push({
      type: "AUDIO",
      groupId: audio.groupId,
      name: audio.name,
      uri: audio.uri,
      language: audio.language,
      isDefault: true,
      autoselect: true,
      channels: audio.channels,
      codec: audio.codec,
    });
  }
  if (subtitles) renditions.push(...subtitles.renditions);

  const variants = options.variants.map((source): VariantStream => {
    const { rung } = source;
    const videoBandwidth = source.bandwidth ?? rung.bitrate;
    return {
      uri: source.uri,
      bandwidth: videoBandwidth + (audio?.bitrate ?? 0),
      averageBandwidth:
        source.averageBandwidth === undefined
          ? undefined
          : source.averageBandwidth + (audio?.bitrate ?? 0),
      resolution: { width: rung.width, height: rung.height },
      codecs: audio ? [rung.codec, audio.codec] : [rung.codec],
      frameRate: source.frameRate,
      audioGroupId: audio?.groupId,
      subtitlesGroupId: subtitles?.groupId,
    };
  });

  return buildMasterPlaylist({ variants, renditions });
}
