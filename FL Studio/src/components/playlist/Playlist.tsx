"use client";

import "./playlist.css";

import { useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  addClip,
  removeClip,
  updateClip,
  updatePlaylistTrack,
} from "@/domain/commands";
import { snapTicksFloor } from "@/domain/tickMath";
import { nextId } from "@/domain/ids";
import type { PatternClip, PatternId, PlaylistTrackId } from "@/domain/types";
import {
  selectActivePatternId,
  selectClips,
  selectPatterns,
  selectPlaybackMode,
  selectPlaylistTracks,
  useAppStore,
} from "@/lib/store";
import { ClipView } from "./ClipView";
import { openPatternInPianoRoll } from "./bindings";
import {
  HEADER_WIDTH_PX,
  LANE_HEIGHT_PX,
  RULER_HEIGHT_PX,
  snapPointerToBar,
  ticksToPx,
  totalVisibleBars,
} from "./geometry";
import { PatternPicker } from "./PatternPicker";
import { TimelineRuler } from "./TimelineRuler";
import { TrackHeader } from "./TrackHeader";

export interface PlaylistProps {
  /**
   * Song-mode playhead position in ticks, or `undefined` when the transport
   * is stopped. The shell samples it on a rAF loop reading the engine's
   * transport (SPEC.md §5: "playback position ... not from store
   * subscriptions per tick") and passes it down.
   */
  playheadTicks?: number;
  /**
   * Double-click a clip → open its pattern in the Piano Roll. The shell
   * passes this in because flipping the rack/roll tab is shell state; with
   * no handler the surface falls back to `bindings.ts`, which can only make
   * the pattern active.
   */
  onOpenPianoRoll?: (patternId: PatternId) => void;
}

/**
 * The Playlist surface (SPEC.md §1.1 Playlist, §4.2 DOM verdict, §4.3
 * tokens): pattern picker, track headers, a bar-numbered ruler, and
 * horizontal lanes of pattern clips. Every mutation goes through slice A's
 * commands (`@/domain/commands`) via `useAppStore.dispatch` — clips are
 * references to patterns, so a clip's miniature reflects pattern edits
 * automatically (SPEC.md §1.1 "shared-reference reuse").
 */
