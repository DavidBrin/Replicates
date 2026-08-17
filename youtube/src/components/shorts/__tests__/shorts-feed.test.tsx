import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  KEEP_BEHIND,
  PRELOAD_AHEAD,
  SHORTS_MUTED_STORAGE_KEY,
  SWIPE_THRESHOLD_PX,
  ShortsFeed,
  hotIndices,
  indexFromPopState,
  shortHref,
} from "../shorts-feed";

import { engineSpy, makeFeed } from "./fixtures";

/**
 * The pager.
 *
 * The suite is organised around the two claims that matter and that a
 * six-short seed cannot check on its own:
 *
 *  1. **Exactly one item ahead is preloaded, and the one behind is destroyed.**
 *     `research/03-mse-player-abr.md` §10 calls a leak here "the primary mobile
 *     OOM/crash risk specific to this surface", and the failure mode is that it
 *     looks perfect until the feed is long. So the assertions are about the
 *     *count of live engines after walking the feed*, not about what happens on
 *     one swipe.
 *  2. **Every input method reaches the same `goTo`.** Four of them exist and
 *     they have to agree, including on the URL they leave behind.
 */

const PAGER = "[data-shorts-pager]";

function pager(): HTMLElement {
  const node = document.querySelector<HTMLElement>(PAGER);
  if (node === null) throw new Error("no pager rendered");
  return node;
}

/** The id of the item currently showing its chrome. */
function activeId(): string | null {
  return (
    document
      .querySelector("[data-shorts-player][data-active]")
      ?.getAttribute("data-shorts-player") ?? null
  );
}

/** Give an element a layout jsdom will not compute on its own. */
function fakeMetrics(node: HTMLElement, clientHeight: number, scrollTop: number): void {
  Object.defineProperty(node, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(node, "scrollTop", { value: scrollTop, configurable: true });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/shorts");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------- the window -- */

describe("hotIndices", () => {
  it("is the visible item plus exactly one ahead", () => {
    expect(PRELOAD_AHEAD).toBe(1);
    expect(KEEP_BEHIND).toBe(0);
    expect(hotIndices(3, 10)).toEqual([3, 4]);
  });

  it("clamps at both ends rather than producing an index nothing renders", () => {
    expect(hotIndices(0, 10)).toEqual([0, 1]);
    expect(hotIndices(9, 10)).toEqual([9]);
    expect(hotIndices(0, 1)).toEqual([0]);
    expect(hotIndices(0, 0)).toEqual([]);
  });

  it("never widens with the feed — which is the whole point", () => {
    expect(hotIndices(500, 10_000)).toHaveLength(2);
  });
});

/* -------------------------------------------------- preload and teardown -- */

describe("preload and teardown", () => {
  it("prepares the visible item and the next one, and nothing further", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    expect(spy.engines.map((engine) => engine.videoId)).toEqual(["s0", "s1"]);
    // §10: preparation is ungated by autoplay policy, so the next item is
    // loaded rather than merely constructed.
    expect(spy.forVideo("s1")[0]?.load).toHaveBeenCalledOnce();
    expect(spy.forVideo("s2")).toHaveLength(0);
  });

  it("destroys the item left behind and preloads the new next one", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(spy.forVideo("s0")[0]?.destroy).toHaveBeenCalledOnce();
    expect(spy.forVideo("s2")).toHaveLength(1);
    // The item that was preloaded and is now playing keeps the *same* engine.
    // Rebuilding it here would throw away the buffer the preload existed to
    // fill, which is the bug that reads as "Shorts always spins on swipe".
    expect(spy.forVideo("s1")).toHaveLength(1);
    expect(spy.forVideo("s1")[0]?.destroy).not.toHaveBeenCalled();
  });

  it("holds two engines however far the feed is walked", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(24)} createEngine={spy.factory} />);

    for (let step = 0; step < 20; step += 1) {
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
    }

    // Twenty-one items have been visited and twenty-two engines built; two are
    // alive. On the real path each of those is a `MediaSource` with its
    // `SourceBuffer`s, and the count not growing is the property.
    expect(spy.engines.length).toBeGreaterThan(20);
    expect(spy.liveVideoIds().sort()).toEqual(["s20", "s21"]);
  });

  it("rebuilds an item on the way back rather than keeping it warm", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowUp" });

    // `KEEP_BEHIND` is 0, so going back costs one startup. That is the trade
    // the constant names, and asserting it stops the window quietly widening.
    expect(spy.forVideo("s0")).toHaveLength(2);
    expect(spy.forVideo("s0")[1]?.destroy).not.toHaveBeenCalled();
  });

  it("destroys every live engine when the feed goes away", () => {
    const spy = engineSpy();
    const { unmount } = render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    unmount();

    expect(spy.liveVideoIds()).toEqual([]);
  });
});

