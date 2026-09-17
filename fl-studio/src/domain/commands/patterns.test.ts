import { describe, expect, it } from "vitest";

import { stepToTicks } from "../tickMath";
import { fixtureProject, idSeq, roundTrip } from "../testKit";
import { DEFAULT_VELOCITY, TICKS_PER_STEP, type Note, type Pattern } from "../types";
import {
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
} from "./patterns";
import { addClip } from "./playlist";
import { CommandError } from "./types";

const pattern2: Pattern = { id: "pat-2", name: "Pattern 2", color: "hsl(4, 55%, 55%)", notes: {} };

function note(id: string, channelId: string, positionTicks: number, lengthTicks = 0): Note {
  return { id, channelId, positionTicks, lengthTicks, pitch: 60, velocity: DEFAULT_VELOCITY };
}

describe("addPattern / removePattern", () => {
  it("adds a pattern and round-trips", () => {
    const { before, after, restored } = roundTrip(fixtureProject(), addPattern(pattern2));
    expect(after.patternOrder).toEqual(["pat-1", "pat-2"]);
    expect(restored).toEqual(before);
  });

  it("refuses to delete the last remaining pattern", () => {
    expect(() => removePattern("pat-1").apply(fixtureProject())).toThrow(CommandError);
  });

  it("deletes the clips that referenced the pattern, and restores them on undo", () => {
    let project = addPattern(pattern2).apply(fixtureProject());
    project = addClip({ id: "clip-1", trackId: "trk-1", patternId: "pat-2", startTick: 0 }).apply(
      project,
    );
    project = addClip({ id: "clip-2", trackId: "trk-2", patternId: "pat-1", startTick: 0 }).apply(
      project,
    );

    const { before, after, restored } = roundTrip(project, removePattern("pat-2"));
    expect(Object.keys(after.clips)).toEqual(["clip-2"]);
    expect(restored).toEqual(before);
  });

  it("moves the active pattern off a deleted one, and undo puts it back", () => {
    let project = addPattern(pattern2).apply(fixtureProject());
    project = { ...project, activePatternId: "pat-2" };

    const { before, after, restored } = roundTrip(project, removePattern("pat-2"));
    expect(after.activePatternId).toBe("pat-1");
    expect(restored.activePatternId).toBe("pat-2");
    expect(restored).toEqual(before);
  });

  it("renames and recolors a pattern reversibly", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updatePattern("pat-1", { name: "Drums", color: "#123456" }),
    );
    expect(after.patterns["pat-1"]!.name).toBe("Drums");
    expect(restored).toEqual(before);
  });
});

describe("notes", () => {
  it("adds notes and inverts to their removal", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      addNotes("pat-1", [note("n1", "ch-kick", 0), note("n2", "ch-kick", 96)]),
    );
    expect(Object.keys(after.patterns["pat-1"]!.notes).sort()).toEqual(["n1", "n2"]);
    expect(restored).toEqual(before);
  });

  it("refuses a note on a channel that does not exist", () => {
    expect(() => addNotes("pat-1", [note("n1", "ghost", 0)]).apply(fixtureProject())).toThrow(
      CommandError,
    );
  });

  it("refuses a duplicate note id", () => {
    const project = addNotes("pat-1", [note("n1", "ch-kick", 0)]).apply(fixtureProject());
    expect(() => addNotes("pat-1", [note("n1", "ch-kick", 24)]).apply(project)).toThrow(CommandError);
  });

  it("removes notes and restores them exactly", () => {
    const project = addNotes("pat-1", [
      note("n1", "ch-kick", 0),
      note("n2", "ch-clap", 96, 48),
    ]).apply(fixtureProject());

    const { before, after, restored } = roundTrip(project, removeNotes("pat-1", ["n1", "n2"]));
    expect(after.patterns["pat-1"]!.notes).toEqual({});
    expect(restored).toEqual(before);
  });

  it("moves and resizes notes in one command, inverting every patched field", () => {
    const project = addNotes("pat-1", [
      note("n1", "ch-bass", 0, 24),
      note("n2", "ch-bass", 48, 24),
    ]).apply(fixtureProject());

    const { before, after, restored } = roundTrip(
      project,
      updateNotes("pat-1", [
        { id: "n1", patch: { positionTicks: 24, pitch: 43 } },
        { id: "n2", patch: { lengthTicks: 96, velocity: 1 } },
      ]),
    );

    expect(after.patterns["pat-1"]!.notes["n1"]).toEqual({
      ...note("n1", "ch-bass", 24, 24),
      pitch: 43,
    });
    expect(after.patterns["pat-1"]!.notes["n2"]!.lengthTicks).toBe(96);
    expect(after.patterns["pat-1"]!.notes["n2"]!.velocity).toBe(1);
    expect(restored).toEqual(before);
  });

  it("throws when a note patch targets a missing note", () => {
    expect(() =>
      updateNotes("pat-1", [{ id: "nope", patch: { pitch: 1 } }]).apply(fixtureProject()),
    ).toThrow(CommandError);
  });
});

