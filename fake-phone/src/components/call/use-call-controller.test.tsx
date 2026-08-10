import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ContainerProvider } from "@/components/app-shell/container-provider";
import { defaultSettings, type Settings, type VoiceTier } from "@/domain/settings";
import type { Container } from "@/lib/container";
import type { CallEvent, VoiceProvider } from "@/ports";

import { useCallController } from "./use-call-controller";

/**
 * These tests are about one guarantee: **the call always connects.**
 *
 * The voice tier is the least reliable thing in the app — it depends on a build
 * flag, a server key, a network, and a speech engine, any of which can be wrong
 * at the moment someone needs the call to look real. None of that may leave the
 * user on a "connecting" screen whose timer never starts, because a phone stuck
 * on "connecting" is a phone that is visibly not on a call.
 */

function providerEmitting(id: VoiceTier, events: readonly CallEvent[]): VoiceProvider {
  return {
    id,
    isAvailable: () => true,
    start: async () => ({
      events: async function* () {
        for (const event of events) yield event;
      },
      stop: () => {},
    }),
  };
}

function fakeContainer(voiceFor: (tier: VoiceTier) => VoiceProvider): Container {
  return {
    clock: { now: () => 1_000 },
    settings: {
      load: () => defaultSettings,
      save: () => {},
      clear: () => {},
    },
    ringtone: {
      unlock: async () => {},
      startRinging: async () => {},
      stopRinging: () => {},
      playCue: () => {},
      dispose: () => {},
    },
    speech: {
      isAvailable: () => false,
      warmUp: async () => {},
      speak: async () => {},
      cancel: () => {},
    },
    camera: {
      isSupported: () => false,
      start: async () => {
        throw new Error("no camera in this test");
      },
      stop: () => {},
      flip: async () => {
        throw new Error("no camera in this test");
      },
    },
    haptics: { isSupported: () => false, buzz: () => {}, cancel: () => {} },
    wakeLock: { isSupported: () => false, request: async () => {}, release: () => {} },
    voiceFor,
  };
}

function renderController(container: Container, settings: Settings) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ContainerProvider container={container}>{children}</ContainerProvider>
  );
  return renderHook(() => useCallController(settings, () => {}), { wrapper });
}

const AI_SETTINGS: Settings = { ...defaultSettings, voiceTier: "ai", ringtoneEnabled: false };

describe("useCallController — connecting is never a dead end", () => {
  it("falls back to the scripted provider when AI never connects", async () => {
    // The AI tier's availability is a *build-time* flag, so the registry can
    // hand back the AI provider on a deployment whose server has no key. Only
    // the first request finds out, which makes this the one place the promised
    // degradation can actually happen.
    const ai = providerEmitting("ai", [
      { type: "connecting" },
      { type: "error", message: "voice_unconfigured" },
      { type: "ended" },
    ]);
    const scripted = providerEmitting("scripted", [
      { type: "connected" },
      { type: "line", text: "hey, I'm two minutes away" },
    ]);
    const voiceFor = vi.fn((tier: VoiceTier) => (tier === "ai" ? ai : scripted));

    const { result } = renderController(fakeContainer(voiceFor), AI_SETTINGS);

    result.current.answer();

    await waitFor(() => expect(result.current.state.phase).toBe("active"));
    await waitFor(() => expect(result.current.subtitle).toBe("hey, I'm two minutes away"));
    expect(voiceFor).toHaveBeenCalledWith("scripted");
  });

  it("falls back when AI connects but a rejected key stops it ever speaking", async () => {
    // A key that is present but invalid fails later than a missing one: the
    // session route mints happily, the adapter reports `connected`, and only
    // the first turn discovers the upstream rejection. Gating the fallback on
    // the handshake would call that a working call and leave the user with a
    // running timer and total silence.
    const ai = providerEmitting("ai", [
      { type: "connecting" },
      { type: "connected" },
      { type: "error", message: "401 from the provider" },
      { type: "ended" },
    ]);
    const scripted = providerEmitting("scripted", [
      { type: "connected" },
      { type: "line", text: "I'm outside now" },
    ]);
    const voiceFor = vi.fn((tier: VoiceTier) => (tier === "ai" ? ai : scripted));

    const { result } = renderController(fakeContainer(voiceFor), AI_SETTINGS);

    result.current.answer();

    await waitFor(() => expect(result.current.subtitle).toBe("I'm outside now"));
    expect(result.current.state.phase).toBe("active");
    expect(voiceFor).toHaveBeenCalledWith("scripted");
  });

  it("does not fall back when AI actually spoke", async () => {
    const ai = providerEmitting("ai", [
      { type: "connected" },
      { type: "line", text: "hey, where are you?" },
      { type: "ended" },
    ]);
    const voiceFor = vi.fn(() => ai);

    const { result } = renderController(fakeContainer(voiceFor), AI_SETTINGS);

    result.current.answer();

    await waitFor(() => expect(result.current.state.phase).toBe("active"));
    expect(voiceFor).toHaveBeenCalledTimes(1);
    expect(voiceFor).not.toHaveBeenCalledWith("scripted");
  });

  it("connects anyway when every provider fails", async () => {
    // Silent but live beats a timer that never starts.
    const dead = providerEmitting("ai", [{ type: "error", message: "nope" }, { type: "ended" }]);
    const alsoDead = providerEmitting("scripted", [{ type: "ended" }]);

    const { result } = renderController(
      fakeContainer((tier) => (tier === "ai" ? dead : alsoDead)),
      AI_SETTINGS,
    );

    result.current.answer();

    await waitFor(() => expect(result.current.state.phase).toBe("active"));
    expect(result.current.subtitle).toBeNull();
  });

  it("connects anyway when the provider throws on start", async () => {
    const throwing: VoiceProvider = {
      id: "scripted",
      isAvailable: () => true,
      start: async () => {
        throw new Error("boom");
      },
    };

    const { result } = renderController(fakeContainer(() => throwing), {
      ...defaultSettings,
      ringtoneEnabled: false,
    });

    result.current.answer();

    await waitFor(() => expect(result.current.state.phase).toBe("active"));
  });

  it("does not fall back when the scripted tier itself was chosen", async () => {
    // Falling back from scripted to scripted would just run the same failing
    // provider twice and double every side effect it already had.
    const scripted = providerEmitting("scripted", [{ type: "ended" }]);
    const voiceFor = vi.fn(() => scripted);

    const { result } = renderController(fakeContainer(voiceFor), {
      ...defaultSettings,
      ringtoneEnabled: false,
    });

    result.current.answer();

    await waitFor(() => expect(result.current.state.phase).toBe("active"));
    expect(voiceFor).toHaveBeenCalledTimes(1);
  });
});
