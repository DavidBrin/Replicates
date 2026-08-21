/**
 * Channel Rack's ephemeral UI slice (SPEC §5, §8 — surface-owned `uiState.ts`).
 *
 * Owns exactly what belongs to the rack and nowhere else: which channel row
 * is selected/focused, and the one-shot "open the Piano Roll for this
 * channel" request the channel-name button fires (SPEC §1.1: "Channel name
 * click → opens Piano Roll for that channel", the FL-plugin substitute).
 * None of this is persisted domain state (SPEC §5's ephemeral-slice rule).
 *
 * Registration is slice A's job — see `src/lib/store.ts`'s doc comment:
 *
 * ```ts
 * import { createChannelRackUi, type ChannelRackUiSlice } from "@/components/channel-rack/uiState";
 * export type UiSlices = ChannelRackUiSlice & …;
 * // …
 * ...createChannelRackUi(...args),
 * ```
 */

import type { AppState, AppStateCreator } from "@/lib/store";
import type { ChannelId } from "@/domain/types";

export interface ChannelRackUiSlice {
  /** The row lens/focus — "when lit, the Channel is selected" (lane 1 §2.7). */
  selectedChannelId: ChannelId | null;
  selectChannel: (id: ChannelId) => void;

  /**
   * A one-shot request the Piano Roll surface (slice E) consumes and clears.
   * Selecting a channel does not by itself imply "open the roll" (arrow-key
   * navigation shouldn't yank focus), so this is a separate field the
   * channel-name button's click sets explicitly.
   */
  pianoRollRequestChannelId: ChannelId | null;
  requestOpenPianoRoll: (id: ChannelId) => void;
  clearPianoRollRequest: () => void;
}

export const createChannelRackUi: AppStateCreator<ChannelRackUiSlice> = (set) => {
  // `set` is typed against the full `AppState`, which does not yet include
  // this slice's fields until integration adds `ChannelRackUiSlice` to
  // `UiSlices` in `store.ts` (SPEC §5, §8). The cast is the seam that keeps
  // this file typechecking *before* that registration, without weakening
  // `ChannelRackUiSlice`'s own (fully-typed) public surface.
  const setSlice = (patch: Partial<ChannelRackUiSlice>): void =>
    set(patch as unknown as Partial<AppState>);

  return {
    selectedChannelId: null,
    selectChannel: (id) => setSlice({ selectedChannelId: id }),

    pianoRollRequestChannelId: null,
    requestOpenPianoRoll: (id) =>
      setSlice({ selectedChannelId: id, pianoRollRequestChannelId: id }),
    clearPianoRollRequest: () => setSlice({ pianoRollRequestChannelId: null }),
  };
};

/**
 * Playback-position seam (SPEC §5: "Playback position for playheads comes
 * from a rAF loop reading the Transport, not from store subscriptions per
 * tick").
 *
 * TODO(wire): `src/audio/engine.ts` (slice B) has not landed yet — there is
 * no Transport to read. Once it exists, replace this hook's body with a
 * `requestAnimationFrame` loop that reads the engine's current tick, derives
 * the active step (`ticksToStep`), and returns it only while
 * `playbackMode === "pattern"` and the transport is running; otherwise
 * `null`. Keeping the seam in this one function is what lets
 * `ChannelRack.tsx` render a playhead highlight today without depending on
 * B's shape.
 */
export function usePlayheadStep(): number | null {
  return null;
}
