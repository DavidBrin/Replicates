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
      if (tag !== "INPUT") return true;
      const type = String((element as Partial<HTMLInputElement>).type ?? "text").toLowerCase();
      return type !== "button" && type !== "submit" && type !== "reset" &&
        type !== "checkbox" && type !== "radio";
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