describe("the step bridge — a step IS a zero-length note", () => {
  it("builds a zero-length note at the step's tick with the channel's default pitch", () => {
    const project = fixtureProject();
    const cmd = stepToggleCommand(project, "pat-1", "ch-kick", 4, idSeq("n"));
    const after = cmd.apply(project);
    const notes = Object.values(after.patterns["pat-1"]!.notes);

    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual({
      id: "n-1",
      channelId: "ch-kick",
      positionTicks: 4 * TICKS_PER_STEP,
      lengthTicks: 0,
      pitch: 60,
      velocity: DEFAULT_VELOCITY,
    });
  });

  it("uses the melodic channels' own default pitches", () => {
    const project = fixtureProject();
    const bass = stepToggleCommand(project, "pat-1", "ch-bass", 0, idSeq("b")).apply(project);
    expect(Object.values(bass.patterns["pat-1"]!.notes)[0]!.pitch).toBe(36);
    const lead = stepToggleCommand(project, "pat-1", "ch-lead", 0, idSeq("l")).apply(project);
    expect(Object.values(lead.patterns["pat-1"]!.notes)[0]!.pitch).toBe(72);
  });

  it("toggles off by deleting the note that is there", () => {
    const project = fixtureProject();
    const on = stepToggleCommand(project, "pat-1", "ch-kick", 4, idSeq("n")).apply(project);
    const off = stepToggleCommand(on, "pat-1", "ch-kick", 4, idSeq("x")).apply(on);
    expect(off.patterns["pat-1"]!.notes).toEqual({});
  });

  it("round-trips both directions of the toggle", () => {
    const project = fixtureProject();
    const onCmd = stepToggleCommand(project, "pat-1", "ch-kick", 7, idSeq("n"));
    const onTrip = roundTrip(project, onCmd);
    expect(onTrip.restored).toEqual(onTrip.before);

    const on = onTrip.after;
    const offTrip = roundTrip(on, stepToggleCommand(on, "pat-1", "ch-kick", 7, idSeq("x")));
    expect(offTrip.restored).toEqual(on);
  });

  it("deletes a drawn piano-roll note that happens to sit on the step", () => {
    // The grid and the roll are two views of one note list: a sustained note on
    // a step boundary lights that cell, and clicking the cell removes it.
    const project = addNotes("pat-1", [note("drawn", "ch-bass", stepToTicks(2), 48)]).apply(
      fixtureProject(),
    );
    expect(isStepOn(project.patterns["pat-1"]!, "ch-bass", 2)).toBe(true);
    const after = stepToggleCommand(project, "pat-1", "ch-bass", 2, idSeq("n")).apply(project);
    expect(after.patterns["pat-1"]!.notes).toEqual({});
  });

  it("only lights the cell whose tick a note sits on", () => {
    const project = addNotes("pat-1", [note("n1", "ch-kick", stepToTicks(3))]).apply(
      fixtureProject(),
    );
    const pattern = project.patterns["pat-1"]!;
    expect(isStepOn(pattern, "ch-kick", 3)).toBe(true);
    expect(isStepOn(pattern, "ch-kick", 2)).toBe(false);
    expect(isStepOn(pattern, "ch-clap", 3)).toBe(false);
    expect(notesAtStep(pattern, "ch-kick", 3)).toHaveLength(1);
  });

  it("rejects a step outside the one-bar pattern", () => {
    const project = fixtureProject();
    expect(() => stepToggleCommand(project, "pat-1", "ch-kick", 16, idSeq("n"))).toThrow(
      CommandError,
    );
    expect(() => stepToggleCommand(project, "pat-1", "ch-kick", -1, idSeq("n"))).toThrow(
      CommandError,
    );
  });

  it("rejects an unknown channel or pattern", () => {
    const project = fixtureProject();
    expect(() => stepToggleCommand(project, "pat-1", "ghost", 0, idSeq("n"))).toThrow(CommandError);
    expect(() => stepToggleCommand(project, "ghost", "ch-kick", 0, idSeq("n"))).toThrow(CommandError);
  });

  it("stepNote uses DEFAULT_VELOCITY, not lane 2's 1.0 example", () => {
    expect(stepNote("n", "ch-kick", 1, 60).velocity).toBe(DEFAULT_VELOCITY);
    expect(DEFAULT_VELOCITY).toBeCloseTo(100 / 127, 10);
  });
});
