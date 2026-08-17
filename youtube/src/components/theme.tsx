"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme preference: read, resolve, apply, persist.
 *
 * There are two themes and three *preferences*. YouTube's own account menu
 * spells them out — the row renders as `Appearance: Device theme` and its
 * submenu offers Device / Dark / Light (`research/09-…` §10) — so "device" is
 * the product's word for tracking `prefers-color-scheme`, and it is the word
 * used here rather than "system".
 *
 * Only the *resolved* value reaches the DOM, as `data-theme="light"` on
 * `<html>`. Dark is the default and lives on `:root` in `globals.css`, so the
 * dark theme needs no attribute at all and the light one is a single attribute
 * write that re-points the whole token block. No component re-renders on a
 * theme change; the CSS does the work.
 *
 * ## Why an inline blocking script
 *
 * The preference lives in `localStorage`, which the server cannot read. A
 * theme applied from `useEffect` lands *after* first paint, so a dark-theme
 * user gets a white flash on every cold navigation — on a video site, where
 * the whole point of the dark theme is not being flashbanged, that is the
 * single most visible defect this file can ship.
 *
 * {@link THEME_BOOTSTRAP_SCRIPT} is assembled from the same constants the
 * runtime uses, because a hand-copied duplicate in `layout.tsx` would drift
 * the first time the storage key changed — and it would fail silently, by
 * starting every session on the default.
 *
 * ## Why `color-scheme` is set too
 *
 * The attribute styles our own surfaces. It does nothing for the parts the UA
 * paints: form controls, the scrollbar gutter, and the canvas shown before any
 * CSS applies. `color-scheme` is what tells the browser, and setting both in
 * one statement keeps them from disagreeing.
 */

/**
 * The constants now live in `./theme-constants`, a module with no `"use
 * client"` directive, and are re-exported here so every existing importer is
 * unaffected.
 *
 * They had to move. Next turns *every* export of a client module into a client
 * reference, including a plain string, so the server-rendered root layout
 * spreading `THEME_ATTRIBUTE` onto `<html>` threw "Attempted to call
 * THEME_ATTRIBUTE() from the server" on every render. `src/app/layout.tsx`
 * imports them from the plain module directly; the re-exports below are for
 * client callers and for tests, which do not cross that boundary at all.
 */
export {
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  THEME_ATTRIBUTE,
  DARK_MEDIA_QUERY,
  THEME_BOOTSTRAP_SCRIPT,
  isThemePreference,
  type ThemePreference,
  type ResolvedTheme,
} from "./theme-constants";

/**
 * Imported as well as re-exported, and the distinction is not redundancy:
 * `export … from` forwards a name without binding it in this module's scope.
 * The re-export above serves importers; this import serves the code below,
 * which reads the attribute and the media query directly.
 */
import {
  DARK_MEDIA_QUERY,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  isThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme-constants";

/** The labels YouTube's own Appearance submenu uses, verbatim (R9 §10). */
export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  device: "Device theme",
  dark: "Dark theme",
  light: "Light theme",
};

/**
 * The stored preference, or `device` when absent or unreadable.
 *
 * `localStorage` *throws* rather than returning null in Safari's private mode
 * and under some enterprise cookie policies. A theme lookup is not worth an
 * unhandled exception during render, so every access is guarded.
 */
export function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "device";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "device";
  } catch {
    return "device";
  }
}

/** What `prefers-color-scheme` reports. Dark on the server, because dark is the default. */
export function getDeviceTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "device" ? getDeviceTheme() : preference;
}

/** Write the resolved theme to `<html>` without touching storage. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute(THEME_ATTRIBUTE, resolved);
    root.style.colorScheme = resolved;
  }
  return resolved;
}

/** The theme the DOM is currently displaying, read back off `<html>`. */
export function readAppliedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === "light"
    ? "light"
    : "dark";
}

/* ------------------------------------------------------------- context --- */

export interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The provider.
 *
 * State starts at the *default* rather than at the stored value, and is
 * corrected in an effect. That is not laziness: reading `localStorage` during
 * render makes the first client render disagree with the server's HTML, and
 * React discards the whole subtree on a hydration mismatch. The visible theme
 * is already correct at this point — the bootstrap script set it before paint
 * — so the effect is only catching the React state up with the DOM.
 */
