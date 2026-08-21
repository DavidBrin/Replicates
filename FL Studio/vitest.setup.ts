import "@testing-library/jest-dom/vitest";

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
 * Copied from the sibling `youtube` project's `vitest.setup.ts`.
 */
export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = "/";
let searchParams = new URLSearchParams();
let params: Record<string, string> = {};

export function setPathname(next: string): void {
  pathname = next;
}

export function setSearchParams(next: string | URLSearchParams): void {
  searchParams = typeof next === "string" ? new URLSearchParams(next) : next;
}

export function setRouteParams(next: Record<string, string>): void {
  params = next;
}

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => pathname,
  useSearchParams: () => searchParams,
  useParams: () => params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

/* ----------------------------------------------------------- dom shims --- */

// jsdom implements none of these.
if (typeof window !== "undefined" && !window.matchMedia) {
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

// jsdom has no layout engine, so these are no-ops rather than throws.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= (() => false) as never;
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
}
