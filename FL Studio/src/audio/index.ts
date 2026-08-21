/**
 * The audio slice's front door (SPEC.md §3, §8).
 *
 * The wiring layer should import from `@/audio` — never from `@/audio/engine`'s
 * neighbours — so the frozen public surface stays the only supported seam:
 *
 * `ensureStarted() · play() · stop() · setMode() · previewNote(channelId,
 * pitch, durationSec?) · getMeterTap(trackId) · exportWav()`, plus
 * `syncProject(project)` (the store push of §5) and the playhead/transport
 * readers a rAF loop needs.
 */

export {
  disposeEngine,
  ensureStarted,
  exportWav,
  getMeterTap,
  getPlayheadSeconds,
  getPlayheadTicks,
  getSnapshot,
  isPlaying,
  isStarted,
  play,
  previewNote,
  setMetronomeEnabled,
  setMode,
  stop,
  subscribe,
  syncProject,
  PREVIEW_DURATION_SEC,
} from "./engine";

export type { EngineSnapshot, ScheduledEvent } from "./types";
export type { ExportedWav, ExportOptions } from "./exportWav";
