/**
 * The composition root — the one module in the app that names a concrete
 * adapter. Components and domain code receive ports from here (via
 * `ContainerProvider`) and never import an adapter directly.
 *
 * Swapping the ringtone from an `<audio>` element to a native plugin, or the
 * scripted voice to a real one, is a change to this file and nothing else.
 *
 * Construction is lazy and client-only. Every adapter here touches a browser
 * global at construction time, and this module is imported by components that
 * Next renders on the server first, so building eagerly at module scope would
 * crash the server render.
 */

import { createRingtonePlayer } from "@/adapters/audio/element-ringtone";
import {
  LocalSettingsStore,
  MemorySettingsStore,
  NavigatorHaptics,
  ScreenWakeLock,
  SystemClock,
} from "@/adapters/browser";
import { createCameraSource } from "@/adapters/camera/media-devices";
import { createSpeechSynthesizer } from "@/adapters/speech/web-speech";
import { createVoiceProvider } from "@/adapters/voice/registry";
import type { VoiceTier } from "@/domain/settings";
import type {
  CameraSource,
  Clock,
  Haptics,
  RingtonePlayer,
  SettingsStore,
  SpeechSynthesizer,
  VoiceProvider,
  WakeLock,
} from "@/ports";

export interface Container {
  readonly clock: Clock;
  readonly settings: SettingsStore;
  readonly ringtone: RingtonePlayer;
  readonly speech: SpeechSynthesizer;
  readonly camera: CameraSource;
  readonly haptics: Haptics;
  readonly wakeLock: WakeLock;
  /**
   * Resolves a voice provider for the requested tier.
   *
   * Never throws and never returns null: the registry walks `ai → scripted →
   * silent` until it finds one that is available. A missing API key is
   * therefore an ordinary, tested state rather than an error path, which is the
   * whole reason the AI tier can ship inert.
   */
  voiceFor(tier: VoiceTier): VoiceProvider;
}

export function createBrowserContainer(): Container {
  const clock = new SystemClock();
  const speech = createSpeechSynthesizer();
  const settings = new LocalSettingsStore();

  return {
    clock,
    settings,
    ringtone: createRingtonePlayer(),
    speech,
    camera: createCameraSource(),
    haptics: new NavigatorHaptics(),
    wakeLock: new ScreenWakeLock(),
    voiceFor: (tier) =>
      createVoiceProvider(tier, {
        speech,
        clock,
        // Read at call time, not at container-construction time: the container
        // is a process-lifetime singleton and the user can rename the caller
        // between calls. Without this the AI tier briefs the model from the
        // persona's *suggested* name, so the screen could read "Mum" while the
        // caller introduced itself as "Sam".
        callerIdentity: () => settings.load().caller,
      }),
  };
}

/**
 * A container safe to construct during server rendering, where none of the
 * browser globals exist. Every port is inert; the real one replaces it on the
 * client after mount.
 */
export function createServerContainer(): Container {
  const clock = new SystemClock();
  const noopSpeech: SpeechSynthesizer = {
    isAvailable: () => false,
    warmUp: async () => {},
    speak: async () => {},
    cancel: () => {},
  };

  return {
    clock,
    settings: new MemorySettingsStore(),
    ringtone: {
      unlock: async () => {},
      startRinging: async () => {},
      stopRinging: () => {},
      playCue: () => {},
      dispose: () => {},
    },
    speech: noopSpeech,
    camera: {
      isSupported: () => false,
      start: async () => {
        throw new Error("No camera during server rendering.");
      },
      stop: () => {},
      flip: async () => {
        throw new Error("No camera during server rendering.");
      },
    },
    haptics: { isSupported: () => false, buzz: () => {}, cancel: () => {} },
    wakeLock: { isSupported: () => false, request: async () => {}, release: () => {} },
    voiceFor: (tier) => createVoiceProvider(tier, { speech: noopSpeech, clock }),
  };
}
