/**
 * Mixer commands (SPEC.md §1.1 Mixer).
 *
 * Only strip parameters are editable: the strip set is fixed at 8 inserts plus
 * the undeletable Master (`MASTER_MIXER_TRACK_ID`), so there is deliberately no
 * add/remove command here. Mixer volume/pan are the *bus* stage — never
 * confuse them with `Channel.volume`/`Channel.pan`, which are pre-mixer
 * (lane 2 §2).
 */

import type { MixerTrack, MixerTrackId, Project } from "../types";
import { CommandError, type Command, pick, setIn } from "./types";

export type MixerPatch = Partial<Pick<MixerTrack, "name" | "volume" | "pan" | "muted">>;
const MIXER_PATCH_KEYS = ["name", "volume", "pan", "muted"] as const;

function requireMixerTrack(project: Project, id: MixerTrackId): MixerTrack {
  const track = project.mixerTracks[id];
  if (track === undefined) throw new CommandError(`No such mixer track: ${id}`);
  return track;
}

export function updateMixerTrack(id: MixerTrackId, patch: MixerPatch): Command {
  return {
    type: "updateMixerTrack",
    label: "Change mixer track",
    apply(project) {
      const track = requireMixerTrack(project, id);
      return { ...project, mixerTracks: setIn(project.mixerTracks, id, { ...track, ...patch }) };
    },
    invert(before) {
      const track = requireMixerTrack(before, id);
      const keys = MIXER_PATCH_KEYS.filter((key) => key in patch);
      return updateMixerTrack(id, pick(track, keys));
    },
  };
}
