/**
 * The shortcut dispatcher.
 *
 * One `keydown` listener for the whole application. Not a hook, not a
 * decorator, and above all not a `onKeyDown` per component: the model this app
 * copies has a *scope stack*, *chord sequences*, *selection-aware targets* and
 * an *input guard*, and none of those four can be expressed by handlers
 * attached to whichever element happens to have focus.
 * `research/04-interaction.md` §1.11 sizes it at ~200 lines and warns against
 * reaching for a hotkey library that only matches single combinations. This is
 * that ~200 lines.
 *
 * ```
 * ┌─ document keydown ─────────────────────────────┐
 * │  1. normalise → token   (null ⇒ IME / modifier) │
 * │  2. Escape? → run the ladder, first rung wins    │
 * │  3. typing target? → only mod-bearing survives   │
 * │  4. buffer + token → resolve against the stack   │
 * │  5. no match, live prefix? → arm the chord       │
 * │  6. match → preventDefault, run                  │
 * └─────────────────────────────────────────────────┘
 * ```
 *
 * ## Why the stack is ranked and not merely LIFO
 *
 * The research describes a LIFO stack, which is right in a world where things
 * are pushed in the order they appear. React is not that world: an issue list
 * mounts before the modal that covers it, and a modal that re-renders can push
 * *after* a picker inside it. A pure LIFO stack therefore hands `Escape` to
 * whichever component last re-rendered, which is the kind of bug that
 * reproduces once a week and never in a test.
 *
 * Layers are ordered by `(SCOPE_LEVEL, registration sequence)` instead. Within
 * one level the last registration still wins, so two lists on screen behave
 * LIFO; across levels the modal always outranks the list, whatever React did.
 *
 * ## Why `preventDefault` is late
 *
 * Rule 5 of §9.6: *never* call `preventDefault()` unless a binding actually
 * matched. Swallowing keys speculatively breaks browser find, assistive
 * technology and the user's own OS shortcuts, and it is invisible until someone
 * files "Cmd+L does nothing in your app". The only speculative call here is on
 * arming a chord, which is a genuine consumption — the `g` of `g i` must not
 * also reach the page.
 */

import {
  allowedWhileTyping,
  isTypingTarget,
  normalizeKeyEvent,
  parseSequence,
  sequenceKey,
  type KeyToken,
} from "./keys";
import {
  CHORD_PREFIXES,
  isBlockingScope,
  MODAL_PASSTHROUGH,
  SCOPE_LEVEL,
  shortcutById,
  type Scope,
} from "./registry";

/** How long an armed chord waits for its second key. */
export const CHORD_TIMEOUT_MS = 1500;

/* ============================================================== bindings = */

/** What a binding's `run` is told about the keystroke that fired it. */
export interface DispatchContext {
  readonly event: KeyboardEvent;
  readonly binding: ResolvedBinding;
}

export interface BindingInput {
  /**
   * The registry id, when there is one.
   *
   * Supplying only `{ id, run }` takes the keys from `registry.ts`, which is
   * what keeps the help overlay honest: a binding whose behaviour is here and
   * whose keys are there cannot drift, because there is only one copy of the
   * keys.
   */
  readonly id: string;
  /** Override, for a binding with no registry entry (a picker's own keys). */
  readonly keys?: string;
  readonly run: (context: DispatchContext) => void;
  /**
   * Guard evaluated at dispatch time.
   *
   * A binding whose `when` is false is skipped and resolution **continues down
   * the stack**, so a list can keep `Enter` while a row is focused and let it
   * through to the page otherwise.
   */
  readonly when?: () => boolean;
  /**
   * Fire even while a text field has focus.
   *
   * Almost never correct — the policy in {@link allowedWhileTyping} already
   * lets `Escape` and every `mod`-bearing binding through. The opt-out exists
   * for a binding whose whole job is to act on a field (a composer's own
   * submit), and it is a prop rather than a special case in the guard so the
   * decision is visible at the call site.
   */
  readonly allowWhileTyping?: boolean;
}

export interface ResolvedBinding extends BindingInput {
  readonly scope: Scope;
  readonly sequence: readonly KeyToken[];
}

interface Layer {
  readonly scope: Scope;
  readonly level: number;
  readonly seq: number;
  bindings: readonly ResolvedBinding[];
}

/* ================================================================ escape = */

/**
 * One rung of the Escape ladder.
 *
 * `close()` returns whether it consumed the keypress. Returning false passes
 * `Escape` to the rung below, which is what lets a list keep a "clear
 * selection" rung permanently registered without swallowing the `Escape` that
 * was meant for the picker above it.
 *
 * **The dispatcher never removes a rung.** The thing that pushed it owns its
 * lifetime, because only that component knows whether `close()` finished the
 * job or merely stepped back one page of a multi-page palette.
 */
