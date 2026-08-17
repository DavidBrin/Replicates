// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  ABR_DEFAULTS,
  Ewma,
  ThroughputEstimator,
  selectRendition,
  shouldAbandon,
  startupRendition,
  type AbrInput,
  type AbrRendition,
} from "../abr";

/**
 * The ABR selector is the part of this slice most worth testing, and the part
 * that is easiest to test badly.
 *
 * It is worth testing because every failure it has is a failure a viewer sees:
 * a stall, a picture that never improves on a fast connection, or the flapping
 * between two rungs that is the failure everyone ships. It is easy to test badly
 * because the obvious approach — stand up a player, feed it a network trace,
 * watch what happens — tests the harness at least as much as the algorithm, and
 * tells you nothing about *why* a rung was chosen when it disagrees with you.
 *
 * So `selectRendition` is a pure function of measured state and the tests below
 * are a table of states. Each one names the scenario in the language of the
 * problem — cold start, collapse, recovery, oscillation, abandonment — and
 * asserts both the rendition and the `reason`, because a right answer for the
 * wrong reason is a test that will not notice when the reason stops being true.
 */

const LADDER: readonly AbrRendition[] = [
  { id: "144p", bitrate: 200_000 },
  { id: "240p", bitrate: 400_000 },
  { id: "360p", bitrate: 800_000 },
  { id: "480p", bitrate: 1_400_000 },
  { id: "720p", bitrate: 2_800_000 },
  { id: "1080p", bitrate: 5_000_000 },
];

const HEALTHY_BUFFER = 24;

function decide(overrides: Partial<AbrInput> = {}): ReturnType<typeof selectRendition> {
  return selectRendition({
    ladder: LADDER,
    currentRenditionId: "720p",
    throughputBps: 6_000_000,
    bufferSeconds: HEALTHY_BUFFER,
    segmentDurationSeconds: 2,
    // Large by default: there has been no previous upswitch for anti-thrash to
    // be measured against, which is the state the engine starts a track in.
    segmentsSinceUpSwitch: 999,
    ...overrides,
  });
}

/* ------------------------------------------------------------------ EWMA -- */

describe("the throughput estimator", () => {
  it("reports a single sample exactly, rather than dragging it toward zero", () => {
    // The bias correction in `Ewma.value` is what makes this true. Without it the
    // first sample of a 10 Mbps connection reads as roughly 2 Mbps and the player
    // spends its first several segments climbing out of a hole it dug at startup.
    const ewma = new Ewma(3);
    ewma.update(10_000_000, 2);
    expect(ewma.value).toBeCloseTo(10_000_000, 3);
  });

  it("halves the weight of an old sample after exactly one half-life", () => {
    const ewma = new Ewma(4);
    ewma.update(1000, 4); // contributes 1000 × (1 − ½) = 500
    ewma.update(0, 4); //    decays that to 250, adds nothing of its own
    // Bias correction divides by the mass that is real: 1 − ½² = ¾.
    expect(ewma.value).toBeCloseTo(250 / 0.75, 6);
  });

  it("reacts fast to a collapse and slowly to a recovery — the asymmetry is the point", () => {
    // research §6: quality should drop fast and climb cautiously, and taking the
    // minimum of a 3s and a 9s half-life is what enforces that at the estimator
    // level before the switch margins enforce it again at the decision level.
    const collapse = new ThroughputEstimator();
    collapse.onSegmentDownloaded(2_500_000, 2000); // 10 Mbps
    collapse.onSegmentDownloaded(250_000, 2000); //  1 Mbps
    const afterCollapse = collapse.estimateBps() ?? 0;

    const recovery = new ThroughputEstimator();
    recovery.onSegmentDownloaded(250_000, 2000); //  1 Mbps
    recovery.onSegmentDownloaded(2_500_000, 2000); // 10 Mbps
    const afterRecovery = recovery.estimateBps() ?? 0;

    // Same two samples, opposite order. The drop is tracked much further than the
    // rise is: that gap *is* the fast/slow asymmetry.
    const dropTravelled = (10_000_000 - afterCollapse) / (10_000_000 - 1_000_000);
    const riseTravelled = (afterRecovery - 1_000_000) / (10_000_000 - 1_000_000);
    expect(dropTravelled).toBeGreaterThan(riseTravelled);
    expect(afterCollapse).toBeLessThan(6_000_000);
    expect(afterRecovery).toBeLessThan(6_000_000);
  });

  it("floors a cached response's duration so it cannot report gigabits", () => {
    // research §6's `minDelayMs = 50`. A segment served from the HTTP cache can
    // complete in well under a millisecond, and the unfloored figure sends the
    // ladder to the top rung on a connection that cannot carry it.
    const estimator = new ThroughputEstimator();
    estimator.onSegmentDownloaded(125_000, 1);
    // 125 KB in the floored 50ms, not in 1ms.
    expect(estimator.estimateBps()).toBeCloseTo(20_000_000, 0);
  });

  it("has no estimate at all before the first sample", () => {
    expect(new ThroughputEstimator().estimateBps()).toBeNull();
  });

  it("ignores a zero-byte response rather than recording a zero-bitrate sample", () => {
    const estimator = new ThroughputEstimator();
    estimator.onSegmentDownloaded(0, 500);
    expect(estimator.estimateBps()).toBeNull();
  });
});

