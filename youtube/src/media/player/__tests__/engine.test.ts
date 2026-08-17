// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubMediaCapabilities } from "../../../../vitest.setup";
import { buildLadderMaster, buildMediaPlaylist } from "../../packager";
import type { LadderRung } from "../../types";
import {
  rangeContaining,
  type AppendableBuffer,
  type BufferedRange,
  type SourceBufferLike,
  type TimeRangesLike,
} from "../buffer-controller";
import {
  MetricsRecorder,
  SOURCE_OPEN_TIMEOUT_MS,
  createLadderedEngine,
  detectPlaybackMode,
  isVideoCodec,
  mimeTypeFor,
  nextSegmentIndex,
  probeCapabilities,
  type CapabilityProbe,
  type MediaSourceConstructorLike,
  type MediaSourceLike,
  type PlayerEngine,
} from "../engine";
import { createPlayer } from "../index";
import { parseMediaPlaylist } from "../playlist";
import { createProgressivePlayer, type ProgressiveMediaElement } from "../progressive";

/**
 * The engine is the one module here that cannot be a pure function, so the tests
 * are organised around isolating the parts of it that can be.
 *
 * `detectPlaybackMode` and `nextSegmentIndex` are pure and get tables.
 * `MetricsRecorder` takes a clock and gets literals. Only the orchestration
 * itself needs a harness, and the harness is deliberately shallow: fake element,
 * fake `MediaSource`, fake origin, injected clock, and `tick()` driven by hand so
 * there are no timers and nothing to flake.
 *
 * **What none of this proves.** A fake `MediaSource` accepts every byte we hand
 * it, so these tests say nothing about whether a real decoder would; they say
 * nothing about whether `sourceopen` fires on real Safari, which is the one
 * finding this engine is most shaped by; and they say nothing about frame timing,
 * `readyState` transitions or AirPlay. Those are Playwright's, and the report on
 * this slice says so.
 */

/* ================================================================= fakes == */

class FakeTimeRanges implements TimeRangesLike {
  constructor(private ranges: readonly BufferedRange[] = []) {}
  set(ranges: readonly BufferedRange[]): void {
    this.ranges = ranges;
  }
  get length(): number {
    return this.ranges.length;
  }
  start(index: number): number {
    return this.ranges[index]?.start ?? 0;
  }
  end(index: number): number {
    return this.ranges[index]?.end ?? 0;
  }
}

class FakeSourceBuffer implements SourceBufferLike {
  updating = false;
  readonly appends: number[] = [];
  /** FIFO of what each append adds to `buffered`; `null` for an init segment. */
  readonly pendingRanges: (BufferedRange | null)[] = [];
  ranges: BufferedRange[] = [];

  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(readonly mimeType: string) {}

  get buffered(): TimeRangesLike {
    return new FakeTimeRanges(this.ranges);
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  private fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  private settle(): void {
    this.updating = true;
    queueMicrotask(() => {
      this.updating = false;
      this.fire("updateend");
    });
  }

  appendBuffer(data: AppendableBuffer): void {
    if (this.updating) throw new Error("appendBuffer while updating");
    this.appends.push(data.byteLength);
    const added = this.pendingRanges.shift();
    if (added !== undefined && added !== null) this.merge(added);
    this.settle();
  }
  remove(start: number, end: number): void {
    if (this.updating) throw new Error("remove while updating");
    this.ranges = this.ranges
      .flatMap((range): BufferedRange[] => {
        if (end <= range.start || start >= range.end) return [range];
        const kept: BufferedRange[] = [];
        if (range.start < start) kept.push({ start: range.start, end: start });
        if (range.end > end) kept.push({ start: end, end: range.end });
        return kept;
      })
      .filter((range) => range.end > range.start);
    this.settle();
  }
  abort(): void {
    this.updating = false;
  }
  changeType(): void {
    if (this.updating) throw new Error("changeType while updating");
    this.settle();
  }

  private merge(added: BufferedRange): void {
    const all = [...this.ranges, added].sort((a, b) => a.start - b.start);
    const merged: BufferedRange[] = [];
    for (const range of all) {
      const last = merged[merged.length - 1];
      if (last !== undefined && range.start <= last.end + 1e-6) {
        merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      } else merged.push({ ...range });
    }
    this.ranges = merged;
  }
}

/** Set by the fake constructor so a test can reach the instance the engine built. */
let lastMediaSource: FakeMediaSource | null = null;
let autoOpen = true;

class FakeMediaSource implements MediaSourceLike {
  readyState = "closed";
  duration = Number.NaN;
  streaming: boolean | undefined = undefined;
  endOfStreamCalls = 0;
  readonly buffers: FakeSourceBuffer[] = [];
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeMediaSource.register(this);
    if (autoOpen) queueMicrotask(() => this.open());
  }

  /** Publishes the instance the engine just built, so a test can reach it. */
  private static register(instance: FakeMediaSource): void {
    lastMediaSource = instance;
  }

  static isTypeSupported(): boolean {
    return true;
  }

  open(): void {
    this.readyState = "open";
    for (const listener of [...(this.listeners.get("sourceopen") ?? [])]) listener();
  }
  addSourceBuffer(type: string): SourceBufferLike {
    const buffer = new FakeSourceBuffer(type);
    this.buffers.push(buffer);
    return buffer;
  }
  endOfStream(): void {
    this.endOfStreamCalls += 1;
    this.readyState = "ended";
  }
  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

class FakeMediaElement implements ProgressiveMediaElement {
  currentTime = 0;
  paused = true;
  seeking = false;
  duration = Number.NaN;
  preload = "";
  bufferedRanges = new FakeTimeRanges();
  /** Every mutation the engine makes, in order. Attach ordering is asserted from it. */
  readonly log: string[] = [];
  canPlayTypes: Record<string, string> = {};

  private readonly listeners = new Map<string, Set<() => void>>();
  private innerSrc = "";
  private innerSrcObject: unknown = null;
  private innerDisableRemotePlayback = false;

