"use client";

// Moved to the server-safe route builders: /shorts/page.tsx calls this.
export {
  shortHref,
} from "@/components/video/routes";
import {
  shortHref,
} from "@/components/video/routes";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
} from "react";

import { ChevronIcon } from "@/components/icons";
import { MenuItem, buttonClassName } from "@/components/primitives";
import type { CommentThread, CommentsViewer } from "@/components/watch/comments";
import type { CreatePlayerOptions, PlayerEngine } from "@/media/player";
import type { ReactionState } from "@/adapters/repositories/reactions";

import { ShortsPlayer, type ShortItem } from "./shorts-player";

/**
 * The vertical pager: one short on screen, the next one already buffered.
 *
 * ## The preload window is the whole design
 *
 * `research/03-mse-player-abr.md` §10 is unambiguous about what makes a Shorts
 * feed different from a player: *"a Shorts session can construct
 * dozens-to-hundreds of `MediaSource` instances, and any leak compounds fast —
 * this is the primary mobile OOM/crash risk specific to this surface."* So this
 * component's real job is not scrolling. It is deciding, on every move, exactly
 * which items hold a live engine — {@link hotIndices} — and letting
 * `ShortsPlayer` create and destroy against that answer.
 *
 * The window here is `{ current, current + 1 }`. §10 describes the typical
 * window as current ±1; this takes the narrower forward-only end of it, because
 * a forward swipe is the overwhelmingly common move and a back swipe paying one
 * cold start is cheaper than every session holding an extra `MediaSource` for a
 * item most viewers never go back to. Both numbers are named constants and
 * changing them changes nothing else.
 *
 * The consequence that is easy to miss: **six seeded shorts hide this bug
 * completely.** Six `MediaSource`s is fine on any desktop. The failure needs a
 * real feed, which is why {@link hotIndices} is a pure function with its own
 * test rather than an emergent property of what happens to be mounted.
 *
 * ## Slides stay mounted; engines do not
 *
 * Every item renders a slide for the whole session, so the scroller's snap
 * points never move and the browser never re-lays-out the feed under a gesture.
 * The engine is bound to the `hot` flag instead. That also makes teardown a
 * state transition an assertion can watch, rather than a side effect of React
 * unmounting a subtree.
 *
 * ## Four ways to move, and the rule that keeps them from fighting
 *
 * Keyboard, wheel, touch and the native scroller all navigate. The container
 * is a real `scroll-snap` scroller — that is what makes trackpad and touch feel
 * native, and it is what the measured product is — so the native scroller's
 * position is a *source* of index changes as well as a consequence of them.
 *
 *  - **Keyboard** (↑/↓, `j`/`k`, PageUp/PageDown) is bound at the document,
 *    because Shorts owns the whole viewport and a surface that only responds
 *    once you have clicked it is a surface most people think is broken. Guarded
 *    against typing contexts, because the comments panel has a composer in it.
 *  - **Wheel** is handled natively with `{ passive: false }` so the default
 *    scroll can be prevented: a mandatory-snap container still scrolls freely
 *    *between* snap points under a wheel, and the product advances exactly one
 *    short per gesture. Hence the cooldown.
 *  - **Touch** is explicit, but yields: if the native scroller moved during the
 *    gesture then the platform already handled it, and advancing again would
 *    skip an item. Only a swipe the scroller ignored is acted on.
 *  - **Scroll** rounds the offset to the nearest slide, which is what makes a
 *    trackpad flick land somewhere real.
 *
 * ## URL
 *
 * `/shorts/<id>`, written with `history.pushState` rather than `router.push`.
 * Next's App Router picks up `pushState` without a server round trip, and a
 * router navigation would re-render the route and remount the pager — which
 * would destroy every engine and re-create it, on every swipe. `popstate` moves
 * the pager back, so Back and Forward walk the feed.
 */

/* ------------------------------------------------------- the hot window -- */

/**
 * How many items ahead of the visible one hold a live engine.
 *
 * §10: *"eagerly preload the next item's `MediaSource`/first segments
 * regardless of any gesture state (always allowed), and gate only the actual
 * `play()` call"*. One, because §10 also says the distance is deliberately
 * small — "too wide wastes bandwidth/memory on content the user may never
 * reach, too narrow reintroduces the loading-spinner-on-swipe experience".
 */
export const PRELOAD_AHEAD = 1;

/**
 * How many items behind the visible one are kept.
 *
 * Zero. §10: tear down *"as soon as an item scrolls more than one position
 * away"*, and the item behind is the one a forward-moving viewer is finished
 * with. A back swipe re-creates it, which costs one startup rather than a
 * standing allocation for the whole session.
 */
