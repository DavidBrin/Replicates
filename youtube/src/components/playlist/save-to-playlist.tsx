"use client";

import clsx from "clsx";
import { useRef, useState } from "react";

import {
  Sheet,
  SheetListItem,
  buttonClassName,
  type SheetTriggerProps,
} from "@/components/primitives";
import { SaveIcon } from "@/components/icons";
import type { PlaylistKind, Visibility } from "@/domain/types";

import { NewPlaylistButton, SYSTEM_PLAYLIST_REASON } from "./playlist-panel";

/**
 * Save-to-playlist.
 *
 * **It is a contextual sheet, not a modal dialog, and there is no confirm
 * step.** R9 §9.3 measured it as
 * `yt-sheet-view-model.ytSheetViewModelContextual` inside a
 * `tp-yt-iron-dropdown`: anchored to the Save button, no scrim, and rows that
 * are toggles rather than checkboxes with a Cancel/Save footer. §14 lists the
 * old checkbox dialog as one of the things a from-memory rebuild gets wrong.
 *
 * ```
 * yt-sheet-view-model                     400 × 333  r12  0 4px 32px rgba(0,0,0,.1)
 *   header container                      400 × 48
 *     h2 «Save to…»                       18/26 w700 @16px inset, no divider rule
 *   content container                     400 × 220  (scrolls)
 *     toggleable-list-item-view-model × N
 *       yt-list-item-view-model           400 × 54     ← a flat 54px pitch
 *         layout wrapper                  padding 6px 16px
 *           image container               56 × 42   margin-right 12px
 *           main container                368 × 42
 *             title    «playlist»         14/20 w400 #f1f1f1
 *             subtitle «Private»          12/18 w400 #aaa
 *           trailing toggle               24 × 24 @ 16px from the right
 *                                         (a bookmark that FILLS when saved —
 *                                          not a checkbox)
 *   footer container                      400 × 65
 *     «New playlist»                      376 × 40  r20  Tonal Mono SizeM
 * ```
 *
 * All of that geometry lives in `src/components/primitives/sheet.tsx`, which
 * was built from this measurement. This file supplies the rows, the writes and
 * the one rule the primitive cannot know about.
 *
 * ## The write happens on the toggle
 *
 * Not on a footer button, because there is no footer button — the footer holds
 * "New playlist", which is an action rather than a commit. The row flips
 * immediately and the request follows; a failure puts the row back and says so.
 * Waiting for the response before flipping would make every toggle feel like it
 * missed.
 *
 * ## The liked playlist is a disabled row
 *
 * `playlists.addVideo` and `removeVideo` throw `LikedPlaylistIsDerivedError`
 * for the liked list, because a video is in it *because* it was liked — one
 * truth, stored in `reactions`. So the row cannot be a toggle.
 *
 * **The measured product's answer is to omit the row entirely** — R9 §9.3's
 * enumeration of the sheet's rows contains no liked list, and the derived-list
 * rule is why. This renders a *disabled* row instead, carrying the reason.
 *
 * That is a deliberate divergence, and the argument for it is that a
 * silently-absent row answers no question: a user who knows they have a liked
 * playlist and cannot find it here learns nothing, where a greyed row saying
 * "unlike a video to remove it" teaches the rule in one glance. The omission is
 * recorded here as the alternative that was rejected, not overlooked.
 */

export interface SaveTarget {
  id: string;
  title: string;
  kind: PlaylistKind;
  visibility: Visibility;
  /** Whether this video is already in it. The page resolves it in one query. */
  saved: boolean;
  /** The playlist's first thumbnail — the 56×36 lead image. */
  coverUrl?: string | null;
}

export interface SaveToPlaylistProps {
  videoId: string;
  /**
   * Every playlist the viewer owns, liked included.
   *
   * Passed whole rather than pre-filtered, because the filtering rule *is* the
   * thing this component renders — a page that dropped the liked list before
   * handing it over would move the rule somewhere the user cannot see it.
   */
  playlists: readonly SaveTarget[];
  /** Signed out: the sheet still opens and explains why it is empty. */
  signedIn?: boolean;
  className?: string;
}

