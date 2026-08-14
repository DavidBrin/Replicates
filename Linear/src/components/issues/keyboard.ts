"use client";

/**
 * The shortcut dispatcher.
 *
 * `research/04-interaction.md` §1.11 says not to reach for a hotkey library
 * that only matches single combos, and lists what is actually needed: chord
 * sequences, an input guard, selection-aware targets. This is that, in one
 * place, with the bindings supplied by whoever mounts it.
 *
 * ## The input guard is the correctness detail, not a nicety
 *
 * This app binds bare `C`, `S`, `A`, `P`, `L`, `X`. Every one of those is a
 * character somebody types. So a keystroke that lands in a text field, a
 * textarea, a `contenteditable`, or — the one that is always forgotten — an
 * **IME composition** must not reach a binding. `event.isComposing` is
 * non-negotiable: without it, a Japanese user typing an issue title fires the
 * status picker mid-word (§1.11). While typing, only modifier-bearing bindings
 * and `Escape` still resolve.
 *
 * ## Why `event.code`, not `event.key`
 *
 * `Shift+1` reports `event.key === "!"`, so a keymap written against `key`
 * needs a table of shifted glyphs per layout and gets `Shift+1..4` wrong on
 * every non-US keyboard. `code` names the physical key, which is what a
 * positional shortcut means. Named keys (`Escape`, `ArrowDown`) fall back to
 * `key`, because there `key` *is* the meaningful name.
 *
 * ## Why the chord window is a timestamp, not a timer
 *
 * A `setTimeout` that clears the buffer makes every test of a chord a test of
 * fake timers, and makes the buffer's state depend on when the assertion runs.
 * Comparing the arming time on the *next* keystroke has identical observable
 * behaviour — the buffer is only ever read by a keystroke — and is a pure
 * function of the inputs.
 */

import { useEffect, useRef } from "react";

export interface Binding {
  readonly id: string;
  /**
   * A normalised chord expression: `"s"`, `"shift+1"`, `"mod+b"`, `"g i"`,
   * `"Escape"`. Space separates the steps of a sequence; `+` joins simultaneous
   * keys. `mod` is Cmd on Apple platforms and Ctrl elsewhere.
   */
  readonly keys: string;
  /** Skip this binding without falling through to another with the same keys. */
  readonly when?: () => boolean;
  readonly run: () => void;
}

/** Chord prefixes: `G` go to, `O` open, `M` mark/relate. Never bound bare (§1.10). */
export const CHORD_PREFIXES: ReadonlySet<string> = new Set(["g", "o", "m"]);

export const CHORD_TIMEOUT_MS = 1_500;

/**
 * Is this event destined for a text surface?
 *
 * `data-no-shortcuts` is the documented opt-out for a component that owns its
 * own keys without being an input — a code editor, a canvas.
 */
export function isTypingTarget(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest("[data-no-shortcuts]") !== null;
}

/** Only these still fire while a text surface has focus. */
export function allowedWhileTyping(token: string): boolean {
  return token.startsWith("mod+") || token === "Escape";
}

function baseKey(event: KeyboardEvent): string {
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "BracketLeft") return "[";
  if (code === "BracketRight") return "]";
  if (code === "Backslash") return "\\";
  if (event.key.length === 1) return event.key.toLowerCase();
  return event.key;
}

/**
 * One keystroke as a token.
 *
 * `mod` folds Cmd and Ctrl together, which is what every binding in the map
 * wants — the shortcut sheet is written `Cmd/Ctrl+B` and there is no binding
 * that means one and not the other.
 */
export function normaliseKey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(baseKey(event));
  return parts.join("+");
}

export interface Dispatcher {
  /** Returns true when a binding ran or a chord was armed. */
  handle(event: KeyboardEvent): boolean;
  /** The armed chord prefix, for the "G …" hint. */
  armed(): string | null;
  reset(): void;
}

export interface DispatcherOptions {
  /** Read fresh on every keystroke: bindings close over selection, which moves. */
  readonly bindings: () => readonly Binding[];
  readonly chordTimeoutMs?: number;
  readonly now?: () => number;
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const {
    bindings,
    chordTimeoutMs = CHORD_TIMEOUT_MS,
    now = () => Date.now(),
  } = options;

  let buffer: string | null = null;
  let armedAt = 0;

  function reset(): void {
    buffer = null;
    armedAt = 0;
  }

  function currentBuffer(): string | null {
    if (buffer === null) return null;
    if (now() - armedAt > chordTimeoutMs) {
      reset();
      return null;
    }
    return buffer;
  }

  return {
    armed: currentBuffer,
    reset,

    handle(event: KeyboardEvent): boolean {
      const token = normaliseKey(event);
      // A bare modifier press is not a keystroke; treating it as one would
      // cancel an armed chord every time somebody reached for Shift.
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return false;

      if (isTypingTarget(event) && !allowedWhileTyping(token)) return false;

      const prefix = currentBuffer();
      const candidate = prefix === null ? token : `${prefix} ${token}`;
      const available = bindings();

      const match = available.find(
        (binding) => binding.keys === candidate && (binding.when?.() ?? true),
      );
      if (match) {
        reset();
        event.preventDefault();
        match.run();
        return true;
      }

      // Arm a chord only when something is actually bound behind it, so `G` in
      // a view with no `G` bindings falls through instead of swallowing the
      // next keystroke.
      if (
        prefix === null &&
        CHORD_PREFIXES.has(token) &&
        available.some((binding) => binding.keys.startsWith(`${token} `))
      ) {
        buffer = token;
        armedAt = now();
        event.preventDefault();
        return true;
      }

      // Any miss cancels the chord — otherwise a mistyped second key leaves the
      // prefix armed and the *following* keystroke does something unrelated.
      reset();
      return false;
    },
  };
}

/**
 * Mount a dispatcher on `document` for the life of the component.
 *
 * The bindings are read through a ref so the listener is registered once:
 * re-subscribing on every render loses a keystroke that arrives between the
 * removal and the addition, which is rare, unreproducible, and reported as
 * "sometimes the shortcut doesn't work".
 *
 * The ref is updated in an effect with no dependency array rather than during
 * render. Both spellings put the latest bindings behind the listener — effects
 * flush before the browser can deliver the next keydown — but writing a ref
 * while rendering is a side effect in a function React may call speculatively
 * and discard, and this hook has no reason to be the exception.
 */
export function useShortcuts(bindings: readonly Binding[], enabled = true): void {
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    const dispatcher = createDispatcher({ bindings: () => latest.current });
    const onKeyDown = (event: KeyboardEvent): void => {
      dispatcher.handle(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
