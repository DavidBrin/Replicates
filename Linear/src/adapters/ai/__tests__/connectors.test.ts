// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetConfigForTests } from "@/config/env";

import { AnthropicConnector } from "../anthropic";
import { DisabledConnector } from "../index";
import { OpenAiConnector } from "../openai";

/**
 * The connectors are tested against a stubbed `fetch` rather than the live
 * APIs. What is worth asserting is not that the vendors work — it is that this
 * code sends the shape they document and survives the shapes they send back,
 * including the ones that are easy to forget: a refusal that arrives as a 200,
 * an error body that must not be forwarded verbatim, and a missing key that
 * must not throw.
 */

const BASE = {
  baseUrl: "https://api.test",
  maxTokens: 1024,
  timeoutMs: 5_000,
};

const anthropic = (apiKey: string | undefined) =>
  new AnthropicConnector({
    ...BASE,
    apiKey,
    model: "claude-opus-5",
    apiVersion: "2023-06-01",
    effort: "low",
  });

const openai = (apiKey: string | undefined) =>
  new OpenAiConnector({ ...BASE, apiKey, model: "gpt-5" });

/** One recorded request, in the shape the assertions actually want. */
interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Stub `fetch` and record each call in a already-parsed form.
 *
 * Returning the raw `vi.fn` would make every assertion re-derive the same
 * three things from `mock.calls[0]![1]!.body` — and under
 * `noUncheckedIndexedAccess` that is a chain of non-null assertions in each
 * test. Recording once keeps the assertions about the wire shape rather than
 * about tuple indexing.
 */
function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const options = init ?? {};
      calls.push({
        url: String(input),
        headers: (options.headers ?? {}) as Record<string, string>,
        body:
          typeof options.body === "string"
            ? (JSON.parse(options.body) as Record<string, unknown>)
            : {},
      });
      return handler(String(input), options);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resetConfigForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an unconfigured connector", () => {
  it("reports a typed failure instead of throwing", async () => {
    const result = await anthropic(undefined).complete([
      { role: "user", content: "hi" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unconfigured");
      expect(result.retryable).toBe(false);
    }
  });

  it("does not call the network", async () => {
    const calls = stubFetch(() => json({}));
    await openai(undefined).complete([{ role: "user", content: "hi" }]);
    expect(calls).toHaveLength(0);
  });

  it("is what the disabled adapter always does", async () => {
    const connector = new DisabledConnector();
    expect(connector.configured).toBe(false);
    const result = await connector.complete();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unconfigured");
  });
});

describe("the Anthropic wire shape", () => {
  it("sends the system prompt top-level, not as a message", async () => {
    const calls = stubFetch(() =>
      json({ content: [{ type: "text", text: "ok" }], model: "claude-opus-5" }),
    );

    await anthropic("k").complete([{ role: "user", content: "hello" }], {
      system: "be brief",
    });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.test/v1/messages");
    expect(call.body.system).toBe("be brief");
    expect(call.body.messages).toEqual([{ role: "user", content: "hello" }]);
    // The single most common porting mistake: a `role: "system"` message.
    const messages = call.body.messages as AiWireMessage[];
    expect(messages.some((m) => m.role === "system")).toBe(false);
  });

  it("sends the documented headers", async () => {
    const calls = stubFetch(() => json({ content: [] }));
    await anthropic("secret-key").complete([{ role: "user", content: "x" }]);
    expect(calls[0]!.headers["x-api-key"]).toBe("secret-key");
    expect(calls[0]!.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("never sends sampling parameters, which this model family rejects", async () => {
    const calls = stubFetch(() => json({ content: [] }));
    await anthropic("k").complete([{ role: "user", content: "x" }], {
      effort: "high",
    });
    const body = calls[0]!.body;
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("joins every text block rather than reading index 0", async () => {
    stubFetch(() =>
      json({
        content: [
          { type: "thinking", text: "ignored" },
          { type: "text", text: "one " },
          { type: "text", text: "two" },
        ],
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
    );
    const result = await anthropic("k").complete([{ role: "user", content: "x" }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("one two");
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    }
  });

  it("treats a refusal as a content outcome, not a crash", async () => {
    // A refusal is HTTP 200 with an empty content array. Reading
    // `content[0].text` here is how this becomes a TypeError in production.
    stubFetch(() =>
      json({
        content: [],
        stop_reason: "refusal",
        stop_details: { category: "cyber", explanation: "Declined." },
      }),
    );
    const result = await anthropic("k").complete([{ role: "user", content: "x" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("refused");
      expect(result.retryable).toBe(false);
      expect(result.message).toBe("Declined.");
    }
  });
});

describe("the OpenAI wire shape", () => {
  it("uses the Responses endpoint with bearer auth and instructions", async () => {
    const calls = stubFetch(() => json({ output_text: "ok", model: "gpt-5" }));

    await openai("k").complete([{ role: "user", content: "hello" }], {
      system: "be brief",
      effort: "medium",
    });

    const call = calls[0]!;
    expect(call.url).toBe("https://api.test/v1/responses");
    expect(call.headers.authorization).toBe("Bearer k");
    expect(call.body.instructions).toBe("be brief");
    expect(call.body.reasoning).toEqual({ effort: "medium" });
    expect(call.body.max_output_tokens).toBe(1024);
  });

  it("prefers output_text but can walk the block structure", async () => {
    stubFetch(() =>
      json({
        output: [
          { type: "reasoning", content: [] },
          { type: "message", content: [{ type: "output_text", text: "walked" }] },
        ],
      }),
    );
    const result = await openai("k").complete([{ role: "user", content: "x" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("walked");
  });

  it("reports a truncated response rather than returning half an answer", async () => {
    stubFetch(() =>
      json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    );
    const result = await openai("k").complete([{ role: "user", content: "x" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("upstream");
  });
});

describe("failure classification", () => {
  const cases = [
    { status: 401, reason: "unconfigured", retryable: false },
    { status: 429, reason: "rate_limited", retryable: true },
    { status: 500, reason: "upstream", retryable: true },
    { status: 400, reason: "invalid_request", retryable: false },
  ] as const;

  for (const { status, reason, retryable } of cases) {
    it(`maps ${status} to ${reason}`, async () => {
      stubFetch(() => json({ error: { message: "upstream detail" } }, status));
      const result = await anthropic("k").complete([
        { role: "user", content: "x" },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(reason);
        expect(result.retryable).toBe(retryable);
      }
    });
  }

  it("does not forward the upstream body on a server error", async () => {
    // Vendor error payloads echo request fragments, and a request body here
    // contains the user's issue text.
    stubFetch(() =>
      json({ error: { message: "echo of PRIVATE ISSUE TEXT" } }, 500),
    );
    const result = await anthropic("k").complete([
      { role: "user", content: "PRIVATE ISSUE TEXT" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain("PRIVATE ISSUE TEXT");
  });

  it("survives a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await openai("k").complete([{ role: "user", content: "x" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("upstream");
      expect(result.retryable).toBe(true);
    }
  });
});

describe("streaming", () => {
  it("falls back to a single chunk when an adapter has no stream path", async () => {
    stubFetch(() => json({ content: [{ type: "text", text: "whole thing" }] }));
    const chunks: string[] = [];
    const generator = anthropic("k").stream([{ role: "user", content: "x" }]);
    let next = await generator.next();
    while (!next.done) {
      chunks.push(next.value);
      next = await generator.next();
    }
    expect(chunks).toEqual(["whole thing"]);
    expect(next.value.ok).toBe(true);
  });
});

interface AiWireMessage {
  role: string;
  content: string;
}
