// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Persona } from "@/domain/persona";
import type { CallEvent, SpeechSynthesizer } from "@/ports";

import { createAiVoiceProvider } from "./ai";

const PERSONA: Persona = {
  id: "friend-nearby",
  title: "A friend nearby",
  description: "A friend who is already on their way.",
  suggestedCallerName: "Sam",
  suggestedCallerLabel: "mobile",
  script: [],
  characterBrief: "A close friend two streets away.",
};

function makeSpeech(overrides: Partial<SpeechSynthesizer> = {}): SpeechSynthesizer & {
  spoken: string[];
} {
  const spoken: string[] = [];
  return {
    spoken,
    isAvailable: () => true,
    warmUp: async () => {},
    speak: async ({ text }) => {
      spoken.push(text);
    },
    cancel: () => {},
    ...overrides,
  };
}

function sseResponse(frames: { event: string; data: unknown }[]): Response {
  const body = frames
    .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function sessionResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      sessionId: "session-1",
      expiresAt: Date.now() + 60_000,
      ephemeralToken: null,
      maxDurationSeconds: 240,
      maxTokens: 2000,
      ...overrides,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}

async function collect(events: AsyncIterable<CallEvent>): Promise<CallEvent[]> {
  const out: CallEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createAiVoiceProvider — isAvailable", () => {
  it("is false with the public flag unset, so the registry never selects it", () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", "");

    expect(createAiVoiceProvider({ speech: makeSpeech() }).isAvailable()).toBe(false);
  });

  it("is false for any value other than the exact string 'true'", () => {
    for (const value of ["false", "1", "yes", "TRUE"]) {
      vi.stubEnv("NEXT_PUBLIC_VOICE_AI_ENABLED", value);
      expect(createAiVoiceProvider({ speech: makeSpeech() }).isAvailable()).toBe(false);
    }
  });

  it("is true with the flag on, and makes no network call to decide", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(createAiVoiceProvider({ speech: makeSpeech() }).isAvailable()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports the id the ports union expects", () => {
    expect(createAiVoiceProvider({ speech: makeSpeech() }).id).toBe("ai");
  });
});

