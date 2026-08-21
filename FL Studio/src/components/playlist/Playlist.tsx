"use client";

import "./playlist.css";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  addClip,
  makeUnique,
  removeClip,
  updateClip,
  updatePlaylistTrack,
} from "@/domain/commands";
import { nextId } from "@/domain/ids";
import { TICKS_PER_BAR, type PatternClip, type PatternId, type PlaylistTrackId } from "@/domain/types";
import { useGestureSession } from "@/lib/gestureHold";
import {
  selectActivePatternId,
  selectClips,
  selectPatterns,
  selectPlaybackMode,
  selectPlaylistTracks,
  useAppStore,
} from "@/lib/store";
import { useNonPassiveWheel } from "@/lib/useNonPassiveWheel";
import { ClipView } from "./ClipView";
import { openPatternInPianoRoll } from "./bindings";
import {
  HEADER_WIDTH_PX,
  LANE_HEIGHT_PX,
  pxToTicks,
  RULER_HEIGHT_PX,
  scrollLeftForZoom,
  snapMovedClipTick,
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
  const scrollX = useAppStore((s) => s.playlistScrollX);
  const setScrollX = useAppStore((s) => s.setPlaylistScrollX);

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

  /**
   * One undo entry per right-drag ERASE SWEEP, not one per clip (SPEC.md §7's
   * drag-coalescing rule, the same one the rack's paint stroke and the roll's
   * erase already obey).
   *
   * A sweep deletes through `ClipView`'s `onPointerEnter`, i.e. one
   * `removeClip` dispatch per clip crossed, and each landed as its own history
   * entry: wiping eight bars took eight `Ctrl+Z`. The whole gesture now shares
   * one key — a stable `coalesceKey` naming the control plus a `gestureId`
   * minted at the pointer-down that opened the sweep, which is
   * `domain/undo.ts`'s canonical pairing. Consecutive deletions fold into a
   * single entry whose inverse is the composite of theirs in reverse, so one
   * undo puts every swept clip back.
   *
   * The pointer-down is watched on the surface root rather than on each clip
   * because a sweep may START on empty lane space and only then reach clips —
   * `ClipView` ignores non-primary presses without stopping them, so they
   * bubble here.
   */
  /*
   * `windowBackstop`, because this sweep can end where the surface never hears
   * it. The press is the SECONDARY button, so it cannot take pointer capture
   * without swallowing the context menu, and `onPointerUp` on the playlist
   * root only fires for a release inside its bounds: sweeping off the lanes
   * and letting go over the rack — or losing the pointer to a system gesture,
   * which delivers `pointercancel` and no `pointerup` at all — stranded the
   * hold, and autosave stayed deferred for the rest of the session. The hook
   * listens on the window for both terminators while the sweep is open
   * (`@/lib/gestureHold` rule (f)), the same backstop the rack row wires for
   * its buffered stroke.
   */
  const eraseSweep = useGestureSession("playlist-erase", { windowBackstop: true });
  /**
   * With no sweep open — a bare context-menu delete, a menu item, a test
   * firing `contextmenu` directly — every call gets its OWN fresh id, so
   * unrelated deletions can never fold into each other. That is `keyFor`'s
   * one-shot half; it takes no hold, because the delete has already happened
   * by the time it returns and there is no pointer-up coming to close one.
   */
  function eraseOptions(): { coalesceKey: string; gestureId: string } {
    return { coalesceKey: "playlist:erase", gestureId: eraseSweep.keyFor() };
  }

  function handleToggleMute(trackId: PlaylistTrackId, muted: boolean) {
    dispatch(updatePlaylistTrack(trackId, { muted: !muted }));
  }

  function handleLanePaint(trackId: PlaylistTrackId, event: React.MouseEvent<HTMLDivElement>) {
    // Only the empty lane surface paints — clicks on an existing clip are
    // handled by ClipView itself (select, not paint-over).
    if (event.target !== event.currentTarget) return;
    const lane = event.currentTarget.getBoundingClientRect();
    // Alt bypasses snap for this gesture (SPEC.md §4.4) — the clip lands on
    // the raw tick under the pointer instead of the bar boundary before it.
    const startTick = snapPointerToBar(event.clientX - lane.left, zoomPxPerBar, event.altKey);
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
    // Erasing hunts for the clip *under* the pointer, so it always asks the
    // snapped (bar) question even when Alt is held — an Alt-placed clip sits
    // off-grid and would otherwise be unerasable from the lane. The bar-wide
    // window is the clip's own extent, not a snap decision.
    const pointerTicks = pxToTicks(Math.max(0, event.clientX - lane.left), zoomPxPerBar);
    const hit = (clipsByTrack.get(trackId) ?? []).find(
      (clip) => pointerTicks >= clip.startTick && pointerTicks < clip.startTick + TICKS_PER_BAR,
    );
    if (hit) dispatch(removeClip(hit.id), eraseOptions());
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
    dispatch(removeClip(clipId), eraseOptions());
  }

  /** "Make unique" (SPEC.md D4): fork the pattern, repoint only this clip. */
  function handleMakeUnique(clipId: string) {
    dispatch(makeUnique(clipId, nextId("pattern")));
  }

  /**
   * Shift+pointer-down on a clip (SPEC.md §4.4 "clone selection"): place a
   * fresh clip at the source's current track/position, under the caller's
   * per-gesture coalesce key so a follow-on drag folds the add + move into
   * one undo entry. Returns the new clip's id for the gesture to drag.
   */
  function handleCloneStart(clipId: string, coalesceKey: string): string {
    const source = useAppStore.getState().project.clips[clipId];
    if (!source) return clipId;
    const cloneId = nextId("clip");
    dispatch(
      addClip({
        id: cloneId,
        trackId: source.trackId,
        patternId: source.patternId,
        startTick: source.startTick,
      }),
      { coalesceKey },
    );
    selectClipUi(cloneId);
    return cloneId;
  }

  /**
   * Drag-to-move, cross-track aware (finding #3): `deltaTrackIndex` — the
   * number of lanes the pointer crossed — retargets `trackId` by walking
   * the current track order, clamped to the visible tracks so a clip can
   * never be dropped off the top/bottom of the list. `coalesceKey` is
   * minted fresh per gesture by `ClipView` (finding #7) so two separate
   * drags of the same clip land as two separate undo steps, never one.
   */
  function handleDragCommit(
    clipId: string,
    deltaTicks: number,
    deltaTrackIndex: number,
    coalesceKey: string,
    bypassSnap: boolean,
  ) {
    const clip = useAppStore.getState().project.clips[clipId];
    if (!clip) return;
    // The sign of the drag is what breaks an exact half-bar tie (see
    // `snapMovedClipTick`) — without it, dragging left by half a bar and
    // dragging right by half a bar do not mirror each other.
    const nextTick = snapMovedClipTick(
      clip.startTick + deltaTicks,
      bypassSnap,
      Math.sign(deltaTicks),
    );
    const currentIndex = tracks.findIndex((track) => track.id === clip.trackId);
    const rawIndex = (currentIndex === -1 ? 0 : currentIndex) + deltaTrackIndex;
    const nextIndex = Math.min(tracks.length - 1, Math.max(0, rawIndex));
    const nextTrackId = tracks[nextIndex]?.id ?? clip.trackId;
    if (nextTick === clip.startTick && nextTrackId === clip.trackId) return;
    dispatch(updateClip(clipId, { startTick: nextTick, trackId: nextTrackId }), { coalesceKey });
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  // Read fresh inside the native wheel listener without re-registering it
  // every zoom (the effect below only depends on `zoomBy`, a stable ref).
  const zoomPxPerBarRef = useRef(zoomPxPerBar);
  useEffect(() => {
    zoomPxPerBarRef.current = zoomPxPerBar;
  }, [zoomPxPerBar]);
  const pendingZoomAnchor = useRef<{ anchorTicks: number; pointerOffsetPx: number } | null>(null);
  /**
   * The middle-drag pan. It writes no domain state, but it is a pointer
   * gesture on a surface that dispatches, it lives in a ref exactly like the
   * ones that do, and the rule this file is meant to make unmissable is
   * "every root-managed drag runs through the session helper" — a rule with
   * an exception is a rule nobody applies. The hold costs one entry in a
   * string array and buys the same unmount/cancel guarantees.
   */
  const panGesture = useGestureSession("playlist-pan", {
    windowBackstop: true,
    // The backstop is the reason this is not optional. It ends the SESSION
    // from the window, and the pan's own `middlePan` ref lives here — a
    // release that lands off the surface left it set, and the lanes then
    // scrolled under every later hover with no button held. Owner state dies
    // with the session (`@/lib/gestureHold`), not through a second reset the
    // backstop path forgets to run.
    onCancel: () => {
      middlePan.current = null;
    },
  });
  const middlePan = useRef<{
    startClientX: number;
    startClientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  // React's onWheel is passive, so `preventDefault` there is a no-op and
  // Ctrl+wheel would zoom the browser page instead of the playlist (SPEC.md
  // §4.4 primitive #2) — same fix as the piano roll's native listener.
  useNonPassiveWheel(
    scrollRef,
    useCallback(
      (event: WheelEvent) => {
        const container = scrollRef.current;
        if (container === null || !event.ctrlKey) return;
        event.preventDefault();
        const rect = container.getBoundingClientRect();
        const pointerOffsetPx = event.clientX - rect.left;
        const anchorTicks = pxToTicks(
          container.scrollLeft + pointerOffsetPx,
          zoomPxPerBarRef.current,
        );
        pendingZoomAnchor.current = { anchorTicks, pointerOffsetPx };
        zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      [zoomBy],
    ),
  );

  // Zoom-at-cursor compensation (finding #6): after `zoomPxPerBar` changes,
  // re-derive `scrollLeft` from the anchor tick captured at wheel time so
  // the tick under the pointer stays under the pointer. A layout effect so
  // it lands before paint — no visible jump.
  useLayoutEffect(() => {
    const pending = pendingZoomAnchor.current;
    const container = scrollRef.current;
    if (pending === null || container === null) return;
    pendingZoomAnchor.current = null;
    container.scrollLeft = scrollLeftForZoom(pending.anchorTicks, pending.pointerOffsetPx, zoomPxPerBar);
  }, [zoomPxPerBar]);

  /** Middle-drag pans both axes (SPEC.md §4.4), matching the piano roll's feel. */
  function handleMainPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Secondary press opens an erase sweep — see `eraseOptions`. `begin`
    // registers the persistence hold the sweep needs: it dispatches a
    // `removeClip` per clip crossed, and a slow sweep would otherwise let the
    // autosave debounce expire mid-gesture (SPEC.md §2.2).
    if (event.button === 2) eraseSweep.begin(event);
    if (event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panGesture.begin(event);
    middlePan.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
      scrollTop: mainRef.current?.scrollTop ?? 0,
    };
  }

  function handleMainPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pan = middlePan.current;
    if (pan === null) return;
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.startClientX);
    }
    if (mainRef.current) {
      mainRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.startClientY);
    }
  }

  function handleMainPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    // Both root gestures close on ANY release: a cancelled pointer that left
    // the sweep's key live would weld the next unrelated delete onto the dead
    // sweep's entry, which is the same hole the rack's swing slider had.
    // Unmount closes them too — that half belongs to the hook.
    const wasPanning = middlePan.current !== null;
    // `end` runs each session's `onCancel`, which is what clears `middlePan`.
    eraseSweep.end();
    panGesture.end();
    if (!wasPanning) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  /**
   * `playlistScrollX` is the slice's record of where the lanes are scrolled
   * to. It was declared and never touched: nothing wrote it, nothing read it,
   * so a remount (a tab flip, an F5-equivalent re-render of the shell) put the
   * arrangement back at bar 1 while the store still claimed 0 either way.
   *
   * Written on every scroll — which covers the wheel, the middle-drag pan and
   * the zoom-anchor compensation below, since all three move `scrollLeft` and
   * therefore fire `scroll` — and replayed ONCE on mount, before paint.
   */
  const scrollRestored = useRef(false);
  useLayoutEffect(() => {
    if (scrollRestored.current) return;
    scrollRestored.current = true;
    const container = scrollRef.current;
    if (container === null || scrollX === 0) return;
    container.scrollLeft = scrollX;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only replay
  }, []);

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
        <div
          className="fl-playlist__main"
          data-testid="playlist-main"
          ref={mainRef}
          onPointerDown={handleMainPointerDown}
          onPointerMove={handleMainPointerMove}
          onPointerUp={handleMainPointerUp}
          onPointerCancel={handleMainPointerUp}
        >
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
          <div
            className="fl-playlist__scrollx"
            data-testid="playlist-scrollx"
            ref={scrollRef}
            onScroll={(event) => setScrollX(event.currentTarget.scrollLeft)}
          >
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
                          onMakeUnique={handleMakeUnique}
                          onDragCommit={handleDragCommit}
                          onCloneStart={handleCloneStart}
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
