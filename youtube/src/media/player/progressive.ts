/**
 * The progressive path: a plain `<video src>` over HTTP `Range`.
 *
 * This is not a degraded version of the MSE engine, and it is not a stub. It is
 * the second of the two structurally different playback paths this application
 * has (`DECISIONS.md` D3): roughly one browser in twenty cannot encode in the
 * page, its uploads store the source file untouched, and `videos.pipeline` is
 * `'progressive'` for them. The same path is also the last resort of research
 * §9's detection order, for an engine with neither `MediaSource` nor
 * `ManagedMediaSource` nor native HLS.
 *
 * **What playback looks like here is: the browser does all of it.** One
 * continuous `faststart` file per rendition, fetched by the element's own network
 * stack over byte ranges, decoded by its own pipeline, buffered by its own
 * heuristics. There is no `SourceBuffer` to append to, no `remove()` to evict
 * with, no segment boundary to switch at and no throughput sample to estimate
 * from. Research §9 is blunt that this is a compatibility floor rather than a
 * target experience, and the honest way to implement it is to add nothing that
 * pretends otherwise.
 *
 * So what is actually here:
 *
 *  - The same `PlayerEngine` interface the MSE engine presents, so the controls
 *    slice above has one contract rather than two. The methods that cannot mean
 *    anything on this path say so rather than faking a result.
 *  - The subset of research §8's metrics that element events can still support —
 *    startup, rebuffer count and duration, watch time. The ones that need our own
 *    fetch loop (throughput, switch counts under Auto, quota events) are absent
 *    rather than reported as zero, because a zero here would read as "measured
 *    and fine".
 *  - Quality switching by full `src` swap, which research §9 names as the only
 *    switching available: it reloads and reconnects and briefly breaks
 *    continuity, so `currentTime` and the play/pause state are carried across by
 *    hand.
 *
 * **What it depends on from the server, and does not verify:** research §9's
 * range-request contract — `Accept-Ranges: bytes`, `206` with a correct
 * `Content-Range`, `416` on an unsatisfiable range, and `Content-Type: video/mp4`.
 * Get any of those wrong and Safari simply refuses to play with no error anyone
 * can see. That contract is `src/lib/http/range.ts` and the media route's to
 * keep; this file cannot observe it.
 */

import {
  EMPTY_METRICS,
  MetricsRecorder,
  type EngineState,
  type MediaElementLike,
  type PlaybackMetrics,
  type PlayerEngine,
  type PlayerPhase,
  type QualityOption,
} from "./engine";
import { bufferedAhead, toRanges, type TimeRangesLike } from "./buffer-controller";

/**
 * The element surface this path needs, which is the MSE engine's plus
 * `buffered`.
 *
 * The laddered engine deliberately never reads `video.buffered`: it reads each
 * `SourceBuffer`'s own, because with separate audio and video buffers the
 * element's view is a union that can report runway the video track does not
 * have. Here there are no source buffers and the element's view is the only one
 * there is, so the two interfaces genuinely differ and are kept apart rather than
 * widened to the larger of the two.
 */
export interface ProgressiveMediaElement extends MediaElementLike {
  readonly buffered: TimeRangesLike;
}

export interface ProgressiveSource {
  /** Stable identifier; the blob key is a good one. */
  readonly id: string;
  readonly url: string;
  /** What the quality menu shows. `Original` for a single-rendition upload. */
  readonly name: string;
  readonly width?: number;
  readonly height?: number;
  /**
   * Bits per second, if known. Used only to weight the mean-bitrate metric — no
   * decision on this path consults it, because there is no decision on this path.
   */
  readonly bitrate?: number;
}

export interface ProgressivePlayerOptions {
  readonly media: ProgressiveMediaElement;
  /**
   * Usually exactly one: `DECISIONS.md` D3 stores the uploader's source file
   * untouched as a single rendition. More than one is research §9's "one file per
   * rendition" shape, and enables the `src`-swap switch below.
   */
  readonly sources: readonly ProgressiveSource[];
  readonly initialSourceId?: string;
  readonly now?: () => number;
}

