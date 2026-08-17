"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  Button,
  ButtonLink,
  Menu,
  MenuItem,
  buttonClassName,
  type MenuTriggerProps,
} from "@/components/primitives";
import { MoreVerticalIcon, PlayIcon } from "@/components/icons";
import { VideoRowView } from "@/components/video";
import { formatViewCount } from "@/domain/format";
import type { PlaylistKind, VideoCard, Visibility } from "@/domain/types";

/**
 * The playlist detail page's two halves — the sticky immersive panel and the
 * numbered list — plus the card the index grid is made of.
 *
 * ## Geometry (R9 §8.2, measured on Watch Later at `?list=WL`)
 *
 * The page inverts the usual layout: the panel is on the **left** and the list
 * on the right.
 *
 * ```
 * ytd-two-column-browse-results-renderer   padding-LEFT 388px
 *   #primary   884 wide @ x=628            ← the video list
 * ytd-playlist-header-renderer   360 × 747  margin-left 24px   position: sticky
 *   .immersive-header-container  360 × 723  radius 16px  padding 24px
 *       background: sampled from the playlist artwork
 *       colour: #fff   → the whole panel uses the OVERLAY palette
 *     artwork                    312 wide  (the panel's content box)
 *     title                      auto-shrinking
 *     owner link                 14/20 w500 #fff
 *     stats                      12/18 w400 rgba(255,255,255,0.7)
 *                                «N videos · No views · Updated N days ago»
 *     overflow icon button       40 × 40  Tonal Overlay SizeM IconButton
 *     «Play all»  152 × 40  Filled Overlay  (bg #fff, text #000)
 *     «Shuffle»   152 × 40  Tonal Overlay   (8px gap between them)
 * ```
 *
 * **The sampled background is not reproduced, and that is the largest visible
 * divergence in this slice.** R9 records it as "a colour/gradient sampled from
 * the playlist artwork"; sampling needs the decoded image, and a server render
 * has a blob key. The panel paints `--yt-overlay-background-heavy` —
 * `rgba(0,0,0,0.8)`, which does not theme-flip — so the measured overlay
 * palette on top of it stays legible in both themes. A guessed gradient would
 * be wrong in a way nobody could correct later; a flat dark ground is wrong in
 * a way anyone can see.
 *
 * ## The rows use the card family, and the product does not
 *
 * R9 §8.2 is explicit that a playlist row is `ytd-playlist-video-renderer` and
 * **not** a lockup, "because it carries an index and a drag handle". It differs
 * from the history row in three measured places: the thumbnail is 200 × 113
 * rather than 246 × 138.4, the title clamps to **2** lines rather than 1, and a
 * 36px index column sits in front.
 *
 * Building a sixth card to carry those three differences is precisely what
 * `src/components/video/index.ts` exists to prevent, so a row is
 * {@link VideoRowView} at `density="history"` with the index rendered as a
 * sibling *outside* the lockup — which is where the product puts it too. The
 * cost is a one-line title where the product allows two, and a 246px thumbnail
 * where it uses 200. Both are recorded here rather than fixed by forking.
 *
 * ## System playlists
 *
 * `watch_later` and `liked` cannot be renamed or deleted — the schema keeps one
 * of each per owner and `updatePlaylist`/`deletePlaylist` throw
 * `SystemPlaylistIsFixedError`. The liked list is stricter: `addVideo` and
 * `removeVideo` throw `LikedPlaylistIsDerivedError`, because liking a video is
 * the only door into it.
 *
 * Every one of those rules renders as a **disabled** row carrying the reason,
 * never as an enabled row that fails. A control that throws when pressed
 * teaches the user the app is broken; a disabled control with a reason teaches
 * them the rule. It is also not merely cosmetic: `Remove from playlist` on the
 * liked list would optimistically drop the row and then have to put it back,
 * which reads as data loss.
 */

/* -------------------------------------------------------------- shared --- */

/** How a playlist's privacy reads in the metadata line (R9 §8.1, §8.2). */
const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

