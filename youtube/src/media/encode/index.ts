/**
 * The main-thread client. Everything above this line is the upload UI's view of
 * the transcode.
 *
 * It owns one `Worker` and turns its message stream into a promise plus a few
 * callbacks, because that is the shape a React upload screen can actually use:
 * `await` the summary, render the progress events as they arrive, and hand each
 * segment to the uploader the moment it exists rather than at the end.
 *
 * The worker module is imported here for its types and its parser, *and*
 * instantiated from the same file via `new URL("./worker.ts", import.meta.url)`
 * — the form Turbopack and Vite both recognise. That does put the protocol
 * module in two bundles; the install guard at the bottom of `worker.ts` is what
 * stops the main-thread copy from also registering a message handler.
 */

import type { TranscodeSummary } from "./transcode";
import { TranscodeError, shouldFallBackToProgressive } from "./transcode";
import type {
  TranscodeEvent,
  TranscodeFailedEvent,
  TranscodeProgressEvent,
  TranscodeReadyEvent,
  TranscodeRequest,
  TranscodeSegmentEvent,
  TranscodeSourceSpec,
  TranscodeStartRequest,
  TranscodeTrackEvent,
} from "./worker";
import { assertNever, parseTranscodeEvent } from "./worker";

export type {
  CodecFamily,
  CodecNegotiationReason,
  NegotiatedLadder,
} from "./capabilities";
export {
  CODEC_PREFERENCE,
  CodecNegotiationError,
  isCodecNegotiationError,
  negotiateLadder,
} from "./capabilities";
export type {
  EncodedChunkRecord,
  FrameSource,
  SourceProfile,
  ThroughputRegime,
} from "./decode-source";
export type { LadderShape } from "./ladder";
export {
  LADDER_REFERENCE_RUNGS,
  SEGMENT_DURATION_US,
  createSegmentGate,
  segmentIndexAt,
  selectLadder,
} from "./ladder";
export type {
  TranscodeFailureReason,
  TranscodeProgress,
  TranscodeSegment,
  TranscodeSummary,
} from "./transcode";
export { TranscodeError, shouldFallBackToProgressive } from "./transcode";
export type {
  TranscodeEvent,
  TranscodeRequest,
  TranscodeSourceSpec,
} from "./worker";
export { TRANSCODE_EVENT_KINDS, TRANSCODE_REQUEST_KINDS } from "./worker";

/**
 * Callbacks for the events that arrive *during* a run.
 *
 * `onSegment` is the one that matters architecturally: segments are handed over
 * as they are produced, so the upload overlaps the encode. Buffering them for
 * the returned promise would mean holding the entire ladder — every rung of
 * every second of the video — in memory before a single byte left the browser.
 */
export interface TranscodeHandlers {
  onReady?(event: TranscodeReadyEvent): void;
  onTrack?(event: TranscodeTrackEvent): void;
  onSegment?(event: TranscodeSegmentEvent): void;
  onProgress?(event: TranscodeProgressEvent): void;
}

export interface StartTranscodeOptions {
  readonly source: TranscodeSourceSpec;
  readonly jobId?: string;
  readonly segmentDurationUs?: number;
  readonly preference?: TranscodeStartRequest["preference"];
}

export interface Transcoder {
  start(
    options: StartTranscodeOptions,
    handlers?: TranscodeHandlers,
  ): Promise<TranscodeSummary>;
  /** Ask the worker to stop. The pending `start` rejects with `cancelled`. */
  cancel(): void;
  /** Terminate the worker. Anything in flight rejects. */
  dispose(): void;
}

export interface CreateTranscoderOptions {
  readonly createWorker?: () => Worker;
}

function defaultWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

/**
 * Which pieces of a start request are handed over rather than copied.
 *
 * Both source kinds are transferable and neither is cloneable, so this is not
 * an optimisation — a `postMessage` that forgot them would throw
 * `DataCloneError`.
 */
function sourceTransferables(source: TranscodeSourceSpec): Transferable[] {
  switch (source.kind) {
    case "encoded-chunks":
      return [source.chunks];
    case "media-stream":
      // `MediaStreamTrack` became transferable after `lib.dom`'s `Transferable`
      // union was written, so the cast is the type definition being behind the
      // platform rather than a claim about the value.
      return [source.track as unknown as Transferable];
    default:
      return assertNever(source, "transcode source spec");
  }
}