  get buffered(): TimeRangesLike {
    return this.bufferedRanges;
  }
  get src(): string {
    return this.innerSrc;
  }
  set src(value: string) {
    this.log.push(`src=${value}`);
    this.innerSrc = value;
  }
  get srcObject(): unknown {
    return this.innerSrcObject;
  }
  set srcObject(value: unknown) {
    this.log.push(value === null ? "srcObject=null" : "srcObject=MediaSource");
    this.innerSrcObject = value;
  }
  get disableRemotePlayback(): boolean {
    return this.innerDisableRemotePlayback;
  }
  set disableRemotePlayback(value: boolean) {
    this.log.push(`disableRemotePlayback=${value}`);
    this.innerDisableRemotePlayback = value;
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
  removeAttribute(name: string): void {
    this.log.push(`removeAttribute:${name}`);
    if (name === "src") this.innerSrc = "";
  }
  load(): void {
    this.log.push("load");
  }
  play(): Promise<void> {
    this.log.push("play");
    this.paused = false;
    return Promise.resolve();
  }
  canPlayType(type: string): string {
    return this.canPlayTypes[type] ?? "";
  }
}

/* ================================================== the fake media origin == */

const LADDER: readonly LadderRung[] = [
  { name: "240p", width: 426, height: 240, bitrate: 400_000, codec: "avc1.640015" },
  { name: "720p", width: 1280, height: 720, bitrate: 2_800_000, codec: "avc1.64001f" },
  { name: "1080p", width: 1920, height: 1080, bitrate: 5_000_000, codec: "avc1.640028" },
];

const MASTER_URL = "/media/v1/master.m3u8";
const SEGMENT_SECONDS = 2;
const SEGMENT_COUNT = 60; // 120 seconds, enough to seek a long way into a gap

interface Origin {
  readonly text: Map<string, string>;
  readonly binary: Map<string, Uint8Array>;
  /** Segment URL → the media range appending it produces. `null` for init segments. */
  readonly rangeFor: Map<string, BufferedRange | null>;
}

function buildOrigin(options: { audio?: boolean } = {}): Origin {
  const text = new Map<string, string>();
  const binary = new Map<string, Uint8Array>();
  const rangeFor = new Map<string, BufferedRange | null>();

  text.set(
    MASTER_URL,
    buildLadderMaster({
      variants: LADDER.map((rung) => ({
        rung,
        uri: `${rung.name}/index.m3u8`,
        frameRate: 30,
        bandwidth: rung.bitrate,
      })),
      audio: options.audio
        ? {
            groupId: "aac",
            name: "English",
            uri: "audio/index.m3u8",
            codec: "mp4a.40.2",
            channels: "2",
            bitrate: 128_000,
          }
        : undefined,
    }),
  );

  const addRendition = (folder: string, bytesPerSegment: number): void => {
    const playlistUrl = `/media/v1/${folder}/index.m3u8`;
    const segments = Array.from({ length: SEGMENT_COUNT }, (_, index) => ({
      uri: `seg-${String(index).padStart(5, "0")}.m4s`,
      durationSeconds: SEGMENT_SECONDS,
    }));
    text.set(
      playlistUrl,
      buildMediaPlaylist({ segments, initSegmentUri: "init.mp4", playlistType: "VOD" }),
    );

    binary.set(`/media/v1/${folder}/init.mp4`, new Uint8Array(700));
    rangeFor.set(`/media/v1/${folder}/init.mp4`, null);
    for (let index = 0; index < SEGMENT_COUNT; index += 1) {
      const url = `/media/v1/${folder}/seg-${String(index).padStart(5, "0")}.m4s`;
      binary.set(url, new Uint8Array(bytesPerSegment));
      rangeFor.set(url, {
        start: index * SEGMENT_SECONDS,
        end: (index + 1) * SEGMENT_SECONDS,
      });
    }
  };

  for (const rung of LADDER) {
    addRendition(rung.name, (rung.bitrate * SEGMENT_SECONDS) / 8);
  }
  if (options.audio) addRendition("audio", 32_000);

  return { text, binary, rangeFor };
}

interface EngineHarness {
  readonly engine: PlayerEngine;
  readonly media: FakeMediaElement;
  readonly origin: Origin;
  /** Every segment/init URL fetched, in order. */
  readonly fetched: string[];
  readonly source: () => FakeMediaSource;
  readonly videoBuffer: () => FakeSourceBuffer;
  advanceClock(ms: number): void;
  /**
   * The simulated connection, in bits per second. A fetch advances the clock by
   * how long its bytes would really take — a flat per-fetch delay would make a
   * 1.25 MB segment and a 700-byte init segment measure the same throughput, and
   * the ABR estimate would be an artefact of the harness rather than of the
   * ladder.
   */
  bandwidthBps: number;
  /**
   * Deliver media segments in chunks instead of at once, advancing the clock
   * between them. This is what makes the abandonment path reachable: the check
   * runs from the fetch's own progress callback, so it needs a response that
   * reports progress more than once.
   */
  slowSegment: { readonly chunks: number; readonly msPerChunk: number } | null;
}

function engineHarness(
  options: { audio?: boolean; abr?: Parameters<typeof createLadderedEngine>[0]["abr"] } = {},
): EngineHarness {
  const origin = buildOrigin({ audio: options.audio });
  const media = new FakeMediaElement();
  const fetched: string[] = [];
  let clock = 0;

  const harness: EngineHarness = {
    engine: createLadderedEngine({
      media,
      masterPlaylistUrl: MASTER_URL,
      abr: options.abr,
      // Long enough that the real interval never fires inside a test. Every tick
      // in this file is driven by hand.
      tickIntervalMs: 60_000,
      dependencies: {
        now: () => clock,
        fetchText: async (url) => {
          const body = origin.text.get(url);
          if (body === undefined) throw new Error(`No playlist at ${url}`);
          return body;
        },
        fetchSegment: async ({ url, signal, onProgress }) => {
          const body = origin.binary.get(url);
          if (body === undefined) throw new Error(`No segment at ${url}`);
          fetched.push(url);

          const plan = harness.slowSegment;
          const aborted = (): Error =>
            Object.assign(new Error(`Aborted ${url}`), { name: "AbortError" });

          if (plan !== null && url.endsWith(".m4s")) {
            for (let chunk = 1; chunk <= plan.chunks; chunk += 1) {
              clock += plan.msPerChunk;
              if (signal.aborted) throw aborted();
              onProgress?.(Math.round((body.byteLength * chunk) / plan.chunks), body.byteLength);
              if (signal.aborted) throw aborted();
            }
          } else {
            clock += Math.max(1, Math.round((body.byteLength * 8000) / harness.bandwidthBps));
            onProgress?.(body.byteLength, body.byteLength);
          }

          // Tell the fake buffer what this append will produce, in the same
          // order the engine will append it. Init first, then media — which is
          // exactly the order research §3 requires on every switch.
          const range = origin.rangeFor.get(url) ?? null;
          const buffer = url.includes("/audio/")
            ? lastMediaSource?.buffers[1]
            : lastMediaSource?.buffers[0];
          buffer?.pendingRanges.push(range);
          return body;
        },
        createObjectUrl: () => "blob:fake",
        revokeObjectUrl: () => undefined,
      },
    }),
    media,
    origin,
    fetched,
    source: () => {
      if (lastMediaSource === null) throw new Error("No MediaSource was constructed");
      return lastMediaSource;
    },
    videoBuffer: () => {
      const buffer = lastMediaSource?.buffers[0];
      if (buffer === undefined) throw new Error("No video SourceBuffer was created");
      return buffer;
    },
    advanceClock: (ms) => {
      clock += ms;
    },
    bandwidthBps: 4_000_000,
    slowSegment: null,
  };
  return harness;
}

/**
 * Drain everything the engine started but did not hand back a promise for.
 *
 * The `seeking`/`seeked` handlers fire a tick and deliberately do not await it —
 * an event listener has nobody to return a promise to, and research §5 wants the
 * fetch decision recomputed *now* rather than at the next interval. A test that
 * dispatches an event and asserts immediately is racing that tick, so it waits
 * for the macrotask queue instead.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installFakeMediaSource(): () => void {
  lastMediaSource = null;
  autoOpen = true;
  return stubMediaCapabilities({ mediaSource: FakeMediaSource });
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  lastMediaSource = null;
  autoOpen = true;
  vi.useRealTimers();
});

/* =========================================================== detection === */

describe("detectPlaybackMode", () => {
  const constructor = FakeMediaSource as unknown as MediaSourceConstructorLike;
  const base: CapabilityProbe = {
    managedMediaSource: undefined,
    mediaSource: undefined,
    canPlayNativeHls: false,
    requiredTypes: ['video/mp4; codecs="avc1.640028"'],
  };

  it("prefers ManagedMediaSource, which is Safari 17.1+", () => {
    expect(
      detectPlaybackMode({ ...base, managedMediaSource: constructor, mediaSource: constructor }),
    ).toBe("managed-media-source");
  });

  it("puts native HLS above plain MediaSource, for iOS Safari before 17.1", () => {
    // The order matters because of who it catches: on that platform there is no
    // reliable MSE and no Managed Media Source at all, so Safari's own HLS engine
    // is the only adaptive path in existence (research §2). A desktop browser
    // supporting both has already matched the branch above.
    expect(
      detectPlaybackMode({ ...base, canPlayNativeHls: true, mediaSource: constructor }),
    ).toBe("native-hls");
  });

  it("uses plain MediaSource when nothing better is present", () => {
    expect(detectPlaybackMode({ ...base, mediaSource: constructor })).toBe("media-source");
  });

  it("falls through to progressive when MediaSource cannot play our codecs", () => {
    // research §1: Safari has no VP9 or Opus decoder at all. A MediaSource that
    // exists and cannot decode our bytes is not a playback path, and attaching to
    // it would fail after the manifest rather than before it.
    const refuses = { isTypeSupported: () => false } as unknown as MediaSourceConstructorLike;
    expect(detectPlaybackMode({ ...base, mediaSource: refuses })).toBe("progressive");
    expect(
      detectPlaybackMode({ ...base, managedMediaSource: refuses, canPlayNativeHls: false }),
    ).toBe("progressive");
  });

  it("treats a constructor whose isTypeSupported throws as unusable", () => {
    const hostile = {
      isTypeSupported: () => {
        throw new Error("nope");
      },
    } as unknown as MediaSourceConstructorLike;
    expect(detectPlaybackMode({ ...base, mediaSource: hostile })).toBe("progressive");
  });

  it("falls through to progressive on a platform with none of the three", () => {
    expect(detectPlaybackMode(base)).toBe("progressive");
  });

  it("reads the globals through stubMediaCapabilities, and finds nothing by default", () => {
    // jsdom leaves MediaSource undefined on purpose, and vitest.setup.ts says so:
    // the detection branches are themselves worth testing, so the capable branch
    // is opt-in rather than ambient.
    expect(probeCapabilities(undefined, []).mediaSource).toBeUndefined();

    const restore = stubMediaCapabilities({ mediaSource: FakeMediaSource });
    try {
      const probe = probeCapabilities(undefined, ['video/mp4; codecs="avc1.640028"']);
      expect(probe.mediaSource).toBeDefined();
      expect(detectPlaybackMode(probe)).toBe("media-source");
    } finally {
      restore();
    }
  });

  it("reads native HLS support off the element", () => {
    const media = new FakeMediaElement();
    expect(probeCapabilities(media, []).canPlayNativeHls).toBe(false);
    media.canPlayTypes["application/vnd.apple.mpegurl"] = "maybe";
    expect(probeCapabilities(media, []).canPlayNativeHls).toBe(true);
  });
});

describe("MIME strings", () => {
  it("routes each codec to the right kind of SourceBuffer", () => {
    expect(mimeTypeFor("avc1.640028")).toBe('video/mp4; codecs="avc1.640028"');
    expect(mimeTypeFor("vp09.00.40.08")).toBe('video/mp4; codecs="vp09.00.40.08"');
    expect(mimeTypeFor("av01.0.08M.08")).toBe('video/mp4; codecs="av01.0.08M.08"');
    // research §1: fMP4 for every codec, never WebM — one container across the
    // whole ladder, one buffer-controller path.
    expect(mimeTypeFor("opus")).toBe('audio/mp4; codecs="opus"');
    expect(mimeTypeFor("mp4a.40.2")).toBe('audio/mp4; codecs="mp4a.40.2"');
  });

  it("classifies codecs by their RFC 6381 prefix", () => {
    expect(isVideoCodec("avc1.640028")).toBe(true);
    expect(isVideoCodec("hvc1.1.6.L93.B0")).toBe(true);
    expect(isVideoCodec("mp4a.40.2")).toBe(false);
    expect(isVideoCodec("opus")).toBe(false);
  });
});

/* ===================================================== the seek fix ===== */

describe("nextSegmentIndex — the seek-into-a-gap fix", () => {
  const playlist = parseMediaPlaylist(
    buildMediaPlaylist({
      segments: Array.from({ length: 30 }, (_, index) => ({
        uri: `seg-${index}.m4s`,
        durationSeconds: 2,
      })),
      initSegmentUri: "init.mp4",
    }),
    "/media/v1/720p/index.m3u8",
  );

  it("continues from the end of the range the playhead is inside", () => {
    expect(nextSegmentIndex(playlist, [{ start: 0, end: 12 }], 4)).toBe(6);
  });

  it("starts at the PLAYHEAD after a seek into an unbuffered region", () => {
    // This is research §5's bug, and the reason the whole function exists. An
    // end-of-buffer-relative implementation returns 6 here — the segment after
    // the 12s range the viewer just seeked away from — so nothing ever fetches
    // the data under the playhead, the element sits at HAVE_METADATA, and there
    // is no error and often no `waiting` event to notice it by.
    expect(nextSegmentIndex(playlist, [{ start: 0, end: 12 }], 40)).toBe(20);
  });

  it("starts at the playhead after a seek BACKWARD into a hole", () => {
    expect(nextSegmentIndex(playlist, [{ start: 30, end: 50 }], 8)).toBe(4);
  });

  it("bridges from an earlier island when the playhead lands inside a later one", () => {
    expect(nextSegmentIndex(playlist, [{ start: 0, end: 10 }, { start: 30, end: 40 }], 32)).toBe(
      20,
    );
  });

  it("starts at zero on a cold start, with nothing buffered at all", () => {
    expect(nextSegmentIndex(playlist, [], 0)).toBe(0);
  });

  it("does not re-select a segment because a range end fell a microsecond short", () => {
    // Media-timescale rounding puts range ends fractionally below the boundary.
    // Without the epsilon the engine re-fetches the segment it just appended,
    // forever, at whatever rate the tick runs.
    expect(nextSegmentIndex(playlist, [{ start: 0, end: 11.9999 }], 4)).toBe(6);
  });

  it("answers null past the end of the asset, which is how the engine knows it is done", () => {
    expect(nextSegmentIndex(playlist, [{ start: 0, end: 60 }], 59)).toBeNull();
  });
});

/* ========================================================= metrics ====== */

describe("MetricsRecorder", () => {
  function recorder(): { readonly it: MetricsRecorder; tick(ms: number): void } {
    let clock = 0;
    const instance = new MetricsRecorder(() => clock);
    return {
      it: instance,
      tick(ms) {
        clock += ms;
      },
    };
  }

  it("breaks startup into the sub-phases research §8 asks for", () => {
    const r = recorder();
    r.it.markLoadStart();
    r.tick(120);
    r.it.markManifestReady();
    r.tick(80);
    r.it.markFirstSegmentAppended();
    r.tick(30);
    r.it.markFirstFrame();

    const metrics = r.it.snapshot();
    expect(metrics.manifestMs).toBe(120);
    expect(metrics.firstSegmentMs).toBe(80);
    expect(metrics.startupMs).toBe(230);
  });

  it("keeps the first first-frame signal, so rVFC wins over the timeupdate fallback", () => {
    const r = recorder();
    r.it.markLoadStart();
    r.tick(100);
    r.it.markFirstFrame();
    r.tick(500);
    r.it.markFirstFrame();
    expect(r.it.snapshot().startupMs).toBe(100);
  });

  it("counts a genuine stall as one rebuffer, with its duration", () => {
    const r = recorder();
    r.it.onWaiting({ seeking: false, paused: false });
    r.tick(1400);
    r.it.onResumed();

    const metrics = r.it.snapshot();
    expect(metrics.rebufferCount).toBe(1);
    expect(metrics.rebufferSeconds).toBeCloseTo(1.4, 6);
  });

  it("excludes seek latency and a deliberate pause", () => {
    // research §8 is explicit about both exclusions: neither is rebuffering in
    // the QoE sense, and counting them makes the metric useless for the thing it
    // exists to detect.
    const r = recorder();
    r.it.onWaiting({ seeking: true, paused: false });
    r.tick(2000);
    r.it.onResumed();
    r.it.onWaiting({ seeking: false, paused: true });
    r.tick(2000);
    r.it.onResumed();
    expect(r.it.snapshot().rebufferCount).toBe(0);
  });

  it("ignores a stall shorter than the 100ms threshold", () => {
    const r = recorder();
    r.it.onWaiting({ seeking: false, paused: false });
    r.tick(40);
    r.it.onResumed();
    expect(r.it.snapshot().rebufferCount).toBe(0);
  });

  it("cancels a pending wait when a seek starts instead", () => {
    const r = recorder();
    r.it.onWaiting({ seeking: false, paused: false });
    r.tick(50);
    r.it.onSeekStarted();
    r.tick(3000);
    r.it.onResumed();
    expect(r.it.snapshot().rebufferCount).toBe(0);
  });

  it("weights mean bitrate by time played, not by segment count", () => {
    // research §8: a naive mean over segments over-weights brief oscillation. Ten
    // seconds at 1 Mbps and one second at 5 Mbps is not a 3 Mbps experience.
    const r = recorder();
    for (let at = 0; at < 10; at += 0.5) r.it.onPlayheadAdvanced(at, 1_000_000);
    for (let at = 10; at < 11; at += 0.5) r.it.onPlayheadAdvanced(at, 5_000_000);

    const metrics = r.it.snapshot();
    expect(metrics.meanBitrateBps).toBeGreaterThan(1_000_000);
    expect(metrics.meanBitrateBps).toBeLessThan(1_500_000);
    expect(metrics.watchedSeconds).toBeCloseTo(10.5, 6);
  });

  it("does not count a scrub as watch time", () => {
    // Otherwise a viewer dragging to the end "watches" the whole video in a
    // second, and the rebuffer ratio's denominator becomes meaningless.
    const r = recorder();
    r.it.onPlayheadAdvanced(0, 1_000_000);
    r.it.onPlayheadAdvanced(0.5, 1_000_000);
    r.it.onPlayheadAdvanced(600, 1_000_000); // a scrub to ten minutes
    r.it.onPlayheadAdvanced(600.5, 1_000_000);
    expect(r.it.snapshot().watchedSeconds).toBeCloseTo(1, 6);
  });

  it("splits switches by direction and flags a fast reversal as oscillation", () => {
    const r = recorder();
    r.it.onPlayheadAdvanced(0, 1_000_000);
    r.it.onPlayheadAdvanced(0.5, 5_000_000); // up
    r.it.onPlayheadAdvanced(1.0, 1_000_000); // down, within two segments → a flap

    const metrics = r.it.snapshot();
    expect(metrics.upSwitches).toBe(1);
    expect(metrics.downSwitches).toBe(1);
    expect(metrics.oscillations).toBe(1);
  });

  it("does not call a reversal far apart in time an oscillation", () => {
    const r = recorder();
    r.it.onPlayheadAdvanced(0, 1_000_000);
    r.it.onPlayheadAdvanced(0.5, 5_000_000);
    for (let at = 1; at < 30; at += 0.5) r.it.onPlayheadAdvanced(at, 5_000_000);
    r.it.onPlayheadAdvanced(30, 1_000_000);
    expect(r.it.snapshot().oscillations).toBe(0);
  });

  it("reports the rebuffer ratio, which is the figure comparable across videos", () => {
    const r = recorder();
    for (let at = 0; at <= 20; at += 0.5) r.it.onPlayheadAdvanced(at, 1_000_000);
    r.it.onWaiting({ seeking: false, paused: false });
    r.tick(2000);
    r.it.onResumed();

    const metrics = r.it.snapshot();
    expect(metrics.rebufferRatio).toBeCloseTo(2 / 20, 3);
  });

  it("scores a rebuffered run below a clean one on the same quality", () => {
    // The QoE roll-up is a relative scalar for comparing two runs over one trace
    // — see QOE_REBUFFER_PENALTY for why it is not a published score.
    const clean = recorder();
    for (let at = 0; at <= 10; at += 0.5) clean.it.onPlayheadAdvanced(at, 5_000_000);

    const stalled = recorder();
    for (let at = 0; at <= 10; at += 0.5) stalled.it.onPlayheadAdvanced(at, 5_000_000);
    stalled.it.onWaiting({ seeking: false, paused: false });
    stalled.tick(3000);
    stalled.it.onResumed();

    expect(stalled.it.snapshot().qoe).toBeLessThan(clean.it.snapshot().qoe);
  });

  it("carries the dropped-frame ratio, which separates a decode stall from a network one", () => {
    const r = recorder();
    expect(r.it.snapshot().droppedFrameRatio).toBeNull();
    r.it.onFrameQuality({ droppedVideoFrames: 12, totalVideoFrames: 600 });
    expect(r.it.snapshot().droppedFrameRatio).toBeCloseTo(0.02, 6);
    // A zero-frame reading is no reading at all, not a ratio of zero.
    r.it.onFrameQuality({ droppedVideoFrames: 0, totalVideoFrames: 0 });
    expect(r.it.snapshot().droppedFrameRatio).toBeCloseTo(0.02, 6);
  });
});

/* ======================================================= the MSE engine == */

describe("the laddered engine", () => {
  it("gates AirPlay off BEFORE attaching, which is what makes Safari open at all", async () => {
    // research §2 / DECISIONS.md D10. A ManagedMediaSource never fires
    // `sourceopen` unless `disableRemotePlayback` is set or an AirPlay-eligible
    // <source> sibling exists — undocumented, and it presents as a player that
    // attaches, reports no error and never buffers. The ordering is the
    // assertion: setting the flag after the attach is the same bug.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();

    const gated = h.media.log.indexOf("disableRemotePlayback=true");
    const attached = h.media.log.findIndex((entry) => entry.startsWith("src=blob:"));
    expect(gated).toBeGreaterThanOrEqual(0);
    expect(attached).toBeGreaterThan(gated);
  });

  it("turns a source that never opens into an error naming the cause", async () => {
    cleanups.push(installFakeMediaSource());
    autoOpen = false;
    vi.useFakeTimers();

    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    const loading = h.engine.load();
    await vi.advanceTimersByTimeAsync(SOURCE_OPEN_TIMEOUT_MS + 1);
    await loading;

    expect(h.engine.state.phase).toBe("error");
    expect(h.engine.state.error?.message).toMatch(/disableRemotePlayback/);
  });

  it("reads the ladder into a quality menu, high rungs and all", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();

    expect(h.engine.state.qualities.map((quality) => quality.name)).toEqual([
      "240p",
      "720p",
      "1080p",
    ]);
    expect(h.engine.state.qualities.map((quality) => quality.bitrate)).toEqual([
      400_000, 2_800_000, 5_000_000,
    ]);
  });

  it("probes at the lowest rung, and appends the init segment before the media segment", async () => {
    // research §6's startup: fetch the bottom rung specifically to measure, not
    // because we think it is right. research §3: the init segment carries the
    // decoder configuration and must precede any media in that configuration.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();

    expect(h.fetched).toEqual([
      "/media/v1/240p/init.mp4",
      "/media/v1/240p/seg-00000.m4s",
    ]);
    expect(h.videoBuffer().appends).toEqual([700, 100_000]);
    expect(h.engine.state.metrics.firstSegmentMs).not.toBeNull();
  });

  it("does not re-append the init segment while the rendition is unchanged", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();
    await h.engine.tick();
    await h.engine.tick();

    expect(h.fetched.filter((url) => url.endsWith("init.mp4"))).toHaveLength(1);
    expect(h.fetched.filter((url) => url.endsWith(".m4s"))).toHaveLength(3);
  });

