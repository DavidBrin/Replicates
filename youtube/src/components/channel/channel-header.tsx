"use client";

import clsx from "clsx";
import { useState, type ReactNode } from "react";

import {
  Avatar,
  Button,
  Menu,
  MenuItem,
  buttonClassName,
  type MenuTriggerProps,
} from "@/components/primitives";
import { BellIcon, ChevronIcon, VerifiedIcon } from "@/components/icons";
import { formatSubscriberCount, formatVideoCount } from "@/domain/format";

/**
 * The channel page's header: banner, avatar, identity line, description and
 * the Subscribe control.
 *
 * ## Measurements
 *
 * `research/extracted/channel-and-shorts.json` → `chanHome.header` /
 * `chanHome.headerDump`, captured at 1920 with the guide expanded, so the
 * content column is 1284 wide at x=438. R8 §3.7 is the same capture summarised.
 *
 * ```
 * yt-image-banner-view-model     1284 × 206.98   radius 16px   (6.2 : 1)
 * yt-page-header-view-model      1284 × 196      16px below the banner
 *   yt-avatar-shape               160 × 160      round; 18px in from the
 *                                                header's top and bottom, i.e.
 *                                                vertically centred in the 196
 *   text column @ x=614  (avatar 160 + 16px gap)
 *     h1                          36px / 50px  w700          + a 24px tick
 *     yt-content-metadata          14px / 20px  w400  #606060
 *                                  «@handle • N subscribers • N videos»
 *     yt-description-preview       14px / 20px  w400, ONE 20px line, 600 wide,
 *                                  then a «...more» button at 14/20 w500
 *     yt-flexible-actions          40 tall      → the Subscribe button
 * ```
 *
 * Three honest gaps in that capture:
 *
 * * **The banner's aspect ratio is derived, not stated.** 1284 × 206.98 is
 *   6.203 : 1 at one width. It is reproduced as an `aspect-ratio` because a
 *   fixed 207px height would letterbox at every other column width, and a
 *   banner is the one image on the page whose art is composed for a ratio.
 * * **The links row is not built.** The capture has a
 *   `yt-attribution-view-model` carrying one link plus "and 6 more links", and
 *   `channels` has no column for it — there is nothing to render. Adding a
 *   column is another slice's decision.
 * * **The handle's own colour disagrees with the screenshot.** The dump gives
 *   the inner `@handle` span `w500 rgb(19,19,19)` inside a `w400 rgb(96,96,96)`
 *   parent, while `screenshots/17-channel-home-1920.png` shows the whole line
 *   in one grey. The screenshot is what a reader compares against, so the row
 *   is rendered uniformly secondary and the dump's inner span is treated as an
 *   inherited-but-overpainted link style.
 *
 * ## Why this file is a client component
 *
 * Two of its parts hold state — the description's expander and the subscribe
 * toggle — and `Menu`'s trigger is a render prop, which cannot cross the RSC
 * boundary. Every prop below is therefore serialisable: strings, numbers,
 * booleans and one string union. The page resolves the channel row and hands
 * over primitives.
 *
 * ## Motion
 *
 * None, per `research/extracted/theme-light-dark-hover-motion.json`. The
 * expander swaps a clamp; it does not animate a height.
 */

/**
 * The bell's three levels.
 *
 * Structurally identical to `NotificationLevel` in
 * `src/adapters/repositories/subscriptions.ts`, and deliberately re-declared
 * rather than imported: that module is `server-only`, so importing it here
 * would be a build error in Next and a lie in Vitest, where `server-only` is
 * aliased away. The two are tied together at the API boundary — the route's
 * `z.enum` result is passed straight to `subscribe()`, so a divergence is a
 * type error there rather than a runtime surprise here.
 */
export type SubscriptionLevel = "all" | "personalised" | "none";

/** Label per level, as the notification menu lists them (R9 §9.1). */
const LEVEL_LABELS: Readonly<Record<SubscriptionLevel, string>> = {
  all: "All",
  personalised: "Personalised",
  none: "None",
};

const LEVEL_ORDER: readonly SubscriptionLevel[] = ["all", "personalised", "none"];

export interface SubscribeButtonProps {
  channelId: string;
  channelName: string;
  /** `null` when the viewer does not follow this channel. */
  level: SubscriptionLevel | null;
  /**
   * Signed out still renders the button — `screenshots/17-channel-home-1920.png`
   * is a logged-out capture and the Subscribe pill is in it. Pressing it says
   * so rather than posting a request that can only come back 401.
   */
  signedIn?: boolean;
  /** Hidden entirely on your own channel; the repository refuses it as a rule. */
  ownedByViewer?: boolean;
}

