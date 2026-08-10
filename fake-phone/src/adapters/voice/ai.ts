/**
 * The AI voice tier — client side.
 *
 * Mints a session at `/api/voice/session`, then drives the call as a loop of
 * `/api/voice/turn` SSE streams, speaking each line through the injected
 * `SpeechSynthesizer` and emitting `CallEvent`s to the UI. No provider SDK type
 * crosses this boundary: the UI sees `connecting → connected → line/listening →
 * ended` and nothing else, exactly as it does for the scripted tier.
 *
 * ### Why `isAvailable()` is a build-time flag
 *
 * `VoiceProvider.isAvailable()` is contractually cheap and synchronous, and the
 * registry calls it *before* the call starts. It therefore cannot ask the server
 * whether a key exists — that is a network round trip. So it reads a public,
 * build-time flag (`NEXT_PUBLIC_VOICE_AI_ENABLED`), and **the server route stays
 * the real authority**: with the flag on and no key configured, `/api/voice/*`
 * still answers `503 voice_unconfigured` and this provider degrades to `error` +
 * `ended` on the first turn. The flag is a hint that saves a doomed call; it is
 * not a permission, and nothing secret is inferable from it.
 *
 * The gate has to be here, at selection time, because `registry.ts` cannot
 * retroactively swap providers mid-call: once `start()` has returned a session
 * the UI is iterating *that* session's events, and there is no seam left to
 * substitute a scripted one. A cheap wrong-way-wrong answer from `isAvailable()`
 * costs a graceful `error` + `ended`; a missing gate would cost a broken screen.
 *
 * ### Failure policy
 *
 * Every failure path — 503, 429, network, malformed SSE, an aborted stream —
 * emits `error` then `ended`. The call ends the way a real dropped call ends
 * rather than leaving the screen mid-state. A silent-but-working call is a
 * usable safety tool; a stuck one is not.
 */

import type { Persona } from "@/domain/persona";
import type { CallEvent, SpeechSynthesizer, VoiceProvider, VoiceSession } from "@/ports";
import { parseSseStream } from "@/lib/voice/sse-parse";
import type { TranscriptTurn } from "@/lib/voice/model-client";

/** Build-time public flag. See the `isAvailable()` note above. */
export const AI_ENABLED_FLAG = "NEXT_PUBLIC_VOICE_AI_ENABLED";

const SESSION_URL = "/api/voice/session";
const TURN_URL = "/api/voice/turn";

/** Belt and braces against a server that never sends a terminal `ended`. */
const MAX_TURNS = 40;

/** Defaults used until the session mint tells us the server's real caps. */
const FALLBACK_MAX_DURATION_SECONDS = 240;

interface MintedSession {
  readonly sessionId: string;
  readonly maxDurationSeconds: number;
}

export interface AiVoiceDeps {
  readonly speech: SpeechSynthesizer;
}

export function createAiVoiceProvider(deps: AiVoiceDeps): VoiceProvider {
  const { speech } = deps;

  return {
    id: "ai",

    isAvailable(): boolean {
      // Read as a literal so Next inlines it into the client bundle.
      return process.env.NEXT_PUBLIC_VOICE_AI_ENABLED === "true";
    },

    async start(persona: Persona, signal: AbortSignal): Promise<VoiceSession> {
      // One controller so `stop()` and the caller's signal are the same event.
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abort, { once: true });

      const transcript: TranscriptTurn[] = [];
      const pendingUserSpeech: string[] = [];

      async function* run(): AsyncGenerator<CallEvent> {
        yield { type: "connecting" };

        let session: MintedSession;
        try {
          session = await mintSession(persona, controller.signal);
        } catch (cause) {
          yield { type: "error", message: describe(cause) };
          yield { type: "ended" };
          return;
        }

        yield { type: "connected" };

        const startedAt = Date.now();
        let tokensUsed = 0;

        for (let turn = 0; turn < MAX_TURNS; turn += 1) {
          if (controller.signal.aborted) break;

          // Anything the user said since the last turn joins the transcript.
          while (pendingUserSpeech.length > 0) {
            const text = pendingUserSpeech.shift();
            if (text) transcript.push({ role: "user", text });
          }

          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
          if (elapsedSeconds >= session.maxDurationSeconds) break;

          let stop = false;
          let failed = false;

          try {
            const body = await postTurn(
              {
                sessionId: session.sessionId,
                persona,
                transcript,
                elapsedSeconds,
                tokensUsed,
              },
              controller.signal,
            );

            for await (const frame of parseSseStream(body, controller.signal)) {
              if (frame.event === "line") {
                const text = readText(frame.data);
                if (!text) continue;
                transcript.push({ role: "caller", text });
                yield { type: "line", text };
                await speakSafely(speech, text, controller.signal);
              } else if (frame.event === "usage") {
                tokensUsed += readTokens(frame.data);
              } else if (frame.event === "listening") {
                yield { type: "listening" };
                await sleep(readPauseMs(frame.data), controller.signal);
              } else if (frame.event === "error") {
                yield { type: "error", message: readMessage(frame.data) };
                failed = true;
                stop = true;
              } else if (frame.event === "ended") {
                // Only `completed` means "ask for another line"; every other
                // reason (a cap, an upstream failure) ends the whole call.
                if (readReason(frame.data) !== "completed") stop = true;
              }
            }
          } catch (cause) {
            if (!controller.signal.aborted) {
              yield { type: "error", message: describe(cause) };
            }
            failed = true;
            stop = true;
          }

          if (stop || failed) break;
        }

        yield { type: "ended" };
      }

      return {
        events: (): AsyncIterable<CallEvent> => run(),

        /** Only the AI tier uses this; the other tiers ignore it (ports). */
        sendUserSpeech(text: string): void {
          const trimmed = text.trim();
          if (trimmed) pendingUserSpeech.push(trimmed.slice(0, 2000));
        },

        stop(): void {
          signal.removeEventListener("abort", abort);
          controller.abort();
          speech.cancel();
        },
      };
    },
  };
}

