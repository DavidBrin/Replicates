"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { parseCueText, type CueNode } from "@/domain/captions";

/**
 * Captions, rendered by us rather than by the browser.
 *
 * `research/07-captions-and-a11y.md` §2 lays out the choice and settles it:
 * **Route B**, a `TextTrack` at `mode = 'hidden'` plus our own DOM. The browser
 * still does the WebVTT *parsing* — that is free and correct — but it paints
 * nothing, and every pixel below is ours.
 *
 * §2 gives two reasons, and both are requirements of this player rather than
 * preferences:
 *
 *  1. **The caption settings panel.** Font size, text colour and opacity,
 *     background colour and opacity, window colour and opacity, and edge style.
 *     `::cue` exposes none of the positioning and only a coarse, inconsistently
 *     supported subset of the styling — Safari and Firefox support far fewer
 *     `::cue` properties than Chromium — so a settings panel built on native
 *     rendering visibly does nothing in half the browsers it ships to.
 *  2. **Avoiding the control bar.** Native cues are placed by the UA's own
 *     rendering algorithm and there is no hook that says "the control bar just
 *     came up, move". Ours takes the bar's height as a prop.
 *
 * ## What is deliberately not implemented, and why that is stated here
 *
 * §2 is explicit that Route B means reimplementing the WebVTT rendering
 * algorithm, and names the parts naive implementations get wrong first. This
 * file implements the **default-position case**: cues stack upward from the
 * bottom of the video, each on its own line box, honouring `align` when the cue
 * carries one. It does **not** implement `line`/`position`/`size`/`vertical`
 * placement, regions, or region scrolling. A `.vtt` this application generates
 * uses none of those (see the captions produced by the ASR port), so the gap is
 * between what our own content needs and what the spec allows — not between
 * what our content needs and what we render. It is called out because a
 * third-party caption file would hit it.
 *
 * ## Where the grammar lives
 *
 * Not here. `src/domain/captions.ts` owns WebVTT — `parseCueText` returns a
 * `CueNode` tree and its own comment gives the reason this file must not
 * re-derive one: *"a renderer handed a string would have to parse it again, in
 * a component, per frame."* This module is the React half of that split, and
 * the only thing it knows about the grammar is how each node kind should look.
 */

/* ------------------------------------------------------------- settings -- */

/**
 * The five edge styles the settings panel offers (§2's list, and YouTube's
 * caption-settings surface).
 *
 * Rendered with `text-shadow` rather than `-webkit-text-stroke`: the stroke
 * property paints *over* the glyph rather than outside it, which thins the
 * letterform at the small sizes captions are usually read at.
 */
export type CaptionEdgeStyle =
  | "none"
  | "drop-shadow"
  | "raised"
  | "depressed"
  | "outline";

export interface CaptionSettings {
  /** A multiplier on the base size, not a px value — see {@link CAPTION_FONT_SCALES}. */
  readonly fontScale: number;
  readonly fontFamily: string;
  readonly textColour: string;
  readonly textOpacity: number;
  /** The box behind the *text*. YouTube's default is black at 75%. */
  readonly backgroundColour: string;
  readonly backgroundOpacity: number;
  /** The box behind the whole caption *block*, which defaults to invisible. */
  readonly windowColour: string;
  readonly windowOpacity: number;
  readonly edge: CaptionEdgeStyle;
}

/**
 * The font-size ladder `+` / `-` step through, as multipliers.
 *
 * **Assumed.** `research/07` §6 records `+` and `-` as "increase/decrease
 * caption font size" and gives no ladder, and no caption settings panel was
 * captured in the R8 pass. 50%–400% is YouTube's published range; the rungs
 * between are this file's.
 */
export const CAPTION_FONT_SCALES: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3, 4];

/**
 * The opacity ladder `o` (text) and `w` (window) cycle through.
 *
 * §6 says both keys *cycle* rather than step, so this wraps rather than clamps
 * — which is also why it is a separate ladder from the font sizes above. Zero
 * is included for the window because a fully transparent window is the default
 * state the key cycles away from and back to.
 */
export const CAPTION_OPACITIES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

