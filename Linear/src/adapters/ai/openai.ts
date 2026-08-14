import "server-only";

import {
  AiConnector,
  type AiMessage,
  type AiOptions,
  type AiResponse,
} from "@/ports/ai";

import {
  capText,
  classifyHttpFailure,
  oversizedResponse,
  readCapped,
  unreadableResponse,
  withTimeout,
} from "./shared";

/**
 * The OpenAI adapter — Responses API, raw HTTP.
 *
 * Written as the mirror image of the Anthropic adapter so the differences that
 * matter stay visible side by side (see that file's header for why neither
 * uses a vendor SDK). Those differences are worth naming, because they are
 * exactly what a shared port has to paper over:
 *
 * | | Anthropic | OpenAI |
 * |---|---|---|
 * | endpoint | `/v1/messages` | `/v1/responses` |
 * | auth | `x-api-key` | `Authorization: Bearer` |
 * | system prompt | top-level `system` | an `instructions` field |
 * | output | `content[]` blocks | `output[]` → `content[]` parts |
 * | token counts | `input_tokens` | `input_tokens` (same, once found) |
 *
 * The Responses API rather than Chat Completions: it is the current surface,
 * and it exposes the reasoning-effort control that replaced the sampling
 * parameters this port deliberately does not offer.
 *
 * `output_text` is a convenience field the API provides when the response is
 * plain text. It is read first and the block walk is the fallback, because the
 * convenience field is absent whenever the response carries anything else.
 */

interface OpenAiContentPart {
  type?: string;
  text?: string;
}

interface OpenAiOutputItem {
  type?: string;
  content?: OpenAiContentPart[];
}

interface OpenAiResponse {
  output_text?: string;
  output?: OpenAiOutputItem[];
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface OpenAiConfig {
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly baseUrl: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

export class OpenAiConnector extends AiConnector {
  readonly provider = "openai" as const;

  constructor(private readonly cfg: OpenAiConfig) {
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
        message: "OPENAI_API_KEY is not set.",
      };
    }

    const body = {
      model: this.cfg.model,
      ...(options.system ? { instructions: options.system } : {}),
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: options.maxTokens ?? this.cfg.maxTokens,
      ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
    };

    return withTimeout(this.cfg.timeoutMs, options.signal, async (signal) => {
      let response: Response;
      try {
        response = await fetch(`${this.cfg.baseUrl}/v1/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.cfg.apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        // The mirror of the Anthropic adapter, for the same reason: only
        // `withTimeout` can tell its own deadline from the caller's abort, so
        // an aborted signal's error goes back out rather than becoming a
        // retryable `upstream`.
        if (signal.aborted) throw error;
        return {
          ok: false,
          reason: "upstream",
          provider: this.provider,
          retryable: true,
          message: error instanceof Error ? error.message : "Network error",
        };
      }

      if (!response.ok) {
        // An oversized error body is read as an absent one: the status is the
        // only part `classifyHttpFailure` trusts anyway.
        return classifyHttpFailure(
          this.provider,
          response.status,
          (await readCapped(response).catch(() => null)) ?? "",
        );
      }

      const raw = await readCapped(response);
      if (raw === null) return oversizedResponse(this.provider);

      let payload: OpenAiResponse;
      try {
        payload = JSON.parse(raw) as OpenAiResponse;
      } catch {
        return unreadableResponse(this.provider);
      }

      if (payload.status === "incomplete") {
        return {
          ok: false,
          reason: "upstream",
          provider: this.provider,
          retryable: true,
          message: `The response was cut short (${
            payload.incomplete_details?.reason ?? "unknown reason"
          }).`,
        };
      }

      const text =
        payload.output_text ??
        (payload.output ?? [])
          .flatMap((item) => item.content ?? [])
          .filter((part) => typeof part.text === "string")
          .map((part) => part.text!)
          .join("");

      return {
        ok: true,
        text: capText(text),
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
