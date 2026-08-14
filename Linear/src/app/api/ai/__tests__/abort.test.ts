// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { setDbForTests, type SqlDatabase } from "@/adapters/db";
import {
  createFixture,
  createTestDatabase,
  type Fixture,
} from "@/adapters/repositories/__tests__/harness";
import { createSession, sessionCookieName } from "@/lib/auth/session";
import type { AiOptions, AiResponse, AiTask } from "@/ports/ai";

/**
 * Hanging up has to cancel the paid work.
 *
 * This is the endpoint that spends money. Every other failure mode here is
 * about privacy; this one is about a bill. A user who opens the summary panel
 * and immediately navigates away closes the connection, and the handler used to
 * carry on: the provider call ran to completion — or to the 60 second timeout —
 * and was charged for an answer that no longer had anywhere to go. Bulk-select
 * five issues and change your mind, and that is five.
 *
 * The fix is one argument, which is exactly why it needs a test: `request.signal`
 * is easy to leave out and impossible to notice missing, because everything
 * still works. So the assertion is not that *a* signal was passed but that the
 * one passed is genuinely the caller's — a fresh `AbortController` handed over
 * to look tidy would satisfy a weaker test and cancel nothing.
 */

/** Captured so the assertions can inspect what the handler forwarded. */
const runAiTask = vi.hoisted(() =>
  vi.fn<(task: AiTask, input: string, options?: AiOptions) => Promise<AiResponse>>(),
);

vi.mock("@/adapters/ai", () => ({ runAiTask }));

const { POST } = await import("@/app/api/ai/route");

let db: SqlDatabase;
let dispose: () => Promise<void>;
let fixture: Fixture;

const OK: AiResponse = {
  ok: true,
  text: "A summary.",
  provider: "anthropic",
  model: "claude-opus-5",
  usage: { inputTokens: 10, outputTokens: 4 },
};

beforeAll(async () => {
  db = await createTestDatabase();
  dispose = setDbForTests(db);
  fixture = await createFixture(db);
}, 60_000);

afterAll(async () => {
  await dispose();
});

afterEach(() => {
  runAiTask.mockReset();
});

/** A signed-in POST whose connection the test can close. */
async function request(signal?: AbortSignal): Promise<Request> {
  const session = await createSession(fixture.ownerId, { db });
  return new Request("http://x/api/ai", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${sessionCookieName()}=${session.token}`,
    },
    body: JSON.stringify({
      workspaceId: fixture.workspaceId,
      task: "summarize",
      input: "Something worth summarising.",
    }),
    ...(signal ? { signal } : {}),
  });
}

describe("POST /api/ai", () => {
  it("hands the provider call the caller's own abort signal", async () => {
    let observed: AbortSignal | undefined;
    runAiTask.mockImplementation(async (_task, _input, options) => {
      observed = options?.signal;
      return OK;
    });

    const caller = new AbortController();
    const response = await POST(await request(caller.signal));

    expect(response.status).toBe(200);
    expect(observed).toBeDefined();

    // The proof that it is the *caller's* signal and not a decorative one: it
    // follows the controller that stands for the closed connection.
    expect(observed?.aborted).toBe(false);
    caller.abort();
    expect(observed?.aborted).toBe(true);
  });

  it("answers 499 when the caller goes away mid-flight", async () => {
    // What `withTimeout` does with a caller's abort: rethrows it, because there
    // is no cancellation member in `AiFailure["reason"]` and nobody left to
    // render one. The handler must not turn that into an unhandled 500.
    runAiTask.mockImplementation(
      (_task, _input, options) =>
        new Promise<AiResponse>((_resolve, reject) => {
          const signal = options?.signal;
          const abandon = () =>
            reject(new DOMException("The operation was aborted.", "AbortError"));
          // Both orders, because the handler does real work — a session lookup
          // and a membership read — before it gets here, and an already-aborted
          // signal never fires `abort` again.
          if (signal?.aborted === true) abandon();
          else signal?.addEventListener("abort", abandon, { once: true });
        }),
    );

    const caller = new AbortController();
    const pending = POST(await request(caller.signal));
    caller.abort();

    expect((await pending).status).toBe(499);
  });

  it("still lets a real failure out rather than blaming the caller", async () => {
    runAiTask.mockRejectedValue(new Error("a bug in the adapter"));

    await expect(POST(await request())).rejects.toThrow("a bug in the adapter");
  });

  it("still answers normally when nobody hangs up", async () => {
    runAiTask.mockResolvedValue(OK);

    const response = await POST(await request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, text: "A summary." });
  });
});
