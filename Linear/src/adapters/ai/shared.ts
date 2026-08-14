import "server-only";

import type { AiFailure, AiProvider, AiResponse } from "@/ports/ai";

/**
 * The parts of an adapter that have nothing to do with which vendor it talks
 * to: how long to wait, and how to turn an HTTP status into something the UI
 * can render.
 */

/**
 * Turn a non-2xx into a typed failure.
 *
 * The upstream body is *not* forwarded verbatim. Vendor error payloads echo
 * request fragments, and a request body here contains the user's issue text —
 * so a rendered error could leak one workspace's content into another user's
 * screen. Only the status is trusted; the body is used to pick a message and
 * then discarded.
 */
export function classifyHttpFailure(
  provider: AiProvider,
  status: number,
  body: string,
): AiFailure {
  const detail = extractMessage(body);

  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "unconfigured",
      provider,
      retryable: false,
      message: "The configured API key was rejected.",
    };
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      provider,
      retryable: true,
      message: "Rate limited by the provider. Try again shortly.",
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      reason: "upstream",
      provider,
      retryable: true,
      message: "The provider is unavailable. Try again shortly.",
    };
  }
  return {
    ok: false,
    reason: "invalid_request",
    provider,
    retryable: false,
    message: detail ?? `The provider rejected the request (${status}).`,
  };
}

/**
 * Pull a short message out of a vendor error body, if it looks like one.
 *
 * Both vendors nest it at `error.message`. Truncated hard, because this string
 * reaches a toast and an unbounded upstream string does not belong there.
 */
function extractMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === "string" && message.length > 0) {
      return message.slice(0, 200);
    }
  } catch {
    // Not JSON. Nothing worth surfacing.
  }
  return null;
}

/**
 * Run `fn` with a deadline, honouring a caller's own abort signal too.
 *
 * A hung upstream request on a serverless host is not just a slow response —
 * it is billed wall-clock against a memory allowance that, on the free tier,
 * is the constraint that actually binds. The timeout is the adapter's, not the
 * caller's, so no route handler can forget it.
 */
export async function withTimeout(
  timeoutMs: number,
  external: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<AiResponse>,
): Promise<AiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const forward = () => controller.abort();
  external?.addEventListener("abort", forward, { once: true });

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && !external?.aborted) {
      return {
        ok: false,
        reason: "timeout",
        provider: "none",
        retryable: true,
        message: `The provider did not respond within ${Math.round(timeoutMs / 1000)}s.`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", forward);
  }
}