export const KEEP_BEHIND = 0;

/** The indices that should hold a live engine, clamped to the feed. */
export function hotIndices(index: number, count: number): readonly number[] {
  const out: number[] = [];
  for (let i = index - KEEP_BEHIND; i <= index + PRELOAD_AHEAD; i += 1) {
    if (i >= 0 && i < count) out.push(i);
  }
  return out;
}

/* ----------------------------------------------------------- input tuning */

/** Below this a wheel event is a stray trackpad tremor, not a gesture. */
export const WHEEL_DELTA_THRESHOLD = 12;

/**
 * One short per wheel gesture.
 *
 * A trackpad emits a long tail of decaying `wheel` events from a single flick;
 * without a cooldown one flick pages through five shorts. **Assumed** — no
 * capture measures the product's own debounce — and chosen as roughly the
 * duration of the smooth scroll it triggers.
 */
export const WHEEL_COOLDOWN_MS = 350;

/** How far a finger must travel before it is a swipe rather than a tap. */
export const SWIPE_THRESHOLD_PX = 48;

/** Where the mute preference lives. See {@link ShortsFeedProps.muted}. */
export const SHORTS_MUTED_STORAGE_KEY = "yt.shorts.muted";

/* ------------------------------------------------------------------ url -- */

/** `/shorts/<id>` — the product's URL, and what a share link has to produce. */

/**
 * The index a `popstate` is asking for.
 *
 * The state object first, because it is what this component wrote and it
 * survives an id that has since dropped out of the feed. The pathname second,
 * because an entry pushed by something else — a link, a reload, another
 * surface — has no state of ours on it. Returning `null` from both is a
 * legitimate answer: it means the entry is not a short in this feed, and the
 * right response is to leave the pager alone.
 */
export function indexFromPopState(
  state: unknown,
  pathname: string,
  ids: readonly string[],
): number | null {
  if (typeof state === "object" && state !== null && "shortsIndex" in state) {
    const raw = (state as { shortsIndex: unknown }).shortsIndex;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw < ids.length) {
      return raw;
    }
  }
  const match = /^\/shorts\/([^/]+)\/?$/.exec(pathname);
  if (match === null) return null;
  const segment = match[1];
  if (segment === undefined) return null;
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const found = ids.indexOf(id);
  return found === -1 ? null : found;
}

/* --------------------------------------------------------------- props --- */

/** What a like or a subscribe changes, held outside the server's copy. */
interface ShortInteraction {
  readonly viewerReaction: ReactionState;
  readonly likeCount: number;
  readonly subscribed: boolean;
}

export interface ShortsFeedProps {
  /**
   * The feed, in order.
   *
   * Must be referentially stable across renders — it comes off a server
   * component's array and is. See `shorts-player.tsx` for what a churning array
   * would cost.
   */
  readonly items: readonly ShortItem[];
  /** Which item the URL asked for. */
  readonly initialIndex?: number;
  readonly commentsViewer?: CommentsViewer | null;
  /** The server's clock, so relative times in the comments hydrate identically. */
  readonly now?: Date;
  /** Fetches a thread when its panel is first opened. */
  readonly loadComments?: (videoId: string) => Promise<readonly CommentThread[]>;
  /**
   * Persist a reaction. Defaults to `POST /api/videos/:id/reactions`, the same
   * endpoint the watch page writes to.
   */
  readonly onReact?: (
    videoId: string,
    value: 1 | -1,
  ) => Promise<{ readonly likeCount: number; readonly viewerReaction: ReactionState }>;
  /** Test seam, forwarded to every player. Must be referentially stable. */
  readonly createEngine?: (options: CreatePlayerOptions) => PlayerEngine;
  readonly className?: string;
}

/* ---------------------------------------------------------------- feed --- */

interface Nav {
  readonly index: number;
  /** Who moved us. `scroll` must not be scrolled *back*, or the feel is elastic. */
  readonly source: "mount" | "input" | "scroll" | "history";
}

