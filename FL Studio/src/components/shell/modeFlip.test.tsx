/**
 * The pattern/song flip, driven through the MOUNTED app against a real engine.
 *
 * Every other shell test mocks `@/audio`, which is exactly why this one does
 * not: the defect it guards lived in the *order* of two calls that both look
 * right in isolation. `setPlaybackMode` writes the store, `startShellRuntime`'s
 * subscription pushes that project into the engine synchronously, and
 * `engine.setMode` early-returns when the project it holds already has the
 * requested mode. Store-write-first therefore produced a mode flip that
 * re-armed the transport but never released the sounding voices or restarted
 * at zero — and no mocked-engine assertion can see that, because the mock has
 * no such guard.
 *
 * Tone is the shared fake (`@/audio/testing/toneStub`); nothing here makes a
 * sound, it asserts transport calls.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { disposeEngine, getSnapshot } from "@/audio";
import { installTone, type FakeTone } from "@/audio/testing/toneStub";
import { __resetKeyboardRegistryForTests } from "@/lib/keyboard";
import { useAppStore } from "@/lib/store";

import { AppShell } from "./AppShell";
import {
  __resetWiringForTests,
  setMode,
  startPlayback,
  stopPlayback,
  togglePlaybackMode,
} from "./wiring";

let tone: FakeTone;

beforeEach(() => {
  // `audioSupported()` reads this; without it the wiring skips the engine.
  (window as { AudioContext?: unknown }).AudioContext = class {} as never;
  tone = installTone().tone;
});

afterEach(() => {
  disposeEngine();
  __resetKeyboardRegistryForTests();
  __resetWiringForTests();
  delete (window as { AudioContext?: unknown }).AudioContext;
});

/** Mount the app (which starts the engine sync) and boot the engine playing. */
async function mountAndPlay(): Promise<void> {
  render(<AppShell />);
  await act(async () => {
    await startPlayback();
  });
}

describe("flipping playback mode while the transport runs", () => {
  it("restarts the transport from zero instead of silently re-arming", async () => {
    await mountAndPlay();
    const starts = tone.transport.startCalls;
    const stops = tone.transport.stopCalls;
    tone.transport.ticks = 96;

    act(() => setMode("song"));

    // The engine saw a real transition: stop, rewind, start (SPEC §3.2's
    // stop-over-pause). A missed transition leaves both counts untouched.
    expect(tone.transport.startCalls).toBe(starts + 1);
    expect(tone.transport.stopCalls).toBeGreaterThan(stops);
    expect(tone.transport.ticks).toBe(0);
  });

  it("leaves the store and the engine agreeing on the new mode", async () => {
    await mountAndPlay();

    act(() => setMode("song"));

    expect(useAppStore.getState().project.playbackMode).toBe("song");
    expect(getSnapshot().mode).toBe("song");
  });

  it("does the same for the `L` toggle, and flips back", async () => {
    await mountAndPlay();

    act(() => togglePlaybackMode());
    expect(getSnapshot().mode).toBe("song");

    const starts = tone.transport.startCalls;
    act(() => togglePlaybackMode());

    expect(getSnapshot().mode).toBe("pattern");
    expect(useAppStore.getState().project.playbackMode).toBe("pattern");
    expect(tone.transport.startCalls).toBe(starts + 1);
  });

  it("stays stopped when it was stopped — a flip is not a play", async () => {
    await mountAndPlay();
    act(() => stopPlayback());
    const starts = tone.transport.startCalls;

    act(() => setMode("song"));

    expect(tone.transport.startCalls).toBe(starts);
    expect(getSnapshot().playing).toBe(false);
    expect(getSnapshot().mode).toBe("song");
  });
});
