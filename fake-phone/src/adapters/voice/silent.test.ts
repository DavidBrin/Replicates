import { describe, expect, it } from "vitest";

import { createSilentVoiceProvider } from "@/adapters/voice/silent";
import type { Persona } from "@/domain/persona";
import type { CallEvent } from "@/ports";

const persona: Persona = {
  id: "fixture",
  title: "Fixture",
  description: "Ignored entirely by this provider.",
  suggestedCallerName: "Sam",
  suggestedCallerLabel: "mobile",
  characterBrief: "Never used — the silent tier speaks no lines at all.",
  script: [{ text: "Never spoken.", pauseAfterMs: 1000 }],
};

function collect(events: AsyncIterable<CallEvent>): { seen: CallEvent[]; finished: () => boolean } {
  const seen: CallEvent[] = [];
  let done = false;
  void (async () => {
    for await (const event of events) seen.push(event);
    done = true;
  })();
  return { seen, finished: () => done };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("silent voice provider", () => {
  it("is always available — it is the floor the degradation chain rests on", () => {
    const provider = createSilentVoiceProvider();
    expect(provider.id).toBe("silent");
    expect(provider.isAvailable()).toBe(true);
  });

  it("connects immediately and then says nothing until stopped", async () => {
    const provider = createSilentVoiceProvider();
    const session = await provider.start(persona, new AbortController().signal);
    const { seen, finished } = collect(session.events());

    await flush();
    // Connected straight away: there is no handshake, and the UI's call timer
    // must start the moment the user answers.
    expect(seen).toEqual([{ type: "connected" }]);

    await flush();
    expect(seen).toHaveLength(1);
    expect(finished()).toBe(false);

    session.stop();
    await flush();
    expect(seen).toEqual([{ type: "connected" }, { type: "ended" }]);
    expect(finished()).toBe(true);
  });

  it("ends when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const provider = createSilentVoiceProvider();
    const session = await provider.start(persona, controller.signal);
    const { seen } = collect(session.events());

    await flush();
    controller.abort();
    await flush();

    expect(seen.map((event) => event.type)).toEqual(["connected", "ended"]);
  });

  it("ends immediately when started with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createSilentVoiceProvider();
    const session = await provider.start(persona, controller.signal);
    const { seen } = collect(session.events());

    await flush();
    expect(seen).toEqual([{ type: "ended" }]);
  });

  it("tolerates stop() being called twice", async () => {
    const provider = createSilentVoiceProvider();
    const session = await provider.start(persona, new AbortController().signal);
    const { seen } = collect(session.events());

    await flush();
    session.stop();
    session.stop();
    await flush();
    expect(seen).toHaveLength(2);
  });

  it("hands every consumer the same iterator", async () => {
    const provider = createSilentVoiceProvider();
    const session = await provider.start(persona, new AbortController().signal);
    expect(session.events()).toBe(session.events());
    session.stop();
  });
});
