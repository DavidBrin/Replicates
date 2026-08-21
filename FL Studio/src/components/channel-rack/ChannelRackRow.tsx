"use client";

import { useEffect, useRef, useState } from "react";

import type { Command } from "@/domain/commands/types";
import { addNotes, composite, isStepOn, notesAtStep, removeNotes, stepNote } from "@/domain/commands";
import { nextId } from "@/domain/ids";
import type { Channel, MixerTrack, Pattern, PatternId } from "@/domain/types";
import { Knob } from "./Knob";
import { StepCell } from "./StepCell";

const STEP_COUNT = 16;

export interface ChannelRackRowProps {
  channel: Channel;
  pattern: Pattern;
  isSelected: boolean;
  playheadStep: number | null;
  routedTrack: MixerTrack | undefined;
  onToggleMute: () => void;
  onSelect: () => void;
  onOpenPianoRoll: () => void;
  onKnobChange: (patch: { pan?: number } | { volume?: number }, coalesceKey: string) => void;
  onCycleRouting: (direction: 1 | -1) => void;
  /** The whole gesture — one click or a multi-cell drag — commits as one command (SPEC §2.1). */
  onCommitSteps: (command: Command) => void;
  onVelocityNudge?: (step: number, direction: 1 | -1) => void;
  /** Channel Operations menu (lane 1 §2.6: right-click name → Rename/recolor, Delete). */
  onRename: (name: string) => void;
  onDelete: () => void;
  onRecolor: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

interface PaintSession {
  mode: "on" | "off";
  commands: Command[];
  /** Per-step override already decided during this stroke — what makes re-entry idempotent. */
  touched: Map<number, boolean>;
  /**
   * The pattern the stroke's buffered commands address. A stroke outlives any
   * number of re-renders, and the pattern under it can be swapped or destroyed
   * mid-drag — `Ctrl+Z` undoing the pattern's creation while the button is
   * still down is the reachable case. Committing then dispatched `addNotes`
   * against a pattern id that no longer exists and threw `CommandError` out of
   * a pointer handler, so the stroke carries the id it was built for and is
   * discarded the moment it stops matching.
   */
  patternId: PatternId;
}

/**
 * One Channel Rack row (SPEC §1.1, lane 1 §2.1's left-to-right order): mute
 * LED, pan knob, volume knob, mixer-routing box, channel-name button + a
 * selection bar, then the 16-step grid. 45 px row pitch comes from
 * `channelRack.css`, not inline styles, so the token stays swappable.
 *
 * Paint-stroke mechanics: left-click-drag paints many cells to the same
 * on/off state, right-click(-drag) deletes; both buffer their commands
 * locally and commit exactly **one** command on pointer-up
 * (`onCommitSteps`) rather than dispatching per cell. Coalescing by
 * `coalesceKey` would now fold such a stroke correctly too — `domain/undo.ts`
 * composes inverses in reverse order — but the stroke keeps its own buffer
 * for a second reason: the row paints an optimistic `preview` of the cells
 * under the cursor, so it already holds the stroke's decisions and there is
 * nothing to gain from re-deriving them one dispatch at a time.
 */
export function ChannelRackRow({
  channel,
  pattern,
  isSelected,
  playheadStep,
  routedTrack,
  onToggleMute,
  onSelect,
  onOpenPianoRoll,
  onKnobChange,
  onCycleRouting,
  onCommitSteps,
  onVelocityNudge,
  onRename,
  onDelete,
  onRecolor,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: ChannelRackRowProps) {
  const painting = useRef<PaintSession | null>(null);
  const [preview, setPreview] = useState<Map<number, boolean> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(channel.name);
  // A stroke must still commit even if the pointer is released outside this
  // row (dragged off the grid entirely before releasing) — `onPointerUp` on
  // the row only fires for a release *inside* its bounds, so a window-level
  // listener backstops it while a session is open.
  const windowPointerUpListener = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (windowPointerUpListener.current) {
        window.removeEventListener("pointerup", windowPointerUpListener.current);
      }
    };
  }, []);

  function stepIsOn(step: number): boolean {
    const override = preview?.get(step);
    return override ?? isStepOn(pattern, channel.id, step);
  }

  function paintStep(step: number): void {
    const session = painting.current;
    if (!session) return;
    // Nothing may be added to a stroke that no longer belongs to the pattern
    // on screen; `cancelPaint` will drop it, and until then it must not grow.
    if (session.patternId !== pattern.id) return;
    const currentlyOn = session.touched.get(step) ?? isStepOn(pattern, channel.id, step);
    const desiredOn = session.mode === "on";
    if (currentlyOn === desiredOn) return; // idempotent re-entry — nothing to do

    session.touched.set(step, desiredOn);
    if (desiredOn) {
      session.commands.push(
        addNotes(pattern.id, [stepNote(nextId("note"), channel.id, step, channel.defaultStepPitch)]),
      );
    } else {
      const existing = notesAtStep(pattern, channel.id, step);
      if (existing.length > 0) {
        session.commands.push(
          removeNotes(
            pattern.id,
            existing.map((note) => note.id),
          ),
        );
      }
    }
    setPreview(new Map(session.touched));
  }

  /** Starts a fresh stroke unless one is already running with this mode. */
  function ensurePaintSession(mode: "on" | "off"): void {
    if (
      painting.current &&
      painting.current.mode === mode &&
      painting.current.patternId === pattern.id
    ) {
      return;
    }
    painting.current = { mode, commands: [], touched: new Map(), patternId: pattern.id };
    if (!windowPointerUpListener.current) {
      const listener = () => endPaint();
      windowPointerUpListener.current = listener;
      window.addEventListener("pointerup", listener);
    }
  }

  function beginLeftPaint(step: number): void {
    ensurePaintSession(isStepOn(pattern, channel.id, step) ? "off" : "on");
    paintStep(step);
  }

  function beginRightPaint(step: number): void {
    ensurePaintSession("off");
    paintStep(step);
  }

  /** Tear the stroke down without committing anything. */
  function cancelPaint(): void {
    painting.current = null;
    setPreview(null);
    if (windowPointerUpListener.current) {
      window.removeEventListener("pointerup", windowPointerUpListener.current);
      windowPointerUpListener.current = null;
    }
  }

  function endPaint(): void {
    const session = painting.current;
    const stale = session !== null && session.patternId !== pattern.id;
    cancelPaint();
    if (!session || session.commands.length === 0) return;
    // The buffer names a pattern that is no longer the one this row edits —
    // it was undone, deleted or switched away from mid-stroke. Dispatching it
    // would throw out of the pointer handler; the stroke is simply abandoned.
    if (stale) return;
    onCommitSteps(session.commands.length === 1 ? session.commands[0]! : composite(session.commands));
  }

  // Belt and braces for the same hazard: the moment the row is handed a
  // different pattern, any stroke in flight is dropped rather than left to be
  // discovered at pointer-up (the preview would otherwise keep painting cells
  // of the old pattern over the new one's grid).
  useEffect(() => {
    if (painting.current !== null && painting.current.patternId !== pattern.id) {
      cancelPaint();
    }
  });

  return (
    <div
      className="fl-rack-row"
      data-testid={`channel-row-${channel.id}`}
      data-selected={isSelected}
      onPointerUp={endPaint}
      onPointerLeave={(event) => {
        // Only stop painting once the mouse button has actually been let go
        // elsewhere; a plain hover-out mid-drag should keep painting the
        // cells the pointer re-enters (mirrors FL's rack).
        if (event.buttons === 0) endPaint();
      }}
    >
      <button
        type="button"
        className="fl-rack-row__led"
        data-testid={`mute-led-${channel.id}`}
        data-muted={channel.muted}
        aria-pressed={channel.muted}
        aria-label={channel.muted ? `Unmute ${channel.name}` : `Mute ${channel.name}`}
        onClick={onToggleMute}
      />

      <Knob
        value={channel.pan}
        min={-1}
        max={1}
        defaultValue={0}
        label={`${channel.name} pan`}
        formatValue={(v) => (v === 0 ? "C" : v > 0 ? `${Math.round(v * 100)}R` : `${Math.round(-v * 100)}L`)}
        onChange={(value, coalesceKey) => onKnobChange({ pan: value }, coalesceKey)}
      />

      <Knob
        value={channel.volume}
        min={0}
        max={1}
        defaultValue={0.8}
        label={`${channel.name} volume`}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onChange={(value, coalesceKey) => onKnobChange({ volume: value }, coalesceKey)}
      />

      <button
        type="button"
        className="fl-rack-row__routing"
        data-testid={`routing-${channel.id}`}
        aria-label={`${channel.name} mixer routing: ${routedTrack?.name ?? "unassigned"}`}
        onClick={(event) => onCycleRouting(event.shiftKey ? -1 : 1)}
      >
        {routedTrack?.name === "Master" ? "M" : (routedTrack?.name.replace(/\D/g, "") ?? "---")}
      </button>

      <div className="fl-rack-row__name-wrap">
        {renaming ? (
          <input
            type="text"
            className="fl-rack-row__name-input"
            data-testid={`channel-rename-${channel.id}`}
            style={{ backgroundColor: channel.color }}
            value={renameValue}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => {
              const trimmed = renameValue.trim();
              if (trimmed.length > 0 && trimmed !== channel.name) onRename(trimmed);
              setRenaming(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              if (event.key === "Escape") {
                setRenameValue(channel.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="fl-rack-row__name"
            data-testid={`channel-name-${channel.id}`}
            style={{ backgroundColor: channel.color }}
            onClick={() => {
              onSelect();
              onOpenPianoRoll();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect();
              setMenuOpen(true);
            }}
          >
            {channel.name}
          </button>
        )}

        {menuOpen && (
          <>
            {/* Click-outside catcher — plain overlay, no modal framework (SPEC §2.6 Channel Operations menu). */}
            <div className="fl-rack-menu__scrim" onClick={() => setMenuOpen(false)} />
            <div className="fl-rack-menu" role="menu" data-testid={`channel-menu-${channel.id}`}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenameValue(channel.name);
                  setRenaming(true);
                  setMenuOpen(false);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onRecolor();
                  setMenuOpen(false);
                }}
              >
                Recolor
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canMoveUp}
                onClick={() => {
                  onMoveUp();
                  setMenuOpen(false);
                }}
              >
                Move up
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!canMoveDown}
                onClick={() => {
                  onMoveDown();
                  setMenuOpen(false);
                }}
              >
                Move down
              </button>
              <button
                type="button"
                role="menuitem"
                className="fl-rack-menu__delete"
                onClick={() => {
                  onDelete();
                  setMenuOpen(false);
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </div>

      <div
        className="fl-rack-row__selector"
        data-testid={`selector-${channel.id}`}
        data-selected={isSelected}
        onClick={onSelect}
        role="presentation"
      />

      <div className="fl-rack-row__steps">
        {Array.from({ length: STEP_COUNT }, (_, step) => step).map((step) => (
          <StepCell
            key={step}
            step={step}
            on={stepIsOn(step)}
            isPlayhead={playheadStep === step}
            onPointerDown={(button) => {
              if (button === 2) return; // right button handled by onContextMenu
              beginLeftPaint(step);
            }}
            onContextMenu={() => beginRightPaint(step)}
            onAltWheel={onVelocityNudge ? (direction) => onVelocityNudge(step, direction) : undefined}
            onPointerEnter={(buttons) => {
              if (buttons & 2) {
                beginRightPaint(step);
                return;
              }
              if ((buttons & 1) === 0) return;
              paintStep(step);
            }}
          />
        ))}
      </div>
    </div>
  );
}
