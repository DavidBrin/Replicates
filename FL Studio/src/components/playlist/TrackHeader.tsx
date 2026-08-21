import type { PlaylistTrack } from "@/domain/types";

export interface TrackHeaderProps {
  track: PlaylistTrack;
  onToggleMute: () => void;
}

/**
 * Track header (SPEC.md §1.1 Playlist: "name, color, mute"; lane 1 §4.1):
 * a colour strip, the track name, and a mute LED.
 */
export function TrackHeader({ track, onToggleMute }: TrackHeaderProps) {
  return (
    <div className="fl-track-header" data-testid={`track-header-${track.id}`}>
      <span className="fl-track-header__strip" style={{ background: track.color }} />
      <span className="fl-track-header__name" title={track.name}>
        {track.name}
      </span>
      <button
        type="button"
        className="fl-track-header__mute"
        data-muted={track.muted}
        aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.name}`}
        aria-pressed={track.muted}
        onClick={onToggleMute}
      >
        <span className="fl-track-header__led" />
      </button>
    </div>
  );
}
