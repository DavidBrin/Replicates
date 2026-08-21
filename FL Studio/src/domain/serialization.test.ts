import { describe, expect, it } from "vitest";

import { addNotes } from "./commands/patterns";
import { addClip } from "./commands/playlist";
import { updateChannel } from "./commands/channels";
import { createDefaultProject } from "./defaultProject";
import {
  MIGRATIONS,
  deserializeProject,
  migrate,
  parseSaveFile,
  readProject,
  serializeProject,
  toSaveFile,
} from "./serialization";
import { fixtureProject } from "./testKit";
import { CURRENT_SCHEMA_VERSION, MASTER_MIXER_TRACK_ID, type Project } from "./types";

/** A project with notes, a clip, a choke group and a non-default routing. */
function richProject(): Project {
  let project = fixtureProject();
  project = addNotes("pat-1", [
    { id: "n1", channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 0.78 },
    {
      id: "n2",
      channelId: "ch-bass",
      positionTicks: 26,
      lengthTicks: 90,
      pitch: 41,
      velocity: 0.42,
    },
  ]).apply(project);
  project = addClip({ id: "clip-1", trackId: "trk-2", patternId: "pat-1", startTick: 384 }).apply(
    project,
  );
  project = updateChannel("ch-snare", { routedToMixerTrackId: "mix-4", pan: -0.5 }).apply(project);
  return { ...project, playbackMode: "song", tempo: 174, globalSwing: 0.35 };
}

describe("the envelope", () => {
  it("wraps the project under the current schema version", () => {
    const save = toSaveFile(fixtureProject());
    expect(save.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(save.schemaVersion).toBe(1);
    expect(save.project).toEqual(fixtureProject());
  });

  it("serializes to JSON carrying the version", () => {
    const parsed = JSON.parse(serializeProject(fixtureProject())) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.project).toBeTypeOf("object");
  });
});