export interface EscapeLayer {
  readonly id: string;
  close: () => boolean;
}

/* =============================================================== outcome = */

/**
 * What the dispatcher did with a keystroke.
 *
 * Returned rather than swallowed so the tests can assert on the decision — the
 * difference between "no binding matched" and "suppressed because a text field
 * had focus" is exactly the distinction a keyboard model has to get right, and
 * a boolean cannot express it.
 */
export type DispatchOutcome =
  | { readonly kind: "ignored"; readonly reason: IgnoreReason }
  | { readonly kind: "chord"; readonly buffer: readonly KeyToken[] }
  | { readonly kind: "chord-cancelled"; readonly buffer: readonly KeyToken[] }
  | { readonly kind: "handled"; readonly id: string }
  | { readonly kind: "escape"; readonly layer: string };

export type IgnoreReason =
  | "composing"
  | "modifier"
  | "typing"
  | "no-match"
  | "blocked";

const IGNORED = (reason: IgnoreReason): DispatchOutcome => ({
  kind: "ignored",
  reason,
});

/* ============================================================ dispatcher = */

export class KeyboardDispatcher {
  #layers: Layer[] = [];
  #escape: EscapeLayer[] = [];
  #buffer: KeyToken[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #seq = 0;
  #chordListeners = new Set<(buffer: readonly KeyToken[]) => void>();

  /**
   * Register a set of bindings at one scope level.
   *
   * Returns the unregisterer. Registering is cheap and unregistering is exact,
   * which is what lets a React component own its bindings for exactly as long
   * as it is mounted without the dispatcher knowing React exists.
   */
  register(scope: Scope, bindings: readonly BindingInput[]): () => void {
    const layer: Layer = {
      scope,
      level: SCOPE_LEVEL[scope],
      seq: this.#seq++,
      bindings: bindings.map((binding) => resolve(binding, scope)),
    };
    this.#layers.push(layer);
    this.#layers.sort((a, b) => a.level - b.level || a.seq - b.seq);
    return () => {
      this.#layers = this.#layers.filter((entry) => entry !== layer);
    };
  }

  /** Push a rung onto the Escape ladder. Returns its remover. */
  pushEscapeLayer(layer: EscapeLayer): () => void {
    this.#escape.push(layer);
    return () => {
      this.#escape = this.#escape.filter((entry) => entry !== layer);
    };
  }

  /**
   * Subscribe to the chord buffer.
   *
   * Linear shows a subtle `G …` affordance while a chord is armed
   * (`research/04-interaction.md` §1.11). Without it, an armed prefix is
   * invisible state — the user presses `g`, gets distracted, presses `s` and
   * lands in Settings with no idea why.
   */
  onChordChange(listener: (buffer: readonly KeyToken[]) => void): () => void {
    this.#chordListeners.add(listener);
    return () => {
      this.#chordListeners.delete(listener);
    };
  }

  /** The armed prefix, for a component that would rather poll than subscribe. */
  get chord(): readonly KeyToken[] {
    return this.#buffer;
  }

  /** Attach to a DOM target. Returns the detacher. */
  attach(target: EventTarget): () => void {
    const listener = (event: Event): void => {
      if (isKeyboardEvent(event)) this.handleKeyDown(event);
    };
    // `capture: false` — bubble phase, so a component that genuinely owns a key
    // (a picker's own arrow handling) can stop propagation and be believed.
    target.addEventListener("keydown", listener);
    return () => {
      target.removeEventListener("keydown", listener);
      this.#clearChord();
    };
  }

  /** Release the chord timer. Nothing else here holds a resource. */
  dispose(): void {
    this.#clearChord();
    this.#layers = [];
    this.#escape = [];
    this.#chordListeners.clear();
  }

