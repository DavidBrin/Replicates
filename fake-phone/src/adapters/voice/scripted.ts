/**
 * The scripted tier — the app's default voice, and the one that has to work on
 * a device that gives us nothing.
 *
 * It walks a persona's half-conversation: speak a line, then fall silent for
 * that line's `pauseAfterMs` while the "other person" replies. Those pauses are
 * the illusion (research/ai-voice-architecture.md §4.2 — "the single most
 * important cue"); a script played back without them reads instantly as a
 * recording, and a bystander hears a monologue rather than a call.
 *
 * The load-bearing decision in this file: **the timing does not depend on the
 * speech engine.** If `SpeechSynthesizer.isAvailable()` is false — no voice
 * pack, iOS never fired `voiceschanged`, the user is in a browser that has no
 * Web Speech API at all — the provider still emits `line` and `listening` on
 * realistic reading-speed timing, so the subtitles pace exactly like a real
 * conversation and the call still reads as real in silence. That is not a
 * degraded mode we tolerate; per research/web-platform-constraints.md §8 it is
 * the mode we should expect on iOS, which is the primary target.
 *
 * The iterator never throws. A consumer's `for await` over a call in progress
 * is the UI's render loop; an exception escaping it would blank the call screen.
 */

import type { DialogueLine, Persona } from "@/domain/persona";
import type { CallEvent, Clock, SpeechSynthesizer, VoiceProvider, VoiceSession } from "@/ports";

/**
 * Reading/speaking pace used when there is no voice to time against.
 *
 * ~14 characters a second is close to a relaxed 150 words-per-minute delivery.
 * The floor stops a two-word line ("Uh-huh.") flashing past before it can be
 * read; the ceiling stops a pathological persona from parking the call on one
 * subtitle.
 */
const MS_PER_CHARACTER = 70;
const MIN_LINE_MS = 800;
const MAX_LINE_MS = 8_000;

/**
 * A `speak()` that returns faster than this did not speak. Some engines resolve
 * instantly when they have no voice loaded, or when the utterance is dropped
 * while the tab is backgrounded — and a line that "finished" in 3ms would run
 * the whole script in a second, which looks nothing like a call. When we see
 * that, we pad out to reading speed and carry on.
 */
const IMPLAUSIBLY_FAST_MS = 250;

export function estimateReadingMs(text: string): number {
  return Math.min(MAX_LINE_MS, Math.max(MIN_LINE_MS, text.trim().length * MS_PER_CHARACTER));
}

/** A `setTimeout` that resolves early — and never rejects — when aborted. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
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

export function createScriptedVoiceProvider(deps: {
  speech: SpeechSynthesizer;
  clock: Clock;
}): VoiceProvider {
  const { speech, clock } = deps;

  return {
    id: "scripted",

    /** No key, no network, no permission — a written script always exists. */
    isAvailable(): boolean {
      return true;
    },

    start(persona: Persona, signal: AbortSignal): Promise<VoiceSession> {
      // A local controller so `stop()` and the caller's signal are one thing.
      // Everything downstream — the speech request, every pause — watches this
      // one signal, which is why an abort unwinds the whole session in a tick
      // rather than after the current pause expires.
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abort, { once: true });

      async function speakLine(line: DialogueLine): Promise<void> {
        const expected = estimateReadingMs(line.text);

        // Note we never call `warmUp()` here: it must happen inside a user
        // gesture, and `start()` runs after the answer handler has already
        // returned. The call controller warms up on the answer tap.
        if (!speech.isAvailable()) {
          await delay(expected, controller.signal);
          return;
        }

        const startedAt = clock.now();
        try {
          await speech.speak({
            text: line.text,
            rate: persona.voiceHints?.rate,
            pitch: persona.voiceHints?.pitch,
            signal: controller.signal,
          });
        } catch {
          // The port's contract says `speak()` resolves rather than rejects,
          // but a broken implementation must not be able to end someone's call.
          await delay(expected, controller.signal);
          return;
        }

        if (controller.signal.aborted) return;
        const spoken = clock.now() - startedAt;
        if (spoken < IMPLAUSIBLY_FAST_MS && expected > spoken) {
          await delay(expected - spoken, controller.signal);
        }
      }

      async function* events(): AsyncGenerator<CallEvent> {
        try {
          yield { type: "connected" };

          for (const line of persona.script) {
            if (controller.signal.aborted) break;
            // The subtitle goes up *before* the audio starts, so a user reading
            // rather than listening is never behind the caller.
            yield { type: "line", text: line.text };
            await speakLine(line);

            if (controller.signal.aborted) break;
            yield { type: "listening" };
            await delay(line.pauseAfterMs, controller.signal);
          }
        } catch (error) {
          yield {
            type: "error",
            message: error instanceof Error ? error.message : "the call script stopped unexpectedly",
          };
        } finally {
          // Runs on a normal finish, an abort, and on the consumer breaking out
          // of its `for await` (which calls `.return()` on this generator).
          signal.removeEventListener("abort", abort);
          controller.abort();
          try {
            speech.cancel();
          } catch {
            /* nothing was speaking */
          }
        }

        yield { type: "ended" };
      }

      let iterator: AsyncGenerator<CallEvent> | null = null;

      return Promise.resolve({
        events(): AsyncIterable<CallEvent> {
          // One iterator per session: async generators are single-consumer, and
          // handing a second consumer its own copy would run the script twice.
          iterator ??= events();
          return iterator;
        },
        stop(): void {
          controller.abort();
          try {
            speech.cancel();
          } catch {
            /* nothing was speaking */
          }
        },
      });
    },
  };
}