/**
 * Subscribe, and the state that is *not* a "Subscribed" text button.
 *
 * R9 §9.1 measured both buttons in the slot and recorded which one the current
 * build shows:
 *
 * | state | button | size | classes |
 * |---|---|---|---|
 * | not subscribed | «Subscribe» | 102.4 × 40 | `Filled Mono SizeM` |
 * | **subscribed** | **bell + chevron, no text** | **74 × 40** | `Tonal Mono SizeM IconLeadingTrailingNoText` |
 * | (alt subscribed) | «Subscribed» | 102.4 × 40 | `Tonal Mono SizeM` |
 *
 * The alternate text pill exists in the DOM and is *not* what is displayed, so
 * building it is the natural mistake this component exists to avoid. The 74px
 * width is exact and its arithmetic is `16 + 24 + 18 + 16`: the 16px side
 * padding R9 records, a 24px bell, an 18px chevron, and no gap between the two
 * glyphs. A 24px chevron would need 80px and does not fit the measurement.
 *
 * Clicking the subscribed pill opens the notification-level menu — All /
 * Personalised / None / Unsubscribe — which is the only reason the chevron is
 * there.
 */
export function SubscribeButton({
  channelId,
  channelName,
  level,
  signedIn = true,
  ownedByViewer = false,
}: SubscribeButtonProps) {
  const [current, setCurrent] = useState<SubscriptionLevel | null>(level);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // `subscriptions.subscribe` throws `CannotSubscribeToOwnChannelError`, and
  // the repository's own comment says the product hides the button rather than
  // refusing the press. Hiding it here is that half of the rule.
  if (ownedByViewer) return null;

  const post = async (body: unknown, next: SubscriptionLevel | null): Promise<void> => {
    const previous = current;
    // Optimistic, then reconciled: the bell is a two-state pill and waiting a
    // round trip to redraw it reads as a dropped click.
    setCurrent(next);
    setPending(true);
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setCurrent(previous);
        setNotice("That did not save. Try again.");
        return;
      }
      setNotice(null);
    } catch {
      setCurrent(previous);
      setNotice("That did not save. Try again.");
    } finally {
      setPending(false);
    }
  };

  if (current === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="filled"
          size="m"
          disabled={pending}
          data-subscribe=""
          onClick={() => {
            if (!signedIn) {
              // No sign-in route exists in this application yet, so there is
              // nowhere honest to send them. Saying so beats a 401 the button
              // would have to explain anyway.
              setNotice("Sign in to subscribe to this channel.");
              return;
            }
            void post(
              { action: "subscribe", channelId, notifications: "personalised" },
              "personalised",
            );
          }}
        >
          Subscribe
        </Button>
        {notice === null ? null : (
          <span role="status" className="text-small text-secondary">
            {notice}
          </span>
        )}
      </div>
    );
  }

  const label = `Notifications for ${channelName}: ${LEVEL_LABELS[current]}`;

  return (
    <div className="flex flex-col items-start gap-2">
      <Menu
        align="start"
        label={label}
        trigger={(triggerProps) => (
          <SubscribedPillTrigger label={label} triggerProps={triggerProps} />
        )}
      >
        {LEVEL_ORDER.map((option) => (
          <MenuItem
            key={option}
            role="menuitemradio"
            checked={current === option}
            onSelect={() => {
              void post(
                { action: "notifications", channelId, notifications: option },
                option,
              );
            }}
          >
            {LEVEL_LABELS[option]}
          </MenuItem>
        ))}
        <MenuItem
          onSelect={() => {
            void post({ action: "unsubscribe", channelId }, null);
          }}
        >
          Unsubscribe
        </MenuItem>
      </Menu>
      {notice === null ? null : (
        <span role="status" className="text-small text-secondary">
          {notice}
        </span>
      )}
    </div>
  );
}

/**
 * The 74×40 pill, as `Menu`'s trigger.
 *
 * A bare `<button>` wearing {@link buttonClassName} rather than `Button`, for
 * the reason `video-card.tsx`'s `CardMenu` gives: `Menu` hands its trigger a
 * callback ref and `ButtonProps` is built on `ComponentPropsWithoutRef`. The
 * `Fill` sibling is reproduced by hand so the pill still cross-fades an overlay
 * instead of swapping a background — R9 §14 names that swap as the most visible
 * "not quite YouTube" tell.
 */
function subscribedPillClassName(): string {
  return buttonClassName({
    variant: "tonal",
    size: "m",
    // 74px exactly (R9 §9.1). `px-4` is the measured 16px side padding; the
    // 24px bell and 18px chevron fill the remaining 42px with nothing to
    // spare, so `justify-center` and `justify-between` resolve identically.
    className: "w-[74px] px-4",
  });
}

