"use client";

/**
 * The wiring layer — where the store (slice A), the engine (slice B) and the
 * chrome (slice C) actually meet (SPEC §5, §6).
 *
 * This file used to be a placeholder holding a fake project and a fake
 * engine. Every stub is gone; what remains is the real thing, kept in ONE
 * module for the reason §6 gives: `src/audio` may not import the store, so
 * *someone* has to own `useAppStore.subscribe(…) → engine.syncProject(…)`,
 * the transport's play/stop/mode calls, the rAF playhead reads, and the
 * save/load/export/import side effects that touch both a `Project` and the
 * DOM. That someone is here, and the surfaces stay ignorant of each other.
 *
 * ## Boot stays lazy
 *
 * Importing `@/audio` is free: the engine's `import("tone")` lives inside
 * `ensureStarted()`, and nothing here calls it at module scope. Tone is
 * fetched on the first *gesture* (Play, or a note preview), exactly as
 * SPEC §3.1 requires.
 *
 * ## Why the audio calls are guarded
 *
 * {@link audioSupported} is false under jsdom (no `AudioContext`) and during
 * SSR. Without the guard, a component test that presses Space would drag
 * Tone.js into a DOM that cannot build an audio graph. The transport's
 * *UI* state is still honoured in that case — the button flips — because the
 * flag mirrors the user's intent and the engine's own snapshots overwrite it
 * the moment there is an engine.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import * as engine from "@/audio";
import { addPattern as addPatternCommand, replaceProject, updateProject } from "@/domain/commands";
import { nextId } from "@/domain/ids";
import { colorAt } from "@/domain/palette";
import { deserializeProject } from "@/domain/serialization";
import { clampTempo as clampTempoTicks } from "@/domain/tickMath";
import {
  MAX_TEMPO,
  MIN_TEMPO,
  DEFAULT_TEMPO as DOMAIN_DEFAULT_TEMPO,
  STORAGE_KEY,
  type PlaybackMode as DomainPlaybackMode,
  type Project,
} from "@/domain/types";
import {
  exportProjectJson,
  persistProject,
  selectCanRedo,
  selectCanUndo,
  startAutosave,
  useAppStore,
} from "@/lib/store";

/** Mirrors SPEC §2's `Project["playbackMode"]`. */
export type PlaybackMode = DomainPlaybackMode;

/** The subset of SPEC §2's `Pattern` the transport/toolbar needs. */
export interface PatternSummary {
  id: string;
  name: string;
  color: string;
}

/** The subset of SPEC §2's `Project` the transport/toolbar reads. */
export interface WiringState {
  tempo: number;
  globalSwing: number;
  playbackMode: PlaybackMode;
  activePatternId: string;
  patternOrder: string[];
  patterns: Record<string, PatternSummary>;
  isPlaying: boolean;
  metronomeEnabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const TEMPO_MIN = MIN_TEMPO;
export const TEMPO_MAX = MAX_TEMPO;
export const DEFAULT_TEMPO = DOMAIN_DEFAULT_TEMPO;

/* ------------------------------------------------------- audio presence -- */

function audioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof window.AudioContext !== "undefined" ||
      typeof (window as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined")
  );
}

/* ---------------------------------------------------- transport UI state -- */

interface TransportUi {
  isPlaying: boolean;
  metronomeEnabled: boolean;
}

const STOPPED: TransportUi = { isPlaying: false, metronomeEnabled: false };

/**
 * A cached mirror of the engine's transport snapshot.
 *
 * Cached deliberately: `engine.getSnapshot()` builds a fresh object per call,
 * and `useSyncExternalStore` compares snapshots by identity — handing it the
 * raw getter would re-render forever.
 */
let transportUi: TransportUi = STOPPED;
const transportListeners = new Set<() => void>();
let detachEngine: (() => void) | null = null;

function setTransportUi(next: TransportUi): void {
  if (next.isPlaying === transportUi.isPlaying && next.metronomeEnabled === transportUi.metronomeEnabled) {
    return;
  }
  transportUi = next;
  for (const listener of transportListeners) listener();
}

