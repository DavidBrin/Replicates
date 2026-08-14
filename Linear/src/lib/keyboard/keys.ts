/**
 * Turning a `KeyboardEvent` into a token the registry can be looked up by.
 *
 * This is the least interesting-looking file in the keyboard slice and the one
 * that decides whether the whole thing works, because three of the four ways a
 * keyboard dispatcher goes wrong happen here rather than in the resolver:
 *
 * 1. **IME composition.** While a Japanese, Chinese or Korean user is composing
 *    a word, every keystroke is also delivered as a `keydown`. Without the
 *    guard, typing an issue title reassigns the issue (`a`), changes its status
 *    (`s`) and opens the label picker (`l`) as a side effect of writing a
 *    sentence. `research/04-interaction.md` §9.6 calls this "the #1 cause of
 *    'the app randomly reassigned my issue while I typed'", and the guard is
 *    unconditional: an event mid-composition never produces a token at all.
 *
 * 2. **`Shift` + digit is not a digit.** On a US layout `Shift+1` arrives as
 *    `event.key === "!"`. This app puts priority on `Shift+1..4` precisely
 *    because bare `1/2/3` are Triage actions (§1.8), so a normaliser that reads
 *    `event.key` binds priority to `!`, `@`, `#`, `$` — and to nothing at all on
 *    a German or French layout. Digits therefore come from `event.code`
 *    (`Digit1`), which is physical and layout-independent.
 *
 * 3. **`Shift` is sometimes the character and sometimes a modifier.** `?` *is*
 *    `Shift+/` on a US layout and an unshifted key elsewhere; `#` is `Shift+3`
 *    on US and `Alt+3` on a UK Mac. For punctuation the produced character is
 *    the identity and `shift` is dropped, so `?` is `?` everywhere. For letters
 *    the letter is the identity and `shift` is a real modifier, so `Shift+D` is
 *    `shift+d` — which is what keeps it distinct from `d`.
 *
 * The fourth failure mode — firing while a text field has focus — is
 * {@link isTypingTarget}, below.
 */

/**
 * A normalised key expression.
 *
 * Lower-case, modifiers first in a fixed order, joined by `+`:
 * `"s"`, `"shift+d"`, `"mod+k"`, `"alt+shift+arrowup"`, `"escape"`, `"?"`.
 *
 * `mod` is `Cmd` on Apple platforms and `Ctrl` everywhere else, collapsed into
 * one token deliberately: every binding in `research/04-interaction.md` §1 that
 * uses it is written `Cmd/Ctrl`, and keeping them apart would mean writing the
 * registry twice and testing neither half on the other platform.
 */
export type KeyToken = string;

/** A chord: one or more tokens pressed in sequence, e.g. `["g", "i"]`. */
export type KeySequence = readonly KeyToken[];

/**
 * Keys whose `event.key` is already a stable name rather than a character.
 *
 * Everything not listed falls through to `event.key.toLowerCase()`, which is
 * correct for `Home`, `End`, `PageUp`, `F1` and the rest — they are here only
 * where the name needs changing (`" "` is unreadable in a registry, and
 * `Del`/`Esc` are legacy spellings some browsers still emit).
 */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  " ": "space",
  spacebar: "space",
  esc: "escape",
  del: "delete",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

/** `Digit1` → `1`. Physical, so it survives every keyboard layout. */
const DIGIT_CODE = /^Digit([0-9])$/;

/**
 * Whether this platform's conventional modifier is `Cmd`.
 *
 * Read from the navigator, with a server-side answer of `true` for the same
 * reason `kbd.tsx` picks macOS on the server: the markup rendered during
 * hydration must match, and Apple is the majority for this product's audience.
 * Nothing in the *dispatcher* depends on the answer — `mod` collapses `meta`
 * and `ctrl` — so this only affects what the help overlay draws.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(`${platform} ${navigator.userAgent}`);
}

/** The bare modifier keys, which never produce a token of their own. */
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "altgraph"]);

