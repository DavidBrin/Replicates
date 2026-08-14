import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useSyncExternalStore } from "react";

import {
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  nextThemePreference,
  readAppliedTheme,
  readStoredPreference,
  resolveTheme,
  setThemePreference,
  subscribeToThemeChange,
  type ThemePreference,
} from "@/lib/theme";

/**
 * The theme layer, including the toggle a user actually touches.
 *
 * The bootstrap script gets its own test because it is the one piece of this
 * module that never runs in the app's own JavaScript context — it is a string
 * inlined into the document, so nothing else would notice if it stopped
 * referring to the same storage key as the functions beside it.
 */

/**
 * A minimal toggle, standing in for the real settings control.
 *
 * `useSyncExternalStore` rather than state-plus-effect, because the preference
 * genuinely is external state: it lives in `localStorage` and changes from
 * anywhere. The server snapshot is `system`, which is what the markup renders
 * before the bootstrap script has run.
 */
function ThemeToggle() {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribeToThemeChange,
    readStoredPreference,
    () => "system",
  );

  useEffect(() => {
    applyTheme(readStoredPreference());
  }, []);

  return (
    <button
      type="button"
      onClick={() => setThemePreference(nextThemePreference(preference))}
    >
      {`Theme: ${preference}`}
    </button>
  );
}

/**
 * An in-memory `localStorage`.
 *
 * Not a convenience: this jsdom does not provide one. Node 22 exposes its own
 * `localStorage` global that refuses to work without `--localstorage-file`, and
 * it shadows jsdom's — so `window.localStorage` is `undefined` here and any
 * test that assumed otherwise fails on the *environment* rather than on the
 * code. The shim also gives the throwing case below something real to throw
 * from, which `Storage.prototype` cannot when `Storage` does not exist.
 */
const memoryStore = new Map<string, string>();
let storageMode: "ok" | "throw" = "ok";

const memoryStorage: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear: () => memoryStore.clear(),
  getItem: (key) => {
    if (storageMode === "throw") throw new Error("storage blocked");
    return memoryStore.get(key) ?? null;
  },
  key: (index) => Array.from(memoryStore.keys())[index] ?? null,
  removeItem: (key) => void memoryStore.delete(key),
  setItem: (key, value) => {
    if (storageMode === "throw") throw new Error("storage blocked");
    memoryStore.set(key, value);
  },
};

beforeAll(() => {
  // Both objects: vitest's jsdom environment copies window properties onto
  // globalThis rather than aliasing them, and the bootstrap script reads the
  // bare `localStorage` binding while the module reads `window.localStorage`.
  for (const target of [globalThis, window] as unknown as Record<string, unknown>[]) {
    Object.defineProperty(target, "localStorage", {
      value: memoryStorage,
      configurable: true,
      writable: true,
    });
  }
});

function mockSystemTheme(dark: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("theme", () => {
  beforeEach(() => {
    memoryStore.clear();
    storageMode = "ok";
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.documentElement.style.colorScheme = "";
    mockSystemTheme(false);
  });

  it("follows prefers-color-scheme when no preference is stored", () => {
    expect(readStoredPreference()).toBe("system");
    mockSystemTheme(true);
    expect(resolveTheme("system")).toBe("dark");
    mockSystemTheme(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("lets an explicit preference override the system", () => {
    mockSystemTheme(true);
    expect(resolveTheme("light")).toBe("light");
  });

  it("writes both data-theme and color-scheme", () => {
    // The attribute styles our surfaces; `color-scheme` is what tells the UA
    // how to paint form controls and the scrollbar gutter.
    applyTheme("light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(readAppliedTheme()).toBe("light");
  });

  it("persists a chosen preference and broadcasts it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToThemeChange(listener);

    setThemePreference("dark");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
    expect(listener).toHaveBeenCalledWith({
      preference: "dark",
      resolved: "dark",
    });
    unsubscribe();
  });

  it("cycles system → light → dark → system", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });

  it("rejects a junk value in storage rather than applying it", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "midnight");
    expect(isThemePreference("midnight")).toBe(false);
    expect(readStoredPreference()).toBe("system");
  });

  it("survives storage that throws", () => {
    // Safari's private mode and some enterprise cookie policies throw here
    // rather than returning null.
    storageMode = "throw";
    expect(readStoredPreference()).toBe("system");
    expect(() => setThemePreference("dark")).not.toThrow();
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("drives a toggle end to end", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Theme: system");

    await user.click(button);
    expect(button).toHaveTextContent("Theme: light");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");

    await user.click(button);
    expect(button).toHaveTextContent("Theme: dark");
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("keeps two toggles in agreement", async () => {
    // Two controls can show the theme at once. Without the broadcast, each
    // holds its own copy of the preference and they drift.
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );

    const [first, second] = screen.getAllByRole("button");
    await user.click(first!);
    expect(second).toHaveTextContent("Theme: light");
  });
});

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  beforeEach(() => {
    memoryStore.clear();
    storageMode = "ok";
    mockSystemTheme(false);
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  });

  it("applies the stored preference when evaluated", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    (0, eval)(THEME_BOOTSTRAP_SCRIPT);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });

  it("falls back to the system theme with nothing stored", () => {
    mockSystemTheme(true);
    (0, eval)(THEME_BOOTSTRAP_SCRIPT);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("is built from the same constants the module uses", () => {
    // The whole reason it is generated rather than hand-written: a script that
    // reads a stale key fails silently, starting every session on the default.
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(THEME_ATTRIBUTE));
    // Inlined into HTML — an unescaped closing tag would end the script early.
    expect(THEME_BOOTSTRAP_SCRIPT).not.toContain("</script");
  });

  it("still themes the page when storage throws", () => {
    // The fallback is dark rather than a rethrow: an exception would abort the
    // inline script and leave `<html>` with no attribute at all, which is the
    // white flash the script exists to prevent.
    storageMode = "throw";
    (0, eval)(THEME_BOOTSTRAP_SCRIPT);
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });
});
