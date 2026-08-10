import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSpeechSynthesizer, pickVoice } from "@/adapters/speech/web-speech";

/**
 * jsdom implements none of the Web Speech API, which is convenient: the fake
 * below can reproduce the *iOS* behaviour rather than a healthy engine's, which
 * is the only version worth testing against
 * (research/web-platform-constraints.md §8).
 */

type UtteranceHandler = (() => void) | null;

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: UtteranceHandler = null;
  onerror: UtteranceHandler = null;
  constructor(public text: string) {}
}

class FakeSynth extends EventTarget {
  voices: SpeechSynthesisVoice[] = [];
  spoken: FakeUtterance[] = [];
  cancelCount = 0;
  pauseCount = 0;
  resumeCount = 0;
  /** When false, `speak()` never calls back — the backgrounded-iOS case. */
  autoFinish = true;

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }
  speak(utterance: FakeUtterance): void {
    this.spoken.push(utterance);
    if (this.autoFinish && utterance.volume !== 0) {
      setTimeout(() => utterance.onend?.(), 300);
    }
  }
  cancel(): void {
    this.cancelCount += 1;
  }
  pause(): void {
    this.pauseCount += 1;
  }
  resume(): void {
    this.resumeCount += 1;
  }
  /** Mirrors iOS: voices show up only after the async event. */
  deliverVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices;
    this.dispatchEvent(new Event("voiceschanged"));
  }
}

function voice(
  name: string,
  lang: string,
  extra: Partial<SpeechSynthesisVoice> = {},
): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService: true,
    default: false,
    voiceURI: name,
    ...extra,
  } as SpeechSynthesisVoice;
}

let synth: FakeSynth;

