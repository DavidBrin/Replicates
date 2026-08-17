/**
 * The muxer's public surface.
 *
 * Two layers, deliberately:
 *
 * `buildInitSegment` and `buildMediaSegment` are pure. Given tracks and samples
 * already denominated in a timescale, they produce bytes. They hold no state,
 * which is what lets a test drive them with a handful of synthetic samples and
 * assert on the result without arranging a session first.
 *
 * `TrackMuxer` is the layer above, and it exists to own the one piece of state
 * that must not be reconstructed per segment: the running decode clock. The
 * tempting shape for a segmenter is `baseMediaDecodeTime = segmentIndex ×
 * nominalDuration`, and it is correct until the first segment that is not
 * nominal — a keyframe landing late, a final short segment — after which every
 * subsequent `tfdt` is wrong by the accumulated difference and audio walks away
 * from video. Keeping the clock inside an object that hands out segments in
 * order makes the wrong version inexpressible rather than merely discouraged.
 *
 * One track per muxer. A ladder is N video-only muxers plus one audio muxer,
 * tied together at the playlist layer rather than by re-muxing audio into every
 * rung — research §9, and Apple's "you SHOULD deliver video and audio as
 * separate streams".
 */

import type { EncodedSample, PackagedSegment, TrackConfig } from "../types";

import { DEFAULT_MOVIE_TIMESCALE } from "./boxes";
import { buildInitSegment } from "./init-segment";
import { MEDIA_CLOCK_START, buildMediaSegment, planFragment, type MediaClock } from "./media-segment";

export {
  DEFAULT_MOVIE_TIMESCALE,
  NON_SYNC_SAMPLE_FLAGS,
  SYNC_SAMPLE_FLAGS,
  microsecondsToTimescale,
  sampleEntryTypeFor,
  sampleFlags,
  type SampleEntryType,
} from "./boxes";
export { buildInitSegment, type InitSegmentOptions, type InitTrack } from "./init-segment";
export {
  MEDIA_CLOCK_START,
  buildMediaSegment,
  computeMoofSize,
  planFragment,
  planTrackFragment,
  type FragmentPlan,
  type FragmentSample,
  type FragmentTrack,
  type MediaClock,
  type MediaSegmentOptions,
  type TrackFragmentPlan,
} from "./media-segment";
export { ByteWriter } from "./writer";
export * from "./parser";

export interface TrackMuxerOptions {
  readonly config: TrackConfig;
  /** `tkhd.track_ID`. Defaults to 1, which is what a single-track file wants. */
  readonly trackId?: number;
  readonly movieTimescale?: number;
  /**
   * Total duration in microseconds, if it is known up front. When it is not,
   * `initSegment()` called after the last segment uses the accumulated clock
   * instead — see there.
   */
  readonly durationUs?: number;
}

/**
 * Segments one track: an init segment, then a media segment per fragment, with
 * a decode clock that runs continuously across them.
 */
export class TrackMuxer {
  readonly #config: TrackConfig;
  readonly #trackId: number;
  readonly #movieTimescale: number;
  readonly #declaredDurationUs: number | undefined;

  #clock: MediaClock = MEDIA_CLOCK_START;
  /** `mfhd.sequence_number` is 1-based and file-wide (research §3.2). */
  #sequenceNumber = 1;
  #segmentIndex = 0;

  constructor(options: TrackMuxerOptions) {
    this.#config = options.config;
    this.#trackId = options.trackId ?? 1;
    this.#movieTimescale = options.movieTimescale ?? DEFAULT_MOVIE_TIMESCALE;
    this.#declaredDurationUs = options.durationUs;
  }

  get config(): TrackConfig {
    return this.#config;
  }

  get trackId(): number {
    return this.#trackId;
  }

  /** How much media has been packaged, in the track's own timescale. */
  get baseMediaDecodeTime(): number {
    return this.#clock.elapsedUnits;
  }

  get segmentCount(): number {
    return this.#segmentIndex;
  }

  /**
   * `ftyp` + `moov` for this track.
   *
   * The duration it declares is the one given at construction, or — if none was
   * — whatever has been packaged so far. That makes both orders work: build the
   * init segment first and it declares 0, which is the legal "unknown" value a
   * fragmented file is allowed to carry; build it last, after every segment,
   * and it declares the real total. VOD wants the second.
   */
  initSegment(): Uint8Array {
    return buildInitSegment({
      tracks: [{ id: this.#trackId, config: this.#config }],
      movieTimescale: this.#movieTimescale,
      durationUs: this.#declaredDurationUs ?? this.#clock.elapsedUs,
    });
  }

  /**
   * Packages one fragment's samples into a media segment and advances the
   * clock.
   *
   * A video segment must start on a keyframe. That is Apple's rule — "video
   * segments MUST start with an IDR frame" (research §7.2) — and it is also
   * what makes an ABR rung switch legal at all: after `changeType()` MSE sets
   * "need random access point" on the track buffer, so a segment that opens on
   * a delta frame has nowhere for playback to resume (§6.3). Throwing here
   * turns a silent stall at switch time into a failure at package time.
   */
  packageSegment(samples: readonly EncodedSample[]): PackagedSegment {
    const first = samples[0];
    if (first === undefined) {
      throw new Error("A media segment needs at least one sample");
    }
    if (this.#config.kind === "video" && !first.isKeyFrame) {
      throw new Error(
        `Segment ${this.#segmentIndex} of track ${this.#trackId} starts on a delta frame; ` +
          `video segments must start with a keyframe`,
      );
    }

    const plan = planFragment(samples, this.#config.timescale, this.#clock);
    const data = buildMediaSegment({
      sequenceNumber: this.#sequenceNumber,
      tracks: [
        {
          id: this.#trackId,
          baseMediaDecodeTime: plan.baseMediaDecodeTime,
          samples: plan.samples,
        },
      ],
    });

    const segment: PackagedSegment = {
      index: this.#segmentIndex,
      data,
      // Both in the track's timescale rather than recomputed from the source
      // microseconds: the playlist should declare the timeline the player will
      // actually see, and that is the rounded one written into `trun`/`tfdt`.
      durationSeconds: plan.durationUnits / this.#config.timescale,
      startSeconds: plan.baseMediaDecodeTime / this.#config.timescale,
    };

    this.#clock = plan.clock;
    this.#sequenceNumber++;
    this.#segmentIndex++;
    return segment;
  }
}
