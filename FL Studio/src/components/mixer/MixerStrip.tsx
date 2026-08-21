"use client";

/**
 * One vertical channel strip (SPEC §1.1 Mixer, §4.3; lane 1 §5.2's top→bottom
 * order at our reduced scope: name label, pan knob, mute LED, long-throw
 * fader beside a stereo peak meter). No FX slots (cut per SPEC §1.1 OUT / D5).
 */

import { Knob } from "@/components/channel-rack/Knob";
import { MASTER_MIXER_TRACK_ID, type MixerTrack } from "@/domain/types";
import { Fader } from "./Fader";
import { MeterBars } from "./MeterBars";

export interface MixerStripProps {
  track: MixerTrack;
  isSelected: boolean;
  onSelect: () => void;
  onToggleMute: () => void;
  onVolumeChange: (value: number, coalesceKey: string) => void;
  onPanChange: (value: number, coalesceKey: string) => void;
}

const DEFAULT_MIXER_VOLUME = 0.8; // unity — matches defaultProject's mixer-track default (SPEC §2)
const DEFAULT_MIXER_PAN = 0;

export function MixerStrip({
  track,
  isSelected,
  onSelect,
  onToggleMute,
  onVolumeChange,
  onPanChange,
}: MixerStripProps) {
  const isMaster = track.id === MASTER_MIXER_TRACK_ID;

  return (
    <div
      className="fl-mixer-strip"
      data-testid={`mixer-strip-${track.id}`}
      data-selected={isSelected}
      data-master={isMaster}
      onPointerDown={onSelect}
    >
      <button
        type="button"
        className="fl-mixer-strip__name"
        data-testid={`mixer-strip-name-${track.id}`}
        onClick={onSelect}
      >
        {track.name}
      </button>

      <Knob
        value={track.pan}
        min={-1}
        max={1}
        defaultValue={DEFAULT_MIXER_PAN}
        label={`${track.name} pan`}
        formatValue={(v) => (v === 0 ? "C" : v > 0 ? `${Math.round(v * 100)}R` : `${Math.round(-v * 100)}L`)}
        onChange={onPanChange}
      />

      <button
        type="button"
        className="fl-mixer-strip__led"
        data-testid={`mixer-strip-mute-${track.id}`}
        data-muted={track.muted}
        aria-pressed={!track.muted}
        aria-label={`Mute ${track.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleMute();
        }}
      />

      <div className="fl-mixer-strip__body">
        <Fader
          value={track.volume}
          min={0}
          max={1}
          defaultValue={DEFAULT_MIXER_VOLUME}
          label={`${track.name} volume`}
          onChange={onVolumeChange}
        />
        <MeterBars trackId={track.id} showClipIndicator={isMaster} />
      </div>
    </div>
  );
}