/**
 * Why a system playlist refuses an edit, in the words the disabled row wears.
 *
 * Phrased as the rule rather than as the error class, because the person
 * reading it is not going to grep for `SystemPlaylistIsFixedError`.
 */
export const SYSTEM_PLAYLIST_REASON: Readonly<
  Record<Exclude<PlaylistKind, "user">, string>
> = {
  watch_later: "Watch later is built in — it cannot be renamed or deleted.",
  liked: "Liked videos follows your likes — unlike a video to remove it.",
};

/** `null` for an ordinary playlist; the kind for one of the two fixed ones. */
export function systemKind(
  kind: PlaylistKind,
): Exclude<PlaylistKind, "user"> | null {
  return kind === "user" ? null : kind;
}

/**
 * The Shuffle button's leading glyph.
 *
 * Local rather than in `@/components/icons`, which is another slice's file and
 * carries no shuffle mark. Drawn to that file's stated grammar — a 24 box,
 * 2-unit strokes with rounded ends — so it does not read as a different
 * icon set beside the play triangle next to it.
 */
function ShuffleGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14.3 4.3a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4l-3 3a1 1 0 1 1-1.4-1.4L15.6 9H14c-1.2 0-2 .5-2.9 1.8l-.5.8-1.2-1.8.4-.6C10.9 7.5 12.2 7 14 7h1.6l-1.3-1.3a1 1 0 0 1 0-1.4Z" />
      <path d="M14.3 12.5a1 1 0 0 1 1.4 0L17 13.8V13c0-.2 0-.4-.1-.5l1.7-1.2c.3.5.4 1.1.4 1.7v.8l1.3-1.3a1 1 0 1 1 1.4 1.4l-3 3a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 0-1.4Z" />
      <path d="M3 8a1 1 0 0 1 1-1h2c1.9 0 3.3.7 4.4 1.8 1 1.1 1.7 2.4 2.3 3.5.6 1.1 1.1 2 1.7 2.6.6.6 1.2.9 2.2.9h2a1 1 0 1 1 0 2h-2c-1.6 0-2.8-.6-3.7-1.5-.9-.9-1.5-2-2-3.1-.6-1.1-1.1-2.1-1.8-2.9C8.5 9.5 7.6 9 6 9H4a1 1 0 0 1-1-1Z" />
      <path d="M3 16a1 1 0 0 1 1-1h2c1 0 1.7-.3 2.3-.9l1.2 1.7C8.6 16.5 7.5 17 6 17H4a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

/* ------------------------------------------------------------ the panel --- */

export interface PlaylistPanelProps {
  playlistId: string;
  title: string;
  ownerName: string;
  visibility: Visibility;
  kind: PlaylistKind;
  itemCount: number;
  /**
   * The **playlist's** views, not the sum of its videos'.
   *
   * R9 §8.2 captured the stats line as «22 videos · No views · Updated 4 days
   * ago» on a playlist whose videos have tens of millions of views between
   * them, so the number is a counter on the playlist itself. This schema has no
   * such column, and inventing one by summing would put `22M views` where the
   * product shows `No views`. Callers pass `0`, which
   * {@link formatViewCount} renders as exactly the measured string.
   */
  viewCount: number;
  /** Already formatted — `Updated 4 days ago`. The page owns the clock. */
  updatedLabel: string;
  artworkUrl?: string | null;
  /** `/watch?v=…&list=…` for the first item, or `null` for an empty playlist. */
  playAllHref?: string | null;
  shuffleHref?: string | null;
  /** The viewer owns this playlist and may edit it, subject to `kind`. */
  editable?: boolean;
  className?: string;
}

