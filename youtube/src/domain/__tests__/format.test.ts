import { describe, expect, it } from "vitest";

import {
  COUNT_ABBREVIATION_FLOOR,
  DAYS_BEFORE_WEEKS,
  SUBSCRIBER_SIGNIFICANT_DIGITS,
  VIEW_SIGNIFICANT_DIGITS,
  dayKeyInZone,
  describeDuration,
  exactCount,
  formatAbsoluteDate,
  formatCommentCount,
  formatCompactCount,
  formatCompactRelativeTime,
  formatDayHeading,
  formatDuration,
  formatLikeCount,
  formatRelativeTime,
  formatSubscriberCount,
  formatVideoCount,
  formatViewCount,
  formatViewCounts,
  formatWatchingCount,
} from "../format";

/**
 * Cases marked "captured" are strings YouTube actually rendered, lifted from
 * `research/extracted/copy-and-formats.json`,
 * `research/extracted/watch-comments-formats.json` and
 * `research/extracted/card-dump-1920.json`, and tabulated in
 * `research/08-youtube-ui-measured.md` §8.
 *
 * They are asserted as data rather than paraphrased into round numbers, because
 * round numbers cannot tell the three formatters apart: 1,000,000 is `1M` under
 * every rule anyone might write, and every one of the interesting differences
 * lives in the digits after it.
 */

describe("views round to two significant digits", () => {
  it("writes counts below a thousand in full", () => {
    // Captured: `113 views`, `489 views`, `812 views` — which is the evidence
    // R8 §8.1 says it did not find, sitting in `card-dump-1920.json`.
    expect(formatViewCount(113)).toBe("113 views");
    expect(formatViewCount(489)).toBe("489 views");
    expect(formatViewCount(812)).toBe("812 views");
  });

  it("switches to K, M and B at exactly the unit", () => {
    expect(formatViewCount(999)).toBe("999 views");
    expect(formatViewCount(1_000)).toBe("1K views");
    expect(formatViewCount(999_999)).toBe("999K views");
    expect(formatViewCount(1_000_000)).toBe("1M views");
    expect(formatViewCount(999_999_999)).toBe("999M views");
    expect(formatViewCount(1_000_000_000)).toBe("1B views");
  });

  it.each([
    // Every row is a string R8 tabulated in §8.1.
    [1_800, "1.8K views"],
    [2_600, "2.6K views"],
    [9_800, "9.8K views"],
    [10_000, "10K views"],
    [104_000, "104K views"],
    [961_368, "961K views"],
    [1_100_000, "1.1M views"],
    [3_400_000, "3.4M views"],
    [9_400_000, "9.4M views"],
    [11_000_000, "11M views"],
    [137_000_000, "137M views"],
    [694_000_000, "694M views"],
    [1_200_000_000, "1.2B views"],
    [2_600_000_000, "2.6B views"],
    [4_400_000_000, "4.4B views"],
  ])("renders %d as %s", (count, expected) => {
    expect(formatViewCount(count)).toBe(expected);
  });

  it("never writes a trailing .0", () => {
    // Captured: `1K views`, `1M views`, `2M views`, `3M views`, `1B views`.
    expect(formatViewCount(1_000)).toBe("1K views");
    expect(formatViewCount(2_000_000)).toBe("2M views");
    expect(formatViewCount(4_009_000)).toBe("4M views");
    expect(formatViewCount(1_000_000_000)).toBe("1B views");
  });

  it("truncates rather than rounding", () => {
    expect(formatViewCount(1_999_999)).toBe("1.9M views");
    expect(formatViewCount(1_950_000)).toBe("1.9M views");
    expect(formatViewCount(9_999)).toBe("9.9K views");
    expect(formatViewCount(19_999)).toBe("19K views");
  });

  it("is exact on the tenths that floating-point division rounds down", () => {
    // `Math.floor(2_900_000 / 1_000_000 * 10)` is 28 on IEEE-754 doubles, so an
    // implementation that divides before multiplying writes `2.8M` here.
    expect(formatViewCount(2_900_000)).toBe("2.9M views");
    expect(formatViewCount(8_700_000)).toBe("8.7M views");
    expect(formatViewCount(2_900_000_000)).toBe("2.9B views");
  });

  it("uses the singular at one and says No views at zero", () => {
    expect(formatViewCount(1)).toBe("1 view");
    expect(formatViewCount(2)).toBe("2 views");
    expect(formatViewCount(0)).toBe("No views");
  });

  it("treats a negative or non-finite count as zero", () => {
    expect(formatViewCount(-5)).toBe("No views");
    expect(formatViewCount(Number.NaN)).toBe("No views");
  });
});

