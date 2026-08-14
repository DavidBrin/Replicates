/**
 * Theme preference: read, resolve, apply, persist.
 *
 * The app has two themes and three *preferences* — `light`, `dark`, and
 * `system`, which tracks `prefers-color-scheme`. Only the resolved value ever
 * reaches the DOM, as `data-theme="light" | "dark"` on `<html>`;
 * `src/app/globals.css` re-points its whole custom-property block off that one
 * attribute, so a theme change is a single attribute write and no re-render.
 *
 * ## Why an inline blocking script
 *
 * The preference lives in `localStorage`, which React cannot read during SSR.
 * A theme applied in `useEffect` lands *after* first paint, so a dark-theme
 * user sees a white flash on every cold navigation — the single most visible
 * defect a themed app can ship, and one Linear does not have: it inlines its
 * shell state before the bundle parses (`research/04-interaction.md` §8.2).
 *
 * {@link THEME_BOOTSTRAP_SCRIPT} is that script. It is assembled from the same
 * constants the runtime functions use, so the two cannot drift — a hand-written
 * copy in `layout.tsx` would, the first time the storage key changed.
 *
 * ## Why `color-scheme` is set as well
 *
 * The attribute styles our own surfaces. It does nothing for the parts of the
 * page the UA paints: form controls, the scrollbar gutter, and the canvas the
 * browser shows before any CSS applies. `color-scheme` is what tells the UA,
 * and setting it in the same statement keeps the two from disagreeing.
 */

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

/** What the user chose. `system` is a live subscription, not a snapshot. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What actually reaches `<html data-theme>`. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "linear:theme";
export const THEME_ATTRIBUTE = "data-theme";
export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/**
 * Broadcast on `window` after any preference change.
 *
 * Several controls can display the current theme at once (a settings row, a
 * sidebar menu item, a command-palette entry). Without an event, each holds its
 * own copy of the preference and they drift apart the moment one of them
 * changes it. `storage` events do not help — they fire in *other* tabs only.
 */
export const THEME_CHANGE_EVENT = "linear:themechange";

export interface ThemeChangeDetail {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * The stored preference, or `system` when absent or unreadable.
 *
 * `localStorage` access throws — not returns null — in Safari's private mode
 * and under some enterprise cookie policies. A theme lookup is not worth an
 * unhandled exception during render, so every access here is guarded.
 */
export function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** What `prefers-color-scheme` currently reports. Defaults to dark on the server. */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? getSystemTheme() : preference;
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

/** Persist a preference, apply it, and tell every other subscriber. */
export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Unwritable storage costs the user persistence across reloads, not the
    // theme change they just asked for. Carry on and apply it.
  }
  const resolved = applyTheme(preference);
  window.dispatchEvent(
    new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, {
      detail: { preference, resolved },
    }),
  );
  return resolved;
}

/** The preference the DOM is currently displaying, read back from `<html>`. */
export function readAppliedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === "light"
    ? "light"
    : "dark";
}

/**
 * Subscribe to OS-level theme changes.
 *
 * Only meaningful while the preference is `system`; callers are expected to
 * check. Returns an unsubscribe function. `addEventListener` on a MediaQueryList
 * is the modern form — the deprecated `addListener` fallback is kept because
 * jsdom's shim and older Safari only implement that one, and losing the
 * subscription silently is worse than the two extra lines.
 */
export function subscribeToSystemTheme(
  listener: (theme: ResolvedTheme) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(DARK_MEDIA_QUERY);
  const handler = (event: MediaQueryListEvent): void => {
    listener(event.matches ? "dark" : "light");
  };
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }
  query.addListener(handler);
  return () => query.removeListener(handler);
}

/** Subscribe to in-page preference changes made through {@link setThemePreference}. */
export function subscribeToThemeChange(
  listener: (detail: ThemeChangeDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event): void => {
    listener((event as CustomEvent<ThemeChangeDetail>).detail);
  };
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}

/** The next preference in the `system → light → dark` cycle. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? "system";
}

/**
 * The pre-paint bootstrap, as a source string for a blocking `<script>`.
 *
 * Deliberately dense: it is inlined into the document head and runs before the
 * first byte of CSS is applied, so every character is on the critical path.
 * Built from the exported constants rather than written out, because a script
 * that reads a stale storage key fails in the one way nothing tests — it just
 * silently starts every session on the default theme.
 *
 * The `catch` falls back to dark rather than rethrowing. An exception here
 * would abort the inline script *and* leave `<html>` with no attribute at all,
 * which is the flash this exists to prevent.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)}),p=(s==="light"||s==="dark"||s==="system")?s:"system",t=p==="system"?(window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches?"dark":"light"):p,e=document.documentElement;e.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t);e.style.colorScheme=t}catch(_){var f=document.documentElement;f.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},"dark");f.style.colorScheme="dark"}})()`;
