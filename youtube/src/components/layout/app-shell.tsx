"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { Masthead } from "@/components/layout/masthead";
import {
  GUIDE_EXPANDED_MIN_WIDTH,
  Guide,
  MiniGuide,
  guideModeForWidth,
  type GuideMode,
  type GuideSubscription,
} from "@/components/layout/guide";

/**
 * The application shell: fixed masthead, guide rail, and the content column.
 *
 * ## The two things this has to get right
 *
 * **1. The rail's mode is a function of width *and* of the user's toggle, and
 * the two combine differently either side of 1313px.** Above it the drawer is
 * *persistent*: the content column is inset by 240px, the hamburger collapses
 * the rail to the 72px mini form, and the grid reflows from 3 columns to 4 at
 * 1920 as a result. Below it the drawer is *temporary*: the mini rail (down to
 * 792px) or nothing (below that) is what is shown, and the hamburger opens the
 * full rail over the page with a scrim. `drawerPersistent` in
 * `research/extracted/layout-responsive-and-nav.json` is the measured
 * distinction; both breakpoints were binary-searched (R8 §3.2).
 *
 * **2. The document scrolls.** `ytd-app` measures 1920 × 6181 at a 1080-tall
 * viewport, so the page is the scroller and only the masthead and rail are
 * fixed. A shell that locks `body` and scrolls an inner pane is a different
 * product; see the note in `globals.css`.
 *
 * The content column is also the **container query context** for the rich
 * grid. Column count follows the content box rather than the viewport — the
 * same 1920px window gives 3 columns with the rail open and 4 with it
 * collapsed — so `--yt-grid-columns` is resolved by `@container` rules against
 * `.yt-content`, and every later surface reads it without knowing the rail's
 * state.
 */

export interface AppShellProps {
  signedIn?: boolean;
  activePath?: string;
  subscriptions?: readonly GuideSubscription[];
  account?: { readonly name: string; readonly avatarUrl?: string | null };
  query?: string;
  onSubmitQuery?: (query: string) => void;
  children: ReactNode;
}

const GUIDE_OFFSET: Readonly<Record<GuideMode, string>> = {
  expanded: "var(--yt-guide-width)",
  mini: "var(--yt-guide-mini-width)",
  hidden: "0px",
};

export function AppShell({
  signedIn = false,
  activePath = "/",
  subscriptions = [],
  account,
  query,
  onSubmitQuery,
  children,
}: AppShellProps) {
  /**
   * `null` until the client measures.
   *
   * The server cannot know the viewport, and guessing wrong costs a visible
   * reflow. It is seeded as expanded rather than hidden because the product is
   * desktop-first and every measured width from 1366 up is expanded — being
   * wrong at 800px costs one frame of a too-wide rail, where the inverse costs
   * every desktop visitor a rail that pops in.
   */
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const measure = (): void => setViewportWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const persistent =
    viewportWidth === null || viewportWidth >= GUIDE_EXPANDED_MIN_WIDTH;
  const naturalMode: GuideMode =
    viewportWidth === null ? "expanded" : guideModeForWidth(viewportWidth);
  const mode: GuideMode = persistent
    ? railCollapsed
      ? "mini"
      : "expanded"
    : naturalMode;

  // Growing past 1313 while the temporary drawer is open would leave a
  // scrimmed overlay on top of a persistent rail showing the same thing.
  useEffect(() => {
    if (persistent && drawerOpen) setDrawerOpen(false);
  }, [persistent, drawerOpen]);

  const toggleGuide = useCallback(() => {
    if (persistent) {
      setRailCollapsed((collapsed) => !collapsed);
      return;
    }
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDrawerOpen((open) => !open);
  }, [persistent]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    restoreFocusRef.current?.focus();
  }, []);

  // Move focus into the drawer when it opens. Paired with the restore in
  // `closeDrawer`, this is the half of the APG dialog pattern that applies to
  // every overlay; the trap below is the half that applies because this one
  // has a scrim.
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.focus();
  }, [drawerOpen]);

  /**
   * The focus trap.
   *
   * Implemented rather than skipped because the drawer carries
   * `aria-modal="true"`, and that attribute is a claim: it tells assistive
   * technology the rest of the page is unavailable. Setting it without
   * trapping Tab makes the claim false, which is worse than not setting it.
   * (The *contextual sheet* in `primitives/sheet.tsx` is the opposite case —
   * no scrim, no `aria-modal`, and deliberately no trap.)
   */
  const onDrawerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const node = drawerRef.current;
    if (!node) return;
    const focusable = Array.from(
      node.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="yt-shell" data-guide={mode}>
      <Masthead
        signedIn={signedIn}
        onToggleGuide={toggleGuide}
        query={query}
        onSubmitQuery={onSubmitQuery}
        account={account}
      />

      {/* The persistent rail. Fixed below the masthead and scrolling its own
          content, exactly as the measured `#guide-inner-content` does. */}
      {persistent ? (
        <div
          className="fixed top-14 bottom-0 left-0 z-[var(--yt-z-guide)]"
          data-guide-rail={mode}
        >
          {mode === "expanded" ? (
            <Guide
              signedIn={signedIn}
              activePath={activePath}
              subscriptions={subscriptions}
            />
          ) : (
            <MiniGuide activePath={activePath} />
          )}
        </div>
      ) : mode === "mini" ? (
        <div
          className="fixed top-14 bottom-0 left-0 z-[var(--yt-z-mini-guide)]"
          data-guide-rail="mini"
        >
          <MiniGuide activePath={activePath} />
        </div>
      ) : null}

      {/* The temporary drawer, below 1313px. Scrim plus overlay rail. */}
      {!persistent && drawerOpen ? (
        <>
          <div
            data-guide-scrim=""
            onClick={closeDrawer}
            className="fixed inset-0 z-[var(--yt-z-guide)] bg-[var(--yt-scrim)]"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Guide"
            tabIndex={-1}
            onKeyDown={onDrawerKeyDown}
            data-guide-drawer=""
            className="fixed top-14 bottom-0 left-0 z-[var(--yt-z-mini-guide)] outline-none"
          >
            <Guide
              signedIn={signedIn}
              activePath={activePath}
              subscriptions={subscriptions}
            />
          </div>
        </>
      ) : null}

      {/*
        The content column. Its left margin is the rail's width — 240 / 72 / 0,
        measured as `pageManagerMargin` at every captured viewport — and it is
        the query container the grid's column count is resolved against.
      */}
      <main
        id="content"
        className={clsx("yt-content pt-14")}
        style={{ marginLeft: GUIDE_OFFSET[mode] }}
      >
        <div className="yt-content-inner">{children}</div>
      </main>
    </div>
  );
}
