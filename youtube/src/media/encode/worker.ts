/**
 * The Worker entry point, and the protocol it speaks.
 *
 * The transcode has to leave the main thread. It is minutes of sustained
 * encode; on the main thread it would compete with the very upload UI that is
 * meant to report its progress, and every `drawImage` would land between two
 * frames of the page's own compositing.
 *
 * ## Why the message types are shaped the way they are
 *
 * **Nothing WebCodecs-typed crosses the boundary.** `VideoFrame`,
 * `EncodedVideoChunk` and `VideoEncoderConfig` are not structured-cloneable.
 * Chunks going in are plain `EncodedChunkRecord`s; samples coming out are the
 * `EncodedSample`s from `@/media/types` that the muxer wants anyway.
 *
 * **The source arrives as a transferable, not as a `File`.** A
 * `ReadableStream` of demuxed chunks (transferable, and it carries backpressure
 * across the thread boundary for free) or a `MediaStreamTrack` (transferable,
 * and the `<video>` it came from has to stay on the main thread). Handing the
 * worker a `File` would mean the demuxer lived in here too, and demuxing is
 * explicitly not this slice.
 *
 * **Every union is closed and provably listed.** `TRANSCODE_EVENT_KINDS` is
 * checked against the union in both directions at compile time, and every
 * `switch` ends in `assertNever`. Adding a message kind without handling it is
 * a type error at each switch rather than a message that silently vanishes —
 * which, in a protocol whose whole job is reporting progress, would look like a
 * hung upload.
 */

import type { EncodedSample, LadderRung, TrackConfig } from "@/media/types";

import type { CodecFamily } from "./capabilities";
import { negotiateLadder } from "./capabilities";
import type {
  EncodedChunkRecord,
  FrameSource,
  SourceProfile,
  ThroughputRegime,
} from "./decode-source";
import {
  chunkRecordsFrom,
  decodedFrameSource,
  mediaStreamFrameSource,
} from "./decode-source";
import { SEGMENT_DURATION_US, selectLadder } from "./ladder";
import type {
  RungTrack,
  TranscodeFailureReason,
  TranscodeProgress,
  TranscodeSegment,
  TranscodeSummary,
} from "./transcode";
import {
  failureReasonOf,
  shouldFallBackToProgressive,
  transcode,
} from "./transcode";

/* --------------------------------------------------------- exhaustiveness -- */

/**
 * The runtime half of exhaustiveness.
 *
 * A `switch` that covers every member of a union narrows the scrutinee to
 * `never` in its `default`, so this call only compiles while the switch is
 * complete. It also throws at runtime, because the value can be `never` to the
 * compiler and still be a typo that arrived over `postMessage`.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled ${JSON.stringify(value)}`);
}

/**
 * `true` only when the listed kinds and the union have exactly the same
 * members. A missing kind and a stale kind are both compile errors, which is
 * what makes the exported arrays safe to iterate in tests.
 */
type Exhaustive<Union extends string, Listed extends string> = [
  Exclude<Union, Listed>,
] extends [never]
  ? [Exclude<Listed, Union>] extends [never]
    ? true
    : never
  : never;

/* ----------------------------------------------------------------- source -- */

export interface EncodedChunkSourceSpec {
  readonly kind: "encoded-chunks";
  readonly profile: SourceProfile;
  /** The source container's own decoder config, as the demuxer read it. */
  readonly decoderConfig: VideoDecoderConfig;
  readonly chunks: ReadableStream<EncodedChunkRecord>;
}

export interface MediaStreamSourceSpec {
  readonly kind: "media-stream";
  readonly profile: SourceProfile;
  readonly track: MediaStreamTrack;
}

export type TranscodeSourceSpec = EncodedChunkSourceSpec | MediaStreamSourceSpec;
export type TranscodeSourceKind = TranscodeSourceSpec["kind"];