describe("createAiVoiceProvider — a working call", () => {
  it("emits connecting → connected → line → listening → ended", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          sseResponse([
            { event: "connected", data: { sessionId: "session-1" } },
            { event: "line", data: { text: "Hey, I'm two minutes away." } },
            { event: "usage", data: { outputTokens: 20 } },
            { event: "listening", data: { durationMs: 0 } },
            { event: "ended", data: { reason: "duration_cap" } },
          ]),
        ),
    );

    const speech = makeSpeech();
    const provider = createAiVoiceProvider({ speech });
    const session = await provider.start(PERSONA, new AbortController().signal);

    const events = await collect(session.events());

    expect(events.map((event) => event.type)).toEqual([
      "connecting",
      "connected",
      "line",
      "listening",
      "ended",
    ]);
    expect(speech.spoken).toEqual(["Hey, I'm two minutes away."]);
  });

  it("speaks each line through the injected synthesizer, never the DOM", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          sseResponse([
            { event: "line", data: { text: "I can see the corner shop." } },
            { event: "listening", data: { durationMs: 0 } },
            { event: "ended", data: { reason: "token_cap" } },
          ]),
        ),
    );

    const speech = makeSpeech();
    await collect(
      (await createAiVoiceProvider({ speech }).start(PERSONA, new AbortController().signal))
        .events(),
    );

    expect(speech.spoken).toEqual(["I can see the corner shop."]);
  });

  it("keeps asking for turns while the server says the turn merely completed", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        sseResponse([
          { event: "line", data: { text: "Hey!" } },
          { event: "listening", data: { durationMs: 0 } },
          { event: "ended", data: { reason: "completed" } },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { event: "line", data: { text: "I'm parking now." } },
          { event: "ended", data: { reason: "duration_cap" } },
        ]),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const speech = makeSpeech();
    const events = await collect(
      (await createAiVoiceProvider({ speech }).start(PERSONA, new AbortController().signal))
        .events(),
    );

    expect(speech.spoken).toEqual(["Hey!", "I'm parking now."]);
    expect(events.at(-1)?.type).toBe("ended");
    // Session mint plus two turns.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("feeds the caller's own lines back as transcript on the next turn", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        sseResponse([
          { event: "line", data: { text: "Hey!" } },
          { event: "ended", data: { reason: "completed" } },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ event: "ended", data: { reason: "token_cap" } }]));
    vi.stubGlobal("fetch", fetchSpy);

    const session = await createAiVoiceProvider({ speech: makeSpeech() }).start(
      PERSONA,
      new AbortController().signal,
    );
    session.sendUserSpeech?.("I'm just outside");
    await collect(session.events());

    const secondTurn = JSON.parse(
      String((fetchSpy.mock.calls[2][1] as RequestInit).body),
    ) as { transcript: { role: string; text: string }[]; tokensUsed: number };

    expect(secondTurn.transcript).toEqual([
      { role: "user", text: "I'm just outside" },
      { role: "caller", text: "Hey!" },
    ]);
  });

  it("never sends its own accounting, so it cannot choose its own budget", async () => {
    // The caps are enforced against the server's record of the session. A turn
    // carrying `elapsedSeconds`/`tokensUsed` is a turn that can reset them to
    // zero forever, which is exactly what this stopped doing.
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        sseResponse([
          { event: "line", data: { text: "Hey!" } },
          { event: "usage", data: { outputTokens: 31 } },
          { event: "ended", data: { reason: "completed" } },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ event: "ended", data: { reason: "token_cap" } }]));
    vi.stubGlobal("fetch", fetchSpy);

    await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    for (const call of [fetchSpy.mock.calls[1], fetchSpy.mock.calls[2]]) {
      const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
      expect(body).not.toHaveProperty("tokensUsed");
      expect(body).not.toHaveProperty("elapsedSeconds");
      // The minted session id is the only thing tying a turn to its budget.
      expect(body.sessionId).toBe("session-1");
    }
  });

  it("ends the call cleanly when the server no longer knows the session", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: "session_not_found", message: "gone" }), {
            status: 404,
          }),
        ),
    );

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "connecting",
      "connected",
      "error",
      "ended",
    ]);
    expect(events[2]).toMatchObject({ message: expect.stringMatching(/expired/i) });
  });

  describe("the caller identity the model is briefed with", () => {
    async function turnBodyFor(deps: Parameters<typeof createAiVoiceProvider>[0]) {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(sseResponse([{ event: "ended", data: { reason: "token_cap" } }]));
      vi.stubGlobal("fetch", fetchSpy);

      await collect((await createAiVoiceProvider(deps).start(PERSONA, new AbortController().signal)).events());

      return JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body)) as {
        callerName: string;
        callerLabel: string;
      };
    }

    it("is the one the user configured, not the persona's suggestion", async () => {
      // The screen says "Mum". A model briefed as "Sam" introduces itself as Sam
      // and the illusion the whole product rests on is gone.
      const body = await turnBodyFor({
        speech: makeSpeech(),
        callerIdentity: () => ({ name: "Mum", label: "mobile" }),
      });

      expect(body.callerName).toBe("Mum");
      expect(body.callerLabel).toBe("mobile");
    });

    it("falls back to the persona's suggestion when nothing is configured", async () => {
      const body = await turnBodyFor({ speech: makeSpeech() });

      expect(body.callerName).toBe(PERSONA.suggestedCallerName);
      expect(body.callerLabel).toBe(PERSONA.suggestedCallerLabel);
    });

    it("ignores a blank configured name rather than briefing an unnamed caller", async () => {
      const body = await turnBodyFor({
        speech: makeSpeech(),
        callerIdentity: () => ({ name: "   ", label: "" }),
      });

      expect(body.callerName).toBe(PERSONA.suggestedCallerName);
    });

    it("survives a settings read that throws", async () => {
      const body = await turnBodyFor({
        speech: makeSpeech(),
        callerIdentity: () => {
          throw new Error("localStorage is unavailable");
        },
      });

      expect(body.callerName).toBe(PERSONA.suggestedCallerName);
    });
  });

  it("posts only the persona fields the server needs", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(sseResponse([{ event: "ended", data: { reason: "token_cap" } }]));
    vi.stubGlobal("fetch", fetchSpy);

    await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    const [sessionUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const [turnUrl, turnInit] = fetchSpy.mock.calls[1] as [string, RequestInit];

    expect(sessionUrl).toBe("/api/voice/session");
    expect(turnUrl).toBe("/api/voice/turn");

    const body = JSON.parse(String(turnInit.body)) as { persona: Record<string, unknown> };
    expect(Object.keys(body.persona).sort()).toEqual(["characterBrief", "id", "title"]);
    // The full script never crosses the wire — the AI tier does not use it.
    expect(body.persona).not.toHaveProperty("script");
  });
});