/** How a playlist's privacy reads on a sheet row (measured: `Private`). */
const VISIBILITY_LABELS: Readonly<Record<Visibility, string>> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

export function SaveToPlaylist({
  videoId,
  playlists,
  signedIn = true,
  className,
}: SaveToPlaylistProps) {
  /**
   * Membership, keyed by playlist id.
   *
   * Seeded from the props once. Re-deriving it from `playlists` on every render
   * would undo an optimistic flip the moment anything above re-rendered, which
   * is the bug that makes a toggle "bounce".
   */
  const [saved, setSaved] = useState<Readonly<Record<string, boolean>>>(() =>
    Object.fromEntries(playlists.map((list) => [list.id, list.saved])),
  );
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * How many presses each row has taken, so a stale reply cannot undo a fresh
   * press.
   *
   * Two requests for one row can settle out of order — `add` then `remove`, the
   * `remove` answering first — and a rollback written as "put it back to
   * `!next`" then applies the *first* request's opposite to the *second*
   * request's state. The UI lands on the reverse of what the viewer last asked
   * for and the server on something else again, with no error shown, because
   * from each handler's point of view nothing went wrong.
   *
   * A counter is enough: a reply whose sequence is not the current one is
   * describing a press the viewer has already changed their mind about, so it
   * is dropped. `useRef` rather than state, because reading it must not depend
   * on a render having happened.
   */
  const sequence = useRef<Record<string, number>>({});

  const toggle = async (playlist: SaveTarget, next: boolean): Promise<void> => {
    const ticket = (sequence.current[playlist.id] ?? 0) + 1;
    sequence.current[playlist.id] = ticket;

    setSaved((current) => ({ ...current, [playlist.id]: next }));
    setNotice(null);

    /** Only the most recent press for this row may change anything. */
    const stale = (): boolean => sequence.current[playlist.id] !== ticket;

    try {
      const response = await fetch("/api/playlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: next ? "add" : "remove",
          playlistId: playlist.id,
          videoId,
        }),
      });
      if (!response.ok && !stale()) {
        setSaved((current) => ({ ...current, [playlist.id]: !next }));
        setNotice(`Could not update ${playlist.title}.`);
      }
    } catch {
      if (stale()) return;
      setSaved((current) => ({ ...current, [playlist.id]: !next }));
      setNotice(`Could not update ${playlist.title}.`);
    }
  };

  return (
    <div className={className}>
      <Sheet
        title="Save to..."
        align="start"
        trigger={(triggerProps) => (
          <SaveTrigger triggerProps={triggerProps} />
        )}
        footer={<NewPlaylistButton className="w-full" />}
      >
        {!signedIn ? (
          <p data-save-signed-out="" className="px-4 py-3 text-body text-secondary">
            Sign in to save this video to a playlist.
          </p>
        ) : playlists.length === 0 ? (
          <p data-save-empty="" className="px-4 py-3 text-body text-secondary">
            You have no playlists yet.
          </p>
        ) : (
          playlists.map((playlist) =>
            playlist.kind === "liked" ? (
              <DerivedRow key={playlist.id} playlist={playlist} />
            ) : (
              <SheetListItem
                key={playlist.id}
                title={playlist.title}
                subtitle={VISIBILITY_LABELS[playlist.visibility]}
                checked={saved[playlist.id] ?? false}
                onToggle={(next) => {
                  void toggle(playlist, next);
                }}
                leading={<CoverStack src={playlist.coverUrl ?? null} />}
                icon={<BookmarkGlyph filled={saved[playlist.id] ?? false} />}
              />
            ),
          )
        )}
        {notice === null ? null : (
          <p role="status" className="px-4 pb-2 text-small text-secondary">
            {notice}
          </p>
        )}
      </Sheet>
    </div>
  );
}

/**
 * The Save button the sheet is anchored to.
 *
 * 86 × 40, `Tonal Mono SizeM IconLeading` (R9 §9.2). A bare `<button>` wearing
 * {@link buttonClassName} rather than `Button`, because `Sheet` hands its
 * trigger a callback ref.
 */
