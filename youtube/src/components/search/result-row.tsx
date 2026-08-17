import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";

import { VerifiedIcon } from "@/components/icons";
import { Avatar } from "@/components/primitives";
import { VideoRowView } from "@/components/video";
import { formatSubscriberCount, formatVideoCount } from "@/domain/format";
import type { VideoCard } from "@/domain/types";

/**
 * One row of `/results`.
 *
 * Two renderers, because the product has two. `research/extracted/
 * search-and-breakpoints.json` dumps `ytd-video-renderer` node by node;
 * `screenshots/08-search-results-1920.png` shows a `ytd-channel-renderer`
 * directly above it with a completely different left column — a large circular
 * avatar where the video has a 16:9 thumbnail, and no duration badge. The
 * branch is on {@link SearchResultItem.kind}, which is `SearchHit.kind`
 * unchanged.
 *
 * ## The video half is not built here
 *
 * `VideoRowView` at `density="search"` already carries the measured geometry —
 * 855×235.38 row, 419.5px thumbnail, 16px gap, 18/26 two-line title, the
 * counts-then-channel metadata order that only the screenshot reveals. What
 * this module adds is the one thing a feed card deliberately does not have: the
 * description snippet, passed through the row's `children` escape hatch
 * (`src/components/video/video-row.tsx`, "Search results carry a description
 * snippet, and `VideoCard` does not").
 *
 * **The thumbnail radius is inherited, not measured.** R8 §3.6 records the
 * search thumbnail's box (419.5×235.38) and its badge (48.44×20, 8px inset from
 * the bottom-right corner) and says nothing about its corner. The row dump does
 * carry `radius: 12px` on `a#thumbnail`, and every other thumbnail in the
 * product is 12px, so `VideoRowView` inherits the 12px `cozy` default and says
 * so at the point it chooses it.
 *
 * ## The snippet is clamped to two lines, against the measurement
 *
 * The captured container is `div.metadata-snippet-container-one-line`, 419.5×18
 * with `margin: 0 0 8px` — one line, 12/18, `rgb(96,96,96)`. Two lines are
 * rendered here anyway, and the disagreement is deliberate: our fragment comes
 * from `ts_headline` with `MaxWords=28`, which `src/adapters/search/postgres.ts`
 * documents as "sized for the two-line snippet a result row has room for". At
 * 419.5px a 28-word fragment does not fit on one line, and the run that gets
 * cut is routinely the marked one — which is the only reason the snippet is
 * there. Clamping to the measured single line would reliably hide the highlight.
 */

/* ------------------------------------------------------------ highlights -- */

/**
 * The renderer's copy of the fragment delimiters.
 *
 * `src/adapters/search/postgres.ts` exports these and calls them "the other
 * half of this contract", which is exactly what this is — but that module opens
 * with `import "server-only"` and reaches `@/adapters/db`, so importing the
 * constants from it would pull a WASM Postgres into any client bundle that
 * renders a result row. Two characters are copied instead, and
 * `__tests__/highlight.test.tsx` asserts the copies are identical to the
 * adapter's exports. A drift is then a red test rather than a page full of
 * unmarked snippets.
 */
export const HIGHLIGHT_START = "\u0002";
export const HIGHLIGHT_END = "\u0003";

/** One run of a highlighted fragment. `marked` runs render as `<mark>`. */
export interface HighlightRun {
  readonly text: string;
  readonly marked: boolean;
}

/**
 * Split a `ts_headline` fragment into marked and unmarked runs.
 *
 * The delimiters are U+0002 and U+0003 — see `src/adapters/search/postgres.ts`,
 * which chose control characters precisely so that an uploader cannot forge a
 * highlight, and which strips every C0 control from a document on the way in so
 * that the claim holds rather than being asserted. Nothing is re-sanitised
 * here; React escapes the text it renders, and the marks are structure rather
 * than markup.
 *
 * The scan is deliberately tolerant of a fragment that is not well-formed — an
 * unclosed `START`, or a stray `END` in what should be plain text — because the
 * one thing that must never happen is a raw control character reaching the
 * page. It would render as nothing visible and as a garbage byte in a copied
 * string, and it would be invisible in review. Every emitted run therefore has
 * both delimiters stripped, so "no delimiter is ever rendered" is a property of
 * this function and not of its input.
 */
