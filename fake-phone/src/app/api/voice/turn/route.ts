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
 *
 * ### The client is not the accountant
 *
 * Neither number the caps are enforced against comes off the wire. How long the
 * call has run is read from the issued-at inside the **signed** session token
 * (`lib/voice/session-token.ts`), so it is exact on any instance and a client
 * cannot move it. How much the call has spent is read from this instance's
 * ledger (`lib/voice/token-budget.ts`), which is best-effort and says so. A
 * body-supplied `elapsedSeconds: 0` on every turn was, until this was fixed, an
 * unbounded billable loop; the session id it quoted was not checked against
 * anything at all, so it did not even need to be a real one.
 *
 * The turn's allowance is *reserved before the model is called* and reconciled
 * afterwards. Reading the total, awaiting the model and only then recording the
 * cost let three overlapping turns each spend the whole remaining budget.
 */

import { API_KEY_ENV_VARS, isConfigured, readVoiceConfig } from "@/lib/voice/config";
import {
  invalidVoiceRequest,
  readJsonBody,
  voiceRateLimited,
  voiceSessionNotFound,
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
import {
  elapsedSecondsSince,
  verifyVoiceSessionToken,
  voiceSessionSigningKey,
} from "@/lib/voice/session-token";
import { voiceTokenBudget } from "@/lib/voice/token-budget";
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

  // Unreachable: `isConfigured` has already proved the provider key the
  // signature derives from is present. Kept so no token is ever taken on trust.
  const signingKey = await voiceSessionSigningKey(API_KEY_ENV_VARS[config.aiProvider]);
  if (!signingKey) return voiceUnconfigured();

  // A token this deployment never signed — or one whose call has long since
  // expired — buys nothing. This is the check whose absence made every cap below
  // optional, and it needs no shared state to make it.
  const session = await verifyVoiceSessionToken(turn.sessionId, signingKey, Date.now());
  if (!session) return voiceSessionNotFound();

  const elapsedSeconds = elapsedSecondsSince(session, Date.now());

  /**
   * From here to the reservation below there is deliberately no `await`. That
   * gap is the whole of the concurrency bug: an `await` between reading the
   * ledger and taking from it lets every overlapping turn resume holding the
   * same figure, and each one then claims a full allowance against a budget the
   * others have already spent.
   */
  const capped = capReached(
    elapsedSeconds,
    voiceTokenBudget.spent(session.sessionId),
    config.maxDurationSeconds,
    config.maxTokens,
  );
  if (capped) return endedCall(session.sessionId, capped);

  const reservation = voiceTokenBudget.reserve({
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    tokens: MAX_TOKENS_PER_TURN,
    budget: config.maxTokens,
  });
  // Turns already in flight have claimed what is left. Ending the call is the
  // only honest answer: the budget that would pay for this turn is spoken for.
  if (!reservation) return endedCall(session.sessionId, "token_cap");

  const systemPrompt = buildSystemPrompt({
    persona: turn.persona,
    callerName: turn.callerName,
    callerLabel: turn.callerLabel,
    targetSeconds: config.maxDurationSeconds,
  });

  return createVoiceSseResponse(async (emit) => {
    emit.send("connected", { sessionId: session.sessionId });

    let result;
    try {
      // Resolved inside the guarded producer, not above it. A provider with no
      // client in this build throws from here, and every throw in this block
      // leaves as a typed `error` + `ended` frame — never as a framework 500 the
      // client has no branch for. (`isConfigured` already refuses such a
      // deployment at the door; this is the second lock on the same door.)
      const client = resolveTextModelClient(config.aiProvider);
      result = await client.complete({
        systemPrompt,
        transcript: turn.transcript,
        // The reservation *is* the ceiling: the budget has already been made to
        // fit it, so there is no second calculation here to disagree with it.
        maxTokens: reservation.tokens,
        signal: request.signal,
      });
    } catch (cause) {
      // Nothing was spoken, so nothing is charged — but the allowance must go
      // back, or a call that hits one flaky turn quietly loses that much budget.
      voiceTokenBudget.release(reservation);
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

    // The reservation becomes a charge, at the real figure, before the line is
    // sent — so a client that hangs up mid-stream has still paid for what it
    // spent. Until this line the turn was costed at its worst case, which is the
    // direction a spend guard should be wrong in.
    voiceTokenBudget.settle(reservation, result.outputTokens);

    emit.send("line", { text: result.text });
    // Informational only now — the client renders nothing from it and the caps
    // are enforced against the ledger above. Kept because it is the one place a
    // developer can watch a call's spend without server logs.
    emit.send("usage", { outputTokens: result.outputTokens });
    // The gap where the other side "replies". The client fills it with silence;
    // §4.2 calls this the single most important cue that a call is real.
    emit.send("listening", { durationMs: listeningPauseMs(result.text) });
    emit.send("ended", { reason: "completed" satisfies VoiceEndReason });
  });
}

/**
 * A call that ends without calling the model.
 *
 * Still a well-formed SSE stream, so the client has exactly one code path for
 * "the call ended" whether it ended naturally or on a budget.
 */
function endedCall(sessionId: string, reason: VoiceEndReason): Response {
  return createVoiceSseResponse(async (emit) => {
    emit.send("connected", { sessionId });
    emit.send("line", { text: WRAP_UP_LINE });
    emit.send("ended", { reason });
  });
}

/**
 * Which cap, if any, this turn has run into.
 *
 * Checked *before* spending anything: a turn that would start within a wrap-up
 * margin of either ceiling never reaches the model at all. Neither figure comes
 * off the wire — the elapsed one from the signed token, the spend from this
 * instance's ledger — and `config.ts` keeps the accepted budgets above these
 * margins so that "capped from the first turn" is unreachable.
 */
function capReached(
  elapsedSeconds: number,
  tokensUsed: number,
  maxDurationSeconds: number,
  maxTokens: number,
): VoiceEndReason | null {
  if (elapsedSeconds >= maxDurationSeconds - WRAP_UP_SECONDS) return "duration_cap";
  if (tokensUsed >= maxTokens - WRAP_UP_TOKENS) return "token_cap";
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
