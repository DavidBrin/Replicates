"use client";

/**
 * The upload, as a state machine the UI only renders.
 *
 * **`"use client"` is load-bearing here even though nothing in this file is a
 * component.** It reaches `@/media/encode`, whose `defaultWorker` contains the
 * `new Worker(new URL("./worker.ts", import.meta.url))` form that bundlers
 * detect statically and turn into a worker chunk. Without the directive, a
 * Server Component importing anything from `./index.ts` would drag that
 * construction into the server bundle. With it, the module body never runs on
 * the server at all.
 *
 * Everything the brief calls "the core bet" happens in this file: a file is
 * picked, the row is created, the browser probes what it can encode, the ladder
 * is encoded locally, and each segment is uploaded the moment it exists. The
 * React components below are a view of the state this produces and hold no
 * pipeline logic of their own — which is what makes the pipeline testable
 * without a DOM and without a codec.
 *
 * ## Why a machine and not a hook
 *
 * The run outlives any single render and has to survive step navigation: the
 * user moves Details → Video elements → Checks → Visibility while the encode
 * runs underneath them. A hook whose effect owns the transcoder would tear it
 * down on any re-mount, and a four-step stepper re-mounts constantly. So the
 * run is a plain object with a subscription, and React reads it through
 * `useSyncExternalStore`.
 *
 * ## Every side effect is a port
 *
 * Not for purity — for honesty in the tests. `vitest.setup.ts` says the capable
 * WebCodecs branch is opt-in and that "a suite that needs the capable branch
 * installs its own fake rather than inheriting a global one whose fidelity
 * nobody has checked". A faked `VideoEncoder` good enough to produce real
 * bitstreams would be testing the fake. So the ports here are drawn at exactly
 * the seam where fakery stops being a lie: the **transcoder** is injected (its
 * event protocol is the contract, and `src/media/encode/__tests__/protocol.test.ts`
 * already proves the real one speaks it), the **network** is injected, and the
 * **source probe** is injected. Everything between them — the muxer, the
 * packager, the segment ordering, the key layout, the bandwidth arithmetic — is
 * the real code, running for real, in the test.
 *
 * What that leaves for Playwright is named at the bottom of this file.
 *
 * ## The order of operations is a security property, not a preference
 *
 * `src/app/api/upload/target/route.ts` refuses to issue a write grant for a key
 * whose video row does not exist, deliberately: without that, any signed-in
 * account could squat the key a real upload was about to use. So the row is
 * created *first*, always, and a run that cannot create a row never asks for a
 * target.
 */

import type { Pipeline, Rendition, Visibility } from "@/domain/types";
import { openMp4, byteSourceFromBlob } from "@/media/demux";
import type {
  CodecFamily,
  EncodedChunkRecord,
  SourceProfile,
  ThroughputRegime,
  TranscodeProgress,
  TranscodeSegment,
  TranscodeSourceSpec,
  Transcoder,
} from "@/media/encode";
import {
  TranscodeError,
  createTranscoder,
  isCodecNegotiationError,
  negotiateLadder,
  selectLadder,
  shouldFallBackToProgressive,
} from "@/media/encode";
import { TrackMuxer } from "@/media/muxer";
import { buildLadderMaster, buildMediaPlaylist } from "@/media/packager";
import type { LadderRung, TrackConfig } from "@/media/types";
import { blobKeys } from "@/ports/blob-store";

/* ============================================================== the ports == */

/** What `/api/upload/target` answers. Both modes are `PUT url` with `headers`. */
export interface UploadTarget {
  readonly mode: "direct" | "proxy";
  readonly key: string;
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Readonly<Record<string, string>>;
}

export interface ClaimView {
  readonly id: string;
  readonly policy: "block" | "monetise" | "track";
  readonly status: "active" | "disputed" | "released";
  readonly matchStartMs: number;
  readonly matchEndMs: number;
  readonly referenceOffsetMs: number;
  readonly score: number;
  readonly referenceTitle: string;
  readonly rightsHolder: string;
}

/** The landmark set the Content ID scan runs against, as JSON can carry it. */
export interface FingerprintPayload {
  readonly hashes: readonly number[];
  readonly offsetsMs: readonly number[];
  readonly durationMs: number;
}

