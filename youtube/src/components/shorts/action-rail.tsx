"use client";

import Link from "next/link";
import clsx from "clsx";
import type { ReactNode, SVGProps } from "react";

import {
  CheckIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ShareIcon,
  ThumbDownIcon,
  ThumbUpIcon,
  type IconProps,
} from "@/components/icons";
import { Avatar, Menu, buttonClassName } from "@/components/primitives";
import { exactCount, formatCommentCount, formatCompactCount } from "@/domain/format";
import type { ReactionState } from "@/adapters/repositories/reactions";

/**
 * The Shorts action rail — the column of buttons outside the player's right edge.
 *
 * Measured in `research/09-youtube-signedin-surfaces.md` §11 against the
 * signed-in capture (`screenshots/signedin-08-shorts-player.jpg`) and the
 * signed-out one at 1920 (`screenshots/19-shorts-1920.png`):
 *
 * ```
 * x = player right edge + 34
 * y = 435, 513, 591, 669            ← 78px pitch
 *
 * each: button  48 × 48  radius 24px   Tonal Mono SizeL IconButton
 *       bg rgba(255,255,255,0.1)       glyph 24px, #f1f1f1
 *       label  12/18 w400 #f1f1f1      margin 4px -8px 0
 * ```
 *
 * The 78px pitch is arithmetic rather than a constant: 48 (button) + 4 (the
 * label's top margin) + 18 (one label line) + 8 = 78. So the gap between items
 * is 8px and nothing here sets a height.
 *
 * Two of the measured values are already tokens and are used as such rather
 * than re-typed: `--yt-additive-background` is `rgba(255,255,255,0.1)` in dark
 * and `--yt-text-primary` is `#f1f1f1`, which is exactly what
 * `buttonClassName({ variant: "tonal", palette: "mono", size: "l",
 * iconOnly: true })` produces. **The rail is Mono, not Overlay** — it sits on
 * the page background beside the video, not on artwork. The metapanel inside
 * the player is the Overlay half of that split (§11's "palette flip"), and it
 * lives in `shorts-player.tsx`.
 *
 * ## The counts are not all formatted the same way, and that is measured
 *
 * §11 records the four labels as «334K», «2,190», «Share», «Remix», and the
 * 1920 capture as «1M», «4,882», «Share», «Remix». So the **like count is
 * abbreviated and the comment count is not** — 4,882 is not written `4.8K`.
 * Both formatters already exist in `src/domain/format.ts` and neither is
 * reimplemented here: likes take `formatCompactCount` (the view ladder with the
 * noun dropped, which is what a rail does) and comments take `exactCount` (the
 * comma-grouped figure `formatCommentCount` renders, minus its noun).
 *
 * A zero like count renders the word `Like` rather than an empty label, which
 * is `formatCompactCount`'s documented behaviour at zero and the product's.
 *
 * ## What is here that the captures do not contain, and is therefore assumed
 *
 * §11 lists **four** buttons. The dislike button, the overflow menu and the
 * channel avatar's subscribe badge are all real product affordances that the
 * two captures do not show — the signed-out page has no dislike at all, and the
 * signed-in capture caught the rail mid-load. So:
 *
 *  - **Dislike** sits directly under Like, which is where it is everywhere else
 *    in the product (the watch page's segmented pair). Its count is **not**
 *    shown by default: no capture in `research/` shows a dislike count on any
 *    surface, because the product stopped publishing them. `showDislikeCount`
 *    exists because the column does (`videos.dislike_count`), not because a
 *    measurement asks for it.
 *  - **The overflow menu** is the last button, drawn with the horizontal kebab.
 *    Position and glyph are assumed.
 *  - **The channel avatar** is measured — it is the item below Remix in
 *    `19-shorts-1920.png` — but the small subscribe badge overlapping it is the
 *    *mobile* Shorts affordance, not the desktop one. It is rendered because a
 *    rail with no way to subscribe would make the avatar a dead end, and it
 *    drives the same state as the metapanel's measured Subscribe button, so the
 *    two can never disagree.
 */

/* ------------------------------------------------------------- glyphs ----- */

/**
 * Two glyphs the shared set does not have.
 *
 * `src/components/icons.tsx` is another slice's finished file and carries no
 * comment bubble and no remix mark — `research/extracted/icons-svg-paths.json`
 * has neither either, since it dumped the masthead, guide and watch surfaces.
 * They are drawn here to that file's stated construction rules rather than
 * added to it: `viewBox="0 0 24 24"`, fill-only, `fill="currentColor"` by
 * inheritance, `aria-hidden`, and a 2-unit stroke weight at 24. Not one path
 * string is copied from the dump, which is this repository's rule.
 */
