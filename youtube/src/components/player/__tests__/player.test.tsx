import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { EngineState, PlayerEngine, QualityOption } from "@/media/player";

import { CONTROLS_AUTOHIDE_MS } from "../controls";
import { Player, type PlayerProps } from "../player";

/**
 * The player, assembled.
 *
 * These are the tests that need the whole component: the document-level
 * shortcut layer, the auto-hide timer, and the two pipelines producing
 * different chrome. Everything narrower is asserted against the piece that owns
 * it.
 *
 * The engine is a fake. `createPlayer` in a jsdom run finds no `MediaSource`
 * and resolves to the progressive path, which is a real behaviour and not the
 * one under test here — `PlayerProps.createEngine` exists so the chrome can be
 * driven from a known `EngineState` rather than from whatever the environment
 * happens to support. The engine's own behaviour has 181 tests of its own.
 */

const LADDER: readonly QualityOption[] = [
  { id: "1080", name: "1080p", width: 1920, height: 1080, bitrate: 5_000_000, codecs: [] },
  { id: "720", name: "720p", width: 1280, height: 720, bitrate: 2_500_000, codecs: [] },
];

const EMPTY_METRICS: EngineState["metrics"] = {
  startupMs: null,
  manifestMs: null,
  firstSegmentMs: null,
  rebufferCount: 0,
  rebufferSeconds: 0,
  watchedSeconds: 0,
  rebufferRatio: 0,
  meanBitrateBps: 0,
  upSwitches: 0,
  downSwitches: 0,
  oscillations: 0,
  quotaExceededCount: 0,
  droppedFrameRatio: null,
  qoe: 0,
};

function engineState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    mode: "media-source",
    phase: "playing",
    qualities: LADDER,
    activeQualityId: "720",
    fetchingQualityId: "720",
    pinnedQualityId: null,
    bufferedAheadSeconds: 12,
    throughputBps: 3_000_000,
    error: null,
    metrics: EMPTY_METRICS,
    ...overrides,
  };
}