export interface CreateVideoInput {
  readonly channelId: string;
  readonly title: string;
  readonly pipeline: Pipeline;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export interface MediaFinaliseInput {
  readonly kind: "media";
  readonly pipeline: Pipeline;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly masterPlaylistKey?: string;
  readonly progressiveKey?: string;
  readonly renditions?: readonly Rendition[];
  readonly fingerprint?: FingerprintPayload;
}

export interface PublishInput {
  readonly kind: "publish";
  readonly title: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly category: string;
  readonly tags: readonly string[];
}

export interface FinaliseResult {
  readonly uploadStatus: string;
  readonly claims: readonly ClaimView[];
  /**
   * Whether the Content ID scan actually ran. `false` is reported to the user
   * as "the check did not run", never as "nothing matched" — those are
   * different facts and only one of them is reassuring.
   */
  readonly scanned: boolean;
}

/**
 * A source the transcoder can read, plus everything the UI needs to describe it
 * before a single frame is encoded.
 *
 * `open()` is separate from probing because the spec it returns carries
 * transferables — a `ReadableStream` or a `MediaStreamTrack` — and those are
 * detached by the `postMessage` that starts the run. Probing has to be
 * repeatable (the user may pick a different file); opening happens once.
 */
export interface ProbedSource {
  readonly kind: "encoded-chunks" | "media-stream" | "unreadable";
  readonly profile: SourceProfile;
  readonly throughput: ThroughputRegime;
  /** Why a ladder is impossible for this file, when `kind` is `unreadable`. */
  readonly reason?: string;
  open(): TranscodeSourceSpec;
  close(): void;
}

export interface UploadPorts {
  createVideo(input: CreateVideoInput): Promise<{ readonly id: string }>;
  requestTarget(key: string, contentType: string): Promise<UploadTarget>;
  putBytes(
    target: UploadTarget,
    body: Uint8Array | Blob,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
  ): Promise<void>;
  finalise(
    videoId: string,
    input: MediaFinaliseInput | PublishInput,
  ): Promise<FinaliseResult>;
  discard(videoId: string): Promise<void>;
  probeSource(file: File): Promise<ProbedSource>;
  createTranscoder(): Transcoder;
  /**
   * Landmarks for the Content ID scan, or `null` when this browser cannot
   * decode the audio. Optional because the decode path is Window-scoped and a
   * Worker-side one belongs to the fingerprint slice — see
   * `src/domain/fingerprint/index.ts`, whose header lists the three places
   * decoding happens and why none of them lives in the DSP module.
   */
  fingerprintFile?(file: File): Promise<FingerprintPayload | null>;
  now?(): number;
}

/* ============================================================== the state == */

export type UploadPhase =
  | "idle"
  | "creating"
  | "probing"
  | "transcoding"
  | "uploading-source"
  | "finalising"
  | "ready-to-publish"
  | "publishing"
  | "published"
  | "cancelled"
  | "failed";

export type ChecksState = "waiting" | "running" | "clear" | "claimed" | "unavailable";

export interface EncodeProgress {
  /** `undefined` means indeterminate, and the bar must render it as such. */
  readonly fraction: number | undefined;
  readonly framesDecoded: number;
  readonly presentedUs: number;
  readonly durationUs: number | undefined;
  readonly bytesEncoded: number;
  readonly encodeBacklog: number;
}

export interface UploadProgress {
  readonly objectsDone: number;
  /**
   * Objects produced so far — *not* a final total. The denominator grows while
   * the encode runs, and pretending otherwise is exactly the bar that sits at
   * 90%. The UI says "n of m so far" rather than drawing a percentage.
   */
  readonly objectsSeen: number;
  readonly bytesSent: number;
  readonly bytesSeen: number;
  readonly inFlight: number;
}

export interface UploadState {
  readonly phase: UploadPhase;
  readonly videoId: string | null;
  readonly fileName: string | null;
  readonly fileSize: number;
  readonly pipeline: Pipeline;
  /**
   * Why this run is progressive rather than laddered. `null` on the ladder
   * path. Rendered verbatim: D3 makes the fallback a different product, and the
   * user is entitled to know they are getting one quality instead of six.
   */
  readonly fallbackReason: string | null;
  readonly throughput: ThroughputRegime | null;
  readonly ladder: readonly LadderRung[];
  readonly droppedRungs: readonly string[];
  readonly codecFamily: CodecFamily | null;
  readonly durationSeconds: number;
  readonly encode: EncodeProgress;
  readonly upload: UploadProgress;
  readonly checks: ChecksState;
  readonly claims: readonly ClaimView[];
  /** `null` until the scan has been attempted at all. */
  readonly scanned: boolean | null;
  readonly error: string | null;
  /** Wall-clock milliseconds since the transcode began. Feeds the estimate. */
  readonly elapsedMs: number;
}

const IDLE_STATE: UploadState = {
  phase: "idle",
  videoId: null,
  fileName: null,
  fileSize: 0,
  pipeline: "laddered",
  fallbackReason: null,
  throughput: null,
  ladder: [],
  droppedRungs: [],
  codecFamily: null,
  durationSeconds: 0,
  encode: {
    fraction: undefined,
    framesDecoded: 0,
    presentedUs: 0,
    durationUs: undefined,
    bytesEncoded: 0,
    encodeBacklog: 0,
  },
  upload: {
    objectsDone: 0,
    objectsSeen: 0,
    bytesSent: 0,
    bytesSeen: 0,
    inFlight: 0,
  },
  checks: "waiting",
  claims: [],
  scanned: null,
  error: null,
  elapsedMs: 0,
};

/** The initial state, exported so a component can render before a run exists. */
export const IDLE_UPLOAD_STATE = IDLE_STATE;

/* ========================================================= the estimate == */

/**
 * How long the encode has left, in seconds, or `undefined`.
 *
 * Two regimes, and they are not the same sum (research/01 §9.1, and the header
 * of `src/media/encode/decode-source.ts`):
 *
 *  - **realtime** — frames arrive from a `MediaStreamTrack` at playback rate,
 *    so the remaining time *is* the remaining media. No measurement needed and
 *    none possible: pulling harder does not make it arrive faster.
 *  - **faster-than-realtime** — the decoder runs ahead and the encoders set the
 *    pace, so the only honest estimate is the observed rate extrapolated. It is
 *    withheld until a real fraction of the file has gone through, because the
 *    first second of a transcode is codec warm-up and extrapolating from it
 *    produces the wildly wrong number people remember.
 */
export const ESTIMATE_MIN_FRACTION = 0.05;

export function estimateRemainingSeconds(state: UploadState): number | undefined {
  const { fraction, presentedUs, durationUs } = state.encode;

  if (state.throughput === "realtime") {
    if (durationUs === undefined) return undefined;
    return Math.max(0, (durationUs - presentedUs) / 1e6);
  }

  if (fraction === undefined || fraction < ESTIMATE_MIN_FRACTION) return undefined;
  if (state.elapsedMs <= 0) return undefined;
  const total = state.elapsedMs / fraction;
  return Math.max(0, (total - state.elapsedMs) / 1000);
}

/* =========================================================== the uploader == */

/**
 * How many objects may be in flight at once.
 *
 * Six rungs emitting a segment every two seconds is three objects a second at
 * the top of the run, and they must not queue behind each other or the upload
 * stops overlapping the encode — which is the entire reason segments are two
 * seconds long (`src/media/encode/ladder.ts`). Four is **assumed**: it is above
 * the production rate and below the point where a domestic uplink starts
 * splitting its bandwidth into slices too thin to finish a segment. The honest
 * experiment needs a real network.
 */
export const UPLOAD_CONCURRENCY = 4;

interface UploadTask {
  readonly key: string;
  readonly contentType: string;
  readonly body: Uint8Array;
}

/**
 * A bounded queue that keeps its own error.
 *
 * The first failure stops new work and is re-thrown by `drain()`. It is not
 * thrown from `enqueue`, because `enqueue` is called from inside the
 * transcoder's `onSegment` callback — a throw there would surface as a worker
 * message-handler exception rather than as an upload failure, and the run's
 * promise would hang.
 */
class UploadQueue {
  readonly #ports: UploadPorts;
  readonly #onChange: () => void;
  readonly #limit: number;
  readonly #pending: UploadTask[] = [];
  #active = 0;
  #failure: unknown;
  #wake: (() => void) | undefined;

