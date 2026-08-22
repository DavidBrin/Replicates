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
import {
  addPattern as addPatternCommand,
  replaceProject,
  updatePattern,
  updateProject,
} from "@/domain/commands";
import { nextId, reseedIds } from "@/domain/ids";
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
import { commitGestureKey, oneShotGestureKey } from "@/lib/gestureHold";
import {
  exportProjectJson,
  loadPersistedProject,
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

/* --------------------------------------------------------------- notices -- */

/**
 * The one non-blocking status line — SPEC §4.1's toolbar, not a dialog.
 *
 * Three things can fail where the user's only other feedback would be silence:
 * audio boot (the browser refused the context, or Tone failed to load), the
 * explicit Save (quota exhausted, or Safari private mode), and a JSON import
 * of a file that is not a project. Each of those used to be a swallowed
 * `catch` or an unhandled promise rejection, so the UI simply looked like it
 * had worked.
 *
 * Kept to an external store rather than React state on purpose: the failures
 * happen inside plain async functions that no component owns, and the message
 * has to survive the transport bar re-rendering. `role="status"` on the
 * rendering element (see `TransportBar`) is what makes it reach a screen
 * reader without stealing focus. No dependency, no modal, no dismissal to
 * click — it expires on its own.
 */
export const NOTICE_TIMEOUT_MS = 6_000;

let notice: string | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
const noticeListeners = new Set<() => void>();

function emitNotice(): void {
  for (const listener of noticeListeners) listener();
}

/** Show a transient message; `null` clears it. Also mirrored to the console. */
export function setNotice(message: string | null): void {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  if (notice !== message) {
    notice = message;
    emitNotice();
  }
  if (message === null) return;
  console.warn(`[fl-studio] ${message}`);
  if (typeof setTimeout === "function") {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      notice = null;
      emitNotice();
    }, NOTICE_TIMEOUT_MS);
  }
}

function subscribeNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

const getNotice = (): string | null => notice;
const getServerNotice = (): string | null => null;

export function useNotice(): string | null {
  return useSyncExternalStore(subscribeNotice, getNotice, getServerNotice);
}

