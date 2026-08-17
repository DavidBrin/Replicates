import { vi, type Mock } from "vitest";

import { EMPTY_METRICS } from "@/media/player/engine";
import type {
  CreatePlayerOptions,
  EngineState,
  PlayerEngine,
} from "@/media/player";

import type { ShortItem } from "../shorts-player";

/**
 * Shared fixtures for the Shorts suites.
 *
 * Not a `.test.tsx`, so Vitest's `include` never runs it as a suite.
 *
 * The engine spy is the important half. Every assertion about preloading and
 * teardown is an assertion about *which engines exist*, so the factory records
 * one entry per construction with the id of the short it was built for, and
 * `load`/`destroy` are counted rather than stubbed away. That is what lets a
 * test say "index 0's engine was destroyed exactly once and index 1's was never
 * rebuilt", which is the property `research/03-mse-player-abr.md` §10 is about
 * and which a test of "did the component unmount" would not catch.
 */

/* ---------------------------------------------------------------- shorts -- */

export function makeShort(id: string, overrides: Partial<ShortItem> = {}): ShortItem {
  return {
    id,
    title: `Short ${id}`,
    channel: {
      id: `channel-${id}`,
      name: `Channel ${id}`,
      handle: `channel-${id}`,
      avatarUrl: null,
    },
    pipeline: "laddered",
    // The id is recoverable from the URL, which is how `engineSpy` knows which
    // short an engine was built for without the options carrying one.
    masterPlaylistUrl: `/api/media/videos/${id}/master.m3u8`,
    progressiveSources: [
      { id: `${id}-source`, url: `/api/media/videos/${id}/source.mp4`, name: "Original" },
    ],
    renditionCodecs: ["avc1.4d401f"],
    posterUrl: `/api/media/videos/${id}/thumb-hq.jpg`,
    durationSeconds: 42,
    viewCount: 12_345,
    likeCount: 1_000_000,
    dislikeCount: 12,
    commentCount: 4_882,
    commentsEnabled: true,
    viewerReaction: null,
    subscribed: false,
    ...overrides,
  };
}

export function makeFeed(count: number): readonly ShortItem[] {
  return Array.from({ length: count }, (_, index) => makeShort(`s${index}`));
}

/* ----------------------------------------------------------- engine spy -- */

export interface RecordedEngine {
  /** The short this engine was built for, recovered from its media URL. */
  readonly videoId: string;
  readonly options: CreatePlayerOptions;
  readonly load: Mock<() => Promise<void>>;
  readonly destroy: Mock<() => void>;
}

const IDLE_STATE: EngineState = {
  mode: "media-source",
  phase: "idle",
  qualities: [],
  activeQualityId: null,
  fetchingQualityId: null,
  pinnedQualityId: null,
  bufferedAheadSeconds: 0,
  throughputBps: null,
  error: null,
  metrics: EMPTY_METRICS,
};

/** `videos/<id>/…` is the blob layout, so the id is the segment after it. */
function videoIdFrom(options: CreatePlayerOptions): string {
  const url = options.masterPlaylistUrl ?? options.progressiveSources?.[0]?.url ?? "";
  return /\/videos\/([^/]+)\//.exec(url)?.[1] ?? "unknown";
}

export function engineSpy(): {
  readonly factory: (options: CreatePlayerOptions) => PlayerEngine;
  readonly engines: RecordedEngine[];
  /** Every engine built for one short, oldest first. */
  readonly forVideo: (videoId: string) => RecordedEngine[];
  readonly liveVideoIds: () => string[];
} {
  const engines: RecordedEngine[] = [];

  const factory = (options: CreatePlayerOptions): PlayerEngine => {
    const record: RecordedEngine = {
      videoId: videoIdFrom(options),
      options,
      load: vi.fn<() => Promise<void>>(async () => undefined),
      destroy: vi.fn<() => void>(),
    };
    engines.push(record);
    return {
      get state() {
        return IDLE_STATE;
      },
      subscribe: () => () => undefined,
      load: record.load,
      setQuality: vi.fn(),
      tick: vi.fn(async () => undefined),
      destroy: record.destroy,
    };
  };

  return {
    factory,
    engines,
    forVideo: (videoId) => engines.filter((engine) => engine.videoId === videoId),
    liveVideoIds: () =>
      engines
        .filter((engine) => engine.destroy.mock.calls.length === 0)
        .map((engine) => engine.videoId),
  };
}