function newJobId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `job-${Date.now()}-${Math.random()}`;
}

export function createTranscoder(
  options: CreateTranscoderOptions = {},
): Transcoder {
  const createWorker = options.createWorker ?? defaultWorker;
  let worker: Worker | undefined;
  let activeJobId: string | undefined;

  const ensureWorker = (): Worker => (worker ??= createWorker());

  return {
    start(startOptions, handlers = {}) {
      const jobId = startOptions.jobId ?? newJobId();
      const target = ensureWorker();
      activeJobId = jobId;

      return new Promise<TranscodeSummary>((resolve, reject) => {
        const settle = (finish: () => void): void => {
          target.removeEventListener("message", onMessage);
          target.removeEventListener("error", onWorkerError);
          if (activeJobId === jobId) activeJobId = undefined;
          finish();
        };

        const onWorkerError = (event: ErrorEvent): void => {
          settle(() =>
            reject(
              new TranscodeError(
                "unknown",
                `The transcode worker crashed: ${event.message}`,
              ),
            ),
          );
        };

        const onMessage = (message: MessageEvent): void => {
          const event = parseTranscodeEvent(message.data);
          // Not this job's message, or not one of ours at all. Ignoring is
          // right: a shared worker or a stale run must not settle this promise.
          if (!event || (event.jobId !== jobId && event.jobId !== "")) return;
          dispatch(event, handlers, settle, resolve, reject);
        };

        target.addEventListener("message", onMessage);
        target.addEventListener("error", onWorkerError);

        const request: TranscodeStartRequest = {
          kind: "start",
          jobId,
          source: startOptions.source,
          ...(startOptions.segmentDurationUs === undefined
            ? {}
            : { segmentDurationUs: startOptions.segmentDurationUs }),
          ...(startOptions.preference === undefined
            ? {}
            : { preference: startOptions.preference }),
        };
        target.postMessage(request, sourceTransferables(startOptions.source));
      });
    },

    cancel() {
      if (!worker || !activeJobId) return;
      const request: TranscodeCancelRequestShape = { kind: "cancel", jobId: activeJobId };
      worker.postMessage(request);
    },

    dispose() {
      worker?.terminate();
      worker = undefined;
      activeJobId = undefined;
    },
  };
}

type TranscodeCancelRequestShape = Extract<TranscodeRequest, { kind: "cancel" }>;

/**
 * The single place a worker event becomes a client-side effect.
 *
 * `assertNever` in the default is what makes a new event kind a compile error
 * here as well as in the worker. Without it, adding a kind would leave the
 * client silently dropping it — and in a protocol whose job is progress
 * reporting, a dropped message reads to the user as a hung upload.
 */
function dispatch(
  event: TranscodeEvent,
  handlers: TranscodeHandlers,
  settle: (finish: () => void) => void,
  resolve: (summary: TranscodeSummary) => void,
  reject: (error: unknown) => void,
): void {
  switch (event.kind) {
    case "ready":
      handlers.onReady?.(event);
      return;
    case "track":
      handlers.onTrack?.(event);
      return;
    case "segment":
      handlers.onSegment?.(event);
      return;
    case "progress":
      handlers.onProgress?.(event);
      return;
    case "failed":
      settle(() => reject(failureToError(event)));
      return;
    case "done":
      settle(() => resolve(event.summary));
      return;
    default:
      assertNever(event, "transcode client event");
  }
}

function failureToError(event: TranscodeFailedEvent): TranscodeError {
  const error = new TranscodeError(event.reason, event.message);
  // Belt and braces: the worker precomputes the routing bit, but a client on a
  // newer bundle than the worker would see it missing.
  if (event.fallbackToProgressive !== shouldFallBackToProgressive(event.reason)) {
    return new TranscodeError(
      event.reason,
      `${event.message} (worker and client disagree about the progressive ` +
        "fallback for this reason; treat the client's rule as authoritative)",
    );
  }
  return error;
}
