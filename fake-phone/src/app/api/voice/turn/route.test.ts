// @vitest-environment node

vi.mock("server-only", () => ({}));

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { turnRateLimiter } from "@/lib/voice/rate-limit";
import {
  mintVoiceSessionToken,
  voiceSessionSigningKey,
  type MintedVoiceSession,
} from "@/lib/voice/session-token";
import { voiceTokenBudget } from "@/lib/voice/token-budget";

import { POST } from "./route";

const SECRET = "sk-ant-turn-route-secret-key-0123456789";

const SESSION_TTL_MS = 600_000;

/**
 * The key the route will derive for itself, derived here the same way. Nothing
 * is shared between the mint and the turn except this — which is the point: on
 * Vercel they are two functions that share nothing else.
 */
let signingKey: CryptoKey;

/** The default session for tests that do not care which one they are on. */
let session: MintedVoiceSession;

beforeAll(async () => {
  const key = await voiceSessionSigningKey("ANTHROPIC_API_KEY", { ANTHROPIC_API_KEY: SECRET });
  if (!key) throw new Error("expected a signing key");
  signingKey = key;
});

/**
 * A session this deployment signed, which is now the only kind `/turn` will
 * serve. Tests that want a forged one pass a plausible string of their own.
 */
async function mintSession(personaId = "friend-nearby"): Promise<MintedVoiceSession> {
  return mintVoiceSessionToken(
    { personaId, issuedAt: Date.now(), ttlMs: SESSION_TTL_MS },
    signingKey,
  );
}

/** Puts spend on a session's ledger the way a completed turn would. */
function spend(sessionId: string, tokens: number): void {
  const reservation = voiceTokenBudget.reserve({
    sessionId,
    expiresAt: Date.now() + SESSION_TTL_MS,
    tokens,
    budget: Number.MAX_SAFE_INTEGER,
  });
  if (!reservation) throw new Error("expected the ledger to accept the spend");
  voiceTokenBudget.settle(reservation, tokens);
}

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
  readonly sessionId?: string;
  readonly transcript?: { role: "caller" | "user"; text: string }[];
}

