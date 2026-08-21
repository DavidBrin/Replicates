/**
 * Playlist actions that reach outside this surface's own directory.
 *
 * Everything else in `src/components/playlist/**` dispatches domain
 * commands straight through `@/lib/store`'s `useAppStore` — that store is
 * already the real composer (SPEC.md §5/§8), so clip paint/move/delete and
 * track mute are fully wired today. This file exists only for the one
 * action that has nowhere to land yet: opening a pattern in the Piano
 * Roll, which is slice E's window plus slice C's rack/roll tab switch
 * (`AppShell.tsx`'s `rackTab` state), neither of which this slice may edit.
 */

import { useAppStore } from "@/lib/store";
import type { PatternId } from "@/domain/types";

/**
 * Double-click on a clip (SPEC.md §1.1 Playlist / lane 1 §4.3): makes the
 * clip's pattern active — same non-undoable navigation as a single click —
 * and documents the follow-up.
 *
 * TODO(wire): once integration owns `AppShell.tsx`, double-click should also
 * flip the rack/roll tab to "roll" and focus the Piano Roll window (F7).
 * That switch lives in shell state this slice does not own, so it is left
 * as a callback hook (`onOpenPianoRoll`) on `<Playlist>` for the integrator
 * to pass in rather than reached into directly.
 */
export function openPatternInPianoRoll(patternId: PatternId): void {
  useAppStore.getState().setActivePatternId(patternId);
}
