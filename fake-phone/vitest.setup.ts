import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------ next mocks -- */

export const routerMock = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

let pathname = "/";

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

// jsdom implements none of the platform surfaces this app is built on. Each
// shim below exists because a unit test would otherwise fail on a missing
// browser API rather than on the behaviour under test. The *adapters* that wrap
// these APIs are what production code depends on (see `src/ports/`), so these
// shims only need to be inert, not faithful.

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

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView ??= vi.fn();
}

// jsdom has no media pipeline: HTMLMediaElement.play() throws "Not implemented".
if (typeof window !== "undefined" && typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
}
