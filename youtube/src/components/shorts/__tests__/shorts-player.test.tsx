import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState } from "react";

import type { CreatePlayerOptions, PlayerEngine } from "@/media/player";

import { ShortsPlayer, playerOptionsFor, type ShortItem } from "../shorts-player";

import { engineSpy, makeShort, type RecordedEngine } from "./fixtures";

/**
 * One reel.
 *
 * Three things are asserted here that a browser cannot be relied on to reveal
 * in a unit test and that a reimplementation gets wrong on its own:
 *
 *  1. **The engine's lifetime is `hot`, not the component's.** The teardown
 *     assertion deliberately keeps the component mounted, because a test that
 *     unmounts would pass against an implementation that only cleans up on
 *     unmount — which is the implementation `research/03-mse-player-abr.md` §10
 *     says fails on a real feed.
 *  2. **The rejected `play()` promise is a state.** Both branches — refused
 *     while unmuted, refused while muted — end somewhere the UI can show.
 *  3. **A progressive short takes the progressive options** and renders the
 *     same chrome, because "one quality and no ladder" must not read as broken.
 */

const nativePlay = HTMLMediaElement.prototype.play;

afterEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: nativePlay,
  });
});

/** Replace `play()` for one test. The shim in `vitest.setup.ts` resolves. */
function stubPlay(implementation: (this: HTMLMediaElement) => Promise<void>): void {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn(implementation),
  });
}

/**
 * A harness that owns the mute state, because the player reports a change
 * rather than holding one — the feed is what persists it across items.
 */
function Harness({
  short,
  hot = true,
  active = true,
  initialMuted = true,
  createEngine,
  onMuted,
}: {
  short: ShortItem;
  hot?: boolean;
  active?: boolean;
  initialMuted?: boolean;
  createEngine?: (options: CreatePlayerOptions) => PlayerEngine;
  onMuted?: (muted: boolean) => void;
}) {
  const [muted, setMuted] = useState(initialMuted);
  const onMutedChange = useCallback(
    (next: boolean) => {
      setMuted(next);
      onMuted?.(next);
    },
    [onMuted],
  );
  return (
    <ShortsPlayer
      short={short}
      hot={hot}
      active={active}
      muted={muted}
      onMutedChange={onMutedChange}
      commentsOpen={false}
      onToggleComments={vi.fn()}
      onReact={vi.fn()}
      onToggleSubscribe={vi.fn()}
      onShare={vi.fn()}
      onRemix={vi.fn()}
      createEngine={createEngine}
    />
  );
}

function playerRoot(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-shorts-player]");
  if (node === null) throw new Error("no player rendered");
  return node;
}

function videoElement(): HTMLVideoElement {
  const node = document.querySelector("video");
  if (node === null) throw new Error("no video rendered");
  return node;
}

/* ------------------------------------------------------- playback routing */

describe("playerOptionsFor", () => {
  it("routes a progressive short by its column, with no playlist and no codecs", () => {
    const options = playerOptionsFor({
      pipeline: "progressive",
      masterPlaylistUrl: null,
      progressiveSources: [{ id: "k", url: "/api/media/videos/v/source.mp4", name: "Original" }],
      renditionCodecs: [],
    });

    expect(options.pipeline).toBe("progressive");
    expect(options.progressiveSources).toHaveLength(1);
    // Not "undefined but present": `createPlayer` branches on `pipeline` before
    // it ever looks at these, and passing a playlist a progressive upload does
    // not have would be a lie about the row.
    expect(options.masterPlaylistUrl).toBeUndefined();
    expect(options.renditionCodecs).toBeUndefined();
  });

  it("gives a laddered short its playlist, its codecs and its progressive fallback", () => {
    const options = playerOptionsFor({
      pipeline: "laddered",
      masterPlaylistUrl: "/api/media/videos/v/master.m3u8",
      progressiveSources: [{ id: "k", url: "/api/media/videos/v/source.mp4", name: "Original" }],
      renditionCodecs: ["avc1.4d401f", "avc1.640028"],
    });

    expect(options.masterPlaylistUrl).toBe("/api/media/videos/v/master.m3u8");
    expect(options.renditionCodecs).toEqual(["avc1.4d401f", "avc1.640028"]);
    // research §9's last resort. Omitting it turns a browser with no usable
    // MediaSource into a thrown error rather than a fallback.
    expect(options.progressiveSources).toHaveLength(1);
  });
});

/* ------------------------------------------------------- engine lifetime */