/* ------------------------------------------------------------------ wire -- */

async function mintSession(persona: Persona, signal: AbortSignal): Promise<MintedSession> {
  const response = await fetch(SESSION_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaId: persona.id }),
  });

  if (!response.ok) throw new Error(await failureMessage(response));

  const payload = (await response.json()) as {
    sessionId?: unknown;
    maxDurationSeconds?: unknown;
  };
  if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
    throw new Error("The voice session response was malformed.");
  }

  return {
    sessionId: payload.sessionId,
    maxDurationSeconds:
      typeof payload.maxDurationSeconds === "number" && payload.maxDurationSeconds > 0
        ? payload.maxDurationSeconds
        : FALLBACK_MAX_DURATION_SECONDS,
  };
}

interface TurnPayload {
  readonly sessionId: string;
  readonly persona: Persona;
  readonly transcript: readonly TranscriptTurn[];
  readonly elapsedSeconds: number;
  readonly tokensUsed: number;
}

async function postTurn(
  payload: TurnPayload,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(TURN_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: payload.sessionId,
      persona: {
        id: payload.persona.id,
        title: payload.persona.title,
        characterBrief: payload.persona.characterBrief,
      },
      callerName: payload.persona.suggestedCallerName,
      callerLabel: payload.persona.suggestedCallerLabel,
      transcript: payload.transcript,
      elapsedSeconds: payload.elapsedSeconds,
      tokensUsed: payload.tokensUsed,
    }),
  });

  if (!response.ok) throw new Error(await failureMessage(response));
  if (!response.body) throw new Error("The voice stream returned no body.");
  return response.body;
}

/**
 * Turns a non-2xx into a human sentence, preferring the route's typed `code`.
 * Never surfaces a raw body: the routes are the only thing allowed to author
 * these strings, and an unexpected body is discarded rather than shown.
 */
async function failureMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (body.code === "voice_unconfigured") {
      return "The AI voice tier is not configured on this deployment.";
    }
    if (body.code === "rate_limited") {
      return "Too many voice requests just now.";
    }
    if (typeof body.message === "string" && body.message.length <= 200) return body.message;
  } catch {
    // fall through to the generic message
  }
  return `The voice service returned ${response.status}.`;
}

/* ------------------------------------------------------------- utilities -- */

/**
 * Speech must never take the call down. `SpeechSynthesizer.speak` already
 * resolves rather than rejects when cut off, but a platform-specific throw here
 * would abort the whole generator — so it is swallowed and the subtitles carry
 * the line instead (SPEC §4, constraint 5).
 */
async function speakSafely(
  speech: SpeechSynthesizer,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  try {
    if (!speech.isAvailable()) return;
    await speech.speak({ text, signal });
  } catch {
    // Subtitles are the fallback; a silent line is still a working call.
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function readText(data: unknown): string {
  if (typeof data === "object" && data !== null && "text" in data) {
    const text = (data as { text: unknown }).text;
    if (typeof text === "string") return text.trim();
  }
  return "";
}

function readMessage(data: unknown): string {
  if (typeof data === "object" && data !== null && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "The call could not continue.";
}

function readReason(data: unknown): string {
  if (typeof data === "object" && data !== null && "reason" in data) {
    const reason = (data as { reason: unknown }).reason;
    if (typeof reason === "string") return reason;
  }
  return "completed";
}

function readTokens(data: unknown): number {
  if (typeof data === "object" && data !== null && "outputTokens" in data) {
    const tokens = (data as { outputTokens: unknown }).outputTokens;
    if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) {
      return Math.round(tokens);
    }
  }
  return 0;
}

function readPauseMs(data: unknown): number {
  if (typeof data === "object" && data !== null && "durationMs" in data) {
    const ms = (data as { durationMs: unknown }).durationMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) {
      return Math.min(6000, Math.round(ms));
    }
  }
  return 0;
}

function describe(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return "The call could not be connected.";
}
