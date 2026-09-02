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
 * The tab flip that completes the action (rack ⇄ roll, F7) lives in shell
 * state this slice does not own, so `AppShell` passes `onOpenPianoRoll` into
 * `<Playlist>` and that handler supersedes this one. This remains the
 * fallback for a `<Playlist>` mounted without the shell — a test, or a
 * future second host.
 */
export function openPatternInPianoRoll(patternId: PatternId): void {
  useAppStore.getState().setActivePatternId(patternId);
}
