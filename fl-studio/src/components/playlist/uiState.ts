/**
 * Playlist ephemeral UI slice (SPEC.md §5, §8 slice F) — zoom, horizontal
 * scroll, the selected clip, and which pattern the picker panel currently
 * arms for painting. None of this is persisted; it never touches `Project`.
 *
 * Follows `src/lib/store.ts`'s documented registration pattern verbatim:
 * this file exports the slice interface plus a `StateCreator` typed as
 * `AppStateCreator<PlaylistUiSlice>`. Registering it into the real composer
 * is one import + one spread line in `src/lib/store.ts`, owned by slice A —
 * this file never edits that file (SPEC.md §8).
 *
 * Registered. `Playlist.tsx` reads these fields straight off `useAppStore`;
 * the standalone pre-integration store that used to live here is gone, so
 * there is exactly one store. Note the `import type` below: `store.ts`
 * imports this file at module scope, and a runtime edge back would close a
 * module cycle whose second-evaluated end reads the other's `const` in its
 * temporal dead zone.
 */

import type { StateCreator } from "zustand";

import type { AppStateCreator } from "@/lib/store";
import type { ClipId, PatternId } from "@/domain/types";

export const DEFAULT_ZOOM_PX_PER_BAR = 80;
export const MIN_ZOOM_PX_PER_BAR = 24;
export const MAX_ZOOM_PX_PER_BAR = 320;

export function clampZoom(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_ZOOM_PX_PER_BAR;
  return Math.min(MAX_ZOOM_PX_PER_BAR, Math.max(MIN_ZOOM_PX_PER_BAR, px));
}

export interface PlaylistUiSlice {
  /** Horizontal zoom, pixels per bar (bar = one pattern's fixed length). */
  playlistZoomPxPerBar: number;
  /** Horizontal scroll offset in px — the lanes' shared scroll position. */
  playlistScrollX: number;
  /** The clip the user last clicked, for highlight + context actions. */
  playlistSelectedClipId: ClipId | null;
  /**
   * The pattern armed in the picker panel — what a lane left-click paints.
   * `null` means "follow the active pattern" (SPEC.md §5's activePatternId).
   */
  playlistPaintPatternId: PatternId | null;

  setPlaylistZoom: (px: number) => void;
  zoomPlaylistBy: (factor: number) => void;
  setPlaylistScrollX: (x: number) => void;
  selectPlaylistClip: (id: ClipId | null) => void;
  setPlaylistPaintPattern: (id: PatternId | null) => void;
}

/**
 * Typed against the slice alone — every field this creator reads or writes is
 * its own, so it needs no view of the rest of `AppState`; exported (cast) as
 * the documented `AppStateCreator<PlaylistUiSlice>` contract below.
 */
const createPlaylistUiImpl: StateCreator<PlaylistUiSlice, [], [], PlaylistUiSlice> = (
  set,
  get,
) => ({
  playlistZoomPxPerBar: DEFAULT_ZOOM_PX_PER_BAR,
  playlistScrollX: 0,
  playlistSelectedClipId: null,
  playlistPaintPatternId: null,

  setPlaylistZoom: (px) => set({ playlistZoomPxPerBar: clampZoom(px) }),
  zoomPlaylistBy: (factor) => set({ playlistZoomPxPerBar: clampZoom(get().playlistZoomPxPerBar * factor) }),
  setPlaylistScrollX: (x) => set({ playlistScrollX: Math.max(0, x) }),
  selectPlaylistClip: (id) => set({ playlistSelectedClipId: id }),
  setPlaylistPaintPattern: (id) => set({ playlistPaintPatternId: id }),
});

/** The registration-ready creator — SPEC.md §5's "one import + one spread line". */
export const createPlaylistUi = createPlaylistUiImpl as unknown as AppStateCreator<PlaylistUiSlice>;

/** The slice's boot values — what a test resets the composed store back to. */
export const DEFAULT_PLAYLIST_UI = {
  playlistZoomPxPerBar: DEFAULT_ZOOM_PX_PER_BAR,
  playlistScrollX: 0,
  playlistSelectedClipId: null,
  playlistPaintPatternId: null,
} as const;
