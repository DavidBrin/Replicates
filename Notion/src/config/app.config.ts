/**
 * Single source of truth for every tunable in the product.
 *
 * Components must read from here rather than inlining literals, so that
 * layout, branding and behaviour can be retargeted without touching UI code.
 * Anything an operator might reasonably want to change at deploy time is
 * additionally overridable through `NEXT_PUBLIC_*` environment variables.
 */

/** Reads a public env var, falling back when unset or empty. */
function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
}

function envInt(key: string, fallback: number): number {
  const parsed = Number.parseInt(env(key, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const brand = {
  /** Product name shown in the nav, page titles and metadata. */
  name: env("NEXT_PUBLIC_BRAND_NAME", "Notion"),
  tagline: env(
    "NEXT_PUBLIC_BRAND_TAGLINE",
    "The AI workspace that works for you.",
  ),
  description: env(
    "NEXT_PUBLIC_BRAND_DESCRIPTION",
    "One place where teams find every answer, automate the busywork, and get projects done.",
  ),
} as const;

export const routes = {
  home: "/",
  pricing: "/pricing",
  workspace: "/workspace",
  page: (pageId: string) => `/workspace/${pageId}`,
} as const;

/** Layout geometry, in pixels, matching Notion's own measurements. */
export const layout = {
  sidebar: {
    defaultWidth: envInt("NEXT_PUBLIC_SIDEBAR_WIDTH", 240),
    minWidth: 180,
    maxWidth: 480,
    /** Drag within this many px of the min width to snap the sidebar closed. */
    collapseThreshold: 150,
    /** Hovering this close to the left edge peeks a collapsed sidebar open. */
    peekTriggerWidth: 16,
  },
  topBar: {
    height: 45,
  },
  page: {
    /** Notion's default text column. "Full width" pages relax this. */
    contentWidth: envInt("NEXT_PUBLIC_PAGE_CONTENT_WIDTH", 708),
    fullWidthPadding: 96,
    horizontalPadding: 96,
    coverHeight: 30, // vh
    iconSize: 78,
    /** How far the page icon overlaps the bottom edge of the cover. */
    iconCoverOverlap: 46,
  },
  board: {
    columnWidth: envInt("NEXT_PUBLIC_BOARD_COLUMN_WIDTH", 260),
    columnGap: 8,
    cardGap: 8,
  },
  table: {
    minColumnWidth: 80,
    defaultColumnWidth: 200,
    titleColumnWidth: 280,
    rowHeight: 33,
  },
  marketing: {
    maxWidth: 1252,
    gutter: 24,
  },
} as const;

/** Interaction timings. */
export const timing = {
  /** Debounce before a document edit is flushed to the storage adapter. */
  persistDebounceMs: envInt("NEXT_PUBLIC_PERSIST_DEBOUNCE_MS", 400),
  tooltipDelayMs: 400,
  sidebarPeekDelayMs: 200,
  toastDurationMs: 4000,
} as const;

/** Feature flags — every one is safe to flip without code changes. */
export const features = {
  /** Persist to the browser so a refresh keeps your work. */
  persistence: env("NEXT_PUBLIC_ENABLE_PERSISTENCE", "true") === "true",
  /** Show the "Publish to web" tab in the share popover. */
  publishToWeb: env("NEXT_PUBLIC_ENABLE_PUBLISH", "true") === "true",
  /** Enable the command palette (Cmd-K). */
  commandPalette: env("NEXT_PUBLIC_ENABLE_COMMAND_PALETTE", "true") === "true",
} as const;

/** The simulated, non-persistent demo login. */
export const demoAuth = {
  /** Master switch — off restores today's behaviour exactly. */
  enabled: env("NEXT_PUBLIC_ENABLE_DEMO_LOGIN", "true") === "true",
  /** Where "contact David" points. Set this before shipping. */
  contactHref: env("NEXT_PUBLIC_DEMO_CONTACT_HREF", routes.home),
  maxNameLength: 32,
} as const;

/**
 * Which storage backend to use.
 * `indexeddb` — the zero-configuration default, so a bare `vercel deploy`
 *               with no environment variables just works. Chosen over
 *               localStorage for capacity and for not blocking the main
 *               thread on save.
 * `local`     — localStorage; simpler, but capped near 5 MiB.
 * `memory`    — in-memory only; used by tests and server rendering.
 * `rest`      — talks to `NEXT_PUBLIC_STORAGE_API_URL`; swap in a real
 *               database without touching any component.
 */
export type StorageDriver = "indexeddb" | "local" | "memory" | "rest";

export const storage = {
  driver: env("NEXT_PUBLIC_STORAGE_DRIVER", "indexeddb") as StorageDriver,
  /** Namespaced so several deployments can share an origin safely. */
  key: env("NEXT_PUBLIC_STORAGE_KEY", "notion-clone:workspace:v1"),
  apiUrl: env("NEXT_PUBLIC_STORAGE_API_URL", "/api/workspace"),
  /** Bump to invalidate persisted state after a breaking schema change. */
  schemaVersion: envInt("NEXT_PUBLIC_STORAGE_SCHEMA_VERSION", 1),
} as const;

export const keyboard = {
  commandPalette: "k",
  toggleSidebar: "\\",
  toggleTheme: "l",
} as const;

export const appConfig = {
  brand,
  routes,
  layout,
  timing,
  features,
  storage,
  keyboard,
  demoAuth,
} as const;

export type AppConfig = typeof appConfig;
