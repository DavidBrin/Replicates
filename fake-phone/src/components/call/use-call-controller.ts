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
} from "@/domain/call-session";
import { getPersona } from "@/domain/persona-catalog";
import type { Settings } from "@/domain/settings";
import type { VoiceSession } from "@/ports";

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
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const phase = state.phase;

  /* --------------------------------------------------------- ring delay -- */

  useEffect(() => {
    if (phase !== "idle") return;
    if (settings.ringDelaySeconds <= 0) {
      dispatch({ type: "RING" });
      return;
    }
    let remaining = settings.ringDelaySeconds;
    setCountdownRemaining(remaining);
    const id = setInterval(() => {
      remaining -= 1;
      setCountdownRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        setCountdownRemaining(null);
        dispatch({ type: "RING" });
      }
    }, 1000);
    return () => clearInterval(id);
    // Intentionally keyed on the delay only: re-running this when `phase`
    // changes would restart the countdown after the call is answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ringDelaySeconds]);

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
      void ringtone.unlock().then(() => ringtone.startRinging().catch(() => {}));
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
    if (phase !== "connecting") return;
    const { clock, ringtone, speech, wakeLock } = container;

    ringtone.stopRinging();
    ringtone.playCue("connect");
    void wakeLock.request();

    const abort = new AbortController();
    abortRef.current = abort;
    let cancelled = false;

    const persona = getPersona(settings.personaId);
    const provider = container.voiceFor(settings.voiceTier);

    void (async () => {
      // Warming the synthesizer here rather than at first `speak()` matters on
      // iOS, where the voice list is empty until the engine has been touched
      // once — a cold `speak()` silently says nothing.
      await speech.warmUp().catch(() => {});

      let session: VoiceSession | null = null;
      try {
        session = await provider.start(persona, abort.signal);
      } catch {
        // A provider that cannot start must not strand the user on a
        // "connecting" screen: connect anyway and run the call silently.
        if (!cancelled) dispatch({ type: "CONNECTED", at: clock.now() });
        return;
      }
      if (cancelled) {
        session.stop();
        return;
      }
      voiceRef.current = session;

      for await (const event of session.events()) {
        if (cancelled) break;
        switch (event.type) {
          case "connected":
            dispatch({ type: "CONNECTED", at: clock.now() });
            break;
          case "line":
            setSubtitle(event.text);
            break;
          case "listening":
            setSubtitle(null);
            break;
          case "error":
            setSubtitle(null);
            break;
          case "ended":
            setSubtitle(null);
            break;
          default:
            break;
        }
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      voiceRef.current?.stop();
      voiceRef.current = null;
    };
  }, [phase, container, settings.personaId, settings.voiceTier]);

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
    void container.ringtone.unlock();
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
