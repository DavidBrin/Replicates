"use client";

/**
 * Thin placeholder wiring — SPEC §8 slice C directive.
 *
 * Slice A (`src/lib/store.ts`) and slice B (`src/audio/engine.ts`) are being
 * built concurrently and are not landed in this tree yet. Every stand-in for
 * their public surface lives in this ONE file, typed against SPEC §2 (domain
 * types) and SPEC §8's frozen contract points
 * (`store.dispatch(command)`; `ensureStarted() · play() · stop() · setMode() ·
 * previewNote(channelId, pitch, durationSec?) · getMeterTap(trackId) ·
 * exportWav()`), so the integration pass can delete this file's guts and
 * replace each call site with the real store/engine import without touching
 * component code.
 *
 * TODO(wire): once `src/lib/store.ts` lands, replace `useWiringState` +
 * the setter functions below with real zustand selectors / `store.dispatch`.
 * TODO(wire): once `src/audio/engine.ts` lands, replace `engineStub` with
 * `import * as engine from "@/audio/engine"`.
 */

import { useSyncExternalStore } from "react";

/** Mirrors SPEC §2's `Project["playbackMode"]`. */
export type PlaybackMode = "pattern" | "song";

/** Mirrors the subset of SPEC §2's `Pattern` the transport/toolbar needs. */
export interface PatternSummary {
  id: string;
  name: string;
  color: string;
}

/** Mirrors the subset of SPEC §2's `Project` the transport/toolbar reads. */
export interface WiringState {
  tempo: number; // BPM, clamp 10–522 (SPEC §2 Project.tempo)
  globalSwing: number; // 0..1 (SPEC §2 Project.globalSwing)
  playbackMode: PlaybackMode;
  activePatternId: string;
  patternOrder: string[];
  patterns: Record<string, PatternSummary>;
  isPlaying: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const TEMPO_MIN = 10;
export const TEMPO_MAX = 522; // SPEC §2 Project.tempo clamp 10–522 (lane 1 §1.2)
export const DEFAULT_TEMPO = 140; // SPEC §2 default

const DEFAULT_PATTERN_ID = "pattern-1";

function initialState(): WiringState {
  return {
    tempo: DEFAULT_TEMPO,
    globalSwing: 0,
    playbackMode: "pattern",
    activePatternId: DEFAULT_PATTERN_ID,
    patternOrder: [DEFAULT_PATTERN_ID],
    patterns: {
      [DEFAULT_PATTERN_ID]: {
        id: DEFAULT_PATTERN_ID,
        name: "Pattern 1",
        color: "#BCF1C6",
      },
    },
    isPlaying: false,
    canUndo: false,
    canRedo: false,
  };
}

let state: WiringState = initialState();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function patchState(patch: Partial<WiringState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WiringState {
  return state;
}

/** React binding for the placeholder state — swap for store selectors on wire-up. */
export function useWiringState(): WiringState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function clampTempo(
  value: number,
  min: number = TEMPO_MIN,
  max: number = TEMPO_MAX,
): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.round(finite)));
}

// TODO(wire): replace with store.dispatch(setTempoCommand(bpm)) — tempo is a
// domain field, mutated only via command per SPEC §5.
export function setTempo(bpm: number): void {
  patchState({ tempo: clampTempo(bpm) });
}

// TODO(wire): replace with store.dispatch(setSwingCommand(value)).
export function setGlobalSwing(value: number): void {
  patchState({ globalSwing: Math.min(1, Math.max(0, value)) });
}

// TODO(wire): playbackMode writes bypass the undo stack per SPEC §5's
// "non-undoable navigation" rule — this stub already reflects that (no
// undo-stack bookkeeping here), so wiring it up is a straight store swap.
export function togglePlaybackMode(): void {
  patchState({
    playbackMode: state.playbackMode === "pattern" ? "song" : "pattern",
  });
}

// TODO(wire): replace with a direct (non-undoable) write to
// store's activePatternId, per SPEC §5.
export function setActivePatternId(id: string): void {
  if (state.patterns[id]) {
    patchState({ activePatternId: id });
  }
}

export function selectAdjacentPattern(direction: 1 | -1): void {
  const order = state.patternOrder;
  if (order.length === 0) return;
  const currentIndex = order.indexOf(state.activePatternId);
  const nextIndex = (currentIndex + direction + order.length) % order.length;
  const nextId = order[nextIndex];
  if (nextId) setActivePatternId(nextId);
}

// TODO(wire): replace with store.dispatch(addPatternCommand()) — pattern
// creation is a domain command, undoable, per SPEC §2.1.
export function addPattern(): void {
  const nextNumber = state.patternOrder.length + 1;
  const id = `pattern-${nextNumber}`;
  const pattern: PatternSummary = {
    id,
    name: `Pattern ${nextNumber}`,
    color: "#BCF1C6",
  };
  patchState({
    patterns: { ...state.patterns, [id]: pattern },
    patternOrder: [...state.patternOrder, id],
    activePatternId: id,
  });
}

// TODO(wire): replace with store's command-stack undo/redo (SPEC §2.1) —
// capped at 200 entries, coalesced per drag gesture.
export function undo(): void {
  // no-op placeholder: nothing on the (nonexistent) stub undo stack yet.
}

export function redo(): void {
  // no-op placeholder: nothing on the (nonexistent) stub redo stack yet.
}

// TODO(wire): replace with store.dispatch(persistence commands) / calling
// src/domain/serialization.ts once slice A lands (SPEC §2.2).
export function saveProject(): void {
  // no-op placeholder.
}

export function exportJson(): void {
  // no-op placeholder.
}

export function importJson(_file: File): void {
  // no-op placeholder — signature matches the eventual file-input handler.
}

/**
 * TODO(wire): replace this whole object with
 * `import * as engine from "@/audio/engine"` once slice B lands. Signature
 * frozen by SPEC §8: `ensureStarted() · play() · stop() · setMode() ·
 * previewNote(channelId, pitch, durationSec?) · getMeterTap(trackId) ·
 * exportWav()`.
 */
export const engineStub = {
  ensureStarted: async (): Promise<void> => {
    // TODO(wire): dynamic import of Tone.js + engine boot (SPEC §3.1).
  },
  play: (): void => {
    patchState({ isPlaying: true });
  },
  stop: (): void => {
    patchState({ isPlaying: false });
  },
  setMode: (_mode: PlaybackMode): void => {
    // TODO(wire): re-arm transport source per SPEC §3.2.
  },
  previewNote: (
    _channelId: string,
    _pitch: number,
    _durationSec?: number,
  ): void => {
    // TODO(wire): keyboard-preview gesture also gates audio boot (SPEC §3.1).
  },
  getMeterTap: (_trackId: string): null => null,
  exportWav: async (): Promise<void> => {
    // TODO(wire): SPEC §3.5 OfflineAudioContext render.
  },
};

/** Play/Stop button handler: gesture-gates engine boot, then toggles. */
export async function togglePlayStop(): Promise<void> {
  await engineStub.ensureStarted();
  if (state.isPlaying) {
    engineStub.stop();
  } else {
    engineStub.play();
  }
}

/** Test-only: resets the module-level placeholder state between tests. */
export function __resetWiringForTests(): void {
  state = initialState();
  emit();
}
