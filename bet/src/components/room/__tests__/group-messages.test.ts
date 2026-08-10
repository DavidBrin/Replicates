import { describe, expect, it } from "vitest";
import { buildRoomTimeline, mergeRoomEntries, type RoomEntry } from "../group-messages";

const NOW = new Date("2026-08-09T18:00:00.000Z");

function entry(partial: Partial<RoomEntry> & Pick<RoomEntry, "id" | "at">): RoomEntry {
  return { authorId: "u1", kind: "text", body: "hi", ...partial };
}

describe("buildRoomTimeline", () => {
  it("inserts exactly one day separator per calendar day, labeled Today for now's day", () => {
    const items = buildRoomTimeline(
      [entry({ id: "1", at: "2026-08-09T10:00:00.000Z" }), entry({ id: "2", at: "2026-08-09T10:01:00.000Z" })],
      NOW,
    );
    const separators = items.filter((i) => i.type === "separator");
    expect(separators).toHaveLength(1);
    expect(separators[0]).toMatchObject({ label: "Today" });
  });

  it("labels the prior calendar day Yesterday", () => {
    const items = buildRoomTimeline([entry({ id: "1", at: "2026-08-08T10:00:00.000Z" })], NOW);
    expect(items[0]).toMatchObject({ type: "separator", label: "Yesterday" });
  });

  it("groups consecutive same-author text messages within the group gap into one group", () => {
    const items = buildRoomTimeline(
      [
        entry({ id: "1", authorId: "maya", at: "2026-08-09T10:00:00.000Z" }),
        entry({ id: "2", authorId: "maya", at: "2026-08-09T10:02:00.000Z" }),
        entry({ id: "3", authorId: "maya", at: "2026-08-09T10:04:00.000Z" }),
      ],
      NOW,
    );
    const groups = items.filter((i) => i.type === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ authorId: "maya" });
    expect((groups[0] as Extract<(typeof items)[number], { type: "group" }>).entries).toHaveLength(3);
  });

  it("splits into a new group when the gap between same-author messages exceeds GROUP_GAP_MS", () => {
    const items = buildRoomTimeline(
      [
        entry({ id: "1", authorId: "maya", at: "2026-08-09T10:00:00.000Z" }),
        entry({ id: "2", authorId: "maya", at: "2026-08-09T10:10:00.000Z" }), // 10 min later > 5 min gap
      ],
      NOW,
    );
    const groups = items.filter((i) => i.type === "group");
    expect(groups).toHaveLength(2);
  });

  it("splits into a new group when the author changes", () => {
    const items = buildRoomTimeline(
      [
        entry({ id: "1", authorId: "maya", at: "2026-08-09T10:00:00.000Z" }),
        entry({ id: "2", authorId: "dev", at: "2026-08-09T10:01:00.000Z" }),
      ],
      NOW,
    );
    const groups = items.filter((i) => i.type === "group");
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => (g.type === "group" ? g.authorId : null))).toEqual(["maya", "dev"]);
  });

  it("renders a system message as its own timeline item, never inside a group (inline chip, not a bubble)", () => {
    const items = buildRoomTimeline(
      [
        entry({ id: "1", authorId: "maya", at: "2026-08-09T10:00:00.000Z" }),
        entry({ id: "2", kind: "system", authorId: null, body: "dev bought 40 No @ 29¢", at: "2026-08-09T10:01:00.000Z" }),
        entry({ id: "3", authorId: "maya", at: "2026-08-09T10:02:00.000Z" }),
      ],
      NOW,
    );
    expect(items.map((i) => i.type)).toEqual(["separator", "group", "system", "group"]);
    const system = items.find((i) => i.type === "system");
    expect(system).toMatchObject({ entry: { body: "dev bought 40 No @ 29¢" } });
  });
});

describe("mergeRoomEntries", () => {
  it("replaces a pending optimistic entry with the real one once the server echoes its clientId", () => {
    const pending: RoomEntry = {
      id: "client-abc",
      authorId: "dev",
      kind: "text",
      body: "taking No",
      at: "2026-08-09T10:00:00.000Z",
      pending: true,
    };
    const real: RoomEntry = {
      id: "msg_real1",
      authorId: "dev",
      kind: "text",
      body: "taking No",
      at: "2026-08-09T10:00:01.000Z",
      clientId: "client-abc",
    };
    const merged = mergeRoomEntries([pending], [real]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(real);
  });

  it("deduplicates the same real message appearing across two poll batches", () => {
    const msg: RoomEntry = { id: "msg_1", authorId: "maya", kind: "text", body: "hey", at: "2026-08-09T10:00:00.000Z" };
    const merged = mergeRoomEntries([msg], [msg]);
    expect(merged).toHaveLength(1);
  });

  it("sorts the merged result ascending by time", () => {
    const a: RoomEntry = { id: "1", authorId: "u", kind: "text", body: "a", at: "2026-08-09T10:02:00.000Z" };
    const b: RoomEntry = { id: "2", authorId: "u", kind: "text", body: "b", at: "2026-08-09T10:00:00.000Z" };
    const merged = mergeRoomEntries([], [a, b]);
    expect(merged.map((m) => m.id)).toEqual(["2", "1"]);
  });

  it("leaves an unrelated pending entry alone when a different message arrives", () => {
    const pending: RoomEntry = {
      id: "client-xyz",
      authorId: "dev",
      kind: "text",
      body: "still sending",
      at: "2026-08-09T10:00:00.000Z",
      pending: true,
    };
    const other: RoomEntry = { id: "msg_2", authorId: "maya", kind: "text", body: "hi", at: "2026-08-09T10:00:01.000Z" };
    const merged = mergeRoomEntries([pending], [other]);
    expect(merged).toHaveLength(2);
    expect(merged.some((m) => m.pending)).toBe(true);
  });
});
