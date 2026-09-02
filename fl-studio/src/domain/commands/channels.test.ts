import { describe, expect, it } from "vitest";

import { fixtureProject, roundTrip } from "../testKit";
import { MASTER_MIXER_TRACK_ID, type Channel, type Note } from "../types";
import { addChannel, moveChannel, removeChannel, updateChannel } from "./channels";
import { addNotes } from "./patterns";
import { CommandError } from "./types";

const newChannel: Channel = {
  id: "ch-new",
  name: "Perc",
  color: "hsl(200, 52%, 55%)",
  voice: "clap",
  volume: 0.8,
  pan: 0,
  muted: false,
  defaultStepPitch: 60,
  routedToMixerTrackId: MASTER_MIXER_TRACK_ID,
};

function note(id: string, channelId: string, positionTicks: number): Note {
  return { id, channelId, positionTicks, lengthTicks: 0, pitch: 60, velocity: 0.5 };
}

describe("addChannel", () => {
  it("appends the channel and its order entry", () => {
    const project = fixtureProject();
    const after = addChannel(newChannel).apply(project);
    expect(after.channels["ch-new"]).toEqual(newChannel);
    expect(after.channelOrder.at(-1)).toBe("ch-new");
    expect(after.channelOrder).toHaveLength(project.channelOrder.length + 1);
  });

  it("inserts at an index when given one", () => {
    const after = addChannel(newChannel, 1).apply(fixtureProject());
    expect(after.channelOrder[1]).toBe("ch-new");
  });

  it("round-trips through its inverse", () => {
    const { before, restored } = roundTrip(fixtureProject(), addChannel(newChannel, 2));
    expect(restored).toEqual(before);
  });

  it("refuses a duplicate id", () => {
    const project = fixtureProject();
    expect(() => addChannel({ ...newChannel, id: "ch-kick" }).apply(project)).toThrow(CommandError);
  });

  it("does not mutate the project it was given", () => {
    const project = fixtureProject();
    const snapshot = JSON.stringify(project);
    addChannel(newChannel).apply(project);
    expect(JSON.stringify(project)).toBe(snapshot);
  });
});

describe("removeChannel", () => {
  it("cascades note deletion across every pattern", () => {
    let project = fixtureProject();
    const secondPattern = {
      ...project,
      patterns: {
        ...project.patterns,
        "pat-2": { id: "pat-2", name: "Pattern 2", color: "#fff", notes: {} },
      },
      patternOrder: [...project.patternOrder, "pat-2"],
    };
    project = addNotes("pat-1", [note("n1", "ch-kick", 0), note("n2", "ch-clap", 24)]).apply(
      secondPattern,
    );
    project = addNotes("pat-2", [note("n3", "ch-kick", 48)]).apply(project);

    const after = removeChannel("ch-kick").apply(project);

    expect(after.channels["ch-kick"]).toBeUndefined();
    expect(after.channelOrder).not.toContain("ch-kick");
    expect(Object.keys(after.patterns["pat-1"]!.notes)).toEqual(["n2"]);
    expect(after.patterns["pat-2"]!.notes).toEqual({});
  });

  it("restores the channel, its row position and every deleted note in one undo", () => {
    let project = fixtureProject();
    project = {
      ...project,
      patterns: {
        ...project.patterns,
        "pat-2": { id: "pat-2", name: "Pattern 2", color: "#fff", notes: {} },
      },
      patternOrder: [...project.patternOrder, "pat-2"],
    };
    project = addNotes("pat-1", [note("n1", "ch-clap", 0)]).apply(project);
    project = addNotes("pat-2", [note("n2", "ch-clap", 96)]).apply(project);

    const { before, restored } = roundTrip(project, removeChannel("ch-clap"));
    expect(restored).toEqual(before);
    expect(restored.channelOrder.indexOf("ch-clap")).toBe(before.channelOrder.indexOf("ch-clap"));
  });

  it("leaves other channels' notes untouched", () => {
    const project = addNotes("pat-1", [note("n1", "ch-kick", 0), note("n2", "ch-snare", 96)]).apply(
      fixtureProject(),
    );
    const after = removeChannel("ch-kick").apply(project);
    expect(after.patterns["pat-1"]!.notes["n2"]).toEqual(note("n2", "ch-snare", 96));
  });

  it("throws for an unknown channel", () => {
    expect(() => removeChannel("nope").apply(fixtureProject())).toThrow(CommandError);
  });
});

describe("updateChannel", () => {
  it("applies a partial patch and inverts only the patched keys", () => {
    const project = fixtureProject();
    const { before, after, restored } = roundTrip(
      project,
      updateChannel("ch-kick", { volume: 0.3, muted: true }),
    );
    expect(after.channels["ch-kick"]!.volume).toBe(0.3);
    expect(after.channels["ch-kick"]!.muted).toBe(true);
    expect(after.channels["ch-kick"]!.name).toBe("Kick");
    expect(restored).toEqual(before);
  });

  it("round-trips a re-route to another mixer strip", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updateChannel("ch-snare", { routedToMixerTrackId: "mix-3" }),
    );
    expect(after.channels["ch-snare"]!.routedToMixerTrackId).toBe("mix-3");
    expect(restored).toEqual(before);
  });

  it("sets a choke group on a channel that had none, and takes it back", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updateChannel("ch-snare", { chokeGroup: "hats" }),
    );
    expect(after.channels["ch-snare"]!.chokeGroup).toBe("hats");
    expect(restored).toEqual(before);
    expect("chokeGroup" in restored.channels["ch-snare"]!).toBe(false);
  });

  it("clears a choke group with an explicit undefined, and restores it", () => {
    const { before, after, restored } = roundTrip(
      fixtureProject(),
      updateChannel("ch-hat-open", { chokeGroup: undefined }),
    );
    expect("chokeGroup" in after.channels["ch-hat-open"]!).toBe(false);
    expect(restored.channels["ch-hat-open"]!.chokeGroup).toBe("hats");
    expect(restored).toEqual(before);
  });

  it("throws for an unknown channel", () => {
    expect(() => updateChannel("nope", { pan: 1 }).apply(fixtureProject())).toThrow(CommandError);
  });
});

describe("moveChannel", () => {
  it("reorders rows and inverts back to the original index", () => {
    const project = fixtureProject();
    const { before, after, restored } = roundTrip(project, moveChannel("ch-kick", 3));
    expect(after.channelOrder.indexOf("ch-kick")).toBe(3);
    expect(after.channelOrder).toHaveLength(before.channelOrder.length);
    expect(restored.channelOrder).toEqual(before.channelOrder);
  });

  it("clamps an out-of-range index to the end", () => {
    const after = moveChannel("ch-kick", 99).apply(fixtureProject());
    expect(after.channelOrder.at(-1)).toBe("ch-kick");
  });
});
