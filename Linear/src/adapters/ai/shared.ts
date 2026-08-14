import "server-only";

import type { AiFailure, AiProvider, AiResponse } from "@/ports/ai";

/**
 * The parts of an adapter that have nothing to do with which vendor it talks
 * to: how long to wait, how much to read, and how to turn an HTTP status into
 * something the UI can render.
 */

/**
 * The most of an upstream response this process will buffer, in bytes.
 *
 * Neither vendor sends anything close to this for the tasks in `index.ts` — a
 * four-sentence summary is a couple of kilobytes. The ceiling is not about
 * them: it is about everything *between* them and this process. A corporate
 * proxy's HTML block page, a load balancer's diagnostic dump, a gateway that
 * decides to inline a log — all of them arrive as a response body on the same
 * socket, and `await response.text()` buffers whatever it is handed. A 500 MB
 * error page is then held in a serverless function's memory allowance, which
 * on the free tier is the constraint that actually binds, and forwarded to a
 * browser that has to render it.
 *
 * 1 MB, because it is three orders of magnitude above the largest legitimate
 * response and still small enough to be irrelevant to a request's footprint.
 */
export const MAX_RESPONSE_BYTES = 1_000_000;

/**
 * The most generated text this port hands back, in characters.
 *
 * `max_tokens` is the control that *should* bound this, and it is sent on every
 * request — but it is the provider's promise, not ours, and a response is only
 * checked against it by the provider. This is the bound that holds when the
 * promise does not: the text goes into a React state and a `<textarea>`, and
 * neither has an opinion about length until the tab stops responding.
 *
 * Truncation is silent because the alternative — refusing a response that
 * arrived intact — throws away a usable answer over a formatting concern.
 */
export const MAX_TEXT_CHARS = 100_000;

/**
 * The most upstream prose that may reach a failure `message`, in characters.
 *
 * Far tighter than {@link MAX_TEXT_CHARS} because the destination is different:
 * generated text goes into an editor, a failure message goes into a toast.
 */
export const MAX_MESSAGE_CHARS = 200;

/**
 * Read a response body, refusing to buffer more than `limit` bytes.
 *
 * Returns `null` when the body is over the ceiling, which callers turn into a
 * typed failure. The stream is cancelled at that point rather than drained, so
 * an oversized body costs one chunk rather than all of it.
 *
 * `content-length` is consulted first because it lets an obvious case be
 * refused without reading anything — but it is a *hint*, absent under chunked
 * encoding and free to lie, so the running total is what actually enforces the
 * rule.
 */
export async function readCapped(
  response: Response,
  limit: number = MAX_RESPONSE_BYTES,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await cancel(response.body);
    return null;
  }

  const body = response.body;
  if (body === null) {
    // No stream to meter — an empty body, or a runtime that does not expose
    // one. `text()` is then bounded by whatever already arrived.
    const text = await response.text();
    return byteLength(text) > limit ? null : text;
  }

  // Cancelled through the *reader*, not the stream: `getReader` locks the
  // stream, and a `cancel` on a locked stream throws rather than releasing it,
  // which would leave the socket draining in the background — exactly what the
  // ceiling exists to prevent.
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await cancel(reader);
      return null;
    }
    // `stream: true` so a multi-byte character split across two chunks is not
    // decoded into two replacement characters.
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function cancel(
  target: { cancel(): Promise<void> } | null,
): Promise<void> {
  // A cancel that throws is not a failure worth reporting: the response is
  // being abandoned either way.
  await target?.cancel().catch(() => undefined);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Generated text, bounded. See {@link MAX_TEXT_CHARS}. */
export function capText(text: string, limit: number = MAX_TEXT_CHARS): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * The failure for a response this process refused to buffer.
 *
 * `retryable: false` — the size of a response is a property of what the other
 * end is doing, not of the moment, so a second attempt gets the same thing and
 * pays for it twice.
 */
export function oversizedResponse(provider: AiProvider): AiFailure {
  return {
    ok: false,
    reason: "upstream",
    provider,
    retryable: false,
    message: "The provider sent a response too large to read.",
  };
}

/** The failure for a 2xx whose body is not the JSON the vendor documents. */
export function unreadableResponse(provider: AiProvider): AiFailure {
  return {
    ok: false,
    reason: "upstream",
    provider,
    retryable: true,
    message: "The provider sent a response that could not be read.",
  };
}

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
      return capText(message, MAX_MESSAGE_CHARS);
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
 *
 * ## The contract with the adapters
 *
 * This function is the **only** thing that can tell a deadline from a caller
 * hanging up, because it is the only thing holding both signals. What arrives
 * at an adapter is one indistinguishable `AbortError` from `fetch`, so an
 * adapter that catches it — they all catch, to turn a network error into a
 * typed failure — must rethrow when its signal is aborted. Swallowing it
 * reports `upstream` (retryable, "the provider is unavailable") for what was
 * actually a timeout, and the retry affordance the UI draws from that is wrong
 * in both directions.
 *
 * A caller's own abort leaves through `throw`, deliberately: there is no
 * cancellation member in `AiFailure["reason"]` because there is nobody left to
 * render one. The route that passed the signal owns that case.
 */
export async function withTimeout(
  timeoutMs: number,
  external: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<AiResponse>,
): Promise<AiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const forward = () => controller.abort();
  // An already-aborted signal never fires `abort` again, so a caller who hung
  // up before this ran would otherwise get a full-price request nobody wants.
  if (external?.aborted === true) controller.abort();
  else external?.addEventListener("abort", forward, { once: true });

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
