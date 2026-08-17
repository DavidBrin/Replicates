/**
 * One decode pass, fanned out to every rung.
 *
 * This is the decision the whole slice is built around. The obvious shape — a
 * loop over rungs, each doing its own decode — is six full decodes of the
 * source, and a six-rung transcode that takes six times as long. On a
 * ten-minute upload that is the difference between a progress bar the uploader
 * watches and one they close the tab on. So the source is decoded exactly once
 * and each frame is handed to all N encoders, downscaled per rung, before it is
 * released.
 *
 * Three invariants hold the design together, and each has its own defence:
 *
 *  - **Every frame is closed.** A `VideoFrame` holds a pooled hardware buffer
 *    and the pool is small (research/01 §10). Leaking a few dozen stalls the
 *    decoder permanently, with no error and no partial output. Source frames
 *    are owned by `forEachFrame`, per-rung downscaled copies never escape the
 *    method that creates them, and both use `withFrame` rather than a hand-
 *    written `try/finally`.
 *  - **Keyframes are decided once.** `createSegmentGate` is called on the
 *    source frame and its answer is passed to every encoder. Six gates fed the
 *    same timestamps would agree, but one gate cannot disagree with itself.
 *  - **Segment boundaries come from the timestamp, never from `chunk.type`.**
 *    An encoder is free to insert an IDR of its own at a scene change, and
 *    different rungs would choose different scene changes. Cutting on
 *    `segmentIndexAt(chunk.timestamp)` makes the boundaries provably identical
 *    across rungs, because it is the same pure function the gate used.
 */

import type { EncodedSample, LadderRung, TrackConfig } from "@/media/types";

import type { CodecFamily, NegotiatedLadder } from "./capabilities";
import { encoderConfigFor, isCodecNegotiationError } from "./capabilities";
import type { FrameSource, ThroughputRegime } from "./decode-source";
import { DecodeSourceError, forEachFrame, withFrame } from "./decode-source";
import { SEGMENT_DURATION_US, createSegmentGate, segmentIndexAt } from "./ladder";

/* ----------------------------------------------------------------- types -- */

export type TranscodeFailureReason =
  | "no-webcodecs"
  | "no-supported-codec"
  | "decoder-error"
  | "encoder-error"
  | "reordered-output"
  | "cancelled"
  | "unknown";

export class TranscodeError extends Error {
  readonly reason: TranscodeFailureReason;
  readonly cause?: unknown;

