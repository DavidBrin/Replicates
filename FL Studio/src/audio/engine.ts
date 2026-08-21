"use client";

/**
 * The engine singleton — SPEC.md §3's public surface, frozen by §8:
 *
 * `ensureStarted() · play() · stop() · setMode() · previewNote(channelId,
 * pitch, durationSec?) · getMeterTap(trackId) · exportWav()`
 *
 * plus the store seam §3.2/§5 require: {@link syncProject} (push the current
 * `Project` in; the engine never reaches back out) and {@link getPlayheadTicks}
 * (what a rAF playhead reads, instead of subscribing per tick).
 *
 * ## Boot (§3.1)
 *
 * Nothing audio exists until a gesture. The lifecycle is exactly: first gesture
 * → dynamic `import("tone")` → `await Tone.start()` → every native node built
 * on `Tone.getContext().rawContext`. One context, one clock — there is no
 * `new AudioContext()` anywhere in `src/audio`. `play()` and `previewNote()`
 * are synchronous by contract, so when they are called before boot they kick
 * off `ensureStarted()` and replay themselves once it lands; that is what makes
 * "press Space as the very first thing you do" work.
 *
 * ## Why the store is pushed in, not pulled
 *
 * §6's layering rule says `src/audio` imports only `src/domain` (+ Tone/Web
 * Audio). So the engine takes a `Project` through {@link syncProject} and the
 * wiring layer owns the `useAppStore.subscribe(…)` that feeds it. The engine
 * re-arms the transport only when the compiled timeline, the swing or the
 * metronome flag actually changed — a fader drag ramps gains and re-arms
 * nothing.
 */

import { compileTimelineCached } from "@/domain/compile";
import { ticksToSeconds } from "@/domain/tickMath";
import {
  MASTER_MIXER_TRACK_ID,
  type ChannelId,
  type MixerTrackId,
  type PlaybackMode,
  type Project,
} from "@/domain/types";

import { exportProjectWav, type ExportedWav, type ExportOptions } from "./exportWav";
import { MixerGraph } from "./mixerGraph";
import {
  armTransport,
  eventDurationSeconds,
  isDownbeat,
  triggerMetronomeClick,
  type TransportLike,
} from "./scheduler";
import type { EngineSnapshot, ScheduledEvent } from "./types";
import { VoiceManager } from "./voicePool";

/** The slice of the Tone module the engine uses — structural, so it can be faked. */
export interface ToneLike {
  start(): Promise<void>;
  getContext(): { rawContext: BaseAudioContext & { state?: string; resume?: () => Promise<void> } };
  getTransport(): TransportLike;
}

export type ToneLoader = () => Promise<ToneLike>;

/** Default preview length for a clicked piano-roll key (§4.4 key preview). */
export const PREVIEW_DURATION_SEC = 0.35;

interface EngineState {
  tone: ToneLike;
  ctx: BaseAudioContext;
  transport: TransportLike;
  graph: MixerGraph;
  voices: VoiceManager;
}

let state: EngineState | null = null;
let bootPromise: Promise<void> | null = null;
let project: Project | null = null;
let playing = false;
let metronomeEnabled = false;
/** Replayed once boot lands — see the class comment on synchronous callers. */
let playRequested = false;
/** Tone is loaded and the context is live, but there was no project to wire. */
let pendingBoot: { tone: ToneLike; ctx: BaseAudioContext } | null = null;

/**
 * What the transport is currently armed with — the re-arm decision's inputs.
 *
 * These are the *compiler's* inputs plus the two scheduling inputs the compiler
 * deliberately leaves out (swing, §3.2; the metronome, D1). Compared by
 * reference: commands rebuild only the sub-objects they touch, so a tempo or
 * fader change keeps `patterns`/`clips` identical and re-arms nothing, while a
 * note edit replaces `patterns` and re-arms exactly once.
 */
interface ArmedInputs {
  patterns: Project["patterns"];
  clips: Project["clips"];
  playlistTracks: Project["playlistTracks"];
  mode: PlaybackMode;
  activePatternId: string;
  swing: number;
  metronome: boolean;
}

let armed: ArmedInputs | null = null;

const listeners = new Set<(snapshot: EngineSnapshot) => void>();

/**
 * Cast once, here. Tone's own `Time`/`PlaybackState` unions are wider than the
 * structural {@link TransportLike} this engine needs, and widening the
 * interface to match them would make the fake transport in the unit tests
 * impossible to write.
 */
let toneLoader: ToneLoader = async () => (await import("tone")) as unknown as ToneLike;

/* --------------------------------------------------------- lifecycle ---- */

/**
 * Boot the engine, at most once, on a user gesture (§3.1).
 *
 * Safe to call on every gesture: a running context short-circuits, and a
 * suspended one is resumed — browsers auto-suspend after silence, so
 * "first-gesture-only" is not a safe assumption (lane 3 §3).
 */
