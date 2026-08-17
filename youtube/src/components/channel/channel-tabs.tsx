import clsx from "clsx";

/**
 * The channel page's tab row.
 *
 * Measured (`research/extracted/channel-and-shorts.json` → `chanHome.header.tabs`,
 * and R8 §3.7):
 *
 * ```
 * tp-yt-paper-tabs           1284 × 48
 *   yt-tab-shape              min-width 48, height 48, margin-right 24px
 *                             14px w500, rgb(96,96,96) unselected
 * ```
 *
 * The selected tab in that capture computed the *same* colour as the unselected
 * ones — the dump's `tabSelected` and `tab` entries are byte-identical, because
 * the probe matched the same node twice. `screenshots/17-channel-home-1920.png`
 * and `18-channel-videos-1920.png` settle it visually: the selected tab is
 * primary ink over a 2px rule the width of the label, and the row sits on a 1px
 * divider. The **2px** underline weight is read off the screenshots rather than
 * computed, so it is honest to call it approximate; everything else here is a
 * number from the dump.
 *
 * ## These are links, not a tablist
 *
 * `/@handle`, `/@handle/videos`, `/@handle/shorts` … are real URLs in the
 * product, each with its own history entry and its own server render. A
 * `role="tablist"` with `aria-controls` would claim the panels are already in
 * the document and that arrow keys move between them, and neither is true
 * here. So this is a `<nav>` of anchors carrying `aria-current="page"`, which
 * is what a screen reader needs to answer "which tab am I on" for a control
 * that navigates.
 *
 * ## The tab set is the task's, not the capture's
 *
 * The measured row is `Home · Videos · Shorts · Playlists · Posts` plus an
 * overflow chevron. This slice is specified as
 * `Home · Videos · Shorts · Playlists · About`. **Posts and About are different
 * tabs** — Posts is the community feed, About is the channel's description and
 * stats — and the capture has no About tab at all. The specified set is built;
 * the divergence is recorded here rather than silently resolved, because a
 * later reader comparing this against `screenshots/17-channel-home-1920.png`
 * will otherwise think the tab row lost one.
 */

export type ChannelTab = "home" | "videos" | "shorts" | "playlists" | "about";

interface TabSpec {
  readonly id: ChannelTab;
  readonly label: string;
  /** Appended to `/@handle`. Home is the bare channel URL. */
  readonly segment: string;
}

const TABS: readonly TabSpec[] = [
  { id: "home", label: "Home", segment: "" },
  { id: "videos", label: "Videos", segment: "videos" },
  { id: "shorts", label: "Shorts", segment: "shorts" },
  { id: "playlists", label: "Playlists", segment: "playlists" },
  { id: "about", label: "About", segment: "about" },
];

/** Every tab id, in row order — the route parser's allow-list. */
export const CHANNEL_TABS: readonly ChannelTab[] = TABS.map((tab) => tab.id);

/**
 * `/@handle` for Home, `/@handle/<tab>` for the rest.
 *
 * The `@` is part of the path segment rather than a route-folder name — see
 * the header comment on `src/app/(main)/[handle]/[[...tab]]/page.tsx` for why
 * Next.js cannot own a folder called `@[handle]`.
 */
export function channelTabHref(handle: string, tab: ChannelTab): string {
  const encoded = encodeURIComponent(handle);
  const spec = TABS.find((candidate) => candidate.id === tab);
  const segment = spec?.segment ?? "";
  return segment === "" ? `/@${encoded}` : `/@${encoded}/${segment}`;
}

/**
 * Resolve a URL segment to a tab, or `null` when it names no tab at all.
 *
 * `null` rather than a silent fall back to Home: `/@someone/nonsense` is a URL
 * that does not exist, and rendering the Home tab under it would make every
 * typo look like a working page.
 */
export function channelTabFromSegment(segment: string | undefined): ChannelTab | null {
  if (segment === undefined || segment === "") return "home";
  const spec = TABS.find((candidate) => candidate.segment === segment);
  return spec?.id ?? null;
}

export interface ChannelTabsProps {
  /** Without the leading `@`. */
  handle: string;
  active: ChannelTab;
  className?: string;
}

export function ChannelTabs({ handle, active, className }: ChannelTabsProps) {
  return (
    <nav
      aria-label="Channel sections"
      data-channel-tabs=""
      className={clsx("border-b border-divider", className)}
    >
      <ul className="m-0 flex list-none items-center p-0">
        {TABS.map((tab) => {
          const selected = tab.id === active;
          return (
            <li key={tab.id} className="mr-6 last:mr-0">
              <a
                href={channelTabHref(handle, tab.id)}
                data-channel-tab={tab.id}
                data-selected={selected ? "" : undefined}
                aria-current={selected ? "page" : undefined}
                className={clsx(
                  // 48px tall, min 48 wide, 14px w500 — all measured.
                  "flex h-12 min-w-12 items-center justify-center",
                  "text-body font-[var(--yt-weight-medium)]",
                  // A 2px rule under the label, not under the 48px box: the
                  // underline in both screenshots is the width of the word.
                  "border-b-2",
                  selected
                    ? "border-primary text-primary"
                    : "border-transparent text-secondary",
                )}
              >
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
