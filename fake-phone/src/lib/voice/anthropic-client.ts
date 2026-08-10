/**
 * The Anthropic implementation of `TextModelClient`.
 *
 * Two deviations from `research/ai-voice-architecture.md`, both deliberate:
 *
 *   1. **No SDK.** The research sketches `@anthropic-ai/sdk` usage; this repo
 *      adds no dependency for one `POST`. The Messages API is a single JSON
 *      request, so `fetch` costs nothing and keeps the bundle and the audit
 *      surface small.
 *   2. **Non-streaming upstream.** The research recommends streaming Claude and
 *      chunking at sentence boundaries (§5) — that is right for a *long* reply
 *      being fed to a TTS vendor. Here every turn is a single short line by
 *      construction (the guardrails forbid monologues), so streaming the
 *      upstream would add a parser and buy back a few tens of milliseconds.
 *      The browser still receives SSE (§2.3); the streaming boundary just sits
 *      at our own route instead of Anthropic's.
 *
 * The key is read from `process.env` here, on the line that uses it, and is
 * never returned, stored, or logged. Upstream error bodies are discarded rather
 * than forwarded — they are the one place a misconfigured proxy could echo an
 * `x-api-key` header back at us.
 */

import "server-only";

import { API_KEY_ENV_VARS } from "./config";
import {
  type TextModelClient,
  type TextModelRequest,
  type TextModelResult,
  VoiceModelError,
} from "./model-client";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * The house model. `claude-opus-5` is this repo's default Claude; the id is a
 * fixed alias with no date suffix, so it does not rot.
 *
 * Thinking is on by default on this model and `effort: "low"` is what keeps a
 * one-line conversational turn inside the latency budget in
 * `research/ai-voice-architecture.md` §5. We do NOT disable thinking outright:
 * with thinking off this model family occasionally leaks internal tags into the
 * visible text, and a `<thinking>` fragment spoken aloud mid-call is a far worse
 * failure than 200ms of latency.
 */
export const CLAUDE_MODEL_ID = "claude-opus-5";
export const CLAUDE_EFFORT = "low";

/** Sent when the transcript opens on the caller's side (i.e. the call just connected). */
const OPENING_CUE =
  "(The call has just connected and they have picked up. Speak your opening line.)";

interface AnthropicTextBlock {
  readonly type: string;
  readonly text?: unknown;
}

interface AnthropicResponse {
  readonly content?: readonly AnthropicTextBlock[];
  readonly stop_reason?: unknown;
  readonly usage?: { readonly output_tokens?: unknown };
}

export interface AnthropicClientOptions {
  /** Injected in tests. Defaults to the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly model?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function createAnthropicTextClient(
  options: AnthropicClientOptions = {},
): TextModelClient {
  const model = options.model ?? CLAUDE_MODEL_ID;

  return {
    id: `anthropic:${model}`,

    async complete(request: TextModelRequest): Promise<TextModelResult> {
      const env = options.env ?? process.env;
      const apiKey = env[API_KEY_ENV_VARS.anthropic]?.trim();
      if (!apiKey) {
        // Defence in depth: the route already refused with 503. Reaching here
        // means a config check was skipped, so fail loudly rather than call out.
        throw new VoiceModelError("not_configured", "No Anthropic API key configured.");
      }

      const doFetch = options.fetchImpl ?? fetch;
      let response: Response;
      try {
        response = await doFetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          signal: request.signal,
          headers: {
            "content-type": "application/json",
            "anthropic-version": ANTHROPIC_VERSION,
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            model,
            max_tokens: request.maxTokens,
            system: request.systemPrompt,
            output_config: { effort: CLAUDE_EFFORT },
            messages: toAnthropicMessages(request.transcript),
          }),
        });
      } catch (cause) {
        throw new VoiceModelError(
          "upstream_unavailable",
          `Could not reach the model provider: ${describe(cause)}`,
        );
      }

      if (!response.ok) {
        // The body is intentionally not read: it is upstream-controlled text and
        // has no business anywhere near a response we serve.
        throw new VoiceModelError(
          response.status >= 500 ? "upstream_unavailable" : "upstream_rejected",
          `Model provider returned ${response.status}.`,
        );
      }

      let payload: AnthropicResponse;
      try {
        payload = (await response.json()) as AnthropicResponse;
      } catch {
        throw new VoiceModelError("malformed_response", "Model response was not JSON.");
      }

      const stopReason = typeof payload.stop_reason === "string" ? payload.stop_reason : null;
      if (stopReason === "refusal") {
        // A safety decline is a normal 200 on this model family. Treated as its
        // own code so the route can end the call in-persona rather than error.
        throw new VoiceModelError("refused", "Model declined to continue the call.");
      }

      const text = (payload.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => String(block.text))
        .join("")
        .trim();

      if (!text) {
        throw new VoiceModelError("malformed_response", "Model returned no spoken line.");
      }

      const outputTokens =
        typeof payload.usage?.output_tokens === "number" && payload.usage.output_tokens >= 0
          ? Math.round(payload.usage.output_tokens)
          : estimateTokens(text);

      return { text: collapseToOneLine(text), outputTokens, stopReason };
    },
  };
}

/**
 * The transcript is provider-agnostic (`caller` / `user`); Anthropic wants
 * `assistant` / `user` and requires the first message to be a user turn, so an
 * opening cue is prepended whenever the caller speaks first.
 */
function toAnthropicMessages(
  transcript: readonly { role: "caller" | "user"; text: string }[],
): { role: "assistant" | "user"; content: string }[] {
  const mapped = transcript
    .filter((turn) => turn.text.trim().length > 0)
    .map((turn) => ({
      role: turn.role === "caller" ? ("assistant" as const) : ("user" as const),
      content: turn.text.trim(),
    }));

  if (mapped.length === 0 || mapped[0].role !== "user") {
    mapped.unshift({ role: "user", content: OPENING_CUE });
  }
  return mapped;
}

/**
 * Speech synthesis reads newlines as pauses and asterisks aloud on some
 * platforms. One line in, one line out.
 */
function collapseToOneLine(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/** Only used when the provider omits usage; ~4 characters per token. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.name : "unknown error";
}