describe("createAiVoiceProvider — every failure ends the call cleanly", () => {
  it("emits error then ended when the session route is unconfigured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "voice_unconfigured", message: "not configured" }),
          { status: 503 },
        ),
      ),
    );

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.map((event) => event.type)).toEqual(["connecting", "error", "ended"]);
    expect(events[1]).toMatchObject({ type: "error" });
  });

  it("emits error then ended when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.map((event) => event.type)).toEqual(["connecting", "error", "ended"]);
  });

  it("emits error then ended when the mint response is malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 201 })),
    );

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.map((event) => event.type)).toEqual(["connecting", "error", "ended"]);
  });

  it("emits error then ended when the turn route fails mid-call", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(new Response("", { status: 500 })),
    );

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "connecting",
      "connected",
      "error",
      "ended",
    ]);
  });

  it("propagates a server error frame as an error event then ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          sseResponse([
            { event: "error", data: { code: "voice_upstream_failed", message: "upstream" } },
            { event: "ended", data: { reason: "error" } },
          ]),
        ),
    );

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "connecting",
      "connected",
      "error",
      "ended",
    ]);
    expect(events[2]).toMatchObject({ message: "upstream" });
  });

  it("survives a stream of garbage rather than hanging", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          new Response("event: line\ndata: {not json\n\nnonsense\n\n", { status: 200 }),
        ),
    );

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(
          PERSONA,
          new AbortController().signal,
        )
      ).events(),
    );

    expect(events.at(-1)?.type).toBe("ended");
    expect(events.map((event) => event.type)).toContain("connected");
  });

  it("keeps the call alive when speech synthesis throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValueOnce(
          sseResponse([
            { event: "line", data: { text: "Almost there." } },
            { event: "ended", data: { reason: "duration_cap" } },
          ]),
        ),
    );

    const speech = makeSpeech({
      speak: async () => {
        throw new Error("iOS ate the utterance");
      },
    });

    const events = await collect(
      (
        await createAiVoiceProvider({ speech }).start(PERSONA, new AbortController().signal)
      ).events(),
    );

    // The line still reached the UI — subtitles carry it when audio cannot.
    expect(events.map((event) => event.type)).toEqual([
      "connecting",
      "connected",
      "line",
      "ended",
    ]);
  });
});

describe("createAiVoiceProvider — hanging up", () => {
  it("stops the call and cancels speech when the caller hangs up", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(sessionResponse())
        .mockResolvedValue(
          sseResponse([
            { event: "line", data: { text: "Hey!" } },
            { event: "ended", data: { reason: "completed" } },
          ]),
        ),
    );

    const cancel = vi.fn();
    const session = await createAiVoiceProvider({
      speech: makeSpeech({ cancel }),
    }).start(PERSONA, new AbortController().signal);

    session.stop();
    const events = await collect(session.events());

    expect(cancel).toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe("ended");
  });

  it("ends cleanly when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("aborted")));

    const events = await collect(
      (
        await createAiVoiceProvider({ speech: makeSpeech() }).start(PERSONA, controller.signal)
      ).events(),
    );

    expect(events.at(-1)?.type).toBe("ended");
  });
});