export function splitHighlight(fragment: string): readonly HighlightRun[] {
  const runs: HighlightRun[] = [];

  const push = (text: string, marked: boolean): void => {
    const clean = text.replaceAll(HIGHLIGHT_START, "").replaceAll(HIGHLIGHT_END, "");
    if (clean !== "") runs.push({ text: clean, marked });
  };

  let cursor = 0;
  while (cursor < fragment.length) {
    const start = fragment.indexOf(HIGHLIGHT_START, cursor);
    if (start === -1) {
      push(fragment.slice(cursor), false);
      break;
    }

    push(fragment.slice(cursor, start), false);

    const end = fragment.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      // Unclosed: everything after the opener is the match. Dropping it would
      // lose text; rendering it unmarked would lose the only signal the
      // fragment carries.
      push(fragment.slice(start + 1), true);
      break;
    }

    push(fragment.slice(start + 1, end), true);
    cursor = end + 1;
  }

  return runs;
}

/**
 * The description snippet, with the matched terms marked.
 *
 * `<mark>` rather than `<b>` or a `<span>`: the run is a search-result
 * highlight, which is exactly what the element means, and it is the only one
 * that carries the semantics to assistive technology. Its user-agent yellow has
 * to be turned off — the product's snippet is one colour throughout with the
 * matched words heavier.
 *
 * **The weight is assumed.** The dump records `.metadata-snippet-text` at
 * 12/18 w400 and does not descend into the `<b>` elements inside it;
 * `screenshots/08-search-results-1920.png` shows the matched words visibly
 * heavier than their neighbours, which is bold rather than medium at this size.
 */