describe("subscriber counts keep three significant digits", () => {
  it.each([
    // R8 §8.1's full sample, plus `222K subscribers` from the watch capture.
    [218_000, "218K subscribers"],
    [222_000, "222K subscribers"],
    [393_000, "393K subscribers"],
    [1_000_000, "1M subscribers"],
    [1_240_000, "1.24M subscribers"],
    [1_690_000, "1.69M subscribers"],
    [3_350_000, "3.35M subscribers"],
    [7_060_000, "7.06M subscribers"],
    [15_100_000, "15.1M subscribers"],
    [15_500_000, "15.5M subscribers"],
    [21_100_000, "21.1M subscribers"],
  ])("renders %d as %s", (count, expected) => {
    expect(formatSubscriberCount(count)).toBe(expected);
  });

  it("keeps an interior zero that a two-digit rule would round away", () => {
    // The case the whole split exists for. A shared formatter passes every
    // view-count test above and produces `7.1M` here.
    expect(formatSubscriberCount(7_060_000)).toBe("7.06M subscribers");
    expect(formatViewCount(7_060_000)).toBe("7M views");
  });

  it("still drops a trailing zero", () => {
    // Captured: `1M subscribers`, not `1.00M`.
    expect(formatSubscriberCount(1_000_000)).toBe("1M subscribers");
    expect(formatSubscriberCount(7_600_000)).toBe("7.6M subscribers");
    expect(formatSubscriberCount(7_000_000)).toBe("7M subscribers");
  });

  it("truncates like the view ladder does", () => {
    expect(formatSubscriberCount(7_069_999)).toBe("7.06M subscribers");
    expect(formatSubscriberCount(999_999)).toBe("999K subscribers");
  });

  it("is exact below a thousand, singular at one, absent at zero", () => {
    expect(formatSubscriberCount(999)).toBe("999 subscribers");
    expect(formatSubscriberCount(1)).toBe("1 subscriber");
    expect(formatSubscriberCount(0)).toBe("No subscribers");
  });
});

/**
 * The two ladders side by side. Each of these counts is rendered differently by
 * the two formatters, and a single shared implementation cannot satisfy both
 * columns — which is the entire argument for splitting them.
 */
describe("the two ladders genuinely disagree", () => {
  it.each([
    [1_240_000, "1.2M views", "1.24M subscribers"],
    [1_690_000, "1.6M views", "1.69M subscribers"],
    [3_350_000, "3.3M views", "3.35M subscribers"],
    [7_060_000, "7M views", "7.06M subscribers"],
    [15_500_000, "15M views", "15.5M subscribers"],
    [21_100_000, "21M views", "21.1M subscribers"],
    [218_400, "218K views", "218K subscribers"],
  ])("%d is %s but %s", (count, asViews, asSubscribers) => {
    expect(formatViewCount(count)).toBe(asViews);
    expect(formatSubscriberCount(count)).toBe(asSubscribers);
  });

  it("names its two digit counts rather than hiding them in a call", () => {
    expect(VIEW_SIGNIFICANT_DIGITS).toBe(2);
    expect(SUBSCRIBER_SIGNIFICANT_DIGITS).toBe(3);
    expect(COUNT_ABBREVIATION_FLOOR).toBe(1_000);
  });
});

describe("the sidebar drops the noun", () => {
  it("renders a bare abbreviated count", () => {
    // Captured: a play glyph plus `858K`, with no "views".
    expect(formatCompactCount(858_000)).toBe("858K");
    expect(formatCompactCount(1_100_000)).toBe("1.1M");
    expect(formatCompactCount(318_000)).toBe("318K");
  });

  it("uses the view ladder, not the subscriber one", () => {
    expect(formatCompactCount(7_060_000)).toBe("7M");
  });

  it("renders nothing at zero, because the button shows only its icon", () => {
    expect(formatCompactCount(0)).toBe("");
  });

  it("is what the like button uses — captured as 6.2K", () => {
    expect(formatLikeCount(6_259)).toBe("6.2K");
    // …while the aria-label beside it carries the exact figure.
    expect(exactCount(6_259)).toBe("6,259");
  });
});

