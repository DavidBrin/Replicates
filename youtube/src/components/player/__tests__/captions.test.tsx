import { describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";

import {
  CAPTION_OPACITIES,
  CaptionLayer,
  DEFAULT_CAPTION_SETTINGS,
  cycledOpacity,
  edgeTextShadow,
  renderCueText,
  steppedScale,
  useActiveCues,
  withAlpha,
  type CaptionSettings,
  type TextTrackCueLike,
  type TextTrackLike,
} from "../captions";

/**
 * Caption rendering and its settings.
 *
 * `research/07-captions-and-a11y.md` §2 settles the approach — Route B, a
 * `TextTrack` at `mode = 'hidden'` with our own DOM — and names the two things
 * that make it necessary: a settings panel that visibly applies, and cue
 * placement that avoids the control bar. Both are asserted here.
 *
 * The track is a fake rather than a real `TextTrack` for the reason
 * `captions.tsx` states: jsdom implements neither `TextTrack` nor `VTTCue`, so
 * code typed against the DOM classes could only ever be tested in a browser.
 */

class FakeTrack implements TextTrackLike {
  mode: "disabled" | "hidden" | "showing" = "disabled";
  activeCues: { length: number; [index: number]: TextTrackCueLike | undefined } | null = {
    length: 0,
  };
  cues = null;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "cuechange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "cuechange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  /** What the browser does when the playhead crosses a cue boundary. */
  setActive(cues: readonly TextTrackCueLike[]): void {
    const list: { length: number; [index: number]: TextTrackCueLike | undefined } = {
      length: cues.length,
    };
    cues.forEach((cue, index) => {
      list[index] = cue;
    });
    this.activeCues = list;
    for (const listener of this.listeners) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

function cue(text: string, extra: Partial<TextTrackCueLike> = {}): TextTrackCueLike {
  return { text, startTime: 0, endTime: 1, ...extra };
}

function Harness({
  track,
  enabled,
  settings = DEFAULT_CAPTION_SETTINGS,
  controlsVisible = false,
}: {
  track: TextTrackLike | null;
  enabled: boolean;
  settings?: CaptionSettings;
  controlsVisible?: boolean;
}) {
  const cues = useActiveCues(track, enabled);
  return (
    <CaptionLayer
      cues={cues}
      settings={settings}
      bottomInset={controlsVisible ? 72 : 16}
      playerHeight={756}
    />
  );
}

describe("useActiveCues — the mode is the whole mechanism (§2)", () => {
  it("puts the track in `hidden`, never `showing`", () => {
    // §2: `hidden` processes cues and fires `cuechange` **without painting**.
    // `showing` is the native rendering this player exists to replace, and
    // would draw a second copy of every caption underneath ours.
    const track = new FakeTrack();
    render(<Harness track={track} enabled />);
    expect(track.mode).toBe("hidden");
  });

  it("goes to `disabled` when captions are off, not merely unrendered", () => {
    // §2: `disabled` means cues are not even processed. Leaving a track at
    // `hidden` keeps the browser doing cue bookkeeping for a layer nobody is
    // looking at.
    const track = new FakeTrack();
    const { rerender } = render(<Harness track={track} enabled />);
    expect(track.mode).toBe("hidden");
    rerender(<Harness track={track} enabled={false} />);
    expect(track.mode).toBe("disabled");
  });

  it("renders the cues that become active", () => {
    const track = new FakeTrack();
    render(<Harness track={track} enabled />);
    expect(screen.queryByText("A line of dialogue")).toBeNull();

    act(() => track.setActive([cue("A line of dialogue")]));
    expect(screen.getByText("A line of dialogue")).toBeInTheDocument();

    act(() => track.setActive([]));
    expect(screen.queryByText("A line of dialogue")).toBeNull();
  });

  it("detaches its listener when captions are turned off", () => {
    const track = new FakeTrack();
    const { rerender } = render(<Harness track={track} enabled />);
    expect(track.listenerCount).toBe(1);
    rerender(<Harness track={track} enabled={false} />);
    expect(track.listenerCount).toBe(0);
  });
});

describe("CaptionLayer — placement", () => {
  it("lifts the stack clear of the control bar when it is up", () => {
    // §2's second reason for Route B: "precise positioning that can avoid the
    // control bar … something no native implementation exposes a hook for".
    const track = new FakeTrack();
    const { rerender } = render(<Harness track={track} enabled />);
    act(() => track.setActive([cue("Hello")]));

    const layer = () => document.querySelector("[data-caption-layer]") as HTMLElement;
    expect(layer().style.bottom).toBe("16px");

    rerender(<Harness track={track} enabled controlsVisible />);
    expect(layer().style.bottom).toBe("72px");
  });

  it("renders one box per line, not one behind the block", () => {
    // `screenshots/13-player-settings-menu-1920.png` shows a two-line cue as
    // two separately-boxed lines with a gap between them.
    const track = new FakeTrack();
    render(<Harness track={track} enabled />);
    act(() => track.setActive([cue("first line\nsecond line")]));

    const lines = document.querySelectorAll("[data-caption-line]");
    expect(lines).toHaveLength(2);
  });

  it("is hidden from assistive technology", () => {
    // §7.5 reserves the live region for state changes. Captions are a
    // transcript of audio, and announcing every cue would talk over a screen
    // reader continuously.
    const track = new FakeTrack();
    render(<Harness track={track} enabled />);
    act(() => track.setActive([cue("Hello")]));
    expect(document.querySelector("[data-caption-layer]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("renders nothing at all when no cue is active", () => {
    const track = new FakeTrack();
    render(<Harness track={track} enabled />);
    expect(document.querySelector("[data-caption-layer]")).toBeNull();
  });
});

describe("CaptionLayer — the settings actually reach the DOM", () => {
  /**
   * `research/07` §9.1 warns about exactly this: "the settings menu can visibly
   * 'look' applied while failing to actually restyle the caption layer if the
   * wiring is broken". So these assert the computed style of the line, not that
   * a control changed.
   */
  it("applies font scale, colours and their separate opacities", () => {
    const track = new FakeTrack();
    render(
      <Harness
        track={track}
        enabled
        settings={{
          ...DEFAULT_CAPTION_SETTINGS,
          fontScale: 2,
          textColour: "#ffff00",
          textOpacity: 0.5,
          backgroundColour: "#000000",
          backgroundOpacity: 0.25,
        }}
      />,
    );
    act(() => track.setActive([cue("Styled")]));

    const line = document.querySelector("[data-caption-line]") as HTMLElement;
    // 756px player × 4.5% × 2 = 68px.
    expect(line.style.fontSize).toBe("68px");
    expect(line.style.color).toBe("rgba(255, 255, 0, 0.5)");
    expect(line.style.background).toBe("rgba(0, 0, 0, 0.25)");
  });

  it("applies the edge style as a text shadow", () => {
    const track = new FakeTrack();
    render(
      <Harness
        track={track}
        enabled
        settings={{ ...DEFAULT_CAPTION_SETTINGS, edge: "outline" }}
      />,
    );
    act(() => track.setActive([cue("Edged")]));
    const line = document.querySelector("[data-caption-line]") as HTMLElement;
    expect(line.style.textShadow).not.toBe("");
  });

  it("keeps the window box independent of the line boxes", () => {
    // Two separate controls in §2's list — "background color/opacity" and
    // "window color/opacity" — and they paint different boxes.
    const track = new FakeTrack();
    render(
      <Harness
        track={track}
        enabled
        settings={{
          ...DEFAULT_CAPTION_SETTINGS,
          windowColour: "#0000ff",
          windowOpacity: 1,
          backgroundOpacity: 0,
        }}
      />,
    );
    act(() => track.setActive([cue("Windowed")]));

    const line = document.querySelector("[data-caption-line]") as HTMLElement;
    expect(line.style.background).toBe("rgba(0, 0, 0, 0)");
    expect((line.parentElement as HTMLElement).style.background).toBe("rgb(0, 0, 255)");
  });

  it("honours a cue's own alignment", () => {
    const track = new FakeTrack();
    render(<Harness track={track} enabled />);
    act(() =>
      track.setActive([
        cue("left", { align: "left" }),
        cue("right", { align: "end" }),
        cue("centred"),
      ]),
    );
    const lines = [...document.querySelectorAll("[data-caption-line]")] as HTMLElement[];
    expect(lines[0]?.style.alignSelf).toBe("flex-start");
    expect(lines[1]?.style.alignSelf).toBe("flex-end");
    expect(lines[2]?.style.alignSelf).toBe("center");
  });
});

describe("renderCueText — §1.8's inline markup", () => {
  it("turns b, i and u into real elements", () => {
    render(<p data-testid="cue">{renderCueText("plain <b>bold</b> <i>it</i> <u>und</u>")}</p>);
    const cueEl = screen.getByTestId("cue");
    expect(cueEl.querySelector("b")?.textContent).toBe("bold");
    expect(cueEl.querySelector("i")?.textContent).toBe("it");
    expect(cueEl.querySelector("u")?.textContent).toBe("und");
  });

  it("keeps the speaker on a voice span rather than colouring it", () => {
    // §1.8: the voice annotation is "exposed … to accessibility tooling as who
    // is speaking". Inventing a colour for it would fight the settings panel.
    render(<p data-testid="cue">{renderCueText("<v Narrator>Once upon a time</v>")}</p>);
    const span = screen.getByTestId("cue").querySelector("[data-voice]");
    expect(span).toHaveAttribute("data-voice", "Narrator");
    expect(span?.textContent).toBe("Once upon a time");
  });

  it("drops timestamp tags but keeps the words around them", () => {
    // §1.8's karaoke form. Nothing in this application emits them and
    // highlighting would need a per-frame `currentTime`, so the text survives
    // and the split points do not.
    render(
      <p data-testid="cue">
        {renderCueText("<00:00:01.000>Never <00:00:01.500>gonna give you up")}
      </p>,
    );
    expect(screen.getByTestId("cue")).toHaveTextContent("Never gonna give you up");
  });

  it("decodes the character references §1.8 calls out", () => {
    render(<p data-testid="cue">{renderCueText("Tom &amp; Jerry &lt;3")}</p>);
    expect(screen.getByTestId("cue")).toHaveTextContent("Tom & Jerry <3");
  });
});

describe("the ladders", () => {
  it("clamps the font-size ladder and cycles the opacity one", () => {
    // §6 describes `+`/`-` as increase/decrease and `o`/`w` as *cycle*. The two
    // verbs are different behaviours and are two helpers for that reason.
    const ladder = [1, 2, 3];
    expect(steppedScale(ladder, 3, 1)).toBe(3);
    expect(steppedScale(ladder, 1, -1)).toBe(1);

    const last = CAPTION_OPACITIES[CAPTION_OPACITIES.length - 1] ?? 1;
    expect(cycledOpacity(last)).toBe(CAPTION_OPACITIES[0]);
  });
});

describe("withAlpha and edgeTextShadow", () => {
  it("recombines a hex and an opacity", () => {
    expect(withAlpha("#ff2791", 0.5)).toBe("rgba(255, 39, 145, 0.5)");
  });

  it("returns a non-hex colour unchanged rather than emitting something invalid", () => {
    // Losing the opacity is visible; emitting `rgba(NaN, …)` drops the caption.
    expect(withAlpha("currentColor", 0.5)).toBe("currentColor");
  });

  it("has no shadow for `none` and one for every other edge", () => {
    expect(edgeTextShadow("none")).toBeUndefined();
    for (const edge of ["drop-shadow", "raised", "depressed", "outline"] as const) {
      expect(edgeTextShadow(edge)).toBeTruthy();
    }
  });
});
