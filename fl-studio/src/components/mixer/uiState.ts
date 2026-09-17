/**
 * Mixer's ephemeral UI slice (SPEC §5, §8 — surface-owned `uiState.ts`).
 *
 * Owns exactly the "selected strip" highlight (SPEC §4.3's "selected-strip
 * highlight" / lane 1 §5.2's brighter/wider selected meter) — not persisted
 * domain state (SPEC §5's ephemeral-slice rule).
 *
 * Registered in `src/lib/store.ts` (one import + one spread, per that file's
 * doc comment). Note the `import type` below: `store.ts` imports this module
 * at module scope, so a runtime edge back into it would close a cycle whose
 * second-evaluated end reads the other's `const` in its temporal dead zone.
 */

import type { AppState, AppStateCreator } from "@/lib/store";
import type { MixerTrackId } from "@/domain/types";
import { MASTER_MIXER_TRACK_ID } from "@/domain/types";

export interface MixerUiSlice {
  /** The strip lens/focus (lane 1 §5.2's brighter/wider selected meter). */
  selectedMixerTrackId: MixerTrackId;
  selectMixerTrack: (id: MixerTrackId) => void;
}

export const createMixerUi: AppStateCreator<MixerUiSlice> = (set) => {
  // `set` is typed against `AppState` as seen from inside the creator, where
  // this slice's own keys are the thing being produced — one documented cast,
  // in one place, the same seam `channel-rack/uiState.ts` uses.
  const setSlice = (patch: Partial<MixerUiSlice>): void =>
    set(patch as unknown as Partial<AppState>);

  return {
    selectedMixerTrackId: MASTER_MIXER_TRACK_ID,
    selectMixerTrack: (id) => setSlice({ selectedMixerTrackId: id }),
  };
};
