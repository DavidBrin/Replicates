"use client";

import { useEffect, useRef, useState } from "react";

import type { Command } from "@/domain/commands/types";
import { addNotes, composite, isStepOn, notesAtStep, removeNotes, stepNote } from "@/domain/commands";
import { nextId } from "@/domain/ids";
import { useGestureHold } from "@/lib/gestureHold";
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
  /**
   * `store.projectRevision` — bumped by every write a buffered stroke cannot
   * survive: undo, redo, and a WHOLESALE project replacement (a load, "new
   * project", an import). A stroke buffers its commands locally, so such a
   * write can delete — or replace outright — the very notes those buffered
   * commands name; the stroke carries the revision it was opened at and is
   * dropped the moment they differ. See {@link PaintSession}.
   */
  projectRevision?: number;
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
  /**
   * The `projectRevision` this stroke was opened at.
   *
   * The `patternId` guard above catches only the case where the pattern itself
   * went away. It does NOT catch the commoner one: `Ctrl+Z` mid-stroke undoing
   * an earlier *note* edit inside the SAME pattern. A right-drag erase buffers
   * `removeNotes(patternId, [noteId])`; the undo deletes that note; the id
   * still names the live pattern, so the stroke survived the check and
   * pointer-up dispatched a removal of a note that is gone — `requireNote`
   * threw `CommandError` straight out of the pointer handler. (The mirror
   * hazard exists for redo.)
   *
   * The same hazard arrives by a second road, and the `patternId` guard is
   * even less help there: loading a saved project or importing a file
   * mid-stroke swaps every entity at once, and because ids come from one
   * shared counter (`domain/ids.ts`) the incoming project usually carries the
   * SAME `pat-N`. The guard passed, and pointer-up wrote the stroke into a
   * stranger's pattern. `projectRevision` bumps on that write too, which is
   * why this field watches a revision rather than a history counter.
   *
   * Cancelling on ANY such write is the fix rather than filtering the buffer at
   * commit time, because filtering leaves the stroke's optimistic `preview`
   * asserting cells the project no longer agrees with — and because it is the
   * same rule the rest of the app already follows: the store's `resetGestures`
   * cancels the piano roll's drag on every undo and redo for exactly this
   * reason. The rack's stroke lives in a ref, where `resetGestures` cannot
   * reach it, so it watches the revision counter instead.
   */
  projectRevision: number;
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
  projectRevision = 0,
}: ChannelRackRowProps) {
  const painting = useRef<PaintSession | null>(null);
  /**
   * SPEC §2.2: a stroke holds off persistence until it commits.
   *
   * `onCancel` drops the buffered stroke whenever the session ends from the
   * outside — unmount, the revision watcher, another gesture pre-empting this
   * one. The stroke is ABANDONED rather than committed, which is this row's
   * standing rule for a stroke it cannot trust (see `endPaint`'s staleness
   * check): a buffer built against a project that has been replaced would
   * dispatch note ids that no longer exist. `cancelPaint` calls `release()`
   * in turn, and that re-entry is a no-op — the session clears its id before
   * calling back (`@/lib/gestureHold`).
   */
  const gesture = useGestureHold("rack-paint", {
    onCancel: () => {
      if (painting.current !== null) cancelPaint();
    },
  });
  const [preview, setPreview] = useState<Map<number, boolean> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(channel.name);
  /**
   * A stroke must still end even if the pointer is released outside this row
   * (dragged off the grid entirely before releasing) — `onPointerUp` on the
   * row only fires for a release *inside* its bounds, so window-level
   * listeners backstop it while a session is open.
   *
   * BOTH terminators, not just `pointerup`: a cancelled pointer (capture
   * lost, a system gesture, the tab hidden) never delivers a `pointerup` at
   * all, and the stroke it left behind kept its persistence hold — autosave
   * silent for the rest of the session — while its optimistic `preview` went
   * on painting cells under every later hover.
   */
  const windowListeners = useRef<(() => void) | null>(null);

  function detachWindowListeners(): void {
    if (windowListeners.current === null) return;
    windowListeners.current();
    windowListeners.current = null;
  }

  useEffect(() => detachWindowListeners, []);

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
    if (session.projectRevision !== projectRevision) return;
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
      painting.current.patternId === pattern.id &&
      painting.current.projectRevision === projectRevision
    ) {
      return;
    }
    painting.current = {
      mode,
      commands: [],
      touched: new Map(),
      patternId: pattern.id,
      projectRevision,
    };
    gesture.hold();
    if (windowListeners.current === null) {
      const onUp = (): void => endPaint();
      const onCancel = (): void => cancelPaint();
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      windowListeners.current = () => {
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      };
    }
  }

  function beginLeftPaint(step: number): void {
    ensurePaintSession(isStepOn(pattern, channel.id, step) ? "off" : "on");
    paintStep(step);
  }

  /**
   * Right-click erase. `pointerHeld` is false for a KEYBOARD context-menu
   * request (the ContextMenu key or Shift+F10 on a focused cell), and that
   * case must commit on the spot.
   *
   * It used to open a sweep session like any other: a hold was taken, a
   * `removeNotes` was buffered, the optimistic preview showed the cell dark —
   * and nothing ever committed it, because the commit hangs off a pointer-up
   * that a keyboard press never produces. The note stayed in the project, the
   * grid disagreed with it until the next re-render, and autosave stayed held
   * off for the rest of the session. A one-shot has no gesture to wait for.
   */
  function beginRightPaint(step: number, pointerHeld: boolean): void {
    ensurePaintSession("off");
    paintStep(step);
    if (!pointerHeld) endPaint();
  }

  /** Tear the stroke down without committing anything. */
  function cancelPaint(): void {
    painting.current = null;
    gesture.release();
    setPreview(null);
    detachWindowListeners();
  }

  function endPaint(): void {
    const session = painting.current;
    const stale =
      session !== null &&
      (session.patternId !== pattern.id || session.projectRevision !== projectRevision);
    cancelPaint();
    if (!session || session.commands.length === 0) return;
    // The buffer names a pattern that is no longer the one this row edits, or
    // was built against a project an undo/redo has since replaced. Dispatching
    // it would throw out of the pointer handler; the stroke is abandoned.
    if (stale) return;
    onCommitSteps(session.commands.length === 1 ? session.commands[0]! : composite(session.commands));
  }

  // Belt and braces for the same hazard: the moment the row is handed a
  // different pattern, any stroke in flight is dropped rather than left to be
  // discovered at pointer-up (the preview would otherwise keep painting cells
  // of the old pattern over the new one's grid).
  useEffect(() => {
    if (painting.current === null) return;
    if (
      painting.current.patternId !== pattern.id ||
      painting.current.projectRevision !== projectRevision
    ) {
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
              // Left paints, right erases (via `onContextMenu`), and MIDDLE —
              // the pan/autoscroll button everywhere else in this app — does
              // nothing to the pattern. It used to fall through to
              // `beginLeftPaint`, so a middle press opened a stroke and
              // toggled the cell on release.
              if (button !== 0) return;
              beginLeftPaint(step);
            }}
            // `buttons` distinguishes a right-BUTTON press (bit 2 set — a
            // sweep, closed by the pointer-up that follows) from the
            // keyboard's ContextMenu / Shift+F10 (empty mask, no pointer-up
            // ever). See `beginRightPaint`.
            onContextMenu={(buttons) => beginRightPaint(step, (buttons & 2) !== 0)}
            onAltWheel={onVelocityNudge ? (direction) => onVelocityNudge(step, direction) : undefined}
            onPointerEnter={(buttons) => {
              if (buttons & 2) {
                beginRightPaint(step, true);
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