  handleKeyDown(event: KeyboardEvent): DispatchOutcome {
    const token = normalizeKeyEvent(event);
    // Null covers two very different situations that must behave identically:
    // an IME composition keystroke, and a bare modifier press. Neither may
    // cancel an armed chord — holding Shift while deciding on the second key of
    // `M B` is normal, and cancelling on it would make the chord unusable.
    if (token === null) {
      return IGNORED(event.isComposing || event.keyCode === 229 ? "composing" : "modifier");
    }

    if (token === "escape") {
      const outcome = this.#runEscapeLadder();
      if (outcome !== null) {
        event.preventDefault();
        return outcome;
      }
      // Fall through: a view may bind `escape` itself (clear the find query),
      // and the ladder having no rung is not the same as the key being unowned.
    }

    const typing = isTypingTarget(event);
    if (typing && !allowedWhileTyping(token)) {
      // A keystroke that reaches a text field also cancels any armed chord: the
      // `g` was clearly not the start of a navigation if the next thing the
      // user did was type into a box.
      this.#clearChord();
      return IGNORED("typing");
    }

    const candidate: KeyToken[] = [...this.#buffer, token];
    const match = this.#resolve(candidate, token, typing);

    if (match !== null) {
      this.#clearChord();
      event.preventDefault();
      match.run({ event, binding: match });
      return { kind: "handled", id: match.id };
    }

    // No exact match. Is this the first key of a chord somebody has bound?
    // Modifier-bearing keys can never arm one — `Cmd+G` is not the start of
    // anything, and treating it as one would eat the next keystroke.
    if (
      this.#buffer.length === 0 &&
      CHORD_PREFIXES.has(token) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      this.#hasChordUnder(token)
    ) {
      this.#armChord(token);
      event.preventDefault();
      return { kind: "chord", buffer: [...this.#buffer] };
    }

    if (this.#buffer.length > 0) {
      // Any miss cancels the chord. `g` then `q` is not "wait for a third key";
      // it is a typo, and leaving the prefix armed means the *next* deliberate
      // keystroke does something surprising.
      const buffer = [...this.#buffer];
      this.#clearChord();
      return { kind: "chord-cancelled", buffer };
    }

    return IGNORED("no-match");
  }

  /* ------------------------------------------------------------ internals */

  /**
   * Walk the stack from the top.
   *
   * Stops at the first blocking scope — the modal — because a dialog that lets
   * `s` through to the list behind it changes a status the user cannot see. The
   * allowlist is what keeps `Cmd+K`, `Cmd+Enter` and `Escape` working from
   * inside one.
   */
  #resolve(
    candidate: readonly KeyToken[],
    token: KeyToken,
    typing: boolean,
  ): ResolvedBinding | null {
    const key = sequenceKey(candidate);

    for (let index = this.#layers.length - 1; index >= 0; index -= 1) {
      const layer = this.#layers[index];
      if (layer === undefined) continue;

      for (const binding of layer.bindings) {
        if (sequenceKey(binding.sequence) !== key) continue;
        if (typing && !binding.allowWhileTyping && !allowedWhileTyping(token)) {
          continue;
        }
        if (binding.when !== undefined && !binding.when()) continue;
        return binding;
      }

      if (isBlockingScope(layer.scope) && !MODAL_PASSTHROUGH.includes(token)) {
        return null;
      }
    }
    return null;
  }

  /** Is `prefix` actually the head of a chord somebody has registered? */
  #hasChordUnder(prefix: KeyToken): boolean {
    for (const layer of this.#layers) {
      for (const binding of layer.bindings) {
        if (binding.sequence.length > 1 && binding.sequence[0] === prefix) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Escape, one level per press.
   *
   * The ladder in `research/04-interaction.md` §1.11, compressed to the rungs
   * this app has: an armed chord first — because cancelling a half-typed chord
   * must not also close the dialog you are standing in — then the topmost rung
   * that claims it. Returns `null` when nothing claimed the key, so the caller
   * can fall through to ordinary resolution.
   */
  #runEscapeLadder(): DispatchOutcome | null {
    if (this.#buffer.length > 0) {
      const buffer = [...this.#buffer];
      this.#clearChord();
      return { kind: "chord-cancelled", buffer };
    }
    for (let index = this.#escape.length - 1; index >= 0; index -= 1) {
      const layer = this.#escape[index];
      if (layer === undefined) continue;
      if (layer.close()) return { kind: "escape", layer: layer.id };
    }
    return null;
  }

  #armChord(token: KeyToken): void {
    this.#buffer = [token];
    this.#notifyChord();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#clearChord();
    }, CHORD_TIMEOUT_MS);
  }

  #clearChord(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#buffer.length === 0) return;
    this.#buffer = [];
    this.#notifyChord();
  }

  #notifyChord(): void {
    const snapshot = [...this.#buffer];
    for (const listener of this.#chordListeners) listener(snapshot);
  }
}

/* =============================================================== helpers = */

function resolve(binding: BindingInput, scope: Scope): ResolvedBinding {
  const spec = shortcutById(binding.id);
  const keys = binding.keys ?? spec?.keys;
  if (keys === undefined) {
    throw new Error(
      `Binding "${binding.id}" has no keys and no registry entry. ` +
        `Add it to SHORTCUTS in registry.ts, or pass \`keys\` explicitly.`,
    );
  }
  return { ...binding, scope, sequence: parseSequence(keys) };
}

function isKeyboardEvent(event: Event): event is KeyboardEvent {
  // `instanceof KeyboardEvent` is wrong across realms (an iframe, a test that
  // constructs events from another window) and this check is not.
  return "key" in event && typeof (event as KeyboardEvent).key === "string";
}
