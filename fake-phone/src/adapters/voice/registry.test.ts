// @vitest-environment node

/**
 * The degradation walk is exercised exhaustively here rather than in the UI,
 * because "graceful degradation is a property of the factory" is only true if
 * every (requested tier × availability) combination is covered — 3 tiers × 8
 * availability states is 24 cases, and the table below runs all of them.
 *
 * `ai` is mocked so its availability can be driven directly; `silent` and
 * `scripted` are the real adapters, since the whole point is that the fallback
 * lands on something that actually works.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Clock, SpeechSynthesizer, VoiceProvider, VoiceProviderId } from "@/ports";
import type { VoiceTier } from "@/domain/settings";

import { createVoiceProvider, type VoiceDeps } from "./registry";

const aiAvailable = vi.hoisted(() => ({ value: false, throwOnCheck: false, throwOnCreate: false }));

vi.mock("./ai", () => ({
  createAiVoiceProvider: (): VoiceProvider => {
    if (aiAvailable.throwOnCreate) throw new Error("ai adapter blew up at construction");
    return {
      id: "ai",
      isAvailable: () => {
        if (aiAvailable.throwOnCheck) throw new Error("ai isAvailable blew up");
        return aiAvailable.value;
      },
      start: async () => ({ events: () => emptyEvents(), stop: () => {} }),
    };
  },
}));

async function* emptyEvents() {
  yield { type: "ended" } as const;
}

function makeDeps(): VoiceDeps {
  const speech: SpeechSynthesizer = {
    isAvailable: () => true,
    warmUp: async () => {},
    speak: async () => {},
    cancel: () => {},
  };
  const clock: Clock = { now: () => 1_700_000_000_000 };
  return { speech, clock };
}

beforeEach(() => {
  aiAvailable.value = false;
  aiAvailable.throwOnCheck = false;
  aiAvailable.throwOnCreate = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createVoiceProvider — the inert default", () => {
  it("returns the scripted provider for the ai tier when no key is configured", () => {
    const provider = createVoiceProvider("ai", makeDeps());

    expect(provider.id).toBe("scripted");
  });

  it("returns a usable provider for every tier with a completely empty env", () => {
    for (const tier of ["silent", "scripted", "ai"] as const) {
      const provider = createVoiceProvider(tier, makeDeps());

      expect(provider).not.toBeNull();
      expect(provider.isAvailable()).toBe(true);
    }
  });
});

describe("createVoiceProvider — the degradation walk", () => {
  const cases: ReadonlyArray<{ tier: VoiceTier; ai: boolean; expected: VoiceProviderId }> = [
    { tier: "ai", ai: false, expected: "scripted" },
    { tier: "ai", ai: true, expected: "ai" },
    { tier: "scripted", ai: false, expected: "scripted" },
    // A requested tier is never *upgraded*: asking for scripted with the AI
    // tier live still returns scripted.
    { tier: "scripted", ai: true, expected: "scripted" },
    { tier: "silent", ai: false, expected: "silent" },
    { tier: "silent", ai: true, expected: "silent" },
  ];

  for (const { tier, ai, expected } of cases) {
    it(`tier=${tier} aiAvailable=${ai} → ${expected}`, () => {
      aiAvailable.value = ai;

      expect(createVoiceProvider(tier, makeDeps()).id).toBe(expected);
    });
  }
});

describe("createVoiceProvider — never throws, never returns null", () => {
  it("survives an AI provider that throws from isAvailable()", () => {
    aiAvailable.throwOnCheck = true;

    const provider = createVoiceProvider("ai", makeDeps());

    expect(provider.id).toBe("scripted");
  });

  it("survives an AI provider that throws at construction", () => {
    aiAvailable.throwOnCreate = true;

    const provider = createVoiceProvider("ai", makeDeps());

    expect(provider.id).toBe("scripted");
  });

  it("starts the walk at the top for an unknown tier rather than failing", () => {
    aiAvailable.value = true;

    const provider = createVoiceProvider("telepathy" as VoiceTier, makeDeps());

    expect(provider.id).toBe("ai");
  });

  it("returns a working provider even when the deps are inert", () => {
    const inertSpeech: SpeechSynthesizer = {
      isAvailable: () => false,
      warmUp: async () => {},
      speak: async () => {},
      cancel: () => {},
    };
    const provider = createVoiceProvider("ai", {
      speech: inertSpeech,
      clock: { now: () => 0 },
    });

    expect(provider.isAvailable()).toBe(true);
  });

  it("hands back a session that can be started and stopped", async () => {
    const provider = createVoiceProvider("silent", makeDeps());
    const controller = new AbortController();

    const session = await provider.start(
      {
        id: "fixture",
        title: "Fixture",
        description: "A persona used only by tests.",
        suggestedCallerName: "Sam",
        suggestedCallerLabel: "mobile",
        script: [],
        characterBrief: "A friend nearby.",
      },
      controller.signal,
    );

    expect(typeof session.stop).toBe("function");
    session.stop();
  });
});
