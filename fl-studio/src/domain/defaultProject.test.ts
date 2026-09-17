import { describe, expect, it } from "vitest";

import { DEFAULT_INSERT_COUNT, createDefaultProject } from "./defaultProject";
import { PALETTE } from "./palette";
import { compilePatternMode } from "./compile";
import {
  DEFAULT_TEMPO,
  MASTER_MIXER_TRACK_ID,
  VOICE_KINDS,
  type Channel,
} from "./types";

const project = createDefaultProject();

function channels(): Channel[] {
  return project.channelOrder.map((id) => project.channels[id]!);
}

describe("the default project (SPEC.md §2.2)", () => {
  it("has the seven specced channels in rack order", () => {
    expect(channels().map((channel) => channel.voice)).toEqual([
      "kick",
      "clap",
      "hatClosed",
      "hatOpen",
      "snare",
      "bass",
      "lead",
    ]);
    expect(channels().map((channel) => channel.name)).toEqual([
      "Kick",
      "Clap",
      "Closed hat",
      "Open hat",
      "Snare",
      "Bass",
      "Lead",
    ]);
  });

  it("puts both hats — and only the hats — in choke group \"hats\"", () => {
    const grouped = channels().filter((channel) => channel.chokeGroup !== undefined);
    expect(grouped.map((channel) => channel.id)).toEqual(["ch-hat-closed", "ch-hat-open"]);
    expect(grouped.every((channel) => channel.chokeGroup === "hats")).toBe(true);
  });

  it("routes every channel to master at 0.8 pre-mixer volume, centred and unmuted", () => {
    for (const channel of channels()) {
      expect(channel.routedToMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
      expect(channel.volume).toBe(0.8);
      expect(channel.pan).toBe(0);
      expect(channel.muted).toBe(false);
    }
  });

  it("gives drums C4 and the melodic channels playable defaults", () => {
    expect(project.channels["ch-kick"]!.defaultStepPitch).toBe(60);
    expect(project.channels["ch-bass"]!.defaultStepPitch).toBe(36);
    expect(project.channels["ch-lead"]!.defaultStepPitch).toBe(72);
  });

  it("uses only palette colours, all distinct across channels", () => {
    const colors = channels().map((channel) => channel.color);
    expect(colors.every((color) => PALETTE.includes(color))).toBe(true);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("starts with one empty pattern, active, in pattern mode", () => {
    expect(project.patternOrder).toEqual(["pat-1"]);
    expect(project.patterns["pat-1"]!.notes).toEqual({});
    expect(project.activePatternId).toBe("pat-1");
    expect(project.playbackMode).toBe("pattern");
    expect(compilePatternMode(project).events).toEqual([]);
  });

  it("has two playlist tracks and no clips", () => {
    expect(project.playlistTrackOrder).toEqual(["trk-1", "trk-2"]);
    expect(Object.values(project.playlistTracks).every((track) => !track.muted)).toBe(true);
    expect(project.clips).toEqual({});
  });

  it("has 8 insert strips plus an undeletable master, master first", () => {
    expect(project.mixerTrackOrder[0]).toBe(MASTER_MIXER_TRACK_ID);
    expect(project.mixerTrackOrder).toHaveLength(DEFAULT_INSERT_COUNT + 1);
    expect(DEFAULT_INSERT_COUNT).toBe(8);
    expect(project.mixerTracks[MASTER_MIXER_TRACK_ID]!.name).toBe("Master");
  });

  it("runs at 140 BPM with swing off", () => {
    expect(project.tempo).toBe(DEFAULT_TEMPO);
    expect(project.tempo).toBe(140);
    expect(project.globalSwing).toBe(0);
  });

  it("is deterministic — two calls produce identical JSON", () => {
    expect(JSON.stringify(createDefaultProject())).toBe(JSON.stringify(createDefaultProject()));
  });

  it("takes its timestamps and identity from the caller", () => {
    const stamped = createDefaultProject({ now: "2026-08-20T00:00:00.000Z", id: "prj-x", name: "N" });
    expect(stamped.createdAt).toBe("2026-08-20T00:00:00.000Z");
    expect(stamped.updatedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(stamped.id).toBe("prj-x");
    expect(stamped.name).toBe("N");
  });

  it("covers every voice kind the engine has to build", () => {
    expect(new Set(channels().map((channel) => channel.voice))).toEqual(new Set(VOICE_KINDS));
  });

  it("is internally consistent: every order id resolves", () => {
    for (const id of project.channelOrder) expect(project.channels[id]).toBeDefined();
    for (const id of project.patternOrder) expect(project.patterns[id]).toBeDefined();
    for (const id of project.playlistTrackOrder) expect(project.playlistTracks[id]).toBeDefined();
    for (const id of project.mixerTrackOrder) expect(project.mixerTracks[id]).toBeDefined();
  });
});