/* -------------------------------------------------------------- scenarios -- */

describe("rendition selection", () => {
  it("cold start: fetches the lowest rung to measure, rather than guessing", () => {
    // research §6 deliberately avoids a `defaultBandwidthEstimateBps`: a guess
    // that is too high stalls immediately and one that is too low wastes a fast
    // connection for the whole first buffer window. A real probe replaces both.
    const decision = decide({ throughputBps: null, currentRenditionId: null, bufferSeconds: 0 });
    expect(decision.rendition.id).toBe("144p");
    expect(decision.reason).toBe("startup-probe");
    expect(startupRendition(LADDER).id).toBe("144p");
  });

  it("a thin buffer forces the lowest rung whatever the pipe says", () => {
    const decision = decide({ throughputBps: 50_000_000, bufferSeconds: 4 });
    expect(decision.rendition.id).toBe("144p");
    expect(decision.reason).toBe("buffer-floor");
  });

  it("throughput collapse: drops several rungs in one step, not one per segment", () => {
    // research §6: "a sudden bandwidth cliff shouldn't require multiple segment
    // boundaries to reach the safe rendition". 500 kbps × 0.9 = 450 kbps, and the
    // highest rung under that is 240p — four rungs down from 1080p in one move.
    const decision = decide({ currentRenditionId: "1080p", throughputBps: 500_000 });
    expect(decision.rendition.id).toBe("240p");
    expect(decision.reason).toBe("throughput");
  });

  it("throughput recovery: climbs several rungs at once when the headroom is real", () => {
    const decision = decide({ currentRenditionId: "144p", throughputBps: 10_000_000 });
    // The up-safety factor is what caps this: 10 Mbps × 0.6 = 6 Mbps, and 1080p
    // at 5 Mbps fits under it.
    expect(decision.rendition.id).toBe("1080p");
    expect(decision.reason).toBe("throughput");
  });

  it("holds when a higher rung is affordable to stay on but not to climb to", () => {
    // 8 Mbps: 1080p fits the 0.9 down-factor comfortably (7.2 Mbps) but not the
    // 0.6 up-factor (4.8 Mbps). This band is the hysteresis, and holding here is
    // the whole anti-flap mechanism.
    const decision = decide({ currentRenditionId: "720p", throughputBps: 8_000_000 });
    expect(decision.rendition.id).toBe("720p");
    expect(decision.reason).toBe("held-headroom");
  });

  it("holds an affordable upswitch that arrives too soon after the last one", () => {
    const held = decide({
      currentRenditionId: "720p",
      throughputBps: 10_000_000,
      segmentsSinceUpSwitch: 1,
    });
    expect(held.rendition.id).toBe("720p");
    expect(held.reason).toBe("held-anti-thrash");

    const allowed = decide({
      currentRenditionId: "720p",
      throughputBps: 10_000_000,
      segmentsSinceUpSwitch: ABR_DEFAULTS.antiThrashSegments,
    });
    expect(allowed.rendition.id).toBe("1080p");
  });

  it("never lets anti-thrash delay a downswitch", () => {
    // Guardrails may only pull the choice down (research §6). A rule that could
    // also delay a drop would turn an anti-oscillation measure into a stall.
    const decision = decide({
      currentRenditionId: "1080p",
      throughputBps: 900_000,
      segmentsSinceUpSwitch: 0,
    });
    expect(decision.rendition.id).toBe("360p");
  });

  it("falls to the lowest rung when even that exceeds the safe throughput", () => {
    const decision = decide({ currentRenditionId: "720p", throughputBps: 100_000 });
    expect(decision.rendition.id).toBe("144p");
  });

  it("applies the InsufficientBufferRule at a configuration where it can bind", () => {
    // At our own defaults this rule is dominated by `bufferLowSeconds` and can
    // never fire — see the comment on `sustainableCeiling`. Both terms are
    // tunable, so the rule is exercised here at a configuration where it does
    // bind: 6s segments, a floor at 2s, and 4s of runway. The pipe would carry
    // 720p (10 Mbps × 0.9 = 9 Mbps); the runway would not (9 Mbps × 4/6 = 6 Mbps
    // still clears 2.8 Mbps, so push the throughput down until it bites).
    const decision = selectRendition({
      ladder: LADDER,
      currentRenditionId: "1080p",
      throughputBps: 4_000_000,
      bufferSeconds: 4,
      segmentDurationSeconds: 6,
      segmentsSinceUpSwitch: 999,
      config: { bufferLowSeconds: 2, bufferHighSeconds: 20 },
    });
    // Down ceiling is 3.6 Mbps; the sustainable ceiling is 3.6 × 4/6 = 2.4 Mbps,
    // which is the binding one and lands on 480p rather than 720p.
    expect(decision.rendition.id).toBe("480p");
    expect(decision.reason).toBe("insufficient-buffer");
    expect(decision.ceilingBps).toBeCloseTo(2_400_000, 0);
  });

  it("does not let a healthy buffer force a downswitch", () => {
    // The regression test for the departure documented on `selectRendition`.
    // research §6's pseudocode re-derives the candidate from the *up* factor once
    // the buffer is full, which would drop a player off 1080p at a measured
    // 8 Mbps — a downswitch caused by the buffer being healthy.
    const decision = decide({
      currentRenditionId: "1080p",
      throughputBps: 8_000_000,
      bufferSeconds: 30,
    });
    expect(decision.rendition.id).toBe("1080p");
  });

  it("throws on an empty ladder rather than inventing a rendition", () => {
    expect(() => decide({ ladder: [] })).toThrow(/at least one rendition/);
  });
});

