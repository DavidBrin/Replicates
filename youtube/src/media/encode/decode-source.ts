/**
 * Getting `VideoFrame`s out of the user's file.
 *
 * ## Which of research/01 §9's three options, and what it costs
 *
 * **`VideoDecoder`, fed by a demuxer.** It is the only one of the three that is
 * not pinned to wall-clock playback: you push `EncodedVideoChunk`s as fast as
 * you can read them and frames come back as fast as the codec can produce them.
 * §9.1 makes the consequence concrete — if decode ran at 1×, a ten-minute
 * upload would spend ten minutes decoding before a single encoder had finished,
 * and the whole "the browser does the transcode" bet stops being a good trade.
 * On this path the pipeline runs **faster than real time**, and how much faster
 * is set by the encoders, not by us.
 *
 * The bill for that arrives immediately, and §9.2 states it plainly: **WebCodecs
 * does not demux.** Something has to parse the MP4/MOV, pull out the source's
 * own codec string and `avcC`, and cut the `mdat` into per-sample chunks. That
 * something is not in this slice and is not in this repository — mp4box.js and
 * web-demuxer are both dependencies, and `package.json` is shared with five
 * other slices building right now.
 *
 * So this module takes the demuxer as a **port**: `decodedFrameSource` accepts a
 * `VideoDecoderConfig` and a stream of already-demuxed chunk records, and knows
 * nothing about containers. When a demuxer lands, it plugs in here and nothing
 * else changes.
 *
 * **`MediaStreamTrackProcessor`, from a `<video>`'s `captureStream()`.** The
 * path that works today with zero dependencies, and it is included for exactly
 * that reason. It costs what §9.1 says it costs: frames arrive at playback
 * rate, so a ten-minute video takes **at least ten minutes**, and the frames
 * have been through the browser's display pipeline rather than straight off the
 * decoder.
 *
 * That difference is not an implementation detail the UI can discover later —
 * it is the difference between "encoding, about 40 seconds" and "encoding, this
 * will take about as long as your video". `FrameSource.throughput` carries it,
 * the worker reports it in its first message, and the progress bar reads it.
 *
 * The third option in §9 — `drawImage` from an `HTMLVideoElement` on
 * `requestVideoFrameCallback` — is rejected outright: it is real-time *and*
 * unavailable in a Worker, so it would put the whole transcode on the thread
 * that also has to keep the upload UI responsive.
 */

import type { SourceDimensions } from "./ladder";

/** What the transcoder needs to know about the file before it starts. */
export interface SourceProfile extends SourceDimensions {
  /** Frames per second. Feeds the encoder config and the level choice. */
  readonly frameRate: number;
  /** Total presentation duration, when the container declares one. */
  readonly durationUs?: number;
  /** Total frame count, when the container declares one. */
  readonly frameCount?: number;
}

/**
 * One demuxed sample, as a plain struct.
 *
 * Deliberately not an `EncodedVideoChunk`: this crosses a `postMessage`
 * boundary, and WebCodecs objects are not structured-cloneable. It is also the
 * same shape as `EncodedSample` in `@/media/types` by coincidence rather than
 * by inheritance — that one is muxer input, this one is decoder input, and
 * collapsing them would couple the two ends of the pipeline through a type
 * neither of them owns.
 */
export interface EncodedChunkRecord {
  readonly type: "key" | "delta";
  readonly timestampUs: number;
  readonly durationUs?: number;
  readonly data: Uint8Array;
}

export type ThroughputRegime = "faster-than-realtime" | "realtime";

export interface FrameSource {
  readonly profile: SourceProfile;
  readonly throughput: ThroughputRegime;
  /**
   * Frames in presentation order.
   *
   * The consumer owns each frame it receives and must `close()` it. Use
   * {@link forEachFrame} rather than iterating this directly — it is the
   * difference between a lifetime rule and a lifetime guarantee.
   */
  frames(signal?: AbortSignal): AsyncGenerator<VideoFrame, void, void>;
}

/** Raised when the decode side fails; the transcoder maps it to a failure reason. */
export class DecodeSourceError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DecodeSourceError";
    this.cause = cause;
  }
}

/* ------------------------------------------------------------- lifetimes -- */

/**
 * Run `body` against a frame and close it, whatever happens.
 *
 * `VideoFrame` wraps a GPU buffer from a pool of a handful, and research/01 §10
 * is explicit that missing a `close()` risks a hard resource ceiling rather
 * than merely deferring work to the collector. The failure mode is not
 * gradual: after a few dozen leaked frames the decoder simply stops emitting
 * and the transcode hangs with no error.
 *
 * The helper exists so that no call site has to remember. A `try/finally`
 * repeated at four call sites is four places a future edit can add an early
 * return between the `try` and the `close`.
 */
export function withFrame<T>(frame: VideoFrame, body: (frame: VideoFrame) => T): T {
  try {
    return body(frame);
  } finally {
    frame.close();
  }
}

