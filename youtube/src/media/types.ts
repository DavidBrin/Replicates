/**
 * The seam between the encoder and the muxer.
 *
 * `VideoEncoder` hands back an `EncodedVideoChunk`, which is a bare bitstream
 * with a timestamp — not a container, not a file, not anything a browser can
 * play. Everything between that and an HLS rendition is ours to write. These
 * types are the boundary: the encode side produces them without knowing what a
 * box is, and the muxer consumes them without knowing WebCodecs exists.
 *
 * Keeping the muxer free of WebCodecs types is what makes it testable at all.
 * `EncodedVideoChunk` cannot be constructed in Node, so a muxer typed against
 * it could only ever be tested in a browser; typed against a plain struct, it
 * can be driven from synthetic samples and its output parsed back and asserted
 * byte by byte.
 */

/** One encoded frame or audio packet, container-agnostic. */
export interface EncodedSample {
  readonly data: Uint8Array;
  /**
   * Presentation timestamp in microseconds — WebCodecs' unit, kept unconverted
   * across this boundary so that exactly one place in the codebase does the
   * conversion into a track timescale. Every drift bug in a muxer comes from
   * converting twice with different rounding.
   */
  readonly timestampUs: number;
  readonly durationUs: number;
  /**
   * A sync sample. This becomes the one bit in `trun`'s sample flags that
   * decides whether a player may start decoding here, and getting it wrong
   * produces a stream that plays from the beginning and cannot seek.
   */
  readonly isKeyFrame: boolean;
  /**
   * Composition time offset in microseconds, for streams with B-frames. Zero
   * when presentation order matches decode order, which is the case this
   * project's encoder settings deliberately arrange.
   */
  readonly compositionOffsetUs?: number;
}

export type TrackKind = "video" | "audio";

/**
 * Everything the muxer needs to write a track's `stsd` sample entry.
 *
 * `description` is the codec-specific configuration record — `avcC` for AVC,
 * `vpcC` for VP9, `av1C` for AV1, the AudioSpecificConfig for AAC. WebCodecs
 * hands this over ready-made in `EncodedVideoChunkMetadata.decoderConfig
 * .description`, which is the single most useful thing the API does for a
 * muxer: it is the one structure that genuinely cannot be derived from the
 * codec string. For AV1 in particular, `av1C` requires parsing a Sequence
 * Header OBU, and a muxer that tried to synthesise it would be guessing.
 */
export interface TrackConfig {
  readonly kind: TrackKind;
  /** RFC 6381, e.g. `avc1.4d401f`. Goes into the HLS `CODECS` attribute. */
  readonly codec: string;
  readonly description?: Uint8Array;
  /**
   * Ticks per second for this track's media timeline. Chosen per track, not
   * globally — video and audio have genuinely different natural rates and a
   * shared timescale forces one of them to round every sample.
   */
  readonly timescale: number;

  /** Video only. */
  readonly width?: number;
  readonly height?: number;

  /** Audio only. */
  readonly sampleRate?: number;
  readonly channelCount?: number;
}

/** One rung of the ladder, as the encoder is asked to produce it. */
export interface LadderRung {
  /** The label the quality menu shows: `1080p`, `720p`, … */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Target bits per second handed to `VideoEncoder.configure`. */
  readonly bitrate: number;
  readonly codec: string;
}

/**
 * A packaged segment, ready to store.
 *
 * `index` is sequential from zero; `durationSeconds` is what the playlist's
 * `EXTINF` will declare. Both are carried out of the muxer rather than
 * recomputed by the packager, because the muxer is the only thing that knows
 * what actually went into the segment after keyframe alignment moved the
 * boundary.
 */
export interface PackagedSegment {
  readonly index: number;
  readonly data: Uint8Array;
  readonly durationSeconds: number;
  readonly startSeconds: number;
}
