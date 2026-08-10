import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRingtonePlayer } from "@/adapters/audio/element-ringtone";

/**
 * These tests assert the *shape* of the mitigation, not that sound comes out —
 * jsdom has no media pipeline, and the silent-switch behaviour this adapter
 * exists for is only observable on a real handset
 * (research/web-platform-constraints.md §3 is explicit that it cannot be
 * verified in a simulator). What they can protect is the part that would
 * silently regress in a refactor: that playback goes through an `<audio>`
 * element at all, that unlock is idempotent, and that nothing throws.
 */

/** Every audio element this test file caused to be created, in order. */
let created: HTMLAudioElement[] = [];
let originalCreateElement: typeof document.createElement;

beforeEach(() => {
  created = [];
  originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tag, options);
    if (tag === "audio") created.push(element as HTMLAudioElement);
    return element;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "audioSession");
});

const bySrc = (needle: string): HTMLAudioElement | undefined =>
  created.find((element) => element.src.includes(needle));

describe("element ringtone player", () => {
  it("plays the ringtone through an HTMLAudioElement, looping and preloaded", async () => {
    // The whole point: Web Audio is muted by the iOS ringer switch, an <audio>
    // element is not (§3). If this ever becomes an AudioContext, most users
    // hear nothing.
    const player = createRingtonePlayer();
    await player.unlock();

    const ringtone = bySrc("/audio/ringtone.wav");
    expect(ringtone).toBeInstanceOf(HTMLAudioElement);
    expect(ringtone?.loop).toBe(true);
    expect(ringtone?.preload).toBe("auto");
    expect(ringtone?.getAttribute("playsinline")).toBe("");

    await player.startRinging();
    expect(ringtone?.play).toHaveBeenCalled();
    player.dispose();
  });

  it("claims playback rights on unlock and is idempotent", async () => {
    // Called on every plausible gesture, because we cannot know which tap is
    // the last one before a deferred ring (§1).
    const player = createRingtonePlayer();
    await player.unlock();
    const callsAfterFirst = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;

    await player.unlock();
    await player.unlock();

    expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length).toBe(callsAfterFirst);
    // Three elements pre-armed: ringtone plus both cues.
    expect(created).toHaveLength(3);
    // Muting is restored, or the ring after the unlock would be silent.
    expect(created.every((element) => element.muted === false)).toBe(true);
    player.dispose();
  });

  it("declares a playback audio session where Safari supports it", async () => {
    const audioSession = { type: "ambient" };
    Object.defineProperty(navigator, "audioSession", {
      value: audioSession,
      configurable: true,
      writable: true,
    });

    const player = createRingtonePlayer();
    await player.unlock();

    expect(audioSession.type).toBe("playback");
    player.dispose();
  });

  it("does not throw when the AudioSession API is absent", async () => {
    expect("audioSession" in navigator).toBe(false);
    const player = createRingtonePlayer();
    await expect(player.unlock()).resolves.toBeUndefined();
    player.dispose();
  });

  it("resolves quietly when autoplay is blocked", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      new DOMException("NotAllowedError"),
    );
    const player = createRingtonePlayer();

    // A rejected play() means we are outside transient activation. The caller
    // has a tap-to-ring fallback; an unhandled rejection here would instead
    // break the answer flow.
    await expect(player.unlock()).resolves.toBeUndefined();
    await expect(player.startRinging()).resolves.toBeUndefined();
    expect(() => player.playCue("connect")).not.toThrow();

    player.dispose();
    vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValue(undefined);
  });

  it("stops ringing without throwing, before or after a ring", () => {
    const player = createRingtonePlayer();
    expect(() => player.stopRinging()).not.toThrow();
    player.dispose();
  });

  it("uses separate elements for cues so the ringtone keeps its unlocked state", async () => {
    const player = createRingtonePlayer();
    await player.unlock();

    player.playCue("connect");
    player.playCue("disconnect");

    const ringtone = bySrc("/audio/ringtone.wav");
    const connect = bySrc("/audio/connect.wav");
    const disconnect = bySrc("/audio/disconnect.wav");
    expect(connect).toBeDefined();
    expect(disconnect).toBeDefined();
    expect(connect).not.toBe(ringtone);
    expect(disconnect).not.toBe(connect);
    // Re-pointing `src` would reset the element we spent a gesture unlocking.
    expect(ringtone?.src).toContain("/audio/ringtone.wav");
    expect(created).toHaveLength(3);

    player.dispose();
  });

  it("releases every element on dispose and stays inert afterwards", async () => {
    const player = createRingtonePlayer();
    await player.unlock();
    const countBefore = created.length;

    player.dispose();

    expect(created.every((element) => element.getAttribute("src") === null)).toBe(true);
    await expect(player.unlock()).resolves.toBeUndefined();
    await expect(player.startRinging()).resolves.toBeUndefined();
    expect(() => player.playCue("connect")).not.toThrow();
    expect(() => player.stopRinging()).not.toThrow();
    expect(created).toHaveLength(countBefore);
  });
});
