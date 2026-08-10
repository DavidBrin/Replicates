import { describe, expect, it } from "vitest";

import {
  classifyCameraError,
  createLiveSession,
  createSeededRandom,
  LIVE_COMMENT_MESSAGES,
  LIVE_COMMENT_USERNAMES,
  maxViewerStep,
  nextRandom,
  readCameraFailure,
  tickLiveSession,
  visibleComments,
  type LiveSessionConfig,
  type LiveSessionState,
} from "./live-session";

const config: LiveSessionConfig = {
  startingViewers: 148,
  commentsPerMinute: 24,
  username: "you",
};

/** Runs the session for `ms` in 200ms slices, the same cadence the UI uses. */
function run(
  state: LiveSessionState,
  ms: number,
  cfg: LiveSessionConfig = config,
): LiveSessionState {
  let current = state;
  for (let elapsed = 0; elapsed < ms; elapsed += 200) {
    current = tickLiveSession(current, 200, cfg);
  }
  return current;
}

describe("seeded randomness", () => {
  it("is reproducible from a seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const first = [a(), a(), a(), a()];
    const second = [b(), b(), b(), b()];
    expect(first).toEqual(second);
  });

  it("stays inside [0, 1) and does not immediately repeat", () => {
    const random = createSeededRandom(7);
    const draws = Array.from({ length: 200 }, random);
    for (const draw of draws) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
    expect(new Set(draws).size).toBeGreaterThan(190);
  });

  it("threads the seed rather than hiding it", () => {
    const one = nextRandom(1);
    const two = nextRandom(one.seed);
    expect(nextRandom(1)).toEqual(one);
    expect(two.seed).not.toBe(one.seed);
  });
});

describe("viewer drift", () => {
  it("is deterministic for a given seed", () => {
    const a = run(createLiveSession(config, 99), 60_000);
    const b = run(createLiveSession(config, 99), 60_000);
    expect(a.viewers).toBe(b.viewers);
    expect(a.comments.map((c) => c.text)).toEqual(b.comments.map((c) => c.text));
  });

  it("never jumps by more than a few people at a time", () => {
    let state = createLiveSession(config, 5);
    for (let i = 0; i < 3_000; i += 1) {
      const before = state.viewers;
      state = tickLiveSession(state, 200, config);
      // The cap is per *change*, and one 200ms tick can never span two changes
      // at a 2.2s mean — so a bigger move than the cap means the model drifted.
      expect(Math.abs(state.viewers - before)).toBeLessThanOrEqual(maxViewerStep(before));
    }
  });

  it("trends gently upward rather than exploding", () => {
    const state = run(createLiveSession(config, 3), 5 * 60_000);
    expect(state.viewers).toBeGreaterThan(config.startingViewers);
    // Five minutes of a stream that started at 148 should not have found a
    // stadium's worth of viewers.
    expect(state.viewers).toBeLessThan(config.startingViewers + 200);
  });

  it("never goes below zero", () => {
    const empty = { ...config, startingViewers: 1 };
    let state = createLiveSession(empty, 11);
    for (let i = 0; i < 5_000; i += 1) {
      state = tickLiveSession(state, 200, empty);
      expect(state.viewers).toBeGreaterThanOrEqual(0);
    }
  });

  it("moves one person at a time on a small stream", () => {
    expect(maxViewerStep(0)).toBe(1);
    expect(maxViewerStep(12)).toBe(1);
    expect(maxViewerStep(148)).toBe(3);
    expect(maxViewerStep(50_000)).toBe(3);
  });
});

