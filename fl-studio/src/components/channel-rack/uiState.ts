/**
 * Channel Rack's ephemeral UI slice (SPEC §5, §8 — surface-owned `uiState.ts`).
 *
 * Owns exactly what belongs to the rack and nowhere else: which channel row
 * is selected/focused, and the one-shot "open the Piano Roll for this
 * channel" request the channel-name button fires (SPEC §1.1: "Channel name
 * click → opens Piano Roll for that channel", the FL-plugin substitute).
 * None of this is persisted domain state (SPEC §5's ephemeral-slice rule).
 *
 * Registered in `src/lib/store.ts` (one import + one spread, per that file's
 * doc comment). Note the `import type` below: `store.ts` imports this module
 * at module scope, so a runtime edge back into it would close a cycle whose
 * second-evaluated end reads the other's `const` in its temporal dead zone.
 */

import { useEffect, useState } from "react";

import { getPlayheadTicks, getSnapshot, subscribe } from "@/audio";
import { ticksToStep } from "@/domain/tickMath";
import { STEPS_PER_BAR, type ChannelId } from "@/domain/types";
import type { AppState, AppStateCreator } from "@/lib/store";

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
  // `set` is typed against `AppState` as seen from inside the creator, where
  // this slice's own keys are the thing being produced. One documented cast,
  // in one place, keeps `ChannelRackUiSlice`'s public surface fully typed.
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
 * Returns the 0-based step the transport is currently on while playing a
 * *pattern*, and `null` otherwise — song mode has no rack playhead, since the
 * rack shows one pattern and the arrangement is somewhere else entirely.
 *
 * Everything it needs is on the engine's frozen surface, so this hook reaches
 * for no store: `getSnapshot()` carries `playing`/`mode` (the project is
 * pushed into the engine, §3.2), and `getPlayheadTicks()` is the transport
 * read. Only the *step index* enters React state, so a frame that lands on
 * the same step re-renders nothing — 16 renders per bar, not 60 per second.
 */
export function usePlayheadStep(): number | null {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame: number | null = null;

    const readFrame = (): void => {
      const { playing, mode } = getSnapshot();
      setStep(
        playing && mode === "pattern"
          ? ((ticksToStep(getPlayheadTicks()) % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR
          : null,
      );
      frame = window.requestAnimationFrame(readFrame);
    };

    const stopLoop = (): void => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    };

    // The loop exists only while the transport runs; a stopped engine costs
    // one subscription and no frames.
    const sync = (): void => {
      const { playing } = getSnapshot();
      if (playing && frame === null) frame = window.requestAnimationFrame(readFrame);
      if (!playing) {
        stopLoop();
        setStep(null);
      }
    };

    const unsubscribe = subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      stopLoop();
    };
  }, []);

  return step;
}
