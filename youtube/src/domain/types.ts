/**
 * The entities that cross slice boundaries.
 *
 * Deliberately small. A type belongs here only if two independently-built
 * parts of the application both need to agree on it — a video as the player,
 * the feed, the search results and the recommender all see it; a rendition as
 * both the packager and the ABR selector see it. Everything else stays inside
 * the module that owns it, because a shared type that only one caller uses is
 * just a distant definition.
 *
 * These are read models. They are what a repository returns and what a
 * component renders, not what a table row looks like — `Video` carries its
 * channel's name because every surface that shows a video shows it, and making
 * each caller join for that would be a worse contract than a slightly wider
 * one.
 */

export type Visibility = "public" | "unlisted" | "private";

export type UploadStatus = "uploading" | "processing" | "ready" | "failed";

/**
 * Which of the two upload paths produced a video.
 *
 * This is the single most consequential field in the schema for the player,
 * because the two values select structurally different playback: `laddered`
 * means HLS over Media Source with adaptive switching, `progressive` means a
 * plain `<video src>` over HTTP `Range` with one quality and no switching at
 * all. Roughly one browser in twenty cannot encode in the page and produces
 * the latter.
 */
export type Pipeline = "laddered" | "progressive";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: Date;
}

export interface Channel {
  readonly id: string;
  readonly ownerId: string;
  /** Without the leading `@`. */
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  readonly avatarKey: string | null;
  readonly bannerKey: string | null;
  /**
   * The tick beside the channel name.
   *
   * A stored decision rather than a subscriber threshold evaluated at read
   * time: the real thing is a manual eligibility judgement, and a computed one
   * would flicker on and off as a count crossed the boundary — a channel that
   * is verified on the home page and not on its own page, because the two
   * queries ran a second apart.
   */
  readonly verified: boolean;
  readonly subscriberCount: number;
  readonly videoCount: number;
  readonly createdAt: Date;
}

/** One rung of the ladder, as the player's selector sees it. */
export interface Rendition {
  /** The label the quality menu shows: `1080p`, `720p`, … */
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /**
   * Measured average bits per second, as written into the master playlist.
   * The ABR selector compares this against measured throughput, so it must be
   * what the segments actually weigh rather than what the encoder was asked
   * for.
   */
  readonly bandwidth: number;
  /** RFC 6381, e.g. `avc1.4d401f`. Negotiated at encode time. */
  readonly codec: string;
  readonly frameRate: number;
  readonly initKey: string;
  readonly playlistKey: string;
  readonly segmentCount: number;
  readonly totalBytes: number;
}

export interface Video {
  readonly id: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelHandle: string;
  readonly channelAvatarKey: string | null;
  readonly title: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly uploadStatus: UploadStatus;
  readonly pipeline: Pipeline;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly isShort: boolean;
  readonly masterPlaylistKey: string | null;
  readonly progressiveKey: string | null;
  readonly thumbnailKey: string | null;
  readonly previewKey: string | null;
  readonly viewCount: number;
  readonly likeCount: number;
  readonly dislikeCount: number;
  readonly commentCount: number;
  readonly commentsEnabled: boolean;
  readonly category: string;
  readonly tags: readonly string[];
  /**
   * Credit for third-party licensed source material — `Blender Foundation |
   * www.blender.org`, `CC BY 3.0`, and the licence's URL.
   *
   * Separate from `description` on purpose, and the schema makes the same point
   * at greater length: CC-BY *requires* attribution, and a credit living in the
   * description satisfies that exactly until the uploader edits their
   * description, at which point the obligation is dropped by a field that was
   * never meant to carry one. Three columns are the difference between honouring
   * the terms and appearing to.
   *
   * `null` for the ordinary case — a creator's own footage owes nobody a credit.
   */
  readonly attribution: string | null;
  readonly licence: string | null;
  readonly licenceUrl: string | null;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * What a feed row needs and nothing more.
 *
 * The home grid renders on the order of forty of these at once, and the watch
 * page's sidebar twenty more. Sending the full description with each — which
 * on a real channel runs to several hundred words of links and timestamps —
 * would multiply the payload of every feed in the application by an order of
 * magnitude for text no card displays.
 */
export interface VideoCard {
  readonly id: string;
  readonly title: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly channelHandle: string;
  readonly channelAvatarKey: string | null;
  /**
   * The tick in the card's metadata row, beside the channel name.
   *
   * On the card rather than fetched per row: it appears on essentially every
   * card in the reference screenshots, and a feed that asked for it separately
   * would be forty round trips for a boolean the channel join already has.
   */
  readonly channelVerified: boolean;
  readonly thumbnailKey: string | null;
  readonly previewKey: string | null;
  readonly durationSeconds: number;
  readonly viewCount: number;
  readonly publishedAt: Date | null;
  readonly isShort: boolean;
  /**
   * The viewer's position, when there is one — this is the red bar under the
   * thumbnail. `null` for a video the viewer has not started, which is not the
   * same as `0`.
   */
  readonly watchedSeconds: number | null;
}

export interface Comment {
  readonly id: string;
  readonly videoId: string;
  readonly parentId: string | null;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorAvatarKey: string | null;
  readonly body: string;
  readonly likeCount: number;
  readonly replyCount: number;
  readonly isPinned: boolean;
  readonly hearted: boolean;
  /** The signed-in viewer's own reaction, if any. */
  readonly viewerReaction: -1 | 1 | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
}

export type PlaylistKind = "user" | "watch_later" | "liked";

export interface Playlist {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly title: string;
  readonly description: string;
  readonly visibility: Visibility;
  readonly kind: PlaylistKind;
  readonly itemCount: number;
  /** The first item's thumbnail, which is what the playlist card shows. */
  readonly thumbnailKey: string | null;
  readonly updatedAt: Date;
}

/* ------------------------------------------------------------ formatting -- */

/**
 * View counts, subscriber counts and timestamps have exact presentation rules
 * that are part of looking right, and they are shared by the card, the watch
 * page, the search result and the channel header. They live beside the types
 * rather than in a component so that four surfaces cannot drift into four
 * roundings of the same number.
 *
 * The rules themselves are measured, not invented — see
 * `research/08-youtube-ui-measured.md`.
 */
export interface FormattedCounts {
  /** `1.2M views` — abbreviated, for a card. */
  readonly abbreviated: string;
  /** `1,234,567 views` — exact, for the watch page. */
  readonly exact: string;
}