describe("comment scheduling", () => {
  it("averages out near the configured rate", () => {
    const minutes = 10;
    const state = run(createLiveSession(config, 21), minutes * 60_000);
    // `comments` is capped, so count by the id counter instead.
    const produced = state.nextCommentId - 1;
    const perMinute = produced / minutes;
    expect(perMinute).toBeGreaterThan(config.commentsPerMinute * 0.85);
    expect(perMinute).toBeLessThan(config.commentsPerMinute * 1.15);
  });

  it("does not fire on a fixed metronome", () => {
    const state = run(createLiveSession(config, 4), 3 * 60_000);
    const gaps: number[] = [];
    for (let i = 1; i < state.comments.length; i += 1) {
      gaps.push(state.comments[i].at - state.comments[i - 1].at);
    }
    expect(gaps.length).toBeGreaterThan(5);
    expect(new Set(gaps).size).toBeGreaterThan(gaps.length / 2);
  });

  it("produces no comments at all when the rate is zero", () => {
    const silent = { ...config, commentsPerMinute: 0 };
    const state = run(createLiveSession(silent, 8), 30 * 60_000, silent);
    expect(state.comments).toHaveLength(0);
    expect(state.nextCommentId).toBe(1);
    // The viewer count still drifts — the two are independent settings.
    expect(state.viewers).not.toBe(config.startingViewers);
  });

  it("re-arms when the rate is turned back on mid-session", () => {
    const silent = { ...config, commentsPerMinute: 0 };
    const quiet = run(createLiveSession(silent, 2), 60_000, silent);
    expect(quiet.comments).toHaveLength(0);
    const noisy = run(quiet, 60_000, config);
    expect(noisy.comments.length).toBeGreaterThan(0);
  });

  it("draws only from the safe pools and never as the broadcaster", () => {
    const state = run(createLiveSession(config, 17), 10 * 60_000);
    expect(state.comments.length).toBeGreaterThan(0);
    for (const comment of state.comments) {
      expect(LIVE_COMMENT_USERNAMES).toContain(comment.username);
      expect(comment.username).not.toBe(config.username);
      if (comment.kind === "comment") {
        expect(LIVE_COMMENT_MESSAGES).toContain(comment.text);
      } else {
        expect(comment.text).toBe(`${comment.username} joined this live video`);
      }
    }
  });

  it("mixes in join notices as a distinct kind", () => {
    const state = run(createLiveSession(config, 33), 10 * 60_000);
    expect(state.comments.some((c) => c.kind === "system")).toBe(true);
    expect(state.comments.some((c) => c.kind === "comment")).toBe(true);
  });

  it("gives one handle one avatar colour", () => {
    const state = run(createLiveSession(config, 6), 10 * 60_000);
    const hues = new Map<string, number>();
    for (const comment of state.comments) {
      const seen = hues.get(comment.username);
      if (seen !== undefined) expect(comment.avatarHue).toBe(seen);
      hues.set(comment.username, comment.avatarHue);
    }
  });

  it("caps retained history instead of growing forever", () => {
    const state = run(createLiveSession(config, 12), 60 * 60_000);
    expect(state.nextCommentId).toBeGreaterThan(500);
    expect(state.comments.length).toBeLessThanOrEqual(24);
  });
});

describe("tick hygiene", () => {
  it("is a no-op for a zero or negative delta", () => {
    const state = createLiveSession(config, 1);
    expect(tickLiveSession(state, 0, config)).toBe(state);
    expect(tickLiveSession(state, -5_000, config)).toBe(state);
    expect(tickLiveSession(state, Number.NaN, config)).toBe(state);
  });

  it("drops the backlog after a long hidden-tab gap", () => {
    const base = createLiveSession(config, 15);
    const resumed = tickLiveSession(base, 5 * 60_000, config);
    // Five minutes of backlog would be ~120 comments; the catch-up clamp means
    // the stream just carries on instead.
    expect(resumed.nextCommentId - base.nextCommentId).toBeLessThan(5);
    expect(resumed.elapsedMs).toBeLessThanOrEqual(2_000);
  });
});

describe("visibleComments", () => {
  it("shows a handful of the newest and forgets the old ones", () => {
    const state = run(createLiveSession(config, 77), 5 * 60_000);
    const shown = visibleComments(state);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(5);
    expect(shown[shown.length - 1]).toBe(state.comments[state.comments.length - 1]);
    for (const comment of shown) {
      expect(state.elapsedMs - comment.at).toBeLessThan(14_000);
    }
  });

  it("empties out once the stream goes quiet", () => {
    const state = run(createLiveSession(config, 77), 60_000);
    const stale = { ...state, elapsedMs: state.elapsedMs + 60_000 };
    expect(visibleComments(stale)).toHaveLength(0);
  });
});

describe("camera failure classification", () => {
  it("maps the DOMException names the spec defines", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyCameraError({ name: "SecurityError" })).toBe("denied");
    expect(classifyCameraError({ name: "NotFoundError" })).toBe("no_device");
    expect(classifyCameraError({ name: "OverconstrainedError" })).toBe("no_device");
    expect(classifyCameraError({ name: "NotReadableError" })).toBe("in_use");
    expect(classifyCameraError({ name: "AbortError" })).toBe("aborted");
    expect(classifyCameraError({ name: "SomethingNew" })).toBe("unknown");
    expect(classifyCameraError("a string")).toBe("unknown");
    expect(classifyCameraError(null)).toBe("unknown");
  });

  it("prefers an explicit code carried on the error", () => {
    expect(readCameraFailure({ code: "insecure_context", name: "TypeError" })).toBe(
      "insecure_context",
    );
    expect(readCameraFailure({ code: "not-a-real-code", name: "NotAllowedError" })).toBe("denied");
    expect(readCameraFailure(new Error("boom"))).toBe("unknown");
  });
});
