import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentFullscreen } from "@/adapters/browser";

/**
 * These tests exist for two properties:
 *
 *   1. `requestFullscreen` is invoked in the *same turn* as `request()`, so a
 *      click handler that calls it still has transient activation.
 *   2. An `exit()` that races the enter still leaves the document *not*
 *      fullscreen — otherwise a denied camera would hide the address bar the
 *      primer tells the user to open.
 */

let fullscreenElement: Element | null;
let enterGate: Promise<void>;
let releaseEnter: () => void;

const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>();
const exitFullscreen = vi.fn<() => Promise<void>>();

function openEnterGate(): void {
  enterGate = new Promise((resolve) => {
    releaseEnter = resolve;
  });
}

beforeEach(() => {
  fullscreenElement = null;
  enterGate = Promise.resolve();
  releaseEnter = () => {};

  requestFullscreen.mockReset();
  requestFullscreen.mockImplementation(async (options) => {
    void options;
    await enterGate;
    fullscreenElement = document.documentElement;
  });

  exitFullscreen.mockReset();
  exitFullscreen.mockImplementation(async () => {
    fullscreenElement = null;
  });

  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });
  document.documentElement.requestFullscreen = requestFullscreen;
  document.exitFullscreen = exitFullscreen;
});

afterEach(() => {
  Reflect.deleteProperty(document, "fullscreenEnabled");
  Reflect.deleteProperty(document, "fullscreenElement");
  // Restore jsdom's missing implementations rather than leaving spies on the
  // prototype for the next file.
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  Reflect.deleteProperty(document, "exitFullscreen");
});

describe("DocumentFullscreen", () => {
  it("calls requestFullscreen in the same turn, with chrome hidden", () => {
    const fullscreen = new DocumentFullscreen();
    void fullscreen.request();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  it("retries without options when the engine rejects navigationUI", async () => {
    requestFullscreen.mockImplementationOnce(async () => {
      throw new TypeError("unknown option");
    });
    requestFullscreen.mockImplementationOnce(async () => {
      fullscreenElement = document.documentElement;
    });

    const fullscreen = new DocumentFullscreen();
    await fullscreen.request();

    expect(requestFullscreen).toHaveBeenCalledTimes(2);
    expect(requestFullscreen).toHaveBeenNthCalledWith(1, { navigationUI: "hide" });
    expect(requestFullscreen).toHaveBeenNthCalledWith(2);
    expect(fullscreenElement).toBe(document.documentElement);
  });

  it("leaves again if exit races the enter animation", async () => {
    openEnterGate();
    const fullscreen = new DocumentFullscreen();
    const pending = fullscreen.request();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement).toBeNull();

    fullscreen.exit();
    releaseEnter();
    await pending;

    expect(exitFullscreen).toHaveBeenCalled();
    expect(fullscreenElement).toBeNull();
  });

  it("is a no-op when the API is missing, and never throws", async () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");

    const fullscreen = new DocumentFullscreen();
    expect(fullscreen.isSupported()).toBe(false);
    await expect(fullscreen.request()).resolves.toBeUndefined();
    expect(() => fullscreen.exit()).not.toThrow();
  });
});
