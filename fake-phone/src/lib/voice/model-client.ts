/**
 * The seam a second LLM vendor plugs into.
 *
 * `TextModelClient` is deliberately tiny and deliberately provider-agnostic: no
 * vendor SDK types, no wire shapes, no auth. Adding OpenAI is a new file
 * (`openai-client.ts`) that exports a `createOpenAiTextClient`, plus one line in
 * `resolveTextModelClient` — never an edit to the route, the prompt builder, or
 * anything the UI can see.
 *
 * `research/ai-voice-architecture.md` §1 is honest that a true speech-to-speech
 * provider is the better end state for this product. That provider does not fit
 * behind this interface — it never sends text through our server at all — which
 * is exactly why it gets its own seam in `/api/voice/session` (the ephemeral
 * token mint) rather than being forced through here.
 */

export type TurnRole = "caller" | "user";

export interface TranscriptTurn {
  readonly role: TurnRole;
  readonly text: string;
}

export interface TextModelRequest {
  readonly systemPrompt: string;
  readonly transcript: readonly TranscriptTurn[];
  /** Hard per-request ceiling, already clamped against the call's budget. */
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

export interface TextModelResult {
  /** The caller's next spoken line. Never empty; the client normalises. */
  readonly text: string;
  /** Charged against `VOICE_CALL_MAX_TOKENS` for the rest of the call. */
  readonly outputTokens: number;
  readonly stopReason: string | null;
}

export interface TextModelClient {
  /** Stable id for logs and for the `session` route's response. Never a key. */
  readonly id: string;
  complete(request: TextModelRequest): Promise<TextModelResult>;
}

export type VoiceModelErrorCode =
  | "not_configured"
  | "upstream_rejected"
  | "upstream_unavailable"
  | "malformed_response"
  | "refused";

/**
 * The only error type that crosses the seam. Vendor status codes and bodies are
 * collapsed into a fixed code set here so that nothing provider-shaped — and,
 * critically, nothing echoed back from an upstream that saw our key — can reach
 * a `Response` body.
 */
export class VoiceModelError extends Error {
  readonly code: VoiceModelErrorCode;

  constructor(code: VoiceModelErrorCode, message: string) {
    super(message);
    this.name = "VoiceModelError";
    this.code = code;
  }
}