export const TRANSCODE_SOURCE_KINDS = ["encoded-chunks", "media-stream"] as const;

export const TRANSCODE_SOURCE_KINDS_ARE_EXHAUSTIVE: Exhaustive<
  TranscodeSourceKind,
  (typeof TRANSCODE_SOURCE_KINDS)[number]
> = true;

export function frameSourceFor(spec: TranscodeSourceSpec): FrameSource {
  switch (spec.kind) {
    case "encoded-chunks":
      return decodedFrameSource({
        profile: spec.profile,
        decoderConfig: spec.decoderConfig,
        chunks: chunkRecordsFrom(spec.chunks),
      });
    case "media-stream":
      return mediaStreamFrameSource({ profile: spec.profile, track: spec.track });
    default:
      return assertNever(spec, "transcode source spec");
  }
}

/* --------------------------------------------------------------- requests -- */

export interface TranscodeStartRequest {
  readonly kind: "start";
  readonly jobId: string;
  readonly source: TranscodeSourceSpec;
  readonly segmentDurationUs?: number;
  readonly preference?: readonly CodecFamily[];
}

export interface TranscodeCancelRequest {
  readonly kind: "cancel";
  readonly jobId: string;
}

export type TranscodeRequest = TranscodeStartRequest | TranscodeCancelRequest;
export type TranscodeRequestKind = TranscodeRequest["kind"];

export const TRANSCODE_REQUEST_KINDS = ["start", "cancel"] as const;

export const TRANSCODE_REQUEST_KINDS_ARE_EXHAUSTIVE: Exhaustive<
  TranscodeRequestKind,
  (typeof TRANSCODE_REQUEST_KINDS)[number]
> = true;

/* ----------------------------------------------------------------- events -- */

/**
 * Sent once, before any encoding, and it is the message the UI needs most.
 *
 * `throughput` says whether the pipeline is running faster than real time or at
 * real time (see `decode-source.ts`), which decides whether the upload screen
 * can promise "about a minute" or has to say "about as long as your video".
 * `dropped` names the rungs this machine could not encode, so a degraded ladder
 * is visible rather than inferred from a short quality menu.
 */
export interface TranscodeReadyEvent {
  readonly kind: "ready";
  readonly jobId: string;
  readonly family: CodecFamily;
  readonly rungs: readonly LadderRung[];
  readonly dropped: readonly string[];
  readonly throughput: ThroughputRegime;
  readonly segmentDurationUs: number;
}

/** One rung's sample entry. Always precedes that rung's first segment. */
export interface TranscodeTrackEvent {
  readonly kind: "track";
  readonly jobId: string;
  readonly rung: string;
  readonly track: TrackConfig;
}

export interface TranscodeSegmentEvent {
  readonly kind: "segment";
  readonly jobId: string;
  readonly segment: TranscodeSegment;
}

export interface TranscodeProgressEvent {
  readonly kind: "progress";
  readonly jobId: string;
  readonly progress: TranscodeProgress;
}

export interface TranscodeFailedEvent {
  readonly kind: "failed";
  readonly jobId: string;
  readonly reason: TranscodeFailureReason;
  readonly message: string;
  /**
   * Precomputed rather than left to the caller: the routing rule lives with the
   * reasons, and a second copy in the UI would drift the first time a reason is
   * added.
   */
  readonly fallbackToProgressive: boolean;
}

export interface TranscodeDoneEvent {
  readonly kind: "done";
  readonly jobId: string;
  readonly summary: TranscodeSummary;
}

export type TranscodeEvent =
  | TranscodeReadyEvent
  | TranscodeTrackEvent
  | TranscodeSegmentEvent
  | TranscodeProgressEvent
  | TranscodeFailedEvent
  | TranscodeDoneEvent;

export type TranscodeEventKind = TranscodeEvent["kind"];

export const TRANSCODE_EVENT_KINDS = [
  "ready",
  "track",
  "segment",
  "progress",
  "failed",
  "done",
] as const;