  constructor(reason: TranscodeFailureReason, message: string, cause?: unknown) {
    super(message);
    this.name = "TranscodeError";
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * Whether the caller should stop trying to build a ladder and upload the file
 * as it is.
 *
 * Only the two "this browser cannot do it" reasons qualify. An encoder error or
 * a reordered output is a bug or a broken file, and silently degrading to a
 * progressive upload would hide it — the upload still has to succeed, but the
 * caller should know it is papering over a fault rather than serving a device
 * that never had WebCodecs.
 */
export function shouldFallBackToProgressive(reason: TranscodeFailureReason): boolean {
  return reason === "no-webcodecs" || reason === "no-supported-codec";
}

/** Map anything thrown inside the pipeline onto a reason the caller can route. */
export function failureReasonOf(error: unknown): TranscodeFailureReason {
  if (error instanceof TranscodeError) return error.reason;
  if (isCodecNegotiationError(error)) return error.reason;
  if (error instanceof DecodeSourceError) return "decoder-error";
  return "unknown";
}

/** A rung's `stsd` sample entry, announced once, before its first segment. */
export interface RungTrack {
  readonly rung: LadderRung;
  readonly track: TrackConfig;
}

/**
 * One rung's worth of one segment: exactly the muxer's input, grouped so that
 * every rung's segment `index` covers the same span of the presentation
 * timeline.
 */
export interface TranscodeSegment {
  readonly rung: string;
  readonly index: number;
  readonly startUs: number;
  readonly durationUs: number;
  readonly samples: readonly EncodedSample[];
}

/**
 * Progress good enough to drive a real bar.
 *
 * `fraction` is derived from the presentation timeline rather than from a frame
 * count, because the timeline is the thing the container declared up front and
 * the frame count usually is not. When neither duration nor frame count is
 * known it is `undefined`, which the UI must render as an indeterminate bar —
 * a made-up fraction that jumps to 100% and sits there is worse than no bar.
 */
export interface TranscodeProgress {
  readonly framesDecoded: number;
  readonly segmentsEmitted: number;
  readonly bytesEncoded: number;
  /** Presentation timestamp of the most recently decoded frame. */
  readonly presentedUs: number;
  readonly durationUs?: number;
  readonly fraction?: number;
  /** Largest `encodeQueueSize` across the ladder — how far encode is behind. */
  readonly encodeBacklog: number;
}

export interface TranscodeSink {
  track(track: RungTrack): void;
  segment(segment: TranscodeSegment): void;
  progress(progress: TranscodeProgress): void;
}

export interface TranscodeSummary {
  readonly family: CodecFamily;
  readonly rungs: readonly LadderRung[];
  readonly throughput: ThroughputRegime;
  readonly framesDecoded: number;
  readonly segmentCount: number;
  readonly bytesEncoded: number;
  readonly presentedUs: number;
  readonly elapsedMs: number;
}

export interface TranscodeOptions {
  readonly source: FrameSource;
  readonly ladder: NegotiatedLadder;
  readonly sink: TranscodeSink;
  readonly signal?: AbortSignal;
  readonly segmentDurationUs?: number;
  readonly progressIntervalMs?: number;
  /** Injectable clock, so progress throttling is testable without waiting. */
  readonly now?: () => number;
}

/* ------------------------------------------------------------ constants -- */

/**
 * WebCodecs timestamps are microseconds, so a microsecond timescale means the
 * muxer converts once and rounds never. `@/media/types` makes the same point
 * from the other side: every drift bug in a muxer comes from converting twice.
 */
const TRACK_TIMESCALE = 1_000_000;

/**
 * Stop pulling frames when any encoder has this many queued, resume at the low
 * mark.
 *
 * research/01 §10 gives the mechanism — watch `encodeQueueSize`, wait on
 * `dequeue` — but not the numbers, and Chrome's own samples respond to
 * backpressure by *dropping* frames, which a batch transcode cannot do: every
 * source frame must appear in every rendition. So the response here is to stop
 * pulling, which turns `dequeue` into flow control for the decode stage.
 *
 * The two marks are **assumed, not measured**. A single mark would make the
 * loop wake and sleep on every frame once it hit the ceiling; the gap is what
 * lets the encoders build a little runway.
 */
const ENCODE_QUEUE_HIGH_WATER = 4;
const ENCODE_QUEUE_LOW_WATER = 2;

const DEFAULT_PROGRESS_INTERVAL_MS = 250;

/* -------------------------------------------------------- the rung encoder -- */

function copyDescription(source: AllowSharedBufferSource): Uint8Array {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  // A copy, not a view: `description` is documented as valid only for the
  // duration of the callback, and the muxer reads it much later.
  return new Uint8Array(view);
}

/**
 * One rung: a canvas, an encoder, and the segment currently being filled.
 *
 * The canvas is per-rung and allocated once. Reallocating per frame would churn
 * a GPU texture 30 times a second per rung; sharing one canvas across rungs
 * would mean resizing it per rung per frame, which is the same churn wearing a
 * disguise.
 */
class RungEncoder {
  readonly rung: LadderRung;

  readonly #encoder: VideoEncoder;
  readonly #canvas: OffscreenCanvas;
  readonly #context: OffscreenCanvasRenderingContext2D;
  readonly #segmentDurationUs: number;
  readonly #defaultSampleDurationUs: number;
  readonly #onTrack: (track: RungTrack) => void;
  readonly #onSegment: (segment: TranscodeSegment) => void;

  #track: TrackConfig | undefined;
  #samples: EncodedSample[] = [];
  #openSegment: number | undefined;
  #lastTimestampUs = Number.NEGATIVE_INFINITY;
  #failure: unknown;
  #waiters: (() => void)[] = [];

  bytesEncoded = 0;
  segmentsEmitted = 0;

  constructor(options: {
    rung: LadderRung;
    frameRate: number;
    segmentDurationUs: number;
    onTrack: (track: RungTrack) => void;
    onSegment: (segment: TranscodeSegment) => void;
  }) {
    this.rung = options.rung;
    this.#segmentDurationUs = options.segmentDurationUs;
    this.#defaultSampleDurationUs = Math.round(1_000_000 / options.frameRate);
    this.#onTrack = options.onTrack;
    this.#onSegment = options.onSegment;

    this.#canvas = new OffscreenCanvas(options.rung.width, options.rung.height);
    const context = this.#canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new TranscodeError(
        "encoder-error",
        `No 2D context for the ${options.rung.name} rung's OffscreenCanvas.`,
      );
    }
    // The default is bilinear, which on a 1920→256 downscale aliases badly
    // enough to be visible as shimmer on the 144p rung.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    this.#context = context;

    this.#encoder = new VideoEncoder({
      output: (chunk, metadata) => this.#onChunk(chunk, metadata),
      error: (error) => this.#fail(error),
    });
    this.#encoder.addEventListener("dequeue", () => this.#wake());
    this.#encoder.configure(encoderConfigFor(options.rung, options.frameRate));
  }

  get queueSize(): number {
    return this.#encoder.state === "configured" ? this.#encoder.encodeQueueSize : 0;
  }

  get failure(): unknown {
    return this.#failure;
  }

  /**
   * Downscale into this rung's canvas and encode.
   *
   * The source frame is borrowed, never owned — `forEachFrame` closes it. The
   * scaled copy is created and closed inside `withFrame` here, so it has no path
   * out of this method. research/01 §10 confirms closing immediately after
   * `encode()` is correct: the encoder takes what it needs synchronously, and
   * the chunk still comes out with the right content.
   */
  encode(frame: VideoFrame, keyFrame: boolean): void {
    if (this.#failure) return;
    if (this.#encoder.state !== "configured") return;

    if (this.#matchesSourceExactly(frame)) {
      // The top rung of a source that is already at a ladder resolution. The
      // canvas round trip would be a full-resolution blit that changes nothing.
      this.#encoder.encode(frame, { keyFrame });
      return;
    }

    this.#context.drawImage(frame, 0, 0, this.rung.width, this.rung.height);
    const scaled = new VideoFrame(this.#canvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? this.#defaultSampleDurationUs,
    });
    withFrame(scaled, (copy) => this.#encoder.encode(copy, { keyFrame }));
  }

  /** Wait until this encoder has caught up, or until it fails or shuts down. */
  async waitForDrain(): Promise<void> {
    while (
      !this.#failure &&
      this.#encoder.state === "configured" &&
      this.#encoder.encodeQueueSize > ENCODE_QUEUE_LOW_WATER
    ) {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  /** Drain the codec and emit whatever segment was still open. */
  async finish(): Promise<void> {
    if (this.#failure) throw this.#failure;
    if (this.#encoder.state === "configured") {
      // research/01 §1.1: flush() is the only guarantee that the frames the
      // codec was holding have produced their chunks.
      await this.#encoder.flush();
    }
    if (this.#failure) throw this.#failure;
    this.#closeOpenSegment();
  }

  /** Idempotent teardown; safe on the error path and on the happy path. */
  dispose(): void {
    this.#samples = [];
    if (this.#encoder.state !== "closed") this.#encoder.close();
    this.#wake();
  }

  #matchesSourceExactly(frame: VideoFrame): boolean {
    return (
      frame.codedWidth === this.rung.width &&
      frame.codedHeight === this.rung.height &&
      frame.displayWidth === this.rung.width &&
      frame.displayHeight === this.rung.height
    );
  }

  #onChunk(chunk: EncodedVideoChunk, metadata: EncodedVideoChunkMetadata | undefined): void {
    if (this.#failure) return;

    if (!this.#track) {
      const description = metadata?.decoderConfig?.description;
      this.#track = {
        kind: "video",
        codec: metadata?.decoderConfig?.codec ?? this.rung.codec,
        ...(description ? { description: copyDescription(description) } : {}),
        timescale: TRACK_TIMESCALE,
        width: this.rung.width,
        height: this.rung.height,
      };
      this.#onTrack({ rung: this.rung, track: this.#track });
    }

    if (chunk.timestamp < this.#lastTimestampUs) {
      // `@/media/types` says composition offsets are zero because "this
      // project's encoder settings deliberately arrange" decode order to match
      // presentation order. This is that arrangement: rather than assume no
      // B-frames, check, and fail where the assumption breaks. Chromium's
      // WebCodecs AVC encoder has not been observed to reorder, but "not
      // observed" is not "cannot", and silently writing reordered samples with
      // a zero composition offset produces a file that stutters on playback
      // and looks like a player bug.
      this.#fail(
        new TranscodeError(
          "reordered-output",
          `The ${this.rung.name} encoder emitted a chunk at ${chunk.timestamp}µs ` +
            `after one at ${this.#lastTimestampUs}µs. This pipeline assumes ` +
            "decode order matches presentation order.",
        ),
      );
      return;
    }
    this.#lastTimestampUs = chunk.timestamp;

    const index = segmentIndexAt(chunk.timestamp, this.#segmentDurationUs);
    if (this.#openSegment !== undefined && index !== this.#openSegment) {
      this.#closeOpenSegment();
    }
    this.#openSegment = index;

    const data = new Uint8Array(chunk.byteLength);
    // research/01 §1.3: `EncodedVideoChunk` has no `.data`; `copyTo` is the
    // only way out.
    chunk.copyTo(data);
    this.bytesEncoded += data.byteLength;

    this.#samples.push({
      data,
      timestampUs: chunk.timestamp,
      durationUs: chunk.duration ?? this.#defaultSampleDurationUs,
      isKeyFrame: chunk.type === "key",
      compositionOffsetUs: 0,
    });
  }

  #closeOpenSegment(): void {
    const index = this.#openSegment;
    const samples = this.#samples;
    if (index === undefined || samples.length === 0) return;

    this.#samples = [];
    this.#openSegment = undefined;

    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    this.segmentsEmitted += 1;
    this.#onSegment({
      rung: this.rung.name,
      index,
      startUs: first.timestampUs,
      // The real span of the samples, not the nominal segment length: keyframe
      // alignment moves the boundary, and `EXTINF` has to declare what is
      // actually in the file.
      durationUs: last.timestampUs + last.durationUs - first.timestampUs,
      samples,
    });
  }

  #fail(error: unknown): void {
    this.#failure ??= error;
    this.#wake();
  }

  #wake(): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const resolve of waiters) resolve();
  }
}

