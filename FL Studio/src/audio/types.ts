/**
 * The engine's internal vocabulary (SPEC.md §3).
 *
 * Everything here is expressed in terms of `BaseAudioContext` rather than
 * `AudioContext`, because the WAV exporter (§3.5) runs the *same* voice
 * constructors against an `OfflineAudioContext`. A voice that reached for
 * anything only a live context has would silently fork the export's sound from
 * the one the user auditioned.
 */

import type { ChannelId, MixerTrackId, VoiceKind } from "@/domain/types";

/**
 * A voice that is currently sounding.
 *
 * `endTime` is the context time after which the voice is guaranteed silent —
 * the pool prunes on it, so it must always be the *scheduled* end, never an
 * optimistic guess.
 */
export interface ActiveVoice {
  readonly kind: VoiceKind;
  /** The voice's own summing gain; every release ramps this param. */
  readonly output: GainNode;
  /** Context time the voice was triggered at. FIFO stealing orders on it. */
  readonly startTime: number;
  /** Context time the voice goes silent under its own envelope. */
  endTime: number;
  released: boolean;
  /**
   * Ramp to silence from `time` and stop the sources afterwards.
   *
   * Never a hard cut (SPEC.md §3.3): the implementation anchors the current
   * value with `setValueAtTime` and then `linearRampToValueAtTime(0, …)`, and
   * only calls `stop()` once the ramp has completed.
   */
  release(time: number, releaseSec?: number): void;
}

/** Everything a voice constructor needs to build one note. */
export interface VoiceTrigger {
  ctx: BaseAudioContext;
  /** Where the voice's output connects — the channel strip's input gain. */
  destination: AudioNode;
  /** Absolute context time of the note-on. */
  time: number;
  /** MIDI pitch. Percussive voices use it as a tuning offset from 60. */
  pitch: number;
  /** 0..1; scales the envelope peak (channel volume is a later stage). */
  velocity: number;
  /** Sustain length in seconds — melodic voices only; drums ignore it. */
  durationSec: number;
}

export type VoiceBuilder = (trigger: VoiceTrigger) => ActiveVoice;

/** One note the scheduler has decided to play, with swing already applied. */
export interface ScheduledEvent {
  /** Stored tick, unswung — kept for playhead/highlight correlation. */
  sourceTick: number;
  /** The tick actually queued: `sourceTick + swingDelayTicks(...)`. */
  scheduledTick: number;
  channelId: ChannelId;
  pitch: number;
  velocity: number;
  /** Sounding length in ticks; a step's 0 is widened to a blip here. */
  durationTicks: number;
  noteId: string;
}

/** The mixer strips the meters and the graph updater address (SPEC.md §3.4). */
export interface MeterTapTargets {
  master: AnalyserNode;
  tracks: Map<MixerTrackId, AnalyserNode>;
}

/** Public snapshot the UI polls/subscribes for transport state. */
export interface EngineSnapshot {
  started: boolean;
  playing: boolean;
  mode: "pattern" | "song";
  metronomeEnabled: boolean;
}

export type { ChannelId, MixerTrackId, VoiceKind };
