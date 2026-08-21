/**
 * Stable mount contract for the four surface slices (SPEC §8: D Channel
 * Rack, E Piano Roll, F Playlist, G Mixer).
 *
 * Each slot is a plain component with a `WindowSlotProps` signature,
 * rendering placeholder content until its owning slice lands. The
 * integration pass replaces the *import* in `AppShell.tsx` with the real
 * component from that surface's own directory
 * (`@/components/channel-rack/ChannelRack`, etc.) — this file is never
 * co-edited by another slice; a surface slice adds its own component in its
 * own directory and the swap happens here, by whoever runs integration
 * (SPEC §8's sequencing note).
 */

export interface WindowSlotProps {
  className?: string;
}

export function ChannelRackSlot(_props: WindowSlotProps) {
  return (
    <div className="fl-window-placeholder" data-slot="channel-rack">
      Channel Rack — placeholder (slice D fills this window)
    </div>
  );
}

export function PianoRollSlot(_props: WindowSlotProps) {
  return (
    <div className="fl-window-placeholder" data-slot="piano-roll">
      Piano Roll — placeholder (slice E fills this window)
    </div>
  );
}

export function PlaylistSlot(_props: WindowSlotProps) {
  return (
    <div className="fl-window-placeholder" data-slot="playlist">
      Playlist — placeholder (slice F fills this window)
    </div>
  );
}

export function MixerSlot(_props: WindowSlotProps) {
  return (
    <div className="fl-window-placeholder" data-slot="mixer">
      Mixer — placeholder (slice G fills this window)
    </div>
  );
}
