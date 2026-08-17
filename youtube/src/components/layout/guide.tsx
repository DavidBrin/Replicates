"use client";

import Link from "next/link";
import clsx from "clsx";
import { useState, type ReactNode } from "react";

import {
  AccountIcon,
  ChevronIcon,
  FilmIcon,
  FlagIcon,
  HistoryIcon,
  HomeIcon,
  MusicIcon,
  PlayBadgeIcon,
  ShoppingIcon,
  ShortsIcon,
  SubscriptionsIcon,
} from "@/components/icons";
import { Avatar, ButtonLink } from "@/components/primitives";

/**
 * The guide — YouTube's left navigation.
 *
 * Three states, and the two boundaries between them were binary-searched to
 * the pixel (R8 §3.2):
 *
 * | viewport | state | width |
 * |---|---|---|
 * | ≤ 791 | hidden | — |
 * | 792 – 1312 | mini rail | 72px |
 * | ≥ 1313 | expanded, persistent | 240px |
 *
 * Above 1313 the drawer is *persistent* — the content column is inset by 240px
 * and reflows when the rail closes. Below it the drawer is temporary: the
 * hamburger opens it over the page with a scrim, and the mini rail (or
 * nothing) is what is left behind. That distinction is
 * `drawerPersistent` in `research/extracted/layout-responsive-and-nav.json`,
 * and it is why {@link guideModeForWidth} returns a *default* rather than a
 * state: the user's toggle can collapse an expanded rail to mini, but cannot
 * make a 900px window persistent.
 *
 * **It does not animate.** The drawer's only transition is
 * `transition-property: visibility` with no duration — the rail appears and
 * the content reflows in the same frame (R8 §6). A width animation here is one
 * of the more obvious ways to feel like a different product.
 */

export type GuideMode = "expanded" | "mini" | "hidden";

/** ≥ this width the drawer is persistent and opens expanded. Bisected: 1312 → 1313. */
export const GUIDE_EXPANDED_MIN_WIDTH = 1313;

/** ≥ this width the mini rail is shown when the drawer is closed. Bisected: 791 → 792. */
export const GUIDE_MINI_MIN_WIDTH = 792;

export function guideModeForWidth(width: number): GuideMode {
  if (width >= GUIDE_EXPANDED_MIN_WIDTH) return "expanded";
  if (width >= GUIDE_MINI_MIN_WIDTH) return "mini";
  return "hidden";
}

/* ------------------------------------------------------------- entries --- */

export interface GuideEntryDefinition {
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
}

/**
 * The primary section, and the only one the mini rail shows.
 *
 * Four entries in mini against five expanded — History is dropped, measured
 * (`chips-and-miniguide.json` lists exactly `Home`, `Shorts`,
 * `Subscriptions`, `You`). The labels are R8 §8.3's exact strings.
 */
const PRIMARY_ENTRIES: readonly GuideEntryDefinition[] = [
  { label: "Home", href: "/", icon: <HomeIcon /> },
  { label: "Shorts", href: "/shorts", icon: <ShortsIcon /> },
  { label: "Subscriptions", href: "/feed/subscriptions", icon: <SubscriptionsIcon /> },
  { label: "You", href: "/feed/you", icon: <AccountIcon /> },
  { label: "History", href: "/feed/history", icon: <HistoryIcon /> },
];

const MINI_ENTRIES: readonly GuideEntryDefinition[] = PRIMARY_ENTRIES.slice(0, 4);

/**
 * Explore.
 *
 * The logged-out capture showed three entries plus a Show more / Show less
 * pair — **both of which exist in the DOM at all times**, one of them at 0×0
 * (R8 §8.3). What the expanded list contains was not captured, because
 * expanding it was not part of the pass; the four extra entries below are
 * therefore **assumed** from the surfaces YouTube links to elsewhere in the
 * chrome, and are marked as such rather than presented as measured.
 */
const EXPLORE_ENTRIES: readonly GuideEntryDefinition[] = [
  { label: "Shopping", href: "/channel/shopping", icon: <ShoppingIcon /> },
  { label: "Music", href: "/channel/music", icon: <MusicIcon /> },
  { label: "Movies & TV", href: "/feed/storefront", icon: <FilmIcon /> },
];

