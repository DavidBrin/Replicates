import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScriptedVoiceProvider, estimateReadingMs } from "@/adapters/voice/scripted";
import type { Persona } from "@/domain/persona";
import type { CallEvent, Clock, SpeechRequest, SpeechSynthesizer } from "@/ports";

/* ---------------------------------------------------------------- fixtures */

const persona: Persona = {
  id: "fixture",
  title: "Fixture",
  description: "A two-line call.",
  suggestedCallerName: "Sam",
  suggestedCallerLabel: "mobile",
  characterBrief: "A fixture used to test timing, not believability.",
  voiceHints: { rate: 1.1, pitch: 0.9 },
  script: [
    { text: "One.", pauseAfterMs: 1200 },
    { text: "Two.", pauseAfterMs: 1500 },
  ],
};

interface FakeSpeech extends SpeechSynthesizer {
  readonly spoken: string[];
  readonly requests: SpeechRequest[];
  available: boolean;
  /** How long a line takes to "speak". */
  durationMs: number;
  throwOnSpeak: boolean;
  cancelCount: number;
}

function createFakeSpeech(overrides: Partial<FakeSpeech> = {}): FakeSpeech {
  const fake: FakeSpeech = {
    spoken: [],
    requests: [],
    available: true,
    durationMs: 500,
    throwOnSpeak: false,
    cancelCount: 0,
    isAvailable: () => fake.available,
    warmUp: () => Promise.resolve(),
    speak(request) {
      fake.requests.push(request);
      if (fake.throwOnSpeak) throw new Error("engine exploded");
      fake.spoken.push(request.text);
      if (fake.durationMs === 0) return Promise.resolve();
      // Models the real contract: resolves (never rejects) when cut off.
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, fake.durationMs);
        request.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    },
    cancel() {
      fake.cancelCount += 1;
    },
  };
  Object.assign(fake, overrides);
  return fake;
}

/** Vitest's fake timers mock `Date`, so this advances with the timers. */
const clock: Clock = { now: () => Date.now() };

function collect(events: AsyncIterable<CallEvent>): {
  seen: CallEvent[];
  finished: () => boolean;
} {
  const seen: CallEvent[] = [];
  let done = false;
  void (async () => {
    for await (const event of events) seen.push(event);
    done = true;
  })();
  return { seen, finished: () => done };
}

const types = (events: CallEvent[]): string[] => events.map((event) => event.type);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ tests */

