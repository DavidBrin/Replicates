/**
 * The channel page's two components.
 *
 * Both are measured against `research/extracted/channel-and-shorts.json`
 * (`chanHome`, captured at 1920) and R8 §3.7, with the subscribed state's
 * geometry from `research/09-youtube-signedin-surfaces.md` §9.1 — the one part
 * of a channel header that a logged-out capture cannot show.
 *
 * `channel-header.tsx` is a client component (the description's expander and
 * the notification menu both hold state); `channel-tabs.tsx` is not, because
 * the tabs are links and a link needs no state. That split is why they are two
 * files rather than one.
 */

export {
  ChannelHeader,
  SubscribeButton,
  type ChannelHeaderProps,
  type SubscribeButtonProps,
  type SubscriptionLevel,
} from "./channel-header";

export {
  CHANNEL_TABS,
  ChannelTabs,
  channelTabFromSegment,
  channelTabHref,
  type ChannelTab,
  type ChannelTabsProps,
} from "./channel-tabs";