describe("round trip", () => {
  it("restores a rich project byte-for-byte", () => {
    const project = richProject();
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it("keeps the choke group on the channels that have one, and only those", () => {
    const restored = deserializeProject(serializeProject(fixtureProject()))!;
    expect(restored.channels["ch-hat-closed"]!.chokeGroup).toBe("hats");
    expect(restored.channels["ch-hat-open"]!.chokeGroup).toBe("hats");
    expect("chokeGroup" in restored.channels["ch-kick"]!).toBe(false);
    expect(JSON.parse(serializeProject(fixtureProject()))).toBeTruthy();
  });

  it("keeps clips as references — two clips still share one pattern id", () => {
    let project = fixtureProject();
    project = addClip({ id: "a", trackId: "trk-1", patternId: "pat-1", startTick: 0 }).apply(project);
    project = addClip({ id: "b", trackId: "trk-2", patternId: "pat-1", startTick: 384 }).apply(
      project,
    );
    const restored = deserializeProject(serializeProject(project))!;
    expect(restored.clips["a"]!.patternId).toBe(restored.clips["b"]!.patternId);
    expect(Object.keys(restored.patterns)).toEqual(["pat-1"]);
  });

  it("preserves navigation state (playbackMode and activePatternId)", () => {
    const project = { ...fixtureProject(), playbackMode: "song" as const };
    expect(deserializeProject(serializeProject(project))!.playbackMode).toBe("song");
  });

  it("survives a double round trip unchanged", () => {
    const once = deserializeProject(serializeProject(richProject()))!;
    const twice = deserializeProject(serializeProject(once))!;
    expect(twice).toEqual(once);
  });
});

describe("migrate", () => {
  it("has a dispatch table with a v1 entry from day one", () => {
    expect(Object.keys(MIGRATIONS)).toEqual(["1"]);
    expect(MIGRATIONS[1]).toBeTypeOf("function");
  });

  it("refuses an unknown or missing schema version", () => {
    expect(migrate({ schemaVersion: 2, project: fixtureProject() })).toBeNull();
    expect(migrate({ project: fixtureProject() })).toBeNull();
    expect(migrate({ schemaVersion: "1", project: fixtureProject() })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate("nope")).toBeNull();
  });

  it("parseSaveFile returns a normalized envelope", () => {
    const save = parseSaveFile(JSON.parse(serializeProject(fixtureProject())));
    expect(save?.schemaVersion).toBe(1);
    expect(save?.project.name).toBe("New project");
    expect(parseSaveFile({ schemaVersion: 9 })).toBeNull();
  });
});

describe("corrupt and hostile input", () => {
  it("returns null for absent, empty or unparseable text", () => {
    expect(deserializeProject(null)).toBeNull();
    expect(deserializeProject(undefined)).toBeNull();
    expect(deserializeProject("")).toBeNull();
    expect(deserializeProject("{ not json")).toBeNull();
    expect(deserializeProject("[]")).toBeNull();
    expect(deserializeProject("42")).toBeNull();
  });

  it("returns null for a project with no patterns at all", () => {
    expect(readProject({ patterns: {} })).toBeNull();
    expect(readProject({})).toBeNull();
    expect(readProject("nope")).toBeNull();
  });

  it("drops notes whose channel is gone rather than losing the project", () => {
    const project = richProject();
    const damaged = {
      ...project,
      channels: Object.fromEntries(
        Object.entries(project.channels).filter(([id]) => id !== "ch-bass"),
      ),
    };
    const restored = readProject(damaged)!;
    expect(restored).not.toBeNull();
    expect(Object.keys(restored.patterns["pat-1"]!.notes)).toEqual(["n1"]);
  });

  it("drops clips pointing at a missing pattern or track", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      clips: {
        good: { id: "good", trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        deadPattern: { id: "deadPattern", trackId: "trk-1", patternId: "ghost", startTick: 0 },
        deadTrack: { id: "deadTrack", trackId: "ghost", patternId: "pat-1", startTick: 0 },
      },
    })!;
    expect(Object.keys(restored.clips)).toEqual(["good"]);
  });

  it("recreates a missing master strip", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      mixerTracks: Object.fromEntries(
        Object.entries(project.mixerTracks).filter(([id]) => id !== MASTER_MIXER_TRACK_ID),
      ),
    })!;
    expect(restored.mixerTracks[MASTER_MIXER_TRACK_ID]).toMatchObject({ name: "Master" });
  });

  it("re-routes a channel whose mixer strip is gone back to master", () => {
    const restored = readProject({
      ...fixtureProject(),
      channels: {
        "ch-kick": { ...fixtureProject().channels["ch-kick"], routedToMixerTrackId: "mix-99" },
      },
    })!;
    expect(restored.channels["ch-kick"]!.routedToMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
  });

  it("repairs an activePatternId that points nowhere", () => {
    const restored = readProject({ ...fixtureProject(), activePatternId: "ghost" })!;
    expect(restored.activePatternId).toBe("pat-1");
  });

  it("reconciles order arrays against the records", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      channelOrder: ["ch-snare", "ghost", "ch-snare", "ch-kick"],
    })!;
    expect(restored.channelOrder.slice(0, 2)).toEqual(["ch-snare", "ch-kick"]);
    expect(restored.channelOrder).toHaveLength(Object.keys(project.channels).length);
    expect(new Set(restored.channelOrder).size).toBe(restored.channelOrder.length);
  });

  it("clamps out-of-range numbers instead of trusting them", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      tempo: 100000,
      globalSwing: 7,
      channels: {
        "ch-kick": {
          ...project.channels["ch-kick"],
          volume: 12,
          pan: -9,
          defaultStepPitch: 999,
        },
      },
      patterns: {
        "pat-1": {
          ...project.patterns["pat-1"],
          notes: {
            n1: { channelId: "ch-kick", positionTicks: -50, lengthTicks: -3, pitch: 300, velocity: 4 },
          },
        },
      },
    })!;
    expect(restored.tempo).toBe(522);
    expect(restored.globalSwing).toBe(1);
    expect(restored.channels["ch-kick"]).toMatchObject({ volume: 1, pan: -1, defaultStepPitch: 127 });
    expect(restored.patterns["pat-1"]!.notes["n1"]).toMatchObject({
      positionTicks: 0,
      lengthTicks: 0,
      pitch: 127,
      velocity: 1,
    });
  });

  it("falls back to a sane voice for an unknown instrument kind", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      channels: { "ch-kick": { ...project.channels["ch-kick"], voice: "theremin" } },
    })!;
    expect(restored.channels["ch-kick"]!.voice).toBe("kick");
  });

  it("drops unknown junk fields rather than carrying them into state", () => {
    const restored = readProject({
      ...fixtureProject(),
      evil: "<script>",
      channels: { "ch-kick": { ...fixtureProject().channels["ch-kick"], evil: 1 } },
    })!;
    expect("evil" in restored).toBe(false);
    expect("evil" in restored.channels["ch-kick"]!).toBe(false);
  });

  it("a default project survives the whole path unchanged", () => {
    const project = createDefaultProject({ now: "2026-08-20T10:00:00.000Z" });
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});
