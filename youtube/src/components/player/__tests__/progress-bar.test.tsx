import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProgressBar } from "../progress-bar";

/**
 * The scrubber.
 *
 * `research/08-youtube-ui-measured.md` §5.2 and §1.3 for the paint,
 * `research/07-captions-and-a11y.md` §7.2 for the slider semantics.
 *
 * jsdom has no layout, so `getBoundingClientRect` reports zeros and a click
 * would compute a fraction of a zero-width bar. The bar's box is stubbed where
 * a pointer test needs one, which is the only thing about these that a browser
 * would do differently.
 */

function renderBar(overrides: Partial<Parameters<typeof ProgressBar>[0]> = {}) {
  const onSeek = vi.fn();
  render(
    <ProgressBar
      currentTime={30}
      duration={300}
      bufferedSeconds={120}
      onSeek={onSeek}
      {...overrides}
    />,
  );
  return { onSeek, bar: screen.getByRole("slider", { name: "Seek" }) };
}

/** Give the bar a 1000px box starting at x=0. */
function stubBox(bar: HTMLElement): void {
  bar.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1000, bottom: 6, width: 1000, height: 6, x: 0, y: 0 }) as DOMRect;
}

describe("ProgressBar — the slider contract (§7.2)", () => {
  it("sets valuemin, valuemax and valuenow in seconds", () => {
    // §7.2: "if omitted they default to the same 0/100 fallback as
    // `<input type=range>`, which is wrong for a media scrubber, so **always
    // set them explicitly**."
    const { bar } = renderBar();
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "300");
    expect(bar).toHaveAttribute("aria-valuenow", "30");
  });

  it("carries a spoken aria-valuetext, not a bare number", () => {
    // §7.2: `aria-valuenow="128"` reads as "one hundred and twenty-eight".
    const { bar } = renderBar({ currentTime: 128, duration: 596 });
    expect(bar).toHaveAttribute(
      "aria-valuetext",
      "2 minutes, 8 seconds of 9 minutes, 56 seconds",
    );
  });

  it("is a single tab stop with an accessible name", () => {
    const { bar } = renderBar();
    expect(bar).toHaveAttribute("tabindex", "0");
    expect(bar).toHaveAccessibleName("Seek");
  });

  it("seeks by 5s on the horizontal arrows and jumps on Page Up/Down", async () => {
    const user = userEvent.setup();
    const { bar, onSeek } = renderBar();
    bar.focus();

    await user.keyboard("{ArrowRight}");
    expect(onSeek).toHaveBeenLastCalledWith(35);
    await user.keyboard("{ArrowLeft}");
    expect(onSeek).toHaveBeenLastCalledWith(25);
    // §7.2's optional larger increment, bound to §6's own ±10s rather than a
    // third number nobody measured.
    await user.keyboard("{PageUp}");
    expect(onSeek).toHaveBeenLastCalledWith(40);
  });

  it("leaves the vertical arrows alone so they reach the volume", async () => {
    // A deliberate deviation from the APG slider pattern, documented in the
    // component: research/07 §6 gives `↑`/`↓` to volume, and a slider that
    // swallowed them would break the shortcut for anyone who had tabbed to the
    // bar.
    const user = userEvent.setup();
    const { bar, onSeek } = renderBar();
    bar.focus();
    await user.keyboard("{ArrowUp}{ArrowDown}");
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("marks the arrow keys handled so the document layer does not seek twice", () => {
    const { bar } = renderBar();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    bar.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("goes to the ends on Home and End", async () => {
    const user = userEvent.setup();
    const { bar, onSeek } = renderBar();
    bar.focus();
    await user.keyboard("{Home}");
    expect(onSeek).toHaveBeenLastCalledWith(0);
    await user.keyboard("{End}");
    expect(onSeek).toHaveBeenLastCalledWith(300);
  });
});

describe("ProgressBar — the three scaled segments (§5.2)", () => {
  it("scales rather than sizing, so the bar never reflows", () => {
    // §5.2: "All three segments are full-width elements scaled with
    // `transform: scaleX()`, not width animations — worth copying, it is why
    // the bar never reflows."
    renderBar();
    for (const name of ["played", "buffered", "hover-ahead"]) {
      const segment = document.querySelector(
        `[data-progress-segment="${name}"]`,
      ) as HTMLElement;
      // Full width in the layout, scaled in the paint. The class is the width
      // and the inline style is the scale — neither is a `width: 43%`.
      expect(segment.className).toContain("w-full");
      expect(segment.style.width).toBe("");
      expect(segment.style.transform).toMatch(/^scaleX\(/);
      // Measured `transformOrigin: 0px 0px` — without it `scaleX` grows
      // outwards from the middle of the bar.
      expect(segment.style.transformOrigin).toBe("0 0");
    }
  });

  it("scales played and buffered to their own fractions", () => {
    renderBar({ currentTime: 30, duration: 300, bufferedSeconds: 120 });
    expect(
      (document.querySelector('[data-progress-segment="played"]') as HTMLElement).style
        .transform,
    ).toBe("scaleX(0.1)");
    expect(
      (document.querySelector('[data-progress-segment="buffered"]') as HTMLElement).style
        .transform,
    ).toBe("scaleX(0.4)");
  });

  it("paints the played range with the measured gradient, never a flat red", () => {
    // §1.3 and the brand rule in `globals.css`: the played range is
    // `linear-gradient(90deg, rgb(255,0,51) 80%, rgb(255,39,145))`, and the
    // brand red is `#f03` — never `#ff0000`.
    renderBar();
    const played = document.querySelector(
      '[data-progress-segment="played"]',
    ) as HTMLElement;
    expect(played.style.backgroundImage).toBe("var(--yt-player-played)");
    expect(played.style.backgroundColor).toBe("");
  });

  it.each([
    [30, "1000% 100%"],
    [150, "200% 100%"],
    [300, "100% 100%"],
  ])(
    "counter-scales the gradient at %is so it maps to the whole bar",
    (currentTime, expected) => {
      // §1.3: "at 10% progress you see only the `#ff0033` end; the pink only
      // appears as playback approaches the right edge." With the element scaled
      // to the played fraction, the background has to be sized `100/fraction`%
      // for the ramp's 80% stop to land at 80% *of the bar* rather than at 80%
      // of the played part — which is what the measured `background-size:
      // <bar width>px` would give on a scaled element, and would put pink at
      // the playhead from the first second.
      renderBar({ currentTime, duration: 300 });
      const played = document.querySelector(
        '[data-progress-segment="played"]',
      ) as HTMLElement;
      expect(played.style.backgroundSize).toBe(expected);
    },
  );

  it("grows the track from 4px to 6px on hover, over the measured easing", () => {
    // §5.2: `scaleY(0.667)` at rest → 4px of a 6px box; `none` on hover.
    const { bar } = renderBar();
    stubBox(bar);
    const track = document.querySelector("[data-progress-track]") as HTMLElement;
    expect(track.style.transform).toBe("scaleY(0.667)");
    expect(track.style.transition).toContain("var(--yt-duration-progress-grow)");
    expect(track.style.transition).toContain("var(--yt-ease-move)");

    fireEvent.pointerMove(bar, { clientX: 500 });
    expect(track.style.transform).toBe("none");
  });

  it("grows the scrubber 1.67× on hover", () => {
    // §5.2: 12×12 at rest, `transform: scale(1.67)` → 20.04px effective.
    const { bar } = renderBar();
    stubBox(bar);
    const scrubber = document.querySelector("[data-progress-scrubber]") as HTMLElement;
    expect(scrubber.style.transform).toContain("scale(1)");

    fireEvent.pointerMove(bar, { clientX: 500 });
    expect(scrubber.style.transform).toContain("scale(1.67)");
  });
});

describe("ProgressBar — hover and scrub", () => {
  it("draws the hover-ahead segment from the playhead to the pointer", () => {
    // §1.3: `rgba(255,255,255,0.5)`, and it starts at the played edge rather
    // than at zero — a fourth colour on the buffered bar would not do this.
    const { bar } = renderBar({ currentTime: 30, duration: 300 });
    stubBox(bar);
    fireEvent.pointerMove(bar, { clientX: 500 });

    const ahead = document.querySelector(
      '[data-progress-segment="hover-ahead"]',
    ) as HTMLElement;
    expect(ahead.style.left).toBe("10%");
    expect(ahead.style.transform).toBe("scaleX(0.4)");
  });

  it("shows the tooltip with the hovered timestamp and the measured hint", () => {
    // §5.3 / §8.3: the hint line is `Pull up for precise seeking`, verbatim.
    const { bar } = renderBar({ duration: 300 });
    stubBox(bar);
    fireEvent.pointerMove(bar, { clientX: 500 });

    const tooltip = document.querySelector("[data-scrub-tooltip]") as HTMLElement;
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.querySelector("[data-scrub-hint]")).toHaveTextContent(
      "Pull up for precise seeking",
    );
    expect(tooltip.querySelector("[data-scrub-time]")).toHaveTextContent("2:30");
  });

  it("hides the tooltip when the pointer leaves", () => {
    const { bar } = renderBar();
    stubBox(bar);
    fireEvent.pointerMove(bar, { clientX: 500 });
    expect(document.querySelector("[data-scrub-tooltip]")).toBeInTheDocument();
    fireEvent.pointerLeave(bar);
    expect(document.querySelector("[data-scrub-tooltip]")).toBeNull();
  });

  it("seeks to the pointer's fraction of the duration", () => {
    const { bar, onSeek } = renderBar({ duration: 300 });
    stubBox(bar);
    fireEvent.pointerDown(bar, { clientX: 250, button: 0 });
    expect(onSeek).toHaveBeenCalledWith(75);
  });

  it("ignores a right-click, which opens the context menu instead", () => {
    const { bar, onSeek } = renderBar();
    stubBox(bar);
    fireEvent.pointerDown(bar, { clientX: 250, button: 2 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("routes a drag through onScrub and commits with onSeek", () => {
    const onScrub = vi.fn();
    const { bar, onSeek } = renderBar({ duration: 300, onScrub });
    stubBox(bar);

    fireEvent.pointerDown(bar, { clientX: 100, button: 0 });
    fireEvent.pointerMove(bar, { clientX: 400 });
    expect(onScrub).toHaveBeenLastCalledWith(120);
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.pointerUp(bar, { clientX: 400 });
    expect(onSeek).toHaveBeenCalledWith(120);
  });
});

describe("ProgressBar — a duration that is not there yet", () => {
  it("does not produce NaN before metadata arrives", () => {
    // `video.duration` is `NaN` until `loadedmetadata`, and a scrubber
    // reporting `aria-valuemax="NaN"` announces nothing at all.
    const { bar } = renderBar({ duration: Number.NaN, currentTime: 0 });
    expect(bar).toHaveAttribute("aria-valuemax", "0");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(
      (document.querySelector('[data-progress-segment="played"]') as HTMLElement).style
        .transform,
    ).toBe("scaleX(0)");
  });
});