export function PlaylistPanel({
  playlistId,
  title,
  ownerName,
  visibility,
  kind,
  itemCount,
  viewCount,
  updatedLabel,
  artworkUrl,
  playAllHref,
  shuffleHref,
  editable = false,
  className,
}: PlaylistPanelProps) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const system = systemKind(kind);
  const empty = itemCount === 0;

  return (
    <aside
      data-playlist-panel=""
      data-playlist-kind={kind}
      className={clsx(
        // 360 wide, sticky under the 56px masthead plus the page's 24px inset.
        "w-[360px] shrink-0 self-start lg:sticky lg:top-20",
        className,
      )}
    >
      <div
        className={clsx(
          // 723 tall in the capture, but that is the height of its content — a
          // fixed height here would crop a long title. The 24px padding and the
          // 16px radius are the measured constants.
          "flex flex-col rounded-comfortable p-6",
          "bg-[var(--yt-overlay-background-heavy)] text-overlay-primary",
        )}
      >
        {artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artworkUrl}
            alt=""
            data-playlist-artwork=""
            className="w-full rounded-cozy object-cover"
            style={{ aspectRatio: "16 / 9" }}
          />
        ) : (
          <div
            aria-hidden="true"
            data-playlist-artwork="placeholder"
            className="w-full rounded-cozy bg-[var(--yt-overlay-button-secondary)]"
            style={{ aspectRatio: "16 / 9" }}
          />
        )}

        {renaming ? (
          <form
            data-playlist-rename-form=""
            className="mt-6 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (next.length === 0) return;
              setRenaming(false);
              void fetch("/api/playlists", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "rename", playlistId, title: next }),
              }).then(() => router.refresh());
            }}
          >
            <input
              aria-label="Playlist name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-10 rounded-compact bg-[var(--yt-overlay-button-secondary)] px-3 text-title text-overlay-primary outline-none"
            />
            <div className="flex gap-2">
              <Button variant="filled" palette="overlay" size="s" type="submit">
                Save
              </Button>
              <Button
                variant="text"
                palette="overlay"
                size="s"
                onClick={() => {
                  setName(title);
                  setRenaming(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <h1
            data-playlist-title=""
            className="m-0 mt-6 text-[36px] leading-[44px] font-[var(--yt-weight-bold)]"
          >
            {title}
          </h1>
        )}

        <p
          data-playlist-owner=""
          className="m-0 mt-4 text-body font-[var(--yt-weight-medium)]"
        >
          {ownerName}
        </p>

        {/*
          `N videos · No views · Updated N days ago` at 12/18 in the overlay
          palette's secondary ink. The separator in the capture is a spaced
          middle dot, not the `•` the metadata rows elsewhere use.
        */}
        <p
          data-playlist-stats=""
          className="m-0 mt-1 text-small text-overlay-secondary"
        >
          <span data-playlist-count="">
            {`${itemCount} ${itemCount === 1 ? "video" : "videos"}`}
          </span>
          <span className="mx-1">·</span>
          <span data-playlist-views="">{formatViewCount(viewCount)}</span>
          <span className="mx-1">·</span>
          <span data-playlist-updated="">{updatedLabel}</span>
        </p>

        <p
          data-playlist-visibility=""
          className="m-0 mt-1 text-small text-overlay-secondary"
        >
          {VISIBILITY_LABELS[visibility]}
        </p>

        <div className="mt-4 flex items-center">
          <PlaylistOverflowMenu
            playlistId={playlistId}
            title={title}
            system={system}
            editable={editable}
            onRename={() => setRenaming(true)}
            onDeleted={() => router.push("/feed/playlists")}
          />
        </div>

        {/* 152 × 40 each with an 8px gap. `Play all` is Filled Overlay —
            #fff on the panel's ground — and `Shuffle` is Tonal Overlay. */}
        <div className="mt-4 flex gap-2">
          <ButtonLink
            variant="filled"
            palette="overlay"
            size="m"
            href={playAllHref ?? "#"}
            aria-disabled={empty ? true : undefined}
            data-playlist-play-all=""
            leading={<PlayIcon size={24} />}
            className={clsx("w-[152px]", empty && "pointer-events-none opacity-50")}
          >
            Play all
          </ButtonLink>
          <ButtonLink
            variant="tonal"
            palette="overlay"
            size="m"
            href={shuffleHref ?? "#"}
            aria-disabled={empty ? true : undefined}
            data-playlist-shuffle=""
            leading={<ShuffleGlyph size={24} />}
            className={clsx("w-[152px]", empty && "pointer-events-none opacity-50")}
          >
            Shuffle
          </ButtonLink>
        </div>
      </div>
    </aside>
  );
}