function turnBody(overrides: TurnBodyOverrides = {}) {
  return {
    sessionId: overrides.sessionId ?? session.token,
    persona: {
      id: "friend-nearby",
      title: "A friend nearby",
      characterBrief: "A close friend two streets away, mildly impatient.",
    },
    callerName: "Mum",
    callerLabel: "mobile",
    transcript: overrides.transcript ?? [],
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

beforeEach(async () => {
  turnRateLimiter.reset();
  voiceTokenBudget.reset();
  session = await mintSession();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe("POST /api/voice/turn — the server is the accountant", () => {
  beforeEach(() => useEnv({ ANTHROPIC_API_KEY: SECRET }));

  it("refuses a session id it never signed, spending nothing", async () => {
    // The whole attack in one test: a well-formed body quoting an invented id.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(
      request(turnBody({ sessionId: "cf1f4b1e-0000-4000-8000-000000000000" })),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "session_not_found" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a token whose claims have been edited, spending nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const [body, signature] = session.token.split(".");
    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as {
      iat: number;
      exp: number;
    };
    // Rewind the clock and extend the call: the two things a caller would most
    // like to change, and the two the signature is there to nail down.
    claims.iat -= 3_600_000;
    claims.exp += 3_600_000;
    const forged = btoa(JSON.stringify(claims))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const response = await POST(request(turnBody({ sessionId: `${forged}.${signature}` })));

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a session signed by another deployment's key", async () => {
    const elsewhere = await voiceSessionSigningKey("ANTHROPIC_API_KEY", {
      ANTHROPIC_API_KEY: "sk-ant-some-other-deployment",
    });
    if (!elsewhere) throw new Error("expected a signing key");
    const foreign = await mintVoiceSessionToken(
      { personaId: "friend-nearby", issuedAt: Date.now(), ttlMs: SESSION_TTL_MS },
      elsewhere,
    );
    vi.stubGlobal("fetch", vi.fn());

    const response = await POST(request(turnBody({ sessionId: foreign.token })));

    expect(response.status).toBe(404);
  });

  it("refuses a session that has expired rather than serving it forever", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const expiring = await mintSession();
    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1000);
    vi.stubGlobal("fetch", vi.fn());

    const response = await POST(request(turnBody({ sessionId: expiring.token })));

    expect(response.status).toBe(404);
  });

  it("serves a session minted by an instance that shares nothing but the key", async () => {
    // The F1 regression. Nothing in this test hands the turn route any state:
    // the token is the whole of what crosses between the two functions, exactly
    // as it is between two serverless instances that never share a heap.
    const detached = await mintVoiceSessionToken(
      { personaId: "friend-nearby", issuedAt: Date.now(), ttlMs: SESSION_TTL_MS },
      signingKey,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicOk("Hey, I'm outside.")));

    const frames = parseSse(await (await POST(request(turnBody({ sessionId: detached.token })))).text());

    expect(frames.at(-1)?.data.reason).toBe("completed");
  });

  it("ignores client-supplied usage figures entirely", async () => {
    // A replayed body that resets its own spend to zero on every turn. The only
    // numbers that count are the server's, so this changes nothing.
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "900" });
    // A fresh `Response` per call: a body can only be read once.
    const fetchSpy = vi.fn().mockImplementation(async () => anthropicOk("Hey.", 300));
    vi.stubGlobal("fetch", fetchSpy);
    const { token } = await mintSession();

    // The identical body, replayed, insisting it has spent nothing each time.
    const replayed = { ...turnBody({ sessionId: token }), elapsedSeconds: 0, tokensUsed: 0 };
    await (await POST(request(replayed))).text();
    await (await POST(request(replayed))).text();
    const third = parseSse(await (await POST(request(replayed))).text());

    // 600 tokens spent, budget 900, wrap-up margin 400: the call is over, and
    // the body's own zeroes bought exactly nothing.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(third.at(-1)?.data.reason).toBe("token_cap");
  });

  it("accumulates usage across turns on the same session", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "2000" });
    const fetchSpy = vi.fn().mockImplementation(async () => anthropicOk("Nearly there.", 200));
    vi.stubGlobal("fetch", fetchSpy);
    const { token } = await mintSession();

    await (await POST(request(turnBody({ sessionId: token })))).text();
    await (await POST(request(turnBody({ sessionId: token })))).text();
    await (await POST(request(turnBody({ sessionId: token })))).text();

    // Each turn's ceiling is the call budget minus what the server has watched
    // this session spend — 2000, 1800, 1600 — clamped to the per-turn maximum.
    const ceilings = fetchSpy.mock.calls.map(
      (call) => (JSON.parse(String((call[1] as RequestInit).body)) as { max_tokens: number }).max_tokens,
    );
    expect(ceilings).toEqual([400, 400, 400]);

    // And the fourth turn on a nearly-spent budget stops before spending.
    const overspent = vi.fn().mockImplementation(async () => anthropicOk("x", 1000));
    vi.stubGlobal("fetch", overspent);
    await (await POST(request(turnBody({ sessionId: token })))).text();
    const capped = parseSse(await (await POST(request(turnBody({ sessionId: token })))).text());

    expect(capped.at(-1)?.data.reason).toBe("token_cap");
  });

  it("charges a turn even if the client never reads the stream", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicOk("Hey.", 77)));
    const { token, claims } = await mintSession();

    await (await POST(request(turnBody({ sessionId: token })))).text();

    expect(voiceTokenBudget.spent(claims.sessionId)).toBe(77);
  });

  it("holds the whole allowance while a turn is in flight, not after it", async () => {
    // A turn that is still running is money already committed. Costing it at
    // zero until it finishes is exactly what let three turns spend one budget.
    useEnv({ ANTHROPIC_API_KEY: SECRET });
    const { token, claims } = await mintSession();
    let observedMidTurn = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        observedMidTurn = voiceTokenBudget.spent(claims.sessionId);
        return anthropicOk("Hey.", 12);
      }),
    );

    await (await POST(request(turnBody({ sessionId: token })))).text();

    expect(observedMidTurn).toBe(400);
    expect(voiceTokenBudget.spent(claims.sessionId)).toBe(12);
  });

  it("gives the allowance back when the turn fails", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET });
    const { token, claims } = await mintSession();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await (await POST(request(turnBody({ sessionId: token })))).text();

    // A call that hits one flaky turn must not quietly lose 400 tokens of budget.
    expect(voiceTokenBudget.spent(claims.sessionId)).toBe(0);
  });

  it("cannot be made to spend more than the budget by overlapping turns", async () => {
    // The F2 regression. Three turns start together, each on the same nearly
    // full budget; with the allowance recorded only *after* the model returns,
    // all three saw zero spent, all three were granted 400, and an 800-token
    // call spent 1,200.
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "800" });
    const { token, claims } = await mintSession();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchSpy = vi.fn().mockImplementation(async () => {
      // Every turn is inside the model call at the same time — the `await` that
      // used to sit between reading the budget and writing to it.
      await held;
      return anthropicOk("Hey.", 400);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const inFlight = [
      POST(request(turnBody({ sessionId: token }))),
      POST(request(turnBody({ sessionId: token }))),
      POST(request(turnBody({ sessionId: token }))),
    ];
    const bodies = await Promise.all(inFlight);
    release();
    const streams = await Promise.all(bodies.map((response) => response.text()));

    const granted = fetchSpy.mock.calls.map(
      (call) =>
        (JSON.parse(String((call[1] as RequestInit).body)) as { max_tokens: number }).max_tokens,
    );
    const total = granted.reduce((sum, tokens) => sum + tokens, 0);

    expect(total).toBeLessThanOrEqual(800);
    expect(voiceTokenBudget.spent(claims.sessionId)).toBeLessThanOrEqual(800);
    // The turn that could not be covered ends the call in persona rather than
    // running on credit.
    expect(streams.map((raw) => parseSse(raw).at(-1)?.data.reason)).toContain("token_cap");
  });
});