/* ------------------------------------------------------------- the driver -- */

/**
 * Decode the source once and encode every rung from it.
 *
 * Resolves when every encoder has flushed and every segment has been handed to
 * the sink. Rejects with a `TranscodeError` whose `reason` the caller routes on
 * — see `shouldFallBackToProgressive`.
 */
export async function transcode(options: TranscodeOptions): Promise<TranscodeSummary> {
  const { source, ladder, sink, signal } = options;
  const segmentDurationUs = options.segmentDurationUs ?? SEGMENT_DURATION_US;
  const progressIntervalMs = options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());

  if (ladder.rungs.length === 0) {
    throw new TranscodeError(
      "no-supported-codec",
      "The negotiated ladder has no rungs, so there is nothing to encode.",
    );
  }
  if (typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined") {
    throw new TranscodeError(
      "no-webcodecs",
      "VideoEncoder or OffscreenCanvas is missing. Both are required, and " +
        "WebCodecs additionally needs a secure context (research/01 §4.1).",
    );
  }

  const startedAt = now();
  let framesDecoded = 0;
  let segmentsEmitted = 0;
  let presentedUs = 0;
  let lastProgressAt = Number.NEGATIVE_INFINITY;

  const encoders: RungEncoder[] = [];
  const bytes = () => encoders.reduce((total, e) => total + e.bytesEncoded, 0);
  const backlog = () => encoders.reduce((worst, e) => Math.max(worst, e.queueSize), 0);

  const emitProgress = (force: boolean): void => {
    const at = now();
    if (!force && at - lastProgressAt < progressIntervalMs) return;
    lastProgressAt = at;

    const durationUs = source.profile.durationUs;
    const frameCount = source.profile.frameCount;
    const fraction =
      durationUs !== undefined && durationUs > 0
        ? Math.min(1, presentedUs / durationUs)
        : frameCount !== undefined && frameCount > 0
          ? Math.min(1, framesDecoded / frameCount)
          : undefined;

    sink.progress({
      framesDecoded,
      segmentsEmitted,
      bytesEncoded: bytes(),
      presentedUs,
      ...(durationUs === undefined ? {} : { durationUs }),
      ...(fraction === undefined ? {} : { fraction }),
      encodeBacklog: backlog(),
    });
  };

  try {
    for (const rung of ladder.rungs) {
      encoders.push(
        new RungEncoder({
          rung,
          frameRate: source.profile.frameRate,
          segmentDurationUs,
          onTrack: (track) => sink.track(track),
          onSegment: (segment) => {
            segmentsEmitted += 1;
            sink.segment(segment);
          },
        }),
      );
    }

    const gate = createSegmentGate(segmentDurationUs);

    await forEachFrame(
      source,
      (frame) => {
        throwIfAborted(signal);
        throwIfEncoderFailed(encoders);

        // Decided once, on the source frame, and fanned out unchanged. This is
        // the line that keeps the ladder switchable.
        const { keyFrame } = gate.admit(frame.timestamp);
        for (const encoder of encoders) encoder.encode(frame, keyFrame);

        framesDecoded += 1;
        presentedUs = frame.timestamp;
        emitProgress(false);
      },
      {
        ...(signal === undefined ? {} : { signal }),
        // Waiting happens here, after the frame has been closed. Waiting inside
        // the visitor would hold a pooled hardware buffer open for exactly as
        // long as the encoders are behind — the pressure the wait exists to
        // relieve.
        afterEach: () => applyBackpressure(encoders, signal),
      },
    );

    throwIfAborted(signal);
    for (const encoder of encoders) await encoder.finish();

    emitProgress(true);

    return {
      family: ladder.family,
      rungs: ladder.rungs,
      throughput: source.throughput,
      framesDecoded,
      segmentCount: segmentsEmitted,
      bytesEncoded: bytes(),
      presentedUs,
      elapsedMs: now() - startedAt,
    };
  } catch (error) {
    throw asTranscodeError(error);
  } finally {
    // Unconditional: a rung that threw during construction leaves the ones
    // before it holding live codecs, and a codec that is never closed keeps its
    // share of the frame pool for the lifetime of the worker.
    for (const encoder of encoders) encoder.dispose();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new TranscodeError("cancelled", "The transcode was cancelled.");
  }
}