function ShortsGlyph({
  size = 24,
  children,
  ...rest
}: IconProps & { children: SVGProps<SVGSVGElement>["children"] }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * The comment bubble.
 *
 * One `evenodd` path: a rounded bubble with a tail at the bottom left, the
 * interior punched out by a second subpath, and two lines put back by a third
 * and fourth. Under `evenodd` a point inside a line crosses three boundaries
 * and so is filled again, which draws the lines without a second element.
 */
export function CommentBubbleIcon(props: IconProps) {
  return (
    <ShortsGlyph {...props}>
      <path
        fillRule="evenodd"
        d="M5 3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8l-5 4v-4H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm-1 2.6h16v9.8H4V5.6zm2.4 2.2h11.2v1.8H6.4V7.8zm0 3.4h7.4V13H6.4v-1.8z"
      />
    </ShortsGlyph>
  );
}

/**
 * The remix mark: a two-arrow circuit.
 *
 * The ring is one `evenodd` path — outer stadium, inner stadium, and two small
 * rectangles that cover only the wall band and so punch the gaps the arrowheads
 * sit in. The heads are separate elements rather than more subpaths, because a
 * triangle added to an `evenodd` path would un-fill the ring wherever it
 * overlapped it.
 */
export function RemixIcon(props: IconProps) {
  return (
    <ShortsGlyph {...props}>
      <path
        fillRule="evenodd"
        d="M9 6h6a6 6 0 0 1 0 12H9A6 6 0 0 1 9 6zm0 2h6a4 4 0 0 1 0 8H9a4 4 0 0 1 0-8zm.5-2.5h3V8h-3V5.5zm2 10.5h3v2.5h-3V16z"
      />
      <path d="M11.6 3.6 15.8 7l-4.2 3.4V3.6z" />
      <path d="M12.4 20.4 8.2 17l4.2-3.4v6.8z" />
    </ShortsGlyph>
  );
}

/* --------------------------------------------------------------- props ---- */

export interface ActionRailChannel {
  readonly name: string;
  /** Without the leading `@` — `Channel.handle`'s storage form. */
  readonly handle: string;
  readonly avatarUrl: string | null;
}

export interface ActionRailProps {
  /** Names the controls: "Share <title>", "Remix <title>". */
  readonly title: string;
  readonly likeCount: number;
  readonly dislikeCount: number;
  readonly commentCount: number;
  /** `false` hides the comment button entirely, as the product does. */
  readonly commentsEnabled: boolean;
  readonly commentsOpen: boolean;
  readonly viewerReaction: ReactionState;
  readonly channel: ActionRailChannel;
  readonly subscribed: boolean;
  readonly onReact: (value: 1 | -1) => void;
  readonly onToggleComments: () => void;
  readonly onShare: () => void;
  readonly onRemix: () => void;
  readonly onToggleSubscribe: () => void;
  /** `MenuItem` rows. Omitted → the kebab is not rendered at all. */
  readonly menuItems?: ReactNode;
  /** See the header: no capture shows one, so it is off unless asked for. */
  readonly showDislikeCount?: boolean;
  readonly className?: string;
}

/* ----------------------------------------------------------- the parts --- */

/** 48 × 48, radius 24, Tonal Mono SizeL — §11's measured footprint. */
const RAIL_BUTTON = buttonClassName({
  variant: "tonal",
  palette: "mono",
  size: "l",
  iconOnly: true,
});

/**
 * The `Fill` sibling, reproduced by hand.
 *
 * `buttonClassName` sets the two custom properties but the element that reads
 * them lives inside `Button`, which cannot be used here: several of these
 * buttons are `Menu` triggers or carry `aria-pressed`, and `ButtonProps` is
 * built on `ComponentPropsWithoutRef`. `video-card.tsx`'s kebab does the same
 * thing for the same reason.
 */
function TouchFill() {
  return (
    <span
      aria-hidden="true"
      data-touch-fill=""
      className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
      style={{ opacity: "var(--yt-fill-opacity)" }}
    />
  );
}

/**
 * One rail entry: a 48px button with its caption under it.
 *
 * The caption overhangs the button by 8px on each side (`margin: 4px -8px 0`),
 * which is what lets a five-character count sit under a 48px circle without
 * widening the rail. Reproduced literally, negative margins included.
 */
function RailItem({
  name,
  label,
  caption,
  pressed,
  disabled,
  title,
  onClick,
  children,
}: {
  name: string;
  label: string;
  caption: string;
  pressed?: boolean;
  /** Greyed, with {@link title} as the reason. See Remix in {@link ActionRail}. */
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div data-rail-item={name} className="flex flex-col items-center">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={clsx(RAIL_BUTTON, disabled && "opacity-50")}
      >
        {children}
        <TouchFill />
      </button>
      <span
        data-rail-label=""
        className="-mx-2 mt-1 text-small font-[var(--yt-weight-regular)] text-primary"
      >
        {caption}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ the rail --- */

export function ActionRail({
  title,
  likeCount,
  dislikeCount,
  commentCount,
  commentsEnabled,
  commentsOpen,
  viewerReaction,
  channel,
  subscribed,
  onReact,
  onToggleComments,
  onShare,
  onRemix,
  onToggleSubscribe,
  menuItems,
  showDislikeCount = false,
  className,
}: ActionRailProps) {
  return (
    <div
      data-shorts-rail=""
      // 8px between items is the 78px pitch minus a 48px button and a 22px
      // caption block. Nothing sets the pitch directly.
      className={clsx("flex w-12 flex-col items-center gap-2", className)}
    >
      <RailItem
        name="like"
        // Measured aria copy (R8 §8.1): the exact figure lives in the label
        // while the visible caption is abbreviated.
        label={`like this video along with ${exactCount(likeCount)} other people`}
        caption={formatCompactCount(likeCount) || "Like"}
        pressed={viewerReaction === 1}
        onClick={() => onReact(1)}
      >
        <ThumbUpIcon size={24} />
      </RailItem>

      <RailItem
        name="dislike"
        label="Dislike this video"
        caption={
          showDislikeCount ? formatCompactCount(dislikeCount) || "Dislike" : "Dislike"
        }
        pressed={viewerReaction === -1}
        onClick={() => onReact(-1)}
      >
        <ThumbDownIcon size={24} />
      </RailItem>

      {commentsEnabled ? (
        <RailItem
          name="comments"
          label={formatCommentCount(commentCount)}
          caption={exactCount(commentCount)}
          pressed={commentsOpen}
          onClick={onToggleComments}
        >
          <CommentBubbleIcon size={24} />
        </RailItem>
      ) : null}

      <RailItem
        name="share"
        label={`Share ${title}`}
        caption="Share"
        onClick={onShare}
      >
        <ShareIcon size={24} />
      </RailItem>

      {/* Disabled with the reason rather than a `noop`.
          Remix opens the Shorts editor — trimming a source video, laying audio
          over it and publishing the result — which is a creation surface this
          application does not have. The button is measured, so it renders; a
          pressable one that did nothing would teach a visitor that the app is
          broken rather than that the feature is absent. */}
      <RailItem
        name="remix"
        label={`Remix ${title}`}
        caption="Remix"
        disabled
        title="The Shorts editor is not part of this build."
        onClick={onRemix}
      >
        <RemixIcon size={24} />
      </RailItem>

      {menuItems ? (
        <div data-rail-item="menu" className="flex flex-col items-center">
          <Menu
            align="end"
            label={`More actions for ${title}`}
            trigger={(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                aria-label={`More actions for ${title}`}
                data-rail-menu-trigger=""
                className={RAIL_BUTTON}
              >
                <MoreHorizontalIcon size={24} />
                <TouchFill />
              </button>
            )}
          >
            {menuItems}
          </Menu>
          <span
            data-rail-label=""
            className="-mx-2 mt-1 text-small font-[var(--yt-weight-regular)] text-primary"
          >
            More
          </span>
        </div>
      ) : null}

      {/* Measured as the rail's last item in `19-shorts-1920.png`. 48px, so it
          shares the column width with the buttons above it. */}
      <div data-rail-item="channel" className="relative mt-2 flex flex-col items-center">
        <Link
          href={`/@${encodeURIComponent(channel.handle)}`}
          data-rail-channel-link=""
          aria-label={channel.name}
          className="block rounded-full"
        >
          <Avatar
            size="expanded"
            name={channel.name}
            src={channel.avatarUrl}
            decorative={false}
          />
        </Link>
        <button
          type="button"
          data-rail-subscribe=""
          aria-pressed={subscribed}
          aria-label={
            subscribed ? `Unsubscribe from ${channel.name}` : `Subscribe to ${channel.name}`
          }
          onClick={onToggleSubscribe}
          className={clsx(
            "absolute -bottom-2 grid size-5 place-items-center rounded-full",
            subscribed ? "bg-additive text-primary" : "bg-brand text-white",
          )}
        >
          {subscribed ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
        </button>
      </div>
    </div>
  );
}