describe("the counts that are never abbreviated", () => {
  it("writes the comment header exactly, with a capital noun", () => {
    // Captured: `233 Comments` at 15px/700.
    expect(formatCommentCount(233)).toBe("233 Comments");
    expect(formatCommentCount(3_247)).toBe("3,247 Comments");
    expect(formatCommentCount(1)).toBe("1 Comment");
    expect(formatCommentCount(0)).toBe("0 Comments");
  });

  it("writes the channel's video count exactly, with a lowercase noun", () => {
    // Captured: `526 videos`, `12 videos`, `623 videos`.
    expect(formatVideoCount(526)).toBe("526 videos");
    expect(formatVideoCount(12)).toBe("12 videos");
    expect(formatVideoCount(1)).toBe("1 video");
  });

  it("writes concurrent viewers exactly", () => {
    // Captured: `728 watching`, `338 watching`.
    expect(formatWatchingCount(728)).toBe("728 watching");
    expect(formatWatchingCount(338)).toBe("338 watching");
  });

  it("groups thousands with commas regardless of the host locale", () => {
    expect(exactCount(961_368)).toBe("961,368");
    expect(exactCount(999)).toBe("999");
    expect(exactCount(1_000)).toBe("1,000");
  });
});

describe("formatViewCounts pairs the two renderings", () => {
  it("gives the card's string and the expanded panel's from one rounding", () => {
    // Both captured on the same video: the info line says `961K views`, the
    // expanded description panel says `961,368 views`.
    expect(formatViewCounts(961_368)).toEqual({
      abbreviated: "961K views",
      exact: "961,368 views",
    });
  });

  it("agrees with the standalone view formatter", () => {
    for (const count of [812, 9_800, 961_368, 7_060_000, 4_400_000_000]) {
      expect(formatViewCounts(count).abbreviated).toBe(formatViewCount(count));
    }
  });

  it("uses the singular and the zero case in both halves", () => {
    expect(formatViewCounts(1)).toEqual({
      abbreviated: "1 view",
      exact: "1 view",
    });
    expect(formatViewCounts(0)).toEqual({
      abbreviated: "No views",
      exact: "No views",
    });
  });
});