/**
 * The panel's 40×40 overflow menu — where the system-playlist rules surface.
 *
 * Rename and Delete are present in every state and `disabled` with the reason
 * when the playlist is `watch_later` or `liked`, rather than hidden. Hiding
 * them would be defensible for a stranger's playlist — it is not their menu —
 * but for your *own* Watch later the question "why can't I rename this" has an
 * answer, and a greyed row carrying that answer is where it belongs.
 */
function PlaylistOverflowMenu({
  playlistId,
  title,
  system,
  editable,
  onRename,
  onDeleted,
}: {
  playlistId: string;
  title: string;
  system: Exclude<PlaylistKind, "user"> | null;
  editable: boolean;
  onRename: () => void;
  onDeleted: () => void;
}) {
  const label = `Actions for ${title}`;
  const fixed = system !== null;
  const reason = system === null ? null : SYSTEM_PLAYLIST_REASON[system];

  return (
    <Menu
      align="start"
      label={label}
      trigger={(triggerProps) => (
        <OverflowTrigger
          label={label}
          triggerProps={triggerProps}
          palette="overlay"
        />
      )}
    >
      <MenuItem
        data-playlist-action="rename"
        disabled={!editable || fixed}
        title={reason ?? undefined}
        onSelect={onRename}
      >
        Rename
      </MenuItem>
      <MenuItem
        data-playlist-action="delete"
        disabled={!editable || fixed}
        title={reason ?? undefined}
        onSelect={() => {
          void fetch("/api/playlists", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "delete", playlistId }),
          }).then(onDeleted);
        }}
      >
        Delete playlist
      </MenuItem>
      {reason === null ? null : (
        // The rule stated once in the menu itself, for everyone who never sees
        // a `title` tooltip — which is every keyboard and screen-reader user.
        <MenuItem disabled data-playlist-action="reason">
          {reason}
        </MenuItem>
      )}
    </Menu>
  );
}

/* ------------------------------------------------------------- the list --- */

export interface PlaylistItemListProps {
  playlistId: string;
  kind: PlaylistKind;
  items: readonly VideoCard[];
  /** The viewer owns the playlist. Non-owners get no per-row menu at all. */
  editable?: boolean;
  /** The server's clock, so no row hydrates a different relative time. */
  now?: Date;
  className?: string;
}

/**
 * The numbered list.
 *
 * An `<ol>`, because the numbers *are* the playlist's order rather than
 * decoration — "list item 3 of 22" is the same information the 36px index
 * column carries visually, and `list-style: none` keeps the marker from being
 * drawn twice.
 *
 * The drag handle R9 describes (the index swaps for one on hover) is **not**
 * built. Reordering is `playlists.moveVideo`, whose contract is "after this
 * neighbour"; a drag implementation with no pointer-event harness to test it
 * against is the sort of thing that looks right and drops items.
 */