function subscribeTransport(listener: () => void): () => void {
  transportListeners.add(listener);
  if (detachEngine === null) {
    detachEngine = engine.subscribe((snapshot) =>
      setTransportUi({
        isPlaying: snapshot.playing,
        metronomeEnabled: snapshot.metronomeEnabled,
      }),
    );
  }
  return () => {
    transportListeners.delete(listener);
    if (transportListeners.size === 0) {
      detachEngine?.();
      detachEngine = null;
    }
  };
}

const getTransportUi = (): TransportUi => transportUi;
const getServerTransportUi = (): TransportUi => STOPPED;

export function useTransportUi(): TransportUi {
  return useSyncExternalStore(subscribeTransport, getTransportUi, getServerTransportUi);
}

/** Just the play flag — for surfaces that must not re-render on domain edits. */
export function useIsPlaying(): boolean {
  return useTransportUi().isPlaying;
}

/* ---------------------------------------------------------- toolbar view -- */

function summarize(project: Project): Record<string, PatternSummary> {
  const summaries: Record<string, PatternSummary> = {};
  for (const id of project.patternOrder) {
    const pattern = project.patterns[id];
    if (pattern !== undefined) {
      summaries[id] = { id: pattern.id, name: pattern.name, color: pattern.color };
    }
  }
  return summaries;
}

/** The toolbar's view of the project — real store reads, no stub anywhere. */
export function useWiringState(): WiringState {
  const project = useAppStore((state) => state.project);
  const canUndo = useAppStore(selectCanUndo);
  const canRedo = useAppStore(selectCanRedo);
  const { isPlaying, metronomeEnabled } = useTransportUi();

  return useMemo(
    () => ({
      tempo: project.tempo,
      globalSwing: project.globalSwing,
      playbackMode: project.playbackMode,
      activePatternId: project.activePatternId,
      patternOrder: [...project.patternOrder],
      patterns: summarize(project),
      isPlaying,
      metronomeEnabled,
      canUndo,
      canRedo,
    }),
    [project, isPlaying, metronomeEnabled, canUndo, canRedo],
  );
}

export function clampTempo(
  value: number,
  min: number = TEMPO_MIN,
  max: number = TEMPO_MAX,
): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.round(finite)));
}

/* -------------------------------------------------------- domain writes -- */

/**
 * Tempo and swing are domain fields, so they move by command (SPEC §5) — and
 * both are dragged, so both carry a `coalesceKey`: one LCD drag or one swing
 * sweep is one Ctrl+Z (SPEC §2.1).
 */
export function setTempo(bpm: number): void {
  const { project, dispatch } = useAppStore.getState();
  const tempo = clampTempoTicks(clampTempo(bpm));
  if (project.tempo === tempo) return;
  dispatch(updateProject({ tempo }), { coalesceKey: "transport:tempo" });
}

export function setGlobalSwing(value: number): void {
  const { project, dispatch } = useAppStore.getState();
  const globalSwing = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  if (project.globalSwing === globalSwing) return;
  dispatch(updateProject({ globalSwing }), { coalesceKey: "transport:swing" });
}

/**
 * `L`. Playback mode is persisted domain state that bypasses undo (SPEC §5's
 * navigation rule), so it is a direct store write — plus the engine re-arm,
 * which is the half the store cannot do.
 */
export function togglePlaybackMode(): void {
  const { project } = useAppStore.getState();
  setMode(project.playbackMode === "pattern" ? "song" : "pattern");
}

export function setMode(mode: PlaybackMode): void {
  useAppStore.getState().setPlaybackMode(mode);
  if (audioSupported()) engine.setMode(mode);
}

/** Navigation, not an edit (SPEC §5) — no undo entry. */
export function setActivePatternId(id: string): void {
  useAppStore.getState().setActivePatternId(id);
}

