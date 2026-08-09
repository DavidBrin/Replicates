import { describe, expect, it } from "vitest";
import { compareRows, evaluateFilter, resolveView } from "./view-engine";
import { createDemoSnapshot, SEED_IDS } from "../seed/demo-workspace";
import type { Page, PropertySchema, SortRule } from "../model/types";

const snapshot = createDemoSnapshot();
const database = snapshot.databases[SEED_IDS.databaseId];
const users = snapshot.users;

function viewFor(overrides: Partial<(typeof snapshot.views)[string]> = {}) {
  return { ...snapshot.views[SEED_IDS.views.board], ...overrides };
}

describe("resolveView", () => {
  it("returns every non-trashed row when no filters are set", () => {
    const { rows } = resolveView({ database, view: viewFor(), pages: snapshot.pages, users });
    expect(rows).toHaveLength(database.rowIds.length);
  });

  it("excludes trashed rows", () => {
    const pages = {
      ...snapshot.pages,
      [database.rowIds[0]]: { ...snapshot.pages[database.rowIds[0]], inTrash: true },
    };
    const { rows } = resolveView({ database, view: viewFor(), pages, users });
    expect(rows).toHaveLength(database.rowIds.length - 1);
    expect(rows.map((r) => r.id)).not.toContain(database.rowIds[0]);
  });

  it("builds one group per status option, in schema order", () => {
    const { groups } = resolveView({ database, view: viewFor(), pages: snapshot.pages, users });
    expect(groups.map((g) => g.name)).toEqual([
      "Not started",
      "Blocked",
      "In progress",
      "In review",
      "Done",
    ]);
  });

  it("places every row in exactly one group", () => {
    const { rows, groups } = resolveView({
      database,
      view: viewFor(),
      pages: snapshot.pages,
      users,
    });
    const grouped = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(grouped).toHaveLength(rows.length);
    expect(new Set(grouped).size).toBe(rows.length);
  });

  it("drops empty groups only when hideEmptyGroups is set", () => {
    const shown = resolveView({
      database,
      view: viewFor({ hideEmptyGroups: false }),
      pages: snapshot.pages,
      users,
    });
    const hidden = resolveView({
      database,
      view: viewFor({ hideEmptyGroups: true }),
      pages: snapshot.pages,
      users,
    });
    expect(hidden.groups.every((g) => g.rows.length > 0)).toBe(true);
    expect(hidden.groups.length).toBeLessThanOrEqual(shown.groups.length);
  });

  it("derives person groups from the rows rather than a fixed option list", () => {
    const { groups } = resolveView({
      database,
      view: viewFor({
        groupByPropertyId: SEED_IDS.properties.assignee,
        hideEmptyGroups: true,
      }),
      pages: snapshot.pages,
      users,
    });
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((g) => g.name)).toContain("David Brin");
  });

  it("filters by contains against the plain-text projection", () => {
    const { rows } = resolveView({
      database,
      view: viewFor({
        filters: [
          {
            id: "f1",
            propertyId: SEED_IDS.properties.name,
            operator: "contains",
            value: "compliance",
          },
        ],
      }),
      pages: snapshot.pages,
      users,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("compliance");
  });

  it("ignores a filter whose property no longer exists", () => {
    const { rows } = resolveView({
      database,
      view: viewFor({
        filters: [
          { id: "f1", propertyId: "prop-deleted", operator: "equals", value: "anything" },
        ],
      }),
      pages: snapshot.pages,
      users,
    });
    expect(rows).toHaveLength(database.rowIds.length);
  });
});

describe("evaluateFilter", () => {
  const schema = database.properties.find((p) => p.id === SEED_IDS.properties.effort)!;
  const row = snapshot.pages[database.rowIds[0]];
  const ctx = { users };

  it("treats a missing schema as a no-op rather than a failure", () => {
    const result = evaluateFilter(
      { id: "f", propertyId: "nope", operator: "equals", value: "x" },
      row,
      undefined,
      ctx,
    );
    expect(result).toBe(true);
  });

  it("supports is_empty and is_not_empty as exact inverses", () => {
    const empty = evaluateFilter(
      { id: "f", propertyId: schema.id, operator: "is_empty" },
      row,
      schema,
      ctx,
    );
    const notEmpty = evaluateFilter(
      { id: "f", propertyId: schema.id, operator: "is_not_empty" },
      row,
      schema,
      ctx,
    );
    expect(empty).toBe(!notEmpty);
  });
});

describe("compareRows", () => {
  const schemas = new Map<string, PropertySchema>(database.properties.map((p) => [p.id, p]));
  const ctx = { users };

  const rowWith = (id: string, effort: number | null): Page => ({
    ...snapshot.pages[database.rowIds[0]],
    id,
    properties: {
      ...snapshot.pages[database.rowIds[0]].properties,
      [SEED_IDS.properties.effort]: { type: "number", number: effort },
    },
  });

  const ascending: SortRule[] = [
    { id: "s", propertyId: SEED_IDS.properties.effort, direction: "ascending" },
  ];
  const descending: SortRule[] = [
    { id: "s", propertyId: SEED_IDS.properties.effort, direction: "descending" },
  ];

  it("orders numbers numerically, not lexicographically", () => {
    const rows = [rowWith("a", 13), rowWith("b", 2), rowWith("c", 8)];
    rows.sort((x, y) => compareRows(x, y, ascending, schemas, ctx));
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sinks blanks in both directions", () => {
    const rows = [rowWith("blank", null), rowWith("a", 5), rowWith("b", 1)];

    const asc = [...rows].sort((x, y) => compareRows(x, y, ascending, schemas, ctx));
    expect(asc.at(-1)!.id).toBe("blank");

    const desc = [...rows].sort((x, y) => compareRows(x, y, descending, schemas, ctx));
    expect(desc.at(-1)!.id).toBe("blank");
  });
});