/**
 * The base size captions render at before `fontScale`.
 *
 * **Assumed**, and expressed as a fraction of the player height rather than a
 * px value so that a caption legible in the 1344×756 inline player is still
 * legible at 1920×1080 fullscreen without the settings changing. 4.5% of the
 * height is ~34px on the measured 756px player, which is the order the
 * screenshots show (`screenshots/13-player-settings-menu-1920.png`).
 */
export const CAPTION_BASE_HEIGHT_FRACTION = 0.045;

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  fontScale: 1,
  // R8 §2: the player runs `"YouTube Noto", Roboto, Arial, …`. YouTube Noto is
  // proprietary and is not substituted for, so this is the same stack minus the
  // face we may not ship.
  fontFamily: "Roboto, Arial, sans-serif",
  textColour: "#ffffff",
  textOpacity: 1,
  backgroundColour: "#000000",
  backgroundOpacity: 0.75,
  windowColour: "#000000",
  windowOpacity: 0,
  edge: "none",
};

/** Steps a value along a ladder, clamped at both ends. */
export function steppedScale(
  ladder: readonly number[],
  current: number,
  direction: 1 | -1,
): number {
  const index = ladder.indexOf(current);
  if (index === -1) return ladder[direction === 1 ? ladder.length - 1 : 0] ?? current;
  return ladder[Math.min(Math.max(index + direction, 0), ladder.length - 1)] ?? current;
}

/** Cycles a value along a ladder, wrapping — §6's `o` and `w` semantics. */
export function cycledOpacity(current: number): number {
  const index = CAPTION_OPACITIES.indexOf(current);
  const next = CAPTION_OPACITIES[(index + 1) % CAPTION_OPACITIES.length];
  return next ?? current;
}

/**
 * `#rrggbb` + alpha → `rgba(...)`.
 *
 * Written out rather than using an eight-digit hex because the settings store
 * colour and opacity as two independent controls — that is how the panel is
 * described in §2 — and recombining them at render time is the only place they
 * meet.
 */