describe("the engine's lifetime", () => {
  it("builds nothing while the item is outside the hot window", () => {
    const spy = engineSpy();
    render(<Harness short={makeShort("s0")} hot={false} active={false} createEngine={spy.factory} />);
    expect(spy.engines).toHaveLength(0);
  });

  it("builds one engine and loads it when the item becomes hot", () => {
    const spy = engineSpy();
    const { rerender } = render(
      <Harness short={makeShort("s0")} hot={false} active={false} createEngine={spy.factory} />,
    );
    rerender(<Harness short={makeShort("s0")} hot active={false} createEngine={spy.factory} />);

    expect(spy.engines).toHaveLength(1);
    expect(spy.engines[0]?.load).toHaveBeenCalledOnce();
    // Prepared but not playing: §10's whole point is that buffer preparation is
    // ungated and only `play()` is.
    expect(playerRoot()).toHaveAttribute("data-autoplay", "idle");
  });

  it("destroys the engine when the item leaves the window, without unmounting", () => {
    const spy = engineSpy();
    const short = makeShort("s0");
    const { rerender } = render(<Harness short={short} hot createEngine={spy.factory} />);
    const engine = spy.engines[0] as RecordedEngine;

    rerender(<Harness short={short} hot={false} active={false} createEngine={spy.factory} />);

    expect(engine.destroy).toHaveBeenCalledOnce();
    // The slide is still there. Teardown is a state transition, not a
    // consequence of React removing the subtree — which is what makes it
    // survive a refactor that keeps every slide mounted.
    expect(document.querySelector("video")).not.toBeNull();
    expect(spy.engines).toHaveLength(1);
  });

  it("does not rebuild the engine when a count changes", () => {
    const spy = engineSpy();
    const short = makeShort("s0", { likeCount: 10 });
    const { rerender } = render(<Harness short={short} hot createEngine={spy.factory} />);

    // The feed hands down a fresh object after a Like. A rebuild here would be
    // a rebuffer per tap.
    rerender(
      <Harness
        short={{ ...short, likeCount: 11, viewerReaction: 1 }}
        hot
        createEngine={spy.factory}
      />,
    );

    expect(spy.engines).toHaveLength(1);
    expect(spy.engines[0]?.destroy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------- autoplay */

describe("autoplay", () => {
  it("plays muted, and says so on the element rather than only in React", async () => {
    const spy = engineSpy();
    render(<Harness short={makeShort("s0")} createEngine={spy.factory} />);

    await waitFor(() => expect(playerRoot()).toHaveAttribute("data-autoplay", "playing"));
    const video = videoElement();
    expect(video.muted).toBe(true);
    // §10: authored as attributes, because Safari's heuristics read the
    // element rather than React's props. `muted` is the one React declines to
    // render, so the component sets it through a callback ref — asserting the
    // attribute rather than only the property is what keeps that from being
    // quietly dropped.
    expect(video).toHaveAttribute("muted");
    expect(video).toHaveAttribute("loop");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("autoplay");
  });

  it("takes the muted attribute back off when the viewer unmutes", async () => {
    const spy = engineSpy();
    render(<Harness short={makeShort("s0")} createEngine={spy.factory} />);

    await userEvent.click(screen.getByLabelText("Unmute"));
    await waitFor(() => expect(videoElement()).not.toHaveAttribute("muted"));
  });

  it("does not autoplay an item that is only preloaded", () => {
    const spy = engineSpy();
    render(<Harness short={makeShort("s0")} hot active={false} createEngine={spy.factory} />);
    expect(videoElement()).not.toHaveAttribute("autoplay");
  });

  it("falls back to muted when an unmuted attempt is refused, and says why", async () => {
    // The exact shape of the policy: muted always allowed, unmuted refused
    // without a fresh gesture.
    stubPlay(function (this: HTMLMediaElement) {
      return this.muted
        ? Promise.resolve()
        : Promise.reject(new DOMException("blocked", "NotAllowedError"));
    });

    const spy = engineSpy();
    const onMuted = vi.fn();
    render(
      <Harness
        short={makeShort("s0")}
        initialMuted={false}
        onMuted={onMuted}
        createEngine={spy.factory}
      />,
    );

    await waitFor(() =>
      expect(playerRoot()).toHaveAttribute("data-autoplay", "muted-fallback"),
    );
    // The preference is corrected rather than left disagreeing with reality.
    expect(onMuted).toHaveBeenCalledWith(true);
    expect(videoElement().muted).toBe(true);
    expect(screen.getByText("Tap to unmute")).toBeInTheDocument();
  });

  it("enters a tap-to-play state when even a muted attempt is refused", async () => {
    stubPlay(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));

    const spy = engineSpy();
    render(<Harness short={makeShort("s0")} createEngine={spy.factory} />);

    await waitFor(() => expect(playerRoot()).toHaveAttribute("data-autoplay", "blocked"));
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
  });

  it("recovers from the blocked state on a real gesture", async () => {
    let refuse = true;
    stubPlay(() =>
      refuse ? Promise.reject(new DOMException("blocked", "NotAllowedError")) : Promise.resolve(),
    );

    const spy = engineSpy();
    render(<Harness short={makeShort("s0")} createEngine={spy.factory} />);
    await waitFor(() => expect(playerRoot()).toHaveAttribute("data-autoplay", "blocked"));

    refuse = false;
    await userEvent.click(screen.getByLabelText("Play"));
    await waitFor(() => expect(playerRoot()).toHaveAttribute("data-autoplay", "playing"));
  });

  it("pauses an item that stops being the active one", async () => {
    const spy = engineSpy();
    const short = makeShort("s0");
    const { rerender } = render(<Harness short={short} createEngine={spy.factory} />);
    await waitFor(() => expect(playerRoot()).toHaveAttribute("data-autoplay", "playing"));

    const pause = vi.spyOn(videoElement(), "pause");
    rerender(<Harness short={short} hot active={false} createEngine={spy.factory} />);

    expect(pause).toHaveBeenCalled();
    expect(playerRoot()).toHaveAttribute("data-autoplay", "idle");
  });
});

/* --------------------------------------------------------------- chrome */

describe("the reel's chrome", () => {
  it("renders the rail and the metapanel only on the active item", () => {
    const spy = engineSpy();
    const short = makeShort("s0");
    const { rerender } = render(
      <Harness short={short} hot active={false} createEngine={spy.factory} />,
    );
    expect(document.querySelector("[data-shorts-rail]")).toBeNull();
    expect(document.querySelector("[data-shorts-metapanel]")).toBeNull();

    rerender(<Harness short={short} hot active createEngine={spy.factory} />);
    expect(document.querySelector("[data-shorts-rail]")).not.toBeNull();
    expect(document.querySelector("[data-shorts-metapanel]")).not.toBeNull();
  });

  it("shows the handle, the title and a subscribe button in the metapanel", () => {
    const spy = engineSpy();
    render(
      <Harness
        short={makeShort("s0", {
          title: "Avocado Clicker",
          channel: {
            id: "c1",
            name: "Ludo dojo",
            handle: "Ludo-dojo",
            avatarUrl: null,
          },
        })}
        createEngine={spy.factory}
      />,
    );

    expect(screen.getByText("@Ludo-dojo")).toBeInTheDocument();
    expect(screen.getByText("Avocado Clicker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });

  it("toggles mute through the control", async () => {
    const spy = engineSpy();
    const onMuted = vi.fn();
    render(<Harness short={makeShort("s0")} onMuted={onMuted} createEngine={spy.factory} />);

    await userEvent.click(screen.getByLabelText("Unmute"));
    expect(onMuted).toHaveBeenCalledWith(false);
    await waitFor(() => expect(videoElement().muted).toBe(false));
  });
});

/* --------------------------------------------------------- progressive */

describe("a progressive short", () => {
  const progressive = makeShort("p0", {
    pipeline: "progressive",
    masterPlaylistUrl: null,
    renditionCodecs: [],
  });

  it("is routed by its pipeline column, not by probing", () => {
    const spy = engineSpy();
    render(<Harness short={progressive} createEngine={spy.factory} />);

    expect(spy.engines[0]?.options.pipeline).toBe("progressive");
    expect(spy.engines[0]?.options.masterPlaylistUrl).toBeUndefined();
    expect(playerRoot()).toHaveAttribute("data-pipeline", "progressive");
  });

  it("renders the same chrome as a laddered one", async () => {
    const spy = engineSpy();
    render(<Harness short={progressive} createEngine={spy.factory} />);

    // One quality and no ladder is not a degraded UI here: Shorts has no
    // quality menu on either path, so the two surfaces are identical.
    expect(document.querySelector("[data-shorts-rail]")).not.toBeNull();
    expect(document.querySelector("[data-shorts-metapanel]")).not.toBeNull();
    await waitFor(() => expect(playerRoot()).toHaveAttribute("data-autoplay", "playing"));
  });
});
