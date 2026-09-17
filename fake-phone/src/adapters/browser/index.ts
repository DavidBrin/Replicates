/**
 * The small browser adapters: clock, settings persistence, haptics, wake lock.
 *
 * Each one is defensive to the point of paranoia, and deliberately so — this
 * app's whole job is to work at the moment someone feels unsafe. Every method
 * here either succeeds or degrades silently. None of them may throw, because a
 * thrown error anywhere in this file surfaces as a blank screen instead of a
 * ringing phone.
 */

import { parseSettings, type Settings } from "@/domain/settings";
import type { Clock, Fullscreen, Haptics, SettingsStore, WakeLock } from "@/ports";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** Injectable for tests: a clock you drive by hand. */
export class FixedClock implements Clock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
}

const STORAGE_KEY = "fake-phone.settings.v1";

/**
 * `localStorage`-backed settings.
 *
 * Reads are wrapped because Safari throws on `localStorage` access in Private
 * Browsing, and writes are wrapped because a contact photo stored as a data URL
 * can exceed the ~5MB quota. In both cases the app continues with in-memory
 * settings for the session rather than failing.
 */
export class LocalSettingsStore implements SettingsStore {
  private cache: Settings | null = null;

  load(): Settings {
    if (this.cache) return this.cache;
    let raw: unknown = null;
    try {
      const text = globalThis.localStorage?.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.cache = parseSettings(raw);
    return this.cache;
  }

  save(settings: Settings): void {
    this.cache = settings;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Quota exceeded or storage disabled. The in-memory cache above still
      // holds the change, so the current session behaves correctly and only
      // persistence is lost.
    }
  }

  clear(): void {
    this.cache = null;
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to do */
    }
  }
}

/** Settings that never persist — used during SSR and in tests. */
export class MemorySettingsStore implements SettingsStore {
  constructor(private settings: Settings = parseSettings(null)) {}
  load(): Settings {
    return this.settings;
  }
  save(settings: Settings): void {
    this.settings = settings;
  }
  clear(): void {
    this.settings = parseSettings(null);
  }
}

/**
 * Vibration.
 *
 * iOS Safari has never implemented `navigator.vibrate`, and there is no web
 * workaround — this is a no-op on the app's primary target platform, which is
 * exactly why it sits behind a port. Real haptics arrive only with a native
 * wrapper (`@capacitor/haptics`); see README "Known gaps".
 */
export class NavigatorHaptics implements Haptics {
  isSupported(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  buzz(pattern: number | number[]): void {
    if (!this.isSupported()) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* some engines throw on odd patterns; a missing buzz is not an error */
    }
  }

  cancel(): void {
    if (!this.isSupported()) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* ignored */
    }
  }
}

/**
 * Screen Wake Lock.
 *
 * Supported in Safari from 16.4, but broken *inside installed PWAs* until 18.4
 * — so this must be treated as best-effort even where the API exists. It is
 * also released by the browser whenever the tab is hidden, hence the
 * re-acquisition on `visibilitychange`.
 */
export class ScreenWakeLock implements WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private listening = false;

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  async request(): Promise<void> {
    if (!this.isSupported()) return;
    try {
      this.sentinel = await navigator.wakeLock.request("screen");
      if (!this.listening) {
        this.listening = true;
        document.addEventListener("visibilitychange", this.reacquire);
      }
    } catch {
      // Denied (low battery, unsupported in this context). The call screen
      // still works; the display may just dim.
    }
  }

  private reacquire = (): void => {
    if (document.visibilityState === "visible" && this.sentinel !== null) {
      void this.request();
    }
  };

  release(): void {
    document.removeEventListener("visibilitychange", this.reacquire);
    this.listening = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => {
      /* already released */
    });
  }
}

/**
 * Document fullscreen — hide the browser chrome over a live stream.
 *
 * This is best-effort and must never be confused with putting the `<video>`
 * itself into fullscreen. iOS takes a non-`playsinline` video into the native
 * player, which would replace the broadcast overlay with Apple's chrome and
 * kill the illusion (research/web-platform-constraints.md §5). We fullscreen
 * the *document* instead, with `navigationUI: "hide"`, so Android/desktop lose
 * the URL bar and iOS no-ops until the engine allows element fullscreen.
 *
 * Enter is kicked off synchronously from `request()` so it still sits inside
 * the tap's transient activation. Exit is allowed to be racy: a camera
 * permission sheet can reject the stream after fullscreen has already been
 * asked for, and we still have to land back on a page whose address bar is
 * reachable (the primer's "denied" copy tells the user to open site settings).
 */
export class DocumentFullscreen implements Fullscreen {
  private generation = 0;

  isSupported(): boolean {
    if (typeof document === "undefined") return false;
    const doc = document as FullscreenDocument;
    if (document.fullscreenEnabled || doc.webkitFullscreenEnabled) return true;
    return pickRequest(document.documentElement) !== null;
  }

  async request(): Promise<void> {
    if (!this.isSupported()) return;
    const generation = (this.generation += 1);
    try {
      await this.enterNow();
    } catch {
      return;
    }
    if (generation !== this.generation) {
      await this.leaveNow();
    }
  }

  exit(): void {
    this.generation += 1;
    void this.leaveNow();
  }

  private enterNow(): Promise<void> {
    if (currentFullscreenElement()) return Promise.resolve();
    const request = pickRequest(document.documentElement);
    if (!request) return Promise.resolve();
    try {
      return Promise.resolve(request({ navigationUI: "hide" })).catch(() =>
        enterWithoutOptions(request),
      );
    } catch {
      return enterWithoutOptions(request);
    }
  }

  private leaveNow(): Promise<void> {
    if (!currentFullscreenElement()) return Promise.resolve();
    const exit = pickExit();
    if (!exit) return Promise.resolve();
    try {
      return Promise.resolve(exit()).catch(() => {
        /* already left, or the engine refused */
      });
    } catch {
      return Promise.resolve();
    }
  }
}

type FullscreenDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void>;
  webkitExitFullScreen?: () => Promise<void>;
  webkitFullscreenElement?: Element | null;
};

type FullscreenDomElement = Element & {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullScreen?: (options?: FullscreenOptions) => Promise<void>;
};

type FullscreenRequest = (options?: FullscreenOptions) => Promise<void>;

function pickRequest(element: Element): FullscreenRequest | null {
  const node = element as FullscreenDomElement;
  if (typeof node.requestFullscreen === "function") {
    return (options) => (options ? node.requestFullscreen(options) : node.requestFullscreen());
  }
  if (typeof node.webkitRequestFullscreen === "function") {
    return (options) =>
      options ? node.webkitRequestFullscreen!(options) : node.webkitRequestFullscreen!();
  }
  if (typeof node.webkitRequestFullScreen === "function") {
    return (options) =>
      options ? node.webkitRequestFullScreen!(options) : node.webkitRequestFullScreen!();
  }
  return null;
}

function pickExit(): (() => Promise<void>) | null {
  const doc = document as FullscreenDocument;
  if (typeof document.exitFullscreen === "function") {
    return () => document.exitFullscreen();
  }
  if (typeof doc.webkitExitFullscreen === "function") {
    return () => doc.webkitExitFullscreen!();
  }
  if (typeof doc.webkitExitFullScreen === "function") {
    return () => doc.webkitExitFullScreen!();
  }
  return null;
}

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function enterWithoutOptions(request: FullscreenRequest): Promise<void> {
  try {
    return Promise.resolve(request()).catch(() => {
      /* denied, already in fullscreen, or the engine has no element fullscreen */
    });
  } catch {
    return Promise.resolve();
  }
}