export function withAlpha(colour: string, alpha: number): string {
  const clamped = Math.min(Math.max(alpha, 0), 1);
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (match?.[1] === undefined) {
    // Not a hex we can decompose (a keyword, or already an rgba). Returning it
    // unchanged loses the opacity, which is visibly wrong but is better than
    // emitting a malformed colour that drops the caption entirely.
    return colour;
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

/**
 * The edge styles, as `text-shadow` values.
 *
 * `raised` and `depressed` are two shadows in opposite directions, which is
 * what gives the bevel; `outline` is four offset copies, which is the
 * shadow-based way to get a stroke that sits outside the glyph.
 */
export function edgeTextShadow(edge: CaptionEdgeStyle): string | undefined {
  switch (edge) {
    case "none":
      return undefined;
    case "drop-shadow":
      return "2px 2px 3px rgba(0, 0, 0, 0.8)";
    case "raised":
      return "1px 1px 0 rgba(0, 0, 0, 0.9), -1px -1px 0 rgba(255, 255, 255, 0.35)";
    case "depressed":
      return "-1px -1px 0 rgba(0, 0, 0, 0.9), 1px 1px 0 rgba(255, 255, 255, 0.35)";
    case "outline":
      return "-1px 0 0 #000, 1px 0 0 #000, 0 -1px 0 #000, 0 1px 0 #000";
  }
}

/* ------------------------------------------------------------ cue source -- */

export interface TextTrackCueLike {
  readonly text: string;
  readonly startTime: number;
  readonly endTime: number;
  /** `VTTCue.align`. Absent on a bare `TextTrackCue`, which is why it is optional. */
  readonly align?: string;
}

export interface TextTrackCueListLike {
  readonly length: number;
  readonly [index: number]: TextTrackCueLike | undefined;
}

/**
 * The `TextTrack` surface this needs.
 *
 * Typed as an interface rather than against the DOM class for the reason
 * `DECISIONS.md` D4 gives for the muxer and `src/media/player/engine.ts` gives
 * for `MediaElementLike`: jsdom implements neither `TextTrack` nor `VTTCue`, so
 * code typed against them could only ever be tested in a browser. A real
 * `TextTrack` satisfies this structurally.
 */
export interface TextTrackLike {
  mode: "disabled" | "hidden" | "showing";
  readonly activeCues: TextTrackCueListLike | null;
  readonly cues: TextTrackCueListLike | null;
  addEventListener(type: "cuechange", listener: () => void): void;
  removeEventListener(type: "cuechange", listener: () => void): void;
}

/**
 * Drive a track and report the cues that are active right now.
 *
 * The mode assignment is the load-bearing line and §2 is precise about what the
 * three values mean: `disabled` does not even process cues (so `cuechange`
 * never fires and `activeCues` stays empty), `hidden` processes them and fires
 * `cuechange` **without painting**, and `showing` is the native rendering we are
 * replacing. Turning captions off therefore has to go to `disabled` rather than
 * simply not rendering our layer — otherwise the browser keeps doing cue
 * bookkeeping for a layer nobody is looking at.
 *
 * The listener is attached before the first read so a `cuechange` that lands
 * between the two cannot be missed.
 */
export function useActiveCues(
  track: TextTrackLike | null,
  enabled: boolean,
): readonly TextTrackCueLike[] {
  const [cues, setCues] = useState<readonly TextTrackCueLike[]>(NO_CUES);

  useEffect(() => {
    if (track === null) return;
    if (!enabled) {
      setTrackMode(track, "disabled");
      return;
    }

    const read = (): void => setCues(collectCues(track.activeCues));

    track.addEventListener("cuechange", read);
    setTrackMode(track, "hidden");
    read();

    return () => {
      track.removeEventListener("cuechange", read);
    };
  }, [track, enabled]);

  // Derived rather than cleared: turning captions off does not need a state
  // write and a second render, and leaving the last cues in state means turning
  // them back on repaints instantly instead of waiting for the next
  // `cuechange`.
  return enabled && track !== null ? cues : NO_CUES;
}

const NO_CUES: readonly TextTrackCueLike[] = [];

/**
 * The one mutation this module performs on the browser's object.
 *
 * Lifted out of the component so it reads as what it is — a write to an
 * external system, which is precisely what an effect is for — rather than as a
 * component mutating something handed to it.
 */
function setTrackMode(track: TextTrackLike, mode: TextTrackLike["mode"]): void {
  track.mode = mode;
}

function collectCues(active: TextTrackCueListLike | null): readonly TextTrackCueLike[] {
  if (active === null || active.length === 0) return NO_CUES;
  const next: TextTrackCueLike[] = [];
  for (let i = 0; i < active.length; i += 1) {
    const cue = active[i];
    if (cue !== undefined) next.push(cue);
  }
  return next;
}

/* ---------------------------------------------------------- cue markup --- */

/**
 * §1.8's inline markup, turned into DOM.
 *
 * **The parsing is not done here.** `src/domain/captions.ts` already owns the
 * WebVTT grammar — `parseCueText` returns a `CueNode` tree, and its own comment
 * says why it is a tree rather than a string: *"a renderer handed a string
 * would have to parse it again, in a component, per frame."* This is that
 * renderer, and it does exactly one job: `CueNode` -> React.
 *
 * The mapping:
 *
 *  - `bold`/`italic`/`underline` become `<b>`/`<i>`/`<u>`, which is what
 *    §1.8's `::cue(b)` mapping is describing.
 *  - `voice` becomes a `<span data-voice="Speaker">`. §1.8 records that the
 *    speaker is exposed "to accessibility tooling as who is speaking", so the
 *    attribution is kept as an attribute rather than being given a colour this
 *    component would have invented.
 *  - `lang` becomes a real `lang` attribute — that tag exists to carry text
 *    direction and pronunciation, and the DOM already has the right hook.
 *  - `class`, `ruby` and `rt` unwrap into a `<span>` carrying their classes as
 *    `data-cue-class`. The eight conventional colour names §1.8 lists are a UA
 *    convention rather than part of the grammar, and honouring them would
 *    fight the caption settings the viewer controls.
 *  - `timestamp` renders nothing. Karaoke highlighting needs a `currentTime`
 *    this component would then re-render against on every frame, and no caption
 *    source in this application emits timestamp tags. The text around them
 *    still renders, because they are siblings rather than containers.
 */
export function renderCueText(text: string): ReactNode {
  return renderCueNodes(parseCueText(text));
}

function renderCueNodes(nodes: readonly CueNode[]): ReactNode {
  return nodes.map((node, index) => renderCueNode(node, index));
}

function renderCueNode(node: CueNode, key: number): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "timestamp":
      return null;
    case "bold":
      return <b key={key}>{renderCueNodes(node.children)}</b>;
    case "italic":
      return <i key={key}>{renderCueNodes(node.children)}</i>;
    case "underline":
      return <u key={key}>{renderCueNodes(node.children)}</u>;
    case "voice":
      return (
        <span key={key} data-voice={node.speaker}>
          {renderCueNodes(node.children)}
        </span>
      );
    case "lang":
      return (
        <span key={key} lang={node.language}>
          {renderCueNodes(node.children)}
        </span>
      );
    case "class":
    case "ruby":
    case "rt":
      return (
        <span
          key={key}
          data-cue-class={
            node.classes.length > 0 ? node.classes.join(" ") : undefined
          }
        >
          {renderCueNodes(node.children)}
        </span>
      );
  }
}