/* ------------------------------------------------------------ oscillation -- */

describe("oscillation", () => {
  /**
   * Runs a sequence of throughput estimates through the selector, carrying the
   * chosen rendition forward as the next call's `currentRenditionId` — which is
   * what the engine does, and what makes flapping visible at all. A stateless
   * assertion on one call can never catch it.
   */
  function simulate(
    estimates: readonly number[],
    startAt: string,
    bufferSeconds = HEALTHY_BUFFER,
  ): { readonly path: string[]; readonly switches: number } {
    let current = startAt;
    let sinceUp = 999;
    const path: string[] = [];
    let switches = 0;

    for (const throughputBps of estimates) {
      const decision = selectRendition({
        ladder: LADDER,
        currentRenditionId: current,
        throughputBps,
        bufferSeconds,
        segmentDurationSeconds: 2,
        segmentsSinceUpSwitch: sinceUp,
      });
      const next = decision.rendition.id;
      if (next !== current) {
        switches += 1;
        const before = LADDER.find((r) => r.id === current)?.bitrate ?? 0;
        sinceUp = decision.rendition.bitrate > before ? 0 : sinceUp;
      } else {
        sinceUp += 1;
      }
      current = next;
      path.push(current);
    }
    return { path, switches };
  }

  it("does NOT flap between two rungs on a marginal estimate", () => {
    // 1080p is 5 Mbps. Climbing onto it needs 5 / 0.6 = 8.33 Mbps; falling off it
    // needs the estimate below 5 / 0.9 = 5.56 Mbps. Everything between those is
    // the dead band, and an estimate jittering inside it must change nothing.
    //
    // This is the failure everyone ships: narrow the gap between the two safety
    // factors, or apply one of them in both directions, and this sequence
    // alternates 720p/1080p every single segment.
    const jitter = [7.9, 8.2, 7.6, 8.3, 7.8, 8.1, 7.7, 8.25].map((mbps) => mbps * 1_000_000);

    const fromBelow = simulate(jitter, "720p");
    expect(new Set(fromBelow.path)).toEqual(new Set(["720p"]));
    expect(fromBelow.switches).toBe(0);

    const fromAbove = simulate(jitter, "1080p");
    expect(new Set(fromAbove.path)).toEqual(new Set(["1080p"]));
    expect(fromAbove.switches).toBe(0);
  });

  it("still climbs once the estimate genuinely clears the up threshold", () => {
    // The dead band must not become a trap. Same start, an estimate that actually
    // clears 8.33 Mbps, and exactly one switch — not zero, and not one per sample.
    const rising = [7.9, 8.0, 8.6, 8.8, 9.0, 8.7].map((mbps) => mbps * 1_000_000);
    const run = simulate(rising, "720p");
    expect(run.path).toEqual(["720p", "720p", "1080p", "1080p", "1080p", "1080p"]);
    expect(run.switches).toBe(1);
  });

  it("recovers in one step from a collapse and does not bounce on the way back", () => {
    const trace = [
      10_000_000, 10_000_000, // comfortable at the top
      600_000, 600_000, 600_000, // the cliff
      600_000, 620_000, 590_000, // noisy at the bottom
      12_000_000, 12_000_000, 12_000_000, // recovery
    ];
    const run = simulate(trace, "1080p");
    expect(run.path[0]).toBe("1080p");
    expect(run.path[2]).toBe("240p"); // one move down, not four
    expect(run.path.at(-1)).toBe("1080p");
    // Down once, up once. Anything more on this trace is thrashing.
    expect(run.switches).toBe(2);
  });
});