describe("scripted voice provider", () => {
  it("is always available — a written script needs no platform support", () => {
    const provider = createScriptedVoiceProvider({ speech: createFakeSpeech(), clock });
    expect(provider.id).toBe("scripted");
    expect(provider.isAvailable()).toBe(true);
  });

  it("emits connected, then line/listening per line, then ended", async () => {
    const speech = createFakeSpeech();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    const { seen, finished } = collect(session.events());

    await vi.advanceTimersByTimeAsync(0);
    expect(types(seen)).toEqual(["connected", "line"]);
    expect(seen[1]).toEqual({ type: "line", text: "One." });

    // Still speaking: no `listening` until the line finishes.
    await vi.advanceTimersByTimeAsync(499);
    expect(types(seen)).toEqual(["connected", "line"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(types(seen)).toEqual(["connected", "line", "listening"]);

    // The listening pause is honoured before the next line.
    await vi.advanceTimersByTimeAsync(1199);
    expect(types(seen)).toEqual(["connected", "line", "listening"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.at(-1)).toEqual({ type: "line", text: "Two." });

    await vi.advanceTimersByTimeAsync(500 + 1500);
    expect(types(seen)).toEqual([
      "connected",
      "line",
      "listening",
      "line",
      "listening",
      "ended",
    ]);
    expect(finished()).toBe(true);
    expect(speech.spoken).toEqual(["One.", "Two."]);
  });

  it("passes the persona's voice hints to the synthesizer", async () => {
    const speech = createFakeSpeech();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    collect(session.events());

    await vi.advanceTimersByTimeAsync(0);
    expect(speech.requests[0]?.rate).toBe(1.1);
    expect(speech.requests[0]?.pitch).toBe(0.9);
    session.stop();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("keeps conversation timing when speech is unavailable", async () => {
    // The iOS default: no usable voice. The subtitles must still pace like a
    // call (research/web-platform-constraints.md §8) or the whole tier is dead.
    const speech = createFakeSpeech({ available: false });
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    const { seen } = collect(session.events());

    const readingMs = estimateReadingMs("One.");
    expect(readingMs).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(0);
    expect(types(seen)).toEqual(["connected", "line"]);

    await vi.advanceTimersByTimeAsync(readingMs - 1);
    expect(types(seen)).toEqual(["connected", "line"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(types(seen)).toEqual(["connected", "line", "listening"]);

    await vi.advanceTimersByTimeAsync(1200);
    expect(seen.at(-1)).toEqual({ type: "line", text: "Two." });

    await vi.advanceTimersByTimeAsync(estimateReadingMs("Two.") + 1500);
    expect(types(seen)).toEqual([
      "connected",
      "line",
      "listening",
      "line",
      "listening",
      "ended",
    ]);
    // Never even asked the broken engine to speak.
    expect(speech.spoken).toEqual([]);
  });

  it("pads a speak() that resolves instantly, so the script cannot race", async () => {
    // Some engines resolve immediately when they have no voice loaded; without
    // the pad the whole call would be over in a few hundred milliseconds.
    const speech = createFakeSpeech({ durationMs: 0 });
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    const { seen } = collect(session.events());

    await vi.advanceTimersByTimeAsync(0);
    expect(types(seen)).toEqual(["connected", "line"]);

    await vi.advanceTimersByTimeAsync(estimateReadingMs("One.") - 1);
    expect(types(seen)).toEqual(["connected", "line"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(types(seen)).toEqual(["connected", "line", "listening"]);
  });

  it("stops promptly when the caller's signal aborts mid-pause", async () => {
    const speech = createFakeSpeech();
    const controller = new AbortController();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, controller.signal);
    const { seen, finished } = collect(session.events());

    await vi.advanceTimersByTimeAsync(500); // through the first line
    expect(types(seen)).toEqual(["connected", "line", "listening"]);

    controller.abort();
    await vi.advanceTimersByTimeAsync(0); // no need to wait out the 1200ms pause

    expect(types(seen)).toEqual(["connected", "line", "listening", "ended"]);
    expect(finished()).toBe(true);
    expect(speech.cancelCount).toBeGreaterThan(0);

    // And nothing more is emitted afterwards.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toHaveLength(4);
  });

  it("stops promptly on session.stop() mid-line", async () => {
    const speech = createFakeSpeech();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    const { seen, finished } = collect(session.events());

    await vi.advanceTimersByTimeAsync(100); // mid-utterance
    session.stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(types(seen)).toEqual(["connected", "line", "ended"]);
    expect(finished()).toBe(true);
    expect(speech.spoken).toEqual(["One."]);
  });

  it("ends immediately when started with an already-aborted signal", async () => {
    const speech = createFakeSpeech();
    const controller = new AbortController();
    controller.abort();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, controller.signal);
    const { seen } = collect(session.events());

    await vi.advanceTimersByTimeAsync(0);
    expect(types(seen)).toEqual(["connected", "ended"]);
    expect(speech.spoken).toEqual([]);
  });

  it("survives a synthesizer that throws, and keeps the line's timing", async () => {
    // The port says `speak()` resolves rather than rejects — but a broken
    // implementation must not be able to end someone's call.
    const speech = createFakeSpeech({ throwOnSpeak: true });
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    const { seen, finished } = collect(session.events());

    await vi.advanceTimersByTimeAsync(estimateReadingMs("One.") + 1200);
    expect(seen.at(-1)).toEqual({ type: "line", text: "Two." });
    expect(types(seen)).not.toContain("error");

    await vi.advanceTimersByTimeAsync(estimateReadingMs("Two.") + 1500);
    expect(types(seen).at(-1)).toBe("ended");
    expect(finished()).toBe(true);
  });

  it("hands every consumer the same iterator, so a script never runs twice", async () => {
    const speech = createFakeSpeech();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);
    expect(session.events()).toBe(session.events());
    session.stop();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("ends cleanly when the consumer breaks out of the loop", async () => {
    const speech = createFakeSpeech();
    const provider = createScriptedVoiceProvider({ speech, clock });
    const session = await provider.start(persona, new AbortController().signal);

    const seen: CallEvent[] = [];
    const loop = (async () => {
      for await (const event of session.events()) {
        seen.push(event);
        if (event.type === "line") break; // the UI unmounted
      }
    })();

    await vi.advanceTimersByTimeAsync(0);
    await loop;
    expect(types(seen)).toEqual(["connected", "line"]);
    // The generator's `finally` still ran: speech was cancelled, nothing leaks.
    expect(speech.cancelCount).toBeGreaterThan(0);
  });
});

describe("estimateReadingMs", () => {
  it("floors short lines so a backchannel is still readable", () => {
    expect(estimateReadingMs("Oh.")).toBe(800);
  });

  it("scales with length and caps pathological lines", () => {
    expect(estimateReadingMs("I'm just turning onto your street now.")).toBeGreaterThan(1500);
    expect(estimateReadingMs("x".repeat(1000))).toBe(8000);
  });
});