  objectsDone = 0;
  objectsSeen = 0;
  bytesSent = 0;
  bytesSeen = 0;

  constructor(ports: UploadPorts, onChange: () => void, limit = UPLOAD_CONCURRENCY) {
    this.#ports = ports;
    this.#onChange = onChange;
    this.#limit = limit;
  }

  get inFlight(): number {
    return this.#active;
  }

  enqueue(task: UploadTask): void {
    if (this.#failure !== undefined) return;
    this.objectsSeen += 1;
    this.bytesSeen += task.body.byteLength;
    this.#pending.push(task);
    this.#onChange();
    this.#pump();
  }

  /** Resolves when everything enqueued so far has been stored. */
  async drain(): Promise<void> {
    while (this.#failure === undefined && (this.#pending.length > 0 || this.#active > 0)) {
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    if (this.#failure !== undefined) throw this.#failure;
  }

  #pump(): void {
    while (
      this.#failure === undefined &&
      this.#active < this.#limit &&
      this.#pending.length > 0
    ) {
      const task = this.#pending.shift()!;
      this.#active += 1;
      void this.#run(task);
    }
  }

  async #run(task: UploadTask): Promise<void> {
    try {
      const target = await this.#ports.requestTarget(task.key, task.contentType);
      await this.#ports.putBytes(target, task.body);
      this.objectsDone += 1;
      this.bytesSent += task.body.byteLength;
    } catch (error) {
      this.#failure ??= error;
    } finally {
      this.#active -= 1;
      this.#onChange();
      this.#wake?.();
      this.#wake = undefined;
      this.#pump();
    }
  }
}

/* ========================================================= rung packaging == */

/**
 * One rung's muxer, its playlist rows and its measured bitrate.
 *
 * `TrackMuxer` owns the running decode clock and must see this rung's segments
 * in order — its header explains that `baseMediaDecodeTime = index × nominal`
 * is correct until the first segment that is not nominal, after which audio
 * walks away from video. The worker emits each rung's segments in order, so the
 * arrival order is the right order; the assertion below is what turns a
 * protocol change into a failure instead of a file that plays and cannot be
 * scrubbed.
 */
class RungPackager {
  readonly name: string;
  readonly rung: LadderRung;
  readonly #muxer: TrackMuxer;
  readonly track: TrackConfig;

  readonly playlist: { uri: string; durationSeconds: number }[] = [];
  segmentBytes = 0;
  peakBitsPerSecond = 0;
  durationSeconds = 0;
  #expectedIndex = 0;

  constructor(rung: LadderRung, track: TrackConfig) {
    this.name = rung.name;
    this.rung = rung;
    this.track = track;
    this.#muxer = new TrackMuxer({ config: track, trackId: 1 });
  }

  package(segment: TranscodeSegment): { index: number; body: Uint8Array } {
    if (segment.index < this.#expectedIndex) {
      throw new Error(
        `The ${this.name} rung produced segment ${segment.index} after ` +
          `${this.#expectedIndex - 1}. The muxer's decode clock only runs ` +
          `forwards, so an out-of-order segment would silently misplace every ` +
          `later one on the timeline.`,
      );
    }
    this.#expectedIndex = segment.index + 1;

    const packaged = this.#muxer.packageSegment(segment.samples);
    this.segmentBytes += packaged.data.byteLength;
    this.durationSeconds += packaged.durationSeconds;
    if (packaged.durationSeconds > 0) {
      this.peakBitsPerSecond = Math.max(
        this.peakBitsPerSecond,
        (packaged.data.byteLength * 8) / packaged.durationSeconds,
      );
    }
    // Relative to the playlist, which sits in the same prefix. An absolute key
    // would bake the store's layout into the manifest and break the moment R2
    // fronts it on a different path.
    this.playlist.push({
      uri: `seg-${String(packaged.index).padStart(5, "0")}.m4s`,
      durationSeconds: packaged.durationSeconds,
    });
    return { index: packaged.index, body: packaged.data };
  }

  /**
   * `ftyp` + `moov`, built **after** every segment.
   *
   * Built first it declares a duration of zero, which is legal and is what a
   * live stream writes; built last it declares what the clock accumulated. A
   * VOD playlist whose init segment says zero plays and cannot be scrubbed.
   */
  initSegment(): Uint8Array {
    return this.#muxer.initSegment();
  }