export interface ForEachFrameOptions {
  readonly signal?: AbortSignal;
  /**
   * Runs after the current frame has been closed and before the next is pulled.
   *
   * This exists so that waiting — for backpressure, for a slow consumer — never
   * happens with a frame held open. `visit` is deliberately synchronous for the
   * same reason: an `await` inside it would pin a pooled hardware buffer for the
   * duration of the wait, which is precisely the pressure the wait is trying to
   * relieve.
   */
  readonly afterEach?: () => Promise<void> | void;
}

/**
 * Drive a `FrameSource`, closing every frame — including the ones still in
 * flight when `visit` throws.
 *
 * The generator's own `finally` disposes whatever it has buffered when
 * `return()` is called on it, which is what `for await` does on an early exit.
 * So a throw anywhere in the loop body still releases the whole pipeline's
 * frames, not just the one in hand.
 */
export async function forEachFrame(
  source: FrameSource,
  visit: (frame: VideoFrame) => void,
  options: ForEachFrameOptions = {},
): Promise<void> {
  for await (const frame of source.frames(options.signal)) {
    withFrame(frame, visit);
    await options.afterEach?.();
  }
}

/* ----------------------------------------------------------- frame queue -- */

/**
 * A bounded hand-off between the decoder's output callback and the consumer.
 *
 * The decoder calls `output` synchronously from its own scheduling; the
 * consumer pulls at whatever rate the encoders allow. Without a bound in
 * between, a fast decoder in front of six slow encoders builds an unbounded
 * pile of GPU-backed frames — research/01 §10's documented route to a tab-level
 * OOM.
 *
 * The bound is enforced on the *input* side, by not calling `decode()` while
 * the queue is full. The output callback itself cannot be paused, so the queue
 * can overshoot by whatever the decoder already had in flight; that overshoot
 * is bounded by the decoder's own queue and is the reason `push` accepts
 * frames past capacity rather than dropping them. Dropping is not an option —
 * every source frame has to appear in every rendition.
 */
class FrameQueue {
  readonly #capacity: number;
  #items: VideoFrame[] = [];
  #closed = false;
  #failure: { error: unknown } | undefined;
  #wakeConsumer: (() => void) | undefined;
  #wakeProducer: (() => void) | undefined;

  constructor(capacity: number) {
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#items.length;
  }

  push(frame: VideoFrame): void {
    if (this.#closed) {
      // Nobody will ever read this. Closing it here is the whole reason the
      // late-arriving frames of an aborted decode do not leak.
      frame.close();
      return;
    }
    this.#items.push(frame);
    this.#wakeConsumer?.();
    this.#wakeConsumer = undefined;
  }

  /** Producer-side backpressure. Resolves when there is room, or on shutdown. */
  async waitForRoom(): Promise<void> {
    while (!this.#closed && !this.#failure && this.#items.length >= this.#capacity) {
      await new Promise<void>((resolve) => {
        this.#wakeProducer = resolve;
      });
    }
  }

  close(): void {
    this.#closed = true;
    this.#wake();
  }

  fail(error: unknown): void {
    this.#failure ??= { error };
    this.#closed = true;
    this.#wake();
  }

