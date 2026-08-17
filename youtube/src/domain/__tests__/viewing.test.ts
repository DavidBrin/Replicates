import { describe, expect, it } from "vitest";

import {
  VIEW_MIN_WATCHED_FRACTION,
  VIEW_MIN_WATCHED_SECONDS,
  countsAsView,
  viewThresholdSeconds,
} from "../viewing";

/**
 * When a watch becomes a view.
 *
 * The number is assumed and is not what these assert. What they assert is the
 * rule's *shape*, which is where a plausible-looking implementation goes wrong:
 *
 *  - a flat 30 seconds gives every Short a permanent view count of zero;
 *  - a flat fraction lets a 4-second clip count after 2 seconds;
 *  - reading the position rather than watched seconds makes a scrub to the end
 *    a view, which the schema explicitly forbids.
 */

describe("viewThresholdSeconds", () => {
  it("is the flat threshold for anything a minute or longer", () => {
    expect(viewThresholdSeconds(60)).toBe(VIEW_MIN_WATCHED_SECONDS);
    expect(viewThresholdSeconds(600)).toBe(VIEW_MIN_WATCHED_SECONDS);
    expect(viewThresholdSeconds(3600)).toBe(VIEW_MIN_WATCHED_SECONDS);
  });

  it("is a fraction for anything shorter — which is what Shorts are", () => {
    // Without this branch every video under a minute is unviewable, and the
    // Shorts corpus contributes nothing to the recommender at all.
    expect(viewThresholdSeconds(15)).toBe(15 * VIEW_MIN_WATCHED_FRACTION);
    expect(viewThresholdSeconds(30)).toBe(15);
  });

  it("meets the flat rule exactly at a minute", () => {
    // The two rules are chosen so there is no discontinuity: a 59-second video
    // must not need more of itself watched than a 61-second one.
    expect(viewThresholdSeconds(60)).toBe(60 * VIEW_MIN_WATCHED_FRACTION);
  });

  it("falls back to the flat threshold when the duration is unknown", () => {
    // The progressive path reports zero until metadata arrives. A fraction of
    // zero is zero, which would make the first tick of every such video a view.
    expect(viewThresholdSeconds(0)).toBe(VIEW_MIN_WATCHED_SECONDS);
    expect(viewThresholdSeconds(Number.NaN)).toBe(VIEW_MIN_WATCHED_SECONDS);
    expect(viewThresholdSeconds(Number.POSITIVE_INFINITY)).toBe(
      VIEW_MIN_WATCHED_SECONDS,
    );
    expect(viewThresholdSeconds(-5)).toBe(VIEW_MIN_WATCHED_SECONDS);
  });
});

describe("countsAsView", () => {
  it("counts a long video watched past the flat threshold", () => {
    expect(countsAsView({ watchedSeconds: 30, durationSeconds: 600 })).toBe(true);
    expect(countsAsView({ watchedSeconds: 29.9, durationSeconds: 600 })).toBe(false);
  });

  it("counts a short watched past half of it", () => {
    expect(countsAsView({ watchedSeconds: 8, durationSeconds: 15 })).toBe(true);
    expect(countsAsView({ watchedSeconds: 7, durationSeconds: 15 })).toBe(false);
  });

  it("does not count an unstarted or nonsensical watch", () => {
    expect(countsAsView({ watchedSeconds: 0, durationSeconds: 600 })).toBe(false);
    expect(countsAsView({ watchedSeconds: -10, durationSeconds: 600 })).toBe(false);
    expect(countsAsView({ watchedSeconds: Number.NaN, durationSeconds: 600 })).toBe(
      false,
    );
    expect(
      countsAsView({ watchedSeconds: Number.POSITIVE_INFINITY, durationSeconds: 600 }),
    ).toBe(false);
  });

  it("takes watched seconds and has no way to read a position", () => {
    // The schema's rule, as a type-level fact rather than a behaviour: there is
    // no `positionSeconds` on the input, so a caller cannot accidentally pass
    // one where the watched figure belongs. A viewer who dragged an hour-long
    // video's scrubber to the end has watched nothing.
    expect(countsAsView({ watchedSeconds: 0, durationSeconds: 3600 })).toBe(false);
  });
});