export function ShortsFeed({
  items,
  initialIndex = 0,
  commentsViewer = null,
  now,
  loadComments,
  onReact,
  createEngine,
  className,
}: ShortsFeedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const wheelAtRef = useRef(0);
  const touchRef = useRef<{ y: number; scrollTop: number } | null>(null);

  const [nav, setNav] = useState<Nav>({
    index: clamp(initialIndex, items.length),
    source: "mount",
  });
  /**
   * The current index, readable synchronously from an event handler.
   *
   * Every mover — keyboard, wheel, touch, scroll, history — needs "where are we
   * now" at the moment the event fires, and reading `nav.index` from a
   * `useCallback` would pin each handler to the render that created it and make
   * every one of them a new function on every move. {@link applyNav} is the only
   * writer of `nav`, and it updates this in the same call; the effect below is
   * the belt to that braces, and exists so nothing is written during render.
   */
  const navRef = useRef(nav.index);
  useEffect(() => {
    navRef.current = nav.index;
  }, [nav.index]);

  const [muted, setMuted] = useState(true);
  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<
    Readonly<Record<string, ShortInteraction>>
  >({});

  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const hot = useMemo(() => new Set(hotIndices(nav.index, items.length)), [
    nav.index,
    items.length,
  ]);

  /**
   * The items as rendered: the server's copy, plus whatever this session has
   * changed. A spread copy, so `progressiveSources` and `renditionCodecs` keep
   * their identity and `ShortsPlayer`'s memo does not see a new source.
   */
  const shown = useMemo(
    () =>
      items.map((item) => {
        const local = interactions[item.id];
        return local === undefined ? item : { ...item, ...local };
      }),
    [items, interactions],
  );

  /* ------------------------------------------------------------ motion -- */

  const reducedMotion = useReducedMotion();

  /* ---------------------------------------------------------- movement -- */

  const applyNav = useCallback(
    (next: number, source: Nav["source"]): void => {
      const target = clamp(next, items.length);
      if (target === navRef.current) return;
      navRef.current = target;
      // The panel belongs to the short it was opened on. Carrying it across a
      // swipe would show one short's thread over another's video.
      setCommentsOpenFor(null);
      setNav({ index: target, source });
    },
    [items.length],
  );

  const goTo = useCallback(
    (next: number, source: Nav["source"] = "input"): void => {
      const target = clamp(next, items.length);
      const id = ids[target];
      if (id === undefined || target === navRef.current) return;
      applyNav(target, source);
      if (source !== "history" && typeof window !== "undefined") {
        window.history.pushState({ shortsIndex: target }, "", shortHref(id));
      }
    },
    [applyNav, ids, items.length],
  );

  const move = useCallback(
    (delta: number): void => {
      goTo(navRef.current + delta, "input");
    },
    [goTo],
  );

  /* --------------------------------------------------------------- url -- */

  // Seed the entry the feed opened on, so Back from the second short returns
  // here rather than to whatever preceded `/shorts`. Once, and the ref says so
  // rather than an empty dependency array that lies about what is read.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    const id = ids[navRef.current];
    if (id === undefined) return;
    seededRef.current = true;
    window.history.replaceState({ shortsIndex: navRef.current }, "", shortHref(id));
  }, [ids]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      const next = indexFromPopState(event.state, window.location.pathname, ids);
      if (next === null) return;
      applyNav(next, "history");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [applyNav, ids]);

  /* ------------------------------------------------------------ scroll -- */

  /**
   * Bring the current slide into view — unless the scroller is already there
   * because the viewer put it there.
   *
   * `prefers-reduced-motion` is honoured explicitly rather than left to the
   * `scroll-behavior: auto !important` in `globals.css`: that rule covers CSS
   * scrolling, and this is a scripted scroll whose `behavior` argument wins
   * over the stylesheet.
   */
  useEffect(() => {
    if (nav.source === "scroll") return;
    const slide = slideRefs.current[nav.index];
    slide?.scrollIntoView({
      behavior: reducedMotion || nav.source === "mount" ? "auto" : "smooth",
      block: "start",
    });
  }, [nav, reducedMotion]);

  const onScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>): void => {
      const node = event.currentTarget;
      // jsdom has no layout, and a real container mid-relayout can report zero
      // too. Dividing by it would put the pager on item `NaN`.
      if (node.clientHeight === 0) return;
      const nearest = Math.round(node.scrollTop / node.clientHeight);
      if (nearest !== navRef.current) goTo(nearest, "scroll");
    },
    [goTo],
  );

  /* ---------------------------------------------------------- keyboard -- */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Before the typing guard: Escape out of the comment composer should
      // close the panel, which is what every other overlay in this application
      // does and what a viewer stuck in a textarea expects.
      if (event.key === "Escape") {
        setCommentsOpenFor(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
      const delta = keyDelta(event.key);
      if (delta === 0) return;
      event.preventDefault();
      move(delta);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [move]);

  /* ------------------------------------------------------------- wheel -- */

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (Math.abs(event.deltaY) < WHEEL_DELTA_THRESHOLD) return;
      // Registered non-passively for exactly this call: without it the snap
      // container scrolls a fraction of a slide under every notch and the feed
      // reads as a long page rather than as a pager.
      event.preventDefault();
      const at = Date.now();
      if (at - wheelAtRef.current < WHEEL_COOLDOWN_MS) return;
      wheelAtRef.current = at;
      move(event.deltaY > 0 ? 1 : -1);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [move]);

  /* ------------------------------------------------------------- touch -- */

  const onTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>): void => {
    const touch = event.touches[0];
    if (touch === undefined) return;
    touchRef.current = {
      y: touch.clientY,
      scrollTop: event.currentTarget.scrollTop,
    };
  }, []);

  const onTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>): void => {
      const start = touchRef.current;
      touchRef.current = null;
      if (start === null) return;
      // The native scroller moved: the platform owned this gesture, and the
      // `scroll` handler has already reported where it landed.
      if (event.currentTarget.scrollTop !== start.scrollTop) return;
      const touch = event.changedTouches[0];
      if (touch === undefined) return;
      const travelled = start.y - touch.clientY;
      if (Math.abs(travelled) < SWIPE_THRESHOLD_PX) return;
      move(travelled > 0 ? 1 : -1);
    },
    [move],
  );

  /* ------------------------------------------------------------- audio -- */

  // Read after mount, never during render: the server has no storage and a
  // seeded-from-storage first render would hydrate as a mismatch.
  useEffect(() => {
    setMuted(readStoredMuted());
  }, []);

  const changeMuted = useCallback((next: boolean): void => {
    setMuted(next);
    writeStoredMuted(next);
  }, []);

  /* -------------------------------------------------------- reactions --- */

  const react = useCallback(
    (short: ShortItem, value: 1 | -1): void => {
      // Optimistic, and it mirrors `applyTransition`'s rule in the reactions
      // repository: pressing what you already hold takes it back.
      const held = short.viewerReaction;
      const next = held === value ? null : value;
      const optimistic: ShortInteraction = {
        viewerReaction: next,
        likeCount: Math.max(
          short.likeCount + ((next === 1 ? 1 : 0) - (held === 1 ? 1 : 0)),
          0,
        ),
        subscribed: short.subscribed,
      };
      setInteractions((current) => ({ ...current, [short.id]: optimistic }));

      const write = onReact ?? postReaction;
      void write(short.id, value)
        .then((settled) => {
          setInteractions((current) => ({
            ...current,
            [short.id]: {
              viewerReaction: settled.viewerReaction,
              likeCount: settled.likeCount,
              subscribed: current[short.id]?.subscribed ?? short.subscribed,
            },
          }));
        })
        .catch(() => {
          // Back to what the server last told us. A like that stays lit after a
          // failed write is a lie the next page load contradicts.
          setInteractions((current) => ({
            ...current,
            [short.id]: {
              viewerReaction: held,
              likeCount: short.likeCount,
              subscribed: current[short.id]?.subscribed ?? short.subscribed,
            },
          }));
        });
    },
    [onReact],
  );

  const toggleSubscribe = useCallback((short: ShortItem): void => {
    // Local only, and that is a real gap rather than a shortcut: the subscribe
    // write lives on a channels endpoint this slice does not own, so the button
    // reflects the press and does not persist it. The watch page's own
    // subscribe button has the same gap for the same reason.
    setInteractions((current) => ({
      ...current,
      [short.id]: {
        viewerReaction: current[short.id]?.viewerReaction ?? short.viewerReaction,
        likeCount: current[short.id]?.likeCount ?? short.likeCount,
        subscribed: !short.subscribed,
      },
    }));
  }, []);

  /* -------------------------------------------------------------- view -- */

  if (items.length === 0) {
    return (
      <div data-shorts-empty="" className="grid h-full place-items-center text-secondary">
        No Shorts yet.
      </div>
    );
  }

  return (
    <div className={clsx("relative flex h-full", className)}>
      <div
        ref={containerRef}
        data-shorts-pager=""
        role="region"
        aria-roledescription="Shorts feed"
        aria-label="Shorts"
        tabIndex={-1}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={clsx(
          "h-full flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain",
          // The platform scrollbar would sit between the video and the rail.
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {shown.map((short, position) => {
          const active = position === nav.index;
          return (
            <section
              key={short.id}
              ref={(node) => {
                slideRefs.current[position] = node;
              }}
              data-shorts-slide={position}
              aria-hidden={active ? undefined : true}
              aria-label={short.title}
              className="flex h-full snap-start items-center justify-center py-2"
            >
              <ShortsPlayer
                short={short}
                hot={hot.has(position)}
                active={active}
                muted={muted}
                onMutedChange={changeMuted}
                commentsOpen={commentsOpenFor === short.id}
                onToggleComments={() =>
                  setCommentsOpenFor((open) => (open === short.id ? null : short.id))
                }
                onReact={(value) => react(short, value)}
                onToggleSubscribe={() => toggleSubscribe(short)}
                onShare={() => copyShortLink(short.id)}
                onRemix={noop}
                loadComments={loadComments}
                commentsViewer={commentsViewer}
                now={now}
                menuItems={<ShortMenuItems />}
                createEngine={createEngine}
              />
            </section>
          );
        })}
      </div>

      {/* §11: 56 × 56, radius 28, Tonal Mono SizeXl, a further 178px right of
          the action rail — well clear of it. */}
      <div
        data-shorts-nav=""
        className="hidden shrink-0 flex-col items-center justify-center gap-2 self-center pr-6 pl-[178px] lg:flex"
      >
        <NavButton
          direction="up"
          label="Previous Short"
          disabled={nav.index === 0}
          onClick={() => move(-1)}
        />
        <NavButton
          direction="down"
          label="Next Short"
          disabled={nav.index === items.length - 1}
          onClick={() => move(1)}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- parts -- */

function NavButton({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "up" | "down";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-shorts-nav-button={direction}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={buttonClassName({
        variant: "tonal",
        palette: "mono",
        size: "xl",
        iconOnly: true,
      })}
    >
      <ChevronIcon direction={direction} size={24} />
    </button>
  );
}

/**
 * The kebab's rows.
 *
 * Not measured — §11's capture has no menu in it — and deliberately inert.
 * Report, Save and "Not interested" are three other slices' writes; rendering
 * them as live controls that do nothing would be worse than rendering them as
 * what they are.
 */
function ShortMenuItems() {
  return (
    <>
      <MenuItem disabled>Save to playlist</MenuItem>
      <MenuItem disabled>Not interested</MenuItem>
      <MenuItem disabled>Report</MenuItem>
    </>
  );
}

/* --------------------------------------------------------------- helpers - */

function noop(): void {
  /* Remix opens the Shorts editor, which this application does not have. The
     button is measured and is therefore rendered; pretending it does something
     would be the dishonest option. */
}

function clamp(value: number, count: number): number {
  if (count === 0) return 0;
  return Math.max(0, Math.min(count - 1, value));
}

/** ↑/↓, `j`/`k`, PageUp/PageDown. `0` means "not a navigation key". */
function keyDelta(key: string): number {
  switch (key) {
    case "ArrowDown":
    case "PageDown":
    case "j":
    case "J":
      return 1;
    case "ArrowUp":
    case "PageUp":
    case "k":
    case "K":
      return -1;
    default:
      return 0;
  }
}

/**
 * Is the event coming from somewhere a keystroke means a character?
 *
 * `src/components/player/keyboard.ts` has an `isTypingContext` doing the same
 * job for the landscape player. It is not imported: that module is another
 * slice's and is being built concurrently, and reaching into it would couple
 * two players' shortcut handling together. This wants lifting into a shared
 * place once both have landed — flagged rather than silently duplicated.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined) return;
    setReduced(query.matches);
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

function readStoredMuted(): boolean {
  try {
    // Session-scoped, which is what §10 asks for: it frames the unmute as "the
    // user unmuted within this session". A preference carried across a cold
    // load would be refused by the autoplay policy on the very first item
    // anyway, and the fallback would immediately write it back to muted.
    return window.sessionStorage.getItem(SHORTS_MUTED_STORAGE_KEY) !== "false";
  } catch {
    // Storage throws rather than returning null in a partitioned or
    // storage-blocked context. Muted is the safe default in every browser.
    return true;
  }
}

function writeStoredMuted(muted: boolean): void {
  try {
    window.sessionStorage.setItem(SHORTS_MUTED_STORAGE_KEY, String(muted));
  } catch {
    /* Nothing to do: the preference simply does not outlive this page. */
  }
}

/** The share button. `navigator.clipboard` is absent on http origins and in
 *  jsdom, so the failure branch is real rather than defensive. */
function copyShortLink(id: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(shortHref(id), window.location.origin).toString();
  void navigator.clipboard?.writeText?.(url).catch(() => {
    /* A share that cannot reach the clipboard is not an error worth throwing;
       the link is in the address bar either way. */
  });
}

/** The default reaction write — the same endpoint the watch page posts to. */
async function postReaction(
  videoId: string,
  value: 1 | -1,
): Promise<{ likeCount: number; viewerReaction: ReactionState }> {
  const response = await fetch(`/api/videos/${videoId}/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "video", value }),
  });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as {
    likeCount: number;
    viewerReaction: ReactionState;
  };
}
