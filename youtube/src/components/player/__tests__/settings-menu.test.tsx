import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { QualityOption } from "@/media/player";

import { DEFAULT_CAPTION_SETTINGS } from "../captions";
import {
  SettingsMenu,
  qualityLabel,
  qualityReadout,
  type SettingsMenuProps,
} from "../settings-menu";

/**
 * The settings menu.
 *
 * Two research sections meet here. `research/07-captions-and-a11y.md` §7.4 is
 * the ARIA — `role="menu"`, `menuitemradio` for mutually-exclusive choices, and
 * the roving `tabindex` it names as the most commonly broken rule. `research/08`
 * §5.6 and `player-1920.json` `quality.rows` are the content, including the
 * order of the quality list and the `Auto (720p)` readout.
 */

const LADDER: readonly QualityOption[] = [
  { id: "1080", name: "1080p", width: 1920, height: 1080, bitrate: 5_000_000, codecs: ["avc1.640028"] },
  { id: "720", name: "720p", width: 1280, height: 720, bitrate: 2_500_000, codecs: ["avc1.4d401f"] },
  { id: "480", name: "480p", width: 854, height: 480, bitrate: 1_200_000, codecs: ["avc1.4d401e"] },
];

function setup(overrides: Partial<SettingsMenuProps> = {}) {
  const props: SettingsMenuProps = {
    qualities: LADDER,
    activeQualityId: "720",
    pinnedQualityId: null,
    autoAvailable: true,
    onSelectQuality: vi.fn(),
    playbackRate: 1,
    onSelectPlaybackRate: vi.fn(),
    captionsAvailable: true,
    captionsOn: false,
    captionsLabel: "English",
    onToggleCaptions: vi.fn(),
    captionSettings: DEFAULT_CAPTION_SETTINGS,
    onCaptionSettingsChange: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SettingsMenu {...props} />);
  return props;
}

