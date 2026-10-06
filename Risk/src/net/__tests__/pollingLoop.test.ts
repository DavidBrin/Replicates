// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  createPollingLoop,
  HIDDEN_MS,
  HIDDEN_STOP_MS,
  JITTER,
  jitter,
  type VisibilitySource,
} from "../pollingLoop";

/**
 * The adaptive schedule (SPEC §5.5's cadence table, D11) under a synchronous
 * scheduler: the intervals, the jitter bounds, the hidden-tab stop and the
 * re-poll on regaining visibility.
 *
 * The loop takes `schedule`, `now`, `random` and `visibility` as parameters
 * precisely so this suite does not have to wait out a single real second.
 */

interface Clock {
  now(): number;
  /** Fire the pending callback, advancing the clock by its delay. */
  tick(): Promise<void>;
  /** Advance the clock without firing anything. */
  advance(ms: number): void;
  readonly pending: number | null;
  readonly delays: number[];
  schedule(fn: () => void, ms: number): () => void;
}

function clock(start = 0): Clock {
  let time = start;
  let queued: { fn: () => void; at: number } | null = null;
  const delays: number[] = [];
  return {
    now: () => time,
    advance(ms) {
      time += ms;
    },
    get pending() {
      return queued === null ? null : queued.at - time;
    },
    get delays() {
      return delays;
    },
    schedule(fn, ms) {
      queued = { fn, at: time + ms };
      delays.push(ms);
      return () => {
        queued = null;
      };
    },
    async tick() {
      const next = queued;
      if (!next) throw new Error("nothing scheduled");
      queued = null;
      // Never backwards: a test may have called `advance` past the deadline.
      time = Math.max(time, next.at);
      next.fn();
      // Let the poll's promise chain settle before the assertions run.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function visibility(visible = true): VisibilitySource & { set(next: boolean): void } {
  let state = visible;
  const listeners = new Set<() => void>();
  return {
    isVisible: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("jitter", () => {
  it("spans exactly ±15 % at the extremes of random()", () => {
    expect(jitter(4000, () => 0)).toBe(Math.round(4000 * (1 - JITTER)));
    expect(jitter(4000, () => 1)).toBe(Math.round(4000 * (1 + JITTER)));
    expect(jitter(4000, () => 0.5)).toBe(4000);
  });

  it("stays inside ±15 % for every draw", () => {
    for (let i = 0; i < 500; i += 1) {
      const value = jitter(2000, Math.random);
      expect(value).toBeGreaterThanOrEqual(1700);
      expect(value).toBeLessThanOrEqual(2300);
    }
  });

  it("never returns zero, however small the interval", () => {
    expect(jitter(1, () => 0)).toBeGreaterThan(0);
  });
});

describe("the loop", () => {
  it("polls once on start and then on the interval it is given", async () => {
    const time = clock();
    const poll = vi.fn(async () => undefined);
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
    });

    loop.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(1);
    expect(time.pending).toBe(4000);

    await time.tick();
    expect(poll).toHaveBeenCalledTimes(2);
    expect(time.delays).toEqual([4000, 4000]);
  });

  it("re-reads the interval before every tick, so 2 s / 4 s switches live", async () => {
    const time = clock();
    let myTurn = false;
    const loop = createPollingLoop({
      poll: async () => undefined,
      intervalMs: () => (myTurn ? 2000 : 4000),
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
    });

    loop.start();
    await Promise.resolve();
    expect(time.pending).toBe(4000);

    myTurn = true;
    await time.tick();
    expect(time.delays.at(-1)).toBe(2000);
  });

  it("slows to 15 s when the tab is hidden and speeds back up when it is not", async () => {
    const time = clock();
    const vis = visibility();
    const loop = createPollingLoop({
      poll: async () => undefined,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: vis,
    });

    loop.start();
    await Promise.resolve();
    expect(time.pending).toBe(4000);

    vis.set(false);
    expect(time.pending).toBe(HIDDEN_MS);

    vis.set(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(time.pending).toBe(4000);
  });

  it("re-polls immediately on regaining visibility", async () => {
    const time = clock();
    const vis = visibility();
    const poll = vi.fn(async () => undefined);
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: vis,
    });

    loop.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(1);

    vis.set(false);
    expect(poll).toHaveBeenCalledTimes(1);

    vis.set(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("stops entirely after five minutes hidden", async () => {
    const time = clock();
    const vis = visibility();
    const poll = vi.fn(async () => undefined);
    const onStop = vi.fn();
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: vis,
      onStop,
    });

    loop.start();
    await Promise.resolve();
    vis.set(false);

    // Walk the hidden ticks forward: 15 s each, so twenty of them.
    let polls = poll.mock.calls.length;
    for (let elapsed = 0; elapsed < HIDDEN_STOP_MS; elapsed += HIDDEN_MS) {
      if (loop.stopped || time.pending === null) break;
      await time.tick();
      polls = poll.mock.calls.length;
    }

    expect(loop.stopped).toBe(true);
    expect(onStop).toHaveBeenCalled();
    expect(time.pending).toBeNull();

    // And nothing wakes it by itself.
    time.advance(HIDDEN_MS * 10);
    expect(poll).toHaveBeenCalledTimes(polls);
  });

  it("wakes a hidden-stopped loop the moment the tab is visible again", async () => {
    const time = clock();
    const vis = visibility();
    const poll = vi.fn(async () => undefined);
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
      visibility: vis,
    });

    loop.start();
    await Promise.resolve();
    vis.set(false);
    time.advance(HIDDEN_STOP_MS + 1);
    // Arming the next tick is where the stop is decided.
    await time.tick().catch(() => undefined);
    expect(loop.stopped).toBe(true);

    const before = poll.mock.calls.length;
    vis.set(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(loop.stopped).toBe(false);
    expect(poll.mock.calls.length).toBe(before + 1);
  });

  it("keeps polling after a failed poll", async () => {
    const time = clock();
    const poll = vi.fn(async () => {
      throw new Error("network");
    });
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
    });

    loop.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(time.pending).toBe(4000);
    await time.tick();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("coalesces a pollNow that lands while a poll is in flight", async () => {
    const time = clock();
    const released: (() => void)[] = [];
    const poll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          released.push(resolve);
        }),
    );
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
    });

    loop.start();
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(1);

    const second = loop.pollNow();
    expect(poll).toHaveBeenCalledTimes(1);
    released.shift()?.();
    await second;
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels the pending tick and polls no more", async () => {
    const time = clock();
    const poll = vi.fn(async () => undefined);
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
    });

    loop.start();
    await Promise.resolve();
    loop.stop();
    expect(time.pending).toBeNull();
    expect(loop.stopped).toBe(true);
  });

  it("start() twice does not double the polling", async () => {
    const time = clock();
    const poll = vi.fn(async () => undefined);
    const loop = createPollingLoop({
      poll,
      intervalMs: () => 4000,
      now: time.now,
      schedule: time.schedule,
      random: () => 0.5,
    });

    loop.start();
    loop.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
