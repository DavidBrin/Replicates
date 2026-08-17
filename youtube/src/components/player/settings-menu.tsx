"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { CheckIcon, ChevronIcon } from "@/components/icons";
import type { QualityOption } from "@/media/player";

import {
  CAPTION_FONT_SCALES,
  cycledOpacity,
  steppedScale,
  type CaptionEdgeStyle,
  type CaptionSettings,
} from "./captions";
import { PLAYBACK_RATES } from "./keyboard";

/**
 * The settings panel and its submenus.
 *
 * Geometry, type and copy: `research/08-youtube-ui-measured.md` §5.6 and §2.2,
 * against `research/extracted/player-1920.json` (`settings.rows`,
 * `quality.rows`). ARIA: `research/07-captions-and-a11y.md` §7.4.
 *
 * ## The two rules §7.4 says are the ones people break
 *
 * **Roving `tabindex`.** Exactly one item is `tabindex="0"` at a time and every
 * other is `-1`; `↑`/`↓` move the roving position *and* focus. §7.4 names
 * "giving every item `tabindex=0`" as the single most common real-world bug —
 * it floods the page's `Tab` sequence and breaks the contract that the whole
 * menu is one tab stop.
 *
 * **The trigger owns the return.** Opening moves focus to the first (or
 * selected) item; `Escape` closes and hands focus back to the button. The
 * restore is the caller's, because the caller owns the button — this component
 * calls `onClose` and the control bar re-focuses.
 *
 * ## Which rows exist
 *
 * §5.6 measured eight rows: `Stable Volume`, `Voice boost`, `Annotations`,
 * `Audio track`, `Subtitles/CC`, `Sleep timer`, `Playback speed`, `Quality`.
 * Three are rendered — the three whose feature exists in this application.
 * Rendering the other five as inert switches would be a menu that lies about
 * what the player can do, which is a worse fidelity failure than a shorter
 * menu.
 */

/** §5.6: the main panel measured 385px wide, the quality submenu 251px. */
const MAIN_PANEL_WIDTH = 385;
const SUBMENU_PANEL_WIDTH = 251;

/**
 * §5.6, verbatim: "Row height **48.13px** (arbitrary; recorded as measured)".
 * The quality submenu's rows measured a round 48. Both are kept rather than
 * averaged, because a panel that is 8×48.13 is 385 tall and one that is 8×48 is
 * not, and §5.6's measured panel height is 401 (= 8 rows + 8px×2 of padding
 * plus rounding).
 */
const MAIN_ROW_HEIGHT = "48.13px";
const SUBMENU_ROW_HEIGHT = "48px";

export type SettingsPanelId = "main" | "quality" | "speed" | "subtitles" | "captions";

export interface SettingsMenuProps {
  readonly qualities: readonly QualityOption[];
  /** `EngineState.activeQualityId` — the rendition being *rendered*. */
  readonly activeQualityId: string | null;
  /** `EngineState.pinnedQualityId` — `null` means Auto. */
  readonly pinnedQualityId: string | null;
  /**
   * Whether Auto is a mode this player can be in.
   *
   * `false` on the progressive pipeline, where `src/media/player/progressive.ts`
   * is explicit that "Auto is never a meaningful option" — there is no ABR
   * selector to hand control back to.
   */
  readonly autoAvailable: boolean;
  readonly onSelectQuality: (id: string | "auto") => void;

  readonly playbackRate: number;
  readonly onSelectPlaybackRate: (rate: number) => void;

  readonly captionsAvailable: boolean;
  readonly captionsOn: boolean;
  /** The caption track's label, e.g. `English`. Shown as the row's value. */
  readonly captionsLabel: string;
  readonly onToggleCaptions: (on: boolean) => void;
  readonly captionSettings: CaptionSettings;
  readonly onCaptionSettingsChange: (next: CaptionSettings) => void;

  readonly onClose: () => void;
  readonly id?: string;
}

