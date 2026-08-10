"use client";

/**
 * The call controller: the one place where the pure state machine, the audio
 * layer, the voice provider and the wake lock are wired together.
 *
 * Skins consume the result and render it. Keeping every side effect here means
 * a skin can be unit-tested with plain props, and means the iOS and Android
 * skins cannot drift in behaviour — only in appearance.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  callReducer,
  elapsedSeconds as computeElapsed,
  initialCallState,
  isOnCall,
} from "@/domain/call-session";
import { getPersona } from "@/domain/persona-catalog";
import type { Settings } from "@/domain/settings";
import type { VoiceProvider, VoiceSession } from "@/ports";

import { useContainer } from "../app-shell/container-provider";

export interface CallController {
  state: ReturnType<typeof callReducer>;
  elapsedSeconds: number;
  subtitle: string | null;
  /** Seconds left before the call rings, or null once it is ringing. */
  countdownRemaining: number | null;
  answer: () => void;
  decline: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  toggleKeypad: () => void;
}

export function useCallController(settings: Settings, onEnded: () => void): CallController {
  const container = useContainer();
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const [elapsed, setElapsed] = useState(0);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(
    settings.ringDelaySeconds > 0 ? settings.ringDelaySeconds : null,
  );

  const voiceRef = useRef<VoiceSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // `onEnded` is called from timers and event handlers; holding it in a ref
  // keeps those effects from re-subscribing every time the parent re-renders.
  // Written in an effect rather than during render — a render may be discarded,
  // and a ref written by a discarded render outlives it.
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const phase = state.phase;
  /**
   * True for `connecting` *and* `active` — one boolean covering the whole
   * lifetime of a call, so the voice effect below is not re-run (and its session
   * not destroyed) merely because the call finished connecting.
   */
  const onCall = isOnCall(state);

  /* --------------------------------------------------------- ring delay -- */

  useEffect(() => {
    if (phase !== "idle") return;
    if (settings.ringDelaySeconds <= 0) {
      dispatch({ type: "RING" });
      return;
    }
    const { wakeLock } = container;

    // The wake lock is held for the *countdown*, not only for the call.
    //
    // A phone with a 30s display timeout locks itself halfway through a 60s
    // delay, and a locked screen suspends both this interval and the audio —
    // so the call simply never arrives. That is the "it never rang" one-star
    // review the competitive research found under every app in this category,
    // and D12 says we state the constraint and mitigate it rather than ship it
    // silently. `request()` never throws; a denied lock just means the screen
    // may still dim, which is the status quo, not a regression.
    const acquired = wakeLock.request();
    // Release is chained onto the request rather than called outright: the
    // adapter holds a single sentinel it assigns *after* its await, so a
    // countdown cancelled in its first frames would otherwise release nothing
    // and strand a lock that keeps the screen on for the rest of the session.
    const releaseWakeLock = () => {
      void acquired.then(() => wakeLock.release());
    };

    // No synchronous `setCountdownRemaining` here: the initial value already
    // came from this hook's `useState` initializer, and setting it again on
    // mount would just be a second render for the same number. The parent only
    // mounts this hook once settings have hydrated, so that initializer is
    // never working from stale defaults.
    let remaining = settings.ringDelaySeconds;
    const id = setInterval(() => {
      remaining -= 1;
      setCountdownRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        setCountdownRemaining(null);
        // Handed back on the ring: the connecting effect takes its own lock
        // when the call is answered, and the adapter keeps one sentinel, so a
        // second request over a live one would orphan the first.
        releaseWakeLock();
        dispatch({ type: "RING" });
      }
    }, 1000);

    // Covers both cancellation (the countdown screen's Cancel unmounts this)
    // and unmount. Releasing twice is harmless; the adapter has already
    // dropped its sentinel.
    return () => {
      clearInterval(id);
      releaseWakeLock();
    };
    // Intentionally keyed on the delay only: re-running this when `phase`
    // changes would restart the countdown after the call is answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ringDelaySeconds, container]);

  /* ----------------------------------------------------------- ringtone -- */

  useEffect(() => {
    if (phase !== "ringing" || !settings.ringtoneEnabled) return;
    const { ringtone, haptics } = container;

    let cancelled = false;
    void ringtone.startRinging().catch(() => {
      /* blocked until a gesture; the listener below picks it up */
    });

    // A cold-booted tab has no user activation, so the first `play()` is very
    // likely to be blocked — the screen rings silently. Rather than pretend
    // otherwise, the first touch anywhere on the document unlocks audio and
    // starts the ringtone for real. On the path that matters most (arriving
    // from the home screen's "start a call" button) the unlock has already
    // happened and this never fires.
    const unlockOnGesture = () => {
      if (cancelled) return;
      void ringtone.unlock().then(() => {
        // Re-checked after the await, not only before it. The tap that unlocks
        // audio is very often the same tap that answers or declines: this
        // listener runs on `pointerdown`, the button's `click` tears the effect
        // down, and the unlock promise then resolves into a torn-down world. A
        // `startRinging()` from here would loop the ringtone over a live call
        // or over the home screen, with nothing left mounted to stop it.
        if (cancelled) return;
        return ringtone.startRinging().catch(() => {});
      });
    };
    document.addEventListener("pointerdown", unlockOnGesture, { once: true });

    // Vibration is a no-op on iOS Safari by design; see `NavigatorHaptics`.
    haptics.buzz([600, 900, 600, 900]);

    return () => {
      cancelled = true;
      document.removeEventListener("pointerdown", unlockOnGesture);
      ringtone.stopRinging();
      haptics.cancel();
    };
  }, [phase, settings.ringtoneEnabled, container]);

  /* -------------------------------------------------------- auto-answer -- */

  useEffect(() => {
    if (phase !== "ringing" || settings.autoAnswerSeconds <= 0) return;
    const id = setTimeout(() => dispatch({ type: "ANSWER" }), settings.autoAnswerSeconds * 1000);
    return () => clearTimeout(id);
  }, [phase, settings.autoAnswerSeconds]);

  /* ------------------------------------------------------------- voice --- */

  useEffect(() => {
    // Keyed on `onCall`, NOT on `phase === "connecting"`.
    //
    // This effect owns the voice session for the whole call. Keyed on the phase,
    // it was torn down the instant the call connected: the provider emits
    // `connected`, the reducer moves to `active`, the dependency changes, React
    // runs the cleanup — which aborts the very session that was about to speak.
    // Every real provider pauses between lines, so the caller delivered its
    // first line and then went silent for the rest of the call, on the *default*
    // tier. It survived every test because a fake provider that yields
    // synchronously is fully consumed before React ever commits that first
    // state update, and because the e2e only asserted that a subtitle appeared
    // at all.
    if (!onCall) return;
    const { clock, ringtone, speech, wakeLock } = container;

    ringtone.stopRinging();
    ringtone.playCue("connect");
    void wakeLock.request();

    const abort = new AbortController();
    abortRef.current = abort;
    let cancelled = false;

    const persona = getPersona(settings.personaId);
    const provider = container.voiceFor(settings.voiceTier);

    let connected = false;
    // Tracked separately from `connected`, because they answer different
    // questions: `connected` is "did the call start", `spoke` is "did this
    // provider actually deliver a voice".
    let spoke = false;

    /**
     * Runs one provider to completion. Resolves when its event stream ends,
     * whether that was a clean finish or a failure — the caller decides what to
     * do about it. Never throws.
     */
    const run = async (candidate: VoiceProvider): Promise<void> => {
      let session: VoiceSession | null = null;
      try {
        session = await candidate.start(persona, abort.signal);
      } catch {
        return;
      }
      if (cancelled) {
        session.stop();
        return;
      }
      voiceRef.current = session;

      try {
        for await (const event of session.events()) {
          if (cancelled) break;
          switch (event.type) {
            case "connected":
              connected = true;
              dispatch({ type: "CONNECTED", at: clock.now() });
              break;
            case "line":
              spoke = true;
              setSubtitle(event.text);
              break;
            case "listening":
            case "error":
            case "ended":
              setSubtitle(null);
              break;
            default:
              break;
          }
        }
      } catch {
        // A provider whose iterator throws is a failed provider, not a crashed
        // call. Fall through to the recovery below.
      }
    };

    void (async () => {
      // A second, belt-and-braces warm-up for the paths that reach `connecting`
      // without a tap — auto-answer, and the e2e suite. The real one runs in
      // the answer handler, inside the gesture, where iOS actually grants it.
      await speech.warmUp().catch(() => {});

      await run(provider);

      // The AI tier's availability is a build-time flag, so the registry can
      // hand back the AI provider on a deployment whose server has no key, an
      // invalid key, or `VOICE_PROVIDER=scripted`. The registry cannot know
      // that — only the first request finds out. So the *runtime* fallback the
      // registry promises at construction time has to happen here.
      //
      // The trigger is "AI never spoke a line", not "AI never connected". A key
      // that is present but rejected or expired fails *later* than that: the
      // session route mints happily, the adapter emits `connected`, and only
      // the first turn discovers the upstream rejection. Gating on `connected`
      // would treat that as a working call and leave the user with a live timer
      // and total silence — the exact failure this fallback exists to prevent.
      // Re-connecting is harmless: the reducer ignores `CONNECTED` once the
      // call is active, so the timer keeps running while the scripted voice
      // takes over.
      if (!cancelled && !spoke && provider.id === "ai") {
        const fallback = container.voiceFor("scripted");
        if (fallback.id !== "ai") await run(fallback);
      }

      // Last resort. A provider that never connected must not leave the user
      // stranded on a "connecting" screen with a timer that never starts:
      // connect anyway and run the call silently.
      if (!cancelled && !connected) dispatch({ type: "CONNECTED", at: clock.now() });
    })();

    return () => {
      cancelled = true;
      abort.abort();
      voiceRef.current?.stop();
      voiceRef.current = null;
    };
  }, [onCall, container, settings.personaId, settings.voiceTier]);

  /* ------------------------------------------------------------- timer --- */

  useEffect(() => {
    if (phase !== "active") return;
    const { clock } = container;
    const tick = () => setElapsed(computeElapsed(state, clock.now()));
    tick();
    // Recomputed from the connect timestamp on every tick rather than
    // incremented, so a tab that Safari throttled in the background shows the
    // correct duration the moment it comes back rather than a timer that lost
    // the missing seconds.
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase, state, container]);

  /* ----------------------------------------------------------- teardown -- */

  useEffect(() => {
    if (phase !== "ended") return;
    const { ringtone, wakeLock, speech } = container;
    ringtone.stopRinging();
    ringtone.playCue("disconnect");
    speech.cancel();
    wakeLock.release();
    voiceRef.current?.stop();
    abortRef.current?.abort();

    // A beat of "Call ended" before the home screen — cutting straight to
    // settings the instant the red button is pressed looks like an app, not a
    // phone.
    const id = setTimeout(() => onEndedRef.current(), 700);
    return () => clearTimeout(id);
  }, [phase, container]);

  const answer = useCallback(() => {
    // Both of these MUST happen synchronously inside the tap, not in the
    // effect that follows. iOS grants audio playback and speech rights per
    // user activation, and that grant does not survive the trip through a
    // state update into an effect — warming the synthesizer there instead
    // means the first spoken line silently says nothing.
    void container.ringtone.unlock();
    void container.speech.warmUp().catch(() => {});
    dispatch({ type: "ANSWER" });
  }, [container]);

  const decline = useCallback(
    () => dispatch({ type: "DECLINE", at: container.clock.now() }),
    [container],
  );

  const hangUp = useCallback(
    () => dispatch({ type: "HANG_UP", at: container.clock.now() }),
    [container],
  );

  const toggleMute = useCallback(() => dispatch({ type: "TOGGLE_MUTE" }), []);
  const toggleSpeaker = useCallback(() => dispatch({ type: "TOGGLE_SPEAKER" }), []);
  const toggleKeypad = useCallback(() => dispatch({ type: "TOGGLE_KEYPAD" }), []);

  return useMemo(
    () => ({
      state,
      elapsedSeconds: elapsed,
      subtitle,
      countdownRemaining,
      answer,
      decline,
      hangUp,
      toggleMute,
      toggleSpeaker,
      toggleKeypad,
    }),
    [
      state,
      elapsed,
      subtitle,
      countdownRemaining,
      answer,
      decline,
      hangUp,
      toggleMute,
      toggleSpeaker,
      toggleKeypad,
    ],
  );
}
