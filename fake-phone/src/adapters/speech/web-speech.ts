/**
 * `window.speechSynthesis`, wrapped in everything it needs to be survivable.
 *
 * research/web-platform-constraints.md §8 is blunt about this API: "does not
 * work well enough". We ship it anyway as the *default* voice tier, because the
 * alternative — pre-rendered audio for every line of every persona — is a
 * multi-megabyte download for an app someone opens when they feel unsafe, and
 * because the scripted tier is designed to still read as a real call with no
 * sound at all (subtitles + listening pauses). That design decision is what
 * makes the API's unreliability survivable, and this adapter is where the
 * unreliability is contained.
 *
 * The documented failures, and where each is handled:
 *
 *   - `getVoices()` returns `[]` until an async `voiceschanged` fires
 *     → `warmUp()` waits for it, with a deadline so it can never hang.
 *   - The engine needs to be touched inside a user gesture before it will make
 *     sound later → `warmUp()` speaks a silent utterance.
 *   - Backgrounding kills an in-flight utterance and neither `onend` nor
 *     `onerror` may fire → every `speak()` carries a watchdog.
 *   - An utterance can stop dead after ~15s → the pause/resume keep-alive ping.
 *
 * The contract that matters most: **`speak()` resolves, never rejects.** A line
 * that fails to speak must not tear down the call — the subtitle still shows,
 * the listening pause still runs, and the conversation keeps its rhythm.
 */

import type { SpeechRequest, SpeechSynthesizer } from "@/ports";

/** How long `warmUp()` will wait for `voiceschanged` before giving up. */
const VOICES_DEADLINE_MS = 1_500;

/**
 * Safari and Chrome both stop a long utterance dead at roughly 15 seconds. The
 * long-standing workaround is to `pause()` then `resume()` the queue on an
 * interval, which resets the engine's internal timer. We ping well inside the
 * window so a slow tick can't miss it.
 */
const KEEP_ALIVE_MS = 10_000;

/** Rough spoken-word pace, used for the watchdog deadline only. */
const MS_PER_CHARACTER = 75;
const WATCHDOG_SLACK_MS = 4_000;

/**
 * Voices that sound like a person rather than a screen reader, in preference
 * order. Availability depends on which language packs the device has installed,
 * which we cannot control or query ahead of time — so this is a preference
 * list, never a requirement, and an unknown device just gets its default voice.
 */
const PREFERRED_VOICE_NAMES = [
  "samantha",
  "karen",
  "moira",
  "serena",
  "daniel",
  "google uk english female",
  "google us english",
  "microsoft aria",
  "microsoft libby",
];

/** Novelty/robotic system voices that would instantly break the illusion. */
const REJECTED_VOICE_NAMES = [
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "deranged",
  "good news",
  "jester",
  "organ",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox",
];

function estimateSpeechMs(text: string): number {
  return Math.max(600, text.length * MS_PER_CHARACTER);
}

function documentLanguage(): string {
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}