interface PanelItem {
  readonly key: string;
  readonly label: string;
  /** The right-aligned current value — §5.6's "label left, current value right". */
  readonly value?: string;
  readonly role: "menuitem" | "menuitemradio";
  readonly checked?: boolean;
  readonly submenu?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export function SettingsMenu({
  qualities,
  activeQualityId,
  pinnedQualityId,
  autoAvailable,
  onSelectQuality,
  playbackRate,
  onSelectPlaybackRate,
  captionsAvailable,
  captionsOn,
  captionsLabel,
  onToggleCaptions,
  captionSettings,
  onCaptionSettingsChange,
  onClose,
  id,
}: SettingsMenuProps) {
  const [panel, setPanel] = useState<SettingsPanelId>("main");
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const open = useCallback((next: SettingsPanelId) => {
    setPanel(next);
    setActiveIndex(0);
  }, []);

  /* --------------------------------------------------------- main panel -- */

  const ladder = useMemo(() => sortedLadder(qualities), [qualities]);
  const switchable = ladder.length > 1 || autoAvailable;

  const mainItems: PanelItem[] = [];

  if (captionsAvailable) {
    mainItems.push({
      key: "subtitles",
      label: "Subtitles/CC",
      value: captionsOn ? captionsLabel : "Off",
      role: "menuitem",
      submenu: true,
      onSelect: () => open("subtitles"),
    });
  }

  mainItems.push({
    key: "speed",
    label: "Playback speed",
    // §5.6's measured value for 1× is the word `Normal`, not `1x`.
    value: describeRate(playbackRate),
    role: "menuitem",
    submenu: true,
    onSelect: () => open("speed"),
  });

  mainItems.push({
    key: "quality",
    label: "Quality",
    value: qualityReadout(ladder, activeQualityId, pinnedQualityId, autoAvailable),
    role: "menuitem",
    submenu: switchable,
    // A single-rendition progressive upload has nothing to choose between. The
    // row still shows the rendition, because "what am I watching" is a real
    // question, but it does not open a submenu offering one option.
    disabled: !switchable,
    onSelect: () => {
      if (switchable) open("quality");
    },
  });

  /* ------------------------------------------------------ quality panel -- */

  const qualityItems: PanelItem[] = ladder.map((option) => ({
    key: option.id,
    label: qualityLabel(option),
    role: "menuitemradio",
    checked: pinnedQualityId === option.id,
    onSelect: () => {
      onSelectQuality(option.id);
      open("main");
    },
  }));

  if (autoAvailable) {
    // §5.6 and `player-1920.json` `quality.rows`: the measured submenu lists
    // `1080p HD, 720p, 480p, 360p, 240p, 144p, Auto` — Auto **last**, and
    // checked when no rung is pinned. The live "Auto (720p)" readout is on the
    // main panel's Quality row, which is where it was measured.
    qualityItems.push({
      key: "auto",
      label: "Auto",
      role: "menuitemradio",
      checked: pinnedQualityId === null,
      onSelect: () => {
        onSelectQuality("auto");
        open("main");
      },
    });
  }

  /* -------------------------------------------------------- speed panel -- */

  const speedItems: PanelItem[] = PLAYBACK_RATES.map((rate) => ({
    key: String(rate),
    label: describeRate(rate),
    role: "menuitemradio",
    checked: rate === playbackRate,
    onSelect: () => {
      onSelectPlaybackRate(rate);
      open("main");
    },
  }));

  /* ---------------------------------------------------- subtitles panel -- */

  const subtitleItems: PanelItem[] = [
    {
      key: "off",
      label: "Off",
      role: "menuitemradio",
      checked: !captionsOn,
      onSelect: () => {
        onToggleCaptions(false);
        open("main");
      },
    },
    {
      key: "on",
      label: captionsLabel,
      role: "menuitemradio",
      checked: captionsOn,
      onSelect: () => {
        onToggleCaptions(true);
        open("main");
      },
    },
    {
      key: "options",
      label: "Options",
      role: "menuitem",
      submenu: true,
      onSelect: () => open("captions"),
    },
  ];

  /* ------------------------------------------------- caption options ----- */

  /**
   * The caption settings, as cycling rows.
   *
   * `research/07` §2 names the five controls a Route-B player owes its viewer —
   * font size, text colour and opacity, background colour and opacity, window
   * opacity, and edge style — and all seven are here. The **shape** is this
   * file's: YouTube nests a sub-panel per property, and no such panel was
   * captured in the R8 pass, so rather than invent seven panels each row cycles
   * its own value forward and shows the result on the right. The ARIA stays a
   * plain `menuitem` because that is what a row that performs an action is.
   */
  const captionItems: PanelItem[] = [
    {
      key: "font-size",
      label: "Font size",
      value: `${Math.round(captionSettings.fontScale * 100)}%`,
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          fontScale: nextInLadder(CAPTION_FONT_SCALES, captionSettings.fontScale),
        }),
    },
    {
      key: "text-colour",
      label: "Font colour",
      value: colourName(captionSettings.textColour),
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          textColour: nextColour(captionSettings.textColour),
        }),
    },
    {
      key: "text-opacity",
      label: "Font opacity",
      value: percent(captionSettings.textOpacity),
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          textOpacity: cycledOpacity(captionSettings.textOpacity),
        }),
    },
    {
      key: "background-colour",
      label: "Background colour",
      value: colourName(captionSettings.backgroundColour),
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          backgroundColour: nextColour(captionSettings.backgroundColour),
        }),
    },
    {
      key: "background-opacity",
      label: "Background opacity",
      value: percent(captionSettings.backgroundOpacity),
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          backgroundOpacity: cycledOpacity(captionSettings.backgroundOpacity),
        }),
    },
    {
      key: "window-opacity",
      label: "Window opacity",
      value: percent(captionSettings.windowOpacity),
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          windowOpacity: cycledOpacity(captionSettings.windowOpacity),
        }),
    },
    {
      key: "edge",
      label: "Character edge style",
      value: EDGE_LABELS[captionSettings.edge],
      role: "menuitem",
      onSelect: () =>
        onCaptionSettingsChange({
          ...captionSettings,
          edge: nextEdge(captionSettings.edge),
        }),
    },
  ];

  const panels: Readonly<
    Record<SettingsPanelId, { readonly title: string | null; readonly items: PanelItem[] }>
  > = {
    main: { title: null, items: mainItems },
    quality: { title: "Quality", items: qualityItems },
    speed: { title: "Playback speed", items: speedItems },
    subtitles: { title: "Subtitles/CC", items: subtitleItems },
    captions: { title: "Options", items: captionItems },
  };

  const current = panels[panel];
  const items = current.items;

  // Keep the roving index inside the panel it is roving. A caption row that
  // cycles does not change the row count, but leaving a submenu does.
  useEffect(() => {
    itemRefs.current.length = items.length;
  }, [items.length]);

  useEffect(() => {
    // §7.4: opening a menu moves focus to the first (or selected) item.
    const target = itemRefs.current[activeIndex];
    target?.focus();
  }, [activeIndex, panel]);

  const back = useCallback(() => {
    if (panel === "captions") {
      open("subtitles");
      return;
    }
    if (panel === "main") {
      onClose();
      return;
    }
    open("main");
  }, [onClose, open, panel]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const count = items.length;
      if (count === 0) return;
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex((index) => (index + 1) % count);
          return;
        case "ArrowUp":
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex((index) => (index - 1 + count) % count);
          return;
        case "Home":
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(0);
          return;
        case "End":
          event.preventDefault();
          event.stopPropagation();
          setActiveIndex(count - 1);
          return;
        case "ArrowRight": {
          const item = items[activeIndex];
          if (item?.submenu === true && item.disabled !== true) {
            event.preventDefault();
            event.stopPropagation();
            item.onSelect();
          }
          return;
        }
        case "ArrowLeft":
          event.preventDefault();
          event.stopPropagation();
          back();
          return;
        case "Escape":
          event.preventDefault();
          // Not stopped: `Escape` at the top level closes the menu here *and*
          // the document handler treats it as `dismiss`, which is the same
          // intent. Stopping it would make a nested panel swallow a key the
          // rest of the page also wants.
          back();
          return;
        default:
          return;
      }
    },
    [activeIndex, back, items],
  );

  const width = panel === "main" ? MAIN_PANEL_WIDTH : SUBMENU_PANEL_WIDTH;

  return (
    <div
      id={id}
      data-settings-menu=""
      data-panel={panel}
      role="menu"
      aria-label={current.title ?? "Settings"}
      className="overflow-hidden rounded-cozy"
      style={{
        width: `${width}px`,
        // §5.6 / §1.3: `rgba(0,0,0,0.6)`, radius 12, no padding on the panel —
        // the 8px lives on the inner list.
        background: "var(--yt-player-panel)",
        color: "var(--yt-player-ink)",
        // §6: the panel fades in over 0.1s on Material decelerate.
        transition: "opacity var(--yt-duration-menu-open) var(--yt-ease-fade)",
      }}
      onKeyDown={onKeyDown}
    >
      {current.title !== null ? (
        <button
          type="button"
          data-settings-back=""
          className="flex w-full items-center gap-2 px-3 text-left"
          style={{
            // §5.6: header 251×57, `padding: 8px 0`, 11.99px, with a 1px
            // `rgba(255,255,255,0.2)` rule under it.
            height: "57px",
            fontSize: "11.99px",
            borderBottom: "1px solid var(--yt-player-panel-rule)",
          }}
          onClick={back}
        >
          <ChevronIcon direction="left" size={18} />
          <span>{current.title}</span>
        </button>
      ) : null}

      <div className="flex flex-col" style={{ padding: "8px" }}>
        {items.map((item, index) => (
          <button
            key={item.key}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            type="button"
            role={item.role}
            data-settings-item={item.key}
            {...(item.role === "menuitemradio"
              ? { "aria-checked": item.checked === true }
              : {})}
            {...(item.submenu === true
              ? { "aria-haspopup": "menu" as const, "aria-expanded": false }
              : {})}
            aria-disabled={item.disabled === true ? true : undefined}
            // §7.4's roving tabindex: one 0, everything else -1.
            tabIndex={index === activeIndex ? 0 : -1}
            className={clsx(
              "flex w-full items-center justify-between gap-4 rounded-compact px-3 text-left",
              item.disabled === true
                ? "cursor-default opacity-60"
                : "hover:bg-[var(--yt-player-pill-hover)]",
            )}
            style={{
              height: panel === "main" ? MAIN_ROW_HEIGHT : SUBMENU_ROW_HEIGHT,
              // §2.2: the row runs at 11px/14.3px — "far below anything else in
              // the product" — and the label inside it at 14px (measured
              // `settings.rows[].labelFont`).
              fontSize: "11px",
              lineHeight: "14.3px",
              transition:
                "background-color var(--yt-duration-pill-hover) var(--yt-ease-move)",
            }}
            onClick={() => {
              if (item.disabled === true) return;
              setActiveIndex(index);
              item.onSelect();
            }}
            onFocus={() => setActiveIndex(index)}
          >
            <span
              className="flex items-center gap-3"
              style={{ fontSize: "14px", fontWeight: 400 }}
            >
              {item.role === "menuitemradio" ? (
                // A fixed-width slot rather than a conditional element: the
                // labels in a radio list must not shift sideways as the
                // selection moves between them.
                <span
                  aria-hidden="true"
                  data-settings-check={item.checked === true ? "on" : "off"}
                  className="inline-flex w-[18px] justify-center"
                >
                  {item.checked === true ? <CheckIcon size={18} /> : null}
                </span>
              ) : null}
              {item.label}
            </span>
            {item.value !== undefined ? (
              <span
                data-settings-value=""
                className="flex items-center gap-1"
                style={{
                  fontSize: "14px",
                  // Measured `contentColor` on every settings row.
                  color: "rgba(255, 255, 255, 0.7)",
                }}
              >
                {item.value}
                {item.submenu === true ? (
                  <ChevronIcon direction="right" size={18} />
                ) : null}
              </span>
            ) : item.submenu === true ? (
              <ChevronIcon direction="right" size={18} />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- labels -- */

/**
 * The ladder, highest first.
 *
 * `player-1920.json` `quality.rows` is `1080p HD, 720p, 480p, 360p, 240p,
 * 144p` — descending. Sorted on height where the master playlist declared a
 * resolution and on bitrate where it did not, because `toQualityOption` in
 * `src/media/player/engine.ts` falls back to a `kbps` name for a variant with
 * no `RESOLUTION`.
 */
function sortedLadder(qualities: readonly QualityOption[]): readonly QualityOption[] {
  return [...qualities].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bitrate - a.bitrate,
  );
}

/**
 * §5.6's measured labels: `1080p HD`, then bare `720p` and below.
 *
 * The `HD` suffix is applied at 1080 and above rather than at 720, which is
 * where memory puts it — `quality.rows` shows `720p` with no suffix.
 */
export function qualityLabel(option: QualityOption): string {
  const height = option.height ?? 0;
  return height >= 1080 ? `${option.name} HD` : option.name;
}

/**
 * The Quality row's value — `Auto (720p)` in the measurement.
 *
 * This is the live readout `research/07` §7 describes, and it reads from
 * `activeQualityId`, which `EngineState` documents as "the rendition currently
 * being *rendered*". Not `fetchingQualityId`: with 24 seconds of forward buffer
 * those are routinely different rungs, and showing the fetch decision would
 * name a quality the viewer will not see for another twelve segments.
 */
export function qualityReadout(
  qualities: readonly QualityOption[],
  activeQualityId: string | null,
  pinnedQualityId: string | null,
  autoAvailable: boolean,
): string {
  const named = (id: string | null): string | null => {
    const found = qualities.find((option) => option.id === id);
    return found === undefined ? null : qualityLabel(found);
  };

  if (pinnedQualityId !== null) return named(pinnedQualityId) ?? "Unknown";
  if (!autoAvailable) return named(activeQualityId) ?? qualities[0]?.name ?? "Unknown";

  const active = named(activeQualityId);
  // Before the first segment is appended nothing is rendering yet, so there is
  // no rung to name. `Auto` alone is honest; `Auto (—)` is noise.
  return active === null ? "Auto" : `Auto (${active})`;
}

/** §5.6: 1× is written `Normal`. */
export function describeRate(rate: number): string {
  return rate === 1 ? "Normal" : `${rate}`;
}

const CAPTION_COLOURS: readonly { readonly value: string; readonly name: string }[] = [
  { value: "#ffffff", name: "White" },
  { value: "#000000", name: "Black" },
  { value: "#ff0000", name: "Red" },
  { value: "#00ff00", name: "Green" },
  { value: "#0000ff", name: "Blue" },
  { value: "#ffff00", name: "Yellow" },
  { value: "#ff00ff", name: "Magenta" },
  { value: "#00ffff", name: "Cyan" },
];

/**
 * The eight colours, which are **not** invented: they are §1.8's list of the
 * conventional WebVTT presentational colour classes (`white lime cyan red
 * yellow magenta blue black`), which is the palette a caption file can already
 * name.
 */
function nextColour(current: string): string {
  const index = CAPTION_COLOURS.findIndex((entry) => entry.value === current);
  return CAPTION_COLOURS[(index + 1) % CAPTION_COLOURS.length]?.value ?? current;
}

function colourName(value: string): string {
  return CAPTION_COLOURS.find((entry) => entry.value === value)?.name ?? value;
}

const EDGE_ORDER: readonly CaptionEdgeStyle[] = [
  "none",
  "drop-shadow",
  "raised",
  "depressed",
  "outline",
];

const EDGE_LABELS: Readonly<Record<CaptionEdgeStyle, string>> = {
  none: "None",
  "drop-shadow": "Drop shadow",
  raised: "Raised",
  depressed: "Depressed",
  outline: "Outline",
};

function nextEdge(current: CaptionEdgeStyle): CaptionEdgeStyle {
  const index = EDGE_ORDER.indexOf(current);
  return EDGE_ORDER[(index + 1) % EDGE_ORDER.length] ?? current;
}

/** Cycles rather than clamps — a row with one affordance has to wrap to be usable. */
function nextInLadder(ladder: readonly number[], current: number): number {
  const index = ladder.indexOf(current);
  if (index === -1) return steppedScale(ladder, current, 1);
  return ladder[(index + 1) % ladder.length] ?? current;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
