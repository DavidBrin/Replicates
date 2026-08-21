"use client";

import "./transport.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { BpmLcd } from "./BpmLcd";
import { PatternSelector } from "./PatternSelector";
import {
  addPattern,
  endGesture,
  exportJson,
  exportWav,
  importJson,
  loadSavedProject,
  newProject,
  nextGestureId,
  redo,
  renameActivePattern,
  saveProject,
  selectAdjacentPattern,
  setGlobalSwing,
  setTempo,
  subscribePatternRename,
  toggleMetronome,
  togglePlaybackMode,
  togglePlayStop,
  undo,
  useNotice,
  useWiringState,
} from "@/components/shell/wiring";

/**
 * How long a destructive button stays armed before it forgets (SPEC §2.2's
 * New / Load, which both discard unsaved work).
 *
 * Two clicks, not a `window.confirm`: a native modal blocks the whole main
 * thread, has to be dismissed out of band by the Playwright suite, and this
 * app deliberately has no dialog layer. Arming in place is FL-minimal and
 * stays inside the toolbar.
 */
export const ARM_TIMEOUT_MS = 3_000;

type ArmedAction = "new" | "load" | null;

export interface TransportBarProps {
  onPlayStop?: () => void;
  onModeToggle?: () => void;
  onMetronomeToggle?: () => void;
  onTempoChange?: (bpm: number) => void;
  onSwingChange?: (value: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSave?: () => void;
  onExportWav?: () => void;
  onExportJson?: () => void;
  onImportJson?: (file: File) => void;
  onNewProject?: () => void;
  onLoadProject?: () => void;
}

/**
 * Toolbar / transport bar — SPEC §1.1 "Transport / toolbar" row and §4.1's
 * diagram top strip. The defaults now go straight to the real store and
 * engine through `src/components/shell/wiring.ts`; the callback props remain
 * as overrides, which is what lets this component be driven in a test without
 * either of them.
 */
export function TransportBar({
  onPlayStop,
  onModeToggle,
  onMetronomeToggle,
  onTempoChange,
  onSwingChange,
  onUndo,
  onRedo,
  onSave,
  onExportWav,
  onExportJson,
  onImportJson,
  onNewProject,
  onLoadProject,
}: TransportBarProps) {
  const state = useWiringState();
  const notice = useNotice();

  /* ------------------------------------------------- destructive actions -- */

  const [armed, setArmed] = useState<ArmedAction>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(null);
  }, []);

  useEffect(() => disarm, [disarm]);

  function arm(action: Exclude<ArmedAction, null>, run: () => void): void {
    if (armed === action) {
      disarm();
      run();
      return;
    }
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    setArmed(action);
    armTimer.current = setTimeout(() => {
      armTimer.current = null;
      setArmed(null);
    }, ARM_TIMEOUT_MS);
  }

  /* ------------------------------------------------------ F2: rename ----- */

  const [renaming, setRenaming] = useState(false);
  useEffect(() => subscribePatternRename(() => setRenaming(true)), []);

  function handlePlayStop() {
    if (onPlayStop) {
      onPlayStop();
    } else {
      void togglePlayStop();
    }
  }

  function handleModeToggle() {
    if (onModeToggle) onModeToggle();
    else togglePlaybackMode();
  }

  function handleMetronomeToggle() {
    if (onMetronomeToggle) onMetronomeToggle();
    else toggleMetronome();
  }

  /*
   * One gesture id per drag / per committed edit (`domain/undo.ts`'s canonical
   * pattern). The BPM LCD and the swing slider both report continuously, so a
   * fixed `coalesceKey` alone would fold every tempo change the session ever
   * made into a single undo entry. The id is minted on pointer-down / focus
   * and dropped on pointer-up / blur, where `endGesture()` also seals the
   * entry so a keyboard nudge that follows cannot rejoin it.
   */
  const tempoGesture = useRef<string | null>(null);
  const swingGesture = useRef<string | null>(null);

  function beginTempoGesture(): void {
    tempoGesture.current ??= nextGestureId("tempo");
  }

  function endTempoGesture(): void {
    if (tempoGesture.current === null) return;
    tempoGesture.current = null;
    endGesture();
  }

  function beginSwingGesture(): void {
    swingGesture.current ??= nextGestureId("swing");
  }

  function endSwingGesture(): void {
    if (swingGesture.current === null) return;
    swingGesture.current = null;
    endGesture();
  }

  function handleTempoChange(bpm: number) {
    if (onTempoChange) {
      onTempoChange(bpm);
      return;
    }
    // A change with no gesture open (the ▲/▼ spinner, a typed commit) is its
    // own one-shot gesture — exactly one undo entry per click.
    setTempo(bpm, tempoGesture.current ?? nextGestureId("tempo"));
  }

  function handleSwingChange(value: number) {
    if (onSwingChange) {
      onSwingChange(value);
      return;
    }
    setGlobalSwing(value, swingGesture.current ?? nextGestureId("swing"));
  }

  function handleUndo() {
    if (onUndo) onUndo();
    else undo();
  }

  function handleRedo() {
    if (onRedo) onRedo();
    else redo();
  }

  function handleSave() {
    if (onSave) onSave();
    else saveProject();
  }

  function handleNew() {
    arm("new", () => {
      if (onNewProject) onNewProject();
      else newProject();
    });
  }

  function handleLoad() {
    arm("load", () => {
      if (onLoadProject) onLoadProject();
      else loadSavedProject();
    });
  }

  function handleExportWav() {
    if (onExportWav) onExportWav();
    else void exportWav();
  }

  function handleExportJson() {
    if (onExportJson) onExportJson();
    else exportJson();
  }

  function handleImportChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (onImportJson) onImportJson(file);
    else importJson(file);
    event.target.value = "";
  }

  return (
    <div className="fl-toolbar" role="toolbar" aria-label="Transport">
      <div className="fl-toolbar__group">
        <div className="fl-transport-pill">
          <button
            type="button"
            aria-label={state.isPlaying ? "Stop" : "Play"}
            data-active={state.isPlaying}
            onClick={handlePlayStop}
          >
            {state.isPlaying ? "■" : "▶"}
          </button>
        </div>
        <button
          type="button"
          className="fl-mode-switch"
          data-mode={state.playbackMode}
          aria-label="Toggle pattern / song mode"
          onClick={handleModeToggle}
        >
          {state.playbackMode === "song" ? "SONG" : "PAT"}
        </button>
        {/* FL parks the metronome in the toolbar's recording panel beside the
            transport controls (lane 1 §1.2 item 11); at this scope the
            transport group is the same place, and it mirrors `Ctrl+M`
            (lane 1 §9). */}
        <button
          type="button"
          className="fl-icon-button"
          data-testid="metronome-toggle"
          aria-label="Metronome"
          aria-pressed={state.metronomeEnabled}
          data-active={state.metronomeEnabled}
          onClick={handleMetronomeToggle}
        >
          ♩
        </button>
      </div>

      <div className="fl-toolbar__divider" />

      <div className="fl-toolbar__group">
        <div
          onPointerDownCapture={beginTempoGesture}
          onPointerUpCapture={endTempoGesture}
          onPointerCancelCapture={endTempoGesture}
        >
          <BpmLcd value={state.tempo} onChange={handleTempoChange} />
        </div>
        <label className="fl-swing">
          Swing
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.globalSwing}
            aria-label="Global swing"
            onPointerDown={beginSwingGesture}
            onPointerUp={endSwingGesture}
            onFocus={beginSwingGesture}
            onBlur={endSwingGesture}
            onChange={(event) =>
              handleSwingChange(Number.parseFloat(event.target.value))
            }
          />
        </label>
      </div>

      <div className="fl-toolbar__divider" />

      <div className="fl-toolbar__group">
        <PatternSelector
          activePatternId={state.activePatternId}
          patternOrder={state.patternOrder}
          patterns={state.patterns}
          onSelectPrev={() => selectAdjacentPattern(-1)}
          onSelectNext={() => selectAdjacentPattern(1)}
          onAdd={addPattern}
          renaming={renaming}
          onRename={renameActivePattern}
          onRenameEnd={() => setRenaming(false)}
        />
      </div>

      <div className="fl-toolbar__divider" />

      <div className="fl-toolbar__group">
        {/* The command stack reports real depth now (SPEC §2.1), so the
            buttons grey out exactly when there is nothing to take back. */}
        <button
          type="button"
          className="fl-icon-button"
          aria-label="Undo"
          disabled={!state.canUndo}
          onClick={handleUndo}
        >
          ↺
        </button>
        <button
          type="button"
          className="fl-icon-button"
          aria-label="Redo"
          disabled={!state.canRedo}
          onClick={handleRedo}
        >
          ↻
        </button>
      </div>

      <div className="fl-toolbar__divider" />

      <div className="fl-toolbar__group" style={{ marginLeft: "auto" }}>
        {/* New / Load discard unsaved work, so both arm before they fire —
            the button becomes "Sure?" for one click. */}
        <button
          type="button"
          className="fl-text-button"
          data-testid="new-project"
          data-armed={armed === "new"}
          aria-label={armed === "new" ? "Confirm new project" : "New project"}
          onClick={handleNew}
          onBlur={() => {
            if (armed === "new") disarm();
          }}
        >
          {armed === "new" ? "Sure?" : "New"}
        </button>
        <button
          type="button"
          className="fl-text-button"
          data-testid="load-project"
          data-armed={armed === "load"}
          aria-label={armed === "load" ? "Confirm load saved project" : "Load saved project"}
          onClick={handleLoad}
          onBlur={() => {
            if (armed === "load") disarm();
          }}
        >
          {armed === "load" ? "Sure?" : "Load"}
        </button>
        <button type="button" className="fl-text-button" onClick={handleSave}>
          Save
        </button>
        <button
          type="button"
          className="fl-text-button"
          onClick={handleExportWav}
        >
          Export WAV
        </button>
        <button
          type="button"
          className="fl-text-button"
          onClick={handleExportJson}
        >
          Export JSON
        </button>
        <label className="fl-text-button" style={{ cursor: "pointer" }}>
          Import JSON
          <input
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={handleImportChange}
          />
        </label>
      </div>

      {/*
        The status line (SPEC §4.1's toolbar). `role="status"` is an ARIA live
        region, so a failed Save or a refused AudioContext is announced without
        stealing focus and without a modal. Always rendered, so the region
        exists before it has anything to say — a live region inserted at the
        same moment as its text is not reliably announced.
      */}
      <div
        role="status"
        aria-live="polite"
        className="fl-toolbar__notice"
        data-testid="toolbar-notice"
        data-visible={notice !== null}
      >
        {notice ?? ""}
      </div>
    </div>
  );
}
