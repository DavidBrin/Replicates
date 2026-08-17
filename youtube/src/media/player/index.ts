/**
 * The player's public surface, and the one place the two playback paths are
 * chosen between.
 *
 * `createPlayer` is the composition root. It exists here rather than in
 * `engine.ts` for a structural reason worth stating: `engine.ts` owns the shared
 * types and the metrics recorder, `progressive.ts` uses both, and if the MSE
 * engine also reached back for the progressive one the two modules would import
 * each other. Putting the branch in the index keeps every import pointing one
 * way, which is also what lets the ABR selector and the buffer controller be
 * imported by a test without dragging a `MediaSource` into scope.
 */

export {
  HlsParseError,
  defaultRenditionFor,
  parseMasterPlaylist,
  parseMediaPlaylist,
  resolveUri,
  segmentIndexAt,
  type MasterPlaylist,
  type MediaPlaylist,
  type PlaylistRendition,
  type PlaylistRenditionType,
  type PlaylistSegment,
  type PlaylistVariant,
} from "./playlist";

export {
  ABR_DEFAULTS,
  Ewma,
  ThroughputEstimator,
  selectRendition,
  shouldAbandon,
  startupRendition,
  type AbandonDecision,
  type AbandonHoldReason,
  type AbandonInput,
  type AbrConfig,
  type AbrDecision,
  type AbrInput,
  type AbrReason,
  type AbrRendition,
} from "./abr";

export {
  BUFFER_TARGETS,
  BufferController,
  BufferQuotaError,
  SourceBufferAppendError,
  bufferedAhead,
  isQuotaExceededError,
  rangeContaining,
  toRanges,
  totalBuffered,
  type AppendableBuffer,
  type BufferControllerOptions,
  type BufferTargets,
  type BufferedRange,
  type SourceBufferLike,
  type TimeRangesLike,
} from "./buffer-controller";

export {
  MetricsRecorder,
  OSCILLATION_WINDOW_SEGMENTS,
  QOE_REBUFFER_PENALTY,
  REBUFFER_MIN_MS,
  SOURCE_OPEN_TIMEOUT_MS,
  createLadderedEngine,
  detectPlaybackMode,
  fetchSegmentOverHttp,
  fetchTextOverHttp,
  isVideoCodec,
  mimeTypeFor,
  nextSegmentIndex,
  probeCapabilities,
  type CapabilityProbe,
  type EngineDependencies,
  type EngineState,
  type LadderedEngineOptions,
  type MediaElementLike,
  type MediaSourceConstructorLike,
  type MediaSourceLike,
  type PlaybackMetrics,
  type PlaybackMode,
  type PlayerEngine,
  type PlayerPhase,
  type QualityOption,
  type SegmentFetchRequest,
  type SegmentFetcher,
  type TextFetcher,
} from "./engine";

export {
  createProgressivePlayer,
  type ProgressiveMediaElement,
  type ProgressivePlayerOptions,
  type ProgressiveSource,
} from "./progressive";

import {
  createLadderedEngine,
  detectPlaybackMode,
  mimeTypeFor,
  probeCapabilities,
  type LadderedEngineOptions,
  type PlaybackMode,
  type PlayerEngine,
} from "./engine";
import {
  createProgressivePlayer,
  type ProgressiveMediaElement,
  type ProgressiveSource,
} from "./progressive";

/** Mirrors `Pipeline` in `src/domain/types.ts`, which is the column this branches on. */
export type PlayerPipeline = "laddered" | "progressive";

export interface CreatePlayerOptions {
  readonly media: ProgressiveMediaElement;
  /** `videos.pipeline`. The single most consequential field in the schema for playback. */
  readonly pipeline: PlayerPipeline;
  /** Required when `pipeline` is `laddered`. */
  readonly masterPlaylistUrl?: string;
  /**
   * The progressive rendition(s).
   *
   * Required when `pipeline` is `progressive`, and worth supplying even for a
   * laddered video: it is what the last resort of research §9's detection order
   * falls back *to* when a browser has neither a usable `MediaSource` nor native
   * HLS. A laddered upload has one of these too — `videos.progressive_key`.
   */
  readonly progressiveSources?: readonly ProgressiveSource[];
  /**
   * The codec strings the ladder was encoded in, from `video_renditions.codec`.
   *
   * Passed rather than discovered because the routing decision has to be made
   * before the master playlist is fetched, and `DECISIONS.md` D7 already stores
   * the negotiated codec per rendition for exactly this kind of question. Without
   * it the probe can only ask "does a MediaSource exist", which is the question
   * that says yes on a Safari with no VP9 decoder.
   */
  readonly renditionCodecs?: readonly string[];
  readonly engine?: Omit<LadderedEngineOptions, "media" | "masterPlaylistUrl">;
}

/**
 * Pick a playback path and build it.
 *
 * The order is research §9's, via `detectPlaybackMode`. Two cases route to the
 * progressive player: a video whose `pipeline` column says so — which is a
 * property of how it was *uploaded* and has nothing to do with this browser — and
 * a laddered video on an engine that cannot play it, which is a property of this
 * browser and nothing to do with the upload. They arrive at the same code by
 * different routes and it is worth not conflating them, because only the second
 * one is a fallback.
 */
export function createPlayer(options: CreatePlayerOptions): PlayerEngine {
  if (options.pipeline === "progressive") {
    return progressiveOrThrow(options, "this video was uploaded through the progressive pipeline");
  }

  const masterPlaylistUrl = options.masterPlaylistUrl;
  if (masterPlaylistUrl === undefined) {
    throw new Error("A laddered video needs a masterPlaylistUrl");
  }

  const requiredTypes = (options.renditionCodecs ?? []).map(mimeTypeFor);
  const mode: PlaybackMode = detectPlaybackMode(probeCapabilities(options.media, requiredTypes));

  if (mode === "progressive") {
    return progressiveOrThrow(
      options,
      "this browser has neither a usable MediaSource nor native HLS for these codecs",
    );
  }

  return createLadderedEngine({
    ...options.engine,
    media: options.media,
    masterPlaylistUrl,
    forceMode: mode,
  });
}

function progressiveOrThrow(
  options: CreatePlayerOptions,
  because: string,
): PlayerEngine {
  const sources = options.progressiveSources;
  if (sources === undefined || sources.length === 0) {
    throw new Error(
      `Playback needs the progressive path because ${because}, but no progressiveSources ` +
        "were supplied. A laddered video should pass `videos.progressive_key` here so the " +
        "fallback has something to play.",
    );
  }
  return createProgressivePlayer({ media: options.media, sources });
}
