/**
 * The playback engine: capability detection, the MSE lifecycle, the fetch loop,
 * seeking, rendition switching and the metrics the UI reads.
 *
 * This is the orchestrator. The decisions live elsewhere on purpose — which rung
 * to fetch is `abr.ts`, what a playlist says is `playlist.ts`, what a
 * `SourceBuffer` will accept is `buffer-controller.ts` — and what is left here is
 * sequencing: what happens in what order, and what to do when the order is
 * interrupted by a seek, a stall or a quality pick.
 *
 * **Two findings from `research/03-mse-player-abr.md` shape the code more than
 * anything else in it.**
 *
 * §2: on Safari, `ManagedMediaSource` **will not fire `sourceopen` at all**
 * unless AirPlay is gated off with `video.disableRemotePlayback = true` (or an
 * AirPlay-eligible `<source>` sibling is present). This is essentially
 * undocumented, and it presents as a player that attaches, reports no error and
 * never begins buffering. `attachMediaSource` sets the flag before attaching on
 * every path, and arms a watchdog so that if `sourceopen` still does not arrive
 * the failure is an error naming this cause rather than a hang. `DECISIONS.md`
 * D10 records it.
 *
 * §5: seeking into an unbuffered region stalls forever when the fetch trigger is
 * written relative to the *end of the buffer*, because after such a seek there is
 * no buffered range for that logic to measure from — and the element sits at
 * `HAVE_METADATA` with no error and often no `waiting` event. The fix here is
 * structural rather than a special case: `nextSegmentIndex` is derived from the
 * range **containing the playhead**, and falls back to the buffer's end only when
 * the playhead is actually inside buffered data. A seek into a hole is then
 * indistinguishable from a cold start, which is what it is.
 *
 * The engine is typed against `MediaElementLike` and `MediaSourceLike` rather
 * than the DOM types, for the reason `DECISIONS.md` D4 gives for the muxer: a
 * `MediaSource` cannot be constructed in Node, so an engine typed against it
 * could only ever be tested in a browser. Real DOM objects satisfy both
 * structurally; `__tests__/engine.test.ts` asserts that at compile time.
 */

import {
  ABR_DEFAULTS,
  ThroughputEstimator,
  selectRendition,
  shouldAbandon,
  type AbrConfig,
  type AbrDecision,
  type AbrRendition,
} from "./abr";
import {
  BUFFER_TARGETS,
  BufferController,
  BufferQuotaError,
  rangeContaining,
  type BufferedRange,
  type BufferTargets,
  type SourceBufferLike,
} from "./buffer-controller";
import {
  defaultRenditionFor,
  parseMasterPlaylist,
  parseMediaPlaylist,
  segmentIndexAt,
  type MediaPlaylist,
  type PlaylistVariant,
} from "./playlist";

/* ------------------------------------------------------- platform shapes -- */

/** The `HTMLVideoElement` surface the engine touches. A real one satisfies it. */
export interface MediaElementLike {
  currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly duration: number;
  src: string;
  preload: string;
  /** The Remote Playback API opt-out. Load-bearing on Safari — see the file comment. */
  disableRemotePlayback: boolean;
  srcObject: unknown;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
  play(): Promise<void>;
  canPlayType(type: string): string;
  getVideoPlaybackQuality?(): {
    readonly droppedVideoFrames: number;
    readonly totalVideoFrames: number;
  };
  requestVideoFrameCallback?(callback: () => void): number;
}

