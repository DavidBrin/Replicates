"use client";

import "./transport.css";

import { useCallback, useEffect, useRef, useState } from "react";

import { useGestureSession } from "@/lib/gestureHold";
import { handleRangeInputKeyDown } from "@/lib/keyboard";

import { BpmLcd } from "./BpmLcd";
import { PatternSelector } from "./PatternSelector";
import {
  addPattern,
  exportJson,
  exportWav,
  importJson,
  loadSavedProject,
  newProject,
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
   * made into a single undo entry.
   *
   * Both now run through `useGestureSession` (`@/lib/gestureHold`), which is
   * the shared answer to three separate holes this pair had between them:
   * the swing slider took no persistence HOLD at all, so a slow drag let the
   * autosave debounce expire with the button down (SPEC §2.2); it wired
   * `pointerup` but not `pointercancel`, so a cancelled drag left its id live
   * and welded the next unrelated tempo/swing edit onto the dead gesture's
   * undo entry; and neither released on unmount. The hook owns all of it,
   * plus a module-scoped id counter that a remount cannot rewind.
   */
  const tempoGesture = useGestureSession("tempo");
  const swingGesture = useGestureSession("swing");

  function handleTempoChange(bpm: number) {
    if (onTempoChange) {
      onTempoChange(bpm);
      return;
    }
    // A change with no gesture open (the ▲/▼ spinner, a typed commit) is its
    // own one-shot gesture — exactly one undo entry per click, and no hold
    // left waiting for a pointer-up that is not coming.
    setTempo(bpm, tempoGesture.keyFor());
  }

  function handleSwingChange(value: number) {
    if (onSwingChange) {
      onSwingChange(value);
      return;
    }
    // `keyForEdit`, not `begin`: a DRAG's edits get the open session's id (the
    // pointer-down took the hold), and a KEYBOARD edit — arrow keys on the
    // focused slider — gets a time-bounded one-shot key that takes no hold.
    //
    // `begin()` here was the leak: an arrow press opened a hold whose only
    // terminator is `blur`, so a slider nudged once and left focused (the
    // pointer moves on, the tab is switched, the user simply stops) deferred
    // every autosave from then on. The edit run still folds into one undo
    // entry — the keyring's gap is what bounds it (`@/lib/gestureHold`).
    setGlobalSwing(value, swingGesture.keyForEdit());
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
          onPointerDownCapture={tempoGesture.begin}
          // Ownership, not "any release" (`@/lib/gestureHold` rule (g)): a
          // stray pointer lifting over the plate used to seal the tempo
          // gesture with the dragging button still down, so the rest of the
          // drag landed in a second undo entry.
          onPointerUpCapture={(event) => {
            if (tempoGesture.ownsEvent(event)) tempoGesture.end();
          }}
          onPointerCancelCapture={(event) => {
            if (tempoGesture.ownsEvent(event)) tempoGesture.end();
          }}
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
            // A range slider is NOT text entry, so the global registry now runs
            // from it (`@/lib/keyboard`) — `Ctrl+Z`/`Ctrl+S`/`Space` used to be
            // dead for as long as this slider kept focus. The arrow/Home/End
            // keys the slider itself acts on are stopped here instead, which
            // is the narrow half of that trade.
            onKeyDown={handleRangeInputKeyDown}
            onPointerDown={swingGesture.begin}
            {...swingGesture.terminators}
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
