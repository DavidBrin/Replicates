import { describe, expect, it } from "vitest";

import { fixtureProject, roundTrip } from "../testKit";
import { MASTER_MIXER_TRACK_ID } from "../types";
import { addChannel, updateChannel } from "./channels";
import { updateMixerTrack } from "./mixer";
import { PROJECT_PATCH_KEYS, replaceProject, updateProject } from "./project";
import { CommandError, composite, noop } from "./types";

describe("mixer commands", () => {
  it("drops a fader reversibly", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updateMixerTrack("mix-1", { volume: 0.2 }),
    );
    expect(after.mixerTracks["mix-1"]!.volume).toBe(0.2);
    expect(restored).toEqual(before);
  });

  it("mutes and renames the master strip reversibly", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updateMixerTrack(MASTER_MIXER_TRACK_ID, { muted: true, name: "Out" }),
    );
    expect(after.mixerTracks[MASTER_MIXER_TRACK_ID]).toMatchObject({ muted: true, name: "Out" });
    expect(restored).toEqual(before);
  });

  it("throws for an unknown strip", () => {
    expect(() => updateMixerTrack("mix-99", { pan: 1 }).apply(fixtureProject())).toThrow(
      CommandError,
    );
  });
});

describe("project commands", () => {
  it("sets tempo and swing reversibly, clamped", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updateProject({ tempo: 9999, globalSwing: 2 }),
    );
    expect(after.tempo).toBe(522);
    expect(after.globalSwing).toBe(1);
    expect(restored).toEqual(before);
  });

  it("renames the project reversibly", () => {
    const { before, after, restored } = roundTrip(fixtureProject(), updateProject({ name: "Beat" }));
    expect(after.name).toBe("Beat");
    expect(restored).toEqual(before);
  });

  it("cannot touch navigation state — activePatternId and playbackMode are not patchable", () => {
    // The non-undoable navigation rule of SPEC.md §5, enforced in the type and
    // asserted here so a later widening of ProjectPatch fails loudly.
    expect(PROJECT_PATCH_KEYS).toEqual(["name", "tempo", "globalSwing"]);
    expect(PROJECT_PATCH_KEYS).not.toContain("activePatternId");
    expect(PROJECT_PATCH_KEYS).not.toContain("playbackMode");

    const project = { ...fixtureProject(), playbackMode: "song" as const };
    const after = updateProject({ tempo: 90 }).apply(project);
    expect(after.playbackMode).toBe("song");
    expect(after.activePatternId).toBe(project.activePatternId);
  });

  it("replaces the whole project reversibly — the JSON import path", () => {
    const before = fixtureProject();
    const imported = { ...fixtureProject(), id: "prj-imported", name: "Imported", tempo: 174 };
    const { restored, after } = roundTrip(before, replaceProject(imported));
    expect(after).toEqual(imported);
    expect(restored).toEqual(before);
  });
});

describe("composite", () => {
  it("applies in order and inverts in reverse", () => {
    const project = fixtureProject();
    const cmd = composite(
      [
        updateProject({ tempo: 100 }),
        updateChannel("ch-kick", { volume: 0.1 }),
        updateProject({ tempo: 128 }),
      ],
      "Batch",
    );
    const { before, after, restored } = roundTrip(project, cmd);
    expect(after.tempo).toBe(128);
    expect(after.channels["ch-kick"]!.volume).toBe(0.1);
    expect(restored).toEqual(before);
  });

  it("is atomic across commands that depend on each other", () => {
    const project = fixtureProject();
    const channel = {
      ...project.channels["ch-kick"]!,
      id: "ch-x",
      name: "X",
    };
    const cmd = composite([addChannel(channel), updateChannel("ch-x", { muted: true })]);
    const { before, after, restored } = roundTrip(project, cmd);
    expect(after.channels["ch-x"]!.muted).toBe(true);
    expect(restored).toEqual(before);
  });

  it("carries a label", () => {
    expect(composite([], "Make unique").label).toBe("Make unique");
    expect(composite([]).apply(fixtureProject())).toEqual(fixtureProject());
  });
});

describe("noop", () => {
  it("changes nothing in either direction", () => {
    const { before, after, restored } = roundTrip(fixtureProject(), noop());
    expect(after).toBe(before);
    expect(restored).toBe(before);
  });
});