/** The `MediaSource`/`ManagedMediaSource` surface the engine touches. */
export interface MediaSourceLike {
  readonly readyState: string;
  duration: number;
  addSourceBuffer(type: string): SourceBufferLike;
  endOfStream(error?: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  /** `ManagedMediaSource` only: the browser's own "I want more data" signal. */
  readonly streaming?: boolean;
}

export interface MediaSourceConstructorLike {
  new (): MediaSourceLike;
  isTypeSupported(type: string): boolean;
}

/* ------------------------------------------------------------- detection -- */

export type PlaybackMode =
  | "managed-media-source"
  | "media-source"
  | "native-hls"
  | "progressive";

export interface CapabilityProbe {
  readonly managedMediaSource: MediaSourceConstructorLike | undefined;
  readonly mediaSource: MediaSourceConstructorLike | undefined;
  /** `canPlayType('application/vnd.apple.mpegurl')` was truthy. */
  readonly canPlayNativeHls: boolean;
  /** The MIME strings the asset actually needs, e.g. `video/mp4; codecs="avc1.640028"`. */
  readonly requiredTypes: readonly string[];
}

/**
 * research §9's selection order, exactly: Managed Media Source, then native HLS,
 * then plain `MediaSource`, then progressive.
 *
 * Native HLS sits **above** plain `MediaSource` because of who it catches: iOS
 * Safari before 17.1, where there is no reliable MSE and no Managed Media Source
 * at all, so a real `.m3u8` played by Safari's own engine is the only adaptive
 * path that exists (research §2). On a desktop browser that supports both, the
 * Managed branch has already matched and we never reach this.
 *
 * The `isTypeSupported` gate on the last MSE branch is not ceremony. research §1
 * records that Safari has no VP9 or Opus decoder at all and gates AV1 hardware
 * decode to specific silicon with no software fallback — so a VP9 ladder is a
 * `MediaSource` that exists and cannot play our bytes, and falling through to
 * progressive is the right answer rather than attaching and failing.
 */
export function detectPlaybackMode(probe: CapabilityProbe): PlaybackMode {
  if (probe.managedMediaSource !== undefined) {
    if (supportsAll(probe.managedMediaSource, probe.requiredTypes)) {
      return "managed-media-source";
    }
  }
  if (probe.canPlayNativeHls) return "native-hls";
  if (probe.mediaSource !== undefined && supportsAll(probe.mediaSource, probe.requiredTypes)) {
    return "media-source";
  }
  return "progressive";
}

function supportsAll(
  constructor: MediaSourceConstructorLike,
  types: readonly string[],
): boolean {
  if (types.length === 0) return true;
  try {
    return types.every((type) => constructor.isTypeSupported(type));
  } catch {
    // A constructor that exists but whose static throws is not a platform we
    // should be attaching to.
    return false;
  }
}

/** Read the globals. Separated from `detectPlaybackMode` so the decision stays pure. */
export function probeCapabilities(
  media: MediaElementLike | undefined,
  requiredTypes: readonly string[],
): CapabilityProbe {
  const global = globalThis as Record<string, unknown>;
  const managed = global.ManagedMediaSource as MediaSourceConstructorLike | undefined;
  const plain = global.MediaSource as MediaSourceConstructorLike | undefined;
  return {
    managedMediaSource: typeof managed === "function" ? managed : undefined,
    mediaSource: typeof plain === "function" ? plain : undefined,
    canPlayNativeHls:
      media?.canPlayType("application/vnd.apple.mpegurl") !== undefined &&
      media.canPlayType("application/vnd.apple.mpegurl") !== "",
    requiredTypes,
  };
}

/* ----------------------------------------------------------------- mimes -- */

const VIDEO_CODEC_PREFIXES = ["avc1", "avc3", "hvc1", "hev1", "vp09", "vp08", "av01"];

export function isVideoCodec(codec: string): boolean {
  const prefix = codec.split(".")[0]?.toLowerCase() ?? "";
  return VIDEO_CODEC_PREFIXES.includes(prefix);
}

/**
 * The MIME type for a `SourceBuffer` carrying one elementary stream.
 *
 * Always `video/mp4` or `audio/mp4`, never WebM: research §1 recommends
 * packaging every codec into fMP4 — including VP9 and Opus, which Chrome,
 * Firefox and Edge all decode in MP4 over MSE — so one container format covers
 * the whole ladder and a single buffer-controller path handles every codec.
 */
export function mimeTypeFor(codec: string): string {
  return `${isVideoCodec(codec) ? "video" : "audio"}/mp4; codecs="${codec}"`;
}

/* --------------------------------------------------------------- fetching -- */

export interface SegmentFetchRequest {
  readonly url: string;
  readonly signal: AbortSignal;
  /**
   * Called as bytes arrive. This is what makes abandonment possible at all —
   * without a progress signal there is nothing to project a finish time from,
   * and `shouldAbandon` returns `unknown-size` forever.
   */
  readonly onProgress?: (bytesReceived: number, expectedTotalBytes: number | null) => void;
}

export type SegmentFetcher = (request: SegmentFetchRequest) => Promise<Uint8Array>;
export type TextFetcher = (url: string, signal: AbortSignal) => Promise<string>;

/**
 * `fetch` with a streaming reader, so `onProgress` reports real byte counts.
 *
 * `response.arrayBuffer()` would be shorter and would make abandonment a dead
 * feature: a single await that resolves when the whole body has arrived reports
 * progress exactly once, at 100%, which is the one moment the check is useless.
 */
export const fetchSegmentOverHttp: SegmentFetcher = async (request) => {
  const response = await fetch(request.url, { signal: request.signal });
  if (!response.ok) {
    throw new Error(`Fetching ${request.url} answered ${response.status}`);
  }

  const declared = response.headers.get("content-length");
  const expected = declared === null ? null : Number(declared);
  const total = expected !== null && Number.isFinite(expected) ? expected : null;

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    request.onProgress?.(buffer.byteLength, total ?? buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    request.onProgress?.(received, total);
  }

  const out = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
};

export const fetchTextOverHttp: TextFetcher = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Fetching ${url} answered ${response.status}`);
  return response.text();
};

/* --------------------------------------------------------------- metrics -- */

/**
 * The rebuffer penalty in the QoE roll-up.
 *
 * research §8 gives the objective `QoE = Σ q(R_n) − μ·Σ rebufferSeconds − Σ
 * |q(R_n+1) − q(R_n)|` from Yin et al. 2015 and Pensieve, but not a value for μ.
 * 4.3 is the figure those papers use — **calibrated for `q` measured in Mbps**,
 * where we use BOLA's `ln(bitrate / lowestBitrate)` utility instead. So this
 * number is not comparable to a published QoE score. It is a scalar for
 * comparing two runs of *our* player over the same trace, which is what §8 asks
 * for, and it is honest about being nothing more.
 */
export const QOE_REBUFFER_PENALTY = 4.3;

/**
 * How long after a switch an opposite-direction switch counts as oscillation.
 *
 * research §8: "a downswitch followed by an upswitch (or vice versa) within a
 * short window (e.g. 2 segments)". Two segments of *played* media, not wall
 * clock, so a paused tab cannot age a flap out of the count.
 */
export const OSCILLATION_WINDOW_SEGMENTS = 2;

/**
 * A `waiting` must hold the playhead still for this long to count as a rebuffer.
 *
 * research §8: "> 100ms". Below that it is indistinguishable from the ordinary
 * jitter of a decode pipeline refilling.
 */
export const REBUFFER_MIN_MS = 100;

export interface PlaybackMetrics {
  /** Time-to-first-frame: `load()` to the first painted frame. `null` until then. */
  readonly startupMs: number | null;
  /** Sub-phase: `load()` to the playlists parsed and the source open. */
  readonly manifestMs: number | null;
  /** Sub-phase: manifest ready to the first media segment appended. */
  readonly firstSegmentMs: number | null;
  readonly rebufferCount: number;
  readonly rebufferSeconds: number;
  /** Media seconds the playhead actually advanced through. */
  readonly watchedSeconds: number;
  /** `rebufferSeconds / watchedSeconds` — the term comparable across videos. */
  readonly rebufferRatio: number;
  /** Time-weighted, per research §8, not a mean over segment count. */
  readonly meanBitrateBps: number;
  readonly upSwitches: number;
  readonly downSwitches: number;
  readonly oscillations: number;
  /** research §8 wants this at zero on a steady-state trace. */
  readonly quotaExceededCount: number;
  /** `droppedVideoFrames / totalVideoFrames`, or `null` where unavailable. */
  readonly droppedFrameRatio: number | null;
  /** The §8 roll-up. See `QOE_REBUFFER_PENALTY` for what it is and is not. */
  readonly qoe: number;
}

const EMPTY_METRICS: PlaybackMetrics = {
  startupMs: null,
  manifestMs: null,
  firstSegmentMs: null,
  rebufferCount: 0,
  rebufferSeconds: 0,
  watchedSeconds: 0,
  rebufferRatio: 0,
  meanBitrateBps: 0,
  upSwitches: 0,
  downSwitches: 0,
  oscillations: 0,
  quotaExceededCount: 0,
  droppedFrameRatio: null,
  qoe: 0,
};

/**
 * Accumulates the §8 metrics. Shared by the MSE engine and the progressive path,
 * which is why it takes a clock rather than reading one.
 *
 * Bitrate is attributed to the rendition **being rendered**, which the engine
 * derives from which segment covers `currentTime` — not to the rendition being
 * fetched. With 24 seconds of forward buffer those are routinely different
 * rungs, and attributing played seconds to the fetch decision would report a
 * quality the viewer will not see for another twelve segments.
 */
export class MetricsRecorder {
  private readonly now: () => number;

  private loadStartedAt: number | null = null;
  private manifestReadyAt: number | null = null;
  private firstSegmentAt: number | null = null;
  private firstFrameAt: number | null = null;

  private rebufferCount = 0;
  private rebufferMs = 0;
  private waitingSince: number | null = null;

  private watchedSeconds = 0;
  private lastMediaTime: number | null = null;

  private bitrateWeightedSeconds = 0;
  private renderedSeconds = 0;
  private renderedBitrate: number | null = null;

  private upSwitches = 0;
  private downSwitches = 0;
  private oscillations = 0;
  private lastSwitchDirection: 1 | -1 | null = null;
  private lastSwitchAtMediaTime = 0;

  private qualitySum = 0;
  private smoothnessPenalty = 0;
  private lastUtility: number | null = null;

  private droppedFrameRatio: number | null = null;
  quotaExceededCount = 0;

  constructor(now: () => number) {
    this.now = now;
  }

  markLoadStart(): void {
    this.loadStartedAt = this.now();
  }

  markManifestReady(): void {
    if (this.manifestReadyAt === null) this.manifestReadyAt = this.now();
  }

  markFirstSegmentAppended(): void {
    if (this.firstSegmentAt === null) this.firstSegmentAt = this.now();
  }

  markFirstFrame(): void {
    if (this.firstFrameAt === null) this.firstFrameAt = this.now();
  }

  /**
   * A `waiting` event. research §8 excludes two cases from the rebuffer count:
   * one immediately preceded by a `seeking` event (ordinary seek latency is not
   * rebuffering in the QoE sense) and a deliberate pause.
   */
  onWaiting(context: { readonly seeking: boolean; readonly paused: boolean }): void {
    if (context.seeking || context.paused) return;
    this.waitingSince ??= this.now();
  }

  onResumed(): void {
    if (this.waitingSince === null) return;
    const elapsed = this.now() - this.waitingSince;
    this.waitingSince = null;
    if (elapsed < REBUFFER_MIN_MS) return;
    this.rebufferCount += 1;
    this.rebufferMs += elapsed;
  }

  /** Cancels a pending `waiting` without counting it — a seek started instead. */
  onSeekStarted(): void {
    this.waitingSince = null;
  }

  /**
   * Called every tick with the playhead and what is rendering there.
   *
   * A backward jump or a jump larger than one tick is a seek, and contributes no
   * watch time: counting it would let a viewer scrubbing to the end "watch" the
   * whole video in a second and would put the rebuffer ratio's denominator
   * somewhere meaningless.
   */
  onPlayheadAdvanced(mediaTime: number, renderedBitrate: number | null): void {
    const previous = this.lastMediaTime;
    this.lastMediaTime = mediaTime;

    if (previous !== null) {
      const delta = mediaTime - previous;
      if (delta > 0 && delta < 1) {
        this.watchedSeconds += delta;
        if (renderedBitrate !== null) {
          this.bitrateWeightedSeconds += renderedBitrate * delta;
          this.renderedSeconds += delta;
        }
      }
    }

    if (renderedBitrate !== null && renderedBitrate !== this.renderedBitrate) {
      this.recordSwitch(this.renderedBitrate, renderedBitrate, mediaTime);
      this.renderedBitrate = renderedBitrate;
    }
  }

  private recordSwitch(from: number | null, to: number, mediaTime: number): void {
    const utility = Math.log(Math.max(to, 1));
    this.qualitySum += utility;
    if (this.lastUtility !== null) {
      this.smoothnessPenalty += Math.abs(utility - this.lastUtility);
    }
    this.lastUtility = utility;

    if (from === null) return;

    const direction: 1 | -1 = to > from ? 1 : -1;
    if (direction === 1) this.upSwitches += 1;
    else this.downSwitches += 1;

    if (
      this.lastSwitchDirection !== null &&
      this.lastSwitchDirection !== direction &&
      mediaTime - this.lastSwitchAtMediaTime <=
        OSCILLATION_WINDOW_SEGMENTS * SEGMENT_DURATION_HINT_SECONDS
    ) {
      this.oscillations += 1;
    }
    this.lastSwitchDirection = direction;
    this.lastSwitchAtMediaTime = mediaTime;
  }

  onFrameQuality(quality: { droppedVideoFrames: number; totalVideoFrames: number }): void {
    if (quality.totalVideoFrames <= 0) return;
    this.droppedFrameRatio = quality.droppedVideoFrames / quality.totalVideoFrames;
  }

  snapshot(): PlaybackMetrics {
    const rebufferSeconds = this.rebufferMs / 1000;
    return {
      startupMs:
        this.loadStartedAt === null || this.firstFrameAt === null
          ? null
          : this.firstFrameAt - this.loadStartedAt,
      manifestMs:
        this.loadStartedAt === null || this.manifestReadyAt === null
          ? null
          : this.manifestReadyAt - this.loadStartedAt,
      firstSegmentMs:
        this.manifestReadyAt === null || this.firstSegmentAt === null
          ? null
          : this.firstSegmentAt - this.manifestReadyAt,
      rebufferCount: this.rebufferCount,
      rebufferSeconds,
      watchedSeconds: this.watchedSeconds,
      rebufferRatio: this.watchedSeconds > 0 ? rebufferSeconds / this.watchedSeconds : 0,
      meanBitrateBps:
        this.renderedSeconds > 0 ? this.bitrateWeightedSeconds / this.renderedSeconds : 0,
      upSwitches: this.upSwitches,
      downSwitches: this.downSwitches,
      oscillations: this.oscillations,
      quotaExceededCount: this.quotaExceededCount,
      droppedFrameRatio: this.droppedFrameRatio,
      qoe:
        this.qualitySum - QOE_REBUFFER_PENALTY * rebufferSeconds - this.smoothnessPenalty,
    };
  }
}

/**
 * Used only by the oscillation window, which needs "two segments" in seconds
 * before any playlist has been parsed. Our packager cuts on a fixed 2s grid
 * (`SEGMENT_DURATION_US` in `src/media/encode/ladder.ts`), so this is a fact
 * about our own encoder rather than an assumption about content.
 */
const SEGMENT_DURATION_HINT_SECONDS = 2;

/* ----------------------------------------------------------- public shape -- */

export interface QualityOption {
  readonly id: string;
  /** `1080p`, `720p`, … — what the quality menu shows. */
  readonly name: string;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly bitrate: number;
  readonly codecs: readonly string[];
}

export type PlayerPhase = "idle" | "loading" | "buffering" | "playing" | "ended" | "error";

export interface EngineState {
  readonly mode: PlaybackMode;
  readonly phase: PlayerPhase;
  readonly qualities: readonly QualityOption[];
  /**
   * The rendition currently being *rendered*, for the quality menu's live
   * "Auto (1080p)" readout (research §7 — it is a live readout, not a label).
   */
  readonly activeQualityId: string | null;
  /** The rendition currently being fetched, which leads the rendered one. */
  readonly fetchingQualityId: string | null;
  /** `null` means Auto. See `setQuality` for exactly what a pin survives. */
  readonly pinnedQualityId: string | null;
  readonly bufferedAheadSeconds: number;
  readonly throughputBps: number | null;
  readonly error: Error | null;
  readonly metrics: PlaybackMetrics;
}

export interface PlayerEngine {
  readonly state: EngineState;
  subscribe(listener: (state: EngineState) => void): () => void;
  load(): Promise<void>;
  /**
   * Pin a rendition, or `"auto"` to hand control back to the ABR selector.
   *
   * **What a manual pick survives, decided here and documented because research
   * §7 is explicit that this is a product decision rather than a spec fact:**
   *
   *  - **A seek: yes.** The pin is engine state, and the seek path re-fetches
   *    through `selectRendition`, which short-circuits to the pin. A seek never
   *    silently returns the viewer to Auto.
   *  - **A stall or rebuffer: yes — the pin is a hard constraint, not a
   *    preference.** The player rebuffers *at* the pinned quality rather than
   *    dropping the viewer to a lower rung without telling them, because
   *    silently overriding an explicit choice defeats the point of offering it.
   *    Concretely: the `bufferLowSeconds` floor and the abandonment rule are both
   *    suppressed while a pin is in force. Both still *run*, and their answers
   *    still reach the metrics, so the UI can offer "struggling to play at
   *    1080p — switch to Auto?" — a nudge, never an automatic revert.
   *  - **Navigating away: no.** This is a per-playback pin, cleared when the
   *    engine is destroyed. A standing cross-video preference is a different
   *    thing with different storage, and belongs to the surface that owns
   *    settings rather than to a player instance.
   *
   * Switching between Auto and a pin that is already what is buffered is a
   * no-op — no `changeType`, no init re-append, no rebuffer.
   */
  setQuality(id: string | "auto"): void;
  /**
   * One iteration of the fetch loop.
   *
   * Exposed because the loop's decisions are the interesting part and driving
   * them from a test is worth more than hiding them: `await engine.tick()` after
   * setting up a buffer state asserts what the engine does about that state,
   * with no timers and no flake. The interval calls exactly this.
   */
  tick(): Promise<void>;
  destroy(): void;
}

/* ---------------------------------------------------------------- options -- */

export interface EngineDependencies {
  readonly fetchSegment: SegmentFetcher;
  readonly fetchText: TextFetcher;
  /** Monotonic milliseconds. Injected so metrics assertions do not race a clock. */
  readonly now: () => number;
  readonly createObjectUrl: (source: object) => string;
  readonly revokeObjectUrl: (url: string) => void;
}

export interface LadderedEngineOptions {
  readonly media: MediaElementLike;
  readonly masterPlaylistUrl: string;
  readonly abr?: Partial<AbrConfig>;
  readonly buffer?: Partial<BufferTargets>;
  readonly dependencies?: Partial<EngineDependencies>;
  /** Overrides detection. Tests and the e2e progressive project use it. */
  readonly forceMode?: PlaybackMode;
  readonly tickIntervalMs?: number;
}

function defaultDependencies(): EngineDependencies {
  return {
    fetchSegment: fetchSegmentOverHttp,
    fetchText: fetchTextOverHttp,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
    createObjectUrl: (source) => URL.createObjectURL(source as Blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * How long to wait for `sourceopen` before calling it a failure.
 *
 * There is no correct value here — this is a watchdog, not a timeout with
 * meaning. Ten seconds is far past any real attach and far short of the
 * indefinite hang that research §2's AirPlay gating produces, which is the
 * failure it exists to convert into a message somebody can act on.
 */
export const SOURCE_OPEN_TIMEOUT_MS = 10_000;

/** One segment of guard before a fast-switch discards forward buffer. */
const FAST_SWITCH_GUARD_SECONDS = 2;

/* ------------------------------------------------------------ seek helper -- */

/**
 * Which segment to fetch next, given the playhead and what is buffered.
 *
 * **This is research §5's fix, and it is a pure function so the bug it prevents
 * has a test that needs no browser.** The natural implementation — "the segment
 * after the end of the last buffered range" — is correct exactly while the
 * playhead is inside that range, and silently wrong the instant it is not. After
 * a seek into a hole it keeps returning an index far ahead of where playback is
 * trying to happen, nothing ever fetches the segment under the playhead, and the
 * element stalls at `HAVE_METADATA` forever with no error.
 *
 * Anchoring on the range *containing* the playhead makes the two cases one case:
 * inside buffered data, continue from its end; outside it, start at the playhead.
 *
 * It also makes the engine self-healing against a `ManagedSourceBuffer` evicting
 * data behind our back (research §2 — `bufferedchange`), because the answer is
 * re-derived from `buffered` every tick rather than carried in a cursor that
 * would now be wrong.
 */
export function nextSegmentIndex(
  playlist: MediaPlaylist,
  ranges: readonly BufferedRange[],
  currentTime: number,
): number | null {
  const containing = rangeContaining(ranges, currentTime);
  // A hair past the boundary, because a range end that lands a microsecond short
  // of a segment boundary would otherwise re-select the segment we just appended.
  const from = (containing === null ? currentTime : containing.end) + 1e-3;
  return segmentIndexAt(playlist, Math.max(0, from));
}

/* ------------------------------------------------------------------ track -- */

interface Track {
  readonly kind: "video" | "audio";
  readonly ladder: readonly AbrRendition[];
  /** Rendition id → its media playlist, fetched lazily on first use. */
  readonly playlists: Map<string, MediaPlaylist>;
  /** Rendition id → its initialization segment bytes, cached across switches. */
  readonly initSegments: Map<string, Uint8Array>;
  readonly variantByRendition: Map<string, { uri: string; codec: string }>;
  controller: BufferController;
  currentRenditionId: string;
  /** Rendition the buffer's parser is currently configured for. */
  primedRenditionId: string | null;
  inFlight: InFlight | null;
  /** Segment index → the bitrate it was fetched at, for the rendered-quality readout. */
  readonly bitrateBySegment: Map<number, number>;
  lastAppendedIndex: number | null;
  segmentsSinceUpSwitch: number;
  /**
   * A rendition the next fetch must use, overriding the ABR selector once.
   *
   * Set only by abandonment. Without it the selector re-runs on the very next
   * tick, still holding an estimate built from the samples *before* the
   * collapse, and puts the segment straight back on the rung we just abandoned —
   * which turns the whole mechanism into a way to waste a partial download.
   * hls.js forces `nextLoadLevel` for the same reason.
   */
  forcedRenditionId: string | null;
  complete: boolean;
}

interface InFlight {
  readonly index: number;
  readonly renditionId: string;
  /**
   * When the *segment* transfer began — reset after priming, so the init
   * segment's own fetch is not billed to the media segment's throughput sample
   * or to the abandonment projection. Two transfers, two measurements.
   */
  startedAtMs: number;
  readonly abort: AbortController;
  bytesReceived: number;
  expectedTotalBytes: number | null;
  /** Throttles the abandonment check to `abandonPollIntervalMs`. */
  lastAbandonCheckMs: number;
}

/* ----------------------------------------------------------------- engine -- */

export function createLadderedEngine(options: LadderedEngineOptions): PlayerEngine {
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  const { media } = options;
  const abrConfig: AbrConfig = { ...ABR_DEFAULTS, ...options.abr };
  const bufferTargets: BufferTargets = { ...BUFFER_TARGETS, ...options.buffer };
  const tickIntervalMs = options.tickIntervalMs ?? abrConfig.abandonPollIntervalMs;

  const metrics = new MetricsRecorder(dependencies.now);
  const throughput = new ThroughputEstimator(abrConfig);
  const listeners = new Set<(state: EngineState) => void>();

  let mode: PlaybackMode = "media-source";
  let phase: PlayerPhase = "idle";
  let qualities: readonly QualityOption[] = [];
  let pinnedQualityId: string | null = null;
  let error: Error | null = null;
  let destroyed = false;

  let mediaSource: MediaSourceLike | null = null;
  let objectUrl: string | null = null;
  let tracks: Track[] = [];
  let videoTrack: Track | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let started = false;
  let endOfStreamCalled = false;

  const elementListeners: [string, () => void][] = [];

  /* -------------------------------------------------------------- state -- */

  function bufferedAheadSeconds(): number {
    if (videoTrack === null) return 0;
    return videoTrack.controller.bufferedAhead(media.currentTime);
  }

  function renderedRendition(): { id: string; bitrate: number } | null {
    if (videoTrack === null) return null;
    const playlist = videoTrack.playlists.get(videoTrack.currentRenditionId);
    if (playlist === undefined) return null;
    const index = segmentIndexAt(playlist, media.currentTime);
    if (index === null) return null;
    const bitrate = videoTrack.bitrateBySegment.get(index);
    if (bitrate === undefined) return null;
    const rung = videoTrack.ladder.find((r) => r.bitrate === bitrate);
    return { id: rung?.id ?? videoTrack.currentRenditionId, bitrate };
  }

  function snapshot(): EngineState {
    metrics.quotaExceededCount = tracks.reduce(
      (sum, track) => sum + track.controller.quotaExceededCount,
      0,
    );
    return {
      mode,
      phase,
      qualities,
      activeQualityId: renderedRendition()?.id ?? null,
      fetchingQualityId: videoTrack?.currentRenditionId ?? null,
      pinnedQualityId,
      bufferedAheadSeconds: bufferedAheadSeconds(),
      throughputBps: throughput.estimateBps(),
      error,
      metrics: metrics.snapshot(),
    };
  }

  let cached: EngineState = { ...EMPTY_STATE, metrics: EMPTY_METRICS };

  function emit(): void {
    cached = snapshot();
    for (const listener of listeners) listener(cached);
  }

  function fail(cause: unknown, context: string): void {
    if (destroyed) return;
    error = cause instanceof Error ? cause : new Error(`${context}: ${String(cause)}`);
    phase = "error";
    emit();
  }

  /* ------------------------------------------------------------- events -- */

  function on(type: string, listener: () => void): void {
    media.addEventListener(type, listener);
    elementListeners.push([type, listener]);
  }

  function installElementListeners(): void {
    on("waiting", () => {
      metrics.onWaiting({ seeking: media.seeking, paused: media.paused });
      if (phase === "playing") phase = "buffering";
      emit();
    });
    on("playing", () => {
      metrics.onResumed();
      phase = "playing";
      emit();
    });
    on("seeking", () => {
      // research §8 excludes ordinary seek latency from the rebuffer count, and
      // research §5 wants the fetch decision recomputed rather than left to the
      // periodic check — a tick now is the cheapest way to do both.
      metrics.onSeekStarted();
      /**
       * Clearing `complete` is what makes a backward seek recoverable.
       *
       * `complete` means "there is nothing left to fetch", and `pump` returns
       * immediately when it is set. It was latched the moment
       * `nextSegmentIndex` found no segment ahead of the playhead — which is
       * true at the end of a stream, and *equally* true one second into a cold
       * VOD if the viewer seeks straight to the last segment. Everything
       * before it was never fetched, but the track called itself finished, so
       * seeking back to the beginning stalled with no error and no recovery
       * short of reloading the page.
       *
       * A seek is the one event that can invalidate the judgement, because it
       * is the only thing that moves the playhead somewhere the buffer does
       * not cover. Recomputing rather than clearing conditionally: the very
       * next `pump` calls `nextSegmentIndex` again and re-latches immediately
       * if the answer really is "nothing left", so a genuine end-of-stream
       * costs one extra evaluation and a mistaken one is undone.
       */
      for (const track of tracks) track.complete = false;
      /**
       * And the latch on the other side of it.
       *
       * `endOfStream()` puts the `MediaSource` into `ended`; appending after
       * that legitimately returns it to `open`, but `endOfStreamCalled` would
       * still be set, so the stream would never be re-ended and `duration`
       * would stay whatever the premature call fixed it to. Clearing both
       * together keeps the pair meaning one thing.
       */
      endOfStreamCalled = false;
      void tick();
    });
    on("seeked", () => {
      void tick();
    });
    on("ended", () => {
      phase = "ended";
      emit();
    });
    on("timeupdate", () => {
      metrics.onPlayheadAdvanced(media.currentTime, renderedRendition()?.bitrate ?? null);
    });
  }

  /* -------------------------------------------------------------- attach -- */

  /**
   * Attach a `MediaSource` to the element and wait for `sourceopen`.
   *
   * The `disableRemotePlayback` assignment is the single most consequential line
   * in this file (research §2, `DECISIONS.md` D10). It is set unconditionally
   * rather than only on the Managed path, because it costs nothing on plain
   * `MediaSource` and the alternative is a branch that can be wrong on a browser
   * nobody tested. The rejected alternative is offering an AirPlay-eligible
   * native `<source>` sibling, which also satisfies the gate — but that means
   * shipping a second playback path for AirPlay to pick up, and this engine's
   * whole premise is that there is one.
   */
  function attachMediaSource(constructor: MediaSourceConstructorLike): Promise<MediaSourceLike> {
    media.disableRemotePlayback = true;

    const source = new constructor();
    mediaSource = source;

    return new Promise<MediaSourceLike>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "The MediaSource never fired `sourceopen`. On Safari this is almost always " +
              "AirPlay gating: a ManagedMediaSource stays closed unless " +
              "`video.disableRemotePlayback = true` is set before attaching, or an " +
              "AirPlay-eligible <source> sibling exists (research/03 §2). The flag is set " +
              "here, so if you are seeing this, check that nothing downstream reset it.",
          ),
        );
      }, SOURCE_OPEN_TIMEOUT_MS);

      const cleanup = (): void => {
        clearTimeout(timer);
        source.removeEventListener("sourceopen", onOpen);
      };
      const onOpen = (): void => {
        cleanup();
        resolve(source);
      };
      source.addEventListener("sourceopen", onOpen);

      // `srcObject` is the form MDN documents for ManagedMediaSource and is the
      // only one that avoids a blob URL we would then have to revoke. Plain
      // MediaSource-in-srcObject is not universally supported, so that path keeps
      // `createObjectURL`. **Assumed, not measured** on real Safari.
      if (mode === "managed-media-source") {
        media.srcObject = source;
      } else {
        objectUrl = dependencies.createObjectUrl(source);
        media.src = objectUrl;
      }
    });
  }

  /* ---------------------------------------------------------------- load -- */

  async function load(): Promise<void> {
    if (destroyed) return;
    metrics.markLoadStart();
    phase = "loading";
    emit();

    try {
      const masterText = await dependencies.fetchText(
        options.masterPlaylistUrl,
        new AbortController().signal,
      );
      const master = parseMasterPlaylist(masterText, options.masterPlaylistUrl);

      const videoVariants = master.variants.filter((variant) =>
        variant.codecs.some(isVideoCodec),
      );
      const requiredTypes = uniqueMimeTypes(master.variants);
      mode = options.forceMode ?? detectPlaybackMode(probeCapabilities(media, requiredTypes));

      if (mode === "native-hls") {
        // Safari's own HLS engine does the ABR and none of our JS runs
        // (research §2). We keep the metrics we can still observe from element
        // events and expose no quality control, because there is none to expose.
        media.src = options.masterPlaylistUrl;
        installElementListeners();
        metrics.markManifestReady();
        phase = "buffering";
        emit();
        return;
      }
      if (mode === "progressive") {
        throw new Error(
          "This browser has neither a usable MediaSource nor native HLS for these codecs. " +
            "The caller should route to `createProgressivePlayer` instead — see " +
            "`createPlayer` in ./index.ts, which does that branch for you.",
        );
      }

      const constructor =
        mode === "managed-media-source"
          ? (globalThis as Record<string, unknown>).ManagedMediaSource
          : (globalThis as Record<string, unknown>).MediaSource;
      if (typeof constructor !== "function") {
        throw new Error(`Detection chose ${mode} but its constructor is not available`);
      }

      const source = await attachMediaSource(constructor as MediaSourceConstructorLike);

      videoTrack = await buildVideoTrack(source, videoVariants);
      tracks = [videoTrack];

      const audioTrack = await buildAudioTrack(source, master, videoVariants);
      if (audioTrack !== null) tracks.push(audioTrack);

      qualities = videoVariants.map(toQualityOption);
      installElementListeners();
      installFrameCallback();
      metrics.markManifestReady();
      phase = "buffering";
      emit();

      startTicking();
      await tick();
    } catch (cause) {
      fail(cause, "Loading the master playlist");
    }
  }

  function uniqueMimeTypes(variants: readonly PlaylistVariant[]): readonly string[] {
    const types = new Set<string>();
    for (const variant of variants) {
      for (const codec of variant.codecs) types.add(mimeTypeFor(codec));
    }
    return [...types];
  }

  function toQualityOption(variant: PlaylistVariant): QualityOption {
    return {
      id: variant.uri,
      name:
        variant.resolution === undefined
          ? `${Math.round(variant.bandwidth / 1000)}kbps`
          : `${variant.resolution.height}p`,
      width: variant.resolution?.width,
      height: variant.resolution?.height,
      bitrate: variant.bandwidth,
      codecs: variant.codecs,
    };
  }

  async function buildVideoTrack(
    source: MediaSourceLike,
    variants: readonly PlaylistVariant[],
  ): Promise<Track> {
    const first = variants[0];
    if (first === undefined) {
      throw new Error("The master playlist declares no video variant");
    }

    const ladder: AbrRendition[] = variants.map((variant) => ({
      id: variant.uri,
      bitrate: variant.bandwidth,
    }));
    const variantByRendition = new Map(
      variants.map((variant) => [
        variant.uri,
        { uri: variant.uri, codec: variant.codecs.find(isVideoCodec) ?? variant.codecs[0] ?? "" },
      ]),
    );

    const codec = variantByRendition.get(first.uri)?.codec ?? "";
    const sourceBuffer = source.addSourceBuffer(mimeTypeFor(codec));

    const track: Track = {
      kind: "video",
      ladder,
      playlists: new Map(),
      initSegments: new Map(),
      variantByRendition,
      controller: new BufferController({
        sourceBuffer,
        currentTime: () => media.currentTime,
        targets: bufferTargets,
        label: "video",
      }),
      currentRenditionId: first.uri,
      primedRenditionId: null,
      inFlight: null,
      bitrateBySegment: new Map(),
      lastAppendedIndex: null,
      // Large, so the first upswitch is never blocked by anti-thrash — there has
      // been no previous upswitch for it to be too close to.
      segmentsSinceUpSwitch: Number.MAX_SAFE_INTEGER,
      forcedRenditionId: null,
      complete: false,
    };
    await ensurePlaylist(track, first.uri);
    return track;
  }

  async function buildAudioTrack(
    source: MediaSourceLike,
    master: ReturnType<typeof parseMasterPlaylist>,
    videoVariants: readonly PlaylistVariant[],
  ): Promise<Track | null> {
    const groupId = videoVariants[0]?.audioGroupId;
    const rendition = defaultRenditionFor(master, "AUDIO", groupId);
    if (rendition?.uri === undefined) return null;

    const codec = videoVariants[0]?.codecs.find((c) => !isVideoCodec(c));
    if (codec === undefined) return null;

    // research §1: separate audio and video SourceBuffers rather than muxed
    // segments, so the two ride independent buffer targets — and so an audio
    // rendition shared across every video rung is fetched once, which is exactly
    // what our packager emits.
    const sourceBuffer = source.addSourceBuffer(mimeTypeFor(codec));
    const track: Track = {
      kind: "audio",
      ladder: [{ id: rendition.uri, bitrate: 1 }],
      playlists: new Map(),
      initSegments: new Map(),
      variantByRendition: new Map([[rendition.uri, { uri: rendition.uri, codec }]]),
      controller: new BufferController({
        sourceBuffer,
        currentTime: () => media.currentTime,
        targets: bufferTargets,
        label: "audio",
      }),
      currentRenditionId: rendition.uri,
      primedRenditionId: null,
      inFlight: null,
      bitrateBySegment: new Map(),
      lastAppendedIndex: null,
      segmentsSinceUpSwitch: Number.MAX_SAFE_INTEGER,
      forcedRenditionId: null,
      complete: false,
    };
    await ensurePlaylist(track, rendition.uri);
    return track;
  }

  async function ensurePlaylist(track: Track, renditionId: string): Promise<MediaPlaylist> {
    const existing = track.playlists.get(renditionId);
    if (existing !== undefined) return existing;
    const text = await dependencies.fetchText(renditionId, new AbortController().signal);
    const playlist = parseMediaPlaylist(text, renditionId);
    track.playlists.set(renditionId, playlist);
    return playlist;
  }

  function installFrameCallback(): void {
    // research §8 prefers `requestVideoFrameCallback` as the "pixels on screen"
    // signal, falling back to the first `timeupdate` past zero. Both are wired:
    // the fallback fires on every engine, and the good signal wins where it
    // exists because `markFirstFrame` keeps the first value it is given.
    media.requestVideoFrameCallback?.(() => metrics.markFirstFrame());
    on("timeupdate", () => {
      if (media.currentTime > 0) metrics.markFirstFrame();
    });
  }

  /* ---------------------------------------------------------------- tick -- */

  function startTicking(): void {
    if (intervalId !== null) return;
    intervalId = setInterval(() => void tick(), tickIntervalMs);
  }

  async function tick(): Promise<void> {
    if (destroyed || ticking || mediaSource === null) return;
    ticking = true;
    try {
      const at = media.currentTime;
      for (const track of tracks) await pump(track, at);
      await evictIfNeeded(at);
      maybeEndOfStream();
      readFrameQuality();
      metrics.onPlayheadAdvanced(at, renderedRendition()?.bitrate ?? null);
      emit();
    } catch (cause) {
      fail(cause, "The playback loop");
    } finally {
      ticking = false;
    }
  }

  function readFrameQuality(): void {
    const quality = media.getVideoPlaybackQuality?.();
    if (quality !== undefined) metrics.onFrameQuality(quality);
  }

  /**
   * The `ManagedMediaSource` branch of the fetch decision.
   *
   * research §2 is explicit that this needs two real code paths rather than a
   * shim: on plain `MediaSource` we decide when to fetch from our own buffer-health
   * target, and on a Managed source the browser tells us via `streaming` and its
   * `startstreaming`/`endstreaming` events. Fetching while the browser has said
   * it does not want data is how a managed source ends up doing the eviction we
   * were trying to avoid.
   */
  function browserWantsData(): boolean {
    if (mediaSource === null) return false;
    if (mode !== "managed-media-source") return true;
    return mediaSource.streaming !== false;
  }

  async function pump(track: Track, at: number): Promise<void> {
    if (track.complete) return;

    // A download already open. The abandonment check is *not* run from here: this
    // tick is the one that started that download and is still awaiting it, and a
    // later tick cannot get past the re-entrancy guard while it does. Polling
    // from the tick loop would therefore never fire at all. It runs from the
    // fetch's own progress callback instead — see `fetchAndAppend`.
    if (track.inFlight !== null) return;
    if (!browserWantsData()) return;

    const target = started ? bufferTargets.forwardSeconds : bufferTargets.startupSeconds;
    if (!track.controller.wantsMoreData(target, at)) return;

    // `ensurePlaylist`, not a cache read with an early return. The early return
    // was a silent permanent stall: a rendition change that happens *outside* the
    // tick — which is exactly what `setQuality` is — leaves `currentRenditionId`
    // pointing at a playlist that has never been fetched, and a pump that gives
    // up on a cache miss then gives up on every subsequent tick too. The player
    // reports no error and simply stops.
    const playlist = await ensurePlaylist(track, track.currentRenditionId);

    let index = nextSegmentIndex(playlist, track.controller.ranges, at);
    if (index === null) {
      track.complete = true;
      return;
    }
    // A defence against an infinite fetch loop: if an append landed but did not
    // extend `buffered` past the boundary we measured from (a packager timestamp
    // regression would do this), re-selecting the same index would fetch it
    // forever. Stepping past it turns a silent spin into a visible gap.
    if (track.lastAppendedIndex === index) index += 1;
    if (index >= playlist.segments.length) {
      track.complete = true;
      return;
    }

    if (track.kind === "video") {
      if (track.forcedRenditionId !== null) {
        track.currentRenditionId = track.forcedRenditionId;
        track.forcedRenditionId = null;
      } else {
        applyAbrDecision(track, at);
      }
    }
    await fetchAndAppend(track, index, at);
  }

  function applyAbrDecision(track: Track, at: number): AbrDecision {
    const decision = selectRendition({
      ladder: track.ladder,
      currentRenditionId: track.currentRenditionId,
      throughputBps: throughput.estimateBps(),
      bufferSeconds: track.controller.bufferedAhead(at),
      segmentDurationSeconds: segmentDurationOf(track),
      segmentsSinceUpSwitch: track.segmentsSinceUpSwitch,
      pinnedRenditionId: pinnedQualityId,
      config: abrConfig,
    });

    if (decision.rendition.id !== track.currentRenditionId) {
      const previous = track.ladder.find((r) => r.id === track.currentRenditionId);
      track.segmentsSinceUpSwitch =
        previous !== undefined && decision.rendition.bitrate > previous.bitrate
          ? 0
          : track.segmentsSinceUpSwitch;
      track.currentRenditionId = decision.rendition.id;
    } else {
      track.segmentsSinceUpSwitch = Math.min(
        track.segmentsSinceUpSwitch + 1,
        Number.MAX_SAFE_INTEGER,
      );
    }
    return decision;
  }

  function segmentDurationOf(track: Track): number {
    const playlist = track.playlists.get(track.currentRenditionId);
    return (
      playlist?.uniformSegmentDurationSeconds ??
      playlist?.segments[0]?.durationSeconds ??
      SEGMENT_DURATION_HINT_SECONDS
    );
  }

  /**
   * Fetch one segment and append it, switching the buffer's configuration first
   * if the rendition changed.
   *
   * The order in `primeIfNeeded` is research §3's procedure and the sequence is
   * not negotiable: `changeType` then the **initialization segment** then the
   * media segment. `changeType` alone declares what the next bytes claim to be;
   * it supplies none of the decoder configuration, which lives in the `moov` box
   * of the new rendition's init segment. Skipping the re-append is a
   * silent-corruption bug rather than a loud one.
   */
  async function fetchAndAppend(track: Track, index: number, at: number): Promise<void> {
    const playlist = await ensurePlaylist(track, track.currentRenditionId);
    const segment = playlist.segments[index];
    if (segment === undefined) {
      track.complete = true;
      return;
    }

    const abort = new AbortController();
    const startedAtMs = dependencies.now();
    const inFlight: InFlight = {
      index,
      renditionId: track.currentRenditionId,
      startedAtMs,
      abort,
      bytesReceived: 0,
      expectedTotalBytes: null,
      lastAbandonCheckMs: startedAtMs,
    };
    track.inFlight = inFlight;

    try {
      await primeIfNeeded(track, playlist);
      // Priming may have fetched and appended an initialization segment. The
      // segment transfer starts now.
      inFlight.startedAtMs = dependencies.now();
      inFlight.lastAbandonCheckMs = inFlight.startedAtMs;

      const data = await dependencies.fetchSegment({
        url: segment.uri,
        signal: abort.signal,
        onProgress: (bytes, total) => {
          inFlight.bytesReceived = bytes;
          inFlight.expectedTotalBytes = total;
          // dash.js computes its `AbandonRequestRule` from exactly this — the
          // byte deltas of progress events (research §6) — and it is the only
          // place the evidence actually arrives. Throttled to
          // `abandonPollIntervalMs` so a response delivering many small chunks
          // does not re-run the projection per chunk.
          const now = dependencies.now();
          if (now - inFlight.lastAbandonCheckMs < abrConfig.abandonPollIntervalMs) return;
          inFlight.lastAbandonCheckMs = now;
          considerAbandoning(track, inFlight, media.currentTime);
        },
      });

      const elapsedMs = dependencies.now() - inFlight.startedAtMs;
      /**
       * Video segments only.
       *
       * `fetchAndAppend` runs for every track, so this fed audio downloads
       * into the estimator that chooses **video** rungs. An audio segment is
       * around 16 KiB against a 1080p segment's 3 MB, and a small transfer
       * measures the connection badly: latency is a fixed cost that a short
       * download cannot amortise, so a 16 KiB body arriving in 50 ms records
       * ~2.6 Mbps on a link that would have carried twenty times that. Those
       * samples enter the same EWMA as the real measurements and drag the
       * estimate down, capping the ladder well below what the connection
       * supports — and the more comfortably a viewer's bandwidth exceeds the
       * top rung, the more the audio samples dominate, because the video
       * samples stop being the slow ones.
       *
       * The audio track is not separately estimated because nothing selects an
       * audio rendition: there is one audio rung. Measuring it would produce a
       * number with no decision attached to it.
       */
      if (track.kind === "video") {
        throughput.onSegmentDownloaded(data.byteLength, elapsedMs);
      }

      await track.controller.append(data, segment.durationSeconds);
      track.lastAppendedIndex = index;
      if (track.kind === "video") {
        const rung = track.ladder.find((r) => r.id === inFlight.renditionId);
        if (rung !== undefined) track.bitrateBySegment.set(index, rung.bitrate);
      }
      if (!started) {
        metrics.markFirstSegmentAppended();
        started = true;
      }
    } catch (cause) {
      if (abort.signal.aborted) return; // abandoned or torn down; not a failure
      if (cause instanceof BufferQuotaError) {
        // research §4's last recoverable step: eviction could not make room, so
        // fetch smaller segments. Nothing to do but drop a rung and let the next
        // tick retry — which is why this is not rethrown.
        forceDownswitch(track, at);
        return;
      }
      throw cause;
    } finally {
      if (track.inFlight === inFlight) track.inFlight = null;
    }
  }

  async function primeIfNeeded(track: Track, playlist: MediaPlaylist): Promise<void> {
    const renditionId = track.currentRenditionId;
    if (track.primedRenditionId === renditionId && track.controller.isPrimed) return;

    const variant = track.variantByRendition.get(renditionId);
    if (track.primedRenditionId !== null && variant !== undefined) {
      const previous = track.variantByRendition.get(track.primedRenditionId);
      // research §3: treat "the codec string differs at all" as the trigger, not
      // "the codec family differs" — our packager gives a 360p and a 720p encode
      // different `avc1.PPCCLL` levels, and skipping the call when you should not
      // have corrupts silently.
      if (previous !== undefined && previous.codec !== variant.codec) {
        await track.controller.changeType(mimeTypeFor(variant.codec));
      }
    }

    const initUri = playlist.initSegmentUri;
    if (initUri === undefined) {
      throw new Error(
        `The media playlist for ${renditionId} has no EXT-X-MAP, so there is no ` +
          "initialization segment to configure the decoder with",
      );
    }

    let init = track.initSegments.get(renditionId);
    if (init === undefined) {
      init = await dependencies.fetchSegment({
        url: initUri,
        signal: new AbortController().signal,
      });
      track.initSegments.set(renditionId, init);
    }
    await track.controller.appendInitSegment(init);
    track.primedRenditionId = renditionId;
  }

  function forceDownswitch(track: Track, at: number): void {
    const current = track.ladder.find((r) => r.id === track.currentRenditionId);
    if (current === undefined) return;
    const below = track.ladder
      .filter((r) => r.bitrate < current.bitrate)
      .sort((a, b) => a.bitrate - b.bitrate);
    const next = below[below.length - 1];
    if (next === undefined) {
      fail(
        new Error(
          `The ${track.kind} buffer is full at the lowest rendition and eviction cannot ` +
            "free space. This is research §4's terminal case: surface it rather than loop.",
        ),
        "Buffer quota",
      );
      return;
    }
    track.currentRenditionId = next.id;
    void track.controller.evictBackBuffer(at);
  }

  /**
   * research §6's abandonment check, run from the in-flight download's own
   * progress callback.
   *
   * The pin suppression here is the concrete half of `setQuality`'s contract: a
   * pinned player still *computes* the decision (the estimator and the projection
   * both run, so telemetry is unaffected) and simply does not act on it, because
   * abandoning a segment to restart it lower is exactly the silent override a pin
   * exists to forbid.
   */
  function considerAbandoning(track: Track, inFlight: InFlight, at: number): void {
    if (track.kind !== "video" || track.inFlight !== inFlight) return;

    const decision = shouldAbandon({
      ladder: track.ladder,
      currentRenditionId: inFlight.renditionId,
      bytesReceived: inFlight.bytesReceived,
      expectedTotalBytes: inFlight.expectedTotalBytes,
      elapsedMs: dependencies.now() - inFlight.startedAtMs,
      bufferSeconds: track.controller.bufferedAhead(at),
      segmentDurationSeconds: segmentDurationOf(track),
      config: abrConfig,
    });
    if (!decision.abandon || pinnedQualityId !== null) return;

    // research §6: "use the partial sample, don't discard it". Feeding it to the
    // estimator is not an extra — it is what makes the abandonment stick. The
    // rung we restart at is chosen from the observed rate, but the very next
    // `selectRendition` call is made from the *estimator*, which without this
    // still holds only the fast samples from before the collapse and climbs
    // straight back onto the rendition we just gave up on. The bytes really did
    // arrive over that time; there is nothing partial about the measurement.
    throughput.onSegmentDownloaded(
      inFlight.bytesReceived,
      dependencies.now() - inFlight.startedAtMs,
    );

    inFlight.abort.abort();
    track.inFlight = null;
    track.currentRenditionId = decision.restart.id;
    track.forcedRenditionId = decision.restart.id;
    // The same segment index will be re-selected by `nextSegmentIndex` on the
    // next tick, because nothing was appended and `buffered` did not move.
  }

  async function evictIfNeeded(at: number): Promise<void> {
    for (const track of tracks) {
      if (track.controller.bufferedAhead(at) <= 0) continue;
      await track.controller.evictBackBuffer(at);
    }
  }

  function maybeEndOfStream(): void {
    if (endOfStreamCalled || mediaSource === null) return;
    if (tracks.length === 0 || !tracks.every((track) => track.complete)) return;
    if (mediaSource.readyState !== "open") return;
    try {
      mediaSource.endOfStream();
      endOfStreamCalled = true;
      // research §1: this is what fixes `duration` and the seekable range to the
      // true content extent, which is what lets Shorts loop at exactly the right
      // point rather than when the browser gives up waiting for more data.
    } catch {
      /* A buffer was still updating; the next tick will try again. */
    }
  }

  /* ------------------------------------------------------------ controls -- */

  function setQuality(id: string | "auto"): void {
    const next = id === "auto" ? null : id;
    if (next === pinnedQualityId) return;
    pinnedQualityId = next;

    if (videoTrack === null || next === null) {
      emit();
      return;
    }
    // research §7: a pin that is already what we are fetching is a no-op — no
    // changeType, no init re-append, no rebuffer.
    if (videoTrack.currentRenditionId === next) {
      emit();
      return;
    }

    videoTrack.inFlight?.abort.abort();
    videoTrack.inFlight = null;
    videoTrack.currentRenditionId = next;
    // Discard the forward buffer at the old quality so the pick is visible within
    // a segment or two rather than after the whole 24s window drains. A guard of
    // one segment keeps the currently-decoding data intact.
    void videoTrack.controller.removeForward(media.currentTime + FAST_SWITCH_GUARD_SECONDS);
    emit();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;

    for (const [type, listener] of elementListeners) media.removeEventListener(type, listener);
    elementListeners.length = 0;

    for (const track of tracks) {
      track.inFlight?.abort.abort();
      track.controller.destroy();
    }
    tracks = [];
    videoTrack = null;

    // research §10's teardown list, which matters most in a Shorts feed where
    // dozens of these are constructed: detach the element, revoke the blob URL,
    // and drop every reference so the MediaSource is collectable. `endOfStream()`
    // is deliberately *not* called — it signals a clean finish, not an
    // abandonment.
    media.removeAttribute("src");
    media.srcObject = null;
    if (objectUrl !== null) {
      dependencies.revokeObjectUrl(objectUrl);
      objectUrl = null;
    }
    try {
      media.load();
    } catch {
      /* jsdom and some embedded webviews do not implement load(). */
    }
    mediaSource = null;
    listeners.clear();
  }

  const engine: PlayerEngine = {
    get state() {
      return cached;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(cached);
      return () => listeners.delete(listener);
    },
    load,
    setQuality,
    tick,
    destroy,
  };

  cached = snapshot();
  return engine;
}

const EMPTY_STATE: Omit<EngineState, "metrics"> = {
  mode: "media-source",
  phase: "idle",
  qualities: [],
  activeQualityId: null,
  fetchingQualityId: null,
  pinnedQualityId: null,
  bufferedAheadSeconds: 0,
  throughputBps: null,
  error: null,
};

export { EMPTY_METRICS };
