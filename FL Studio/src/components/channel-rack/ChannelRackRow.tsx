"use client";

import { useRef, useState } from "react";

import type { Command } from "@/domain/commands/types";
import { addNotes, composite, isStepOn, notesAtStep, removeNotes, stepNote } from "@/domain/commands";
import { nextId } from "@/domain/ids";
import type { Channel, MixerTrack, Pattern } from "@/domain/types";
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
}

interface PaintSession {
  mode: "on" | "off";
  commands: Command[];
  /** Per-step override already decided during this stroke — what makes re-entry idempotent. */
  touched: Map<number, boolean>;
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
 * (`onCommitSteps`) rather than dispatching per cell — `domain/undo.ts`'s
 * gesture-coalescing (`coalesceKey`) only re-derives a correct combined
 * inverse for commands that *overwrite the same field* (a knob drag); it is
 * not safe for a sequence of commands that each touch a *different* note,
 * so a multi-cell paint stroke has to arrive as a single pre-built
 * `composite(...)` instead of relying on that coalescing path.
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
}: ChannelRackRowProps) {
  const painting = useRef<PaintSession | null>(null);
  const [preview, setPreview] = useState<Map<number, boolean> | null>(null);

  function stepIsOn(step: number): boolean {
    const override = preview?.get(step);
    return override ?? isStepOn(pattern, channel.id, step);
  }

  function paintStep(step: number): void {
    const session = painting.current;
    if (!session) return;
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
    if (painting.current && painting.current.mode === mode) return;
    painting.current = { mode, commands: [], touched: new Map() };
  }

  function beginLeftPaint(step: number): void {
    ensurePaintSession(isStepOn(pattern, channel.id, step) ? "off" : "on");
    paintStep(step);
  }

  function beginRightPaint(step: number): void {
    ensurePaintSession("off");
    paintStep(step);
  }

  function endPaint(): void {
    const session = painting.current;
    painting.current = null;
    setPreview(null);
    if (!session || session.commands.length === 0) return;
    onCommitSteps(session.commands.length === 1 ? session.commands[0]! : composite(session.commands));
  }

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
        aria-pressed={!channel.muted}
        aria-label={`Mute ${channel.name}`}
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

      <button
        type="button"
        className="fl-rack-row__name"
        data-testid={`channel-name-${channel.id}`}
        style={{ backgroundColor: channel.color }}
        onClick={() => {
          onSelect();
          onOpenPianoRoll();
        }}
      >
        {channel.name}
      </button>

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
