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

/*
 * Round 8 #8. `Number.isFinite` accepts `9007199254740992` — one past
 * `MAX_SAFE_INTEGER`, where `n + 1 === n`. Seeding the counter there pinned it:
 * the first mint returned an id the project already held, the command threw
 * `CommandError` out of the handler, and every mint after it returned the same
 * id again.
 */
describe("reseedIds — only countable suffixes seed the counter (round 8 #8)", () => {
  function withNote(noteId: string) {
    return addNotes("pat-1", [
      { id: noteId, channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 1 },
    ]).apply(fixtureProject());
  }

  it("skips a suffix past MAX_SAFE_INTEGER rather than pinning the counter", () => {
    resetIds(0);
    reseedIds(withNote("n-9007199254740992"));

    // Skipped, so the counter still counts — and the ids it mints are new.
    const first = nextId("note");
    const second = nextId("note");
    expect(first).not.toBe(second);
    expect(peekIdCounter()).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("rejects MAX_SAFE_INTEGER itself — a seed with no headroom to increment", () => {
    resetIds(0);
    reseedIds(withNote(`n-${Number.MAX_SAFE_INTEGER}`));

    expect(peekIdCounter()).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(Number(nextId("note").slice(2)))).toBe(true);
  });

  it("skips rather than CLAMPS: an unusable suffix never lowers the counter", () => {
    resetIds(4_000);
    reseedIds(withNote("n-9007199254740993"));

    expect(peekIdCounter()).toBe(4_000);
  });

  it("still seeds from a large but safe suffix", () => {
    resetIds(0);
    reseedIds(withNote("n-9007199254740990"));

    expect(nextId("note")).toBe("n-9007199254740991");
  });
});
