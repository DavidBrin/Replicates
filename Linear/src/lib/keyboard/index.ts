/**
 * The keyboard slice's public surface.
 *
 * Three layers, and callers should reach for the shallowest one that works:
 *
 * - `registry` — what the shortcuts *are*. Read by the `?` overlay and the
 *   command palette. Pure data, importable from the server.
 * - `dispatcher` — what happens when one is pressed. Framework-free.
 * - `provider` — the React binding. Client only.
 */

export {
  KeyboardDispatcher,
  CHORD_TIMEOUT_MS,
  type BindingInput,
  type DispatchContext,
  type DispatchOutcome,
  type EscapeLayer,
  type IgnoreReason,
  type ResolvedBinding,
} from "./dispatcher";

export {
  allowedWhileTyping,
  isApplePlatform,
  isTypingTarget,
  normalizeKeyEvent,
  parseSequence,
  sequenceKey,
  type KeySequence,
  type KeyToken,
} from "./keys";

export {
  CHORD_PREFIXES,
  MODAL_PASSTHROUGH,
  SCOPE_LEVEL,
  SCOPES,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  isBlockingScope,
  sequenceIndex,
  shortcutById,
  shortcutsInGroup,
  type Scope,
  type ShortcutGroup,
  type ShortcutSpec,
} from "./registry";

export {
  KeyboardProvider,
  useChordHint,
  useEscapeLayer,
  useKeyboard,
  useKeyboardScope,
  useShortcut,
  type KeyboardProviderProps,
} from "./provider";