  it("climbs the ladder once real throughput has been measured", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    // 30 Mbps: comfortably above the 5 Mbps rung even after the 0.6 up-safety
    // factor demands ~1.67x headroom.
    h.bandwidthBps = 30_000_000;
    await h.engine.load();
    for (let i = 0; i < 6; i += 1) await h.engine.tick();

    expect(h.engine.state.throughputBps).toBeGreaterThan(10_000_000);
    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/1080p/index.m3u8");
    // A switch means a new init segment, always (research §3).
    expect(h.fetched.filter((url) => url.endsWith("init.mp4")).length).toBeGreaterThan(1);
  });

  it("stays at the bottom on a connection that cannot carry anything better", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    // 200 kbps — under even the 400 kbps rung once the safety factor applies.
    h.bandwidthBps = 200_000;
    await h.engine.load();
    for (let i = 0; i < 6; i += 1) await h.engine.tick();

    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/240p/index.m3u8");
    expect(h.fetched.filter((url) => url.endsWith("init.mp4"))).toHaveLength(1);
  });

  it("fetches the segment under the playhead after a seek into an unbuffered region", async () => {
    // The end-to-end version of the `nextSegmentIndex` test above, and the
    // regression test research §5 asks for: an end-of-buffer-relative fetch loop
    // fetches segment 4 here and the player never recovers.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();
    await h.engine.tick();
    await h.engine.tick();
    expect(h.videoBuffer().ranges).toEqual([{ start: 0, end: 6 }]);

    h.fetched.length = 0;
    h.media.currentTime = 80;
    h.media.dispatch("seeked");
    await flush();

    expect(h.fetched).toEqual(["/media/v1/240p/seg-00040.m4s"]);
    // …and the island the viewer seeked away from is gone: at a playhead of 80s
    // it sits 74 seconds behind, far outside the 15s back-buffer target, so the
    // same tick's proactive eviction correctly reclaims it.
    expect(h.videoBuffer().ranges).toEqual([{ start: 80, end: 82 }]);
  });

  it("keeps fetching forward from the seek target rather than snapping back", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();

    h.media.currentTime = 80;
    h.media.dispatch("seeked");
    await flush();
    h.fetched.length = 0;
    for (let i = 0; i < 2; i += 1) await h.engine.tick();

    expect(h.fetched).toEqual([
      "/media/v1/240p/seg-00041.m4s",
      "/media/v1/240p/seg-00042.m4s",
    ]);
  });

  it("stops fetching once the forward target is met, and resumes as the playhead moves", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();
    for (let i = 0; i < 20; i += 1) await h.engine.tick();

    // Twelve 2s segments is the 24s forward target; the exact count depends on
    // when startup hands over to steady state, so assert the invariant instead.
    const buffered = h.engine.state.bufferedAheadSeconds;
    expect(buffered).toBeGreaterThanOrEqual(24);
    expect(buffered).toBeLessThan(28);

    const before = h.fetched.length;
    await h.engine.tick();
    expect(h.fetched).toHaveLength(before);

    h.media.currentTime = 10;
    await h.engine.tick();
    expect(h.fetched.length).toBeGreaterThan(before);
  });

  it("reports the rendition being RENDERED, not the one being fetched", async () => {
    // research §7: the quality menu's "Auto (1080p)" is a live readout of what is
    // on screen. With 24 seconds of forward buffer the fetched rung routinely
    // leads the rendered one by a dozen segments, and showing the fetch decision
    // would name a quality the viewer will not see for half a minute.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    h.bandwidthBps = 30_000_000;
    await h.engine.load();
    for (let i = 0; i < 8; i += 1) await h.engine.tick();

    h.media.currentTime = 1; // still inside segment 0, fetched at the bottom rung
    await h.engine.tick();
    expect(h.engine.state.activeQualityId).toBe("/media/v1/240p/index.m3u8");
    expect(h.engine.state.fetchingQualityId).not.toBe("/media/v1/240p/index.m3u8");
  });

  it("creates a separate SourceBuffer for audio and fetches its shared playlist once", async () => {
    // research §1: separate audio and video buffers rather than muxed segments,
    // so the two ride independent targets — and our packager emits one audio
    // rendition shared across every video rung, so it is fetched once no matter
    // how the video ladder moves.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness({ audio: true });
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();

    expect(h.source().buffers.map((buffer) => buffer.mimeType)).toEqual([
      'video/mp4; codecs="avc1.640015"',
      'audio/mp4; codecs="mp4a.40.2"',
    ]);
    expect(h.fetched).toContain("/media/v1/audio/init.mp4");
    expect(h.fetched).toContain("/media/v1/audio/seg-00000.m4s");
  });

  it("calls endOfStream exactly once when every track has run out", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();

    // Fast-forward: pretend everything is buffered and the playhead is at the end.
    h.videoBuffer().ranges = [{ start: 0, end: 120 }];
    h.media.currentTime = 119;
    await h.engine.tick();
    await h.engine.tick();

    expect(h.source().endOfStreamCalls).toBe(1);
  });

  it("abandons an in-flight segment that will not finish, and restarts it lower", async () => {
    // research §6's `_abandonRulesCheck`. Without it, a segment that is going to
    // take half a minute on an eight-second buffer is only recognised as a
    // problem when it finishes — several seconds after the viewer has been
    // watching a spinner. The check has to run from the download's own progress
    // events, because that is the only place the evidence arrives.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());

    h.bandwidthBps = 30_000_000; // fast, so ABR climbs to the top rung
    await h.engine.load();
    for (let i = 0; i < 8; i += 1) await h.engine.tick();
    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/1080p/index.m3u8");

    // Leave about 8 seconds of runway, then let the connection collapse: a
    // 1.25 MB segment arriving 125 KB every three seconds is roughly 330 kbps.
    const bufferedEnd = h.videoBuffer().ranges[0]?.end ?? 0;
    h.media.currentTime = bufferedEnd - 8;
    h.slowSegment = { chunks: 10, msPerChunk: 3000 };
    h.fetched.length = 0;

    await h.engine.tick();

    // The 1080p attempt was started and given up on. Its bytes never reached the
    // buffer, and the ladder has dropped to a rung the observed rate can carry.
    const abandoned = h.fetched.find((url) => url.includes("/1080p/seg-"));
    expect(abandoned).toBeDefined();
    expect(h.videoBuffer().ranges[0]?.end).toBe(bufferedEnd);
    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/240p/index.m3u8");

    // The *same segment index* is refetched lower — the point of abandoning is
    // to get this segment sooner, not to skip it.
    h.slowSegment = null;
    h.fetched.length = 0;
    await h.engine.tick();
    const segmentName = abandoned?.split("/").pop();
    expect(h.fetched).toEqual([`/media/v1/240p/${segmentName}`]);
    // The 240p init segment is not re-*fetched* — it is cached from startup —
    // but it is re-*appended*, because `changeType` alone does not restore the
    // decoder configuration the switch invalidated (research §3).
    expect(h.videoBuffer().appends.slice(-2)).toEqual([700, 100_000]);
  });

  it("does not abandon on the lowest rung, which would fetch the same bytes forever", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    h.slowSegment = { chunks: 10, msPerChunk: 3000 };

    await h.engine.load();

    // The probe segment is agonisingly slow and there is nothing below it. It
    // has to be allowed to finish, or the player transfers bytes forever and
    // plays nothing.
    expect(h.videoBuffer().ranges).toEqual([{ start: 0, end: 2 }]);
    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/240p/index.m3u8");
  });

  it("detaches, revokes and unsubscribes on destroy", async () => {
    // research §10's teardown list. It matters most in a Shorts feed, where a
    // session constructs dozens of these and any leak compounds into an OOM.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    await h.engine.load();
    expect(h.media.listenerCount("timeupdate")).toBeGreaterThan(0);

    h.engine.destroy();
    expect(h.media.listenerCount("timeupdate")).toBe(0);
    expect(h.media.log).toContain("removeAttribute:src");
    expect(h.media.log).toContain("srcObject=null");
    // endOfStream signals a clean finish, not an abandonment — it must not fire.
    expect(h.source().endOfStreamCalls).toBe(0);
  });

  it("surfaces a missing playlist as an error rather than a hang", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    h.origin.text.delete(MASTER_URL);
    await h.engine.load();
    expect(h.engine.state.phase).toBe("error");
    expect(h.engine.state.error?.message).toMatch(/No playlist/);
  });

  it("pushes state to a subscriber immediately and on every tick", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());

    const seen: string[] = [];
    const unsubscribe = h.engine.subscribe((state) => seen.push(state.phase));
    expect(seen).toEqual(["idle"]);

    await h.engine.load();
    expect(seen.length).toBeGreaterThan(1);

    unsubscribe();
    const before = seen.length;
    await h.engine.tick();
    expect(seen).toHaveLength(before);
  });
});