const EXPLORE_MORE_ENTRIES: readonly GuideEntryDefinition[] = [
  { label: "Live", href: "/channel/live", icon: <PlayBadgeIcon size={24} /> },
  { label: "Gaming", href: "/gaming", icon: <PlayBadgeIcon size={24} /> },
  { label: "News", href: "/channel/news", icon: <PlayBadgeIcon size={24} /> },
  { label: "Sport", href: "/channel/sport", icon: <PlayBadgeIcon size={24} /> },
];

/**
 * More from YouTube.
 *
 * Every one of these is a brand lockup in the product. **The brand glyphs are
 * not reproduced** — they were deliberately excluded from the icon dump — so
 * they all carry this project's own play mark instead. The first row's *label*
 * is server-supplied and varies: the cold-start capture rendered it as
 * "Try Premium for $0" and the warmed session as "YouTube Premium" (R8 §8.3),
 * which is why it is data here rather than a constant in the markup.
 */
const MORE_ENTRIES: readonly GuideEntryDefinition[] = [
  { label: "YouTube Premium", href: "/premium", icon: <PlayBadgeIcon size={24} /> },
  { label: "YouTube TV", href: "/tv", icon: <PlayBadgeIcon size={24} /> },
  { label: "YouTube Music", href: "/music", icon: <PlayBadgeIcon size={24} /> },
  { label: "YouTube Kids", href: "/kids", icon: <PlayBadgeIcon size={24} /> },
];

const TRAILING_ENTRIES: readonly GuideEntryDefinition[] = [
  { label: "Report history", href: "/reporthistory", icon: <FlagIcon /> },
];

/** R8 §8.3, verbatim, including the em-less "Policy & Safety" and the year. */
const FOOTER_PRIMARY = [
  "About",
  "Press",
  "Copyright",
  "Contact us",
  "Creators",
  "Advertise",
  "Developers",
] as const;

const FOOTER_SECONDARY = [
  "Terms",
  "Privacy",
  "Policy & Safety",
  "How YouTube works",
  "Test new features",
  "NFL Sunday Ticket",
] as const;

const FOOTER_COPYRIGHT = "© 2026 Google LLC";

/* --------------------------------------------------------------- pieces --- */

interface GuideEntryProps {
  label: string;
  href?: string;
  icon: ReactNode;
  active?: boolean;
  /** Renders a 4×4 `call-to-action` dot 18px in from the right edge. */
  hasNewContent?: boolean;
  /** The collapsible section headers, which are entries rather than headings. */
  heading?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
}

/**
 * One row.
 *
 * 204×40 with a **10px** radius — not 8, not 20, and not the pill every other
 * control in this system uses. It sits inside a section whose 12px padding is
 * the row's side inset, so the 240px rail gives 204px of row. The icon is 24px
 * with a 24px right margin, which lands the label 60px into the row.
 *
 * The active row is distinguished twice: an `additive-background` fill *and*
 * weight 500 against the others' 400. Both were measured; using only the fill
 * is a common near-miss.
 */
