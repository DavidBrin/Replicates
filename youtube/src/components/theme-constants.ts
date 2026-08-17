/**
 * The theme's server-safe constants.
 *
 * These live outside `theme.tsx` for one reason: that file carries a
 * `"use client"` directive, and Next turns **every** export of a client module
 * into a client *reference* — including plain strings. The root layout is a
 * server component and spreads the attribute name onto `<html>`, which threw
 * on every render:
 *
 *   Attempted to call THEME_ATTRIBUTE() from the server but THEME_ATTRIBUTE is
 *   on the client.
 *
 * The name reads like a value and behaves like a function once it crosses that
 * boundary, which is why the message is so confusing. A constant both sides
 * need has to live in a module that belongs to neither.
 *
 * `theme.tsx` imports these back and re-exports them, so nothing that already
 * reads them from there had to change.
 *
 * ## Why `color-scheme` is set alongside the attribute
 *
 * The attribute styles our own surfaces. It does nothing for the parts the user
 * agent paints — form controls, the scrollbar gutter, and the canvas shown
 * before any CSS applies. `color-scheme` is what tells the browser, and setting
 * both in one statement keeps them from disagreeing.
 */

export const THEME_PREFERENCES = ["device", "dark", "light"] as const;

/** What the user chose. `device` is a live subscription, not a snapshot. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** What actually reaches `<html data-theme>`. */
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "yt:appearance";
export const THEME_ATTRIBUTE = "data-theme";
export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * Runs before first paint, so the page never renders light and then flips.
 *
 * Inlined into the document rather than imported, because a module would load
 * after the very paint it exists to prevent. Written defensively: reading
 * `localStorage` throws outright in Safari's private browsing, and a theme
 * preference must never be able to stop the document rendering — so the catch
 * falls back to dark rather than to nothing.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)}),p=(s==="light"||s==="dark"||s==="device")?s:"device",t=p==="device"?(window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches?"dark":"light"):p,e=document.documentElement;e.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t);e.style.colorScheme=t}catch(_){var f=document.documentElement;f.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},"dark");f.style.colorScheme="dark"}})()`;
