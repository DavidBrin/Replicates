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
 * Runs every registered binding against `event`, in registration order,
 * dispatching the first match. Returns whether a binding fired.
 */
export function dispatchKeyEvent(event: KeyboardEvent): boolean {
  for (const binding of getAllBindings()) {
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
