"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Keyboard hint chips.
 *
 * Small, but not decorative: this app's entire premise is that the keyboard is
 * faster, and shortcut hints in menus and tooltips are how a user learns the
 * map without reading documentation. Linear leans on them everywhere — the
 * property pickers show ordinals, the context menu shows the shortcut for every
 * item, and the toast shows `⌘Z` on its Undo.
 *
 * ## Two components, on purpose
 *
 * {@link Kbd} is one cap and knows nothing. {@link Shortcut} parses a shortcut
 * *string* into caps — `"mod+z"`, `"Shift+3"`, `"G then I"` — and is the one
 * almost every caller wants, because the alternative is every call site
 * hand-splitting the same strings and disagreeing about whether the plus sign
 * is rendered.
 *
 * ## `mod`, and why it needs the client
 *
 * The shortcut map in `research/04-interaction.md` §1 is written against
 * `Cmd/Ctrl`. Which one a user actually presses is a platform fact the server
 * cannot know, and writing "Ctrl" everywhere is wrong for most of this
 * product's audience.
 *
 * So the platform is modelled as what it is — a value with one answer on the
 * server and another on the client — through `useSyncExternalStore`. The
 * server snapshot is macOS; React renders that during hydration and swaps in
 * the real one immediately after, so the markup matches and no
 * `suppressHydrationWarning` is needed. A `useState` + `useEffect` pair reaches
 * the same screen a frame later by way of a cascading render.
 */

/** `subscribe` for a value that cannot change. Module-scoped so it is stable. */
const neverChanges = (): (() => void) => () => {};

/** Symbols for the keys that have one. Anything else renders as typed. */
const KEY_SYMBOLS: Readonly<Record<string, string>> = {
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  ctrl: "⌃",
  control: "⌃",
  cmd: "⌘",
  meta: "⌘",
  command: "⌘",
  enter: "↵",
  return: "↵",
  escape: "Esc",
  esc: "Esc",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

export interface KbdProps {
  children: ReactNode;
  className?: string;
}

/**
 * A single key cap.
 *
 * Deliberately not a bordered box. Linear's shortcut hints are flat tinted
 * chips at the mini size — a 3D-looking key cap with a border and a shadow is
 * an instant tell that a design system was assembled from a generic component
 * library rather than measured.
 */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.25em] items-center justify-center rounded-sm px-1",
        "bg-[var(--bg-translucent)] text-tertiary text-micro",
        "[font-family:inherit] [font-weight:var(--weight-medium)] leading-[1.4]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ?? navigator.platform;
  return /mac|iphone|ipad|ipod/i.test(`${platform} ${navigator.userAgent}`);
}

function capFor(token: string, apple: boolean): string {
  const key = token.toLowerCase();
  if (key === "mod") return apple ? "⌘" : "Ctrl";
  if (!apple && (key === "alt" || key === "option")) return "Alt";
  return KEY_SYMBOLS[key] ?? (token.length === 1 ? token.toUpperCase() : token);
}

export interface ShortcutProps {
  /**
   * A shortcut expression.
   *
   * `+` joins simultaneous keys (`"mod+shift+z"`), whitespace or the literal
   * word `then` marks a chord sequence (`"G then I"`) — which is a real
   * distinction in this app's keymap, where `M` is a prefix and never a bare
   * action.
   *
   * Use `mod` rather than `cmd` or `ctrl` for the platform-conventional
   * modifier.
   */
  keys: string;
  className?: string;
}

export function Shortcut({ keys, className }: ShortcutProps) {
  const apple = useSyncExternalStore(neverChanges, isApplePlatform, () => true);

  const sequence = keys
    .split(/\s+then\s+|\s+/i)
    .map((step) => step.trim())
    .filter(Boolean);

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {/* The caps are visual shorthand. A screen reader should hear the
          expression as it would be spoken — "Command Z" — not "⌘ Z", and
          `aria-label` on a role-less span is ignored by most of them, so the
          spoken form is real text and the caps are hidden. */}
      <span className="sr-only">
        {keys.replace(/\bmod\b/gi, apple ? "Command" : "Control")}
      </span>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {sequence.map((step, stepIndex) => (
          <span
            key={`${step}-${stepIndex}`}
            className="inline-flex items-center gap-px"
          >
            {step.split("+").map((token, tokenIndex) => (
              <Kbd key={`${token}-${tokenIndex}`}>{capFor(token, apple)}</Kbd>
            ))}
          </span>
        ))}
      </span>
    </span>
  );
}