export async function ensureStarted(): Promise<void> {
  if (state !== null) {
    await resumeIfNeeded(state.ctx);
    return;
  }
  if (bootPromise !== null) return bootPromise;
  bootPromise = boot();
  try {
    await bootPromise;
  } finally {
    bootPromise = null;
  }
}

async function boot(): Promise<void> {
  const tone = await toneLoader();
  await tone.start(); // creates AND resumes the one context
  const ctx = tone.getContext().rawContext;
  await resumeIfNeeded(ctx);
  const current = project;
  if (current === null) {
    // Nothing to build a graph from yet; the next syncProject() completes boot.
    // Keeping the loaded module means the dynamic import is paid once.
    bootWithoutProject(tone, ctx);
    return;
  }
  state = createState(tone, ctx, current);
  emit();
  if (playRequested) {
    playRequested = false;
    play();
  }
}

function bootWithoutProject(tone: ToneLike, ctx: BaseAudioContext): void {
  pendingBoot = { tone, ctx };
}

function createState(tone: ToneLike, ctx: BaseAudioContext, forProject: Project): EngineState {
  return {
    tone,
    ctx,
    transport: tone.getTransport(),
    graph: new MixerGraph(ctx, forProject),
    voices: new VoiceManager(ctx),
  };
}

async function resumeIfNeeded(ctx: BaseAudioContext): Promise<void> {
  const resumable = ctx as BaseAudioContext & { state?: string; resume?: () => Promise<void> };
  if (resumable.state !== "running" && typeof resumable.resume === "function") {
    await resumable.resume();
  }
}

/* ------------------------------------------------------- store seam ----- */

/**
 * Push the current project in (the §5 store seam).
 *
 * Cheap and idempotent: gains and pans are ramped every call, but the
 * transport is re-armed only when the schedule actually changed.
 */
export function syncProject(next: Project): void {
  project = next;

  if (state === null) {
    if (pendingBoot !== null) {
      state = createState(pendingBoot.tone, pendingBoot.ctx, next);
      pendingBoot = null;
      emit();
      if (playRequested) {
        playRequested = false;
        play();
      }
    }
    return;
  }

  state.graph.sync(next);
  state.transport.bpm.value = next.tempo;
  if (needsRearm(next)) rearm();
}

function armedInputsOf(current: Project): ArmedInputs {
  return {
    patterns: current.patterns,
    clips: current.clips,
    playlistTracks: current.playlistTracks,
    mode: current.playbackMode,
    activePatternId: current.activePatternId,
    swing: current.globalSwing,
    metronome: metronomeEnabled,
  };
}

/**
 * A re-arm is needed only when the *schedule* changed.
 *
 * Tempo is absent from {@link ArmedInputs} on purpose — BPM is a live signal,
 * so a tempo change must never re-queue notes — and so are channel volume/pan,
 * which are ramped into the graph instead. `compileTimelineCached` is *not*
 * usable as the comparison: it memoizes per `Project` object, so any new
 * project object (a fader drag included) yields a new timeline object.
 */
function needsRearm(next: Project): boolean {
  if (armed === null) return true;
  const wanted = armedInputsOf(next);
  return (Object.keys(wanted) as (keyof ArmedInputs)[]).some((key) => armed?.[key] !== wanted[key]);
}

/* --------------------------------------------------------- transport ---- */

function rearm(): void {
  if (state === null || project === null) return;
  const current = project;
  const timeline = compileTimelineCached(current);
  const { transport, graph, ctx } = state;

  armTransport({
    transport,
    timeline,
    project: current,
    metronomeEnabled,
    onNote: triggerEvent,
    onMetronome: (tick, time) =>
      triggerMetronomeClick(ctx, graph.metronomeDestination, time, isDownbeat(tick)),
  });
  armed = armedInputsOf(current);
}

/**
 * Every trigger uses the transport's own `time` argument (§3.2) and reads the
 * *current* project rather than the one captured when the loop was armed —
 * changing a channel's voice or volume must not need a re-arm to be heard.
 */
function triggerEvent(event: ScheduledEvent, time: number): void {
  if (state === null || project === null) return;
  const forProject = project;
  const channel = forProject.channels[event.channelId];
  if (channel === undefined) return;
  const destination = state.graph.channelInput(event.channelId);
  if (destination === null) return;
  state.voices.trigger({
    channelId: event.channelId,
    kind: channel.voice,
    chokeGroup: channel.chokeGroup,
    destination,
    time,
    pitch: event.pitch,
    velocity: event.velocity,
    durationSec: eventDurationSeconds(event, forProject.tempo),
  });
}

/**
 * Start playback from the top.
 *
 * Stop-over-pause (§3.2, Tone issue #370): the transport is always stopped and
 * re-started rather than resumed, so repeated Space presses cannot accumulate
 * the clock/timeline bookkeeping that issue describes.
 */
