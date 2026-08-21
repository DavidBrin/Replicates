"use client";

import "./channelRack.css";

import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { addChannel, moveChannel, notesAtStep, removeChannel, updateChannel, updateNotes, updateProject } from "@/domain/commands";
import type { Command } from "@/domain/commands/types";
import { nextId } from "@/domain/ids";
import { colorAt, PALETTE } from "@/domain/palette";
import { MASTER_MIXER_TRACK_ID, type Channel, type ChannelId, type Pattern, type VoiceKind } from "@/domain/types";
import { createWheelGestureKeyring, type WheelGestureKeyring } from "@/lib/wheelGesture";
import {
  selectActivePattern,
  selectChannels,
  selectGlobalSwing,
  selectMixerTracks,
  useAppStore,
} from "@/lib/store";
import { ChannelRackRow } from "./ChannelRackRow";
import { usePlayheadStep } from "./uiState";

const VELOCITY_STEP = 1 / 32;

/** Human labels for the add-channel picker (mirrors `defaultProject`'s seed names). */
const VOICE_LABELS: Record<VoiceKind, string> = {
  kick: "Kick",
  clap: "Clap",
  hatClosed: "Closed hat",
  hatOpen: "Open hat",
  snare: "Snare",
  bass: "Bass",
  lead: "Lead",
};

const VOICE_ORDER: readonly VoiceKind[] = ["kick", "clap", "hatClosed", "hatOpen", "snare", "bass", "lead"];
const MELODIC_DEFAULT_PITCH: Partial<Record<VoiceKind, number>> = { bass: 36, lead: 72 };

export interface ChannelRackProps {
  /** Test/override seam, mirroring `TransportBar`'s callback-prop pattern. */
  onSelectChannel?: (id: ChannelId) => void;
  onOpenPianoRoll?: (id: ChannelId) => void;
}

/**
 * The Channel Rack window (SPEC §1.1, §4.1's tabbed rack/roll region). Rows,
 * per-channel controls and the 16-step grid all read/write through
 * `store.dispatch` — no domain field is ever written directly (SPEC §5).
 *
 * `ChannelRackUiSlice` is registered in the composer (SPEC §5, §8), so
 * selection and the one-shot "open the roll for this channel" request are
 * read and written straight through `useAppStore` — there is no local mirror
 * of either. The shell consumes `pianoRollRequestChannelId` and clears it.
 */