/* ----------------------------------------------------------------- pinned -- */

describe("a manual quality pin", () => {
  it("short-circuits everything, including the buffer floor", () => {
    // research §7: the pin is a hard constraint, not a preference. The player
    // rebuffers *at* the pinned quality rather than silently dropping the viewer
    // to a lower rung — which means the `bufferLowSeconds` floor, the rule most
    // likely to override it, must not.
    const decision = decide({
      pinnedRenditionId: "1080p",
      currentRenditionId: "144p",
      throughputBps: 200_000,
      bufferSeconds: 0,
    });
    expect(decision.rendition.id).toBe("1080p");
    expect(decision.reason).toBe("pinned");
  });

  it("survives a collapse in throughput", () => {
    const decision = decide({ pinnedRenditionId: "720p", throughputBps: 100_000 });
    expect(decision.rendition.id).toBe("720p");
  });

  it("falls back to Auto rather than failing when the pin names a missing rung", () => {
    // A caller bug — a stale pin from a video with a different ladder. Failing
    // playback over it would be worse than quietly choosing.
    const decision = decide({ pinnedRenditionId: "4320p", throughputBps: 6_000_000 });
    expect(decision.rendition.id).toBe("720p");
    expect(decision.reason).not.toBe("pinned");
  });

  it("hands control back when the pin is cleared", () => {
    const decision = decide({ pinnedRenditionId: null, throughputBps: 500_000 });
    expect(decision.rendition.id).toBe("240p");
  });
});

/* ------------------------------------------------------------ abandonment -- */

