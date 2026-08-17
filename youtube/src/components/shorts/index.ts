/**
 * The Shorts surface.
 *
 * Three components and one read model. Shorts is a **different presentation of
 * the same library**, not a different entity — `videos.is_short` is derived at
 * publish time from "square-or-taller and ≤180s" and nothing else about a short
 * differs in the schema — so nothing here duplicates a video, a comment or a
 * reaction. What is genuinely different is the chrome (a rail and a metapanel
 * rather than a control bar) and the orchestration of *many* players at once,
 * which is what `shorts-feed.tsx` exists for.
 *
 * The landscape player's chrome lives in `@/components/player` and is not
 * shared: research §10 makes the two structurally different surfaces, and a
 * single component wearing both would be a matrix of flags rather than a
 * player.
 */

export {
  ShortsFeed,
  KEEP_BEHIND,
  PRELOAD_AHEAD,
  SHORTS_MUTED_STORAGE_KEY,
  SWIPE_THRESHOLD_PX,
  WHEEL_COOLDOWN_MS,
  WHEEL_DELTA_THRESHOLD,
  hotIndices,
  indexFromPopState,
  type ShortsFeedProps,
} from "./shorts-feed";

export {
  ShortsPlayer,
  playerOptionsFor,
  type ShortItem,
  type ShortMediaSource,
  type ShortsAutoplayState,
  type ShortsChannelView,
  type ShortsPlayerProps,
} from "./shorts-player";

export {
  ActionRail,
  CommentBubbleIcon,
  RemixIcon,
  type ActionRailChannel,
  type ActionRailProps,
} from "./action-rail";

// From the server-safe module — `/shorts/page.tsx` is a server component.
export { shortHref } from "@/components/video/routes";