/**
 * Picks the most natural available voice for the page language.
 *
 * Scored rather than filtered: on a device with no matching local voice we
 * still want *a* voice, because a slightly wrong accent is much less damaging
 * to the illusion than no sound at all.
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: string,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const base = language.toLowerCase().split("-")[0];

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const name = voice.name.toLowerCase();
    if (REJECTED_VOICE_NAMES.some((rejected) => name.includes(rejected))) continue;

    const voiceLang = voice.lang.toLowerCase().replace("_", "-");
    let score = 0;
    if (voiceLang === language.toLowerCase()) score += 40;
    else if (voiceLang.split("-")[0] === base) score += 25;

    const preference = PREFERRED_VOICE_NAMES.findIndex((preferred) => name.includes(preferred));
    if (preference >= 0) score += 20 - preference;

    // A local voice needs no network and cannot stall mid-line on a bad
    // connection — which is exactly the situation this app is used in.
    if (voice.localService) score += 10;
    if (voice.default) score += 2;

    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }

  return best ?? voices[0];
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
    return null;
  }
  return window.speechSynthesis;
}

export function createSpeechSynthesizer(): SpeechSynthesizer {
  let warmUpPromise: Promise<void> | null = null;
  let warmedUp = false;
  /** Null until `warmUp()` has looked; `[]` means the device really has none. */
  let knownVoices: readonly SpeechSynthesisVoice[] | null = null;
  let voice: SpeechSynthesisVoice | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  function stopKeepAlive(): void {
    if (keepAlive !== null) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  }

  function startKeepAlive(synth: SpeechSynthesis): void {
    stopKeepAlive();
    keepAlive = setInterval(() => {
      try {
        // Order matters: resume() on an unpaused queue is a no-op, so the pause
        // must come first for the pair to reset the engine's cut-off timer.
        synth.pause();
        synth.resume();
      } catch {
        stopKeepAlive();
      }
    }, KEEP_ALIVE_MS);
  }

  function readVoices(synth: SpeechSynthesis): readonly SpeechSynthesisVoice[] {
    try {
      return synth.getVoices() ?? [];
    } catch {
      return [];
    }
  }

  return {
    /**
     * Optimistic before warm-up, honest after.
     *
     * Before `warmUp()` an empty voice list proves nothing — on iOS it is the
     * *expected* state — so the presence of the API is the best signal we have.
     * Once warm-up has run and still found no voice, the platform genuinely has
     * nothing to speak with and the scripted tier should switch to its
     * subtitles-and-pauses fallback rather than racing through silent lines.
     */
    isAvailable(): boolean {
      if (getSynth() === null) return false;
      if (knownVoices === null) return true;
      return knownVoices.length > 0;
    },

    warmUp(): Promise<void> {
      if (warmUpPromise) return warmUpPromise;
      const synth = getSynth();
      if (synth === null) {
        warmUpPromise = Promise.resolve();
        return warmUpPromise;
      }

      warmUpPromise = new Promise<void>((resolve) => {
        let settled = false;
        let deadline: ReturnType<typeof setTimeout> | null = null;

        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (deadline !== null) clearTimeout(deadline);
          try {
            synth.removeEventListener("voiceschanged", onVoicesChanged);
          } catch {
            /* listener was never attached */
          }
          knownVoices = readVoices(synth);
          voice = pickVoice(knownVoices, documentLanguage());
          warmedUp = true;
          resolve();
        };

        const onVoicesChanged = (): void => {
          if (readVoices(synth).length > 0) finish();
        };

        // Speaking a blank, muted utterance is the accepted way to "touch" the
        // engine inside the user gesture. It costs nothing audible and is what
        // makes a later, non-gesture `speak()` produce sound at all on iOS.
        try {
          const kick = new SpeechSynthesisUtterance(" ");
          kick.volume = 0;
          synth.speak(kick);
        } catch {
          /* some engines reject an all-whitespace utterance; harmless */
        }

        if (readVoices(synth).length > 0) {
          finish();
          return;
        }

        try {
          synth.addEventListener("voiceschanged", onVoicesChanged);
        } catch {
          /* fall through to the deadline */
        }
        // The deadline is the point: `voiceschanged` may never fire, and a
        // warm-up that never resolves would stall the call before it starts.
        deadline = setTimeout(finish, VOICES_DEADLINE_MS);
      });

      return warmUpPromise;
    },

    speak(request: SpeechRequest): Promise<void> {
      const synth = getSynth();
      if (synth === null || request.text.trim() === "") return Promise.resolve();
      if (request.signal?.aborted) return Promise.resolve();

      return new Promise<void>((resolve) => {
        let settled = false;
        let watchdog: ReturnType<typeof setTimeout> | null = null;

        const finish = (): void => {
          if (settled) return;
          settled = true;
          if (watchdog !== null) clearTimeout(watchdog);
          stopKeepAlive();
          request.signal?.removeEventListener("abort", onAbort);
          // Always resolve. An utterance cut short by backgrounding, a missing
          // voice, or an engine error is a line the user does not hear — not a
          // reason to end their call.
          resolve();
        };

        const onAbort = (): void => {
          try {
            synth.cancel();
          } catch {
            /* nothing in the queue */
          }
          finish();
        };

        try {
          const utterance = new SpeechSynthesisUtterance(request.text);
          if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
          } else if (!warmedUp) {
            utterance.lang = documentLanguage();
          }
          if (request.rate !== undefined) utterance.rate = request.rate;
          if (request.pitch !== undefined) utterance.pitch = request.pitch;
          utterance.onend = finish;
          utterance.onerror = finish;

          request.signal?.addEventListener("abort", onAbort, { once: true });

          // The watchdog covers the iOS case where speech is interrupted and
          // *neither* callback ever fires, which would otherwise hang the
          // scripted call on this line forever.
          watchdog = setTimeout(finish, estimateSpeechMs(request.text) + WATCHDOG_SLACK_MS);

          startKeepAlive(synth);
          synth.speak(utterance);
        } catch {
          finish();
        }
      });
    },

    /** Safe at any time, including when nothing is speaking. */
    cancel(): void {
      stopKeepAlive();
      const synth = getSynth();
      if (synth === null) return;
      try {
        synth.cancel();
      } catch {
        /* an engine mid-teardown can throw; there is nothing to cancel */
      }
    },
  };
}