describe("POST /api/voice/turn — cost guardrails", () => {
  it("ends the call in persona once the duration cap is in sight, spending nothing", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_DURATION_SECONDS: "60" });
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { token } = await mintSession();
    // Elapsed is measured from the signed mint time, not from anything the
    // caller claims — and the caller here claims it has been going no time at all.
    vi.setSystemTime(Date.now() + 45_000);

    const response = await POST(
      request({ ...turnBody({ sessionId: token }), elapsedSeconds: 0 }),
    );
    const frames = parseSse(await response.text());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(frames.map((frame) => frame.event)).toEqual(["connected", "line", "ended"]);
    expect(frames[1].data.text).toEqual(expect.any(String));
    expect(String(frames[1].data.text).length).toBeGreaterThan(0);
    expect(frames[2].data.reason).toBe("duration_cap");
  });

  it("still runs a turn comfortably inside the duration cap", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_DURATION_SECONDS: "60" });
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Still walking."));
    vi.stubGlobal("fetch", fetchSpy);

    const { token } = await mintSession();
    vi.setSystemTime(Date.now() + 10_000);

    const frames = parseSse(await (await POST(request(turnBody({ sessionId: token })))).text());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(frames.at(-1)?.data.reason).toBe("completed");
  });

  it("ends the call once the token budget is spent, spending nothing", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "900" });
    const { token, claims } = await mintSession();
    spend(claims.sessionId, 520);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const frames = parseSse(await (await POST(request(turnBody({ sessionId: token })))).text());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(frames.at(-1)?.data.reason).toBe("token_cap");
  });

  it("never asks upstream for more tokens than the call has left", async () => {
    // At the tightest point a turn can legally start — one token inside the
    // wrap-up margin, on the smallest accepted budget — the request still fits
    // inside what remains.
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_CALL_MAX_TOKENS: "800" });
    const { token, claims } = await mintSession();
    spend(claims.sessionId, 399);

    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Almost there."));
    vi.stubGlobal("fetch", fetchSpy);

    await (await POST(request(turnBody({ sessionId: token })))).text();

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      max_tokens: number;
    };

    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.max_tokens).toBeLessThanOrEqual(800 - 399);
    expect(body.max_tokens).toBeLessThanOrEqual(400);
  });

  it("lets the smallest accepted budget place at least one real call", async () => {
    // The floors in `config.ts` are derived from the wrap-up margins precisely so
    // that this can never be false: a budget that is capped from turn one is a
    // call in which the model is never reached.
    useEnv({
      ANTHROPIC_API_KEY: SECRET,
      VOICE_CALL_MAX_DURATION_SECONDS: "40",
      VOICE_CALL_MAX_TOKENS: "800",
    });
    const fetchSpy = vi.fn().mockResolvedValue(anthropicOk("Hey, I'm outside."));
    vi.stubGlobal("fetch", fetchSpy);

    const frames = parseSse(await (await POST(request(turnBody()))).text());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(frames.map((frame) => frame.event)).toContain("line");
    expect(frames.at(-1)?.data.reason).toBe("completed");
  });
});

describe("POST /api/voice/turn — an unsupported provider", () => {
  it("is treated as unconfigured rather than a framework 500", async () => {
    // `AI_PROVIDER=openai` with a key used to satisfy the config check, mint a
    // session, and then throw out of the model resolver before any SSE framing
    // existed — reaching the browser as an untyped 500 it had no branch for.
    useEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: SECRET });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await POST(request(turnBody()));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "voice_unconfigured" });
    expect(fetchSpy).not.toHaveBeenCalled();
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