/* -------------------------------------------------------------- keyboard - */

describe("keyboard navigation", () => {
  it("moves on the arrows and on j/k", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(activeId()).toBe("s1");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(activeId()).toBe("s2");
    fireEvent.keyDown(document.body, { key: "k" });
    expect(activeId()).toBe("s1");
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(activeId()).toBe("s0");
  });

  it("stops at the ends instead of wrapping", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(2)} createEngine={spy.factory} />);

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(activeId()).toBe("s0");
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(activeId()).toBe("s1");
  });

  it("leaves a typing context alone", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    // The comments panel has a composer in it, and `j` is a letter.
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "j" });
    expect(activeId()).toBe("s0");
    input.remove();
  });

  it("ignores a modified keystroke, which belongs to the browser", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.keyDown(document.body, { key: "ArrowDown", metaKey: true });
    expect(activeId()).toBe("s0");
  });
});

/* ----------------------------------------------------------------- wheel - */

describe("wheel navigation", () => {
  it("advances exactly one short per gesture", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    // A trackpad flick emits a long decaying tail from one gesture. Without the
    // cooldown, one flick pages through five shorts.
    fireEvent.wheel(pager(), { deltaY: 120 });
    fireEvent.wheel(pager(), { deltaY: 90 });
    fireEvent.wheel(pager(), { deltaY: 40 });
    expect(activeId()).toBe("s1");
  });

  it("moves again once the cooldown has passed", () => {
    const spy = engineSpy();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.wheel(pager(), { deltaY: 120 });
    clock.mockReturnValue(1_000 + 400);
    fireEvent.wheel(pager(), { deltaY: 120 });
    expect(activeId()).toBe("s2");
  });

  it("goes back on an upward wheel and ignores a tremor", () => {
    const spy = engineSpy();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.wheel(pager(), { deltaY: 120 });
    clock.mockReturnValue(2_000);
    fireEvent.wheel(pager(), { deltaY: 4 });
    expect(activeId()).toBe("s1");
    fireEvent.wheel(pager(), { deltaY: -120 });
    expect(activeId()).toBe("s0");
  });
});

/* ----------------------------------------------------------------- touch - */

describe("touch navigation", () => {
  function swipe(from: number, to: number): void {
    fireEvent.touchStart(pager(), { touches: [{ clientY: from }] });
    fireEvent.touchEnd(pager(), { changedTouches: [{ clientY: to }] });
  }

  it("advances on an upward swipe and goes back on a downward one", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    swipe(600, 600 - SWIPE_THRESHOLD_PX * 2);
    expect(activeId()).toBe("s1");
    swipe(300, 300 + SWIPE_THRESHOLD_PX * 2);
    expect(activeId()).toBe("s0");
  });

  it("treats a short drag as a tap", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    swipe(600, 600 - (SWIPE_THRESHOLD_PX - 1));
    expect(activeId()).toBe("s0");
  });

  it("yields to the platform when the native scroller already moved", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    // The scroll-snap container handled the gesture itself. Acting on it again
    // would skip an item.
    let scrollTop = 0;
    Object.defineProperty(pager(), "scrollTop", {
      get: () => scrollTop,
      configurable: true,
    });

    fireEvent.touchStart(pager(), { touches: [{ clientY: 600 }] });
    scrollTop = 900;
    fireEvent.touchEnd(pager(), { changedTouches: [{ clientY: 100 }] });

    expect(activeId()).toBe("s0");
  });
});

