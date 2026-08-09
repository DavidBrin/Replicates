"use client";

/**
 * Theme.
 *
 * The chosen theme is stamped on `<html data-theme>` by an inline script that
 * runs before React hydrates (see `ThemeScript`), which is what prevents the
 * white flash a dark-mode user would otherwise see on every page load. React
 * then reads that value back rather than deciding it during render.
 *
 * The preference lives in an external store read through `useSyncExternalStore`
 * rather than in `useState` seeded by an effect. Both would work, but the
 * external-store form is the one React is designed around for
 * server/client-divergent values: it takes an explicit server snapshot, so
 * there is no hydration mismatch and no cascading re-render on mount.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "notion-clone:theme";
const DEFAULT_PREFERENCE: ThemePreference = "system";

/* --------------------------------------------------- preference store ---- */

const listeners = new Set<() => void>();
let cached: ThemePreference | null = null;

function readStoredPreference(): ThemePreference {
  if (cached !== null) return cached;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    cached =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : DEFAULT_PREFERENCE;
  } catch {
    // Storage can be unavailable (private mode). The theme still works for
    // this session; it just will not be remembered.
    cached = DEFAULT_PREFERENCE;
  }
  return cached;
}

function writeStoredPreference(next: ThemePreference): void {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // See above — a failed write is not worth surfacing.
  }
  listeners.forEach((listener) => listener());
}

function subscribeToPreference(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing the theme should update this one.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The server has no storage, so it always renders the default. */
const serverPreference = () => DEFAULT_PREFERENCE;

/* ------------------------------------------------------------ context ---- */

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Runs before paint. Kept as a string so it can be inlined in <head> — it
 * must execute ahead of hydration, which rules out a React effect.
 */
export function ThemeScript() {
  const script = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var pref = stored || "system";
    var dark = pref === "dark" ||
      (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();`.trim();

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(
    subscribeToPreference,
    readStoredPreference,
    serverPreference,
  );

  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  // Applying the theme is a write to an external system (the DOM attribute),
  // which is exactly what an effect is for. `setResolved` here is a callback
  // from the media-query subscription, not a synchronous render cascade.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = () => {
      const dark = preference === "dark" || (preference === "system" && media.matches);
      const next: ResolvedTheme = dark ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      setResolved(next);
    };

    apply();
    // Only follow the OS while the user has not made an explicit choice.
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  // Already a stable module-level function; wrapping it in useCallback would
  // add indirection without changing its identity.
  const setPreference = writeStoredPreference;

  const toggle = useCallback(() => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    writeStoredPreference(isDark ? "light" : "dark");
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside a ThemeProvider");
  return context;
}