  get averageBitsPerSecond(): number {
    return this.durationSeconds > 0
      ? (this.segmentBytes * 8) / this.durationSeconds
      : 0;
  }
}

/* ================================================================= the run == */

export type UploadListener = (state: UploadState) => void;

export interface UploadRun {
  getState(): UploadState;
  subscribe(listener: UploadListener): () => void;
  /** Runs create → probe → encode → upload → media-finalise. Never rejects. */
  start(file: File, input: { channelId: string; title: string }): Promise<void>;
  /** The second write: details, visibility, and `upload_status = 'ready'`. */
  publish(input: Omit<PublishInput, "kind">): Promise<boolean>;
  /** Abort the encode and delete the row. Leaves nothing half-owned. */
  cancel(): Promise<void>;
  dispose(): void;
}

export function createUploadRun(ports: UploadPorts): UploadRun {
  const now = ports.now ?? (() => Date.now());
  let state = IDLE_STATE;
  const listeners = new Set<UploadListener>();
  let transcoder: Transcoder | undefined;
  let source: ProbedSource | undefined;
  let cancelled = false;
  let startedAt = 0;

  const emit = (): void => {
    for (const listener of [...listeners]) listener(state);
  };
  const patch = (next: Partial<UploadState>): void => {
    state = { ...state, ...next };
    emit();
  };

  const syncUpload = (queue: UploadQueue): void => {
    patch({
      upload: {
        objectsDone: queue.objectsDone,
        objectsSeen: queue.objectsSeen,
        bytesSent: queue.bytesSent,
        bytesSeen: queue.bytesSeen,
        inFlight: queue.inFlight,
      },
      ...(startedAt > 0 ? { elapsedMs: now() - startedAt } : {}),
    });
  };

  async function start(
    file: File,
    input: { channelId: string; title: string },
  ): Promise<void> {
    cancelled = false;
    state = {
      ...IDLE_STATE,
      phase: "creating",
      fileName: file.name,
      fileSize: file.size,
    };
    emit();

    let videoId: string | null = null;
    try {
      /* -- 1. probe, so the row can be created with the right pipeline ----- */
      patch({ phase: "probing" });
      const probed = await ports.probeSource(file);
      source = probed;

      const plan = await planLadder(probed);
      const durationSeconds =
        probed.profile.durationUs === undefined ? 0 : probed.profile.durationUs / 1e6;

      patch({
        pipeline: plan.pipeline,
        fallbackReason: plan.reason,
        throughput: probed.throughput,
        ladder: plan.rungs,
        droppedRungs: plan.dropped,
        codecFamily: plan.family,
        durationSeconds,
        encode: {
          ...state.encode,
          ...(probed.profile.durationUs === undefined
            ? {}
            : { durationUs: probed.profile.durationUs }),
        },
      });

      /* -- 2. the row, before any byte and before any target -------------- */
      patch({ phase: "creating" });
      const created = await ports.createVideo({
        channelId: input.channelId,
        title: input.title,
        pipeline: plan.pipeline,
        durationSeconds,
        width: probed.profile.width,
        height: probed.profile.height,
      });
      videoId = created.id;
      patch({ videoId });
      if (cancelled) return void (await discard(videoId));

      /* -- 3. the bytes --------------------------------------------------- */
      startedAt = now();
      const media = await encodeAndUpload(videoId, file, probed, plan, durationSeconds);
      if (cancelled) return void (await discard(videoId));

      /* -- 4. the media write, plus the Content ID scan ------------------- */
      patch({ phase: "finalising", checks: "running" });
      const print = await fingerprint(file);
      const result = await ports.finalise(videoId, {
        ...media,
        ...(print === null ? {} : { fingerprint: print }),
      });

      patch({
        phase: "ready-to-publish",
        claims: result.claims,
        scanned: result.scanned,
        checks: !result.scanned
          ? "unavailable"
          : result.claims.length > 0
            ? "claimed"
            : "clear",
      });
    } catch (error) {
      if (cancelled) {
        patch({ phase: "cancelled" });
        return;
      }
      // The row stays `uploading`. That is the resumability decision made
      // visible: Studio lists it as an incomplete upload with a delete
      // affordance rather than deleting the user's work on their behalf,
      // because a failure here is often a lost network rather than a lost file.
      patch({ phase: "failed", error: describe(error) });
    }
  }

  /** Negotiate on the main thread so the UI can promise a ladder before one exists. */
  async function planLadder(probed: ProbedSource): Promise<{
    pipeline: Pipeline;
    reason: string | null;
    rungs: readonly LadderRung[];
    dropped: readonly string[];
    family: CodecFamily | null;
  }> {
    if (probed.kind === "unreadable") {
      return {
        pipeline: "progressive",
        reason:
          probed.reason ??
          "This file cannot be read frame by frame in the browser, so it will " +
            "be uploaded as it is.",
        rungs: [],
        dropped: [],
        family: null,
      };
    }

    try {
      const negotiated = await negotiateLadder({
        shapes: selectLadder(probed.profile),
        frameRate: probed.profile.frameRate,
      });
      return {
        pipeline: "laddered",
        reason: null,
        rungs: negotiated.rungs,
        dropped: negotiated.dropped,
        family: negotiated.family,
      };
    } catch (error) {
      if (!isCodecNegotiationError(error)) throw error;
      return {
        pipeline: "progressive",
        reason:
          error.reason === "no-webcodecs"
            ? "This browser has no WebCodecs video encoder, so the ladder " +
              "cannot be built here."
            : "No encoder in this browser supports any rung of the ladder.",
        rungs: [],
        dropped: [],
        family: null,
      };
    }
  }

  /**
   * The ladder path, with the one fallback that can only be discovered late.
   *
   * The main-thread negotiation above already routes a browser with no encoder
   * to the progressive path, so reaching this catch means the *worker* reported
   * something the main thread could not see — a different execution context, a
   * codec that probed `true` and then failed to configure (research/01 §4.3
   * measured exactly that), a `configure()` that closed the codec silently.
   * `shouldFallBackToProgressive` is the routing rule and it lives with the
   * reasons rather than here, so an encoder error or a reordered output is
   * *not* swallowed: those are bugs or broken files, and a silent degrade would
   * hide them.
   *
   * Segments already stored are left where they are. Nothing references them —
   * the finalise below writes no master playlist — so they are orphaned objects
   * of the kind research/05 §3.2 describes, and deleting them would mean a
   * second failure path running while the first is still being reported.
   */
  async function encodeAndUpload(
    videoId: string,
    file: File,
    probed: ProbedSource,
    plan: { pipeline: Pipeline },
    durationSeconds: number,
  ): Promise<MediaFinaliseInput> {
    if (plan.pipeline === "progressive") return runProgressive(videoId, file);
    try {
      return await runLadder(videoId, probed, durationSeconds);
    } catch (error) {
      if (cancelled) throw error;
      if (
        !(error instanceof TranscodeError) ||
        !shouldFallBackToProgressive(error.reason)
      ) {
        throw error;
      }
      patch({
        pipeline: "progressive",
        fallbackReason:
          "The encode could not start in this browser " +
          `(${error.message}), so the file is being uploaded as it is.`,
        ladder: [],
      });
      return runProgressive(videoId, file);
    }
  }

  /** The ladder path: encode locally, upload each segment as it is produced. */
  async function runLadder(
    videoId: string,
    probed: ProbedSource,
    durationSeconds: number,
  ): Promise<MediaFinaliseInput> {
    patch({ phase: "transcoding" });
    const queue = new UploadQueue(ports, () => syncUpload(queue));
    const packagers = new Map<string, RungPackager>();
    const rungByName = new Map<string, LadderRung>();

    transcoder = ports.createTranscoder();
    const summary = await transcoder.start(
      { source: probed.open() },
      {
        onReady: (event) => {
          for (const rung of event.rungs) rungByName.set(rung.name, rung);
          patch({
            ladder: event.rungs,
            droppedRungs: event.dropped,
            codecFamily: event.family,
            // The worker's answer is authoritative: it probed in the thread
            // that will actually configure the encoders, and this is the
            // message the brief singles out as the one the UI needs most.
            throughput: event.throughput,
          });
        },
        onTrack: (event) => {
          const rung = rungByName.get(event.rung);
          if (!rung) {
            throw new Error(
              `The worker announced a track for the unknown rung ${event.rung}.`,
            );
          }
          packagers.set(event.rung, new RungPackager(rung, event.track));
        },
        onSegment: (event) => {
          const packager = packagers.get(event.segment.rung);
          if (!packager) {
            // The protocol guarantees `track` precedes that rung's first
            // segment. Buffering instead would hide a protocol change until
            // the playlist came out one segment short.
            throw new Error(
              `Segment ${event.segment.index} arrived for ${event.segment.rung} ` +
                "before its track configuration.",
            );
          }
          const { index, body } = packager.package(event.segment);
          queue.enqueue({
            key: blobKeys.segment(videoId, packager.name, index),
            contentType: "video/iso.segment",
            body,
          });
        },
        onProgress: (event) => applyProgress(event.progress),
      },
    );

    // The encode is done; the uploads it queued may not be.
    await queue.drain();

    const renditions: Rendition[] = [];
    const variants: {
      rung: LadderRung;
      uri: string;
      bandwidth: number;
      averageBandwidth: number;
      frameRate: number;
    }[] = [];

    for (const packager of packagers.values()) {
      // A rung that announced a track and then produced nothing is skipped
      // rather than written: `buildMediaPlaylist` refuses an empty segment list
      // (correctly — a playlist with no `EXTINF` is a variant a player will
      // select and then stall on), and a `#EXT-X-STREAM-INF` pointing at a
      // playlist that was never stored is worse than a shorter ladder.
      if (packager.playlist.length === 0) continue;

      const initKey = blobKeys.init(videoId, packager.name);
      const playlistKey = blobKeys.mediaPlaylist(videoId, packager.name);

      queue.enqueue({
        key: initKey,
        contentType: "video/mp4",
        body: packager.initSegment(),
      });
      queue.enqueue({
        key: playlistKey,
        contentType: "application/vnd.apple.mpegurl",
        body: new TextEncoder().encode(
          buildMediaPlaylist({
            segments: packager.playlist,
            initSegmentUri: "init.mp4",
            playlistType: "VOD",
            endList: true,
          }),
        ),
      });

      renditions.push({
        name: packager.name,
        width: packager.rung.width,
        height: packager.rung.height,
        // Measured, never requested: the ABR selector compares this against
        // observed throughput, so an aspirational figure makes every switching
        // decision wrong. `schema.sql` and RFC 8216 agree on the definition.
        bandwidth: Math.round(packager.peakBitsPerSecond),
        codec: packager.track.codec,
        frameRate: probed.profile.frameRate,
        initKey,
        playlistKey,
        segmentCount: packager.playlist.length,
        totalBytes: packager.segmentBytes,
      });
      variants.push({
        rung: packager.rung,
        uri: `${packager.name}/index.m3u8`,
        bandwidth: Math.round(packager.peakBitsPerSecond),
        averageBandwidth: Math.round(packager.averageBitsPerSecond),
        frameRate: probed.profile.frameRate,
      });
    }

    if (variants.length === 0) {
      throw new Error(
        "The transcode produced no renditions, so there is no ladder to publish.",
      );
    }

    const masterKey = blobKeys.masterPlaylist(videoId);
    queue.enqueue({
      key: masterKey,
      contentType: "application/vnd.apple.mpegurl",
      body: new TextEncoder().encode(buildLadderMaster({ variants })),
    });
    await queue.drain();

    return {
      kind: "media",
      pipeline: "laddered",
      // The presentation timeline the encode actually covered, not the one the
      // container declared. They differ whenever an edit list trims the head or
      // the file's `mvhd` lies, and the player scrubs against the real one.
      durationSeconds: Math.max(durationSeconds, summary.presentedUs / 1e6),
      width: probed.profile.width,
      height: probed.profile.height,
      masterPlaylistKey: masterKey,
      renditions,
    };
  }

  /**
   * The fallback path: one file, stored whole, served over `Range`.
   *
   * D3 is emphatic that this is a different application rather than a degraded
   * one, and the shape of this function is the evidence — no muxer, no
   * packager, no ladder, no playlist, one object. What the user gets is one
   * quality, and `fallbackReason` in the state is what says so out loud.
   */
  async function runProgressive(videoId: string, file: File): Promise<MediaFinaliseInput> {
    patch({ phase: "uploading-source" });
    const key = blobKeys.progressive(videoId, extensionOf(file));
    const target = await ports.requestTarget(key, file.type || "video/mp4");

    patch({
      upload: { ...state.upload, objectsSeen: 1, bytesSeen: file.size },
    });
    await ports.putBytes(target, file, (sent, total) => {
      patch({
        upload: {
          ...state.upload,
          bytesSent: sent,
          // `lengthComputable` is false for a chunked request, and the port
          // reports 0 for the total in that case. Keeping the file's own size
          // rather than adopting the 0 is the difference between a bar and a
          // bar whose denominator vanished mid-upload.
          bytesSeen: total > 0 ? total : state.upload.bytesSeen,
          inFlight: 1,
        },
        elapsedMs: startedAt > 0 ? now() - startedAt : 0,
      });
    });
    patch({
      upload: {
        ...state.upload,
        objectsDone: 1,
        bytesSent: file.size,
        bytesSeen: file.size,
        inFlight: 0,
      },
    });

    return {
      kind: "media",
      pipeline: "progressive",
      durationSeconds: state.durationSeconds,
      // The source's own dimensions, never a rung's. `videos.width/height`
      // decide `is_short` at publish time (`isShortVideo`), and a progressive
      // video is served at exactly the size it arrived.
      width: source?.profile.width ?? 0,
      height: source?.profile.height ?? 0,
      progressiveKey: key,
    };
  }

  function applyProgress(progress: TranscodeProgress): void {
    patch({
      encode: {
        fraction: progress.fraction,
        framesDecoded: progress.framesDecoded,
        presentedUs: progress.presentedUs,
        durationUs: progress.durationUs,
        bytesEncoded: progress.bytesEncoded,
        encodeBacklog: progress.encodeBacklog,
      },
      elapsedMs: startedAt > 0 ? now() - startedAt : 0,
    });
  }

  async function fingerprint(file: File): Promise<FingerprintPayload | null> {
    if (!ports.fingerprintFile) return null;
    try {
      return await ports.fingerprintFile(file);
    } catch {
      // A failed scan must never fail an upload. The Checks step reports
      // `unavailable` and the video publishes; D12 is explicit that a match
      // creates a claim rather than a takedown, so the reverse holds too — a
      // missing scan is a missing claim, not a blocked publish.
      return null;
    }
  }

  async function discard(videoId: string): Promise<void> {
    try {
      await ports.discard(videoId);
    } catch {
      // Best effort. The row stays `uploading` and Studio shows it as an
      // incomplete upload with its own delete affordance, which is the same
      // affordance a closed tab leaves behind.
    }
    patch({ phase: "cancelled" });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,

    async publish(input) {
      const videoId = state.videoId;
      if (!videoId || state.phase !== "ready-to-publish") return false;
      patch({ phase: "publishing" });
      try {
        const result = await ports.finalise(videoId, { kind: "publish", ...input });
        patch({ phase: "published", claims: result.claims });
        return true;
      } catch (error) {
        patch({ phase: "ready-to-publish", error: describe(error) });
        return false;
      }
    },

    async cancel() {
      cancelled = true;
      transcoder?.cancel();
      source?.close();
      if (state.videoId) await discard(state.videoId);
      else patch({ phase: "cancelled" });
    },

    dispose() {
      cancelled = true;
      transcoder?.dispose();
      source?.close();
      listeners.clear();
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  // `blobKeys.progressive` puts this straight into the key, and `/api/media`
  // guesses a content type from it. `mp4` is the honest default for a file the
  // browser accepted through a `video/*` picker with no usable name.
  return "mp4";
}

/* ====================================================== the real adapters == */

/**
 * Read the file well enough to plan a ladder.
 *
 * Three outcomes, in the order they are attempted, and the order is the whole
 * decision:
 *
 * 1. **Demuxable MP4/MOV** — `src/media/demux` reads the sample table and the
 *    source's own `avcC`, so frames go to a `VideoDecoder` as fast as it can
 *    produce them. This is the **faster-than-realtime** path and the reason the
 *    project's bet is worth making.
 * 2. **Anything else the `<video>` element can play** — WebM, a codec our
 *    demuxer skips, a file with a `moov` we refuse. `captureStream()` gives a
 *    `MediaStreamTrack`, which is transferable, and frames arrive at playback
 *    rate. This is **realtime**: a ten-minute video takes at least ten minutes,
 *    and the UI has to say so rather than let it look hung.
 * 3. **Neither** — the progressive fallback.
 *
 * `MediaStreamTrackProcessor` is Chromium-only, so option 2 is narrower than it
 * looks; `decode-source.ts` says the same thing from the other side. It is
 * attempted anyway because a realtime ladder still beats a single-quality file.
 */
export async function probeSourceInBrowser(file: File): Promise<ProbedSource> {
  try {
    return await probeDemuxable(file);
  } catch (demuxError) {
    try {
      return await probePlayable(file);
    } catch {
      return {
        kind: "unreadable",
        throughput: "realtime",
        profile: { width: 0, height: 0, frameRate: 30 },
        reason:
          "This file could not be read frame by frame in the browser " +
          `(${describe(demuxError)}), so it will be uploaded as it is.`,
        open() {
          throw new Error("An unreadable source has no frames to open.");
        },
        close() {},
      };
    }
  }
}

async function probeDemuxable(file: File): Promise<ProbedSource> {
  const mp4 = await openMp4(byteSourceFromBlob(file));
  const track = mp4.tracks.find((candidate) => candidate.kind === "video");
  if (!track) {
    throw new Error("This MP4 has no video track this demuxer can read.");
  }

  const { width = 0, height = 0, description, codec } = track.config;
  const durationUs = track.durationUs;
  const frameCount = track.sampleCount;
  // From the sample table rather than assumed: a 30000/1001 source is 29.97,
  // and `capabilities.ts` picks the 1080p AVC level off this number.
  const frameRate =
    durationUs > 0 && frameCount > 0 ? (frameCount * 1e6) / durationUs : 30;

  const profile: SourceProfile = {
    width,
    height,
    frameRate,
    ...(durationUs > 0 ? { durationUs } : {}),
    ...(frameCount > 0 ? { frameCount } : {}),
  };

  return {
    kind: "encoded-chunks",
    throughput: "faster-than-realtime",
    profile,
    open(): TranscodeSourceSpec {
      const iterator = track.samples()[Symbol.asyncIterator]();
      const chunks = new ReadableStream<EncodedChunkRecord>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
            return;
          }
          const sample = next.value;
          controller.enqueue({
            type: sample.isKeyFrame ? "key" : "delta",
            timestampUs: sample.timestampUs,
            durationUs: sample.durationUs,
            data: sample.data,
          });
        },
        async cancel() {
          await iterator.return?.();
        },
      });

      return {
        kind: "encoded-chunks",
        profile,
        decoderConfig: {
          codec,
          ...(description ? { description } : {}),
          codedWidth: width,
          codedHeight: height,
        },
        chunks,
      };
    },
    close() {},
  };
}