export const TRANSCODE_EVENT_KINDS_ARE_EXHAUSTIVE: Exhaustive<
  TranscodeEventKind,
  (typeof TRANSCODE_EVENT_KINDS)[number]
> = true;

/* ------------------------------------------------------------- validation -- */

function isRequestKind(value: unknown): value is TranscodeRequestKind {
  return (
    typeof value === "string" &&
    (TRANSCODE_REQUEST_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Narrow an arbitrary `postMessage` payload to a request.
 *
 * A worker's inbox is not typed at runtime: anything on the page can post to
 * it, and a stale bundle can post last week's shape. Returning `undefined`
 * rather than throwing keeps the error on the protocol channel, where the
 * caller is already listening, instead of as an unhandled worker error.
 */
export function parseTranscodeRequest(data: unknown): TranscodeRequest | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const candidate = data as { kind?: unknown; jobId?: unknown };
  if (!isRequestKind(candidate.kind)) return undefined;
  if (typeof candidate.jobId !== "string" || candidate.jobId.length === 0) {
    return undefined;
  }
  return data as TranscodeRequest;
}

export function isTranscodeEventKind(value: unknown): value is TranscodeEventKind {
  return (
    typeof value === "string" &&
    (TRANSCODE_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The same narrowing in the other direction.
 *
 * The main thread's inbox is no more typed than the worker's, and a page that
 * runs more than one kind of worker will see all of their messages on the same
 * handler if anyone ever shares a port.
 */
export function parseTranscodeEvent(data: unknown): TranscodeEvent | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const candidate = data as { kind?: unknown; jobId?: unknown };
  if (!isTranscodeEventKind(candidate.kind)) return undefined;
  if (typeof candidate.jobId !== "string") return undefined;
  return data as TranscodeEvent;
}

/* ---------------------------------------------------------- transferables -- */

function collectSampleBuffers(
  samples: readonly EncodedSample[],
  into: Set<Transferable>,
): void {
  for (const sample of samples) {
    const { buffer } = sample.data;
    // `ArrayBufferLike` also covers `SharedArrayBuffer`, which is not
    // transferable — passing one would throw and take the whole message with
    // it. A `Set` because transferring the same buffer twice is also an error.
    if (buffer instanceof ArrayBuffer) into.add(buffer);
  }
}

/**
 * Which buffers to hand over rather than copy.
 *
 * Segment payloads are the bulk of everything this worker emits — a 1080p rung
 * at 5 Mbps is over a megabyte every two seconds, and structured clone would
 * copy all of it. Every buffer here was freshly allocated by `chunk.copyTo`, so
 * detaching it costs the worker nothing.
 */
export function transferablesFor(event: TranscodeEvent): Transferable[] {
  const transferables = new Set<Transferable>();
  switch (event.kind) {
    case "segment":
      collectSampleBuffers(event.segment.samples, transferables);
      break;
    case "track": {
      const { description } = event.track;
      if (description && description.buffer instanceof ArrayBuffer) {
        transferables.add(description.buffer);
      }
      break;
    }
    case "ready":
    case "progress":
    case "failed":
    case "done":
      break;
    default:
      return assertNever(event, "transcode event");
  }
  return [...transferables];
}

/* ------------------------------------------------------------- the worker -- */

export interface TranscodeWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void;
  postMessage(message: TranscodeEvent, transfer: Transferable[]): void;
}

/**
 * Seams for the protocol tests.
 *
 * `run` is injectable because a real transcode needs a real `VideoEncoder`, and
 * a `VideoEncoder` faked well enough to produce bytes would be testing the
 * fake. Injecting it lets the message plumbing — ordering, transferables,
 * cancellation, error mapping — be tested honestly, and leaves the encoding
 * itself to Playwright.
 */
export interface TranscodeWorkerDeps {
  readonly negotiate: typeof negotiateLadder;
  readonly run: typeof transcode;
}

const defaultDeps: TranscodeWorkerDeps = {
  negotiate: negotiateLadder,
  run: transcode,
};

export function installTranscodeWorker(
  scope: TranscodeWorkerScope,
  deps: Partial<TranscodeWorkerDeps> = {},
): void {
  const resolved: TranscodeWorkerDeps = { ...defaultDeps, ...deps };
  const jobs = new Map<string, AbortController>();

  const post = (event: TranscodeEvent): void => {
    scope.postMessage(event, transferablesFor(event));
  };

  scope.addEventListener("message", (message) => {
    const request = parseTranscodeRequest(message.data);
    if (!request) {
      post({
        kind: "failed",
        jobId: "",
        reason: "unknown",
        message: `Unrecognised message: ${describe(message.data)}`,
        fallbackToProgressive: false,
      });
      return;
    }

    switch (request.kind) {
      case "start":
        void runJob(resolved, jobs, post, request);
        return;
      case "cancel":
        jobs.get(request.jobId)?.abort();
        return;
      default:
        assertNever(request, "transcode worker request");
    }
  });
}

async function runJob(
  deps: TranscodeWorkerDeps,
  jobs: Map<string, AbortController>,
  post: (event: TranscodeEvent) => void,
  request: TranscodeStartRequest,
): Promise<void> {
  const { jobId } = request;
  const controller = new AbortController();
  jobs.set(jobId, controller);
  const segmentDurationUs = request.segmentDurationUs ?? SEGMENT_DURATION_US;

  try {
    const source = frameSourceFor(request.source);
    const ladder = await deps.negotiate({
      shapes: selectLadder(source.profile),
      frameRate: source.profile.frameRate,
      ...(request.preference === undefined ? {} : { preference: request.preference }),
    });

    post({
      kind: "ready",
      jobId,
      family: ladder.family,
      rungs: ladder.rungs,
      dropped: ladder.dropped,
      throughput: source.throughput,
      segmentDurationUs,
    });

    const summary = await deps.run({
      source,
      ladder,
      segmentDurationUs,
      signal: controller.signal,
      sink: {
        track: (track: RungTrack) =>
          post({ kind: "track", jobId, rung: track.rung.name, track: track.track }),
        segment: (segment: TranscodeSegment) =>
          post({ kind: "segment", jobId, segment }),
        progress: (progress: TranscodeProgress) =>
          post({ kind: "progress", jobId, progress }),
      },
    });

    post({ kind: "done", jobId, summary });
  } catch (error) {
    const reason = failureReasonOf(error);
    post({
      kind: "failed",
      jobId,
      reason,
      message: error instanceof Error ? error.message : String(error),
      fallbackToProgressive: shouldFallBackToProgressive(reason),
    });
  } finally {
    jobs.delete(jobId);
  }
}

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return String(value);
  const kind = (value as { kind?: unknown }).kind;
  return kind === undefined ? "object without a kind" : `kind ${String(kind)}`;
}

/* ---------------------------------------------------------------- install -- */

/**
 * Install only when this module really is a worker's global scope.
 *
 * The main thread imports this file for its types, and `index.ts` imports it
 * for `parseTranscodeRequest`; neither should install a message handler on the
 * window. `WorkerGlobalScope` is checked rather than `DedicatedWorkerGlobalScope`
 * because the latter is declared in `lib.webworker`, which this project does
 * not include — adding it would make every DOM global in the app look like it
 * had a worker counterpart.
 */
const maybeWorkerScope = globalThis as {
  WorkerGlobalScope?: abstract new () => unknown;
  document?: unknown;
};

if (
  maybeWorkerScope.document === undefined &&
  typeof maybeWorkerScope.WorkerGlobalScope === "function" &&
  globalThis instanceof maybeWorkerScope.WorkerGlobalScope
) {
  installTranscodeWorker(globalThis as unknown as TranscodeWorkerScope);
}