/**
 * How much runway counts as "buffered enough to be playing".
 *
 * Only used to distinguish the `buffering` phase from `playing` for the UI. It
 * is not a fetch target — nothing here fetches — so it is deliberately small and
 * has none of `BUFFER_TARGETS`' significance.
 */
const PLAYABLE_RUNWAY_SECONDS = 0.5;

export function createProgressivePlayer(options: ProgressivePlayerOptions): PlayerEngine {
  const { media } = options;
  const now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const metrics = new MetricsRecorder(now);
  const listeners = new Set<(state: EngineState) => void>();
  const elementListeners: [string, () => void][] = [];

  const sources = options.sources;
  const requested =
    sources.find((source) => source.id === options.initialSourceId) ?? sources[0];
  if (requested === undefined) {
    throw new Error("A progressive player needs at least one source");
  }
  // Re-bound through an annotated const: the narrowing above does not follow the
  // original binding into the closures below, and `first!` at every use would be
  // a worse way to say the same thing.
  const first: ProgressiveSource = requested;

  const qualities: readonly QualityOption[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    width: source.width,
    height: source.height,
    bitrate: source.bitrate ?? 0,
    codecs: [],
  }));

  let activeId = first.id;
  let phase: PlayerPhase = "idle";
  let error: Error | null = null;
  let destroyed = false;
  let loaded = false;

  function activeSource(): ProgressiveSource {
    return sources.find((source) => source.id === activeId) ?? first;
  }

  function bufferedAheadSeconds(): number {
    return bufferedAhead(toRanges(media.buffered), media.currentTime);
  }

  function snapshot(): EngineState {
    const measured: PlaybackMetrics = metrics.snapshot();
    return {
      mode: "progressive",
      phase,
      qualities,
      // On this path the fetched and rendered qualities cannot diverge: there is
      // one file and the browser is playing it. Both fields carry the same id
      // rather than one of them being null, so the quality menu's live readout
      // works identically on both paths.
      activeQualityId: activeId,
      fetchingQualityId: activeId,
      // A manual pick here is not a pin over an ABR selector — there is no
      // selector to override. It is simply which file is loaded, so `pinned`
      // reports the same id and "Auto" is never a meaningful option.
      pinnedQualityId: sources.length > 1 ? activeId : null,
      bufferedAheadSeconds: bufferedAheadSeconds(),
      // Null, not zero. There is no throughput estimator on this path and a zero
      // would read as a measured collapse.
      throughputBps: null,
      error,
      metrics: measured,
    };
  }

  let cached: EngineState = { ...snapshotShell(), metrics: EMPTY_METRICS };

  function snapshotShell(): Omit<EngineState, "metrics"> {
    return {
      mode: "progressive",
      phase,
      qualities,
      activeQualityId: activeId,
      fetchingQualityId: activeId,
      pinnedQualityId: sources.length > 1 ? activeId : null,
      bufferedAheadSeconds: 0,
      throughputBps: null,
      error,
    };
  }

  function emit(): void {
    cached = snapshot();
    for (const listener of listeners) listener(cached);
  }

  function on(type: string, listener: () => void): void {
    media.addEventListener(type, listener);
    elementListeners.push([type, listener]);
  }

  function install(): void {
    on("loadedmetadata", () => {
      metrics.markManifestReady();
      phase = "buffering";
      emit();
    });
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
      metrics.onSeekStarted();
    });
    on("ended", () => {
      phase = "ended";
      emit();
    });
    on("error", () => {
      // The element's own `error` is all we get. There is no fallback below this
      // path, so it is terminal rather than a reason to try something else.
      error = new Error(
        `The media element failed to play ${activeSource().url}. On this path the ` +
          "usual cause is the server's range-request handling rather than the file: " +
          "research/03 §9 requires Accept-Ranges, a 206 with a correct Content-Range, " +
          "and Content-Type: video/mp4.",
      );
      phase = "error";
      emit();
    });
    on("timeupdate", () => {
      if (media.currentTime > 0) metrics.markFirstFrame();
      metrics.onPlayheadAdvanced(media.currentTime, activeSource().bitrate ?? null);
      if (phase === "buffering" && bufferedAheadSeconds() > PLAYABLE_RUNWAY_SECONDS) {
        phase = media.paused ? "buffering" : "playing";
      }
      // The MSE engine republishes state from its 200ms fetch loop. There is no
      // fetch loop here, so `timeupdate` is the only thing that ever advances
      // watch time, buffered runway or the mean-bitrate weighting — and without
      // this emit a subscriber's metrics would freeze at whatever the last
      // `waiting`/`playing` left behind. `timeupdate` fires about four times a
      // second, which is the same order as the loop it stands in for.
      emit();
    });
    media.requestVideoFrameCallback?.(() => metrics.markFirstFrame());
  }

  async function load(): Promise<void> {
    if (destroyed || loaded) return;
    loaded = true;
    metrics.markLoadStart();
    phase = "loading";
    install();

    // `metadata`, not `auto`: the browser will fetch the whole file on `auto`
    // before the viewer has asked for anything, which on this path is the entire
    // rendition rather than a segment. The `moov`-at-front layout research §9
    // requires is what makes `metadata` enough to render a duration and a first
    // frame.
    media.preload = "metadata";
    media.src = activeSource().url;
    emit();
  }

  /**
   * Switch renditions by reloading the element.
   *
   * Research §9: a full `src` swap "reloads/reconnects and briefly breaks
   * continuity" and is the only switching available here — there is no
   * `changeType`, no init segment and no segment boundary to switch at. What this
   * function can do is make the discontinuity as small as possible by carrying
   * the playhead and the play/pause state across it by hand, which the element
   * does not do for us.
   *
   * `"auto"` is accepted and ignored. On this path Auto is not a mode the player
   * can enter, and throwing would make the shared `PlayerEngine` contract harder
   * to use for a caller that just forwards whatever the menu selected.
   */
  function setQuality(id: string | "auto"): void {
    if (destroyed || id === "auto" || id === activeId) return;
    const next = sources.find((source) => source.id === id);
    if (next === undefined) return;

    const resumeAt = media.currentTime;
    const wasPlaying = !media.paused;
    activeId = next.id;

    const onLoadedMetadata = (): void => {
      media.removeEventListener("loadedmetadata", onLoadedMetadata);
      // Assigning `currentTime` before metadata has arrived is ignored by every
      // engine, which is exactly how a quality switch silently restarts a video
      // from zero.
      media.currentTime = resumeAt;
      if (!wasPlaying) return;
      // research §10: always handle the rejection branch. A swap is not a fresh
      // user gesture, so an unmuted resume can be refused with `NotAllowedError`
      // — and leaving the UI looking live when it is paused is worse than the
      // pause itself.
      void media.play().catch(() => {
        phase = "buffering";
        emit();
      });
    };
    media.addEventListener("loadedmetadata", onLoadedMetadata);
    elementListeners.push(["loadedmetadata", onLoadedMetadata]);

    media.src = next.url;
    media.load();
    phase = "buffering";
    emit();
  }

  /**
   * A no-op that exists so both paths satisfy one interface.
   *
   * There is no fetch loop to advance here. It still emits, so a caller that
   * polls for a fresh buffered-ahead reading gets one — which is the only reason
   * a UI would call it on this path.
   */
  async function tick(): Promise<void> {
    if (destroyed) return;
    emit();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    for (const [type, listener] of elementListeners) media.removeEventListener(type, listener);
    elementListeners.length = 0;

    // Removing the attribute and calling `load()` is what actually stops the
    // download; setting `src = ""` re-resolves against the document URL and has
    // the element fetching the page itself.
    media.removeAttribute("src");
    try {
      media.load();
    } catch {
      /* jsdom and some embedded webviews do not implement load(). */
    }
    listeners.clear();
  }

  return {
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
}