/** The same read without a component — for the shell's non-React callers. */
export function peekNotice(): string | null {
  return notice;
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

/** The transport mirror without a component — the non-hook counterpart. */
export function peekTransportUi(): TransportUi {
  return transportUi;
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
 *
 * The key alone is not enough. `"transport:tempo"` is fixed, so with nothing
 * else to separate them *every* tempo change the user ever made folded into a
 * single undo entry — nudge the LCD, come back after a dozen note edits, nudge
 * it again, and one Ctrl+Z took both back… as long as no other command had
 * landed in between, which made it look intermittent. `gestureId` is the fix
 * (`domain/undo.ts`'s canonical pattern): the caller mints one per drag /
 * per committed edit and passes it through, and two dispatches coalesce only
 * when the key *and* the gesture match. Callers that pass nothing get one
 * entry per change, which is the safe direction to be wrong in.
 */
export function setTempo(bpm: number, gestureId: string = nextGestureId()): void {
  const { project, dispatch } = useAppStore.getState();
  const tempo = clampTempoTicks(clampTempo(bpm));
  if (project.tempo === tempo) return;
  dispatch(updateProject({ tempo }), { coalesceKey: "transport:tempo", gestureId });
}

export function setGlobalSwing(value: number, gestureId: string = nextGestureId()): void {
  const { project, dispatch } = useAppStore.getState();
  const globalSwing = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  if (project.globalSwing === globalSwing) return;
  dispatch(updateProject({ globalSwing }), { coalesceKey: "transport:swing", gestureId });
}

let gestureCounter = 0;

/**
 * Mint a gesture id. Monotonic rather than random so a test can read it, and
 * per-module rather than per-control because it only has to be unique against
 * the *previous* gesture on the same control.
 */
export function nextGestureId(prefix = "gesture"): string {
  gestureCounter += 1;
  return `${prefix}-${gestureCounter}`;
}

/**
 * Open a gesture (SPEC §2.2): persistence is held off until the matching
 * {@link endGesture}. Pointer-driven controls whose drag state lives in a ref
 * call this on pointer-down — the store cannot see a ref.
 */
export function beginGesture(gestureId: string): void {
  useAppStore.getState().beginGesture(gestureId);
}

/**
 * Seal the coalescing entry in flight — the store-level gesture boundary.
 *
 * With an id it also releases {@link beginGesture}'s persistence hold; bare,
 * it is exactly what it always was.
 */
export function endGesture(gestureId?: string): void {
  useAppStore.getState().endGesture(gestureId);
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

/**
 * Order matters, and it is the engine FIRST.
 *
 * `setPlaybackMode` writes the project, and the store subscription in
 * {@link startEngineSync} pushes that project into the engine *synchronously*
 * — so writing the store first left `engine.setMode` looking at a project
 * whose `playbackMode` was already the requested one. Its "nothing changed"
 * guard then early-returned, and a mode flip made mid-playback never released
 * the sounding voices or restarted the transport at zero: the old pattern's
 * notes rang on over the new source. Calling the engine first lets it see the
 * real transition; the store write that follows syncs an already-matching
 * mode and re-arms nothing.
 */
export function setMode(mode: PlaybackMode): void {
  if (audioSupported()) engine.setMode(mode);
  useAppStore.getState().setPlaybackMode(mode);
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

/**
 * Creating a pattern IS an edit, so it goes on the undo stack (SPEC §2.1).
 *
 * Reachable from the keyboard (`F4`'s "next empty pattern" mints one when
 * there is none), so it takes the shared one-shot gesture key rather than
 * dispatching bare: whatever drag was open is sealed and released first, and
 * this edit is its own undo entry instead of landing inside somebody else's
 * (`@/lib/gestureHold`, and see `channel-rack/bindings.ts` for the same rule).
 */
export function addPattern(): void {
  const gestureId = oneShotGestureKey("add-pattern");
  const { project, dispatch } = useAppStore.getState();
  const index = project.patternOrder.length;
  dispatch(
    addPatternCommand({
      id: nextId("pattern"),
      name: `Pattern ${index + 1}`,
      color: colorAt(index + 6),
      notes: {},
    }),
    { gestureId },
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

/**
 * The play-intent epoch.
 *
 * `ensureStarted()` is a network-bound dynamic `import("tone")` plus an
 * `AudioContext.resume()`, so there is a real window — hundreds of
 * milliseconds on a cold load — between pressing Play and the engine
 * existing. Stop pressed inside that window used to be *overtaken* by its own
 * Play: `stopPlayback()` ran against an engine with nothing to stop, the
 * awaited boot then resolved, and the next line called `engine.play()`
 * unconditionally. The transport started, and the UI said Stopped.
 *
 * Every intent-changing call bumps this counter; the post-boot continuation
 * refuses to act unless the epoch it captured is still the current one.
 */
let playIntent = 0;

export async function startPlayback(): Promise<void> {
  const intent = (playIntent += 1);
  // Only the flag this function set is remembered. Capturing the whole
  // snapshot and restoring it wholesale also reverted anything else the user
  // changed inside the boot window — toggling the metronome while Tone was
  // still loading, then a failed boot, silently un-toggled it.
  const isPlayingBefore = transportUi.isPlaying;
  setTransportUi({ ...transportUi, isPlaying: true });
  // No AudioContext (jsdom, SSR): the flag still mirrors the user's intent —
  // documented at the top of this file — and there is nothing to boot.
  if (!audioSupported()) return;
  try {
    await engine.ensureStarted();
    // Stop (or a second Play) landed while Tone was loading — the newer
    // intent wins, and it has already written the UI state it wants.
    if (intent !== playIntent) return;
    engine.play();
  } catch (error) {
    if (intent !== playIntent) return;
    // Roll the optimistic flag back — against the CURRENT state, so a
    // metronome toggle made during the boot survives. The rejection is
    // consumed here rather than escaping as an unhandled promise rejection.
    setTransportUi({ ...transportUi, isPlaying: isPlayingBefore });
    setNotice(
      `Audio could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function stopPlayback(): void {
  playIntent += 1;
  setTransportUi({ ...transportUi, isPlaying: false });
  if (audioSupported()) engine.stop();
}

/**
 * `Ctrl+H` — panic (SPEC §4.4).
 *
 * FL's panic kills every hanging voice. The engine's frozen surface (§8) has
 * no voice-kill of its own, and `src/audio` belongs to another slice, so this
 * is `stop()`: the transport halts and the scheduler stops issuing new events.
 * A preview note already in flight rings out its own envelope (≤ 0.35 s,
 * `PREVIEW_DURATION_SEC`) rather than being cut. Documented rather than
 * hidden — if the engine ever grows a true `panic()`, this is its one caller.
 */
export function panic(): void {
  stopPlayback();
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
 *
 * Void-returning, because a click on a piano key is not something to await.
 * The boot failure it can hide is therefore routed here, into the same notice
 * `startPlayback` uses: a preview is very often the *first* gesture of a
 * session, so it is as likely as Play to be the thing that discovers the
 * browser will not give this page an audio context.
 */
export function previewNote(channelId: string, pitch: number, durationSec?: number): void {
  if (!audioSupported()) return;
  void engine.previewNote(channelId, pitch, durationSec).catch((error: unknown) => {
    setNotice(
      `Audio could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
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

/**
 * Explicit save — the same localStorage envelope autosave writes (SPEC §2.2).
 *
 * Unlike the autosave, this one *reports*: a user who clicks Save and is told
 * nothing has every reason to believe the project is on disk, and under a full
 * quota or Safari private mode it is not.
 */
export function saveProject(): boolean {
  const saved = persistProject(useAppStore.getState().project);
  setNotice(saved ? null : "Could not save — browser storage is full or unavailable.");
  return saved;
}

/**
 * "New" and "Load saved" (SPEC §2.2). Both discard whatever is in the editor,
 * which is why the toolbar arms them with a second click rather than a
 * `window.confirm` — a native modal blocks the Playwright suite's main thread
 * and has to be handled out of band, and this app has no dialog layer.
 */
export function newProject(): void {
  useAppStore.getState().newProject();
  setNotice(null);
}

/** Adopt the last saved project, or say so when there is nothing saved. */
export function loadSavedProject(): boolean {
  const stored = loadPersistedProject();
  if (stored === null) {
    setNotice("Nothing saved to load yet.");
    return false;
  }
  useAppStore.getState().loadProject(stored);
  setNotice(null);
  return true;
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
 *
 * Going around `loadProject` costs the two things `loadProject` does besides
 * setting the project, and both have to be done here instead:
 *
 * 1. **`reseedIds`.** The id counter is a module-level monotonic integer
 *    (`domain/ids.ts`), and an imported file is full of ids minted by *another*
 *    session. Without the reseed the next `nextId("note")` hands back an id the
 *    imported project already uses, and the new note overwrites an old one.
 * 2. **UI reconciliation.** The playlist's armed paint pattern, the roll's
 *    channel and note selection, the mixer's selected strip all name entities
 *    of the project being thrown away; the next interaction with any of them
 *    reads `undefined` and throws. `reconcileUiToProject` re-points or
 *    re-defaults exactly the fields that no longer resolve.
 */
export async function importJson(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    setNotice("Could not read that file.");
    return;
  }
  const imported = deserializeProject(text);
  if (imported === null) {
    setNotice("That file is not an FL Studio project export.");
    return;
  }
  reseedIds(imported);
  const store = useAppStore.getState();
  // Through the registry, like every other one-shot mutation: an import is
  // the most violent write in the app, and a gesture still open across it
  // would hold a snapshot of entities that no longer exist. The session's own
  // revision watcher would cancel it a moment later, but only AFTER the write
  // — sealing first is the same order every other mutation uses.
  store.dispatch(replaceProject(imported), { gestureId: oneShotGestureKey("import") });
  store.reconcileUiToProject();
  setNotice(null);
}

/* --------------------------------------------------------- pattern actions */

/**
 * `F4` — jump to the next empty pattern, creating one if every pattern has
 * notes (SPEC §4.4). FL's own F4 is "next empty pattern slot", so an existing
 * empty one is reused rather than piling up duplicates.
 */
export function nextEmptyPattern(): void {
  const { project } = useAppStore.getState();
  const isEmpty = (id: string): boolean => {
    const pattern = project.patterns[id];
    return pattern !== undefined && Object.keys(pattern.notes).length === 0;
  };
  // Search forward from the current pattern and wrap, so repeated F4 walks
  // the empty slots rather than parking on the first one.
  const order = project.patternOrder;
  const from = Math.max(0, order.indexOf(project.activePatternId));
  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(from + step) % order.length];
    if (id !== undefined && id !== project.activePatternId && isEmpty(id)) {
      setActivePatternId(id);
      return;
    }
  }
  // Nowhere else to go: stay if we are already on an empty pattern, otherwise
  // mint one (which selects it).
  if (!isEmpty(project.activePatternId)) addPattern();
}

/** Rename the current pattern — the commit half of `F2`. Undoable (SPEC §2.1). */
export function renameActivePattern(name: string): void {
  const { project, dispatch } = useAppStore.getState();
  const pattern = project.patterns[project.activePatternId];
  const trimmed = name.trim();
  if (pattern === undefined || trimmed === "" || trimmed === pattern.name) return;
  /*
   * A BLUR COMMIT, so it takes the non-pre-empting key rather than the
   * ordinary one-shot (`@/lib/gestureHold`'s `commitGestureKey`). The rename
   * field commits when focus leaves it, and `blur` arrives after the
   * `pointerdown` that took the focus — pre-empting there ended the gesture
   * that press had just opened, so clicking a knob (or starting a clip drag)
   * to leave the rename box left a control that would not move.
   *
   * It still takes an id rather than dispatching bare: the rename needs an
   * undo entry of its own instead of folding into whatever the fresh gesture
   * is about to build. The unchanged case returns above and dispatches
   * nothing at all.
   */
  dispatch(updatePattern(pattern.id, { name: trimmed }), {
    gestureId: commitGestureKey("pattern-rename"),
  });
}

/**
 * `F2` — "rename current pattern" (SPEC §4.4). The keystroke is global but the
 * *field* belongs to the toolbar's pattern selector, and the shell cannot
 * reach into it, so the two meet on this one-shot channel: `AppShell` requests,
 * `TransportBar` subscribes and puts its name label into edit mode.
 *
 * An event rather than store state — "the user asked to rename, once" is not
 * a value anything should be able to re-read a frame later.
 */
const renameListeners = new Set<() => void>();

export function requestPatternRename(): void {
  for (const listener of renameListeners) listener();
}

export function subscribePatternRename(listener: () => void): () => void {
  renameListeners.add(listener);
  return () => {
    renameListeners.delete(listener);
  };
}

/**
 * WAV export (SPEC §3.5, D2). Every way this can fail ends in the notice
 * channel rather than in an unhandled rejection.
 *
 * There are two, and neither is exotic: an environment with no
 * `OfflineAudioContext` (the exporter's factory throws by name — see
 * `audio/exportWav.ts`), and a render that rejects — `startRendering()`
 * refusing a zero-length or over-long buffer, or the encoder running out of
 * memory. Both used to escape as a rejected promise off a click handler, so
 * the button did nothing, said nothing, and left a console trace nobody sees.
 */
export async function exportWav(): Promise<void> {
  if (!audioSupported()) {
    setNotice("WAV export is not supported in this browser.");
    return;
  }
  try {
    const rendered = await engine.exportWav();
    downloadBlob(rendered.blob, rendered.fileName);
    // Success clears, exactly as Save/Load/Import do. A stale "WAV export
    // failed" left standing beside a file that just downloaded is a worse
    // report than no report: the notice is a status line, not a log.
    setNotice(null);
  } catch (error) {
    setNotice(
      `WAV export failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/* ------------------------------------------------------- runtime wiring -- */

/**
 * Push the project into the engine and keep pushing it (SPEC §3.2/§5's store
 * seam). `syncProject` is cheap and idempotent, and the engine decides on its
 * own whether the change warrants re-arming the transport.
 *
 * The one decision the engine cannot make for itself is whether a sync was an
 * EDIT or a REPLACEMENT (File → New, a load, an import, the undo/redo of one)
 * — `src/audio` may not import the store, and the projects are
 * indistinguishable by value: the ids are minted from a shared counter, and a
 * re-import keeps the exported project's own id. So the store's wholesale
 * counter is carried across the seam here (`store.projectEpoch`), and the
 * engine gives a replacement the full release/re-arm/restart it gives a mode
 * flip. Without it a replacement that kept the same mode only re-armed: the
 * transport ran on at the old project's tick and the old project's voices rang
 * into the new one through the channel ids it re-uses.
 */
export function startEngineSync(): () => void {
  const initial = useAppStore.getState();
  // The engine has no project at all yet, so the first push is never a
  // replacement — there is nothing to release and nothing playing to restart.
  let lastEpoch = initial.projectEpoch;
  engine.syncProject(initial.project);
  return useAppStore.subscribe((state, previous) => {
    if (state.project === previous.project) return;
    const wholesale = state.projectEpoch !== lastEpoch;
    lastEpoch = state.projectEpoch;
    engine.syncProject(state.project, { wholesale });
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
  /**
   * Peak sample magnitude, 0..1, off a mixer track's `AnalyserNode` tap —
   * the same read `mixer/useMeter.ts` does per frame, and the only way a
   * headless test can assert that a step actually made a *sound* rather than
   * that a store field changed. `-1` when the engine has not booted (SPEC
   * §3.1's gesture-gated boot), which is distinguishable from real silence.
   */
  meterLevel: (trackId?: string) => number;
  /** Whether the engine is booted at all, so a test can wait for it. */
  audioStarted: () => boolean;
}

function peakOf(analyser: AnalyserNode): number {
  const buffer = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const abs = Math.abs(buffer[i] ?? 0);
    if (abs > peak) peak = abs;
  }
  return Math.min(1, peak);
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
    meterLevel: (trackId) => {
      const tap = trackId === undefined ? engine.getMeterTap() : engine.getMeterTap(trackId);
      return tap === null ? -1 : peakOf(tap);
    },
    audioStarted: () => engine.isStarted(),
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
  playIntent += 1;
  setNotice(null);
  useAppStore.getState().newProject();
  // Autosave runs while a shell is mounted, so a previous test's edit would
  // otherwise be hydrated back in by the next mount.
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No storage (SSR, private mode) — nothing to clear.
  }
}