/* ---------------------------------------------------------------- scroll - */

describe("the native scroller", () => {
  it("adopts whatever slide the scroller settled on", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fakeMetrics(pager(), 800, 1_600);
    fireEvent.scroll(pager());

    expect(activeId()).toBe("s2");
    expect(window.location.pathname).toBe(shortHref("s2"));
  });

  it("ignores a scroll event from a container with no layout", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    // `scrollTop / 0` is `NaN`, and `Math.round(NaN)` is `NaN` — an index no
    // slide has. jsdom reports zero here; so does a real container mid-relayout.
    fakeMetrics(pager(), 0, 1_600);
    fireEvent.scroll(pager());

    expect(activeId()).toBe("s0");
  });
});

/* ------------------------------------------------------------------- url - */

describe("the URL", () => {
  it("names the short that is showing, from the first frame", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);
    expect(window.location.pathname).toBe("/shorts/s0");
  });

  it("pushes an entry per short so Back walks the feed", () => {
    const push = vi.spyOn(window.history, "pushState");
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(push).toHaveBeenCalledWith({ shortsIndex: 1 }, "", "/shorts/s1");
    expect(window.location.pathname).toBe("/shorts/s1");
  });

  it("does not push an entry for a move that came from history", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    const push = vi.spyOn(window.history, "pushState");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { shortsIndex: 0 } }));
    });

    expect(activeId()).toBe("s0");
    // Writing one here is how a Back button starts needing two presses.
    expect(push).not.toHaveBeenCalled();
  });

  it("follows an entry it did not write, by reading the path", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    act(() => {
      window.history.pushState(null, "", "/shorts/s3");
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(activeId()).toBe("s3");
  });

  it("leaves the pager alone for an entry that is not one of its shorts", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} createEngine={spy.factory} />);

    act(() => {
      window.history.pushState(null, "", "/watch?v=s3");
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(activeId()).toBe("s0");
  });
});

describe("indexFromPopState", () => {
  const ids = ["a", "b", "c"];

  it("prefers the state it wrote, because an id can drop out of a feed", () => {
    expect(indexFromPopState({ shortsIndex: 2 }, "/shorts/a", ids)).toBe(2);
  });

  it("refuses a state index the feed cannot satisfy", () => {
    expect(indexFromPopState({ shortsIndex: 9 }, "/shorts/b", ids)).toBe(1);
    expect(indexFromPopState({ shortsIndex: -1 }, "/nope", ids)).toBeNull();
  });

  it("reads an encoded id back out of the path", () => {
    expect(indexFromPopState(null, "/shorts/c", ids)).toBe(2);
    expect(indexFromPopState(null, `/shorts/${encodeURIComponent("c")}`, ids)).toBe(2);
  });

  it("is null for anything that is not a short in this feed", () => {
    expect(indexFromPopState(null, "/shorts/zzz", ids)).toBeNull();
    expect(indexFromPopState(null, "/watch", ids)).toBeNull();
    expect(indexFromPopState(undefined, "/shorts/", ids)).toBeNull();
  });
});

/* ------------------------------------------------------------------ mute - */

describe("mute", () => {
  it("starts muted, because that is the only autoplay every engine allows", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(3)} createEngine={spy.factory} />);
    expect(document.querySelector("video")?.muted).toBe(true);
  });

  it("carries an unmute to the next short, and remembers it", async () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(3)} createEngine={spy.factory} />);

    await userEvent.click(screen.getByLabelText("Unmute"));
    expect(window.sessionStorage.getItem(SHORTS_MUTED_STORAGE_KEY)).toBe("false");

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    // §10: a freshly created element does not inherit the gesture that unlocked
    // the previous one, so the preference has to be re-applied by us.
    const active = document.querySelector<HTMLVideoElement>(
      "[data-shorts-player][data-active] video",
    );
    expect(active?.muted).toBe(false);
  });

  it("re-applies a stored unmute to a feed that mounts later", () => {
    window.sessionStorage.setItem(SHORTS_MUTED_STORAGE_KEY, "false");
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(3)} createEngine={spy.factory} />);
    expect(document.querySelector("video")?.muted).toBe(false);
  });
});