export function selectAdjacentPattern(direction: 1 | -1): void {
  const { project } = useAppStore.getState();
  const order = project.patternOrder;
  if (order.length === 0) return;
  const currentIndex = order.indexOf(project.activePatternId);
  const nextIndex = (currentIndex + direction + order.length) % order.length;
  const nextId = order[nextIndex];
  if (nextId !== undefined) setActivePatternId(nextId);
}

/** Creating a pattern IS an edit, so it goes on the undo stack (SPEC §2.1). */
export function addPattern(): void {
  const { project, dispatch } = useAppStore.getState();
  const index = project.patternOrder.length;
  dispatch(
    addPatternCommand({
      id: nextId("pattern"),
      name: `Pattern ${index + 1}`,
      color: colorAt(index + 6),
      notes: {},
    }),
  );
  const created = useAppStore.getState().project.patternOrder[index];
  if (created !== undefined) setActivePatternId(created);
}

export function undo(): void {
  useAppStore.getState().undo();
}

export function redo(): void {
  useAppStore.getState().redo();
}

/* ------------------------------------------------------------ transport -- */

/**
 * Play/Stop. The gesture is what gates audio boot (SPEC §3.1): `ensureStarted`
 * resolves the dynamic Tone import, and `play()` is safe to call before it
 * lands — the engine replays the request once booted.
 */
export async function togglePlayStop(): Promise<void> {
  if (transportUi.isPlaying) {
    stopPlayback();
    return;
  }
  await startPlayback();
}

export async function startPlayback(): Promise<void> {
  setTransportUi({ ...transportUi, isPlaying: true });
  if (!audioSupported()) return;
  await engine.ensureStarted();
  engine.play();
}

export function stopPlayback(): void {
  setTransportUi({ ...transportUi, isPlaying: false });
  if (audioSupported()) engine.stop();
}

export function toggleMetronome(): void {
  const enabled = !transportUi.metronomeEnabled;
  setTransportUi({ ...transportUi, metronomeEnabled: enabled });
  if (audioSupported()) engine.setMetronomeEnabled(enabled);
}

/**
 * The one audition seam (SPEC §8's `previewNote`) — the piano roll's keyboard
 * column and any rack row preview call through here so the audio-presence
 * guard lives in a single place.
 */
export function previewNote(channelId: string, pitch: number, durationSec?: number): void {
  if (!audioSupported()) return;
  engine.previewNote(channelId, pitch, durationSec);
}

/* ------------------------------------------------------------- playhead -- */

/**
 * The transport position, read on a rAF loop rather than subscribed per tick
 * (SPEC §5). Returned as a *getter* so an imperative canvas can sample it
 * inside its own frame without a React render.
 */
export function getPlayheadTick(): number | null {
  if (!transportUi.isPlaying) return null;
  return engine.getPlayheadTicks();
}

/**
 * The same reading as React state, for surfaces whose playhead is DOM
 * (the Playlist). Only a changed value re-renders, and the loop only exists
 * while the transport runs.
 */