export function PlaylistItemList({
  playlistId,
  kind,
  items,
  editable = false,
  now,
  className,
}: PlaylistItemListProps) {
  const [removed, setRemoved] = useState<readonly string[]>([]);
  const visible = items.filter((item) => !removed.includes(item.id));

  if (visible.length === 0) {
    return (
      <p data-playlist-empty="" className="text-body text-secondary">
        There is nothing in this playlist yet.
      </p>
    );
  }

  return (
    <ol
      data-playlist-items=""
      className={clsx("m-0 flex list-none flex-col gap-4 p-0", className)}
    >
      {visible.map((video, index) => (
        <li key={video.id} data-playlist-item="" className="flex items-start">
          {/* 36px wide, measured. `tabular-nums` so a two-digit index does not
              shift the thumbnail of the row beside it. */}
          <span
            aria-hidden="true"
            data-playlist-index=""
            className="mt-4 w-9 shrink-0 text-center text-small tabular-nums text-secondary"
          >
            {index + 1}
          </span>
          <VideoRowView
            video={video}
            density="history"
            href={`/watch?v=${encodeURIComponent(video.id)}&list=${encodeURIComponent(playlistId)}`}
            now={now}
            className="min-w-0 flex-1"
            menuItems={
              editable ? (
                <PlaylistItemMenuItems
                  playlistId={playlistId}
                  kind={kind}
                  videoId={video.id}
                  onRemoved={() => setRemoved((current) => [...current, video.id])}
                />
              ) : undefined
            }
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * One row's menu rows.
 *
 * `Remove from playlist` is `disabled` on the liked playlist and enabled
 * everywhere else, because `playlists.removeVideo` throws
 * `LikedPlaylistIsDerivedError` for exactly that list.
 */
function PlaylistItemMenuItems({
  playlistId,
  kind,
  videoId,
  onRemoved,
}: {
  playlistId: string;
  kind: PlaylistKind;
  videoId: string;
  onRemoved: () => void;
}) {
  const derived = kind === "liked";

  return (
    <>
      <MenuItem
        data-playlist-item-action="remove"
        disabled={derived}
        title={derived ? SYSTEM_PLAYLIST_REASON.liked : undefined}
        onSelect={() => {
          onRemoved();
          void fetch("/api/playlists", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "remove", playlistId, videoId }),
          });
        }}
      >
        Remove from playlist
      </MenuItem>
      {derived ? (
        <MenuItem disabled data-playlist-item-action="reason">
          {SYSTEM_PLAYLIST_REASON.liked}
        </MenuItem>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------- the trigger --- */

/**
 * A 40×40 icon-only overflow trigger for `Menu`.
 *
 * A bare `<button>` wearing {@link buttonClassName} rather than `Button`, for
 * the reason `video-card.tsx`'s `CardMenu` gives: `Menu` hands its trigger a
 * callback ref, and `ButtonProps` is built on `ComponentPropsWithoutRef`.
 */
function OverflowTrigger({
  label,
  triggerProps,
  palette = "mono",
}: {
  label: string;
  triggerProps: MenuTriggerProps;
  palette?: "mono" | "overlay";
}) {
  return (
    <button
      {...triggerProps}
      type="button"
      aria-label={label}
      data-playlist-menu-trigger=""
      className={buttonClassName({
        variant: "tonal",
        palette,
        iconOnly: true,
        size: "m",
      })}
    >
      <MoreVerticalIcon size={24} />
      <span
        aria-hidden="true"
        data-touch-fill=""
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </button>
  );
}

/* ------------------------------------------------------------- the card --- */

export interface PlaylistCardProps {
  /** `/playlist?list=<id>`, which is the product's URL (R9 §8.2). */
  href: string;
  title: string;
  itemCount: number;
  visibility: Visibility;
  kind: PlaylistKind;
  /** Already formatted — `Updated 4 days ago`. Owned playlists only (R9 §8.1). */
  updatedLabel?: string | null;
  coverUrl?: string | null;
  className?: string;
}

/**
 * One card on the playlists index.
 *
 * R9 §8.1, measured at a fixed 4 per row:
 *
 * ```
 * yt-lockup-view-model                  294 × 265.4
 *   yt-collection-thumbnail-view-model  294 × 165.4      ← the "stack"
 *     front thumbnail                   294 × 166.4  radius 12px  margin-top -1px
 *   badge-shape (item count)            75.8 × 20  r4  12/18 w500 #fff
 *   title                               16 / 22  w500
 *   3 × MetadataRow  22px pitch  14 / 20  w400  #aaa
 *      «Private|Public|Unlisted • Playlist»
 *      «Updated N days ago»           (owned playlists only)
 *      «View full playlist»
 * ```
 *
 * Two measured details are approximated, both for the same reason — the
 * artwork is not decoded server-side:
 *
 * * The **stack** (R9 §2.4: a 5px spacer and a peeking layer whose background
 *   is "a colour sampled from the art") is one inset bar in `additive`.
 * * The count badge's background is measured as a desaturated sample of the
 *   artwork at ~80% alpha — `rgba(35,39,51,0.8)` in the capture — and is
 *   rendered as `overlay-background-medium`, the duration badge's
 *   `rgba(0,0,0,0.6)`, which is the nearest thing the token set has.
 *
 * Not a `VideoCardView`: that component takes a `VideoCard` and renders a
 * duration badge, a channel row and a watched-progress bar, none of which a
 * playlist has. Sharing it would mean four `showX` flags to switch off four
 * things — which is a different component wearing one name.
 */
export function PlaylistCard({
  href,
  title,
  itemCount,
  visibility,
  kind,
  updatedLabel,
  coverUrl,
  className,
}: PlaylistCardProps) {
  return (
    <article
      data-playlist-card=""
      data-playlist-kind={kind}
      className={clsx("relative flex flex-col", className)}
    >
      <div className="relative">
        {/* The peeking layer: a 5px spacer, then a bar inset behind the front
            thumbnail with a 4px radius. */}
        <div
          aria-hidden="true"
          data-playlist-stack=""
          className="mx-3 h-1.5 rounded-t-condensed bg-additive"
        />
        <div className="relative overflow-hidden rounded-cozy bg-additive">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="w-full object-cover"
              style={{ aspectRatio: "16 / 9" }}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div style={{ aspectRatio: "16 / 9" }} />
          )}
          <span
            data-playlist-card-count=""
            className={clsx(
              "absolute right-2 bottom-2 inline-flex h-5 items-center rounded-condensed px-1",
              "bg-overlay-medium text-small font-[var(--yt-weight-medium)] text-overlay-primary",
            )}
          >
            {`${itemCount} ${itemCount === 1 ? "video" : "videos"}`}
          </span>
        </div>
      </div>

      <h3 className="m-0 mt-3">
        <a
          href={href}
          data-playlist-link=""
          className={clsx(
            "text-title font-[var(--yt-weight-medium)] text-primary",
            // The same stretched-link arrangement the video card uses: one
            // anchor, one accessible name, one tab stop.
            "after:absolute after:inset-0 after:content-['']",
          )}
        >
          {title}
        </a>
      </h3>

      <div className="mt-0.5 text-body text-secondary">
        <div>
          <span data-playlist-card-visibility="">
            {VISIBILITY_LABELS[visibility]}
          </span>
          <span className="mx-1">•</span>
          <span>Playlist</span>
        </div>
        {updatedLabel ? <div data-playlist-card-updated="">{updatedLabel}</div> : null}
        <div>View full playlist</div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------- new list --- */

export interface NewPlaylistButtonProps {
  /** Overrides the label. The measured control reads "New playlist". */
  children?: ReactNode;
  className?: string;
}

/**
 * The control that creates a playlist — a `+` icon button on the You page's
 * Playlists shelf (R9 §7) and a 376×40 tonal row in the save sheet's footer
 * (§9.3).
 *
 * The naming form is deliberately minimal: one field, inline, rather than a
 * dialog. No capture in `research/` contains YouTube's new-playlist dialog, and
 * inventing one would be a whole surface of guesses sitting inside a slice
 * whose other measurements are exact.
 */
export function NewPlaylistButton({ children, className }: NewPlaylistButtonProps) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");

  if (!naming) {
    return (
      <Button
        variant="tonal"
        size="m"
        data-new-playlist=""
        onClick={() => setNaming(true)}
        className={className}
      >
        {children ?? "New playlist"}
      </Button>
    );
  }

  return (
    <form
      data-new-playlist-form=""
      className={clsx("flex items-center gap-2", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const next = title.trim();
        if (next.length === 0) return;
        setTitle("");
        setNaming(false);
        void fetch("/api/playlists", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", title: next }),
        }).then(() => router.refresh());
      }}
    >
      <input
        aria-label="Playlist name"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="h-10 min-w-0 flex-1 rounded-prominent bg-additive px-4 text-body text-primary outline-none"
      />
      <Button variant="filled" size="m" type="submit">
        Create
      </Button>
    </form>
  );
}
