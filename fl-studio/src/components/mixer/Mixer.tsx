"use client";

import "./mixer.css";

import { useShallow } from "zustand/react/shallow";

import { updateMixerTrack } from "@/domain/commands";
import type { MixerTrackId } from "@/domain/types";
import { oneShotGestureKey } from "@/lib/gestureHold";
import { selectMixerTracks, useAppStore } from "@/lib/store";
import { MixerStrip } from "./MixerStrip";

/**
 * The Mixer window (SPEC §1.1 Mixer, §4.1's right rail). Master (undeletable,
 * id `"master"`) plus the fixed insert strips the domain model defines — the
 * strip *set* itself is fixed (`domain/commands/mixer.ts`'s doc comment: "no
 * add/remove command"), so this component only ever renders
 * `selectMixerTracks`, never adds/removes a strip.
 *
 * `MixerUiSlice` is registered in the composer (SPEC §5, §8), so the selected
 * strip is read and written straight through `useAppStore` — there is no
 * local mirror of it, and no second store anywhere in the app.
 */
export function Mixer() {
  const tracks = useAppStore(useShallow(selectMixerTracks));
  const dispatch = useAppStore((state) => state.dispatch);

  const selectedMixerTrackId = useAppStore((state) => state.selectedMixerTrackId);
  const selectMixerTrack = useAppStore((state) => state.selectMixerTrack);

  function handleSelect(trackId: MixerTrackId): void {
    selectMixerTrack(trackId);
  }

  /**
   * A click, not a drag — so it takes a one-shot gesture key
   * (`@/lib/gestureHold`) instead of dispatching bare. A bare dispatch is
   * invisible to the registry: the mute landed while a fader or knob drag was
   * still open somewhere, and that drag stayed open across it, holding off
   * autosave and folding this edit's neighbours into its own undo entry.
   */
  function handleToggleMute(trackId: MixerTrackId, muted: boolean): void {
    dispatch(updateMixerTrack(trackId, { muted: !muted }), {
      gestureId: oneShotGestureKey("mixer-mute"),
    });
  }

  function handleVolumeChange(trackId: MixerTrackId, value: number, coalesceKey: string): void {
    dispatch(updateMixerTrack(trackId, { volume: value }), { coalesceKey });
  }

  function handlePanChange(trackId: MixerTrackId, value: number, coalesceKey: string): void {
    dispatch(updateMixerTrack(trackId, { pan: value }), { coalesceKey });
  }

  return (
    <div className="fl-mixer" data-testid="mixer">
      {tracks.map((track) => (
        <MixerStrip
          key={track.id}
          track={track}
          isSelected={selectedMixerTrackId === track.id}
          onSelect={() => handleSelect(track.id)}
          onToggleMute={() => handleToggleMute(track.id, track.muted)}
          onVolumeChange={(value, coalesceKey) => handleVolumeChange(track.id, value, coalesceKey)}
          onPanChange={(value, coalesceKey) => handlePanChange(track.id, value, coalesceKey)}
        />
      ))}
    </div>
  );
}
