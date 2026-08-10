"use client";

/**
 * Picks a skin, wires it to the controller, and sends the user home when the
 * call ends.
 *
 * This is the whole of the app's entry experience: `/` renders this and nothing
 * else, so a cold boot lands on a ringing phone rather than a menu.
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { useSettings } from "@/components/app-shell/settings-provider";
import type { Settings } from "@/domain/settings";

import { AndroidCallSkin } from "./android/android-call-skin";
import { IosCallSkin } from "./ios/ios-call-skin";
import { CALL_TEST_IDS, type CallSkinProps } from "./types";
import { useCallController } from "./use-call-controller";

export function CallScreen() {
  const { settings, hydrated } = useSettings();

  // The controller reads its ring delay, persona and voice tier once, when it
  // mounts. Mounting it before stored settings have hydrated would arm a call
  // with the defaults and then have to correct itself mid-ring, so the ringing
  // background renders alone for that one frame instead.
  if (!hydrated) {
    return <div data-testid="call-screen" className="h-full w-full bg-black" />;
  }

  return <ActiveCall settings={settings} />;
}

function ActiveCall({ settings }: { settings: Settings }) {
  const router = useRouter();

  const goHome = useCallback(() => router.push("/home"), [router]);
  const call = useCallController(settings, goHome);

  if (call.countdownRemaining !== null) {
    // Cancel leaves this route rather than refreshing it. `router.refresh()`
    // re-renders the server component and deliberately *preserves* client
    // state — so the countdown kept running behind the refresh and the call
    // rang anyway, which is the one thing a button labelled Cancel must not
    // do. Navigating to /home unmounts this tree, and the controller's effect
    // cleanup clears the interval and hands back the wake lock with it.
    return <RingCountdown seconds={call.countdownRemaining} onCancel={goHome} />;
  }

  const skinProps: CallSkinProps = {
    phase: call.state.phase,
    callerName: settings.caller.name,
    callerLabel: settings.caller.label,
    photo: settings.caller.photo,
    elapsedSeconds: call.elapsedSeconds,
    muted: call.state.muted,
    speaker: call.state.speaker,
    keypadOpen: call.state.keypadOpen,
    subtitle: settings.showSubtitles ? call.subtitle : null,
    onAnswer: call.answer,
    onDecline: call.decline,
    onHangUp: call.hangUp,
    onToggleMute: call.toggleMute,
    onToggleSpeaker: call.toggleSpeaker,
    onToggleKeypad: call.toggleKeypad,
  };

  return settings.skin === "android" ? (
    <AndroidCallSkin {...skinProps} />
  ) : (
    <IosCallSkin {...skinProps} />
  );
}

/**
 * Shown only when a ring delay is configured.
 *
 * It states the platform constraint outright instead of letting it fail
 * silently: mobile Safari suspends timers and audio when the screen locks, so a
 * delayed call rings only while this screen stays visible. The competitive
 * research found "it never rang" to be the single most common one-star review
 * of apps in this category, always from apps that promised background ringing
 * they could not deliver.
 */
function RingCountdown({ seconds, onCancel }: { seconds: number; onCancel: () => void }) {
  return (
    <div
      data-testid="ring-countdown"
      className="flex h-full w-full flex-col items-center justify-center gap-6 bg-ground px-8 text-center"
    >
      <p className="text-sm uppercase tracking-[0.3em] text-text-secondary">calling in</p>
      <p className="tabular text-[5rem] leading-none font-light text-text-primary">{seconds}</p>
      <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
        Keep this screen on. Phones pause web timers and sound when the display locks, so the call
        can only arrive while fake-phone is in front of you.
      </p>
      <button
        onClick={onCancel}
        data-testid="ring-countdown-cancel"
        className="mt-2 rounded-full border border-hairline px-6 py-3 text-sm text-text-primary"
      >
        Cancel
      </button>
    </div>
  );
}

export { CALL_TEST_IDS };
