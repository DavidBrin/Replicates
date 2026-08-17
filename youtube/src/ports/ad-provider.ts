/**
 * Advertising, as a seam rather than a business.
 *
 * The shipped adapter is a stub: it returns house ads drawn from the seed
 * corpus, on a fixed schedule, with no targeting and no network call. What
 * makes it worth building at all is that the *shape* is real — a VAST-style
 * request returning creatives with cue points, skip offsets and tracking
 * beacons — so the player's ad handling (pre-roll, mid-roll cues, the skip
 * countdown, the "Ad · 1 of 2" badge, resuming content at the right position)
 * is exercised by something with the same contract a real ad server has.
 *
 * This mirrors how `dollar-pixels` treats payment: play money by default, a
 * real provider one environment variable away, and both settling through the
 * same code so the switch is not a leap of faith.
 */

export type AdSlot = "preroll" | "midroll" | "postroll";

export interface AdCreative {
  readonly id: string;
  /**
   * Where the ad's own media lives. In the stub adapter this is a video in the
   * seed library, which is why it is a blob key rather than an absolute URL —
   * an external ad server would return a URL and the adapter would pass it
   * through unchanged.
   */
  readonly source: { readonly kind: "blob"; readonly key: string } | {
    readonly kind: "url";
    readonly url: string;
  };
  readonly durationSeconds: number;
  readonly advertiser: string;
  readonly clickThroughUrl: string | null;
  /**
   * Seconds after the ad starts before "Skip" becomes active, or `null` for an
   * unskippable ad. YouTube's is five.
   */
  readonly skipAfterSeconds: number | null;
}

export interface AdBreak {
  readonly slot: AdSlot;
  /**
   * Position in the *content* timeline, in seconds. Zero for a pre-roll; the
   * content duration for a post-roll.
   */
  readonly cueSeconds: number;
  /** More than one creative makes an ad pod — "Ad 1 of 2". */
  readonly creatives: readonly AdCreative[];
}

export interface AdRequest {
  readonly videoId: string;
  readonly durationSeconds: number;
  /** Absent for a signed-out viewer. No targeting is done with it either way. */
  readonly viewerId: string | null;
}

/** Fired at the documented points so a real ad server can be billed. */
export type AdEventKind =
  | "impression"
  | "start"
  | "firstQuartile"
  | "midpoint"
  | "thirdQuartile"
  | "complete"
  | "skip"
  | "click";

export interface AdProvider {
  /**
   * The break schedule for one playback. Returning an empty array is the
   * normal, expected answer — most videos in the seed corpus carry no ads, and
   * the player must be correct when there is nothing to play.
   */
  breaksFor(request: AdRequest): Promise<readonly AdBreak[]>;

  /** Report a tracked event. Never throws into playback: log and swallow. */
  report(creativeId: string, event: AdEventKind): Promise<void>;
}