export function ChannelRack({ onSelectChannel, onOpenPianoRoll }: ChannelRackProps = {}) {
  // `selectChannels`/`selectMixerTracks` build a fresh array each call
  // (store.ts's own docstring: "must be used with useShallow, or read
  // through a stable primitive selector — they cannot be compared by
  // identity"), so they're wrapped here to avoid a `useSyncExternalStore`
  // re-render loop.
  const channels = useAppStore(useShallow(selectChannels));
  const pattern = useAppStore(selectActivePattern);
  const mixerTracks = useAppStore(useShallow(selectMixerTracks));
  const globalSwing = useAppStore(selectGlobalSwing);
  const dispatch = useAppStore((state) => state.dispatch);
  const project = useAppStore((state) => state.project);

  const selectedChannelId = useAppStore((state) => state.selectedChannelId);
  const selectChannel = useAppStore((state) => state.selectChannel);
  const requestOpenPianoRoll = useAppStore((state) => state.requestOpenPianoRoll);
  const playheadStep = usePlayheadStep();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // The Alt+wheel step-velocity keyring — one per mounted rack, built lazily
  // so a re-render does not allocate another. See `handleVelocityNudge`.
  const velocityWheelRef = useRef<WheelGestureKeyring | null>(null);
  const velocityWheel = (velocityWheelRef.current ??= createWheelGestureKeyring("rack-velocity"));

  // `coalesceKey` must be fresh per drag gesture, not a fixed string — a
  // fixed key would fold every swing drag for the whole session into one
  // undo entry (mirrors `Knob.tsx`'s per-gesture counter).
  const swingGestureCounter = useRef(0);
  const swingCoalesceKey = useRef<string | null>(null);
  function mintSwingCoalesceKey(): string {
    swingGestureCounter.current += 1;
    return `rack-swing#${swingGestureCounter.current}`;
  }

  if (!pattern) return null;
  // Nested function declarations below don't inherit the narrowing above
  // (TS doesn't carry control-flow narrowing into closures) — an explicitly
  // typed alias sidesteps that without an `!` assertion at every call site.
  const activePattern: Pattern = pattern;

  function handleSelect(channelId: ChannelId): void {
    onSelectChannel?.(channelId);
    selectChannel(channelId);
  }

  function handleOpenPianoRoll(channelId: ChannelId): void {
    onOpenPianoRoll?.(channelId);
    requestOpenPianoRoll(channelId);
  }

  function handleToggleMute(channelId: ChannelId): void {
    const channel = project.channels[channelId];
    if (!channel) return;
    dispatch(updateChannel(channelId, { muted: !channel.muted }));
  }

  function handleKnobChange(
    channelId: ChannelId,
    patch: { pan?: number } | { volume?: number },
    coalesceKey: string,
  ): void {
    dispatch(updateChannel(channelId, patch), { coalesceKey });
  }

  function handleCycleRouting(channelId: ChannelId, direction: 1 | -1): void {
    const channel = project.channels[channelId];
    if (!channel || mixerTracks.length === 0) return;
    const order = mixerTracks.map((track) => track.id);
    const currentIndex = order.indexOf(channel.routedToMixerTrackId);
    const nextIndex = (currentIndex + direction + order.length) % order.length;
    const nextTrackId = order[nextIndex];
    if (nextTrackId) dispatch(updateChannel(channelId, { routedToMixerTrackId: nextTrackId }));
  }

  /**
   * The whole paint stroke (a single click included) arrives pre-built as
   * one command — see `ChannelRackRow`'s doc comment for why that command is
   * built row-side instead of dispatched cell-by-cell with a `coalesceKey`.
   */
  function handleCommitSteps(command: Command): void {
    dispatch(command);
  }

  /**
   * Alt+wheel over a step nudges its velocity — and, like the piano roll's
   * identical gesture, it has no pointer-up to close the undo entry.
   *
   * The key used to be the fixed `velocity:<channel>:<step>`, which never
   * closes: nudging one cell, editing elsewhere for a minute, then nudging
   * the same cell again folded both sessions into a single Ctrl+Z. The
   * shared keyring bounds them the way the roll does — same cell within
   * WHEEL_GESTURE_GAP_MS is one entry, a pause or a different cell is a new
   * one (`@/lib/wheelGesture`).
   */
  function handleVelocityNudge(channelId: ChannelId, step: number, direction: 1 | -1): void {
    const existing = notesAtStep(activePattern, channelId, step);
    if (existing.length === 0) return;
    dispatch(
      updateNotes(
        activePattern.id,
        existing.map((note) => ({
          id: note.id,
          patch: { velocity: Math.min(1, Math.max(0, note.velocity + direction * VELOCITY_STEP)) },
        })),
      ),
      // A tuple, not a hand-joined string: ids may contain the separator
      // (`wheelGesture.ts`'s `encodeTarget`).
      { coalesceKey: velocityWheel.keyFor([activePattern.id, channelId, step]) },
    );
  }

  function handleAddChannel(voice: VoiceKind): void {
    const channel: Channel = {
      id: nextId("channel"),
      name: VOICE_LABELS[voice],
      color: colorAt(channels.length),
      voice,
      volume: 0.8,
      pan: 0,
      muted: false,
      defaultStepPitch: MELODIC_DEFAULT_PITCH[voice] ?? 60,
      routedToMixerTrackId: MASTER_MIXER_TRACK_ID,
    };
    dispatch(addChannel(channel));
    setAddMenuOpen(false);
  }

  function handleRenameChannel(channelId: ChannelId, name: string): void {
    dispatch(updateChannel(channelId, { name }));
  }

  function handleDeleteChannel(channelId: ChannelId): void {
    dispatch(removeChannel(channelId));
  }

  function handleRecolorChannel(channelId: ChannelId): void {
    const channel = project.channels[channelId];
    if (!channel) return;
    const currentIndex = PALETTE.indexOf(channel.color);
    const nextIndex = (currentIndex + 1 + PALETTE.length) % PALETTE.length;
    dispatch(updateChannel(channelId, { color: colorAt(nextIndex) }));
  }

  function handleMoveChannel(channelId: ChannelId, direction: 1 | -1): void {
    const currentIndex = project.channelOrder.indexOf(channelId);
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= project.channelOrder.length) return;
    dispatch(moveChannel(channelId, nextIndex));
  }

  return (
    <div className="fl-channel-rack">
      <div className="fl-channel-rack__header">
        <label className="fl-channel-rack__swing">
          Swing
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={globalSwing}
            aria-label="Rack swing"
            onPointerDown={() => {
              swingCoalesceKey.current = mintSwingCoalesceKey();
            }}
            onPointerUp={() => {
              swingCoalesceKey.current = null;
            }}
            onChange={(event) =>
              dispatch(updateProject({ globalSwing: Number.parseFloat(event.target.value) }), {
                coalesceKey: swingCoalesceKey.current ?? mintSwingCoalesceKey(),
              })
            }
          />
        </label>
        <span className="fl-channel-rack__pattern-length" aria-label="Pattern length in steps">
          16
        </span>
      </div>

      <div className="fl-channel-rack__rows">
        {channels.map((channel, index) => (
          <ChannelRackRow
            key={channel.id}
            channel={channel}
            pattern={activePattern}
            isSelected={selectedChannelId === channel.id}
            playheadStep={playheadStep}
            routedTrack={project.mixerTracks[channel.routedToMixerTrackId]}
            onToggleMute={() => handleToggleMute(channel.id)}
            onSelect={() => handleSelect(channel.id)}
            onOpenPianoRoll={() => handleOpenPianoRoll(channel.id)}
            onKnobChange={(patch, coalesceKey) => handleKnobChange(channel.id, patch, coalesceKey)}
            onCycleRouting={(direction) => handleCycleRouting(channel.id, direction)}
            onCommitSteps={handleCommitSteps}
            onVelocityNudge={(step, direction) => handleVelocityNudge(channel.id, step, direction)}
            onRename={(name) => handleRenameChannel(channel.id, name)}
            onDelete={() => handleDeleteChannel(channel.id)}
            onRecolor={() => handleRecolorChannel(channel.id)}
            onMoveUp={() => handleMoveChannel(channel.id, -1)}
            onMoveDown={() => handleMoveChannel(channel.id, 1)}
            canMoveUp={index > 0}
            canMoveDown={index < channels.length - 1}
          />
        ))}
      </div>

      <div className="fl-channel-rack__add-row">
        <button
          type="button"
          className="fl-channel-rack__add"
          data-testid="channel-add-button"
          aria-label="Add channel"
          aria-haspopup="menu"
          aria-expanded={addMenuOpen}
          onClick={() => setAddMenuOpen((open) => !open)}
        >
          +
        </button>
        {addMenuOpen && (
          <>
            <div className="fl-rack-menu__scrim" onClick={() => setAddMenuOpen(false)} />
            <div className="fl-rack-menu fl-rack-menu--add" role="menu" data-testid="channel-add-menu">
              {VOICE_ORDER.map((voice) => (
                <button type="button" role="menuitem" key={voice} onClick={() => handleAddChannel(voice)}>
                  {VOICE_LABELS[voice]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
