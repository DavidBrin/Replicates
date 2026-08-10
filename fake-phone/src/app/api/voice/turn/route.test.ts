// @vitest-environment node

vi.mock("server-only", () => ({}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { turnRateLimiter } from "@/lib/voice/rate-limit";

import { POST } from "./route";

const SECRET = "sk-ant-turn-route-secret-key-0123456789";

function useEnv(overrides: Record<string, string> = {}): void {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("VOICE_PROVIDER", "");
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("VOICE_CALL_MAX_DURATION_SECONDS", "");
  vi.stubEnv("VOICE_CALL_MAX_TOKENS", "");
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

interface TurnBodyOverrides {
  readonly elapsedSeconds?: number;
  readonly tokensUsed?: number;
  readonly transcript?: { role: "caller" | "user"; text: string }[];
}

function turnBody(overrides: TurnBodyOverrides = {}) {
  return {
    sessionId: "session-1",
    persona: {
      id: "friend-nearby",
      title: "A friend nearby",
      characterBrief: "A close friend two streets away, mildly impatient.",
    },
    callerName: "Mum",
    callerLabel: "mobile",
    transcript: overrides.transcript ?? [],
    elapsedSeconds: overrides.elapsedSeconds ?? 0,
    tokensUsed: overrides.tokensUsed ?? 0,
  };
}

function request(body: unknown, ip = "203.0.113.20"): Request {
  return new Request("https://fake-phone.test/api/voice/turn", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A minimal, well-formed Anthropic Messages response. */
function anthropicOk(text: string, outputTokens = 23): Response {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 500, output_tokens: outputTokens },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Splits an SSE body into `{ event, data }` pairs, asserting the framing. */
function parseSse(raw: string): { event: string; data: Record<string, unknown> }[] {
  expect(raw.endsWith("\n\n")).toBe(true);

  return raw
    .split("\n\n")
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const lines = frame.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0].startsWith("event: ")).toBe(true);
      expect(lines[1].startsWith("data: ")).toBe(true);
      return {
        event: lines[0].slice("event: ".length),
        data: JSON.parse(lines[1].slice("data: ".length)) as Record<string, unknown>,
      };
    });
}

beforeEach(() => {
  turnRateLimiter.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/voice/turn — unconfigured", () => {
  beforeEach(() => useEnv());

  it("returns 503 with the typed code and no stream at all", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(request(turnBody()));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ code: "voice_unconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 503 rather than 400 for a malformed body", async () => {
    const response = await POST(request("{{{"));

    expect(response.status).toBe(503);
  });
});

describe("POST /api/voice/turn — validation", () => {
  beforeEach(() => useEnv({ ANTHROPIC_API_KEY: SECRET }));

  it("rejects a body with no persona as 400", async () => {
    const response = await POST(request({ sessionId: "s" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });

  it("rejects an oversized character brief as 400", async () => {
    const body = turnBody();
    const response = await POST(
      request({ ...body, persona: { ...body.persona, characterBrief: "x".repeat(5000) } }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects a transcript turn with an unknown role as 400", async () => {
    const response = await POST(
      request({
        ...turnBody(),
        transcript: [{ role: "narrator", text: "hello" }],
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects non-JSON as 400", async () => {
    const response = await POST(request("not json at all"));

    expect(response.status).toBe(400);
  });
});

describe("POST /api/voice/turn — the happy path", () => {
  beforeEach(() => useEnv({ ANTHROPIC_API_KEY: SECRET }));

  it("streams a well-formed SSE conversation turn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicOk("Hey, I'm two minutes away.")));

    const response = await POST(request(turnBody()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-transform");

    const frames = parseSse(await response.text());

    expect(frames.map((frame) => frame.event)).toEqual([
      "connected",
      "line",
      "usage",
      "listening",
      "ended",
    ]);
    expect(frames[1].data.text).toBe("Hey, I'm two minutes away.");
    expect(frames[2].data.outputTokens).toBe(23);
    expect(frames[4].data.reason).toBe("completed");
  });

  it("sends the key as a header on the outgoing request and nowhere else", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("On my way."));
    vi.stubGlobal("fetch", fetchSpy);

    await (await POST(request(turnBody()))).text();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(SECRET);
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // Never in the URL and never in the body — headers only.
    expect(url).not.toContain(SECRET);
    expect(String(init.body)).not.toContain(SECRET);
  });

  it("never lets the key reach the response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicOk("Nearly there.")));

    const text = await (await POST(request(turnBody()))).text();

    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, 12));
  });

  it("sends the guardrails and the persona brief as the system prompt", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Nearly there."));
    vi.stubGlobal("fetch", fetchSpy);

    await (await POST(request(turnBody()))).text();

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      system: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };

    expect(body.system).toContain("HARD RULES");
    expect(body.system).toContain("mildly impatient");
    // An empty transcript still opens with a user turn — the API requires it.
    expect(body.messages[0].role).toBe("user");
  });

  it("maps caller turns to assistant turns for the provider", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Two minutes."));
    vi.stubGlobal("fetch", fetchSpy);

    await (
      await POST(
        request(
          turnBody({
            transcript: [
              { role: "user", text: "Hi?" },
              { role: "caller", text: "Hey, it's me." },
              { role: "user", text: "Where are you?" },
            ],
          }),
        ),
      )
    ).text();

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      messages: { role: string; content: string }[];
    };

    expect(body.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });
});

describe("POST /api/voice/turn — cost guardrails", () => {
  it("ends the call in persona once the duration cap is in sight, spending nothing", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_DURATION_SECONDS: "60" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(request(turnBody({ elapsedSeconds: 45 })));
    const frames = parseSse(await response.text());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(frames.map((frame) => frame.event)).toEqual(["connected", "line", "ended"]);
    expect(frames[1].data.text).toEqual(expect.any(String));
    expect(String(frames[1].data.text).length).toBeGreaterThan(0);
    expect(frames[2].data.reason).toBe("duration_cap");
  });

  it("still runs a turn comfortably inside the duration cap", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_DURATION_SECONDS: "60" });
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Still walking."));
    vi.stubGlobal("fetch", fetchSpy);

    const frames = parseSse(await (await POST(request(turnBody({ elapsedSeconds: 10 })))).text());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(frames.at(-1)?.data.reason).toBe("completed");
  });

  it("ends the call once the token budget is spent, spending nothing", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "500" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const frames = parseSse(await (await POST(request(turnBody({ tokensUsed: 480 })))).text());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(frames.at(-1)?.data.reason).toBe("token_cap");
  });

  it("caps a single turn's max_tokens against the remaining call budget", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "600" });
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Almost there."));
    vi.stubGlobal("fetch", fetchSpy);

    await (await POST(request(turnBody({ tokensUsed: 150 })))).text();

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      max_tokens: number;
    };

    expect(body.max_tokens).toBeLessThanOrEqual(450);
    expect(body.max_tokens).toBeGreaterThan(0);
  });
});

