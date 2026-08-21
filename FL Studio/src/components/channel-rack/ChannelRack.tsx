"use client";

import "./channelRack.css";

import { useShallow } from "zustand/react/shallow";

import { notesAtStep, updateChannel, updateNotes, updateProject } from "@/domain/commands";
import type { Command } from "@/domain/commands/types";
import type { ChannelId, Pattern } from "@/domain/types";
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
      { coalesceKey: `velocity:${channelId}:${step}` },
    );
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
            onChange={(event) =>
              dispatch(updateProject({ globalSwing: Number.parseFloat(event.target.value) }), {
                coalesceKey: "rack-swing",
              })
            }
          />
        </label>
        <span className="fl-channel-rack__pattern-length" aria-label="Pattern length in steps">
          16
        </span>
      </div>

      <div className="fl-channel-rack__rows">
        {channels.map((channel) => (
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
          />
        ))}
      </div>
    </div>
  );
}
