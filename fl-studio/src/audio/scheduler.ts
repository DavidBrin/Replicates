/**
 * Compiled events → transport schedule (SPEC.md §3.2), plus the metronome (D1).
 *
 * Everything in this file above {@link armTransport} is **pure**: it takes a
 * compiled timeline and returns the list of decisions — which events play, at
 * which tick after swing, for how long. That is deliberate, and it is what
 * SPEC.md §7 means by unit-testing "scheduling *decisions*": no context, no
 * transport, no nodes.
 *
 * ## Why arm-the-whole-loop rather than a hand-rolled 25 ms tick
 *
 * Lane 3 §1's look-ahead scheduler is the algorithm; `Tone.Transport` is an
 * implementation of it (a 25 ms-class clock with its own lookahead window that
 * converts every queued event to a sample-accurate `AudioContext` timestamp).
 * SPEC.md §3.2 makes the Transport the single clock and forbids any surface a
 * private one, so the engine hands the Transport the loop's events once —
 * `transport.schedule(cb, ticks)`, with `loop`/`loopStart`/`loopEnd` set — and
 * lets Tone re-fire them each cycle from its own look-ahead. Re-arming happens
 * on the events that actually change the schedule (play, mode flip, project
 * edit, swing change); tempo does not, because BPM is a live signal.
 *
 * Every callback receives the Transport's `time` argument and passes it
 * straight through to the voice — never `Tone.now()`, never `Date.now()`
 * (§3.2, lane 5 §2).
 */

import type { CompiledTimeline } from "@/domain/compile";
import { swingDelayTicks, ticksToSeconds } from "@/domain/tickMath";
import { PPQ, TICKS_PER_BEAT, TICKS_PER_STEP, type Project } from "@/domain/types";

import type { ScheduledEvent } from "./types";
import { createNoiseSource, SILENCE } from "./voices/shared";

/**
 * Sounding length given to a step (`lengthTicks === 0`) — SPEC.md §3.2's "the
 * scheduler gives those its own short blip envelope". One 16th: long enough
 * that a bass step has a body, short enough that consecutive steps re-trigger
 * rather than slur.
 */
export const STEP_BLIP_TICKS = TICKS_PER_STEP;

/* ------------------------------------------------- pure decisions ------- */

/**
 * The events to queue for one pass of `timeline`, with swing applied.
 *
 * Two decisions live here:
 *
 * - **Swing is added now, never stored** (§3.2, lane 2 §6). Only off-beat
 *   16ths are swung, and only if they are step-aligned — `swingDelayTicks`
 *   owns that rule so the roll and the engine cannot disagree.
 * - **A swung note that lands at or past the loop end is dropped**, not
 *   wrapped. Wrapping would sound it a full loop early, which is audibly worse
 *   than losing the last swung 16th of a bar at extreme swing.
 */
export function scheduleEvents(timeline: CompiledTimeline, globalSwing: number): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (const event of timeline.events) {
    const scheduledTick = event.tick + swingDelayTicks(event.tick, globalSwing);
    if (scheduledTick >= timeline.lengthTicks) continue;
    out.push({
      sourceTick: event.tick,
      scheduledTick,
      channelId: event.channelId,
      pitch: event.pitch,
      velocity: event.velocity,
      durationTicks: event.lengthTicks > 0 ? event.lengthTicks : STEP_BLIP_TICKS,
      noteId: event.noteId,
    });
  }
  return out.sort((a, b) => a.scheduledTick - b.scheduledTick || (a.noteId < b.noteId ? -1 : 1));
}

/** Beat ticks of one loop pass — where the metronome clicks (D1). */
export function metronomeBeatTicks(lengthTicks: number): number[] {
  const ticks: number[] = [];
  for (let tick = 0; tick < lengthTicks; tick += TICKS_PER_BEAT) ticks.push(tick);
  return ticks;
}

/** True on the downbeat of a bar — the accented click. */
export function isDownbeat(tick: number): boolean {
  return tick % (TICKS_PER_BEAT * 4) === 0;
}

/** Sounding seconds of a scheduled event at `bpm`. */
export function eventDurationSeconds(event: ScheduledEvent, bpm: number): number {
  return ticksToSeconds(event.durationTicks, bpm);
}

/* --------------------------------------------------- metronome voice ---- */

export const METRONOME_DECAY_SEC = 0.03;
export const METRONOME_ACCENT_HZ = 2000;
export const METRONOME_HZ = 1400;
export const METRONOME_LEVEL = 0.25;

/**
 * A tiny click on the master bus, synthesized from the same noise primitive as
 * the hats (D1: "synthesized from the existing noise primitives").
 */
export function triggerMetronomeClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  time: number,
  accented: boolean,
): void {
  const noise = createNoiseSource(ctx);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = accented ? METRONOME_ACCENT_HZ : METRONOME_HZ;
  band.Q.value = 8;
  const gain = ctx.createGain();
  const peak = accented ? METRONOME_LEVEL : METRONOME_LEVEL * 0.6;
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(SILENCE, time + METRONOME_DECAY_SEC);
  gain.gain.setValueAtTime(0, time + METRONOME_DECAY_SEC);
  noise.connect(band).connect(gain).connect(destination);
  noise.start(time);
  noise.stop(time + METRONOME_DECAY_SEC);
}

/* ----------------------------------------------------- transport arm ---- */

/** The slice of `Tone.Transport` the engine touches — structural, so it can be faked. */
export interface TransportLike {
  PPQ: number;
  bpm: { value: number };
  loop: boolean;
  loopStart: unknown;
  loopEnd: unknown;
  ticks: number;
  state: string;
  schedule(callback: (time: number) => void, time: string | number): number;
  cancel(after?: number): unknown;
  start(time?: unknown, offset?: unknown): unknown;
  stop(time?: unknown): unknown;
}

/** Tone's tick notation: `"192i"` means "192 transport ticks" (PPQ-relative). */
export function ticksNotation(ticks: number): string {
  return `${Math.max(0, Math.round(ticks))}i`;
}

export interface ArmOptions {
  transport: TransportLike;
  timeline: CompiledTimeline;
  project: Project;
  metronomeEnabled: boolean;
  /** Called with the Transport's own `time` argument — never a clock read. */
  onNote: (event: ScheduledEvent, time: number) => void;
  onMetronome: (tick: number, time: number) => void;
}

/**
 * Clear and re-queue the whole loop. Returns the scheduled events, so the
 * caller (and the tests) can see exactly what was armed.
 */
export function armTransport(options: ArmOptions): ScheduledEvent[] {
  const { transport, timeline, project, metronomeEnabled, onNote, onMetronome } = options;
  transport.cancel(0);
  // Set BEFORE any tick-notation value is handed over: at PPQ 96 a transport
  // tick IS a domain tick, and every `"…i"` string below relies on it.
  transport.PPQ = PPQ;
  transport.bpm.value = project.tempo;
  transport.loop = true;
  transport.loopStart = 0;
  transport.loopEnd = ticksNotation(timeline.lengthTicks);

  const events = scheduleEvents(timeline, project.globalSwing);
  for (const event of events) {
    transport.schedule((time) => onNote(event, time), ticksNotation(event.scheduledTick));
  }
  if (metronomeEnabled) {
    for (const tick of metronomeBeatTicks(timeline.lengthTicks)) {
      transport.schedule((time) => onMetronome(tick, time), ticksNotation(tick));
    }
  }
  return events;
}