export function usePlayheadTicks(enabled: boolean): number | undefined {
  const [ticks, setTicks] = useState<number | undefined>(undefined);
  const isPlaying = useIsPlaying();

  useEffect(() => {
    if (!enabled || !isPlaying || typeof window === "undefined") {
      setTicks(undefined);
      return;
    }
    let frame = window.requestAnimationFrame(function read(): void {
      setTicks(engine.getPlayheadTicks());
      frame = window.requestAnimationFrame(read);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, isPlaying]);

  return ticks;
}

/* ---------------------------------------------------------- persistence -- */

function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next task: revoking synchronously can beat the download in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeFileName(name: string, extension: string): string {
  const base = name.trim().replace(/[^a-z0-9\-_ ]/gi, "").replace(/\s+/g, "-");
  return `${base === "" ? "project" : base}.${extension}`;
}

/** Explicit save — the same localStorage envelope autosave writes (SPEC §2.2). */
export function saveProject(): void {
  persistProject(useAppStore.getState().project);
}

export function exportJson(): void {
  const { project } = useAppStore.getState();
  downloadBlob(
    new Blob([exportProjectJson(project)], { type: "application/json" }),
    safeFileName(project.name, "json"),
  );
}

/**
 * JSON import is undoable, so it goes through `replaceProject` rather than
 * `loadProject` (SPEC §2.2) — a mis-clicked import is one Ctrl+Z away.
 */
export async function importJson(file: File): Promise<void> {
  const imported = deserializeProject(await file.text());
  if (imported === null) return;
  useAppStore.getState().dispatch(replaceProject(imported));
}

export async function exportWav(): Promise<void> {
  if (!audioSupported()) return;
  const rendered = await engine.exportWav();
  downloadBlob(rendered.blob, rendered.fileName);
}

/* ------------------------------------------------------- runtime wiring -- */

/**
 * Push the project into the engine and keep pushing it (SPEC §3.2/§5's store
 * seam). `syncProject` is cheap and idempotent, and the engine decides on its
 * own whether the change warrants re-arming the transport.
 */
export function startEngineSync(): () => void {
  engine.syncProject(useAppStore.getState().project);
  return useAppStore.subscribe((state, previous) => {
    if (state.project === previous.project) return;
    engine.syncProject(state.project);
  });
}

/**
 * Everything the shell starts once, on mount: adopt the saved project, feed
 * the engine, and start the debounced autosave. Returns one teardown.
 *
 * Hydration happens in an effect rather than during render on purpose — the
 * server rendered the default project, and reading localStorage any earlier
 * would be a hydration mismatch.
 */
export function startShellRuntime(): () => void {
  useAppStore.getState().hydrateFromStorage();
  const stopEngineSync = startEngineSync();
  const stopAutosave = startAutosave();
  return () => {
    stopAutosave();
    stopEngineSync();
  };
}

/* --------------------------------------------------------- e2e test hook -- */

/**
 * A read-only window handle for the Playwright suite.
 *
 * Guarded twice and installed by nobody else: it only exists when the page is
 * opened with `?e2e=1`, so the production path never defines it, and it
 * exposes reads plus the engine's playhead — no way to mutate the project
 * that the UI itself doesn't already offer. Canvas surfaces (the piano roll)
 * have no DOM to assert against, which is what this exists for.
 */
export interface E2eHook {
  getProject: () => Project;
  noteCount: (patternId?: string) => number;
  clipCount: () => number;
  playheadTicks: () => number;
  isPlaying: () => boolean;
  canUndo: () => boolean;
}

declare global {
  interface Window {
    __flStudioE2E?: E2eHook;
  }
}

export const E2E_QUERY_FLAG = "e2e";

export function e2eRequested(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(search).get(E2E_QUERY_FLAG) === "1";
}

export function installE2eHook(): () => void {
  if (typeof window === "undefined" || !e2eRequested()) return () => {};
  window.__flStudioE2E = {
    getProject: () => useAppStore.getState().project,
    noteCount: (patternId) => {
      const { project } = useAppStore.getState();
      const pattern = project.patterns[patternId ?? project.activePatternId];
      return pattern === undefined ? 0 : Object.keys(pattern.notes).length;
    },
    clipCount: () => Object.keys(useAppStore.getState().project.clips).length,
    playheadTicks: () => engine.getPlayheadTicks(),
    isPlaying: () => transportUi.isPlaying,
    canUndo: () => selectCanUndo(useAppStore.getState()),
  };
  return () => {
    delete window.__flStudioE2E;
  };
}

/* ----------------------------------------------------------------- tests -- */

/**
 * Test-only: return the shared store and the transport mirror to their boot
 * state. The store is a module singleton, so a component test that dispatches
 * would otherwise leak into the next file.
 */
export function __resetWiringForTests(): void {
  setTransportUi(STOPPED);
  useAppStore.getState().newProject();
  // Autosave runs while a shell is mounted, so a previous test's edit would
  // otherwise be hydrated back in by the next mount.
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage (SSR, private mode) — nothing to clear.
  }
}
