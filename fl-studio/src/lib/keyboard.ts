/**
 * Keyboard binding REGISTRY (SPEC §4.4, §6, §8).
 *
 * This module owns no bindings of its own. Each surface calls
 * `registerBindings(surfaceId, bindings)` from its own module with its own
 * bindings (e.g. `channel-rack/keyboard.ts` registers `1..9,0` mute,
 * `piano-roll/keyboard.ts` registers `Ctrl+↑/↓` transpose). This slice (C)
 * registers only the GLOBAL bindings that work "from any window" per
 * SPEC §1.1's undo/redo line and §4.1's window toggles: `Space` play/stop,
 * `L` pattern/song, `F5`/`F6`/`F7`/`F9` window toggles, and
 * `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` undo/redo — see
 * `src/components/shell/AppShell.tsx`.
 *
 * Not a React hook module by itself — plain, framework-agnostic, and
 * synchronously testable. `useKeyboardRegistry()` in AppShell is the only
 * place that attaches the real DOM listener.
 *
 * ## Bindings never fire while the user is typing
 *
 * {@link dispatchKeyEvent} skips every binding whose `worksInInputs` is not
 * explicitly `true` when the event originated in an `<input>`/`<textarea>`/
 * `<select>`/`contenteditable`. Without that guard SPEC §4.4's map is actively
 * hostile to its own UI: typing `140` into the BPM box would mute channels
 * 1, 4 and 10, `Space` would start playback instead of inserting a space, and
 * `Backspace` would toggle snap instead of deleting a digit.
 *
 * ## The guard protects TEXT, not focus
 *
 * The question {@link isTextEntryTarget} answers is "would swallowing this
 * keystroke steal a character", and a control with no text to steal is not
 * covered by it however input-shaped it is. That distinction is load-bearing
 * in both directions:
 *
 * - A **range slider** is not text entry. Treating it as such made every
 *   global shortcut die for as long as one had focus — adjust the swing
 *   slider and `Ctrl+Z`, `Ctrl+S` and `Space` were all silently dead until
 *   the user clicked elsewhere, with nothing on screen to explain why.
 * - A control that handles a key **itself** stops that key at the source
 *   instead, with {@link claimHandledKey}. The registry then never sees it,
 *   which is the only version of this that works for a `role="slider"` div
 *   (`Knob`, `Fader`) — no guard in this module can see those, because they
 *   are not form controls at all, and `Space` on one was both resetting the
 *   knob and toggling playback.
 *
 * The two halves are one policy: the *control* owns the keys it handles, the
 * *registry* owns everything else, and the text guard only ever protects
 * genuine text editing.
 */

export interface KeyCombo {
  /** `KeyboardEvent.code`, e.g. "Space", "KeyL", "F5", "KeyZ". */
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface KeyBinding extends KeyCombo {
  /** Unique within a surface's own registration; used for de-duplication only. */
  id: string;
  handler: (event: KeyboardEvent) => void;
  /** Defaults to true — most FL bindings shadow a browser default. */
  preventDefault?: boolean;
  description?: string;
  /**
   * Opt in to firing while the user is typing in a form control.
   *
   * Defaults to **false**, and that default is the whole point (SPEC §4.4's
   * map is nearly all bare letters and digits): `1..9,0` mute channels,
   * `Space` plays, `Backspace` toggles snap and `Ctrl+A` selects every note —
   * every one of which would hijack the BPM box, a rename field or a number
   * input the moment it took focus. A binding only sets this when it is
   * genuinely global *and* harmless mid-typing.
   */
  worksInInputs?: boolean;
}

const registry = new Map<string, KeyBinding[]>();

/**
 * Registers (replacing any prior registration under the same `surfaceId`)
 * this surface's bindings, active as long as they remain registered.
 * Returns an unregister function — call it on unmount / blur.
 */
export function registerBindings(
  surfaceId: string,
  bindings: KeyBinding[],
): () => void {
  registry.set(surfaceId, bindings);
  return () => {
    // Only clear if nothing re-registered under this id since (StrictMode
    // double-invoke safety): re-check identity before deleting.
    if (registry.get(surfaceId) === bindings) {
      registry.delete(surfaceId);
    }
  };
}

export function unregisterBindings(surfaceId: string): void {
  registry.delete(surfaceId);
}

export function getAllBindings(): KeyBinding[] {
  return Array.from(registry.values()).flat();
}

export function comboMatches(event: KeyboardEvent, combo: KeyCombo): boolean {
  return (
    event.code === combo.code &&
    event.ctrlKey === !!combo.ctrl &&
    event.shiftKey === !!combo.shift &&
    event.altKey === !!combo.alt &&
    event.metaKey === !!combo.meta
  );
}

/**
 * Is this event aimed at somewhere the user is *typing*?
 *
 * `composedPath()` first, `target` as the fallback: a control inside a shadow
 * root retargets `event.target` to the host, and a jsdom-synthesized event may
 * not implement `composedPath` at all. Either way the question is the same —
 * would swallowing this keystroke steal a character from a text field.
 *
 * `<select>` counts: its type-ahead and its arrow keys are its own, and the
 * digits that mute channels are exactly what a select uses to jump options.
 */
/**
 * `<input type=...>` values that hold no text to protect. Everything else —
 * `text`, `number`, `search`, `email`, `password`, `date`, an unknown type
 * (which the browser renders as `text`) — is text entry.
 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "range",
]);

/** Keys a native `<input type="range">` acts on itself. */
export const RANGE_INPUT_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Keys a `role="slider"` widget of ours acts on itself (`Knob`, `Fader`):
 * arrows nudge, `Enter`/`Space` reset to default.
 */
export const CUSTOM_SLIDER_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "Enter",
  " ",
]);