export interface ChannelHeaderProps {
  name: string;
  /** Stored without the leading `@` (`domain/types.ts`); rendered with one. */
  handle: string;
  verified?: boolean;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  subscriberCount: number;
  /**
   * Public, ready videos only.
   *
   * `Channel.videoCount` is documented as counting exactly that, and this is
   * the surface it was computed for: "42 videos" above a grid of 37 is the
   * bug that sends you looking at the grid.
   */
  videoCount: number;
  description: string;
  /** Rendered into the actions row. The page supplies a {@link SubscribeButton}. */
  action?: ReactNode;
  className?: string;
}

export function ChannelHeader({
  name,
  handle,
  verified = false,
  avatarUrl,
  bannerUrl,
  subscriberCount,
  videoCount,
  description,
  action,
  className,
}: ChannelHeaderProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <header data-channel-header="" className={clsx("flex flex-col", className)}>
      {bannerUrl ? (
        // 1284 × 206.98 measured. Expressed as a ratio because the column is
        // not always 1284 wide and a banner's art is composed for the shape.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerUrl}
          alt=""
          data-channel-banner=""
          className="w-full rounded-comfortable object-cover"
          style={{ aspectRatio: "1284 / 206.98" }}
        />
      ) : null}

      {/* 16px: the header block starts at y=278.98 against a banner ending at
          262.98. */}
      <div className={clsx("flex items-center", bannerUrl ? "mt-4" : null)}>
        <Avatar
          size="max"
          name={name}
          src={avatarUrl ?? null}
          decorative={false}
          data-channel-avatar=""
        />

        {/* Avatar 160 + the measured 16px to the text column at x=614. */}
        <div className="ml-4 flex min-w-0 flex-1 flex-col">
          <h1
            data-channel-name=""
            className="m-0 flex items-center text-[36px] leading-[50px] font-[var(--yt-weight-bold)] text-primary"
          >
            <span className="truncate">{name}</span>
            {verified ? (
              // 24 × 24, sitting 8px after the title's box (x=797.73 against a
              // title ending at 789.73 + its own 8px lead-in).
              <VerifiedIcon
                size={24}
                data-channel-verified=""
                className="ml-2 shrink-0"
              />
            ) : null}
          </h1>

          <p
            data-channel-facts=""
            className="m-0 mt-0.5 text-body text-secondary"
          >
            <span data-channel-handle="">@{handle}</span>
            {/* A real `•` with `margin: 0 4px`, as everywhere else in the
                product; not `aria-hidden`, because it is the punctuation that
                stops three facts being announced as one phrase. */}
            <span className="mx-1">•</span>
            <span data-channel-subscribers="">
              {formatSubscriberCount(subscriberCount)}
            </span>
            <span className="mx-1">•</span>
            <span data-channel-videos="">{formatVideoCount(videoCount)}</span>
          </p>

          {description.length === 0 ? null : (
            <div className="mt-0.5 flex max-w-[600px] items-start text-body text-secondary">
              <span
                data-channel-description=""
                data-expanded={expanded ? "" : undefined}
                className={clsx("min-w-0", expanded ? null : "truncate")}
              >
                {description}
              </span>
              {/*
                The measured preview is exactly one 20px line inside a 600px
                box with a `...more` button at 14/20 w500 primary. What the
                button *opens* is not measured — the real product raises a
                dialog — so it expands in place, which is the smaller
                assumption and needs no surface that was never captured.
              */}
              <button
                type="button"
                data-channel-description-toggle=""
                aria-expanded={expanded}
                onClick={() => setExpanded((open) => !open)}
                className="ml-1 shrink-0 font-[var(--yt-weight-medium)] text-primary"
              >
                {expanded ? "less" : "...more"}
              </button>
            </div>
          )}

          {action ? <div className="mt-4 flex">{action}</div> : null}
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------- trigger --- */

/**
 * The subscribed pill, as `Menu`'s render-prop trigger.
 *
 * Split out so {@link SubscribeButton} above reads as one unit; not part of
 * this slice's public surface.
 */
function SubscribedPillTrigger({
  label,
  triggerProps,
}: {
  label: string;
  triggerProps: MenuTriggerProps;
}) {
  return (
    <button
      {...triggerProps}
      type="button"
      aria-label={label}
      data-subscribed=""
      className={subscribedPillClassName()}
    >
      <BellIcon size={24} />
      <ChevronIcon direction="down" size={18} />
      <span
        aria-hidden="true"
        data-touch-fill=""
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </button>
  );
}
