/**
 * The player's keyboard map, as a pure function.
 *
 * `research/07-captions-and-a11y.md` §6 is the source for every binding below,
 * and §6.1 is the source for the two rules that make the map safe to install at
 * the document level. Both are reproduced here rather than paraphrased, because
 * the shortcut layer is the one part of a player that is *always* listening and
 * therefore the one part whose bugs land on people who are not using the player
 * at all.
 *
 * ## Why this is a pure function and not an event handler
 *
 * §6 has three preconditions that are easy to write down and easy to forget in
 * the handler: frame-step requires **paused**, the caption-styling keys require
 * **captions already on**, and the whole map requires that focus is not in a
 * text-entry surface. §6's own closing note says to "build both preconditions
 * into our handler, not just the key match". A function from
 * `(event, context) → action | null` makes each of those a case with a test,
 * with no element, no player and no timers involved.
 *
 * The component installs the listener; this file decides what a key means.
 *
 * ## Honesty about the source
 *
 * §6 marks each row with what confirmed it. The rows confirmed only by a
 * community transcription of the in-player `Shift+?` panel — `t` for theatre and
 * the `o`/`w`/`+`/`-` caption-styling keys — are implemented, and are called out
 * at their `case` so that a later verification pass against the live panel knows
 * exactly which lines to re-check.
 *
 * Three documented shortcuts are deliberately **not** implemented, because the
 * feature behind them does not exist in this application: `Ctrl/⌥ + ←/→`
 * (chapters — no chapter data in the schema), `Shift+?` (the shortcuts help
 * panel), and `Shift+P` is implemented only as an intent the caller may ignore.
 * Binding a key to nothing is worse than leaving it to the browser.
 */

/** §6: `j` / `l`. */
export const SEEK_JUMP_SECONDS = 10;

/** §6: `←` / `→`. Also the `role="slider"` step, per §7.2 — one value, not two. */
export const SEEK_STEP_SECONDS = 5;

/** §6: `↑` / `↓` move volume by 5%. */
export const VOLUME_STEP = 0.05;

/**
 * The ladder `<` and `>` step through.
 *
 * **Assumed.** §6 records only "decrease"/"increase playback speed" and gives no
 * ladder; the settings menu's measured `Playback speed` row
 * (`research/extracted/player-1920.json` `settings.rows`) shows the current value
 * as `Normal` and does not enumerate the options. This is YouTube's familiar set
 * with `Normal` at 1 — the shape is right and the exact membership is a choice
 * made here.
 */
export const PLAYBACK_RATES: readonly number[] = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
];

/**
 * The frame duration `,` and `.` step by when the frame rate is unknown.
 *
 * **Assumed, and the caller should override it.** `video_renditions.frame_rate`
 * carries the real value (`src/domain/types.ts` `Rendition.frameRate`), and
 * `resolveShortcut` takes it in its context so the step is a real frame wherever
 * it is known. 30fps is the fallback for a source that never reported one.
 */
export const ASSUMED_FRAME_RATE = 30;

export type PlayerAction =
  | { readonly kind: "toggle-play" }
  | { readonly kind: "seek-by"; readonly seconds: number }
  | { readonly kind: "seek-to-fraction"; readonly fraction: number }
  | { readonly kind: "frame-step"; readonly seconds: number }
  | { readonly kind: "volume-by"; readonly delta: number }
  | { readonly kind: "toggle-mute" }
  | { readonly kind: "toggle-captions" }
  | { readonly kind: "toggle-fullscreen" }
  | { readonly kind: "toggle-theatre" }
  | { readonly kind: "toggle-miniplayer" }
  | { readonly kind: "speed-step"; readonly direction: 1 | -1 }
  | { readonly kind: "next-video" }
  | { readonly kind: "previous-video" }
  | { readonly kind: "focus-search" }
  | { readonly kind: "dismiss" }
  | { readonly kind: "caption-font-size"; readonly direction: 1 | -1 }
  | { readonly kind: "caption-text-opacity" }
  | { readonly kind: "caption-window-opacity" };

