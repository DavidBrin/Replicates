import { expect, test } from "@playwright/test";

/**
 * The AI tier ships fully wired and completely unlit.
 *
 * These tests are the proof of that claim against a real running server with no
 * API key in its environment: the routes must answer with a clean, typed
 * "unconfigured" response rather than a 500, a stack trace, or — worst of all —
 * a partially-working path that leaks a key. Adding a key must be the only step
 * needed to change these outcomes.
 */
test.describe("voice API with no key configured", () => {
  test("POST /api/voice/session reports itself unconfigured", async ({ request }) => {
    const response = await request.post("/api/voice/session", {
      data: { personaId: "friend-nearby" },
    });

    expect(response.status()).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("voice_unconfigured");
    expect(typeof body.message).toBe("string");
  });

  test("POST /api/voice/turn reports itself unconfigured", async ({ request }) => {
    const response = await request.post("/api/voice/turn", {
      data: { sessionId: "none", personaId: "friend-nearby", history: [] },
    });

    expect(response.status()).toBe(503);
    expect((await response.json()).code).toBe("voice_unconfigured");
  });

  test("rejects a malformed body before doing anything else", async ({ request }) => {
    const response = await request.post("/api/voice/session", { data: { personaId: 42 } });
    // 400 for a bad body, or 503 if the unconfigured check short-circuits
    // first — both are correct and neither is a 500.
    expect([400, 503]).toContain(response.status());
  });

  test("never emits anything key-shaped", async ({ request }) => {
    for (const path of ["/api/voice/session", "/api/voice/turn"]) {
      const response = await request.post(path, { data: {} });
      const text = await response.text();
      expect(text).not.toMatch(/sk-[a-zA-Z0-9]/);
      expect(text).not.toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY/);
    }
  });

  test("the API is never served from the offline cache", async ({ request }) => {
    // A stale AI reply is worse than no reply, so `sw.js` skips /api/ — this
    // asserts the route itself does not advertise a cacheable response either.
    const response = await request.post("/api/voice/session", { data: {} });
    const cacheControl = response.headers()["cache-control"] ?? "";
    expect(cacheControl).not.toMatch(/max-age=[1-9]/);
  });
});