function fakeEngine(initial: EngineState = engineState()) {
  let state = initial;
  const listeners = new Set<(next: EngineState) => void>();
  const engine: PlayerEngine = {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    load: vi.fn().mockResolvedValue(undefined),
    setQuality: vi.fn(),
    tick: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
  return {
    engine,
    push(next: EngineState) {
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function renderPlayer(overrides: Partial<PlayerProps> = {}) {
  const fake = fakeEngine();
  const onToggleTheatre = vi.fn();
  const props: PlayerProps = {
    videoId: "v1",
    title: "How It's Made: Noodles",
    pipeline: "laddered",
    durationSeconds: 1820,
    masterPlaylistUrl: "/api/media/videos/v1/master.m3u8",
    theatre: false,
    onToggleTheatre,
    createEngine: () => fake.engine,
    ...overrides,
  };
  const view = render(<Player {...props} />);
  const video = document.querySelector("[data-player-video]") as HTMLVideoElement;
  return { ...fake, onToggleTheatre, video, view, props };
}

/**
 * `HTMLMediaElement.prototype.play` is stubbed **on the prototype** in
 * `vitest.setup.ts`, so its call log is shared by every test in the file. Two
 * of the assertions below are "this key was not stolen", which is exactly the
 * shape that passes for the wrong reason when a previous test's calls are still
 * on the counter.
 */
beforeEach(() => {
  vi.clearAllMocks();
});

describe("Player — the control bar (R8 §5.1, §8.3)", () => {
  it("renders the measured control set", () => {
    renderPlayer();
    // §8.3's tooltip strings, verbatim — they carry the shortcut, which is what
    // makes them the accessible names rather than bare verbs. The play button
    // reads `Play …` here because jsdom's element never leaves `paused`; the
    // measured capture was taken mid-playback and reads `Pause …`.
    expect(
      screen.getByRole("button", { name: "Play keyboard shortcut k" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute (m)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theater mode (t)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full screen (f)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Miniplayer (i)" })).toBeInTheDocument();
  });

  it("names the *next* action on the play button (§7.3)", () => {
    // §7.3: "Update `aria-label` … to reflect the action the button will
    // perform next, not the current state as a noun."
    renderPlayer();
    const button = screen.getByRole("button", { name: /keyboard shortcut k/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Play keyboard shortcut k");
  });

  it("writes the time as `M:SS / M:SS` with the separator as its own element", () => {
    // §5.5: the separator is a distinct element whose text is `" / "`, spaces
    // included.
    renderPlayer({ durationSeconds: 1820 });
    const time = document.querySelector("[data-player-time]") as HTMLElement;
    expect(time.querySelector("[data-time-current]")).toHaveTextContent("0:00");
    expect(time.querySelector("[data-time-separator]")?.textContent).toBe(" / ");
    expect(time.querySelector("[data-time-duration]")).toHaveTextContent("30:20");
  });

  it("falls back to the row's duration until the element reports one", () => {
    // `video.duration` is NaN until `loadedmetadata`; a scrubber whose
    // `aria-valuemax` is NaN for the first second announces nothing.
    renderPlayer({ durationSeconds: 596 });
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveAttribute(
      "aria-valuemax",
      "596",
    );
  });

  it("groups the controls rather than declaring a toolbar", () => {
    // §7.1 offers both. A `role="toolbar"` promises arrow-key roving, and §6
    // has already spent the arrows on seek and volume — a toolbar whose arrows
    // do something else is worse than a group.
    renderPlayer();
    expect(screen.getByRole("group", { name: "Player controls" })).toBeInTheDocument();
  });

  it("disables the captions button and says so when there is no track", () => {
    // §8.3, verbatim.
    renderPlayer({ captionTracks: [] });
    const button = screen.getByRole("button", {
      name: "Subtitles/closed captions unavailable",
    });
    expect(button).toBeDisabled();
  });
});

describe("Player — the shortcut layer (research/07 §6, §6.1)", () => {
  it("plays on k and on space", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer();
    await user.keyboard("k");
    expect(video.play).toHaveBeenCalled();
    await user.keyboard(" ");
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("seeks by the measured distances", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer({ durationSeconds: 1000 });
    video.currentTime = 100;

    await user.keyboard("l");
    expect(video.currentTime).toBe(110);
    await user.keyboard("j");
    expect(video.currentTime).toBe(100);
    await user.keyboard("{ArrowRight}");
    expect(video.currentTime).toBe(105);
    await user.keyboard("{ArrowLeft}");
    expect(video.currentTime).toBe(100);
  });

  it("maps the number row onto tenths of the duration", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer({ durationSeconds: 1000 });
    await user.keyboard("5");
    expect(video.currentTime).toBe(500);
    await user.keyboard("0");
    expect(video.currentTime).toBe(0);
  });

  it("mutes on m and steps the volume on the vertical arrows", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer();
    await user.keyboard("m");
    expect(video.muted).toBe(true);
    await user.keyboard("m");
    expect(video.muted).toBe(false);

    video.volume = 0.5;
    await user.keyboard("{ArrowUp}");
    expect(video.volume).toBeCloseTo(0.55);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(video.volume).toBeCloseTo(0.45);
  });

  it("toggles theatre on t", async () => {
    const user = userEvent.setup();
    const { onToggleTheatre } = renderPlayer();
    await user.keyboard("t");
    expect(onToggleTheatre).toHaveBeenCalledOnce();
  });

  it("steps frames only while paused", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer({ frameRate: 25 });
    video.currentTime = 10;
    // jsdom's `paused` is always true, which is the paused branch — so this
    // asserts the *permitted* case. The refused case is asserted against
    // `resolveShortcut` directly, where `paused` can be false.
    await user.keyboard(".");
    expect(video.currentTime).toBeCloseTo(10.04);
  });

  it("does not steal a keystroke from a text field (§6.1)", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer({ durationSeconds: 1000 });
    video.currentTime = 100;

    // The comment composer lives on the same page as the player, and this one
    // rule is what keeps typing the word "like" from seeking, muting and
    // toggling captions.
    const composer = document.createElement("textarea");
    document.body.append(composer);
    composer.focus();

    await user.keyboard("like j 5");
    expect(video.currentTime).toBe(100);
    expect(video.muted).toBe(false);
    expect(video.play).not.toHaveBeenCalled();
    expect(composer.value).toBe("like j 5");

    composer.remove();
  });

  it("does not steal from the masthead's search box either", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer();
    const search = document.createElement("input");
    search.type = "search";
    search.name = "search_query";
    document.body.append(search);
    search.focus();

    await user.keyboard("k/f");
    expect(video.play).not.toHaveBeenCalled();
    // §6.1's inverse case: a literal `/` typed into the search box must reach
    // the field rather than re-triggering "focus search" and being swallowed.
    expect(search.value).toBe("k/f");

    search.remove();
  });

  it("focuses the search box on / from outside a field", async () => {
    const user = userEvent.setup();
    renderPlayer();
    const search = document.createElement("input");
    search.type = "search";
    search.name = "search_query";
    document.body.append(search);

    await user.keyboard("/");
    expect(search).toHaveFocus();
    search.remove();
  });

  it("leaves a key it does not own to the browser", async () => {
    const user = userEvent.setup();
    const { video } = renderPlayer();
    await user.keyboard("q");
    expect(video.play).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", async () => {
    const user = userEvent.setup();
    const { video, view } = renderPlayer();
    view.unmount();
    await user.keyboard("k");
    expect(video.play).not.toHaveBeenCalled();
  });
});

describe("Player — auto-hide (R8 §6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the bar up while paused", () => {
    // jsdom never leaves `paused`, which is the state this asserts: a paused
    // player is being read rather than watched, and the bar stays.
    renderPlayer();
    const chrome = document.querySelector("[data-player-chrome]") as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(CONTROLS_AUTOHIDE_MS * 2);
    });
    expect(chrome.style.visibility).toBe("visible");
  });

  it("fades over the measured 0.25s on the decelerate curve", () => {
    // §6: the fade is the only part of auto-hide expressed in CSS — the delay
    // is JS-driven, which is why `CONTROLS_AUTOHIDE_MS` is flagged as assumed.
    renderPlayer();
    const chrome = document.querySelector("[data-player-chrome]") as HTMLElement;
    expect(chrome.style.transition).toContain("var(--yt-duration-autohide)");
    expect(chrome.style.transition).toContain("var(--yt-ease-fade)");
  });

  it("takes hidden controls out of the tab order, not just off screen", () => {
    // WCAG 2.4.11 via research/07 §8.2: a `Tab` that lands on an invisible
    // button is the most literal form of "focus obscured".
    renderPlayer();
    const chrome = document.querySelector("[data-player-chrome]") as HTMLElement;
    expect(chrome.style.visibility).toBeDefined();
    expect(chrome.style.transition).toContain("visibility");
  });
});