/**
 * §6's "Scope" column, kept as data.
 *
 * `player` keys are the transport: they belong to the player and are swallowed
 * while it is on screen. `global` keys work from anywhere on the page — §6 marks
 * `/`, `Shift+N`, `Shift+P` and `Escape` that way — and a page with no player
 * would still honour them.
 *
 * The distinction is not decorative. A watch page installs one listener for
 * both; a *search results* page that wanted `/` would install a listener that
 * accepts only the `global` half, and this field is what lets it.
 */
export type ShortcutScope = "player" | "global";

export interface ResolvedShortcut {
  readonly action: PlayerAction;
  readonly scope: ShortcutScope;
}

/** The slice of `KeyboardEvent` this needs. Typed narrowly so a test can pass a literal. */
export interface KeyboardEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface ShortcutContext {
  /** §6: `,` and `.` step frames **only while paused**. */
  readonly paused: boolean;
  /** No caption track on this video — `c` is inert and the button is disabled. */
  readonly captionsAvailable: boolean;
  /** §6: `o`, `w`, `+`, `-` act **only while captions are on**. */
  readonly captionsOn: boolean;
  /** From `video_renditions.frame_rate`. Falls back to {@link ASSUMED_FRAME_RATE}. */
  readonly frameRate?: number | undefined;
}

/**
 * §6.1, verbatim: bail out whenever focus is inside an editable context.
 *
 * This is the mechanism that keeps `j`/`k`/`l`/`c` from hijacking typing, and
 * the search box and the comment composer are both on the same page as the
 * player. The check is on the event's *target* rather than on
 * `document.activeElement` because they can differ during focus transitions, and
 * the target is the element that would actually receive the character.
 *
 * `contenteditable` is included because §6.1 names it explicitly ("the comment
 * box"). This application's composer is a `<textarea>`, so that branch is
 * defence against a later rich-text composer rather than a live case — and it
 * costs one `||`.
 */
export function isTypingContext(target: EventTarget | null): boolean {
  if (target === null) return false;
  // Duck-typed rather than `instanceof HTMLElement`: an event that crossed a
  // shadow boundary, or a test passing a literal, both fail the instanceof and
  // would silently be treated as "safe to steal from".
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (element.isContentEditable === true) return true;
  // An ARIA textbox is a text-entry surface even when it is a `<div>`. Not from
  // §6.1 — added here because the rule §6.1 states is about *what the element
  // is for*, and `role="textbox"` is the only other way to say that.
  return element.getAttribute?.("role") === "textbox";
}

/**
 * What a key means, or `null` for "not ours — let the browser have it".
 *
 * Modifier handling is deliberately strict: `ctrl`, `meta` and `alt` disqualify
 * every binding. §6's only modified bindings are the chapter keys, which this
 * application has no data for, and letting a bare `l` handler fire on `⌘L`
 * (focus the address bar) is exactly the kind of theft §6.1 is about.
 */