  async next(): Promise<VideoFrame | undefined> {
    for (;;) {
      const frame = this.#items.shift();
      if (frame) {
        this.#wakeProducer?.();
        this.#wakeProducer = undefined;
        return frame;
      }
      if (this.#failure) throw this.#failure.error;
      if (this.#closed) return undefined;
      await new Promise<void>((resolve) => {
        this.#wakeConsumer = resolve;
      });
    }
  }

  /** Close every frame still queued. Called from the generator's `finally`. */
  dispose(): void {
    this.#closed = true;
    for (const frame of this.#items) frame.close();
    this.#items = [];
    this.#wake();
  }

  #wake(): void {
    this.#wakeConsumer?.();
    this.#wakeConsumer = undefined;
    this.#wakeProducer?.();
    this.#wakeProducer = undefined;
  }
}

/**
 * How many decoded frames may sit between the decoder and the encoders.
 *
 * Small on purpose. research/01 §10 describes the frame pool as a hard ceiling
 * rather than a soft memory cost, and every frame parked here is one the pool
 * cannot hand back. Four is enough to keep the encoders fed across an event
 * loop turn and is **assumed, not measured** — the honest experiment is to
 * watch decoder stalls at 1, 4 and 16 on a real ten-minute file, which needs a
 * browser.
 */
const DECODED_FRAME_CAPACITY = 4;

/** The decoder's own queue high-water mark, same reasoning, same status. */
const DECODE_QUEUE_HIGH_WATER = 8;

export interface DecodedFrameSourceOptions {
  readonly profile: SourceProfile;
  /**
   * The source's decoder config, as the demuxer read it out of the container.
   * `description` is the source file's own `avcC`/`hvcC`/`vpcC` and is required
   * for any codec that carries parameter sets out of band.
   */
  readonly decoderConfig: VideoDecoderConfig;
  readonly chunks: AsyncIterable<EncodedChunkRecord>;
}

/**
 * The fast path: decode as fast as the codec allows, bounded by the encoders.
 *
 * Runs **faster than real time**.
 */
export function decodedFrameSource(
  options: DecodedFrameSourceOptions,
): FrameSource {
  return {
    profile: options.profile,
    throughput: "faster-than-realtime",
    frames: (signal) => decodeFrames(options, signal),
  };
}

async function* decodeFrames(
  options: DecodedFrameSourceOptions,
  signal: AbortSignal | undefined,
): AsyncGenerator<VideoFrame, void, void> {
  const DecoderCtor = (globalThis as { VideoDecoder?: typeof VideoDecoder })
    .VideoDecoder;
  if (!DecoderCtor) {
    throw new DecodeSourceError(
      "VideoDecoder is not available. WebCodecs needs a secure context — " +
        "research/01 §4.1 found it silently absent on an un-navigated page.",
    );
  }

  const queue = new FrameQueue(DECODED_FRAME_CAPACITY);
  const decoder = new DecoderCtor({
    output: (frame) => queue.push(frame),
    error: (error) => queue.fail(new DecodeSourceError("VideoDecoder failed", error)),
  });

  const onAbort = () => queue.fail(new DecodeSourceError("Decode aborted"));
  signal?.addEventListener("abort", onAbort, { once: true });

  // Pumped concurrently with the consumer: the generator below yields frames
  // while this keeps feeding chunks in, which is the whole point of decoupling
  // decode from encode. Its rejection is surfaced through the queue rather than
  // floated, so an unhandled rejection cannot escape.
  const pump = (async () => {
    decoder.configure(options.decoderConfig);
    for await (const record of options.chunks) {
      if (signal?.aborted) return;
      await queue.waitForRoom();
      while (decoder.decodeQueueSize > DECODE_QUEUE_HIGH_WATER) {
        await nextDequeue(decoder);
      }
      if (decoder.state !== "configured") return;
      decoder.decode(
        new EncodedVideoChunk({
          type: record.type,
          timestamp: record.timestampUs,
          ...(record.durationUs === undefined ? {} : { duration: record.durationUs }),
          data: record.data,
        }),
      );
    }
    // research/01 §1.1: only after `flush()` resolves have the frames the codec
    // was holding for reordering actually been emitted.
    await decoder.flush();
  })();

  pump.then(
    () => queue.close(),
    (error: unknown) => queue.fail(error),
  );

  try {
    for (;;) {
      const frame = await queue.next();
      if (!frame) return;
      yield frame;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    queue.dispose();
    if (decoder.state !== "closed") decoder.close();
    await pump.catch(() => undefined);
  }
}

/** Resolve on the codec's next `dequeue` event — §10's flow-control signal. */
function nextDequeue(codec: VideoDecoder): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = () => {
      codec.removeEventListener("dequeue", listener);
      resolve();
    };
    codec.addEventListener("dequeue", listener);
  });
}

/* ---------------------------------------------------- real-time fallback -- */

interface TrackProcessorLike {
  readonly readable: ReadableStream<VideoFrame>;
}

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessorLike;

export interface MediaStreamFrameSourceOptions {
  readonly profile: SourceProfile;
  readonly track: MediaStreamTrack;
}

/**
 * The dependency-free path: frames off a live `MediaStreamTrack`.
 *
 * Runs at **real time**. The track comes from a `<video>`'s `captureStream()`
 * on the main thread — `MediaStreamTrack` is transferable, so the element stays
 * where it must and the frames arrive here.
 *
 * `MediaStreamTrackProcessor` is Chromium-only and unstandardised, which is a
 * second reason this is the fallback rather than the path. It is typed
 * structurally below because neither `lib.dom` nor `@types/dom-webcodecs`
 * declares it, and inventing a global declaration for a non-standard API would
 * make it look available everywhere.
 */
export function mediaStreamFrameSource(
  options: MediaStreamFrameSourceOptions,
): FrameSource {
  return {
    profile: options.profile,
    throughput: "realtime",
    frames: (signal) => readTrackFrames(options.track, signal),
  };
}

async function* readTrackFrames(
  track: MediaStreamTrack,
  signal: AbortSignal | undefined,
): AsyncGenerator<VideoFrame, void, void> {
  const Ctor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  if (!Ctor) {
    throw new DecodeSourceError(
      "MediaStreamTrackProcessor is not available in this browser. Without it " +
        "and without a demuxer there is no way to read frames, and the caller " +
        "should upload the source file unprocessed.",
    );
  }

  const reader = new Ctor({ track }).readable.getReader();
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    // Cancelling is assumed to close the frames the stream had queued; the spec
    // says a cancelled stream releases its chunks, but this project has not
    // watched the frame pool to confirm it.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/* -------------------------------------------------------------- adapters -- */

/**
 * A transferable `ReadableStream` of demuxed chunks as an async iterable.
 *
 * `ReadableStream` is what crosses `postMessage` — an async generator is not
 * cloneable — so the worker's `start` message carries a stream and this turns
 * it back into something `for await` can drive. Written by hand rather than
 * relying on `Symbol.asyncIterator` on `ReadableStream`, which Safari still
 * does not implement.
 */
export async function* chunkRecordsFrom(
  stream: ReadableStream<EncodedChunkRecord>,
): AsyncIterable<EncodedChunkRecord> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
