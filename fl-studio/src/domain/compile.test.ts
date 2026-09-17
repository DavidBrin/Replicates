import { describe, expect, it } from "vitest";

import {
  compilePattern,
  compilePatternMode,
  compileSongMode,
  compileTimeline,
  compileTimelineCached,
  notesForChannel,
} from "./compile";
import { addClip, updatePlaylistTrack } from "./commands/playlist";
import { addNotes, addPattern } from "./commands/patterns";
import { updateChannel } from "./commands/channels";
import { fixtureProject } from "./testKit";
import { PATTERN_LENGTH_TICKS, TICKS_PER_BAR, type Note, type Project } from "./types";

function note(id: string, channelId: string, positionTicks: number, pitch = 60): Note {
  return { id, channelId, positionTicks, lengthTicks: 0, pitch, velocity: 0.5 };
}

/** Kick on 0 and 192, clap on 96, in pat-1. */
function beat(): Project {
  return addNotes("pat-1", [
    note("n1", "ch-kick", 0),
    note("n2", "ch-clap", 96),
    note("n3", "ch-kick", 192),
  ]).apply(fixtureProject());
}

describe("compilePattern", () => {
  it("flattens a pattern's notes to absolute-tick events, sorted", () => {
    const events = compilePattern(beat(), "pat-1");
    expect(events.map((event) => event.tick)).toEqual([0, 96, 192]);
    expect(events[0]).toEqual({
      tick: 0,
      channelId: "ch-kick",
      pitch: 60,
      velocity: 0.5,
      lengthTicks: 0,
      noteId: "n1",
      patternId: "pat-1",
    });
  });

  it("offsets by a clip start", () => {
    const events = compilePattern(beat(), "pat-1", TICKS_PER_BAR);
    expect(events.map((event) => event.tick)).toEqual([384, 480, 576]);
  });

  it("sorts simultaneous events by pitch, then id, for a stable order", () => {
    const project = addNotes("pat-1", [
      note("nb", "ch-lead", 0, 72),
      note("na", "ch-bass", 0, 36),
      note("nc", "ch-lead", 0, 72),
    ]).apply(fixtureProject());
    expect(compilePattern(project, "pat-1").map((event) => event.noteId)).toEqual([
      "na",
      "nb",
      "nc",
    ]);
  });

  it("is empty for an unknown pattern", () => {
    expect(compilePattern(fixtureProject(), "ghost")).toEqual([]);
  });

  it("keeps a muted channel's events — mute is a ramped gain, not a compile-time cut", () => {
    const project = updateChannel("ch-kick", { muted: true }).apply(beat());
    expect(compilePattern(project, "pat-1").filter((e) => e.channelId === "ch-kick")).toHaveLength(2);
  });
});

describe("pattern mode", () => {
  it("compiles the active pattern and loops one bar", () => {
    const timeline = compilePatternMode(beat());
    expect(timeline.mode).toBe("pattern");
    expect(timeline.lengthTicks).toBe(PATTERN_LENGTH_TICKS);
    expect(timeline.events).toHaveLength(3);
  });

  it("follows activePatternId, ignoring the playlist entirely", () => {
    let project = addPattern({ id: "pat-2", name: "P2", color: "#fff", notes: {} }).apply(beat());
    project = addNotes("pat-2", [note("n9", "ch-snare", 48)]).apply(project);
    project = addClip({ id: "c1", trackId: "trk-1", patternId: "pat-1", startTick: 0 }).apply(project);
    project = { ...project, activePatternId: "pat-2" };

    const timeline = compilePatternMode(project);
    expect(timeline.events.map((event) => event.noteId)).toEqual(["n9"]);
  });
});

describe("song mode", () => {
  it("compiles each placement at its clip offset — a shared pattern twice", () => {
    let project = beat();
    project = addClip({ id: "c1", trackId: "trk-1", patternId: "pat-1", startTick: 0 }).apply(project);
    project = addClip({
      id: "c2",
      trackId: "trk-2",
      patternId: "pat-1",
      startTick: TICKS_PER_BAR,
    }).apply(project);

    const timeline = compileSongMode(project);
    expect(timeline.mode).toBe("song");
    expect(timeline.events).toHaveLength(6);
    expect(timeline.events.map((event) => event.tick)).toEqual([0, 96, 192, 384, 480, 576]);
    expect(timeline.lengthTicks).toBe(TICKS_PER_BAR * 2);
  });

  it("excludes a muted track's clips", () => {
    let project = beat();
    project = addClip({ id: "c1", trackId: "trk-1", patternId: "pat-1", startTick: 0 }).apply(project);
    project = addClip({
      id: "c2",
      trackId: "trk-2",
      patternId: "pat-1",
      startTick: TICKS_PER_BAR,
    }).apply(project);
    project = updatePlaylistTrack("trk-1", { muted: true }).apply(project);

    const timeline = compileSongMode(project);
    expect(timeline.events).toHaveLength(3);
    expect(timeline.events.every((event) => event.tick >= TICKS_PER_BAR)).toBe(true);
    // The muted track still occupies its two bars of timeline.
    expect(timeline.lengthTicks).toBe(TICKS_PER_BAR * 2);
  });

  it("is empty but one bar long with no clips", () => {
    const timeline = compileSongMode(beat());
    expect(timeline.events).toEqual([]);
    expect(timeline.lengthTicks).toBe(TICKS_PER_BAR);
  });
});

describe("compileTimeline", () => {
  it("follows playbackMode", () => {
    const project = beat();
    expect(compileTimeline(project).mode).toBe("pattern");
    expect(compileTimeline({ ...project, playbackMode: "song" }).mode).toBe("song");
  });

  it("memoizes per project object and per mode", () => {
    const project = beat();
    const first = compileTimelineCached(project);
    expect(compileTimelineCached(project)).toBe(first);

    const edited = addNotes("pat-1", [note("n4", "ch-snare", 288)]).apply(project);
    const second = compileTimelineCached(edited);
    expect(second).not.toBe(first);
    expect(second.events).toHaveLength(4);

    // Same object, different mode — a different cache entry, not a stale hit.
    const songy = { ...project, playbackMode: "song" as const };
    expect(compileTimelineCached(songy).mode).toBe("song");
    expect(compileTimelineCached(songy)).toBe(compileTimelineCached(songy));
  });

  it("recompiles when the active pattern changes without any edit", () => {
    let project = addPattern({ id: "pat-2", name: "P2", color: "#fff", notes: {} }).apply(beat());
    project = addNotes("pat-2", [note("n9", "ch-snare", 48)]).apply(project);
    const first = compileTimelineCached(project);
    const navigated = { ...project, activePatternId: "pat-2" };
    expect(compileTimelineCached(navigated).events).toHaveLength(1);
    expect(first.events).toHaveLength(3);
  });
});

describe("notesForChannel", () => {
  it("returns only that channel's notes, in time order", () => {
    const notes = notesForChannel(beat(), "pat-1", "ch-kick");
    expect(notes.map((entry) => entry.id)).toEqual(["n1", "n3"]);
    expect(notesForChannel(beat(), "pat-1", "ch-snare")).toEqual([]);
    expect(notesForChannel(beat(), "ghost", "ch-kick")).toEqual([]);
  });
});