export function HighlightedSnippet({
  fragment,
  className,
}: {
  fragment: string;
  className?: string;
}) {
  return (
    <span data-search-snippet="" className={className}>
      {splitHighlight(fragment).map((run, i) =>
        run.marked ? (
          <mark
            // The runs are a flat, positional split of one string; there is no
            // identity to key on and nothing reorders.
            key={i}
            data-search-highlight=""
            className="bg-transparent font-[var(--yt-weight-bold)] text-inherit"
          >
            {run.text}
          </mark>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </span>
  );
}

/* ----------------------------------------------------------------- items -- */

/**
 * What a channel result needs, which is not what a `Channel` carries.
 *
 * Narrower than `domain/types.ts`'s `Channel` on purpose: this crosses into a
 * component, and `bannerKey`, `ownerId` and `createdAt` are not things a search
 * row shows.
 */
export interface SearchChannelCard {
  readonly id: string;
  /** Without the leading `@`, as stored. */
  readonly handle: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly verified: boolean;
  readonly subscriberCount: number;
  readonly videoCount: number;
  readonly description: string;
}

/**
 * One hit, hydrated.
 *
 * A discriminated union rather than a row with optional halves, so that a
 * renderer cannot be handed a channel with a duration or a video with a
 * subscriber count. `highlight` is `SearchHit.highlight` unchanged, including
 * its `null` — which the port documents as the *normal* case for a title-only
 * match rather than as a failure.
 */
export type SearchResultItem =
  | {
      readonly kind: "video";
      readonly video: VideoCard;
      readonly highlight: string | null;
    }
  | {
      readonly kind: "channel";
      readonly channel: SearchChannelCard;
      readonly highlight: string | null;
      /**
       * The trailing control — Subscribe, in the product.
       *
       * An escape hatch rather than a rendered button, for the same reason
       * `VideoCardView` takes `menuItems` instead of inventing actions:
       * subscription state and its mutation belong to another slice, and a
       * Subscribe button that does nothing is worse than an absent one.
       */
      readonly action?: ReactNode;
    };

/* ------------------------------------------------------------------ rows -- */

export interface SearchResultRowProps {
  item: SearchResultItem;
  /** The server's clock, so a relative time does not hydrate as a mismatch. */
  now?: Date;
  className?: string;
}

export function SearchResultRow({ item, now, className }: SearchResultRowProps) {
  if (item.kind === "channel") {
    return <ChannelResultRow item={item} className={className} />;
  }

  return (
    <VideoRowView
      video={item.video}
      density="search"
      showAvatar
      now={now}
      className={className}
    >
      {item.highlight === null ? null : (
        <HighlightedSnippet
          fragment={item.highlight}
          // 12/18 secondary with 8px below, measured on
          // `.metadata-snippet-container-one-line`. Two lines rather than one —
          // see the module header.
          className="mt-1 mb-2 line-clamp-2 text-small text-secondary"
        />
      )}
    </VideoRowView>
  );
}

/**
 * The channel result.
 *
 * **Assumed geometry, read off `screenshots/08-search-results-1920.png`** — the
 * extraction pass dumped `ytd-video-renderer` and never descended into
 * `ytd-channel-renderer`, so there is no measured box for any of this. What the
 * screenshot settles: the avatar is centred in a column the same width as the
 * video row's thumbnail, so the two rows' text columns line up; the avatar is
 * roughly 120px across (`legend`); the name sits at the result title's size
 * with `@handle • N subscribers` under it at the metadata size; the description
 * follows on one line.
 *
 * There is no hover surface here. The video row's is a measured
 * `yt-touch-feedback-shape` with a −12px inset; nothing in the capture records
 * the channel row's, and reproducing the video row's by analogy would be
 * inventing a measurement.
 */
function ChannelResultRow({
  item,
  className,
}: {
  item: Extract<SearchResultItem, { kind: "channel" }>;
  className?: string;
}) {
  const { channel } = item;
  const href = `/@${encodeURIComponent(channel.handle)}`;

  return (
    <article
      data-channel-row=""
      className={clsx("flex items-center", className)}
    >
      <div
        // The same `flex: 0 1 420px` basis the search density gives the
        // thumbnail, so the two kinds of row share a text-column origin.
        className="flex shrink justify-center"
        style={{ flex: "0 1 420px", marginRight: 16 }}
      >
        <Link href={href} tabIndex={-1} aria-hidden="true">
          <Avatar size="legend" name={channel.name} src={channel.avatarUrl} />
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 items-center">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 flex items-center">
            <Link href={href} className="text-result text-primary">
              {channel.name}
            </Link>
            {channel.verified ? (
              <>
                {/*
                  14px is `VerifiedIcon`'s own documented size, measured inside
                  a card's 20px metadata row. Beside an 18/26 name it is
                  **borrowed rather than measured** — the channel renderer was
                  never dumped.

                  The glyph stays `aria-hidden` (it is decorative, as
                  `channel-header.tsx` also treats it) and the fact is carried
                  by text instead. A tick that only exists as a shape says
                  nothing to a screen reader, and "verified" is a fact about
                  the channel rather than decoration.
                */}
                <VerifiedIcon
                  size={14}
                  data-channel-verified=""
                  className="ml-1.5 shrink-0 text-secondary"
                />
                <span className="sr-only">Verified</span>
              </>
            ) : null}
          </h3>

          <div className="mt-1 text-small text-secondary">
            <span data-channel-handle="">@{channel.handle}</span>
            <span data-meta-delimiter="" className="mx-1">
              •
            </span>
            <span data-channel-subscribers="">
              {formatSubscriberCount(channel.subscriberCount)}
            </span>
            {channel.videoCount > 0 ? (
              <>
                <span data-meta-delimiter="" className="mx-1">
                  •
                </span>
                <span data-channel-videos="">
                  {formatVideoCount(channel.videoCount)}
                </span>
              </>
            ) : null}
          </div>

          {item.highlight === null ? (
            channel.description === "" ? null : (
              <p className="mt-2 mb-0 line-clamp-1 text-small text-secondary">
                {channel.description}
              </p>
            )
          ) : (
            <HighlightedSnippet
              fragment={item.highlight}
              className="mt-2 mb-0 line-clamp-1 text-small text-secondary"
            />
          )}
        </div>

        {item.action ? <div className="ml-4 shrink-0">{item.action}</div> : null}
      </div>
    </article>
  );
}
