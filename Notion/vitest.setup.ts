import "@testing-library/jest-dom/vitest";
// Gives the IndexedDB adapter a real implementation to run against in jsdom.
import "fake-indexeddb/auto";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------ next mocks -- */

/**
 * There is no App Router in jsdom. The mock is deliberately shared across
 * files rather than redefined per test, so a component that starts using a
 * new navigation hook fails loudly here instead of in one unlucky suite.
 */
export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = "/workspace";

export function setPathname(next: string): void {
  pathname = next;
}

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

/* ----------------------------------------------------------- dom shims --- */

// jsdom implements neither of these, and the theme provider and several
// layout components subscribe to them on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom has no layout engine, so these are no-ops rather than throwing.
Element.prototype.scrollIntoView ??= vi.fn();

/**
 * jsdom does not implement `contenteditable`, and its `isContentEditable`
 * getter is hard-wired to false. user-event reads that property to decide
 * whether an element can be typed into, so without this shim every editor
 * test silently types into the void.
 *
 * Reflecting the attribute is enough: user-event handles the text insertion
 * itself once it believes the element is editable.
 */
Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
  configurable: true,
  get(this: HTMLElement) {
    const value = this.getAttribute("contenteditable");
    return value === "" || value === "true" || value === "plaintext-only";
  },
});

// Used by the inline-mark shortcuts (Cmd-B and friends). jsdom has no
// implementation; the tests here assert on block structure, not on marks.
document.execCommand ??= vi.fn(() => false);

/**
 * jsdom has no layout engine, so `Range` is missing its geometry methods
 * entirely — calling them throws rather than returning an empty rect.
 *
 * That is worth shimming rather than working around: the editor measures the
 * caret to anchor the slash menu, and an exception there aborted the state
 * update that opens the menu. The symptom was a menu that simply never
 * appeared, with the real cause reported only as an unhandled error.
 *
 * A zero rect is the honest answer in a headless DOM, and the production code
 * already treats a 0×0 caret rect as "fall back to the element's own box".
 */
const emptyRect = (): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});

Range.prototype.getBoundingClientRect ??= emptyRect;
Range.prototype.getClientRects ??= () =>
  Object.assign([] as unknown as DOMRectList, { item: () => null });

if (!navigator.storage) {
  Object.defineProperty(navigator, "storage", {
    value: { persist: vi.fn().mockResolvedValue(false) },
    configurable: true,
  });
}