/* -------------------------------------------------------------- layer ---- */

export interface CaptionLayerProps {
  readonly cues: readonly TextTrackCueLike[];
  readonly settings: CaptionSettings;
  /**
   * How much room to leave at the bottom, in px.
   *
   * This is the whole point of Route B (§2). The caller passes the control
   * bar's height while the bar is up and a small inset while it is hidden, and
   * the caption stack moves out of the way — behaviour no native `<track>`
   * implementation exposes a hook for.
   */
  readonly bottomInset: number;
  /** The player's height in px, which the base font size is a fraction of. */
  readonly playerHeight: number;
}

export function CaptionLayer({
  cues,
  settings,
  bottomInset,
  playerHeight,
}: CaptionLayerProps) {
  const fontSize = useMemo(() => {
    const base = playerHeight * CAPTION_BASE_HEIGHT_FRACTION;
    // A floor so a player rendered before layout (height 0 on the server, and
    // in jsdom) still produces readable text rather than 0px captions.
    return Math.max(base, 16) * settings.fontScale;
  }, [playerHeight, settings.fontScale]);

  if (cues.length === 0) return null;

  const window: CSSProperties = {
    background: withAlpha(settings.windowColour, settings.windowOpacity),
  };

  const line: CSSProperties = {
    background: withAlpha(settings.backgroundColour, settings.backgroundOpacity),
    color: withAlpha(settings.textColour, settings.textOpacity),
    fontFamily: settings.fontFamily,
    fontSize: `${Math.round(fontSize)}px`,
    lineHeight: 1.3,
    textShadow: edgeTextShadow(settings.edge),
  };

  return (
    <div
      data-caption-layer=""
      // Not `aria-live`. The cues are a transcript of audio the viewer can
      // already hear or has already been told is unavailable; announcing every
      // cue would talk over a screen reader continuously. §7.5 reserves the
      // live region for state changes, and "captions on" is announced there.
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center justify-end px-[8%]"
      style={{ bottom: `${bottomInset}px` }}
    >
      <div className="flex max-w-full flex-col gap-[2px]" style={window}>
        {cues.map((cue, cueIndex) =>
          cue.text.split("\n").map((text, lineIndex) => (
            <span
              key={`${cueIndex}-${lineIndex}`}
              data-caption-line=""
              // `self-center` per cue alignment: the measured player paints one
              // box per *line* rather than one box behind the block
              // (`screenshots/13-player-settings-menu-1920.png` shows two
              // separately-boxed lines), so the box is on the line element.
              className="w-fit max-w-full px-[0.4em] py-[0.1em] whitespace-pre-wrap"
              style={{ ...line, alignSelf: alignmentOf(cue) }}
            >
              {renderCueText(text)}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

/**
 * §1.4's `align` setting, mapped onto flexbox.
 *
 * `start`/`end` are logical and `left`/`right` are physical; both appear in the
 * grammar and both are honoured. Anything else — including a cue with no
 * `align`, which is the common case — centres, which is WebVTT's own default.
 */
function alignmentOf(cue: TextTrackCueLike): CSSProperties["alignSelf"] {
  switch (cue.align) {
    case "start":
    case "left":
      return "flex-start";
    case "end":
    case "right":
      return "flex-end";
    default:
      return "center";
  }
}
