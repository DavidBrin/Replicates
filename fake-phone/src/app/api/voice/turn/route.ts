/**
 * `POST /api/voice/turn` — stream the caller's next line back over SSE.
 *
 * Transport choice is `research/ai-voice-architecture.md` §2.3: a one-sided
 * fake call is server→client only, so SSE beats WebSockets — plain HTTP, native
 * `ReadableStream` support in Route Handlers, and no dependency on Vercel's
 * WebSocket beta. `runtime = "nodejs"` for the same reason the research gives
 * (§2.4): Edge WebSocket/stream support is the less-proven path, and the Node
 * runtime is where long-lived streaming is stable.
 *
 * `maxDuration` is set to Vercel's Hobby ceiling, but it is not the real limit —
 * `VOICE_CALL_MAX_DURATION_SECONDS` is, and it is enforced here per turn so the
 * call behaves identically on Hobby and Pro (§6).
 *
 * Unconfigured, this route emits nothing and streams nothing: it returns the
 * same typed `503 { code: "voice_unconfigured" }` as `/api/voice/session`.
 */

import { isConfigured, readVoiceConfig } from "@/lib/voice/config";
import {
  invalidVoiceRequest,
  readJsonBody,
  voiceRateLimited,
  voiceUnconfigured,
} from "@/lib/voice/http";
import { VoiceModelError } from "@/lib/voice/model-client";
import { clientKeyFor, turnRateLimiter } from "@/lib/voice/rate-limit";
import {
  MAX_TOKENS_PER_TURN,
  WRAP_UP_SECONDS,
  WRAP_UP_TOKENS,
  turnRequestSchema,
  type TurnRequest,
} from "@/lib/voice/requests";
import { createVoiceSseResponse, type VoiceEndReason } from "@/lib/voice/sse";
import { buildSystemPrompt } from "@/lib/voice/system-prompt";
import { resolveTextModelClient } from "@/lib/voice/text-model-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel's Hobby ceiling. The product cap in `config.ts` is always stricter. */
export const maxDuration = 300;

/**
 * The line spoken when a cap is hit.
 *
 * Never a hard cut mid-word: §6 is explicit that the harness ends the call in
 * persona. Deliberately generic so it fits any persona, and deliberately a
 * constant rather than a model call — the whole point of a cap is that it does
 * not spend anything.
 */
const WRAP_UP_LINE = "Okay — I'm right outside, come out and I'll see you in a sec.";

export async function POST(request: Request): Promise<Response> {
  const config = readVoiceConfig();
  if (!isConfigured(config)) return voiceUnconfigured();

  const limit = turnRateLimiter.check(clientKeyFor(request));
  if (!limit.allowed) return voiceRateLimited(limit.retryAfterSeconds);

  const raw = await readJsonBody(request);
  const parsed = turnRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidVoiceRequest("A voice turn needs a sessionId and a persona.");
  }
  const turn: TurnRequest = parsed.data;

  const capped = capReached(turn, config.maxDurationSeconds, config.maxTokens);
  if (capped) {
    // Still a well-formed SSE stream, so the client has exactly one code path
    // for "the call ended" whether it ended naturally or on a budget.
    return createVoiceSseResponse(async (emit) => {
      emit.send("connected", { sessionId: turn.sessionId });
      emit.send("line", { text: WRAP_UP_LINE });
      emit.send("ended", { reason: capped satisfies VoiceEndReason });
    });
  }

  const client = resolveTextModelClient(config.aiProvider);
  const systemPrompt = buildSystemPrompt({
    persona: turn.persona,
    callerName: turn.callerName,
    callerLabel: turn.callerLabel,
    targetSeconds: config.maxDurationSeconds,
  });

  const remainingTokens = Math.max(0, config.maxTokens - turn.tokensUsed);
  const maxTokens = Math.min(MAX_TOKENS_PER_TURN, remainingTokens);

  return createVoiceSseResponse(async (emit) => {
    emit.send("connected", { sessionId: turn.sessionId });

    let result;
    try {
      result = await client.complete({
        systemPrompt,
        transcript: turn.transcript,
        maxTokens,
        signal: request.signal,
      });
    } catch (cause) {
      if (cause instanceof VoiceModelError) {
        // A safety decline is not a crash — end the call the way a person would.
        if (cause.code === "refused") {
          emit.send("line", { text: WRAP_UP_LINE });
          emit.send("ended", { reason: "completed" satisfies VoiceEndReason });
          return;
        }
        emit.send("error", { code: "voice_upstream_failed", message: cause.message });
        emit.send("ended", { reason: "error" satisfies VoiceEndReason });
        return;
      }
      throw cause;
    }

    emit.send("line", { text: result.text });
    emit.send("usage", { outputTokens: result.outputTokens });
    // The gap where the other side "replies". The client fills it with silence;
    // §4.2 calls this the single most important cue that a call is real.
    emit.send("listening", { durationMs: listeningPauseMs(result.text) });
    emit.send("ended", { reason: "completed" satisfies VoiceEndReason });
  });
}

/**
 * Which cap, if any, this turn has run into.
 *
 * Checked *before* spending anything: a turn that would start within a wrap-up
 * margin of either ceiling never reaches the model at all.
 */
function capReached(
  turn: TurnRequest,
  maxDurationSeconds: number,
  maxTokens: number,
): VoiceEndReason | null {
  if (turn.elapsedSeconds >= maxDurationSeconds - WRAP_UP_SECONDS) return "duration_cap";
  if (turn.tokensUsed >= maxTokens - WRAP_UP_TOKENS) return "token_cap";
  return null;
}

/**
 * How long the caller "listens" after a line.
 *
 * Scaled to the line's length — a short question implies a short answer, a long
 * one implies a longer reply — and clamped to the 1.5–4s band in §4.2.
 */
function listeningPauseMs(text: string): number {
  const estimate = 1200 + text.length * 25;
  return Math.min(4000, Math.max(1500, Math.round(estimate)));
}
