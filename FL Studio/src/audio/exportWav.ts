/**
 * Export WAV (SPEC.md §3.5, decision D2).
 *
 * ## The approach chosen
 *
 * **A hand-rolled offline render of the compiled schedule, not Tone-on-offline.**
 * §3.5's own wording sanctions it — "rebuild the … compiled event list against
 * an `OfflineAudioContext` … reusing the same voice constructors (they take a
 * `BaseAudioContext`)" — and it is the option that keeps the export honest:
 *
 * - The voice recipes, the 8-voice pools, the FIFO steal, the choke groups and
 *   the whole `channel → track → master → limiter` chain are the *same code*
 *   ({@link MixerGraph}, {@link VoiceManager}), because none of them ever
 *   needed more than a `BaseAudioContext`.
 * - The only thing Tone contributed to playback was the clock, and an offline
 *   render does not need one: every event's time is `ticksToSeconds(tick,
 *   tempo)`, computed algebraically from the fixed loop length rather than
 *   accumulated (lane 3 §6's rounding-drift caveat).
 * - Nothing here imports Tone at all, so the exporter runs without booting the
 *   live engine and is unit-testable against the audio stub.
 *
 * Swing is applied by the same `scheduleEvents` the transport is armed with,
 * so the file matches what was auditioned.
 */

import { compilePatternMode, compileSongMode, type CompiledTimeline } from "@/domain/compile";
import { ticksToSeconds } from "@/domain/tickMath";
import type { Project } from "@/domain/types";

import { MixerGraph } from "./mixerGraph";
import { eventDurationSeconds, scheduleEvents } from "./scheduler";
import { VoiceManager } from "./voicePool";

/** Room for the last note's release and the limiter's tail. */
export const EXPORT_TAIL_SECONDS = 2;

export const EXPORT_SAMPLE_RATE = 44100;
export const EXPORT_CHANNELS = 2;

export type OfflineContextFactory = (
  channels: number,
  frames: number,
  sampleRate: number,
) => OfflineAudioContext;

export interface ExportOptions {
  /** Which timeline to render; defaults to the project's `playbackMode`. */
  mode?: "pattern" | "song";
  sampleRate?: number;
  /** Injected in tests; defaults to the real `OfflineAudioContext`. */
  createOfflineContext?: OfflineContextFactory;
}

function defaultOfflineFactory(
  channels: number,
  frames: number,
  sampleRate: number,
): OfflineAudioContext {
  if (typeof OfflineAudioContext === "undefined") {
    throw new Error("OfflineAudioContext is unavailable in this environment");
  }
  return new OfflineAudioContext(channels, frames, sampleRate);
}

/** Total render length in seconds for a timeline at the project's tempo. */
export function renderLengthSeconds(timeline: CompiledTimeline, tempo: number): number {
  return ticksToSeconds(timeline.lengthTicks, tempo) + EXPORT_TAIL_SECONDS;
}

function timelineFor(project: Project, mode: "pattern" | "song"): CompiledTimeline {
  return mode === "song" ? compileSongMode(project) : compilePatternMode(project);
}

/**
 * Render the project to an `AudioBuffer` through the live graph's own code.
 *
 * Pattern mode exports one loop of the active pattern; song mode exports the
 * arrangement (§3.5).
 */
export async function renderProject(
  project: Project,
  options: ExportOptions = {},
): Promise<AudioBuffer> {
  const mode = options.mode ?? project.playbackMode;
  const sampleRate = options.sampleRate ?? EXPORT_SAMPLE_RATE;
  const timeline = timelineFor(project, mode);
  const frames = Math.max(1, Math.ceil(renderLengthSeconds(timeline, project.tempo) * sampleRate));

  const factory = options.createOfflineContext ?? defaultOfflineFactory;
  const ctx = factory(EXPORT_CHANNELS, frames, sampleRate);
  const base = ctx as unknown as BaseAudioContext;

  const graph = new MixerGraph(base, project);
  const voices = new VoiceManager(base);

  for (const event of scheduleEvents(timeline, project.globalSwing)) {
    const channel = project.channels[event.channelId];
    if (channel === undefined) continue;
    const destination = graph.channelInput(event.channelId);
    if (destination === null) continue;
    voices.trigger({
      channelId: event.channelId,
      kind: channel.voice,
      chokeGroup: channel.chokeGroup,
      destination,
      time: ticksToSeconds(event.scheduledTick, project.tempo),
      pitch: event.pitch,
      velocity: event.velocity,
      durationSec: eventDurationSeconds(event, project.tempo),
    });
  }

  // The metronome is a playback aid, never part of an exported mix.
  return ctx.startRendering();
}

/* ------------------------------------------------------- WAV encoding --- */

const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const WAV_HEADER_BYTES = 44;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Interleaved 16-bit PCM WAV, little-endian — the one format every browser and
 * DAW opens without negotiation.
 */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const dataBytes = frames * channels * BYTES_PER_SAMPLE;
  const out = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, channels * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = data[c]?.[frame] ?? 0;
      // Clamp before scaling: a sample above 1 would wrap to a loud negative.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff)), true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return out;
}

/** A default filename that sorts and survives a filesystem. */
export function wavFileName(project: Project, mode: "pattern" | "song"): string {
  const slug = project.name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${slug === "" ? "project" : slug}-${mode}.wav`;
}

export interface ExportedWav {
  blob: Blob;
  fileName: string;
  durationSeconds: number;
}

/** Render + encode. Downloading is the caller's job (it owns the DOM). */
export async function exportProjectWav(
  project: Project,
  options: ExportOptions = {},
): Promise<ExportedWav> {
  const mode = options.mode ?? project.playbackMode;
  const buffer = await renderProject(project, { ...options, mode });
  const bytes = encodeWav(buffer);
  return {
    blob: new Blob([bytes], { type: "audio/wav" }),
    fileName: wavFileName(project, mode),
    durationSeconds: buffer.length / buffer.sampleRate,
  };
}