async function probePlayable(file: File): Promise<ProbedSource> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("There is no document to attach a <video> element to.");
  }

  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.preload = "metadata";
  element.muted = true;
  element.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      element.addEventListener("loadedmetadata", () => resolve(), { once: true });
      element.addEventListener(
        "error",
        () => reject(new Error("The browser could not decode this file.")),
        { once: true },
      );
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  const durationUs =
    Number.isFinite(element.duration) && element.duration > 0
      ? Math.round(element.duration * 1e6)
      : undefined;

  const profile: SourceProfile = {
    width: element.videoWidth,
    height: element.videoHeight,
    // **Assumed, not measured.** A `MediaStreamTrack`'s settings carry a
    // `frameRate` only once frames are flowing, and the ladder's AVC level has
    // to be chosen before that. 30 is the safe side: over-declaring the level
    // is what fails `isConfigSupported`, under-declaring is advisory.
    frameRate: 30,
    ...(durationUs === undefined ? {} : { durationUs }),
  };

  if (profile.width < 2 || profile.height < 2) {
    URL.revokeObjectURL(url);
    throw new Error("The browser reported no video dimensions for this file.");
  }

  return {
    kind: "media-stream",
    throughput: "realtime",
    profile,
    open(): TranscodeSourceSpec {
      const capture = (
        element as HTMLVideoElement & { captureStream?: () => MediaStream }
      ).captureStream;
      if (typeof capture !== "function") {
        throw new Error("This browser cannot capture a stream from a <video>.");
      }
      const stream = capture.call(element);
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("The captured stream carries no video track.");
      // Frames only arrive while the element plays; nothing else drives the
      // clock on this path.
      void element.play();
      return { kind: "media-stream", profile, track };
    },
    close() {
      element.pause();
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * `PUT` bytes at a target, reporting how many have actually left.
 *
 * `XMLHttpRequest`, not `fetch`, and that is not nostalgia: `fetch` has no
 * upload progress event at all, so a `fetch`-based uploader can only report 0%
 * and then 100%. On the progressive path that is a single ~190 MB request
 * (research/05 §1.2) and a bar that sits at zero for two minutes is precisely
 * the failure mode the brief rules out.
 *
 * The `headers` come from `/api/upload/target` and are sent verbatim. That
 * route's header explains why guessing is not allowed: a presigned PUT's
 * signature covers the content type, and a mismatch by so much as a parameter
 * answers `403 SignatureDoesNotMatch` — an error the browser's JavaScript
 * cannot even read, because R2's 403s arrive without CORS headers.
 */
export function putBytesWithProgress(
  target: UploadTarget,
  body: Uint8Array | Blob,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(target.method, target.url, true);
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value);
    }
    if (onProgress) {
      request.upload.addEventListener("progress", (event) => {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      });
    }
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          new Error(
            `Storing ${target.key} failed with ${request.status}. ` +
              (target.mode === "direct"
                ? "A presigned PUT that answers 403 is usually a content type " +
                  "that does not match the one the target was signed for."
                : request.responseText.slice(0, 200)),
          ),
        );
    });
    request.addEventListener("error", () =>
      reject(new Error(`The network dropped while storing ${target.key}.`)),
    );
    request.addEventListener("abort", () =>
      reject(new Error(`The upload of ${target.key} was aborted.`)),
    );
    request.send(body instanceof Blob ? body : bodyView(body));
  });
}