describe("SettingsMenu — ARIA (§7.4)", () => {
  it("is a menu whose rows are menu items", () => {
    setup();
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThan(0);
  });

  it("keeps exactly one item at tabindex 0", async () => {
    // §7.4 names this as "the single most common real-world bug here — it
    // floods the page's Tab sequence and breaks the 'the whole menu is one tab
    // stop' contract users expect".
    setup();
    const items = screen.getAllByRole("menuitem");
    const focusable = items.filter((item) => item.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
    expect(items.filter((item) => item.getAttribute("tabindex") === "-1")).toHaveLength(
      items.length - 1,
    );
  });

  it("moves the roving position with the arrow keys, and wraps", async () => {
    const user = userEvent.setup();
    setup();
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    expect(items[1]).toHaveAttribute("tabindex", "0");
    expect(items[0]).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();

    // Wrapping is what makes a short menu navigable without counting rows.
    await user.keyboard("{ArrowUp}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("marks a submenu row with aria-haspopup", () => {
    setup();
    const quality = screen.getByRole("menuitem", { name: /Quality/ });
    expect(quality).toHaveAttribute("aria-haspopup", "menu");
  });

  it("closes on Escape at the top level and returns a level from a submenu", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    expect(screen.getByRole("menu")).toHaveAttribute("data-panel", "quality");

    await user.keyboard("{Escape}");
    expect(screen.getByRole("menu")).toHaveAttribute("data-panel", "main");
    // Only the top level closes the whole menu; a submenu's Escape is a step
    // back, not an exit.
    expect(props.onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

describe("SettingsMenu — the quality submenu (§5.6)", () => {
  it("lists the rungs highest first with Auto last, as measured", async () => {
    // `player-1920.json` `quality.rows` is, in order: `1080p HD`, `720p`,
    // `480p`, `360p`, `240p`, `144p`, `Auto`. Everyone's memory puts Auto at
    // the top of that list; the capture puts it at the bottom. The `HD` suffix
    // lands at 1080 and not at 720, which memory also gets wrong.
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));

    expect(screen.getAllByRole("menuitemradio").map((row) => row.textContent)).toEqual([
      "1080p HD",
      "720p",
      "480p",
      "Auto",
    ]);
  });

  it("checks Auto when nothing is pinned and the rung when one is", async () => {
    const user = userEvent.setup();
    setup({ pinnedQualityId: null });
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    expect(screen.getByRole("menuitemradio", { name: "Auto" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "1080p HD" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("checks the pinned rung, not the rendering one", async () => {
    const user = userEvent.setup();
    // The engine is *rendering* 720p while the viewer has pinned 1080p — which
    // is exactly what happens for a segment or two after a manual pick.
    setup({ pinnedQualityId: "1080", activeQualityId: "720" });
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    expect(screen.getByRole("menuitemradio", { name: "1080p HD" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Auto" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("pins a rung and returns to the main panel", async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "1080p HD" }));
    expect(props.onSelectQuality).toHaveBeenCalledWith("1080");
    expect(screen.getByRole("menu")).toHaveAttribute("data-panel", "main");
  });

  it("hands control back with the literal string the engine expects", async () => {
    const user = userEvent.setup();
    const props = setup({ pinnedQualityId: "1080" });
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Auto" }));
    // `setQuality(id | "auto")` — the sentinel is part of the engine's
    // contract, not a UI-side convention.
    expect(props.onSelectQuality).toHaveBeenCalledWith("auto");
  });
});

describe("SettingsMenu — the progressive pipeline", () => {
  /**
   * `src/media/player/progressive.ts` is explicit that "Auto is never a
   * meaningful option" on this path: there is no ABR selector to hand control
   * back to. With one rendition there is nothing to choose between either, and
   * the menu must not offer a ladder that does not exist.
   */
  const single: readonly QualityOption[] = [
    { id: "orig", name: "Original", width: 1280, height: 720, bitrate: 0, codecs: [] },
  ];

  it("does not open a quality submenu for a single-rendition upload", async () => {
    const user = userEvent.setup();
    setup({ qualities: single, autoAvailable: false, pinnedQualityId: "orig", activeQualityId: "orig" });

    const quality = screen.getByRole("menuitem", { name: /Quality/ });
    expect(quality).not.toHaveAttribute("aria-haspopup");
    expect(quality).toHaveAttribute("aria-disabled", "true");

    await user.click(quality);
    expect(screen.getByRole("menu")).toHaveAttribute("data-panel", "main");
  });

  it("still names the rendition on the row", () => {
    setup({ qualities: single, autoAvailable: false, pinnedQualityId: "orig", activeQualityId: "orig" });
    expect(screen.getByRole("menuitem", { name: /Quality/ })).toHaveTextContent("Original");
  });

  it("never offers Auto when the path has no selector", async () => {
    const user = userEvent.setup();
    // Two progressive sources: switchable by `src` swap, but still no Auto.
    setup({
      qualities: [
        { id: "hi", name: "720p", width: 1280, height: 720, bitrate: 0, codecs: [] },
        { id: "lo", name: "360p", width: 640, height: 360, bitrate: 0, codecs: [] },
      ],
      autoAvailable: false,
      pinnedQualityId: "hi",
      activeQualityId: "hi",
    });
    await user.click(screen.getByRole("menuitem", { name: /Quality/ }));
    expect(screen.queryByRole("menuitemradio", { name: "Auto" })).toBeNull();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
  });
});

describe("SettingsMenu — speed and captions", () => {
  it("writes 1× as the word `Normal`, as measured", async () => {
    const user = userEvent.setup();
    setup({ playbackRate: 1 });
    // §5.6's measured row: `Playback speed  Normal`.
    expect(screen.getByRole("menuitem", { name: /Playback speed/ })).toHaveTextContent(
      "Normal",
    );
    await user.click(screen.getByRole("menuitem", { name: /Playback speed/ }));
    expect(screen.getByRole("menuitemradio", { name: "Normal" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("hides the Subtitles row entirely when there is no track", () => {
    setup({ captionsAvailable: false });
    expect(screen.queryByRole("menuitem", { name: /Subtitles/ })).toBeNull();
  });

  it("reads Off then the track's label", async () => {
    const user = userEvent.setup();
    const props = setup({ captionsOn: false, captionsLabel: "English (auto-generated)" });
    expect(screen.getByRole("menuitem", { name: /Subtitles/ })).toHaveTextContent("Off");

    await user.click(screen.getByRole("menuitem", { name: /Subtitles/ }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "English (auto-generated)" }),
    );
    expect(props.onToggleCaptions).toHaveBeenCalledWith(true);
  });

  it("cycles a caption setting forward and reports the whole settings object", async () => {
    const user = userEvent.setup();
    const props = setup({ captionsOn: true });
    await user.click(screen.getByRole("menuitem", { name: /Subtitles/ }));
    await user.click(screen.getByRole("menuitem", { name: /Options/ }));

    const fontSize = screen.getByRole("menuitem", { name: /Font size/ });
    expect(fontSize).toHaveTextContent("100%");
    await user.click(fontSize);

    expect(props.onCaptionSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ fontScale: 1.5, textColour: "#ffffff" }),
    );
  });

  it("offers every control research/07 §2 names", async () => {
    const user = userEvent.setup();
    setup({ captionsOn: true });
    await user.click(screen.getByRole("menuitem", { name: /Subtitles/ }));
    await user.click(screen.getByRole("menuitem", { name: /Options/ }));

    for (const label of [
      /Font size/,
      /Font colour/,
      /Font opacity/,
      /Background colour/,
      /Background opacity/,
      /Window opacity/,
      /Character edge style/,
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });
});

describe("qualityReadout — the live `Auto (720p)` value (§7)", () => {
  it("names the rendition being rendered, not the one being fetched", () => {
    // `EngineState.activeQualityId` is documented as the rendition being
    // *rendered*; `fetchingQualityId` leads it by up to the whole forward
    // buffer. Reading the wrong one names a quality the viewer will not see for
    // another twelve segments.
    expect(qualityReadout(LADDER, "720", null, true)).toBe("Auto (720p)");
    expect(qualityReadout(LADDER, "1080", null, true)).toBe("Auto (1080p HD)");
  });

  it("names the pin instead once one is set", () => {
    expect(qualityReadout(LADDER, "720", "1080", true)).toBe("1080p HD");
  });

  it("says plain Auto before anything is rendering", () => {
    // Before the first segment is appended there is no rung to name, and
    // `Auto (—)` would be noise.
    expect(qualityReadout(LADDER, null, null, true)).toBe("Auto");
  });

  it("never says Auto on the progressive path", () => {
    expect(qualityReadout(LADDER, "720", null, false)).toBe("720p");
  });
});

describe("qualityLabel", () => {
  it("suffixes HD at 1080 and not at 720", () => {
    expect(qualityLabel(LADDER[0] as QualityOption)).toBe("1080p HD");
    expect(qualityLabel(LADDER[1] as QualityOption)).toBe("720p");
  });
});
