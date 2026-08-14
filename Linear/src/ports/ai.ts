/**
 * The AI connector port.
 *
 * The brief excludes Linear's native agents and asks instead for connectors
 * that call GPT and Claude. This is the seam: one interface, one adapter per
 * vendor, and a disabled adapter that is selected when no key is configured.
 *
 * Two properties matter more than the feature itself:
 *
 * - **The application never names a vendor.** A component asks for a summary;
 *   which model produces it is a deployment concern settled in `config/env.ts`.
 * - **Absence is a first-class state.** With no key set, the disabled adapter
 *   answers every call with a structured "not configured" result rather than
 *   throwing, so the UI renders an explanation instead of an error boundary.
 *   A clone that must be runnable by anyone cannot treat a missing API key as
 *   a crash.
 *
 * This file is deliberately free of imports: it is the contract, and both the
 * server adapters and the client-side types read it.
 */

/** Which vendor served a request. `none` is the disabled adapter. */
export type AiProvider = "anthropic" | "openai" | "none";

export interface AiMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/**
 * Generation options.
 *
 * Note what is *absent*: `temperature`, `top_p` and `top_k`. Both vendors'
 * current flagship models reject sampling parameters outright — Anthropic
 * returns a documented 400 — so exposing them would offer a knob that breaks
 * every request that touches it. `effort` is the modern equivalent and the
 * only depth control either vendor accepts.
 */
export interface AiOptions {
  /** Prepended as the system prompt. */
  readonly system?: string;
  /** Upper bound on the response. Interpreted per-adapter. */
  readonly maxTokens?: number;
  /** How hard to think. Mapped onto each vendor's own scale. */
  readonly effort?: "low" | "medium" | "high";
  /** Aborts the request; the adapter also applies its own timeout. */
  readonly signal?: AbortSignal;
}

/** A completed generation. */
export interface AiResult {
  readonly ok: true;
  readonly text: string;
  readonly provider: AiProvider;
  readonly model: string;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  };
}

/**
 * A failure the UI is expected to render, not throw.
 *
 * `reason` is a closed set so callers can branch without string matching:
 * `unconfigured` is the ordinary state of a fresh clone and deserves an
 * explanation rather than an apology; `rate_limited` and `upstream` are
 * transient and worth a retry affordance; `refused` means the model declined,
 * which is a content outcome rather than an error.
 */
export interface AiFailure {
  readonly ok: false;
  readonly reason:
    | "unconfigured"
    | "rate_limited"
    | "upstream"
    | "timeout"
    | "refused"
    | "invalid_request";
  readonly message: string;
  readonly provider: AiProvider;
  readonly retryable: boolean;
}

export type AiResponse = AiResult | AiFailure;

/**
 * A connector.
 *
 * Implemented as an abstract class rather than a bare interface so the shared
 * concerns — timeouts, error classification, redacting the key from anything
 * that gets logged — live in one place and an adapter only supplies the parts
 * that genuinely differ between vendors.
 */
export abstract class AiConnector {
  abstract readonly provider: AiProvider;
  abstract readonly model: string;

  /** Whether a key is present. Drives the UI's enabled/disabled state. */
  abstract readonly configured: boolean;

  /** Generate a completion. Never throws for an upstream failure. */
  abstract complete(
    messages: readonly AiMessage[],
    options?: AiOptions,
  ): Promise<AiResponse>;

  /**
   * Stream a completion as text deltas.
   *
   * The default implementation falls back to `complete` and yields the whole
   * response at once, so an adapter that has no streaming path still satisfies
   * the interface and the caller's rendering code never branches on it.
   */
  async *stream(
    messages: readonly AiMessage[],
    options?: AiOptions,
  ): AsyncGenerator<string, AiResponse, void> {
    const result = await this.complete(messages, options);
    if (result.ok) yield result.text;
    return result;
  }
}

/** The tasks the app actually asks a model to do. */
export const AI_TASKS = ["summarize", "draft_description", "suggest_title"] as const;
export type AiTask = (typeof AI_TASKS)[number];