describe("POST /api/voice/turn — failure is still a clean call", () => {
  beforeEach(() => useEnv({ ANTHROPIC_API_KEY: SECRET }));

  it("emits error then ended when the provider rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: `key was ${SECRET}` } }), {
          status: 401,
        }),
      ),
    );

    const frames = parseSse(await (await POST(request(turnBody()))).text());

    expect(frames.map((frame) => frame.event)).toEqual(["connected", "error", "ended"]);
    expect(frames[1].data.code).toBe("voice_upstream_failed");
    expect(frames.at(-1)?.data.reason).toBe("error");
  });

  it("never echoes an upstream error body into the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: `leaked ${SECRET}` } }), {
          status: 400,
        }),
      ),
    );

    const text = await (await POST(request(turnBody()))).text();

    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("leaked");
  });

  it("emits error then ended when the network is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const frames = parseSse(await (await POST(request(turnBody()))).text());

    expect(frames.map((frame) => frame.event)).toEqual(["connected", "error", "ended"]);
  });

  it("ends the call in persona rather than erroring on a safety refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ content: [], stop_reason: "refusal" }), { status: 200 }),
      ),
    );

    const frames = parseSse(await (await POST(request(turnBody()))).text());

    expect(frames.map((frame) => frame.event)).toEqual(["connected", "line", "ended"]);
    expect(frames.at(-1)?.data.reason).toBe("completed");
  });

  it("treats a response with no spoken line as an error, not an empty line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: "text", text: "   " }] }), {
          status: 200,
        }),
      ),
    );

    const frames = parseSse(await (await POST(request(turnBody()))).text());

    expect(frames.map((frame) => frame.event)).toEqual(["connected", "error", "ended"]);
  });

  it("rate-limits the turn route too", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicOk("Hi.")));
    const ip = "198.51.100.30";

    for (let i = 0; i < 60; i += 1) {
      const response = await POST(request(turnBody(), ip));
      expect(response.status).toBe(200);
      await response.text();
    }

    const limited = await POST(request(turnBody(), ip));

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
  });
});