/** The shape both a DOM `KeyboardEvent` and React's synthetic one satisfy. */
interface ClaimableKeyEvent {
  key: string;
  stopPropagation: () => void;
  preventDefault: () => void;
}

/**
 * "This control handled the key; the global registry must not see it."
 *
 * `stopPropagation` is the operative half. The registry listens on the
 * WINDOW, above React's root container, so a key a control handles reaches it
 * afterwards and fires a second, unrelated action: `Space` on a knob reset the
 * knob *and* started playback, and `ArrowUp` on a fader moved the fader *and*
 * transposed the piano roll's selection.
 *
 * `preventDefault` is separate and opt-out (`{ preventDefault: false }`),
 * because it means two different things here. A `role="slider"` div has no
 * useful browser default and wants it suppressed (`Space` scrolls the page).
 * A native `<input type="range">` IS its browser default — suppressing it
 * would stop the arrow keys moving the slider at all, which is the behaviour
 * being protected.
 *
 * Returns whether the key was claimed, so a caller can `if (…) return`.
 */
export function claimHandledKey(
  event: ClaimableKeyEvent,
  keys: ReadonlySet<string>,
  options: { preventDefault?: boolean } = {},
): boolean {
  if (!keys.has(event.key)) return false;
  event.stopPropagation();
  if (options.preventDefault !== false) event.preventDefault();
  return true;
}

/**
 * `onKeyDown` for a native range slider: keep the keys it handles itself out
 * of the global registry, keep its own browser behaviour. One exported
 * handler rather than a rule each `<input type="range">` re-implements —
 * there are two of them (transport swing, rack swing) and they must agree.
 */
export function handleRangeInputKeyDown(event: ClaimableKeyEvent): void {
  claimHandledKey(event, RANGE_INPUT_KEYS, { preventDefault: false });
}

export function isTextEntryTarget(event: Event): boolean {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];
  const candidates = path.length > 0 ? path : [event.target];

  for (const node of candidates) {
    if (node === null || typeof node !== "object") continue;
    const element = node as Partial<HTMLElement> & { tagName?: string };
    const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      // A checkbox/radio/button input has no text to steal, and Space on one
      // is the browser's own activation — but the app's Space is play/stop,
      // which is the more useful binding there, so only text-ish inputs win.
      //
      // `range` is on that list for the same reason and is the one that bit:
      // a slider holds a number the arrow keys move, never a caret, so there
      // is no character to steal — and calling it text entry killed EVERY
      // global shortcut (`Ctrl+Z`, `Ctrl+S`, `Space`) for as long as the
      // swing slider kept focus. The arrow keys the slider does use are
      // stopped at the slider itself ({@link claimHandledKey}), which is
      // narrow where this guard is total.
      if (tag !== "INPUT") return true;
      const type = String((element as Partial<HTMLInputElement>).type ?? "text").toLowerCase();
      return !NON_TEXT_INPUT_TYPES.has(type);
    }
    if (element.isContentEditable === true) return true;
    // Stop at the document/window end of the path.
    if (tag === "BODY" || tag === "HTML") return false;
  }
  return false;
}

/**
 * Runs every registered binding against `event`, in registration order,
 * dispatching the first match. Returns whether a binding fired.
 *
 * **Nothing fires while the user is typing** unless the binding opted in with
 * `worksInInputs` — see {@link KeyBinding.worksInInputs}. This is checked in
 * the dispatcher rather than in each surface's handler so that a binding
 * registered later cannot forget it.
 */
export function dispatchKeyEvent(event: KeyboardEvent): boolean {
  const typing = isTextEntryTarget(event);
  for (const binding of getAllBindings()) {
    if (typing && binding.worksInInputs !== true) continue;
    if (comboMatches(event, binding)) {
      if (binding.preventDefault !== false) {
        event.preventDefault();
      }
      binding.handler(event);
      return true;
    }
  }
  return false;
}

/** Attaches the registry to a real event target's `keydown`. Returns a detach fn. */
export function attachKeyboardListener(
  target: EventTarget = window,
): () => void {
  const listener = (event: Event) => dispatchKeyEvent(event as KeyboardEvent);
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

/** Test-only: clears every surface's bindings. */
export function __resetKeyboardRegistryForTests(): void {
  registry.clear();
}
