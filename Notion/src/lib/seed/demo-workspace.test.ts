import { describe, expect, it } from "vitest";
import { createDemoSnapshot, SEED_IDS } from "./demo-workspace";
import { getPropertyHandler } from "../model/property-types";
import type { Id } from "../model/types";

/**
 * The demo workspace is the first thing anyone sees, so its integrity is a
 * product concern rather than a fixture detail. These tests assert the
 * referential invariants the UI relies on — a dangling id renders as a blank
 * row or a missing page rather than as an error, which is exactly the kind of
 * failure that survives a green build.
 */

const snapshot = createDemoSnapshot();
const DAY_MS = 86_400_000;

describe("referential integrity", () => {
  it("resolves every block's parent to a page or another block", () => {
    for (const block of Object.values(snapshot.blocks)) {
      const parentExists =
        Boolean(snapshot.pages[block.parentId]) || Boolean(snapshot.blocks[block.parentId]);
      expect(parentExists, `block ${block.id} has an unresolvable parent`).toBe(true);
    }
  });

  it("resolves every id a page lists as its content", () => {
    for (const page of Object.values(snapshot.pages)) {
      for (const blockId of page.blockIds) {
        expect(snapshot.blocks[blockId], `page ${page.id} references block ${blockId}`).toBeDefined();
      }
      for (const childId of page.childPageIds) {
        expect(snapshot.pages[childId], `page ${page.id} references page ${childId}`).toBeDefined();
      }
    }
  });

  it("resolves every page id listed in a sidebar section", () => {
    for (const section of snapshot.workspace.sections) {
      for (const pageId of section.pageIds) {
        expect(snapshot.pages[pageId], `section ${section.label} lists ${pageId}`).toBeDefined();
      }
    }
  });

  it("gives every database row a page that points back at the database", () => {
    for (const database of Object.values(snapshot.databases)) {
      for (const rowId of database.rowIds) {
        const row = snapshot.pages[rowId];
        expect(row, `row ${rowId} has no page`).toBeDefined();
        expect(row.databaseId).toBe(database.id);
      }
    }
  });

  it("gives every row a value for every column in its schema", () => {
    for (const database of Object.values(snapshot.databases)) {
      for (const rowId of database.rowIds) {
        const row = snapshot.pages[rowId];
        for (const schema of database.properties) {
          const value = row.properties?.[schema.id];
          expect(value, `row ${rowId} is missing ${schema.name}`).toBeDefined();
          // A mismatched discriminator renders as a permanently blank cell.
          expect(value!.type).toBe(schema.type);
        }
      }
    }
  });

  it("points every view at a real database, group-by and date property", () => {
    for (const view of Object.values(snapshot.views)) {
      const database = snapshot.databases[view.databaseId];
      expect(database, `view ${view.name} has no database`).toBeDefined();

      const ids = new Set(database.properties.map((p) => p.id));
      if (view.groupByPropertyId) expect(ids.has(view.groupByPropertyId)).toBe(true);
      if (view.datePropertyId) expect(ids.has(view.datePropertyId)).toBe(true);
      for (const propertyId of view.visiblePropertyIds) expect(ids.has(propertyId)).toBe(true);
    }
  });

  it("lists every view the database claims, and no orphans", () => {
    const claimed = new Set(Object.values(snapshot.databases).flatMap((d) => d.viewIds));
    expect(new Set(Object.keys(snapshot.views))).toEqual(claimed);
  });

  it("resolves every user referenced by a membership or a people value", () => {
    const known = new Set(Object.keys(snapshot.users));
    expect(known.has(snapshot.currentUserId)).toBe(true);

    for (const member of snapshot.workspace.members) {
      expect(known.has(member.userId), `member ${member.userId}`).toBe(true);
    }
    for (const page of Object.values(snapshot.pages)) {
      for (const value of Object.values(page.properties ?? {})) {
        if (value.type !== "people") continue;
        for (const userId of value.people) {
          expect(known.has(userId), `page ${page.id} assigns ${userId}`).toBe(true);
        }
      }
    }
  });

  it("points a child_database block at a database that exists", () => {
    const blocks = Object.values(snapshot.blocks).filter((b) => b.type === "child_database");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(snapshot.databases[block.targetId as Id]).toBeDefined();
    }
  });
});

describe("freshness", () => {
  /**
   * The calendar opens on the current month. When the demo data was pinned to
   * a fixed date it silently drifted into the past and the calendar rendered
   * an empty grid — a defect that no amount of logic testing would surface.
   */
  const database = snapshot.databases[SEED_IDS.databaseId];
  const dueDates = database.rowIds
    .map((id) => snapshot.pages[id].properties?.[SEED_IDS.properties.due])
    .flatMap((value) => (value?.type === "date" && value.date ? [value.date.start] : []))
    .map((iso) => Date.parse(iso));

  it("dates enough tasks inside the current month to fill the calendar", () => {
    const now = Date.now();
    const thisMonth = dueDates.filter((t) => Math.abs(t - now) < 16 * DAY_MS);
    expect(thisMonth.length).toBeGreaterThanOrEqual(5);
  });

  it("spreads work either side of today rather than bunching it", () => {
    const now = Date.now();
    expect(dueDates.some((t) => t < now)).toBe(true);
    expect(dueDates.some((t) => t > now)).toBe(true);
  });

  it("keeps edit timestamps recent so 'Edited …' does not read as stale", () => {
    const home = snapshot.pages[SEED_IDS.homePageId];
    const age = Date.now() - Date.parse(home.lastEditedAt);
    expect(Math.abs(age)).toBeLessThan(2 * DAY_MS);
  });
});

describe("board grouping", () => {
  it("puts at least one row in every status column", () => {
    const database = snapshot.databases[SEED_IDS.databaseId];
    const schema = database.properties.find((p) => p.id === SEED_IDS.properties.status);
    if (schema?.type !== "status") throw new Error("status column missing from the seed");

    const handler = getPropertyHandler("status");
    const counts = new Map<string | null, number>();
    for (const rowId of database.rowIds) {
      const key = handler.groupKey(
        snapshot.pages[rowId].properties?.[SEED_IDS.properties.status] as never,
      );
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // An empty column reads as a broken board on first impression.
    for (const option of schema.options) {
      expect(counts.get(option.id) ?? 0, `column "${option.name}" is empty`).toBeGreaterThan(0);
    }
  });
});