describe("Player — the two pipelines", () => {
  it("offers Auto on the laddered path", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    expect(screen.getByRole("menuitemradio", { name: "Auto" })).toBeInTheDocument();
  });

  it("shows the live `Auto (720p)` readout from the rendered rung", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("menuitem", { name: /Quality/ })).toHaveTextContent(
      "Auto (720p)",
    );
  });

  it("offers no quality switching at all on a single-rendition progressive video", async () => {
    const user = userEvent.setup();
    const single: readonly QualityOption[] = [
      { id: "orig", name: "Original", width: 1280, height: 720, bitrate: 0, codecs: [] },
    ];
    const fake = fakeEngine(
      engineState({
        mode: "progressive",
        qualities: single,
        activeQualityId: "orig",
        fetchingQualityId: "orig",
        pinnedQualityId: null,
      }),
    );
    render(
      <Player
        videoId="v2"
        title="A phone upload"
        pipeline="progressive"
        durationSeconds={62}
        progressiveSources={[{ id: "orig", url: "/api/media/videos/v2/source.mp4", name: "Original" }]}
        theatre={false}
        onToggleTheatre={vi.fn()}
        createEngine={() => fake.engine}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const quality = screen.getByRole("menuitem", { name: /Quality/ });
    // Not a submenu, not an Auto: `progressive.ts` is explicit that "Auto is
    // never a meaningful option" here, and one rendition is nothing to choose
    // between. This is roughly one upload in twenty and it must not look broken.
    expect(quality).not.toHaveAttribute("aria-haspopup");
    expect(quality).toHaveTextContent("Original");
    await user.click(quality);
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("pins a rendition through the engine's own contract", async () => {
    const user = userEvent.setup();
    const { engine } = renderPlayer();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "1080p HD" }));
    expect(engine.setQuality).toHaveBeenCalledWith("1080");
  });
});

