/**
 * The typed error shape both voice routes speak.
 *
 * One shape, one place. The client only ever branches on `code`, so a message
 * can be reworded without breaking a caller, and there is exactly one function
 * to audit for "does anything upstream-controlled end up in a response body".
 * (Nothing does: every message here is a literal in this file or in the route.)
 */

export const VOICE_ERROR_CODES = [
  "voice_unconfigured",
  "invalid_request",
  "rate_limited",
  "voice_upstream_failed",
] as const;

export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[number];

export interface VoiceErrorBody {
  readonly code: VoiceErrorCode;
  readonly message: string;
}

export function voiceError(
  code: VoiceErrorCode,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  const body: VoiceErrorBody = { code, message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * The response the whole slice is built around.
 *
 * With no key configured this is what every voice route returns, on every
 * request, forever — a clean, typed, documented state rather than a crash. The
 * AI adapter turns it into `error` + `ended`, and the registry never selected
 * the AI tier in the first place, so the user gets a working scripted call.
 */
export function voiceUnconfigured(): Response {
  return voiceError(
    "voice_unconfigured",
    "The AI voice tier is not configured on this deployment. The app works without it.",
    503,
  );
}

export function invalidVoiceRequest(message = "The request body was not valid."): Response {
  return voiceError("invalid_request", message, 400);
}

export function voiceRateLimited(retryAfterSeconds: number): Response {
  return voiceError("rate_limited", "Too many voice requests. Try again shortly.", 429, {
    "retry-after": String(retryAfterSeconds),
  });
}

/** Parses a JSON body without throwing; `null` means "not parseable JSON". */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}
