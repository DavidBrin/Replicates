"use client";

/**
 * The theme control: one button cycling system → light → dark.
 *
 * ## The preference is an external store, not component state
 *
 * It lives in `localStorage`, which the server cannot read, and it can be
 * changed from elsewhere — the command palette and the settings screen write
 * the same value. That is precisely the shape `useSyncExternalStore` exists
 * for: one subscription, one snapshot function, and a *separate server
 * snapshot* so the markup React sends matches the markup it hydrates.
 *
 * The alternative — `useState` seeded to a default and corrected in an effect —
 * reaches the same screen a frame later by way of a cascading render, and holds
 * a private copy that goes stale the moment another control writes the
 * preference. The same reasoning is spelled out in `components/ui/kbd.tsx` for
 * the platform modifier and in `popover.tsx` for client-only mounting.
 *
 * The theme's *visual* effect is already applied before any of this runs:
 * `lib/theme.ts` inlines a blocking script that stamps `data-theme` before
 * first paint. Only the button's label is React's problem.
 */

import { useSyncExternalStore } from "react";

import {
  nextThemePreference,
  readStoredPreference,
  setThemePreference,
  subscribeToThemeChange,
  type ThemePreference,
} from "@/lib/theme";

const LABELS: Readonly<Record<ThemePreference, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const GLYPHS: Readonly<Record<ThemePreference, string>> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

/** `subscribe`, adapted: the store notifies with a detail this hook ignores. */
function subscribe(onChange: () => void): () => void {
  return subscribeToThemeChange(() => onChange());
}

/** What the server renders. The client corrects it on its first render. */
const serverSnapshot = (): ThemePreference => "system";

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribe,
    readStoredPreference,
    serverSnapshot,
  );

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label={`Theme: ${LABELS[preference]}`}
      title={`Theme: ${LABELS[preference]}`}
      onClick={() => setThemePreference(nextThemePreference(preference))}
      className="flex size-7 items-center justify-center rounded-[var(--radius-md)] text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
    >
      <span aria-hidden="true">{GLYPHS[preference]}</span>
    </button>
  );
}