/**
 * The event's key expression, or `null` when the event carries no key.
 *
 * Returns `null` — rather than a token nothing matches — in three cases, each
 * of which must not merely fail to match but must also **not clear an armed
 * chord**: a composition keystroke, a bare modifier press (holding `Shift`
 * while thinking about the second half of a chord is normal), and a key with no
 * `key` at all.
 */
export function normalizeKeyEvent(event: KeyboardEvent): KeyToken | null {
  // Unconditional, and first. `keyCode === 229` is the legacy signal some
  // browsers still send instead of `isComposing`; both mean "this keystroke
  // belongs to the input method, not to you".
  if (event.isComposing || event.keyCode === 229) return null;

  const raw = event.key;
  if (typeof raw !== "string" || raw === "") return null;
  if (MODIFIER_KEYS.has(raw.toLowerCase())) return null;

  const digit = DIGIT_CODE.exec(event.code ?? "");
  const named = NAMED_KEYS[raw] ?? NAMED_KEYS[raw.toLowerCase()];

  // A single character that is neither a letter nor a digit is punctuation, and
  // punctuation *is* its shifted form. `?`, `[`, `#` and `/` are all bindings in
  // this app and all of them would be unreachable if `shift` were prepended.
  const isPunctuation =
    named === undefined &&
    digit === null &&
    raw.length === 1 &&
    !/[a-z0-9]/i.test(raw);

  const base =
    digit !== null && event.shiftKey
      ? // Only when shifted: unshifted digits already arrive as "1", and reading
        // the code unconditionally would break the numeric keypad, whose codes
        // are `Numpad1` rather than `Digit1`.
        (digit[1] ?? raw)
      : (named ?? raw.toLowerCase());

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey && !isPunctuation) parts.push("shift");
  parts.push(base);
  return parts.join("+");
}

/**
 * Is the event aimed at something the user is typing into?
 *
 * Transcribed from `research/04-interaction.md` §1.11, including the
 * `data-no-shortcuts` opt-out — the escape hatch a third-party embed or a
 * code editor needs, and the reason this is an attribute lookup rather than a
 * tag-name check alone.
 *
 * `SELECT` is here with `INPUT` and `TEXTAREA` because a native select responds
 * to letter keys with type-ahead, and stealing `s` from it is the same bug in a
 * different costume.
 */
export function isTypingTarget(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return true;

  const target = event.target;
  if (target === null || !(target instanceof Element)) return false;

  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest("[data-no-shortcuts]") !== null;
}

/**
 * May this binding fire while a text field has focus?
 *
 * The policy, not a per-binding decision: modifier-bearing combinations and
 * `Escape` pass, everything else is suppressed. `Cmd+K` has to open the palette
 * from inside a comment box, and `Escape` has to get you out of the box — but
 * `s` must reach the box, or the app cannot be typed in.
 *
 * `Shift`-only bindings are deliberately **not** allowed through: `Shift+D` is
 * an uppercase D to a text field, and a due-date picker that opens when you
 * capitalise a word is the exact defect this policy exists to prevent.
 */
export function allowedWhileTyping(token: KeyToken): boolean {
  return token === "escape" || token.startsWith("mod+");
}

/**
 * Parse a registry key expression into a sequence.
 *
 * `"s"` → `[["s"]]`-ish: one token. `"g i"` and `"g then i"` → two, which is
 * the chord form. The `then` spelling exists so the registry can read the way
 * `research/04-interaction.md` writes it, and so `<Shortcut keys>` and the
 * dispatcher can be handed the *same string* — a chord that renders as two key
 * caps but dispatches as one combination would be a lie in the help overlay.
 */
export function parseSequence(keys: string): KeyToken[] {
  return keys
    .split(/\s+then\s+|\s+/i)
    .map((step) => step.trim().toLowerCase())
    .filter((step) => step !== "");
}

/** The lookup key for a sequence. Tokens are joined by a space, never by `+`. */
export function sequenceKey(sequence: KeySequence): string {
  return sequence.join(" ");
}
