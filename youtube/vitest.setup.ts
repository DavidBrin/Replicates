import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------ next mocks -- */

/**
 * There is no App Router in jsdom. The mock is deliberately shared across files
 * rather than redefined per test, so a component that starts using a new
 * navigation hook fails loudly here instead of in one unlucky suite.
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

// jsdom implements none of these, and the app shell subscribes to them on
// mount. Guarded on `typeof window` because some suites opt into the plain Node
// environment via a `// @vitest-environment node` pragma — this setup file
// still runs for them.
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

/* --------------------------------------------------------- media shims --- */

/**
 * jsdom's `HTMLMediaElement` is a stub: `play()` throws "Not implemented",
 * `duration` is `NaN`, and `buffered` does not exist at all. The player's unit
 * tests are about the buffer controller and the ABR selector rather than about
 * the browser's decoder, so the element is given just enough behaviour to be
 * driven — and `play()` resolves rather than throwing, because a rejected
 * autoplay promise is a real state the player handles and an unimplemented
 * method is not.
 *
 * Anything that genuinely needs a decoder is asserted in Playwright instead.
 * This shim exists so that a unit test which stalls the buffer can watch the
 * controller react, not so that video can be played in Node.
 */
if (typeof window !== "undefined" && typeof HTMLMediaElement !== "undefined") {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    writable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}

/**
 * `MediaSource` and WebCodecs are absent from jsdom entirely, and both are
 * feature-detected by the code under test. Leaving them undefined is the
 * honest default: the detection branches are themselves worth testing, and a
 * suite that needs the capable branch installs its own fake rather than
 * inheriting a global one whose fidelity nobody has checked.
 *
 * The one thing declared here is the shape of that opt-in, so every suite
 * fakes it the same way.
 */
export function stubMediaCapabilities(overrides: {
  mediaSource?: unknown;
  videoEncoder?: unknown;
  videoDecoder?: unknown;
}): () => void {
  const g = globalThis as Record<string, unknown>;
  const saved = {
    MediaSource: g.MediaSource,
    VideoEncoder: g.VideoEncoder,
    VideoDecoder: g.VideoDecoder,
  };
  if (overrides.mediaSource !== undefined) g.MediaSource = overrides.mediaSource;
  if (overrides.videoEncoder !== undefined)
    g.VideoEncoder = overrides.videoEncoder;
  if (overrides.videoDecoder !== undefined)
    g.VideoDecoder = overrides.videoDecoder;

  return () => {
    g.MediaSource = saved.MediaSource;
    g.VideoEncoder = saved.VideoEncoder;
    g.VideoDecoder = saved.VideoDecoder;
  };
}