/**
 * The view, sent as a view.
 *
 * `send()` accepts an `ArrayBufferView` and transmits exactly the view's own
 * range — which matters, because a `Uint8Array` from `subarray` carries its
 * parent's buffer, and sending `.buffer` instead is how a 200-byte playlist
 * arrives as a multi-megabyte object.
 *
 * The cast is TypeScript 5.7's `Uint8Array<ArrayBufferLike>` meeting a lib.dom
 * signature that wants `ArrayBufferView<ArrayBuffer>`: the compiler cannot
 * prove the backing buffer is not a `SharedArrayBuffer`. Nothing in this
 * pipeline allocates one — every body here comes from `new Uint8Array(n)` in
 * the muxer or from `TextEncoder.encode` — and the same distinction is handled
 * the same way, with a runtime check, in `worker.ts`'s `collectSampleBuffers`.
 */
function bodyView(bytes: Uint8Array): XMLHttpRequestBodyInit {
  return bytes as unknown as XMLHttpRequestBodyInit;
}

/* ============================================================ the fetches == */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The session cookie is `SameSite=Lax` and these are same-origin, so the
    // default credentials mode already sends it. Stated rather than assumed
    // because every one of these routes answers 401 without it.
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `${url} answered ${response.status}.`);
  }
  if (payload === null) throw new Error(`${url} answered with no JSON body.`);
  return payload;
}

