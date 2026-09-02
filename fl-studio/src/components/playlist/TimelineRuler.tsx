import { ticksToPx } from "./geometry";

export interface TimelineRulerProps {
  totalBars: number;
  pxPerBar: number;
  /** Song-mode playhead, in ticks, or `null` to hide it (SPEC.md §1.1: "Playhead ... song mode"). */
  playheadTicks: number | null;
}

/**
 * Bar-numbered ruler above the lanes (SPEC.md §4.3 "time ruler with bar
 * numbers on top"; lane 1 §4.1). The playhead triangle + line render here
 * and continue down through the lanes via `Playlist.tsx`'s shared offset.
 */
export function TimelineRuler({ totalBars, pxPerBar, playheadTicks }: TimelineRulerProps) {
  const bars = Array.from({ length: totalBars }, (_, i) => i);
  const width = totalBars * pxPerBar;

  return (
    <div className="fl-playlist-ruler" style={{ width }} data-testid="playlist-ruler">
      {bars.map((bar) => (
        <div
          key={bar}
          className="fl-playlist-ruler__bar"
          style={{ left: bar * pxPerBar, width: pxPerBar }}
        >
          {bar + 1}
        </div>
      ))}
      {playheadTicks !== null && (
        <div
          className="fl-playlist-playhead__marker"
          style={{ left: ticksToPx(playheadTicks, pxPerBar) }}
          data-testid="playlist-playhead-marker"
        />
      )}
    </div>
  );
}