/* ============================================== a manual quality pick ==== */

describe("a manual quality pick", () => {
  async function pinned(): Promise<EngineHarness> {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();
    h.engine.setQuality("/media/v1/1080p/index.m3u8");
    return h;
  }

  it("takes effect on the next fetch, with a fresh init segment", async () => {
    const h = await pinned();
    h.fetched.length = 0;
    await h.engine.tick();
    expect(h.fetched).toEqual([
      "/media/v1/1080p/init.mp4",
      "/media/v1/1080p/seg-00001.m4s",
    ]);
    expect(h.engine.state.pinnedQualityId).toBe("/media/v1/1080p/index.m3u8");
  });

  it("SURVIVES A SEEK — the pin is engine state, not a property of the buffer", async () => {
    const h = await pinned();
    await h.engine.tick();
    h.media.currentTime = 80;
    h.media.dispatch("seeked");
    await flush();
    h.fetched.length = 0;
    await h.engine.tick();

    expect(h.fetched).toEqual(["/media/v1/1080p/seg-00041.m4s"]);
    expect(h.engine.state.pinnedQualityId).toBe("/media/v1/1080p/index.m3u8");
  });

  it("SURVIVES A REBUFFER — it is a hard constraint, not a preference", async () => {
    // research §7, and a real product decision rather than a spec fact: the
    // player rebuffers *at* the pinned quality rather than silently dropping the
    // viewer to a lower rung, because silently overriding an explicit choice
    // defeats the point of offering one. Concretely, the `bufferLowSeconds` floor
    // — the rule most likely to override a pin — does not.
    const h = await pinned();
    h.bandwidthBps = 1_500_000; // nowhere near enough for the 5 Mbps rung
    for (let i = 0; i < 4; i += 1) await h.engine.tick();

    // Jump somewhere nothing is buffered. Under Auto this is the two conditions
    // that most reliably force the bottom rung at once — zero runway and a
    // measured throughput well under the pinned rendition's bitrate.
    h.media.currentTime = 100;
    expect(rangeContaining(h.videoBuffer().ranges, 100)).toBeNull();
    expect(h.engine.state.throughputBps ?? 0).toBeLessThan(5_000_000);

    h.fetched.length = 0;
    await h.engine.tick();

    expect(h.fetched).toEqual(["/media/v1/1080p/seg-00050.m4s"]);
    expect(h.engine.state.pinnedQualityId).toBe("/media/v1/1080p/index.m3u8");
  });

  it("suppresses abandonment while pinned, but keeps measuring underneath", async () => {
    // research §7: "the abandonment/throughput machinery still runs underneath
    // for telemetry, just not for the decision".
    const h = await pinned();
    h.bandwidthBps = 300_000;
    for (let i = 0; i < 3; i += 1) await h.engine.tick();

    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/1080p/index.m3u8");
    expect(h.engine.state.throughputBps).not.toBeNull();
  });

  it("hands control back to Auto, and ABR takes over from the next fetch", async () => {
    const h = await pinned();
    await h.engine.tick();
    h.engine.setQuality("auto");
    expect(h.engine.state.pinnedQualityId).toBeNull();

    h.bandwidthBps = 300_000; // a collapse Auto should react to and a pin would not
    for (let i = 0; i < 3; i += 1) await h.engine.tick();
    expect(h.engine.state.fetchingQualityId).toBe("/media/v1/240p/index.m3u8");
  });

  it("is a no-op when the pin is already what is being fetched", async () => {
    // research §7: switching between Auto and a pin that matches what is buffered
    // must not force a rebuffer or an init re-append.
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();
    await h.engine.tick();

    const appendsBefore = h.videoBuffer().appends.length;
    const rangesBefore = [...h.videoBuffer().ranges];
    h.engine.setQuality("/media/v1/240p/index.m3u8");

    expect(h.videoBuffer().appends).toHaveLength(appendsBefore);
    expect(h.videoBuffer().ranges).toEqual(rangesBefore);
  });

  it("discards the forward buffer at the old quality so the pick is visible soon", async () => {
    cleanups.push(installFakeMediaSource());
    const h = engineHarness();
    cleanups.push(() => h.engine.destroy());
    await h.engine.load();
    for (let i = 0; i < 8; i += 1) await h.engine.tick();
    expect(h.videoBuffer().ranges[0]?.end).toBeGreaterThan(10);

    h.engine.setQuality("/media/v1/1080p/index.m3u8");
    await h.engine.tick();
    // Everything past currentTime + one segment of guard is gone.
    expect(h.videoBuffer().ranges[0]?.start).toBe(0);
    expect(h.videoBuffer().ranges[0]?.end).toBeLessThanOrEqual(4);
  });
});

