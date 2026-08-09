import { describe, expect, it } from "vitest";
import {
  getPropertyHandler,
  listPropertyHandlers,
  propertyColor,
  propertyToPlainText,
} from "./property-types";
import { PROPERTY_TYPES, type PropertySchema, type User } from "./types";

const ctx = {
  users: {
    "user-a": { id: "user-a", name: "Ada Lovelace", email: "ada@x.io", color: "blue" },
  } as Record<string, User>,
};

describe("the handler registry", () => {
  it("registers exactly one handler per declared property type", () => {
    const registered = listPropertyHandlers().map((h) => h.type).sort();
    expect(registered).toEqual([...PROPERTY_TYPES].sort());
  });

  it("throws loudly rather than silently rendering nothing for an unknown type", () => {
    // @ts-expect-error — deliberately probing the runtime guard.
    expect(() => getPropertyHandler("relation")).toThrow(/No handler registered/);
  });

  it("marks only the groupable types as groupable", () => {
    const groupable = listPropertyHandlers()
      .filter((h) => h.canGroup)
      .map((h) => h.type)
      .sort();
    expect(groupable).toEqual(["people", "select", "status"]);
  });

  it("marks the derived timestamps as not editable", () => {
    const readOnly = listPropertyHandlers()
      .filter((h) => !h.isEditable)
      .map((h) => h.type)
      .sort();
    expect(readOnly).toEqual(["created_time", "last_edited_time"]);
  });

  it("gives every type an empty value that round-trips to blank text", () => {
    for (const handler of listPropertyHandlers()) {
      const schema = schemaFor(handler.type);
      const empty = handler.empty(schema as never);
      expect(empty.type).toBe(handler.type);
    }
  });
});

describe("status", () => {
  const schema: PropertySchema = {
    id: "p",
    name: "Status",
    type: "status",
    options: [
      { id: "s1", name: "Not started", color: "default", group: "to-do" },
      { id: "s2", name: "In progress", color: "blue", group: "in-progress" },
      { id: "s3", name: "Done", color: "green", group: "complete" },
    ],
  };

  it("defaults a new row to the first to-do option, as Notion does", () => {
    const handler = getPropertyHandler("status");
    expect(handler.empty(schema as never)).toEqual({ type: "status", status: "s1" });
  });

  it("maps a value to its option colour", () => {
    expect(propertyColor(schema, { type: "status", status: "s2" })).toBe("blue");
  });

  it("round-trips a group id through valueForGroup and groupKey", () => {
    const handler = getPropertyHandler("status");
    const value = handler.valueForGroup("s3", schema as never);
    expect(handler.groupKey(value)).toBe("s3");
  });
});

describe("checkbox", () => {
  const schema: PropertySchema = { id: "p", name: "Done", type: "checkbox" };

  it("never reports as empty, because false is a real value", () => {
    const handler = getPropertyHandler("checkbox");
    expect(handler.isEmpty({ type: "checkbox", checkbox: false }, schema, ctx)).toBe(false);
    expect(handler.isEmpty(undefined, schema, ctx)).toBe(false);
  });

  it("sorts unchecked before checked", () => {
    const handler = getPropertyHandler("checkbox");
    const off = handler.sortKey({ type: "checkbox", checkbox: false }, schema, ctx);
    const on = handler.sortKey({ type: "checkbox", checkbox: true }, schema, ctx);
    expect(Number(off)).toBeLessThan(Number(on));
  });

  it("renders as Yes or No", () => {
    expect(propertyToPlainText(schema, { type: "checkbox", checkbox: true }, ctx)).toBe("Yes");
    expect(propertyToPlainText(schema, { type: "checkbox", checkbox: false }, ctx)).toBe("No");
  });
});

describe("number", () => {
  it("applies the configured format", () => {
    const percent: PropertySchema = { id: "p", name: "n", type: "number", format: "percent" };
    const dollar: PropertySchema = { id: "p", name: "n", type: "number", format: "dollar" };
    expect(propertyToPlainText(percent, { type: "number", number: 25 }, ctx)).toBe("25%");
    expect(propertyToPlainText(dollar, { type: "number", number: 1200 }, ctx)).toBe("$1,200");
  });

  const numberSchema: PropertySchema = { id: "p", name: "n", type: "number", format: "number" };

  it("sorts by magnitude, not by string", () => {
    const handler = getPropertyHandler("number");
    const nine = handler.sortKey({ type: "number", number: 9 }, numberSchema, ctx);
    const ten = handler.sortKey({ type: "number", number: 10 }, numberSchema, ctx);
    expect(Number(nine)).toBeLessThan(Number(ten));
  });

  it("treats a null number as blank", () => {
    expect(propertyToPlainText(numberSchema, { type: "number", number: null }, ctx)).toBe("");
    expect(
      getPropertyHandler("number").sortKey({ type: "number", number: null }, numberSchema, ctx),
    ).toBeNull();
  });
});

describe("people", () => {
  const schema: PropertySchema = { id: "p", name: "Assignee", type: "people" };

  it("resolves ids to names through the context", () => {
    expect(propertyToPlainText(schema, { type: "people", people: ["user-a"] }, ctx)).toBe(
      "Ada Lovelace",
    );
  });

  it("groups by the first assignee", () => {
    const handler = getPropertyHandler("people");
    expect(handler.groupKey({ type: "people", people: ["user-a", "user-b"] })).toBe("user-a");
    expect(handler.groupKey({ type: "people", people: [] })).toBeNull();
  });
});

describe("date", () => {
  const schema: PropertySchema = { id: "p", name: "Due", type: "date" };

  it("renders a range with an arrow between the ends", () => {
    const text = propertyToPlainText(
      schema,
      { type: "date", date: { start: "2026-03-02", end: "2026-03-09" } },
      ctx,
    );
    expect(text).toContain("→");
  });

  it("sorts chronologically", () => {
    const handler = getPropertyHandler("date");
    const earlier = handler.sortKey({ type: "date", date: { start: "2026-01-01" } }, schema, ctx);
    const later = handler.sortKey({ type: "date", date: { start: "2026-06-01" } }, schema, ctx);
    expect(Number(earlier)).toBeLessThan(Number(later));
  });
});

/** Minimal valid schema for each type, so the registry sweep can run. */
function schemaFor(type: string): PropertySchema {
  switch (type) {
    case "number":
      return { id: "p", name: "n", type: "number", format: "number" };
    case "select":
    case "multi_select":
      return { id: "p", name: "n", type, options: [] } as PropertySchema;
    case "status":
      return { id: "p", name: "n", type: "status", options: [] };
    default:
      return { id: "p", name: "n", type } as PropertySchema;
  }
}
