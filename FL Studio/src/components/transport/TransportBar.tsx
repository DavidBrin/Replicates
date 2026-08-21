"use client";

import "./transport.css";

import { BpmLcd } from "./BpmLcd";
import { PatternSelector } from "./PatternSelector";
import {
  addPattern,
  exportJson,
  exportWav,
  importJson,
  redo,
  saveProject,
  selectAdjacentPattern,
  setGlobalSwing,
  setTempo,
  toggleMetronome,
  togglePlaybackMode,
  togglePlayStop,
  undo,
  useWiringState,
} from "@/components/shell/wiring";

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
}: TransportBarProps) {
  const state = useWiringState();

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

  function handleTempoChange(bpm: number) {
    if (onTempoChange) onTempoChange(bpm);
    else setTempo(bpm);
  }

  function handleSwingChange(value: number) {
    if (onSwingChange) onSwingChange(value);
    else setGlobalSwing(value);
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
        <BpmLcd value={state.tempo} onChange={handleTempoChange} />
        <label className="fl-swing">
          Swing
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.globalSwing}
            aria-label="Global swing"
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
    </div>
  );
}