function GuideEntry({
  label,
  href,
  icon,
  active = false,
  hasNewContent = false,
  heading = false,
  trailing,
  onClick,
}: GuideEntryProps) {
  const className = clsx(
    "relative flex h-10 w-full items-center rounded-entry px-3",
    "text-primary",
    active && "bg-additive",
    "[--yt-fill-color:var(--yt-touch-response)] [--yt-fill-opacity:0]",
    "hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
    "active:[--yt-fill-opacity:var(--yt-state-press-opacity)]",
  );

  const content = (
    <>
      <span className="mr-6 inline-flex size-6 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span
        className={clsx(
          "flex-1 truncate",
          heading
            ? "pr-2 text-title font-[var(--yt-weight-medium)]"
            : "text-body",
          !heading &&
            (active
              ? "font-[var(--yt-weight-medium)]"
              : "font-[var(--yt-weight-regular)]"),
        )}
      >
        {label}
      </span>
      {hasNewContent ? (
        <span
          aria-hidden="true"
          className="mr-2 size-1 shrink-0 rounded-full bg-[var(--yt-call-to-action)]"
        />
      ) : null}
      {trailing}
      <span
        aria-hidden="true"
        data-touch-fill=""
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={className}
        onClick={onClick}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}

interface GuideSectionProps {
  /** 16px/22px weight 500, `padding: 6px 12px 4px` — measured. */
  title?: string;
  /** Every section but the last carries a hairline beneath it. */
  divider?: boolean;
  children: ReactNode;
}

function GuideSection({ title, divider = true, children }: GuideSectionProps) {
  return (
    <div
      className={clsx(
        "p-3",
        divider && "border-b border-divider",
      )}
    >
      {title ? (
        <h3 className="px-3 pt-1.5 pb-1 text-title font-[var(--yt-weight-medium)] text-primary">
          {title}
        </h3>
      ) : null}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- guide --- */

export interface GuideSubscription {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly avatarUrl?: string | null;
  /** Renders the 4×4 `#3ea6ff` dot. Measured at 18px in from the row's right edge. */
  readonly hasNewContent?: boolean;
}

export interface GuideProps {
  signedIn?: boolean;
  /** Compared against each entry's `href` for the active row. */
  activePath?: string;
  subscriptions?: readonly GuideSubscription[];
  className?: string;
}

/**
 * The expanded rail.
 *
 * Signed out it carries a sign-in promo between the primary section and
 * Explore. Signed in that promo is gone and two things replace it: the
 * Subscriptions list, and *collapsible section headers* — which are worth
 * reading carefully, because they are entries rather than headings. Same
 * 204×40 box, same 10px radius, but a 16px/22px weight-500 label with a 16px
 * trailing chevron, and the whole row is a link to `/feed/subscriptions`
 * (R9 §3.2). Rendering them as an `<h3>` with a disclosure button beside it
 * would be a different control.
 */
export function Guide({
  signedIn = false,
  activePath = "/",
  subscriptions = [],
  className,
}: GuideProps) {
  const [exploreExpanded, setExploreExpanded] = useState(false);
  const [subscriptionsExpanded, setSubscriptionsExpanded] = useState(true);
  const [showAllSubscriptions, setShowAllSubscriptions] = useState(false);

  const isActive = (href: string): boolean => activePath === href;

  // Seven is what the measured rail fits before "Show more"; the count was not
  // itself measured, so it is **assumed** from the rail's height at 1080.
  const visibleSubscriptions = showAllSubscriptions
    ? subscriptions
    : subscriptions.slice(0, 7);

  return (
    <nav
      aria-label="Guide"
      data-guide-mode="expanded"
      className={clsx(
        "h-full w-[var(--yt-guide-width)] overflow-x-hidden overflow-y-auto",
        "bg-base",
        className,
      )}
    >
      <GuideSection>
        {PRIMARY_ENTRIES.map((entry) => (
          <GuideEntry
            key={entry.href}
            label={entry.label}
            href={entry.href}
            icon={entry.icon}
            active={isActive(entry.href)}
          />
        ))}
      </GuideSection>

      {signedIn ? (
        subscriptions.length > 0 ? (
          <GuideSection>
            <GuideEntry
              heading
              label="Subscriptions"
              href="/feed/subscriptions"
              icon={<SubscriptionsIcon />}
              trailing={
                <ChevronIcon
                  size={16}
                  direction={subscriptionsExpanded ? "up" : "down"}
                  className="shrink-0"
                />
              }
              onClick={() => setSubscriptionsExpanded((value) => !value)}
            />
            {subscriptionsExpanded
              ? visibleSubscriptions.map((subscription) => (
                  <GuideEntry
                    key={subscription.id}
                    label={subscription.name}
                    href={subscription.href}
                    active={isActive(subscription.href)}
                    hasNewContent={subscription.hasNewContent}
                    // A 24px round channel avatar replaces the 24px glyph, and
                    // the label drops to weight 400 — measured.
                    icon={
                      <Avatar
                        size="condensed"
                        name={subscription.name}
                        src={subscription.avatarUrl ?? null}
                      />
                    }
                  />
                ))
              : null}
            {subscriptionsExpanded && subscriptions.length > 7 ? (
              <GuideEntry
                label={showAllSubscriptions ? "Show less" : "Show more"}
                icon={
                  <ChevronIcon direction={showAllSubscriptions ? "up" : "down"} />
                }
                onClick={() => setShowAllSubscriptions((value) => !value)}
              />
            ) : null}
          </GuideSection>
        ) : null
      ) : (
        /*
         * The sign-in promo. `padding: 16px 32px` — a *32px* side inset, wider
         * than anything else in the rail, which is what makes the copy sit in
         * from the rows above it. Both strings are R8 §8.3 verbatim.
         */
        <div className="border-b border-divider px-8 py-4">
          <p className="text-body text-primary">
            Sign in to like videos, comment, and subscribe.
          </p>
          <ButtonLink
            href="/signin"
            variant="outline"
            palette="callToAction"
            size="m"
            className="mt-3"
            leading={<AccountIcon size={24} />}
          >
            Sign in
          </ButtonLink>
        </div>
      )}

      <GuideSection title="Explore">
        {EXPLORE_ENTRIES.map((entry) => (
          <GuideEntry
            key={entry.href}
            label={entry.label}
            href={entry.href}
            icon={entry.icon}
            active={isActive(entry.href)}
          />
        ))}
        {exploreExpanded
          ? EXPLORE_MORE_ENTRIES.map((entry) => (
              <GuideEntry
                key={entry.href}
                label={entry.label}
                href={entry.href}
                icon={entry.icon}
                active={isActive(entry.href)}
              />
            ))
          : null}
        <GuideEntry
          label={exploreExpanded ? "Show less" : "Show more"}
          icon={<ChevronIcon direction={exploreExpanded ? "up" : "down"} />}
          onClick={() => setExploreExpanded((value) => !value)}
        />
      </GuideSection>

      <GuideSection title="More from YouTube">
        {MORE_ENTRIES.map((entry) => (
          <GuideEntry
            key={entry.href}
            label={entry.label}
            href={entry.href}
            icon={entry.icon}
            active={isActive(entry.href)}
          />
        ))}
      </GuideSection>

      <GuideSection>
        {TRAILING_ENTRIES.map((entry) => (
          <GuideEntry
            key={entry.href}
            label={entry.label}
            href={entry.href}
            icon={entry.icon}
            active={isActive(entry.href)}
          />
        ))}
      </GuideSection>

      {/*
        The footer's own type was never captured: the only value in the dump is
        the container's computed 10px, which is the inherited root size rather
        than the links' size (YouTube runs `html { font-size: 62.5% }`). 12px
        with a 16px line is therefore **assumed**; the three lines, their
        grouping and their exact strings are measured.
      */}
      <div className="px-6 pt-4 pb-6 text-[12px] leading-[16px] text-secondary">
        <p className="flex flex-wrap gap-x-1.5 gap-y-1 font-[var(--yt-weight-medium)]">
          {FOOTER_PRIMARY.map((item) => (
            <Link key={item} href="/about">
              {item}
            </Link>
          ))}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1 font-[var(--yt-weight-medium)]">
          {FOOTER_SECONDARY.map((item) => (
            <Link key={item} href="/about">
              {item}
            </Link>
          ))}
        </p>
        <p className="mt-3">{FOOTER_COPYRIGHT}</p>
      </div>
    </nav>
  );
}

/**
 * The mini rail.
 *
 * 72px with `padding: 0 4px`, so each 64×76 entry has 4px of air either side.
 * The entry is a *column* — 24px glyph, 6px gap, a 10px/16px label — and 10px
 * is the smallest type anywhere in the product. It is the only place the
 * design system goes below 12.
 *
 * Four entries, not five: History is expanded-only.
 */
export function MiniGuide({
  activePath = "/",
  className,
}: {
  activePath?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Guide"
      data-guide-mode="mini"
      className={clsx(
        "h-full w-[var(--yt-guide-mini-width)] overflow-y-auto px-1",
        "bg-base",
        className,
      )}
    >
      {MINI_ENTRIES.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          aria-current={activePath === entry.href ? "page" : undefined}
          className={clsx(
            "relative flex h-[76px] w-16 flex-col items-center rounded-entry",
            "pt-4 pb-3.5 text-primary",
            activePath === entry.href && "bg-additive",
            "[--yt-fill-color:var(--yt-touch-response)] [--yt-fill-opacity:0]",
            "hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
            "active:[--yt-fill-opacity:var(--yt-state-press-opacity)]",
          )}
        >
          <span className="mb-1.5 inline-flex size-6 items-center justify-center">
            {entry.icon}
          </span>
          <span className="max-w-full truncate text-mini">
            {entry.label}
          </span>
          <span
            aria-hidden="true"
            data-touch-fill=""
            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[var(--yt-fill-color)]"
            style={{ opacity: "var(--yt-fill-opacity)" }}
          />
        </Link>
      ))}
    </nav>
  );
}
