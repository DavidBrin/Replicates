import { beforeEach, describe, expect, it } from "vitest";

import { nextId, peekIdCounter, reseedIds, resetIds } from "./ids";
import { addNotes } from "./commands/patterns";
import { fixtureProject } from "./testKit";

beforeEach(() => {
  resetIds(0);
});

describe("nextId", () => {
  it("mints prefixed, monotonic, unique ids", () => {
    expect(nextId("note")).toBe("n-1");
    expect(nextId("note")).toBe("n-2");
    expect(nextId("channel")).toBe("ch-3");
    expect(peekIdCounter()).toBe(3);
  });

  it("never repeats across a thousand mints", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => nextId("clip")));
    expect(ids.size).toBe(1000);
  });
});

describe("reseedIds", () => {
  it("pushes the counter past every numeric id in a loaded project", () => {
    const project = addNotes("pat-1", [
      { id: "n-97", channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 1 },
    ]).apply(fixtureProject());

    reseedIds(project);
    expect(nextId("note")).toBe("n-98");
  });

  it("never lowers the counter", () => {
    resetIds(500);
    reseedIds(fixtureProject());
    expect(peekIdCounter()).toBe(500);
  });

  it("ignores ids with no numeric suffix, and reads the ones that have one", () => {
    // The default project mixes literal ids ("ch-kick", which must be skipped
    // rather than parsed as NaN) with suffixed ones ("mix-8", the highest).
    reseedIds(fixtureProject());
    expect(peekIdCounter()).toBe(8);
    expect(nextId("channel")).toBe("ch-9");
  });

  it("makes a fresh id collision-free against a reloaded project", () => {
    let project = fixtureProject();
    resetIds(0);
    const first = nextId("note");
    project = addNotes("pat-1", [
      { id: first, channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 1 },
    ]).apply(project);

    resetIds(0); // as if the page had reloaded
    reseedIds(project);
    expect(nextId("note")).not.toBe(first);
    expect(project.patterns["pat-1"]!.notes[nextId("note")]).toBeUndefined();
  });
});
