/**
 * Ports — the interfaces the app depends on, and the ONLY thing a component is
 * allowed to know about the platform.
 *
 * Every hostile browser quirk documented in `research/web-platform-constraints.md`
 * is quarantined behind one of these. A component that wants to ring a phone
 * asks a `RingtonePlayer`; it never learns that the ringtone has to come out of
 * an `<audio>` element because the iOS silent switch mutes Web Audio, and it
 * never has to change when that stops being true.
 *
 * Concrete implementations live in `src/adapters/**` and are constructed in
 * exactly one place: `src/lib/container.ts`.
 */

import type { Persona } from "@/domain/persona";
import type { Settings } from "@/domain/settings";

/* ------------------------------------------------------------------ clock -- */

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

/* --------------------------------------------------------------- settings -- */

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
  clear(): void;
}

/* --------------------------------------------------------------- ringtone -- */

export interface RingtonePlayer {
  /**
   * Called from inside a real user gesture, BEFORE any deferred playback.
   *
   * On iOS, playback rights are granted per user activation and do not survive
   * a `setTimeout`; the only way to ring later is to take the rights now and
   * keep the element alive. Every implementation must be safe to call more than
   * once and must never throw — a failed unlock degrades the app to a silent
   * call, which is still useful, rather than breaking it.
   */
  unlock(): Promise<void>;
  startRinging(): Promise<void>;
  stopRinging(): void;
  /** Short one-shot cues; failure is always swallowed. */
  playCue(cue: "connect" | "disconnect"): void;
  dispose(): void;
}

/* ----------------------------------------------------------------- speech -- */

export interface SpeechRequest {
  readonly text: string;
  readonly rate?: number;
  readonly pitch?: number;
  readonly signal?: AbortSignal;
}

export interface SpeechSynthesizer {
  /** False when the platform has no usable voice; callers fall back to text. */
  isAvailable(): boolean;
  /**
   * Must be called during a user gesture. iOS leaves `getVoices()` empty until
   * a `voiceschanged` event that only fires after the engine is touched once.
   */
  warmUp(): Promise<void>;
  /** Resolves when the line finishes; resolves (not rejects) if it is cut off. */
  speak(request: SpeechRequest): Promise<void>;
  cancel(): void;
}

/* ------------------------------------------------------------------ voice -- */

export type VoiceProviderId = "silent" | "scripted" | "ai";

/** Everything a voice session can tell the UI. Providers emit nothing else. */
export type CallEvent =
  | { type: "connecting" }
  | { type: "connected" }
  /** The caller is speaking this line right now; drives subtitles. */
  | { type: "line"; text: string }
  /** The caller has stopped and is "listening" — the gap in the conversation. */
  | { type: "listening" }
  | { type: "error"; message: string }
  | { type: "ended" };

export interface VoiceSession {
  /** Async iteration keeps the UI a consumer and the provider a producer, with
   * backpressure and cancellation for free via the `AbortSignal`. */
  events(): AsyncIterable<CallEvent>;
  /** Only the AI tier uses this; the others ignore it. */
  sendUserSpeech?(text: string): void;
  stop(): void;
}

export interface VoiceProvider {
  readonly id: VoiceProviderId;
  /** Cheap, synchronous, no network — a key-presence/API-presence check. */
  isAvailable(): boolean;
  start(persona: Persona, signal: AbortSignal): Promise<VoiceSession>;
}

/* ----------------------------------------------------------------- camera -- */

export type CameraFacing = "user" | "environment";

export interface CameraSource {
  isSupported(): boolean;
  start(facing: CameraFacing): Promise<MediaStream>;
  stop(): void;
  /** Resolves to the new stream, or rejects if only one camera exists. */
  flip(): Promise<MediaStream>;
}

/* ---------------------------------------------------- haptics & wake lock -- */

export interface Haptics {
  /** No-op on iOS Safari, which has never shipped `navigator.vibrate`. */
  isSupported(): boolean;
  buzz(pattern: number | number[]): void;
  cancel(): void;
}

export interface WakeLock {
  isSupported(): boolean;
  /** Never throws; a denied wake lock just means the screen may dim. */
  request(): Promise<void>;
  release(): void;
}