export function resolveShortcut(
  event: KeyboardEventLike,
  context: ShortcutContext,
): ResolvedShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const player = (action: PlayerAction): ResolvedShortcut => ({ action, scope: "player" });
  const global = (action: PlayerAction): ResolvedShortcut => ({ action, scope: "global" });

  switch (event.key) {
    /* --- transport ----------------------------------------------------- */
    case " ":
    case "Spacebar": // Legacy `key` value; some engines still emit it.
    case "k":
    case "K":
      return player({ kind: "toggle-play" });

    case "j":
    case "J":
      return player({ kind: "seek-by", seconds: -SEEK_JUMP_SECONDS });
    case "l":
    case "L":
      return player({ kind: "seek-by", seconds: SEEK_JUMP_SECONDS });

    case "ArrowLeft":
      return player({ kind: "seek-by", seconds: -SEEK_STEP_SECONDS });
    case "ArrowRight":
      return player({ kind: "seek-by", seconds: SEEK_STEP_SECONDS });

    case "ArrowUp":
      return player({ kind: "volume-by", delta: VOLUME_STEP });
    case "ArrowDown":
      return player({ kind: "volume-by", delta: -VOLUME_STEP });

    case "Home":
      return player({ kind: "seek-to-fraction", fraction: 0 });
    case "End":
      return player({ kind: "seek-to-fraction", fraction: 1 });

    /* --- frame step: paused only (§6) ---------------------------------- */
    case ",":
    case ".": {
      if (!context.paused) return null;
      const rate = context.frameRate ?? ASSUMED_FRAME_RATE;
      const frame = 1 / (rate > 0 ? rate : ASSUMED_FRAME_RATE);
      return player({ kind: "frame-step", seconds: event.key === "," ? -frame : frame });
    }

    /* --- speed --------------------------------------------------------- */
    case "<":
      return player({ kind: "speed-step", direction: -1 });
    case ">":
      return player({ kind: "speed-step", direction: 1 });

    /* --- view modes ---------------------------------------------------- */
    case "f":
    case "F":
      return player({ kind: "toggle-fullscreen" });
    case "t":
    case "T":
      // §6: `t` is **not** on the official help page. Corroborated by the
      // in-player panel transcription and a support-community thread only.
      return player({ kind: "toggle-theatre" });
    case "i":
    case "I":
      return player({ kind: "toggle-miniplayer" });

    /* --- audio and captions -------------------------------------------- */
    case "m":
    case "M":
      return player({ kind: "toggle-mute" });
    case "c":
    case "C":
      // §6: "if available". A video with no caption track makes this inert
      // rather than a toggle that turns on an empty layer.
      return context.captionsAvailable ? player({ kind: "toggle-captions" }) : null;

    /* --- caption styling: captions-on only (§6) ------------------------ */
    case "o":
    case "O":
      return context.captionsOn ? player({ kind: "caption-text-opacity" }) : null;
    case "w":
    case "W":
      return context.captionsOn ? player({ kind: "caption-window-opacity" }) : null;
    case "+":
    case "=": // The unshifted key on a US layout, which is what people press.
      return context.captionsOn
        ? player({ kind: "caption-font-size", direction: 1 })
        : null;
    case "-":
      return context.captionsOn
        ? player({ kind: "caption-font-size", direction: -1 })
        : null;

    /* --- global -------------------------------------------------------- */
    case "N":
      return global({ kind: "next-video" });
    case "P":
      return global({ kind: "previous-video" });
    case "/":
      // §6.1 calls this the inverse case: `/` is only safe to intercept
      // *because* the caller has already checked it is not in a typing context,
      // or typing a literal slash into the search box would re-focus it and
      // swallow the character.
      return global({ kind: "focus-search" });
    case "Escape":
      return global({ kind: "dismiss" });

    default:
      break;
  }

  // §6: `0`–`9` seek to n×10% of the duration.
  if (event.key.length === 1 && event.key >= "0" && event.key <= "9") {
    return player({ kind: "seek-to-fraction", fraction: Number(event.key) / 10 });
  }

  return null;
}

/**
 * The next value on the {@link PLAYBACK_RATES} ladder, clamped at both ends.
 *
 * Clamped rather than wrapped: `>` at 2× should do nothing, not drop the viewer
 * to a quarter speed. Exported because the settings menu and the `<`/`>` keys
 * must move through the same ladder in the same direction, and two
 * implementations of "one step faster" is how they end up disagreeing about
 * whether 1.75 exists.
 */
export function steppedPlaybackRate(current: number, direction: 1 | -1): number {
  const index = PLAYBACK_RATES.indexOf(current);
  // A rate that is not on the ladder — restored from somewhere, or set by a
  // stray API call — snaps to the nearest rung in the direction asked for
  // rather than being ignored.
  if (index === -1) {
    const candidates =
      direction === 1
        ? PLAYBACK_RATES.filter((rate) => rate > current)
        : [...PLAYBACK_RATES].reverse().filter((rate) => rate < current);
    return candidates[0] ?? current;
  }
  return PLAYBACK_RATES[Math.min(Math.max(index + direction, 0), PLAYBACK_RATES.length - 1)] ?? current;
}