describe("formatDuration", () => {
  it("matches every duration shape in the capture", () => {
    expect(formatDuration(49)).toBe("0:49");
    expect(formatDuration(89)).toBe("1:29");
    expect(formatDuration(130)).toBe("2:10");
    expect(formatDuration(574)).toBe("9:34");
    expect(formatDuration(737)).toBe("12:17");
    // R8 §4's own example badge.
    expect(formatDuration(1_821)).toBe("30:21");
    expect(formatDuration(5_690)).toBe("1:34:50");
    expect(formatDuration(7_943)).toBe("2:12:23");
  });

  it("switches to H:MM:SS at exactly one hour", () => {
    expect(formatDuration(3_599)).toBe("59:59");
    expect(formatDuration(3_600)).toBe("1:00:00");
  });

  it("pads minutes only once hours lead", () => {
    expect(formatDuration(305)).toBe("5:05");
    expect(formatDuration(3_905)).toBe("1:05:05");
  });

  it("truncates fractional seconds so the badge never overstates", () => {
    expect(formatDuration(61.5)).toBe("1:01");
    expect(formatDuration(119.999)).toBe("1:59");
  });

  it("clamps nonsense to zero", () => {
    expect(formatDuration(-10)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});

describe("describeDuration", () => {
  it("spells the duration out for a screen reader", () => {
    expect(describeDuration(1_800)).toBe("30 minutes");
    expect(describeDuration(14_400)).toBe("4 hours");
    expect(describeDuration(5_690)).toBe("1 hour, 34 minutes, 50 seconds");
    expect(describeDuration(1)).toBe("1 second");
    expect(describeDuration(0)).toBe("0 seconds");
  });
});

describe("relative time, spelled out", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const before = (ms: number) => new Date(now.getTime() - ms);

  const SECOND = 1_000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("counts seconds up to the minute boundary", () => {
    expect(formatRelativeTime(before(0), now)).toBe("0 seconds ago");
    expect(formatRelativeTime(before(SECOND), now)).toBe("1 second ago");
    expect(formatRelativeTime(before(59 * SECOND), now)).toBe("59 seconds ago");
    expect(formatRelativeTime(before(60 * SECOND), now)).toBe("1 minute ago");
  });

  it("counts minutes up to the hour boundary", () => {
    expect(formatRelativeTime(before(59 * MINUTE), now)).toBe("59 minutes ago");
    expect(formatRelativeTime(before(59 * MINUTE + 59 * SECOND), now)).toBe(
      "59 minutes ago",
    );
    expect(formatRelativeTime(before(60 * MINUTE), now)).toBe("1 hour ago");
  });

  it("counts hours up to the day boundary", () => {
    // Captured: `11 hours ago`.
    expect(formatRelativeTime(before(11 * HOUR), now)).toBe("11 hours ago");
    expect(formatRelativeTime(before(23 * HOUR + 59 * MINUTE), now)).toBe(
      "23 hours ago",
    );
    expect(formatRelativeTime(before(24 * HOUR), now)).toBe("1 day ago");
  });

  it("counts days past a week, which the captures prove it does", () => {
    // `7 days ago` and `10 days ago` both appear alongside `2 weeks ago`.
    expect(formatRelativeTime(before(7 * DAY), now)).toBe("7 days ago");
    expect(formatRelativeTime(before(10 * DAY), now)).toBe("10 days ago");
    expect(formatRelativeTime(before(13 * DAY), now)).toBe("13 days ago");
  });

  it("switches to weeks at fourteen days and never says 1 week", () => {
    expect(DAYS_BEFORE_WEEKS).toBe(14);
    expect(formatRelativeTime(before(14 * DAY), now)).toBe("2 weeks ago");
    expect(formatRelativeTime(before(21 * DAY), now)).toBe("3 weeks ago");
    expect(formatRelativeTime(before(27 * DAY), now)).toBe("3 weeks ago");
  });

  it("switches to months on the calendar, not on a thirty-day constant", () => {
    // 31 January to 2 March is 30 days and two calendar page-turns, but only
    // one whole month.
    expect(
      formatRelativeTime(
        new Date("2026-01-31T00:00:00.000Z"),
        new Date("2026-03-02T00:00:00.000Z"),
      ),
    ).toBe("1 month ago");

    expect(
      formatRelativeTime(
        new Date("2026-01-15T00:00:00.000Z"),
        new Date("2026-02-14T23:00:00.000Z"),
      ),
    ).toBe("4 weeks ago");

    expect(
      formatRelativeTime(
        new Date("2026-01-15T00:00:00.000Z"),
        new Date("2026-02-15T00:00:00.000Z"),
      ),
    ).toBe("1 month ago");
  });

  it("counts months up to a year and then years", () => {
    expect(
      formatRelativeTime(
        new Date("2025-10-16T12:00:00.000Z"),
        new Date("2026-08-16T12:00:00.000Z"),
      ),
    ).toBe("10 months ago");

    expect(
      formatRelativeTime(
        new Date("2025-08-17T12:00:00.000Z"),
        new Date("2026-08-16T12:00:00.000Z"),
      ),
    ).toBe("11 months ago");

    expect(
      formatRelativeTime(
        new Date("2025-08-16T12:00:00.000Z"),
        new Date("2026-08-16T12:00:00.000Z"),
      ),
    ).toBe("1 year ago");

    // Captured: `17 years ago`.
    expect(
      formatRelativeTime(
        new Date("2009-08-16T12:00:00.000Z"),
        new Date("2026-08-16T12:00:00.000Z"),
      ),
    ).toBe("17 years ago");
  });

  it("clamps a scheduled premiere rather than counting forward", () => {
    expect(formatRelativeTime(new Date(now.getTime() + HOUR), now)).toBe(
      "0 seconds ago",
    );
  });
});

describe("relative time, abbreviated for the sidebar", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const DAY = 24 * 60 * 60 * 1_000;
  const before = (ms: number) => new Date(now.getTime() - ms);

  it.each([
    // Every one of these appears in the captured sidebar.
    [2 * DAY, "2d ago"],
    [7 * DAY, "7d ago"],
    [14 * DAY, "2w ago"],
    [21 * DAY, "3w ago"],
    [28 * DAY, "4w ago"],
  ])("renders an age of %dms as %s", (age, expected) => {
    expect(formatCompactRelativeTime(before(age), now)).toBe(expected);
  });

  it("abbreviates months as `mo`, so they cannot read as minutes", () => {
    expect(
      formatCompactRelativeTime(
        new Date("2026-07-16T12:00:00.000Z"),
        now,
      ),
    ).toBe("1mo ago");
    expect(
      formatCompactRelativeTime(
        new Date("2026-04-16T12:00:00.000Z"),
        now,
      ),
    ).toBe("4mo ago");
    expect(
      formatCompactRelativeTime(
        new Date("2025-11-16T12:00:00.000Z"),
        now,
      ),
    ).toBe("9mo ago");
  });

  it("abbreviates years", () => {
    expect(
      formatCompactRelativeTime(new Date("2025-08-16T12:00:00.000Z"), now),
    ).toBe("1y ago");
    expect(
      formatCompactRelativeTime(new Date("2024-08-16T12:00:00.000Z"), now),
    ).toBe("2y ago");
  });

  it("never pluralises and never spaces the unit", () => {
    for (const age of [2 * DAY, 21 * DAY, 400 * DAY]) {
      expect(formatCompactRelativeTime(before(age), now)).toMatch(
        /^\d+(s|m|h|d|w|mo|y) ago$/,
      );
    }
  });

  /**
   * The two renderings share one ladder, so they can differ in spelling and
   * never in *when* a unit changes. A sidebar reading `4w ago` beside a card
   * reading `1 month ago` for the same video is the bug two formatters invite.
   */
  it("flips units at exactly the same instants as the spelled-out form", () => {
    const boundaries = [
      59_000,
      60_000,
      59 * 60_000,
      60 * 60_000,
      23 * 3_600_000,
      DAY,
      13 * DAY,
      14 * DAY,
      27 * DAY,
      400 * DAY,
    ];
    // Two extractors, because one cannot serve both: a single `s?` for the
    // plural also eats the `s` that *is* the compact unit for seconds, which is
    // how this assertion first failed against correct output.
    const spelledUnit = (s: string) => /^\d+ ([a-z]+?)s? ago$/.exec(s)?.[1];
    const compactUnit = (s: string) => /^\d+(\S+) ago$/.exec(s)?.[1];
    const compactFor: Record<string, string> = {
      second: "s",
      minute: "m",
      hour: "h",
      day: "d",
      week: "w",
      month: "mo",
      year: "y",
    };

    for (const age of boundaries) {
      const when = before(age);
      const spelled = spelledUnit(formatRelativeTime(when, now));
      const compact = compactUnit(formatCompactRelativeTime(when, now));
      expect(spelled).toBeDefined();
      expect(compact).toBe(compactFor[spelled ?? ""]);
    }
  });
});

describe("absolute dates", () => {
  it("writes the expanded panel's publish date", () => {
    // Captured beside `961,368 views`: `Oct 7, 2025`.
    expect(formatAbsoluteDate(new Date("2025-10-07T00:00:00.000Z"))).toBe(
      "Oct 7, 2025",
    );
  });
});

describe("day grouping", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");

  it("names today and yesterday before falling back to a date", () => {
    expect(formatDayHeading(new Date("2026-08-16T23:00:00.000Z"), now)).toBe(
      "Today",
    );
    expect(formatDayHeading(new Date("2026-08-15T01:00:00.000Z"), now)).toBe(
      "Yesterday",
    );
    expect(formatDayHeading(new Date("2026-08-14T01:00:00.000Z"), now)).toBe(
      "14 August 2026",
    );
  });

  it("puts a late-evening watch on the viewer's day, not on UTC's", () => {
    // 23:30 in New York is 03:30 the next morning in UTC.
    const lateNight = new Date("2026-08-17T03:30:00.000Z");
    expect(dayKeyInZone(lateNight, "America/New_York")).toBe("2026-08-16");
    expect(dayKeyInZone(lateNight, "UTC")).toBe("2026-08-17");
  });
});