export function play(): void {
  if (state === null) {
    playRequested = true;
    void ensureStarted();
    return;
  }
  if (armed === null) rearm();
  state.transport.stop();
  state.transport.ticks = 0;
  state.transport.start();
  playing = true;
  emit();
}

export function stop(): void {
  playRequested = false;
  if (state === null) return;
  state.transport.stop();
  state.transport.ticks = 0;
  state.voices.releaseAll(state.ctx.currentTime);
  playing = false;
  emit();
}

/**
 * Flip pattern/song (`L`).
 *
 * The mode lives in the project (§5's non-undoable navigation), so this only
 * re-arms the transport source; `syncProject` carries the actual field. Keeps
 * playing if it was playing, from the top of the new source.
 */
export function setMode(mode: PlaybackMode): void {
  if (project === null || project.playbackMode === mode) return;
  project = { ...project, playbackMode: mode };
  if (state === null) return;
  const wasPlaying = playing;
  state.voices.releaseAll(state.ctx.currentTime);
  rearm();
  if (wasPlaying) play();
}

/* ----------------------------------------------------------- preview ---- */

/**
 * Sound one note immediately — the piano roll's keyboard column and the rack's
 * row preview (§1.1). Synchronous by contract; gates boot like Play does.
 */
export function previewNote(
  channelId: ChannelId,
  pitch: number,
  durationSec: number = PREVIEW_DURATION_SEC,
): void {
  if (state === null || project === null) {
    void ensureStarted().then(() => {
      if (state !== null && project !== null) firePreview(channelId, pitch, durationSec);
    });
    return;
  }
  firePreview(channelId, pitch, durationSec);
}

function firePreview(channelId: ChannelId, pitch: number, durationSec: number): void {
  if (state === null || project === null) return;
  const channel = project.channels[channelId];
  if (channel === undefined) return;
  const destination = state.graph.channelInput(channelId);
  if (destination === null) return;
  state.voices.trigger({
    channelId,
    kind: channel.voice,
    chokeGroup: channel.chokeGroup,
    destination,
    // A hair ahead of `currentTime`: scheduling in the past is applied
    // instantly, which is the discontinuity every ramp here exists to avoid.
    time: state.ctx.currentTime + 0.001,
    pitch,
    velocity: 1,
    durationSec,
  });
}

/* ------------------------------------------------------------- meters --- */

/** The `AnalyserNode` tap for a mixer strip (§3.4). `null` before boot. */
export function getMeterTap(trackId: MixerTrackId = MASTER_MIXER_TRACK_ID): AnalyserNode | null {
  return state?.graph.meterTap(trackId) ?? null;
}

/* -------------------------------------------------------------- export -- */

/**
 * Render and encode the project (§3.5, D2). Needs no live engine: the exporter
 * builds its own `OfflineAudioContext` from the same voice/mixer code.
 */
export async function exportWav(options: ExportOptions = {}): Promise<ExportedWav> {
  if (project === null) throw new Error("exportWav: no project has been synced to the engine");
  return exportProjectWav(project, options);
}

/* ------------------------------------------------------ introspection --- */

/** Transport position in domain ticks — what a rAF playhead reads (§5). */
export function getPlayheadTicks(): number {
  if (state === null) return 0;
  return state.transport.ticks;
}

/** Playhead position in seconds, for anything that would rather not do tick math. */
export function getPlayheadSeconds(): number {
  if (project === null) return 0;
  return ticksToSeconds(getPlayheadTicks(), project.tempo);
}

export function isPlaying(): boolean {
  return playing;
}

export function isStarted(): boolean {
  return state !== null;
}

export function setMetronomeEnabled(enabled: boolean): void {
  if (metronomeEnabled === enabled) return;
  metronomeEnabled = enabled;
  if (state !== null && project !== null) rearm();
  emit();
}

export function getSnapshot(): EngineSnapshot {
  return {
    started: state !== null,
    playing,
    mode: project?.playbackMode ?? "pattern",
    metronomeEnabled,
  };
}

/** Transport-state subscription for the toolbar's play/stop button. */
export function subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  const snapshot = getSnapshot();
  for (const listener of listeners) listener(snapshot);
}

/* ------------------------------------------------------------- teardown - */

/** Tear the engine down — HMR, page teardown, and between unit tests. */
export function disposeEngine(): void {
  if (state !== null) {
    state.transport.stop();
    state.transport.cancel(0);
    state.voices.releaseAll(state.ctx.currentTime, 0.005);
    state.graph.dispose();
  }
  state = null;
  pendingBoot = null;
  bootPromise = null;
  project = null;
  playing = false;
  metronomeEnabled = false;
  armed = null;
  playRequested = false;
  listeners.clear();
}

/** Test seam: swap the dynamic `import("tone")` for a fake module. */
export function __setToneLoaderForTests(loader: ToneLoader | null): void {
  toneLoader = loader ?? (async () => (await import("tone")) as unknown as ToneLike);
}