/* =============================================== the progressive path ==== */

describe("the progressive path", () => {
  const SOURCES = [
    { id: "original", url: "/media/v1/fallback.mp4", name: "Original", bitrate: 3_000_000 },
    { id: "small", url: "/media/v1/fallback-360.mp4", name: "360p", bitrate: 800_000 },
  ] as const;

  function progressive(
    sources: readonly (typeof SOURCES)[number][] = [SOURCES[0]],
  ): { readonly player: PlayerEngine; readonly media: FakeMediaElement; tick(ms: number): void } {
    const media = new FakeMediaElement();
    let clock = 0;
    const player = createProgressivePlayer({ media, sources, now: () => clock });
    return {
      player,
      media,
      tick(ms) {
        clock += ms;
      },
    };
  }

  it("attaches the file directly and asks only for metadata", async () => {
    // `auto` would have the browser pull the entire rendition before the viewer
    // has asked for anything — on this path that is the whole file, not a
    // segment. The moov-at-front layout research §9 requires is what makes
    // `metadata` enough for a duration and a first frame.
    const p = progressive();
    await p.player.load();
    expect(p.media.src).toBe("/media/v1/fallback.mp4");
    expect(p.media.preload).toBe("metadata");
    expect(p.player.state.mode).toBe("progressive");
  });

  it("reports no throughput estimate rather than a zero", async () => {
    // There is no estimator on this path. A zero would read as a measured
    // collapse, which is a different and much more alarming claim.
    const p = progressive();
    await p.player.load();
    expect(p.player.state.throughputBps).toBeNull();
  });

  it("offers one quality and no Auto for a single-rendition upload", async () => {
    const p = progressive();
    await p.player.load();
    expect(p.player.state.qualities.map((quality) => quality.name)).toEqual(["Original"]);
    expect(p.player.state.pinnedQualityId).toBeNull();
    expect(p.player.state.activeQualityId).toBe("original");
  });

  it("counts rebuffers from the element's own events", async () => {
    const p = progressive();
    await p.player.load();
    p.media.dispatch("loadedmetadata");
    p.media.paused = false;
    p.media.dispatch("playing");
    p.media.dispatch("waiting");
    p.tick(900);
    p.media.dispatch("playing");

    expect(p.player.state.metrics.rebufferCount).toBe(1);
    expect(p.player.state.metrics.rebufferSeconds).toBeCloseTo(0.9, 6);
    expect(p.player.state.phase).toBe("playing");
  });

  it("does not count seek latency as a rebuffer here either", async () => {
    const p = progressive();
    await p.player.load();
    p.media.seeking = true;
    p.media.dispatch("waiting");
    p.tick(3000);
    p.media.seeking = false;
    p.media.dispatch("playing");
    expect(p.player.state.metrics.rebufferCount).toBe(0);
  });

  it("reads buffered runway from the element, and reports zero in a gap", async () => {
    const p = progressive();
    await p.player.load();
    p.media.bufferedRanges.set([{ start: 0, end: 30 }]);
    p.media.currentTime = 10;
    await p.player.tick();
    expect(p.player.state.bufferedAheadSeconds).toBe(20);

    p.media.currentTime = 45;
    await p.player.tick();
    expect(p.player.state.bufferedAheadSeconds).toBe(0);
  });

  it("weights mean bitrate by the source that is actually playing", async () => {
    const p = progressive();
    await p.player.load();
    for (let at = 0; at <= 5; at += 0.5) {
      p.media.currentTime = at;
      p.media.dispatch("timeupdate");
    }
    expect(p.player.state.metrics.meanBitrateBps).toBe(3_000_000);
    expect(p.player.state.metrics.watchedSeconds).toBeCloseTo(5, 6);
  });

  it("switches quality by reloading, carrying the playhead and the play state across", async () => {
    // research §9: a full `src` swap is the only switching available here, and it
    // reloads and reconnects. What this can do is make the discontinuity small.
    const p = progressive(SOURCES.slice());
    await p.player.load();
    p.media.currentTime = 42;
    p.media.paused = false;

    p.player.setQuality("small");
    expect(p.media.src).toBe("/media/v1/fallback-360.mp4");
    expect(p.media.log).toContain("load");
    // Assigning currentTime before metadata arrives is ignored by every engine,
    // which is exactly how a quality switch silently restarts a video from zero.
    expect(p.media.currentTime).toBe(42);

    p.media.currentTime = 0; // what a real reload does
    p.media.dispatch("loadedmetadata");
    expect(p.media.currentTime).toBe(42);
    expect(p.media.log).toContain("play");
    expect(p.player.state.activeQualityId).toBe("small");
  });

  it("does not resume a video that was paused before the switch", async () => {
    const p = progressive(SOURCES.slice());
    await p.player.load();
    p.media.paused = true;
    p.player.setQuality("small");
    p.media.dispatch("loadedmetadata");
    expect(p.media.log).not.toContain("play");
  });

  it("ignores Auto and an unknown id rather than throwing at a forwarding caller", async () => {
    const p = progressive(SOURCES.slice());
    await p.player.load();
    p.player.setQuality("auto");
    expect(p.player.state.activeQualityId).toBe("original");
    p.player.setQuality("nonexistent");
    expect(p.player.state.activeQualityId).toBe("original");
  });

  it("blames the range-request contract when the element fails, because that is the usual cause", async () => {
    const p = progressive();
    await p.player.load();
    p.media.dispatch("error");
    expect(p.player.state.phase).toBe("error");
    expect(p.player.state.error?.message).toMatch(/Accept-Ranges/);
  });

  it("stops the download on destroy without pointing the element at the page", async () => {
    // `src = ""` re-resolves against the document URL and leaves the element
    // fetching the page itself. Removing the attribute and calling load() is what
    // actually stops it.
    const p = progressive();
    await p.player.load();
    p.player.destroy();
    expect(p.media.log).toContain("removeAttribute:src");
    expect(p.media.log).toContain("load");
    expect(p.media.log).not.toContain("src=");
  });

  it("refuses to exist with no sources at all", () => {
    expect(() =>
      createProgressivePlayer({ media: new FakeMediaElement(), sources: [] }),
    ).toThrow(/at least one source/);
  });
});

