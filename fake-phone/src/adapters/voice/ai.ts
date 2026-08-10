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
import { isAiTierEnabledInBuild } from "@/lib/voice/ai-tier-flag";
import { parseSseStream } from "@/lib/voice/sse-parse";
import type { TranscriptTurn } from "@/lib/voice/model-client";

/**
 * Build-time public flag. See the `isAvailable()` note above. Re-exported from
 * `lib/voice/ai-tier-flag` so the settings screen and this adapter cannot drift
 * apart about what "the AI tier is enabled" means.
 */
export { AI_ENABLED_FLAG } from "@/lib/voice/ai-tier-flag";

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

/** Who the *screen* says is calling. Not necessarily who the persona suggested. */
export interface CallerIdentity {
  readonly name: string;
  readonly label?: string;
}

export interface AiVoiceDeps {
  readonly speech: SpeechSynthesizer;
  /**
   * The caller identity currently on screen, read fresh at `start()`.
   *
   * The persona only ever *suggests* a name (`suggestedCallerName`), and the
   * user is free to override it in settings — so briefing the model from the
   * suggestion meant the screen could read "Mum" while the model introduced
   * itself as "Sam". A getter rather than a value because the container is built
   * once and the setting changes underneath it.
   *
   * Optional so that a caller which has no settings to offer — the server-render
   * container, a test — gets the persona's suggestion and nothing breaks.
   */
  readonly callerIdentity?: () => CallerIdentity | null;
}

export function createAiVoiceProvider(deps: AiVoiceDeps): VoiceProvider {
  const { speech } = deps;

  return {
    id: "ai",

    isAvailable(): boolean {
      return isAiTierEnabledInBuild();
    },

    async start(persona: Persona, signal: AbortSignal): Promise<VoiceSession> {
      // One controller so `stop()` and the caller's signal are the same event.
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abort, { once: true });

      const transcript: TranscriptTurn[] = [];
      const pendingUserSpeech: string[] = [];
      const caller = resolveCallerIdentity(deps.callerIdentity, persona);

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

        for (let turn = 0; turn < MAX_TURNS; turn += 1) {
          if (controller.signal.aborted) break;

          // Anything the user said since the last turn joins the transcript.
          // Nothing fills this queue in this build — see `sendUserSpeech`.
          while (pendingUserSpeech.length > 0) {
            const text = pendingUserSpeech.shift();
            if (text) transcript.push({ role: "user", text });
          }

          // A client-side stop, not a cap: the server enforces the real ceiling
          // against its own record of when it minted the session, and this only
          // saves a round trip that would be answered with the wrap-up line.
          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
          if (elapsedSeconds >= session.maxDurationSeconds) break;

          let stop = false;
          let failed = false;

          try {
            const body = await postTurn(
              { sessionId: session.sessionId, persona, caller, transcript },
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
                // Server-side bookkeeping, deliberately not mirrored here. The
                // budget is spent against the server's session record; a copy
                // kept on the client would only be a number an attacker could
                // choose, which is exactly what this stopped being.
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

        /**
         * The speech-to-text seam — and, in this build, an unused one.
         *
         * Nothing calls it. That is the product, not an oversight: a fake call
         * is deliberately one-sided (SPEC §2.2 — the tiers speak *at* the user,
         * and the scripted tier's whole trick is the silence where a reply would
         * go), and there is no microphone capture anywhere in the app, so there
         * is nothing to feed it. The transcript the model sees is therefore
         * caller-only, and the prompt is written for exactly that.
         *
         * If STT is ever added, this is the single place it attaches: a
         * recogniser behind a port, calling this on each final result. Everything
         * downstream — the queue drain at the top of the turn loop, the `user`
         * role in `TranscriptTurn`, the server's transcript schema — already
         * handles a two-sided conversation, and `ai.test.ts` exercises that path.
         * The transport would want revisiting at that point too (`lib/voice/sse.ts`
         * notes that barge-in is the moment SSE stops being the right choice).
         */
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
  /** Who the screen says is calling — the name the model must answer to. */
  readonly caller: CallerIdentity;
  readonly transcript: readonly TranscriptTurn[];
}

async function postTurn(
  payload: TurnPayload,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(TURN_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    // No `elapsedSeconds`, no `tokensUsed`. The server counts both against the
    // session it minted; a client-supplied figure would be a client-chosen cap.
    body: JSON.stringify({
      sessionId: payload.sessionId,
      persona: {
        id: payload.persona.id,
        title: payload.persona.title,
        characterBrief: payload.persona.characterBrief,
      },
      callerName: payload.caller.name,
      callerLabel: payload.caller.label ?? "",
      transcript: payload.transcript,
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
    if (body.code === "session_not_found") {
      return "This call's session has expired.";
    }
    if (typeof body.message === "string" && body.message.length <= 200) return body.message;
  } catch {
    // fall through to the generic message
  }
  return `The voice service returned ${response.status}.`;
}

/* ------------------------------------------------------------- utilities -- */

/**
 * The identity the model is briefed with.
 *
 * The user's configured caller wins whenever there is one; the persona's
 * suggestion is the fallback, which is all it ever was meant to be. Getting this
 * wrong is not cosmetic — the screen says "Mum" and the voice says "it's Sam",
 * which is precisely the moment the illusion the whole product rests on breaks.
 */
function resolveCallerIdentity(
  read: (() => CallerIdentity | null) | undefined,
  persona: Persona,
): CallerIdentity {
  // A settings read is third-party code from here; a throw must not stop a call.
  let configured: CallerIdentity | null = null;
  try {
    configured = read?.() ?? null;
  } catch {
    configured = null;
  }

  const name = configured?.name.trim();
  if (!name) {
    return { name: persona.suggestedCallerName, label: persona.suggestedCallerLabel };
  }
  return { name, label: configured?.label?.trim() || persona.suggestedCallerLabel };
}

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
