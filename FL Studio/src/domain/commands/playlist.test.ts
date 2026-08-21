import { describe, expect, it } from "vitest";

import { compileSongMode } from "../compile";
import { fixtureProject, roundTrip } from "../testKit";
import { TICKS_PER_BAR, type Note, type PatternClip } from "../types";
import { addNotes, addPattern } from "./patterns";
import {
  addClip,
  addPlaylistTrack,
  makeUnique,
  movePlaylistTrack,
  removeClip,
  removePlaylistTrack,
  updateClip,
  updatePlaylistTrack,
} from "./playlist";
import { CommandError } from "./types";

function note(id: string, channelId: string, positionTicks: number): Note {
  return { id, channelId, positionTicks, lengthTicks: 0, pitch: 60, velocity: 0.5 };
}

const clipA: PatternClip = { id: "clip-a", trackId: "trk-1", patternId: "pat-1", startTick: 0 };
const clipB: PatternClip = {
  id: "clip-b",
  trackId: "trk-2",
  patternId: "pat-1",
  startTick: TICKS_PER_BAR,
};

/** Two clips of the same pattern, plus a kick on step 0. */
function twoPlacements() {
  let project = addNotes("pat-1", [note("n1", "ch-kick", 0)]).apply(fixtureProject());
  project = addClip(clipA).apply(project);
  project = addClip(clipB).apply(project);
  return project;
}

describe("playlist tracks", () => {
  it("adds and removes a track reversibly", () => {
    const track = { id: "trk-3", name: "Track 3", color: "#abc", muted: false };
    const { before, after, restored } = roundTrip(fixtureProject(), addPlaylistTrack(track));
    expect(after.playlistTrackOrder).toEqual(["trk-1", "trk-2", "trk-3"]);
    expect(restored).toEqual(before);
  });

  it("takes a track's clips with it, and brings them back on undo", () => {
    const project = twoPlacements();
    const { before, after, restored } = roundTrip(project, removePlaylistTrack("trk-1"));
    expect(Object.keys(after.clips)).toEqual(["clip-b"]);
    expect(restored).toEqual(before);
  });

  it("mutes a track reversibly", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updatePlaylistTrack("trk-2", { muted: true }),
    );
    expect(after.playlistTracks["trk-2"]!.muted).toBe(true);
    expect(restored).toEqual(before);
  });

  it("reorders tracks reversibly", () => {
    const { before, after, restored } = roundTrip(fixtureProject(), movePlaylistTrack("trk-2", 0));
    expect(after.playlistTrackOrder).toEqual(["trk-2", "trk-1"]);
    expect(restored.playlistTrackOrder).toEqual(before.playlistTrackOrder);
  });
});

describe("clips", () => {
  it("paints and erases a clip reversibly", () => {
    const added = roundTrip(fixtureProject(), addClip(clipA));
    expect(added.after.clips["clip-a"]).toEqual(clipA);
    expect(added.restored).toEqual(added.before);

    const erased = roundTrip(added.after, removeClip("clip-a"));
    expect(erased.after.clips).toEqual({});
    expect(erased.restored).toEqual(added.after);
  });

  it("drags a clip across tracks and time reversibly", () => {
    const project = twoPlacements();
    const { before, after, restored } = roundTrip(
      project,
      updateClip("clip-a", { trackId: "trk-2", startTick: TICKS_PER_BAR * 2 }),
    );
    expect(after.clips["clip-a"]).toEqual({
      ...clipA,
      trackId: "trk-2",
      startTick: TICKS_PER_BAR * 2,
    });
    expect(restored).toEqual(before);
  });

  it("refuses a clip on a missing pattern or track", () => {
    const project = fixtureProject();
    expect(() => addClip({ ...clipA, patternId: "ghost" }).apply(project)).toThrow(CommandError);
    expect(() => addClip({ ...clipA, trackId: "ghost" }).apply(project)).toThrow(CommandError);
  });
});

describe("reference semantics", () => {
  it("shares one pattern between two clips — editing it changes both placements", () => {
    let project = twoPlacements();
    expect(project.clips["clip-a"]!.patternId).toBe(project.clips["clip-b"]!.patternId);

    project = addNotes("pat-1", [note("n2", "ch-clap", 48)]).apply(project);

    const song = compileSongMode(project);
    // Two notes per placement, two placements.
    expect(song.events).toHaveLength(4);
    expect(song.events.filter((event) => event.tick === 48)).toHaveLength(1);
    expect(song.events.filter((event) => event.tick === TICKS_PER_BAR + 48)).toHaveLength(1);
  });
});

describe("makeUnique (D4)", () => {
  it("clones the pattern, repoints only this clip, and leaves the other alone", () => {
    const project = twoPlacements();
    const after = makeUnique("clip-a", "pat-clone").apply(project);

    expect(after.clips["clip-a"]!.patternId).toBe("pat-clone");
    expect(after.clips["clip-b"]!.patternId).toBe("pat-1");
    expect(after.patterns["pat-clone"]!.name).toBe("Pattern 1 (unique)");
    expect(after.patterns["pat-clone"]!.color).toBe(project.patterns["pat-1"]!.color);
    expect(after.patterns["pat-clone"]!.notes).toEqual(project.patterns["pat-1"]!.notes);
    expect(after.patternOrder).toEqual(["pat-1", "pat-clone"]);
  });

  it("forks the notes — editing the clone leaves the original untouched", () => {
    let project = makeUnique("clip-a", "pat-clone").apply(twoPlacements());
    project = addNotes("pat-clone", [note("n9", "ch-snare", 192)]).apply(project);

    expect(Object.keys(project.patterns["pat-clone"]!.notes).sort()).toEqual(["n1", "n9"]);
    expect(Object.keys(project.patterns["pat-1"]!.notes)).toEqual(["n1"]);
  });

  it("undoes as one entry: the clip points back and the clone is gone", () => {
    const { before, restored } = roundTrip(twoPlacements(), makeUnique("clip-a", "pat-clone"));
    expect(restored.patterns["pat-clone"]).toBeUndefined();
    expect(restored.clips["clip-a"]!.patternId).toBe("pat-1");
    expect(restored).toEqual(before);
  });

  it("refuses to reuse an existing pattern id", () => {
    expect(() => makeUnique("clip-a", "pat-1").apply(twoPlacements())).toThrow(CommandError);
  });

  it("refuses an unknown clip", () => {
    expect(() => makeUnique("ghost", "pat-clone").apply(twoPlacements())).toThrow(CommandError);
  });

  it("accepts a custom name suffix", () => {
    const after = makeUnique("clip-a", "pat-clone", " #2").apply(twoPlacements());
    expect(after.patterns["pat-clone"]!.name).toBe("Pattern 1 #2");
  });

  it("survives a second fork of the same original", () => {
    let project = makeUnique("clip-a", "pat-clone").apply(twoPlacements());
    project = addPattern({ id: "pat-3", name: "P3", color: "#fff", notes: {} }).apply(project);
    const again = makeUnique("clip-b", "pat-clone-2").apply(project);
    expect(again.clips["clip-b"]!.patternId).toBe("pat-clone-2");
    expect(again.patterns["pat-1"]).toBeDefined();
  });
});