/**
 * Landmarks for the Content ID scan, computed in the page.
 *
 * `OfflineAudioContext` is the mechanism `research/06` §5 names for the main
 * thread, and the sample rate is not incidental: `src/domain/fingerprint`
 * requires **mono at 11025 Hz** and its header is explicit that resampling is
 * deliberately not the DSP module's job. Constructing the context at 11025
 * makes `decodeAudioData` resample for us; the downmix is the loop below,
 * because `decodeAudioData` preserves the channel count.
 *
 * `QUERY_SHIFTS` alignments, because this is a *query*: the module's header
 * measures a factor of seven in matching tokens purely from where the cut fell,
 * and a single-pass query throws that away.
 *
 * A browser that refuses the file — a codec `decodeAudioData` cannot open, a
 * video with no audio track — returns `null`, and the Checks step says the scan
 * did not run rather than that nothing matched. Those are different facts.
 */
export async function fingerprintFileInBrowser(
  file: File,
): Promise<FingerprintPayload | null> {
  const OfflineContext = (
    globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }
  ).OfflineAudioContext;
  if (!OfflineContext) return null;

  const { QUERY_SHIFTS, SAMPLE_RATE, fingerprint } = await import(
    "@/domain/fingerprint"
  );
  const context = new OfflineContext(1, 1, SAMPLE_RATE);
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  }
  if (buffer.numberOfChannels === 0 || buffer.length === 0) return null;

  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) {
      mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels;
    }
  }

  const print = fingerprint(mono, { shifts: QUERY_SHIFTS });
  return {
    // `Int32Array` does not survive `JSON.stringify` as an array, and the route
    // validates a list of integers. Converting here keeps the wire shape in one
    // place instead of at both ends.
    hashes: Array.from(print.hashes),
    offsetsMs: Array.from(print.offsetsMs),
    durationMs: print.durationMs,
  };
}

