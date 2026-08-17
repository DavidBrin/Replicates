import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { PROGRESS_WRITE_INTERVAL_MS } from "@/domain/viewing";

import {
  MAX_STEP_SECONDS,
  accumulateWatched,
  useWatchReporter,
  type WatchReport,
} from "../watch-reporter";

/**
 * The watch reporter.
 *
 * `accumulateWatched` carries the whole rule and is tested directly. The hook's
 * tests are about the three things a pure function cannot express: that a tick
 * is throttled, that leaving flushes, and that a no-op flush is not sent.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("accumulateWatched", () => {
  it("counts ordinary forward playback", () => {
    expect(accumulateWatched(10, 10.25)).toBeCloseTo(0.25);
    expect(accumulateWatched(0, 1)).toBe(1);
  });

  it("counts nothing for a paused player", () => {
    // Not a special case in the implementation: a paused player emits no
    // `timeupdate`, so the same position never arrives twice. This pins the
    // behaviour if it ever does.
    expect(accumulateWatched(10, 10)).toBe(0);
  });

  it("counts nothing for a backward seek", () => {
    expect(accumulateWatched(300, 10)).toBe(0);
  });

  it("counts nothing for a forward seek", () => {
    // The rule that makes `watched_seconds` mean what the schema says: "a seek
    // to the end is not a view".
    expect(accumulateWatched(10, 3600)).toBe(0);
    expect(accumulateWatched(10, 10 + MAX_STEP_SECONDS + 0.001)).toBe(0);
  });

  it("counts a step right up to the ceiling — a throttled background tab", () => {
    // The trade-off the header states. A backgrounded tab keeps playing audio
    // while `timeupdate` is throttled, and a tighter ceiling would stop
    // counting for everyone listening in another tab.
    expect(accumulateWatched(10, 10 + MAX_STEP_SECONDS)).toBe(MAX_STEP_SECONDS);
  });

  it("counts a rewatched span again", () => {
    // Watching the same ten seconds three times is thirty seconds of watching,
    // and the backward seek between them contributes nothing.
    let total = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      total += accumulateWatched(10, 0); // the rewind
      for (let at = 0; at < 10; at += 1) total += accumulateWatched(at, at + 1);
    }
    expect(total).toBe(30);
  });

  it("counts nothing for a non-finite position", () => {
    expect(accumulateWatched(Number.NaN, 5)).toBe(0);
    expect(accumulateWatched(5, Number.NaN)).toBe(0);
    expect(accumulateWatched(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("useWatchReporter", () => {
  function setup(videoId = "v1", durationSeconds = 600) {
    const sent: WatchReport[] = [];
    const send = (report: WatchReport): void => {
      sent.push(report);
    };
    const view = renderHook(
      (props: { videoId: string }) =>
        useWatchReporter({ videoId: props.videoId, durationSeconds, send }),
      { initialProps: { videoId } },
    );
    return { sent, view };
  }

  /** Feed `seconds` of playback in quarter-second `timeupdate` steps. */
  function play(onTime: (seconds: number) => void, from: number, seconds: number): void {
    act(() => {
      for (let step = 1; step <= seconds * 4; step += 1) onTime(from + step / 4);
    });
  }

  it("does not report on every timeupdate", () => {
    vi.useFakeTimers();
    const { sent, view } = setup();

    // Four seconds of playback is sixteen `timeupdate` events and, at
    // PROGRESS_WRITE_INTERVAL_MS, no elapsed interval.
    play(view.result.current, 0, 4);
    expect(sent).toHaveLength(0);
  });

  it("reports once an interval has elapsed, with the accumulated total", () => {
    vi.useFakeTimers();
    const { sent, view } = setup();

    play(view.result.current, 0, 4);
    vi.advanceTimersByTime(PROGRESS_WRITE_INTERVAL_MS);
    play(view.result.current, 4, 1);

    // One report, on the *first* event after the interval elapsed — so it
    // carries 4.25s rather than the 5s the second `play` finishes at. The
    // remaining three quarter-seconds are inside the next interval and go out
    // with the flush.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.reason).toBe("tick");
    expect(sent[0]?.watchedSeconds).toBeCloseTo(4.25);
    expect(sent[0]?.positionSeconds).toBeCloseTo(4.25);
    expect(sent[0]?.videoId).toBe("v1");
  });

  it("carries the remainder out on the flush rather than losing it", () => {
    // The interval is a throttle, not a sampler: every second of playback has
    // to reach the server eventually, or a viewer who watches 29 seconds and
    // leaves is reported as having watched 25 and no view is counted.
    vi.useFakeTimers();
    const { sent, view } = setup();

    play(view.result.current, 0, 4);
    vi.advanceTimersByTime(PROGRESS_WRITE_INTERVAL_MS);
    play(view.result.current, 4, 1);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(sent).toHaveLength(2);
    expect(sent[1]?.reason).toBe("unload");
    expect(sent[1]?.watchedSeconds).toBeCloseTo(5);
  });

  it("flushes when the tab is hidden — the report that carries the view", () => {
    vi.useFakeTimers();
    const { sent, view } = setup();

    play(view.result.current, 0, 4);
    expect(sent).toHaveLength(0);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.reason).toBe("unload");
    expect(sent[0]?.watchedSeconds).toBeCloseTo(4);
  });

  it("does not send a second identical flush", () => {
    // `pagehide` and `visibilitychange` both fire for one tab switch. Without
    // the guard, every switch away costs two identical requests, and the
    // route's once-per-session gate then absorbs a duplicate it should never
    // have been sent.
    vi.useFakeTimers();
    const { sent, view } = setup();
    play(view.result.current, 0, 4);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(sent).toHaveLength(1);
  });

  it("sends nothing at all when nothing was watched", () => {
    const { sent } = setup();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sent).toHaveLength(0);
  });

  it("flushes the old video when the page becomes a different one", () => {
    // The common way to finish a video here is a client navigation to another
    // watch page, not a document unload — every card in the application is a
    // `<Link>`. Without this the ordinary case records nothing.
    vi.useFakeTimers();
    const { sent, view } = setup();
    play(view.result.current, 0, 4);

    act(() => {
      view.rerender({ videoId: "v2" });
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.videoId).toBe("v1");
    expect(sent[0]?.watchedSeconds).toBeCloseTo(4);
  });

  it("starts the next video's accumulation from zero", () => {
    vi.useFakeTimers();
    const { sent, view } = setup();
    play(view.result.current, 0, 4);
    act(() => {
      view.rerender({ videoId: "v2" });
    });
    sent.length = 0;

    play(view.result.current, 0, 2);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });

    // Two seconds, not six: the previous video's total must not carry over, or
    // the second video in a session inherits a view it did not earn.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.watchedSeconds).toBeCloseTo(2);
    expect(sent[0]?.videoId).toBe("v2");
  });

  it("stops listening once unmounted", () => {
    const { sent, view } = setup();
    play(view.result.current, 0, 4);
    sent.length = 0;
    act(() => {
      view.unmount();
    });
    sent.length = 0;

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(sent).toHaveLength(0);
  });
});