describe("abandoning an in-flight download", () => {
  const base = {
    ladder: LADDER,
    currentRenditionId: "1080p",
    segmentDurationSeconds: 2,
  } as const;

  it("abandons a download that will not finish inside the remaining runway", () => {
    // A 1080p 2s segment is about 1.25 MB. 200 KB in two seconds is 800 kbps, so
    // the remaining 1.05 MB needs another 10.5s — against 5s of usable runway.
    const decision = shouldAbandon({
      ...base,
      bytesReceived: 200_000,
      expectedTotalBytes: 1_250_000,
      elapsedMs: 2000,
      bufferSeconds: 6,
    });
    expect(decision.abandon).toBe(true);
    if (!decision.abandon) return;
    expect(decision.observedBps).toBeCloseTo(800_000, 0);
    expect(decision.projectedRemainingSeconds).toBeCloseTo(10.5, 3);
    // research §6: use the partial sample rather than discarding it. 800 kbps ×
    // 0.9 = 720 kbps, so 240p — not reflexively the bottom of the ladder.
    expect(decision.restart.id).toBe("240p");
  });

  it("leaves a download alone that will finish with runway to spare", () => {
    const decision = shouldAbandon({
      ...base,
      bytesReceived: 1_000_000,
      expectedTotalBytes: 1_250_000,
      elapsedMs: 500,
      bufferSeconds: 6,
    });
    expect(decision).toEqual({ abandon: false, reason: "on-track" });
  });

  it("will not judge a download from its first few bytes", () => {
    // Connection setup — TLS, the request round trip, TCP slow start — all land
    // inside the first couple of hundred milliseconds, and a rate computed across
    // them reads as a collapse.
    const decision = shouldAbandon({
      ...base,
      bytesReceived: 1000,
      expectedTotalBytes: 1_250_000,
      elapsedMs: 100,
      bufferSeconds: 6,
    });
    expect(decision).toEqual({ abandon: false, reason: "too-early" });
  });

  it("cannot project without a Content-Length, and says so", () => {
    const decision = shouldAbandon({
      ...base,
      bytesReceived: 50_000,
      expectedTotalBytes: null,
      elapsedMs: 2000,
      bufferSeconds: 6,
    });
    expect(decision).toEqual({ abandon: false, reason: "unknown-size" });
  });

  it("never abandons on the lowest rung, which would loop forever", () => {
    // The pseudocode restarts at "the highest rendition the observed throughput
    // can sustain", which on the lowest rung is the lowest rung: the same segment
    // is fetched again on the same bad connection, projected to overrun again,
    // and abandoned again. Bytes transfer forever and nothing plays.
    const decision = shouldAbandon({
      ...base,
      currentRenditionId: "144p",
      bytesReceived: 100,
      expectedTotalBytes: 50_000,
      elapsedMs: 4000,
      bufferSeconds: 0,
    });
    expect(decision).toEqual({ abandon: false, reason: "already-lowest" });
  });

  it("restarts strictly below the rung it abandoned, even when the pipe looks fine", () => {
    // With almost no runway left, `observedBps × 0.9` can still clear the current
    // rung's bitrate — the pipe is fine, the buffer is not — and an unclamped
    // implementation would "restart" at the rung it just gave up on.
    const decision = shouldAbandon({
      ...base,
      currentRenditionId: "240p",
      bytesReceived: 90_000,
      expectedTotalBytes: 100_000,
      elapsedMs: 500,
      bufferSeconds: 0.5,
    });
    expect(decision.abandon).toBe(true);
    if (!decision.abandon) return;
    expect(decision.observedBps).toBeGreaterThan(400_000);
    expect(decision.restart.id).toBe("144p");
  });

  it("drops to the bottom when the observed rate fits no rung at all", () => {
    // 40 KB in four seconds is 80 kbps, under even the 200 kbps rung. Falling
    // back to "the rung just below" would restart at 720p on a connection that
    // cannot carry 144p.
    const decision = shouldAbandon({
      ...base,
      bytesReceived: 40_000,
      expectedTotalBytes: 1_250_000,
      elapsedMs: 4000,
      bufferSeconds: 6,
    });
    expect(decision.abandon).toBe(true);
    if (!decision.abandon) return;
    expect(decision.restart.id).toBe("144p");
  });

  it("treats a completed download as on track rather than dividing by nothing", () => {
    const decision = shouldAbandon({
      ...base,
      bytesReceived: 1_250_000,
      expectedTotalBytes: 1_250_000,
      elapsedMs: 9000,
      bufferSeconds: 0,
    });
    expect(decision).toEqual({ abandon: false, reason: "on-track" });
  });
});
