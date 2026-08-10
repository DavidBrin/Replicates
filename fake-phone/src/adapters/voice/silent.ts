/**
 * The silent tier: a call with a photo, a name, a ringtone and a running timer,
 * and no voice at all.
 *
 * This is the floor the whole degradation chain stands on
 * (`createVoiceProvider` walks ai → scripted → silent), so it has *zero*
 * platform dependencies by design: no DOM, no timers that must fire, no speech
 * engine, no network. If this file needed anything from the browser, the
 * fallback could fail on exactly the device the fallback exists for.
 *
 * It is also a legitimate first-class choice, not just a fallback — a call
 * where the phone rings and then you talk is often the quieter, more plausible
 * option in a room where a second voice would be heard.
 */

import type { Persona } from "@/domain/persona";
import type { CallEvent, VoiceProvider, VoiceSession } from "@/ports";

export function createSilentVoiceProvider(): VoiceProvider {
  return {
    id: "silent",

    /** Always. That is the entire point of this provider. */
    isAvailable(): boolean {
      return true;
    },

    start(_persona: Persona, signal: AbortSignal): Promise<VoiceSession> {
      let stopped = signal.aborted;
      // Resolved by `stop()` or by the caller's signal. Holding the resolver
      // rather than polling means the session consumes nothing while it waits —
      // it is genuinely idle for the whole call.
      let release: () => void = () => {};
      const finished = new Promise<void>((resolve) => {
        release = () => {
          stopped = true;
          resolve();
        };
      });

      const onAbort = (): void => release();
      if (stopped) {
        release();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      async function* events(): AsyncGenerator<CallEvent> {
        try {
          if (stopped) {
            yield { type: "ended" };
            return;
          }
          // Connected immediately: there is no handshake to wait for, and the
          // UI must start its timer the moment the user answers.
          yield { type: "connected" };
          await finished;
          yield { type: "ended" };
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      }

      let iterator: AsyncGenerator<CallEvent> | null = null;

      return Promise.resolve({
        events(): AsyncIterable<CallEvent> {
          // Cached so two consumers cannot each get their own "connected".
          iterator ??= events();
          return iterator;
        },
        stop(): void {
          release();
        },
      });
    },
  };
}