/* ------------------------------------------------------------ comments --- */

describe("the comments panel", () => {
  it("opens over the reel rather than navigating away", async () => {
    const spy = engineSpy();
    const loadComments = vi.fn(async () => []);
    render(
      <ShortsFeed items={makeFeed(3)} createEngine={spy.factory} loadComments={loadComments} />,
    );

    await userEvent.click(screen.getByLabelText("4,882 Comments"));

    // Still on the same short, still playing, panel beside it.
    expect(activeId()).toBe("s0");
    expect(window.location.pathname).toBe("/shorts/s0");
    expect(screen.getByRole("dialog", { name: "Comments on Short s0" })).toBeInTheDocument();
    // Fetched on open, not shipped with the feed: twenty threads nobody reads
    // is the payload this avoids.
    expect(loadComments).toHaveBeenCalledWith("s0");
  });

  it("closes on Escape and on its own button", async () => {
    const spy = engineSpy();
    const loadComments = vi.fn(async () => []);
    render(
      <ShortsFeed items={makeFeed(3)} createEngine={spy.factory} loadComments={loadComments} />,
    );

    await userEvent.click(screen.getByLabelText("4,882 Comments"));
    await userEvent.click(screen.getByLabelText("Close comments"));
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByLabelText("4,882 Comments"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not carry one short's thread onto the next", async () => {
    const spy = engineSpy();
    const loadComments = vi.fn(async () => []);
    render(
      <ShortsFeed items={makeFeed(3)} createEngine={spy.factory} loadComments={loadComments} />,
    );

    await userEvent.click(screen.getByLabelText("4,882 Comments"));
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(activeId()).toBe("s1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when nothing can fetch a thread", async () => {
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(3)} createEngine={spy.factory} />);

    await userEvent.click(screen.getByLabelText("4,882 Comments"));

    // Honest rather than an empty list, which would read as "no comments" on a
    // short whose rail says 4,882.
    expect(document.querySelector("[data-shorts-comments-unavailable]")).not.toBeNull();
  });

  it("says so when the fetch fails", async () => {
    const spy = engineSpy();
    const loadComments = vi.fn(async () => {
      throw new Error("nope");
    });
    render(
      <ShortsFeed items={makeFeed(3)} createEngine={spy.factory} loadComments={loadComments} />,
    );

    await userEvent.click(screen.getByLabelText("4,882 Comments"));

    await screen.findByText("Comments could not be loaded.");
  });
});

/* -------------------------------------------------------------- motion --- */

describe("the snap animation", () => {
  it("animates the move by default", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(3)} createEngine={spy.factory} />);

    scrollIntoView.mockClear();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("does not, under prefers-reduced-motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
      const spy = engineSpy();
      render(<ShortsFeed items={makeFeed(3)} createEngine={spy.factory} />);

      scrollIntoView.mockClear();
      fireEvent.keyDown(document.body, { key: "ArrowDown" });

      // The scripted scroll's `behavior` argument beats the stylesheet, so the
      // `scroll-behavior: auto !important` in `globals.css` is not enough on
      // its own. §8.4 of research/07 asks for non-essential motion to stop, and
      // the jump between shorts is decoration; the video keeps playing.
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    } finally {
      window.matchMedia = original;
    }
  });

  it("does not animate the first frame of a deep link", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const spy = engineSpy();
    render(<ShortsFeed items={makeFeed(5)} initialIndex={3} createEngine={spy.factory} />);

    // Smooth-scrolling to item three on arrival would show the viewer three
    // shorts they did not ask for.
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    expect(activeId()).toBe("s3");
  });
});

/* --------------------------------------------------------------- empty --- */

describe("an empty feed", () => {
  it("says so rather than rendering a blank viewport", () => {
    const spy = engineSpy();
    render(<ShortsFeed items={[]} createEngine={spy.factory} />);
    expect(screen.getByText("No Shorts yet.")).toBeInTheDocument();
    expect(spy.engines).toHaveLength(0);
  });
});