/* ================================================== the routing branch === */

describe("createPlayer", () => {
  it("routes a progressive upload to the progressive path regardless of the browser", async () => {
    // A property of how the video was *uploaded*, not of this engine. Even with a
    // perfectly good MediaSource present, there is no ladder to play.
    cleanups.push(installFakeMediaSource());
    const media = new FakeMediaElement();
    const player = createPlayer({
      media,
      pipeline: "progressive",
      progressiveSources: [{ id: "original", url: "/media/v1/fallback.mp4", name: "Original" }],
    });
    await player.load();
    expect(player.state.mode).toBe("progressive");
    expect(media.src).toBe("/media/v1/fallback.mp4");
  });

  it("routes a laddered video to the MSE engine when the browser can play it", async () => {
    cleanups.push(installFakeMediaSource());
    const media = new FakeMediaElement();
    const player = createPlayer({
      media,
      pipeline: "laddered",
      masterPlaylistUrl: MASTER_URL,
      renditionCodecs: ["avc1.640028", "mp4a.40.2"],
    });
    cleanups.push(() => player.destroy());
    expect(player.state.mode).toBe("media-source");
  });

  it("falls back to progressive for a laddered video this browser cannot play", async () => {
    // A property of the *browser*, not of the upload — the two reach the same
    // code by different routes and only this one is a fallback.
    const media = new FakeMediaElement();
    const player = createPlayer({
      media,
      pipeline: "laddered",
      masterPlaylistUrl: MASTER_URL,
      renditionCodecs: ["vp09.00.40.08"],
      progressiveSources: [{ id: "original", url: "/media/v1/fallback.mp4", name: "Original" }],
    });
    await player.load();
    expect(player.state.mode).toBe("progressive");
  });

  it("says exactly what is missing when the fallback has nothing to play", () => {
    const media = new FakeMediaElement();
    expect(() =>
      createPlayer({ media, pipeline: "laddered", masterPlaylistUrl: MASTER_URL }),
    ).toThrow(/progressive_key/);
  });

  it("refuses a laddered video with no master playlist URL", () => {
    expect(() =>
      createPlayer({ media: new FakeMediaElement(), pipeline: "laddered" }),
    ).toThrow(/needs a masterPlaylistUrl/);
  });
});