beforeEach(() => {
  vi.useFakeTimers();
  synth = new FakeSynth();
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("availability", () => {
  it("is false when the platform has no Web Speech API", () => {
    vi.unstubAllGlobals();
    expect(createSpeechSynthesizer().isAvailable()).toBe(false);
  });

  it("is optimistic before warm-up — an empty voice list proves nothing on iOS", () => {
    expect(synth.getVoices()).toEqual([]);
    expect(createSpeechSynthesizer().isAvailable()).toBe(true);
  });

  it("is false once warm-up has run and the device really has no voice", async () => {
    const speech = createSpeechSynthesizer();
    const warm = speech.warmUp();
    await vi.advanceTimersByTimeAsync(2_000); // past the voiceschanged deadline
    await warm;
    expect(speech.isAvailable()).toBe(false);
  });
});

describe("warmUp", () => {
  it("touches the engine inside the gesture, which is what makes later speech audible", async () => {
    const speech = createSpeechSynthesizer();
    synth.voices = [voice("Samantha", "en-US")];
    await speech.warmUp();
    // A silent, blank utterance: inaudible, but it wakes the engine.
    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0].volume).toBe(0);
  });

  it("waits for voiceschanged when getVoices() starts empty", async () => {
    const speech = createSpeechSynthesizer();
    let resolved = false;
    void speech.warmUp().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    synth.deliverVoices([voice("Samantha", "en-US")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
    expect(speech.isAvailable()).toBe(true);
  });

  it("resolves on its own deadline if voiceschanged never fires", async () => {
    // It may genuinely never fire. A warm-up that never resolves would stall
    // the call before it starts, which is far worse than a silent call.
    const speech = createSpeechSynthesizer();
    let resolved = false;
    void speech.warmUp().then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("only warms up once", async () => {
    const speech = createSpeechSynthesizer();
    synth.voices = [voice("Samantha", "en-US")];
    await Promise.all([speech.warmUp(), speech.warmUp()]);
    await speech.warmUp();
    expect(synth.spoken).toHaveLength(1);
  });

  it("resolves even with no API at all", async () => {
    vi.unstubAllGlobals();
    await expect(createSpeechSynthesizer().warmUp()).resolves.toBeUndefined();
  });
});

describe("speak", () => {
  it("resolves when the utterance ends, and applies rate and pitch", async () => {
    const speech = createSpeechSynthesizer();
    synth.voices = [voice("Samantha", "en-US")];
    await speech.warmUp();

    let done = false;
    void speech.speak({ text: "I'm nearly at you.", rate: 1.2, pitch: 0.9 }).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    const utterance = synth.spoken.at(-1);
    expect(utterance?.text).toBe("I'm nearly at you.");
    expect(utterance?.rate).toBe(1.2);
    expect(utterance?.pitch).toBe(0.9);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(true);
  });

  it("resolves rather than rejects when the engine errors", async () => {
    synth.autoFinish = false;
    const speech = createSpeechSynthesizer();

    const promise = speech.speak({ text: "Hello?" });
    await vi.advanceTimersByTimeAsync(0);
    synth.spoken.at(-1)?.onerror?.();

    // A line the user does not hear is not a reason to end their call.
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves on a watchdog when neither onend nor onerror ever fires", async () => {
    // The documented iOS backgrounding failure: the utterance is dropped and
    // the engine goes quiet without ever calling back.
    synth.autoFinish = false;
    const speech = createSpeechSynthesizer();

    let done = false;
    void speech.speak({ text: "Two minutes." }).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(done).toBe(true);
  });

  it("keeps the queue alive so a long line is not cut off at ~15s", async () => {
    // Safari and Chrome both stop a long utterance dead around 15 seconds
    // unless the queue is pause/resume'd periodically.
    synth.autoFinish = false;
    const speech = createSpeechSynthesizer();
    void speech.speak({ text: "x".repeat(400) });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(synth.pauseCount).toBe(1);
    expect(synth.resumeCount).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(synth.pauseCount).toBe(2);
  });

  it("stops the keep-alive once the line finishes", async () => {
    const speech = createSpeechSynthesizer();
    const promise = speech.speak({ text: "Short." });
    await vi.advanceTimersByTimeAsync(300); // the fake engine's onend
    await promise;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(synth.pauseCount).toBe(0);
  });

  it("resolves immediately for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const speech = createSpeechSynthesizer();
    await expect(speech.speak({ text: "Hello?", signal: controller.signal })).resolves.toBeUndefined();
    expect(synth.spoken).toHaveLength(0);
  });

  it("cancels the engine and resolves when aborted mid-line", async () => {
    synth.autoFinish = false;
    const controller = new AbortController();
    const speech = createSpeechSynthesizer();

    const promise = speech.speak({ text: "Where are you?", signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).resolves.toBeUndefined();
    expect(synth.cancelCount).toBe(1);
  });

  it("resolves for empty text and with no API", async () => {
    const speech = createSpeechSynthesizer();
    await expect(speech.speak({ text: "   " })).resolves.toBeUndefined();
    expect(synth.spoken).toHaveLength(0);

    vi.unstubAllGlobals();
    await expect(createSpeechSynthesizer().speak({ text: "Hi" })).resolves.toBeUndefined();
  });
});

describe("cancel", () => {
  it("is safe at any time, including with nothing speaking or no API", () => {
    const speech = createSpeechSynthesizer();
    expect(() => speech.cancel()).not.toThrow();
    expect(synth.cancelCount).toBe(1);

    vi.unstubAllGlobals();
    expect(() => createSpeechSynthesizer().cancel()).not.toThrow();
  });
});

describe("pickVoice", () => {
  it("returns null when the device has no voices", () => {
    expect(pickVoice([], "en-GB")).toBeNull();
  });

  it("prefers an exact language match over a base-language one", () => {
    const chosen = pickVoice([voice("Alva", "sv-SE"), voice("Daniel", "en-GB")], "en-GB");
    expect(chosen?.name).toBe("Daniel");
  });

  it("prefers a natural-sounding local voice over a remote one", () => {
    const chosen = pickVoice(
      [
        voice("Anonymous Cloud Voice", "en-GB", { localService: false }),
        voice("Samantha", "en-GB"),
      ],
      "en-GB",
    );
    expect(chosen?.name).toBe("Samantha");
  });

  it("never picks a novelty system voice", () => {
    // "Zarvox" would end the illusion in one syllable.
    const chosen = pickVoice([voice("Zarvox", "en-US"), voice("Fiona", "en-GB")], "en-US");
    expect(chosen?.name).toBe("Fiona");
  });

  it("falls back to any voice rather than none", () => {
    // A slightly wrong accent is far less damaging than no sound at all.
    const chosen = pickVoice([voice("Alva", "sv-SE")], "en-GB");
    expect(chosen?.name).toBe("Alva");
  });
});