describe("Player — the pinned-and-struggling nudge", () => {
  /**
   * `setQuality`'s contract: a pin is a hard constraint, so the player
   * "rebuffers *at* the pinned quality rather than dropping the viewer to a
   * lower rung without telling them" — and in exchange "the UI can offer
   * 'struggling to play at 1080p — switch to Auto?' — a nudge, never an
   * automatic revert."
   */
  it("stays quiet while Auto is in charge, however bad the trace", () => {
    const { push } = renderPlayer();
    act(() =>
      push(
        engineState({
          pinnedQualityId: null,
          metrics: { ...EMPTY_METRICS, rebufferCount: 9 },
        }),
      ),
    );
    expect(document.querySelector("[data-player-nudge]")).toBeNull();
  });

  it("offers Auto after the pin has cost two rebuffers", () => {
    const { push } = renderPlayer();
    act(() => push(engineState({ pinnedQualityId: "1080" })));
    expect(document.querySelector("[data-player-nudge]")).toBeNull();

    act(() =>
      push(
        engineState({
          pinnedQualityId: "1080",
          metrics: { ...EMPTY_METRICS, rebufferCount: 2 },
        }),
      ),
    );
    const nudge = document.querySelector("[data-player-nudge]");
    expect(nudge).toHaveTextContent("Struggling to play at 1080p");
  });

  it("never reverts by itself — the viewer has to accept", async () => {
    const user = userEvent.setup();
    const { push, engine } = renderPlayer();
    act(() => push(engineState({ pinnedQualityId: "1080" })));
    act(() =>
      push(
        engineState({
          pinnedQualityId: "1080",
          metrics: { ...EMPTY_METRICS, rebufferCount: 3 },
        }),
      ),
    );
    expect(engine.setQuality).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Switch to Auto" }));
    expect(engine.setQuality).toHaveBeenCalledWith("auto");
  });

  it("counts rebuffers from the moment of the pin, not from the session", () => {
    // A video that stalled three times under Auto and then had a rung pinned
    // must not accuse the pin of the earlier stalls.
    const { push } = renderPlayer();
    act(() => push(engineState({ metrics: { ...EMPTY_METRICS, rebufferCount: 5 } })));
    act(() =>
      push(
        engineState({
          pinnedQualityId: "1080",
          metrics: { ...EMPTY_METRICS, rebufferCount: 5 },
        }),
      ),
    );
    expect(document.querySelector("[data-player-nudge]")).toBeNull();
  });
});

describe("Player — engine lifecycle", () => {
  it("loads on mount and destroys on unmount", () => {
    const { engine, view } = renderPlayer();
    expect(engine.load).toHaveBeenCalledOnce();
    view.unmount();
    expect(engine.destroy).toHaveBeenCalledOnce();
  });

  it("surfaces a construction failure instead of showing a black rectangle", () => {
    render(
      <Player
        videoId="v3"
        title="Broken"
        pipeline="laddered"
        durationSeconds={10}
        theatre={false}
        onToggleTheatre={vi.fn()}
        createEngine={() => {
          throw new Error("A laddered video needs a masterPlaylistUrl");
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A laddered video needs a masterPlaylistUrl",
    );
  });

  it("does not render the native control bar", () => {
    // Native controls would also re-introduce the native caption rendering
    // research/07 §2 rejects.
    const { video } = renderPlayer();
    expect(video).not.toHaveAttribute("controls");
  });
});