export function Playlist({ playheadTicks, onOpenPianoRoll }: PlaylistProps) {
  const patterns = useAppStore(useShallow(selectPatterns));
  const tracks = useAppStore(useShallow(selectPlaylistTracks));
  const clips = useAppStore(useShallow(selectClips));
  const activePatternId = useAppStore(selectActivePatternId);
  const playbackMode = useAppStore(selectPlaybackMode);

  // The UI slice is registered in the one composed store (SPEC.md §5), so
  // these are plain selectors off `useAppStore` — same fields, no second store.
  const zoomPxPerBar = useAppStore((s) => s.playlistZoomPxPerBar);
  const setZoom = useAppStore((s) => s.setPlaylistZoom);
  const zoomBy = useAppStore((s) => s.zoomPlaylistBy);
  const selectedClipId = useAppStore((s) => s.playlistSelectedClipId);
  const selectClipUi = useAppStore((s) => s.selectPlaylistClip);
  const paintPatternId = useAppStore((s) => s.playlistPaintPatternId);
  const setPaintPattern = useAppStore((s) => s.setPlaylistPaintPattern);

  const armedPatternId = paintPatternId ?? activePatternId;

  const clipsByTrack = useMemo(() => {
    const map = new Map<PlaylistTrackId, PatternClip[]>();
    for (const track of tracks) map.set(track.id, []);
    for (const clip of clips) {
      const bucket = map.get(clip.trackId);
      if (bucket) bucket.push(clip);
    }
    return map;
  }, [tracks, clips]);

  const totalBars = useMemo(() => {
    const furthestEnd = clips.reduce((max, clip) => Math.max(max, clip.startTick), 0);
    return totalVisibleBars(furthestEnd);
  }, [clips]);

  const contentWidth = totalBars * zoomPxPerBar;

  const dispatch = useAppStore.getState().dispatch;

  function handleToggleMute(trackId: PlaylistTrackId, muted: boolean) {
    dispatch(updatePlaylistTrack(trackId, { muted: !muted }));
  }

  function handleLanePaint(trackId: PlaylistTrackId, event: React.MouseEvent<HTMLDivElement>) {
    // Only the empty lane surface paints — clicks on an existing clip are
    // handled by ClipView itself (select, not paint-over).
    if (event.target !== event.currentTarget) return;
    const lane = event.currentTarget.getBoundingClientRect();
    const startTick = snapPointerToBar(event.clientX - lane.left, zoomPxPerBar);
    const alreadyPlaced = (clipsByTrack.get(trackId) ?? []).some(
      (clip) => clip.startTick === startTick,
    );
    if (alreadyPlaced) return;
    dispatch(
      addClip({
        id: nextId("clip"),
        trackId,
        patternId: armedPatternId,
        startTick,
      }),
    );
  }

  function handleLaneErase(trackId: PlaylistTrackId, event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const lane = event.currentTarget.getBoundingClientRect();
    const tick = snapPointerToBar(event.clientX - lane.left, zoomPxPerBar);
    const hit = (clipsByTrack.get(trackId) ?? []).find((clip) => clip.startTick === tick);
    if (hit) dispatch(removeClip(hit.id));
  }

  function handleSelectClip(clipId: string) {
    selectClipUi(clipId);
    const clip = useAppStore.getState().project.clips[clipId];
    if (clip) useAppStore.getState().setActivePatternId(clip.patternId);
  }

  function handleOpenClip(clip: PatternClip) {
    if (onOpenPianoRoll) onOpenPianoRoll(clip.patternId);
    else openPatternInPianoRoll(clip.patternId);
  }

  function handleDeleteClip(clipId: string) {
    dispatch(removeClip(clipId));
  }

  function handleDragCommit(clipId: string, deltaTicks: number) {
    const clip = useAppStore.getState().project.clips[clipId];
    if (!clip) return;
    const nextTick = Math.max(0, snapTicksFloor(clip.startTick + deltaTicks, "bar"));
    if (nextTick === clip.startTick) return;
    dispatch(updateClip(clipId, { startTick: nextTick }), { coalesceKey: `clip-move-${clipId}` });
  }

  function handleWheelZoom(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="fl-playlist">
      <div className="fl-playlist__toolbar">
        <button type="button" className="fl-icon-button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <button type="button" className="fl-icon-button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button
          type="button"
          className="fl-icon-button"
          aria-label="Reset zoom"
          onClick={() => setZoom(80)}
        >
          ⟲
        </button>
      </div>
      <div className="fl-playlist__body">
        <PatternPicker patterns={patterns} armedPatternId={armedPatternId} onArm={setPaintPattern} />
        <div className="fl-playlist__main">
          <div
            className="fl-playlist__headers"
            style={{ paddingTop: RULER_HEIGHT_PX, width: HEADER_WIDTH_PX }}
          >
            {tracks.map((track) => (
              <div key={track.id} style={{ height: LANE_HEIGHT_PX }}>
                <TrackHeader track={track} onToggleMute={() => handleToggleMute(track.id, track.muted)} />
              </div>
            ))}
          </div>
          <div className="fl-playlist__scrollx" ref={scrollRef} onWheel={handleWheelZoom}>
            <div
              className="fl-playlist__content"
              style={
                { width: contentWidth, "--fl-lane-px": `${LANE_HEIGHT_PX}px` } as React.CSSProperties
              }
            >
              <TimelineRuler
                totalBars={totalBars}
                pxPerBar={zoomPxPerBar}
                playheadTicks={playbackMode === "song" ? (playheadTicks ?? null) : null}
              />
              <div
                className="fl-playlist__lanes"
                // The lane grid rules are CSS gradients; the zoom is React
                // state, so the bar pitch crosses over as a custom property.
                style={
                  {
                    width: contentWidth,
                    "--fl-bar-px": `${zoomPxPerBar}px`,
                  } as React.CSSProperties
                }
              >
                {tracks.map((track, index) => (
                  <div
                    key={track.id}
                    className="fl-playlist-lane"
                    data-testid={`lane-${track.id}`}
                    data-shade={index % 2 === 0 ? "even" : "odd"}
                    style={{ height: LANE_HEIGHT_PX, width: contentWidth }}
                    onClick={(event) => handleLanePaint(track.id, event)}
                    onContextMenu={(event) => handleLaneErase(track.id, event)}
                  >
                    {(clipsByTrack.get(track.id) ?? []).map((clip) => {
                      const pattern = patterns.find((p) => p.id === clip.patternId);
                      if (!pattern) return null;
                      return (
                        <ClipView
                          key={clip.id}
                          clip={clip}
                          pattern={pattern}
                          pxPerBar={zoomPxPerBar}
                          selected={clip.id === selectedClipId}
                          onSelect={handleSelectClip}
                          onOpen={handleOpenClip}
                          onDelete={handleDeleteClip}
                          onDragCommit={handleDragCommit}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              {playbackMode === "song" && playheadTicks !== undefined && (
                <div
                  className="fl-playlist__playhead-line"
                  style={{ left: ticksToPx(playheadTicks, zoomPxPerBar) }}
                  data-testid="playlist-playhead-line"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
