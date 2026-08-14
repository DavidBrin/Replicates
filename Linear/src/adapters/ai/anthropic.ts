import "server-only";

import {
  AiConnector,
  type AiMessage,
  type AiOptions,
  type AiResponse,
} from "@/ports/ai";

import { classifyHttpFailure, withTimeout } from "./shared";

/**
 * The Anthropic adapter — Messages API, raw HTTP.
 *
 * ## Why not the SDK
 *
 * `@anthropic-ai/sdk` is the normal choice. The brief asks for GPT *and* Claude
 * behind one connector interface, and a codebase where one vendor arrives
 * through a typed SDK and the other through hand-written `fetch` is harder to
 * review than two adapters written the same way: the differences that matter
 * (how each names its system prompt, where each puts token counts) stop being
 * visible when one side is buried under a client library. Both adapters are
 * therefore the documented wire shape, ~120 lines each, and the vendor
 * dependency count stays at zero.
 *
 * ## The wire shape
 *
 * `POST /v1/messages` with `x-api-key` and `anthropic-version: 2023-06-01`.
 * The system prompt is a **top-level field**, not a message with
 * `role: "system"` — the single most common mistake when porting from the
 * OpenAI shape. The response's `content` is an array of blocks, and the text
 * is not guaranteed to be at index 0.
 *
 * ## Two model-family behaviours this encodes
 *
 * - **Thinking is on by default** on the current Opus line, and `max_tokens`
 *   caps thinking *plus* visible output. A budget sized for the answer alone
 *   truncates mid-sentence, so the default is 4096 rather than a tighter
 *   number that looks sufficient.
 * - **Sampling parameters are rejected.** `temperature`, `top_p` and `top_k`
 *   return a 400 on this family; `output_config.effort` is the depth control,
 *   which is why {@link AiOptions} exposes `effort` and nothing else.
 *
 * A refusal arrives as a **200** with `stop_reason: "refusal"` and possibly an
 * empty `content` array — reading `content[0].text` unconditionally is how
 * that becomes a `TypeError` in production instead of a message to the user.
 */

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  model?: string;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string | null };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicConfig {
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiVersion: string;
  readonly maxTokens: number;
  readonly effort: string;
  readonly timeoutMs: number;
}

export class AnthropicConnector extends AiConnector {
  readonly provider = "anthropic" as const;

  constructor(private readonly cfg: AnthropicConfig) {
    super();
  }

  get model(): string {
    return this.cfg.model;
  }

  get configured(): boolean {
    return Boolean(this.cfg.apiKey);
  }

  async complete(
    messages: readonly AiMessage[],
    options: AiOptions = {},
  ): Promise<AiResponse> {
    if (!this.cfg.apiKey) {
      return {
        ok: false,
        reason: "unconfigured",
        provider: this.provider,
        retryable: false,
        message: "ANTHROPIC_API_KEY is not set.",
      };
    }

    const body = {
      model: this.cfg.model,
      max_tokens: options.maxTokens ?? this.cfg.maxTokens,
      // Top-level, not a message. See the header.
      ...(options.system ? { system: options.system } : {}),
      output_config: { effort: options.effort ?? this.cfg.effort },
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    return withTimeout(this.cfg.timeoutMs, options.signal, async (signal) => {
      let response: Response;
      try {
        response = await fetch(`${this.cfg.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.cfg.apiKey!,
            "anthropic-version": this.cfg.apiVersion,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        return {
          ok: false,
          reason: "upstream",
          provider: this.provider,
          retryable: true,
          // Deliberately the error's message and not the request: the body
          // contains the user's issue text and the headers contain the key.
          message: error instanceof Error ? error.message : "Network error",
        };
      }

      if (!response.ok) {
        return classifyHttpFailure(
          this.provider,
          response.status,
          await response.text().catch(() => ""),
        );
      }

      const payload = (await response.json()) as AnthropicResponse;

      // A refusal is a successful HTTP response with no usable content.
      if (payload.stop_reason === "refusal") {
        return {
          ok: false,
          reason: "refused",
          provider: this.provider,
          retryable: false,
          message:
            payload.stop_details?.explanation ??
            "The model declined to answer this request.",
        };
      }

      const text = (payload.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text!)
        .join("");

      return {
        ok: true,
        text,
        provider: this.provider,
        model: payload.model ?? this.cfg.model,
        usage: {
          inputTokens: payload.usage?.input_tokens ?? null,
          outputTokens: payload.usage?.output_tokens ?? null,
        },
      };
    });
  }
}
