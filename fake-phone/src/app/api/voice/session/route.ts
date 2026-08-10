/**
 * `POST /api/voice/session` — mint a short-lived voice session.
 *
 * Unconfigured (the shipped state) this returns `503 { code:
 * "voice_unconfigured" }` and touches nothing else — no rate-limit state, no
 * body parse, no clock read. That ordering is the point: the inert path is the
 * shortest path through the file, so "ships inert" is a property of the control
 * flow rather than a promise in a comment.
 *
 * ### The ephemeral-token seam
 *
 * `research/ai-voice-architecture.md` §2.1 describes two wire patterns. The one
 * this build uses is the server-proxied stream (Claude has no browser-safe
 * direct path), so `ephemeralToken` is always `null` and the browser talks only
 * to `/api/voice/turn`.
 *
 * The *other* pattern — a true speech-to-speech provider (OpenAI Realtime,
 * ElevenLabs Conversational AI) where the browser connects directly over WebRTC
 * — is minted **here**, in this handler, and nowhere else:
 *
 *   1. `POST https://api.openai.com/v1/realtime/client_secrets` with the real
 *      key held server-side;
 *   2. return `{ ephemeralToken: value, expiresAt }` — a ~60s credential, minted
 *      just-in-time, never cached;
 *   3. the browser sets it as `Authorization: Bearer` on its own SDP offer and
 *      audio flows straight to the provider, never through us.
 *
 * The response shape already carries `ephemeralToken` and `expiresAt` so adding
 * that provider is a new branch in this function plus a new transport in the
 * adapter — not a change to the response contract or to anything upstream.
 */

import {
  invalidVoiceRequest,
  readJsonBody,
  voiceRateLimited,
  voiceUnconfigured,
} from "@/lib/voice/http";
import { clientKeyFor, sessionRateLimiter } from "@/lib/voice/rate-limit";
import { isConfigured, readVoiceConfig } from "@/lib/voice/config";
import { sessionRequestSchema } from "@/lib/voice/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long a minted session id is good for. Well past the hard duration cap. */
const SESSION_TTL_SECONDS = 600;

export interface VoiceSessionResponse {
  readonly sessionId: string;
  /** Epoch milliseconds. The client stops the call at or before this. */
  readonly expiresAt: number;
  readonly aiProvider: string;
  /** Always `null` on the proxied path. See the seam note above. */
  readonly ephemeralToken: string | null;
  readonly maxDurationSeconds: number;
  readonly maxTokens: number;
  readonly clientCallId?: string;
}

export async function POST(request: Request): Promise<Response> {
  const config = readVoiceConfig();
  if (!isConfigured(config)) return voiceUnconfigured();

  const limit = sessionRateLimiter.check(clientKeyFor(request));
  if (!limit.allowed) return voiceRateLimited(limit.retryAfterSeconds);

  const raw = await readJsonBody(request);
  const parsed = sessionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidVoiceRequest("A voice session needs a personaId.");
  }

  const body: VoiceSessionResponse = {
    sessionId: crypto.randomUUID(),
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    aiProvider: config.aiProvider,
    ephemeralToken: null,
    maxDurationSeconds: config.maxDurationSeconds,
    maxTokens: config.maxTokens,
    ...(parsed.data.clientCallId ? { clientCallId: parsed.data.clientCallId } : {}),
  };

  return new Response(JSON.stringify(body), {
    status: 201,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
