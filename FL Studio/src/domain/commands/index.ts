/**
 * Every command, one import site (SPEC.md §2.1).
 *
 * UI slices import from `@/domain/commands` and dispatch through the store —
 * they never construct project objects by hand.
 */

export {
  CommandError,
  composite,
  isEmptyCommand,
  noop,
  type Command,
} from "./types";

export {
  addChannel,
  moveChannel,
  removeChannel,
  restoreChannel,
  updateChannel,
  type ChannelPatch,
} from "./channels";

export {
  addNotes,
  addPattern,
  isStepOn,
  notesAtStep,
  removeNotes,
  removePattern,
  stepNote,
  stepToggleCommand,
  updateNotes,
  updatePattern,
  type NotePatch,
  type PatternPatch,
} from "./patterns";

export {
  addClip,
  addPlaylistTrack,
  makeUnique,
  movePlaylistTrack,
  removeClip,
  removePlaylistTrack,
  updateClip,
  updatePlaylistTrack,
  type ClipPatch,
  type TrackPatch,
} from "./playlist";

export { updateMixerTrack, type MixerPatch } from "./mixer";

export {
  PROJECT_PATCH_KEYS,
  replaceProject,
  updateProject,
  type ProjectPatch,
} from "./project";