function throwIfEncoderFailed(encoders: readonly RungEncoder[]): void {
  for (const encoder of encoders) {
    if (encoder.failure !== undefined) throw encoder.failure;
  }
}

/**
 * Hold the decode stage until the slowest encoder has caught up.
 *
 * Gated on the *worst* rung rather than the average: the queues are fed in
 * lockstep, so the deepest one is the one that decides how many frames are
 * alive at once, and letting the others run ahead would not make it finish
 * sooner.
 */
async function applyBackpressure(
  encoders: readonly RungEncoder[],
  signal: AbortSignal | undefined,
): Promise<void> {
  while (encoders.some((e) => e.queueSize > ENCODE_QUEUE_HIGH_WATER)) {
    throwIfAborted(signal);
    throwIfEncoderFailed(encoders);
    await Promise.all(
      encoders
        .filter((e) => e.queueSize > ENCODE_QUEUE_HIGH_WATER)
        .map((e) => e.waitForDrain()),
    );
  }
  throwIfEncoderFailed(encoders);
}

function asTranscodeError(error: unknown): TranscodeError {
  if (error instanceof TranscodeError) return error;
  const reason = failureReasonOf(error);
  const message = error instanceof Error ? error.message : String(error);
  return new TranscodeError(
    reason === "unknown" ? "encoder-error" : reason,
    message,
    error,
  );
}