/** The real wiring: the routes, the browser's probe, and the real Worker. */
export function browserUploadPorts(
  overrides: Partial<UploadPorts> = {},
): UploadPorts {
  return {
    createVideo: (input) => postJson("/api/videos", input),
    requestTarget: (key, contentType) =>
      postJson<UploadTarget>("/api/upload/target", { key, contentType }),
    putBytes: putBytesWithProgress,
    finalise: (videoId, input) =>
      postJson<FinaliseResult>(
        `/api/videos/${encodeURIComponent(videoId)}/publish`,
        input,
      ),
    discard: async (videoId) => {
      const response = await fetch(
        `/api/videos?id=${encodeURIComponent(videoId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Discarding ${videoId} answered ${response.status}.`);
      }
    },
    probeSource: probeSourceInBrowser,
    createTranscoder: () => createTranscoder(),
    fingerprintFile: fingerprintFileInBrowser,
    ...overrides,
  };
}

/* ============================================================ what is not == */

/**
 * **What needs a real browser.**
 *
 * Everything above is exercised in Vitest with the real muxer, the real
 * packager, the real key layout and the real ordering rules. These four are
 * not, and cannot honestly be:
 *
 *  - **The encode itself.** `VideoEncoder`, `VideoDecoder` and `OffscreenCanvas`
 *    do not exist in jsdom, and a fake complete enough to emit real bitstreams
 *    would be the thing under test. Playwright, against the seed corpus.
 *  - **`probeSourceInBrowser`.** The demux path needs a real MP4 and the
 *    `<video>` path needs a decoder; jsdom's `HTMLMediaElement` is a stub whose
 *    `duration` is `NaN` (`vitest.setup.ts`).
 *  - **`putBytesWithProgress`.** jsdom's `XMLHttpRequest` has no upload
 *    progress events, so the one behaviour this function exists for is
 *    unobservable there.
 *  - **The `beforeunload` guard** in `upload-dialog.tsx`: jsdom fires the event
 *    but a browser's "leave site?" prompt is the behaviour, and only a browser
 *    has one.
 */
export const PLAYWRIGHT_ONLY = [
  "the WebCodecs encode",
  "source probing",
  "upload progress events",
  "the beforeunload guard",
] as const;