function SaveTrigger({ triggerProps }: { triggerProps: SheetTriggerProps }) {
  return (
    <button
      {...triggerProps}
      type="button"
      // The measured accessible name is `Save to playlist` (R8 §8.3) while the
      // *visible* label is `Save` — the button is 86px wide and the longer
      // string does not fit. The two differ on purpose, and the label is the
      // one that has to be the measurement, because a screen reader reading
      // "Save" beside a Share and a Download button does not say what is being
      // saved or where. This was the one place the watch page's inert button
      // was more correct than the working component that replaced it.
      aria-label="Save to playlist"
      data-save-trigger=""
      className={buttonClassName({ variant: "tonal", size: "m" })}
    >
      <span className="-ml-1.5 mr-1.5 inline-flex shrink-0 items-center">
        <SaveIcon size={24} />
      </span>
      <span>Save</span>
      <span
        aria-hidden="true"
        data-touch-fill=""
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </button>
  );
}

/**
 * The liked playlist, rendered but not operable.
 *
 * Shaped like a {@link SheetListItem} — same 54px pitch, same 56×42 lead image,
 * same 24px trailing glyph — but a `<div>` rather than a button, so it is not
 * a tab stop and cannot be pressed. `aria-disabled` on a real control would
 * still put it in the tab order and still let a click through in some
 * implementations; not being a control at all is unambiguous.
 */
function DerivedRow({ playlist }: { playlist: SaveTarget }) {
  return (
    <div
      data-save-row="liked"
      data-disabled=""
      aria-disabled="true"
      title={SYSTEM_PLAYLIST_REASON.liked}
      className="flex h-[54px] w-full items-center px-4 py-1.5 text-left opacity-60"
    >
      <span className="mr-3 inline-flex h-[42px] w-14 shrink-0 items-center">
        <CoverStack src={playlist.coverUrl ?? null} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-primary">{playlist.title}</span>
        <span className="truncate text-small text-secondary">
          {SYSTEM_PLAYLIST_REASON.liked}
        </span>
      </span>
      <span className="ml-4 inline-flex size-6 shrink-0 items-center justify-center">
        <BookmarkGlyph filled={playlist.saved} />
      </span>
    </div>
  );
}

/**
 * The 56×36 lead image, with the collection stack's 5px peek above it.
 *
 * R9 §2.4 measures the sheet's variant precisely: a 56 × 32.5 front thumbnail,
 * a 40 × 33.5 peeking layer behind it and a 5px spacer. The peek's colour is
 * "sampled from the art", which a server render cannot do — see the same note
 * on `playlist-panel.tsx` — so it is `additive` here.
 */
function CoverStack({ src }: { src: string | null }) {
  return (
    <span className="flex w-14 flex-col">
      <span
        aria-hidden="true"
        className="mx-1.5 h-1 rounded-t-[2px] bg-additive"
      />
      <span className="block h-[32px] w-14 overflow-hidden rounded-[2px] bg-additive">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : null}
      </span>
    </span>
  );
}

/**
 * The toggle glyph: **a bookmark that fills when saved, not a checkbox.**
 *
 * R9 §9.3 is explicit about it, and it is the detail that makes the row read as
 * "saved" rather than "ticked". Drawn here rather than in
 * `@/components/icons` — that file belongs to another slice and has no bookmark
 * — to that file's stated grammar: a 24 box with 2-unit strokes and rounded
 * ends, so the outline weight matches the icons beside it.
 */
function BookmarkGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-bookmark={filled ? "filled" : "outline"}
      className={clsx("shrink-0", filled ? "text-primary" : "text-secondary")}
    >
      {filled ? (
        <path
          fill="currentColor"
          d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16.1a1 1 0 0 1-1.53.85L12 18.18l-4.47 2.77A1 1 0 0 1 6 20.1V4Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M8 2a2 2 0 0 0-2 2v16.1a1 1 0 0 0 1.53.85L12 18.18l4.47 2.77A1 1 0 0 0 18 20.1V4a2 2 0 0 0-2-2H8Zm0 2h8v14.3l-3.47-2.15a1 1 0 0 0-1.06 0L8 18.3V4Z"
        />
      )}
    </svg>
  );
}
