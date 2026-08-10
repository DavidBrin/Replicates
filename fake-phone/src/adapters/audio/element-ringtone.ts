/**
 * The ringtone, played through `HTMLAudioElement` — never through Web Audio.
 *
 * This file is where the single most important correctness bug in the product
 * is quarantined. Two platform facts drive every line of it:
 *
 *   1. **The iOS silent/ringer switch mutes Web Audio but not `<audio>`
 *      elements** (research/web-platform-constraints.md §3). Safari starts a
 *      page's audio session in the `ambient` category, which respects the
 *      hardware mute switch; an `<audio>` element implicitly gets promoted out
 *      of it, a raw `AudioContext` does not. Most phones live on vibrate. A
 *      ringtone synthesised through an `AudioContext` would therefore be
 *      *silent on the majority of the devices this app exists for* — which
 *      defeats the entire product. So: an element, always, and the generated
 *      WAV from `scripts/generate-audio.mjs` rather than live synthesis.
 *
 *   2. **Playback rights live inside transient activation**
 *      (research/web-platform-constraints.md §1). `play()` called from a
 *      `setTimeout` that fires seconds after the tap throws `NotAllowedError`.
 *      The only reliable pattern is to take the rights *during* the tap that
 *      schedules the call — `unlock()` below — and keep the same element alive
 *      until it is time to ring. We never try to re-acquire rights later.
 *
 * Everything here degrades rather than throws. A ringtone that fails to play
 * leaves a silent-but-working call screen; an exception out of this adapter
 * would leave a blank screen at the moment someone needed the app.
 */

import type { RingtonePlayer } from "@/ports";

const RINGTONE_SRC = "/audio/ringtone.wav";
const CUE_SRC: Record<"connect" | "disconnect", string> = {
  connect: "/audio/connect.wav",
  disconnect: "/audio/disconnect.wav",
};

/**
 * The AudioSession API (W3C draft, Safari-only as of this build) lets us
 * declare "this page's audio is playback, not ambient" explicitly, which is the
 * sanctioned version of the `<audio>` trick above. It is new enough that it
 * must be feature-detected, never assumed — hence the structural type and the
 * `in` check rather than a `Navigator` declaration merge.
 */
interface AudioSessionCapableNavigator {
  audioSession?: { type?: string };
}

function declarePlaybackSession(): void {
  if (typeof navigator === "undefined") return;
  const candidate = navigator as Navigator & AudioSessionCapableNavigator;
  if (!("audioSession" in candidate) || candidate.audioSession == null) return;
  try {
    candidate.audioSession.type = "playback";
  } catch {
    // A future/stricter implementation may make this read-only or reject the
    // value. The `<audio>` element is the real mitigation; this is the polite
    // version of it, so losing it costs nothing.
  }
}

function createElement(src: string, loop: boolean): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  const element = document.createElement("audio");
  element.src = src;
  element.loop = loop;
  element.preload = "auto";
  // `playsinline` is set as an attribute rather than a property: the property
  // is typed onto HTMLVideoElement only, but Safari honours the attribute on
  // audio elements too and without it iOS can hand playback to its own
  // full-screen player chrome — which would put a media UI on top of the call.
  element.setAttribute("playsinline", "");
  element.setAttribute("aria-hidden", "true");
  return element;
}

/**
 * Seeking to zero is a surprisingly good way to throw: an element whose media
 * has not loaded yet rejects the seek, and jsdom has no media pipeline at all.
 * It is also never important enough to abandon playback over — hence its own
 * guard rather than sharing a `try` with the `play()` that follows it.
 */
function rewind(element: HTMLAudioElement): void {
  try {
    element.currentTime = 0;
  } catch {
    /* the element will start from wherever it is */
  }
}

export function createRingtonePlayer(): RingtonePlayer {
  let ringtone: HTMLAudioElement | null = null;
  const cues = new Map<"connect" | "disconnect", HTMLAudioElement>();
  let unlockPromise: Promise<void> | null = null;
  let disposed = false;

  function ringtoneElement(): HTMLAudioElement | null {
    if (disposed) return null;
    ringtone ??= createElement(RINGTONE_SRC, true);
    return ringtone;
  }

  /**
   * Cues get their own elements. Sharing the ringtone element would mean
   * re-pointing its `src` to play a connect blip, and a `src` change resets the
   * element's playback state — throwing away the unlocked, ready-to-ring
   * element we spent a user gesture acquiring.
   */
  function cueElement(cue: "connect" | "disconnect"): HTMLAudioElement | null {
    if (disposed) return null;
    const existing = cues.get(cue);
    if (existing) return existing;
    const element = createElement(CUE_SRC[cue], false);
    if (element) cues.set(cue, element);
    return element;
  }

  /** Plays and immediately pauses, at zero volume, to claim playback rights. */
  async function claim(element: HTMLAudioElement): Promise<void> {
    const wasMuted = element.muted;
    element.muted = true;
    try {
      // `play()` must be *called* inside the gesture; awaiting its promise
      // afterwards is fine, because the permission decision was already made
      // synchronously at the call site.
      await element.play();
      element.pause();
      rewind(element);
    } catch {
      // Autoplay refused even under a gesture (some in-app browsers, some
      // Low Power Mode states). The caller has a tap-to-ring fallback.
    } finally {
      element.muted = wasMuted;
    }
  }

  return {
    /**
     * Idempotent by design: the call controller calls this on every plausible
     * gesture (the answer button, the settings "start a call" button, the first
     * touch anywhere) because it cannot know which tap will be the last one
     * before the ring, and a redundant unlock is free.
     */
    unlock(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (unlockPromise) return unlockPromise;

      declarePlaybackSession();

      const elements = [ringtoneElement(), cueElement("connect"), cueElement("disconnect")].filter(
        (element): element is HTMLAudioElement => element !== null,
      );

      // Started synchronously, inside the caller's gesture. Note the `all` is
      // over promises that never reject — `claim` swallows everything — so
      // `unlock()` itself can never reject and never needs a `.catch()` at a
      // call site.
      unlockPromise = Promise.all(elements.map(claim)).then(() => undefined);
      return unlockPromise;
    },

    async startRinging(): Promise<void> {
      const element = ringtoneElement();
      if (!element) return;
      element.loop = true;
      element.muted = false;
      element.volume = 1;
      rewind(element);
      try {
        await element.play();
      } catch {
        // Resolve quietly. `play()` rejecting here means we are outside
        // transient activation (a scheduled ring the user never tapped through,
        // or a tab that lost its unlock while backgrounded — §1). The call UI
        // keeps ringing visually and the caller offers a tap to bring sound
        // back; a rejected promise here would break the answer flow instead.
      }
    },

    stopRinging(): void {
      if (!ringtone) return;
      try {
        ringtone.pause();
      } catch {
        /* an element mid-load can throw; nothing to recover */
      }
      rewind(ringtone);
    },

    playCue(cue: "connect" | "disconnect"): void {
      const element = cueElement(cue);
      if (!element) return;
      rewind(element);
      try {
        void element.play().catch(() => {
          /* a missed blip is cosmetic */
        });
      } catch {
        /* ignored, as above */
      }
    },

    dispose(): void {
      disposed = true;
      unlockPromise = null;
      for (const element of [ringtone, ...cues.values()]) {
        if (!element) continue;
        try {
          element.pause();
          // Dropping the source lets the media element release its decoder and
          // buffered data; leaving it set keeps the download pinned for the
          // lifetime of the document.
          element.removeAttribute("src");
          element.load();
        } catch {
          /* nothing left to clean up */
        }
      }
      cues.clear();
      ringtone = null;
    },
  };
}
