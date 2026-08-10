// @vitest-environment node

vi.mock("server-only", () => ({}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sessionRateLimiter } from "@/lib/voice/rate-limit";

import { POST } from "./route";

const SECRET = "sk-ant-session-route-secret-key";

/**
 * The machine running the suite may well have a real key exported. Every test
 * stubs the whole voice env explicitly so the result never depends on that.
 */
function useEnv(overrides: Record<string, string>): void {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("VOICE_PROVIDER", "");
  vi.stubEnv("AI_PROVIDER", "");
  vi.stubEnv("VOICE_CALL_MAX_DURATION_SECONDS", "");
  vi.stubEnv("VOICE_CALL_MAX_TOKENS", "");
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

function request(body: unknown, ip = "203.0.113.10"): Request {
  return new Request("https://fake-phone.test/api/voice/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  sessionRateLimiter.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/voice/session — unconfigured", () => {
  beforeEach(() => useEnv({}));

  it("returns 503 with the typed voice_unconfigured code", async () => {
    const response = await POST(request({ personaId: "friend-nearby" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "voice_unconfigured" });
  });

  it("returns 503 even for a request body that would otherwise be invalid", async () => {
    // Inertness beats validation: the unconfigured answer is the shortest path
    // through the handler, so nothing downstream of it can even run.
    const response = await POST(request({ nope: true }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "voice_unconfigured" });
  });

  it("still returns 503 when a key exists but VOICE_PROVIDER is the kill switch", async () => {
    useEnv({ ANTHROPIC_API_KEY: SECRET, VOICE_PROVIDER: "scripted" });

    const response = await POST(request({ personaId: "friend-nearby" }));

    expect(response.status).toBe(503);
  });

  it("consumes no rate-limit budget while inert", async () => {
    for (let i = 0; i < 10; i += 1) {
      const response = await POST(request({ personaId: "friend-nearby" }));
      expect(response.status).toBe(503);
    }
  });
});

describe("POST /api/voice/session — configured", () => {
  beforeEach(() => useEnv({ ANTHROPIC_API_KEY: SECRET }));

  it("mints a session with an id and an expiry", async () => {
    const response = await POST(request({ personaId: "friend-nearby" }));

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.sessionId).toBe("string");
    expect(String(body.sessionId).length).toBeGreaterThan(0);
    expect(typeof body.expiresAt).toBe("number");
    expect(Number(body.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("exposes the seam for a browser-direct provider as an explicit null", async () => {
    const response = await POST(request({ personaId: "friend-nearby" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toHaveProperty("ephemeralToken");
    expect(body.ephemeralToken).toBeNull();
  });

  it("tells the client the guardrails it must respect", async () => {
    useEnv({
      ANTHROPIC_API_KEY: SECRET,
      VOICE_CALL_MAX_DURATION_SECONDS: "120",
      VOICE_CALL_MAX_TOKENS: "800",
    });

    const body = (await (await POST(request({ personaId: "p" }))).json()) as Record<
      string,
      unknown
    >;

    expect(body.maxDurationSeconds).toBe(120);
    expect(body.maxTokens).toBe(800);
  });

  it("never includes the API key in the response", async () => {
    const response = await POST(request({ personaId: "friend-nearby" }));
    const text = await response.text();

    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET.slice(0, 10));
  });

  it("rejects a body with no personaId as 400", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });

  it("rejects a non-JSON body as 400", async () => {
    const response = await POST(request("this is not json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_request" });
  });

  it("rate-limits per client with a Retry-After header", async () => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 5; i += 1) {
      expect((await POST(request({ personaId: "p" }, ip))).status).toBe(201);
    }

    const limited = await POST(request({ personaId: "p" }, ip));

    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("limits per client rather than globally", async () => {
    for (let i = 0; i < 5; i += 1) {
      await POST(request({ personaId: "p" }, "198.51.100.8"));
    }

    const other = await POST(request({ personaId: "p" }, "198.51.100.9"));

    expect(other.status).toBe(201);
  });

  it("echoes a client call id back for log correlation", async () => {
    const response = await POST(request({ personaId: "p", clientCallId: "call-42" }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.clientCallId).toBe("call-42");
  });
});