export function ThemeProvider({
  children,
  /** Test seam. Production always starts from storage. */
  initialPreference,
}: {
  children: ReactNode;
  initialPreference?: ThemePreference;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    initialPreference ?? "device",
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    initialPreference ? resolveTheme(initialPreference) : "dark",
  );

  useEffect(() => {
    if (initialPreference) return;
    const stored = readStoredPreference();
    setPreferenceState(stored);
    setResolved(applyTheme(stored));
  }, [initialPreference]);

  // Only meaningful while the preference is `device`; the guard is what makes
  // an explicit choice stick when the OS flips at sunset.
  useEffect(() => {
    if (preference !== "device") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(DARK_MEDIA_QUERY);
    const handler = (): void => setResolved(applyTheme("device"));
    // `addEventListener` is the modern form; the deprecated `addListener` is
    // kept because jsdom's shim and older Safari implement only that one, and
    // losing the subscription silently is worse than four lines.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      return () => query.removeEventListener("change", handler);
    }
    query.addListener(handler);
    return () => query.removeListener(handler);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setResolved(applyTheme(next));
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Unwritable storage costs persistence across reloads, not the change
      // the user just asked for. Carry on.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the theme.
 *
 * Throws outside a provider rather than returning a default. A component that
 * silently gets "dark" when it is mounted outside the tree is a bug that only
 * shows up as a wrong colour in one route, which is exactly the kind of thing
 * nobody traces back to a missing provider.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}

/**
 * The dark/light switch.
 *
 * A two-state toggle over three preferences: pressing it commits an explicit
 * `dark` or `light` and leaves `device` behind, which is the honest behaviour
 * for a one-button control — a three-way cycle through an invisible middle
 * state gives the user no way to tell which of the two identical-looking modes
 * they are in. The full three-way choice belongs in the account menu, where
 * YouTube puts it and where the labels can be shown.
 *
 * `aria-pressed` reflects "dark is on"; the accessible name states the action
 * the press will perform, per §7.3 of `research/07-captions-and-a11y.md`.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const next: ResolvedTheme = resolved === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={className}
      aria-pressed={resolved === "dark"}
      aria-label={
        next === "light" ? "Use the light theme" : "Use the dark theme"
      }
      onClick={() => setPreference(next)}
    >
      {/* The two moon/sun glyphs are drawn inline rather than added to the icon
          set: YouTube has no theme toggle in its masthead, so there is no
          measured glyph to match and nothing else in the app will reuse them. */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        {resolved === "dark" ? (
          <path d="M12 3a9 9 0 1 0 9 9 1 1 0 0 0-1.42-.9A6.5 6.5 0 0 1 12.9 3.42 1 1 0 0 0 12 3Zm-1.6 2.32a8.5 8.5 0 0 0 8.28 8.28A7 7 0 1 1 10.4 5.32Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4.4" />
            <path d="M12 1.5a1 1 0 0 1 1 1V4a1 1 0 1 1-2 0V2.5a1 1 0 0 1 1-1Zm0 17a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V19.5a1 1 0 0 1 1-1ZM1.5 12a1 1 0 0 1 1-1H4a1 1 0 1 1 0 2H2.5a1 1 0 0 1-1-1Zm17.5 0a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H20a1 1 0 0 1-1-1ZM4.57 4.57a1 1 0 0 1 1.42 0l1.06 1.06a1 1 0 0 1-1.42 1.42L4.57 5.99a1 1 0 0 1 0-1.42Zm12.38 12.38a1 1 0 0 1 1.42 0l1.06 1.06a1 1 0 0 1-1.42 1.42l-1.06-1.06a1 1 0 0 1 0-1.42Zm2.48-12.38a1 1 0 0 1 0 1.42l-1.06 1.06a1 1 0 0 1-1.42-1.42l1.06-1.06a1 1 0 0 1 1.42 0ZM7.05 16.95a1 1 0 0 1 0 1.42L5.99 19.43a1 1 0 0 1-1.42-1.42l1.06-1.06a1 1 0 0 1 1.42 0Z" />
          </>
        )}
      </svg>
    </button>
  );
}
