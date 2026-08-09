/**
 * Property type system.
 *
 * Every Notion column type is expressed as a subclass of `PropertyTypeHandler`.
 * The rest of the app never switches on `property.type` — it looks the handler
 * up in the registry and asks it questions. Adding a new column type (formula,
 * relation, rollup…) therefore means adding one class and one registry entry,
 * with no edits to the table, board, list or calendar renderers.
 */

import type {
  NotionColor,
  PropertySchema,
  PropertyType,
  PropertyValue,
  SelectOption,
  StatusOption,
  User,
} from "./types";

/** Context a handler may need to render or compare a value. */
export interface PropertyContext {
  users: Record<string, User>;
  locale?: string;
}

/** Narrows a schema to the variant matching a given type. */
export type SchemaOf<T extends PropertyType> = Extract<PropertySchema, { type: T }>;
export type ValueOf<T extends PropertyType> = Extract<PropertyValue, { type: T }>;

/**
 * Base class for a column type.
 *
 * Subclasses supply the empty value, a sort key, a plain-text projection used
 * by search and filters, and the metadata the UI needs (icon name, whether the
 * column can group a board, whether it is editable).
 */
export abstract class PropertyTypeHandler<T extends PropertyType = PropertyType> {
  /** The discriminator this handler serves. */
  abstract readonly type: T;
  /** Human label shown in the "add a property" menu. */
  abstract readonly label: string;
  /** lucide-react icon name; resolved by the icon registry at render time. */
  abstract readonly icon: string;

  /** Can a board or calendar group rows by this column? */
  readonly canGroup: boolean = false;
  /** Can the user type into this column, or is it derived? */
  readonly isEditable: boolean = true;
  /** Should the table view right-align the cell? */
  readonly alignEnd: boolean = false;

  /** The value a freshly created row gets for this column. */
  abstract empty(schema: SchemaOf<T>): ValueOf<T>;

  /** Plain text used for search, filtering and CSV-style export. */
  abstract toPlainText(
    value: ValueOf<T> | undefined,
    schema: SchemaOf<T>,
    ctx: PropertyContext,
  ): string;

  /** True when the cell should be treated as blank. */
  isEmpty(value: ValueOf<T> | undefined, schema: SchemaOf<T>, ctx: PropertyContext): boolean {
    return this.toPlainText(value, schema, ctx).trim() === "";
  }

  /**
   * Comparable sort key. Numbers sort numerically, everything else
   * lexicographically; `null` always sorts last regardless of direction.
   */
  sortKey(
    value: ValueOf<T> | undefined,
    schema: SchemaOf<T>,
    ctx: PropertyContext,
  ): string | number | null {
    const text = this.toPlainText(value, schema, ctx);
    return text === "" ? null : text.toLowerCase();
  }

  /**
   * The group a row belongs to for board/calendar grouping, or `null` for the
   * "No <property>" bucket. Only meaningful when `canGroup` is true.
   */
  groupKey(value: ValueOf<T> | undefined): string | null {
    void value;
    return null;
  }

  /** The set of groups a board should render, in column order. */
  groupOptions(schema: SchemaOf<T>): SelectOption[] {
    void schema;
    return [];
  }

  /** Builds the value that assigns a row to `groupId`. Used by board DnD. */
  valueForGroup(groupId: string | null, schema: SchemaOf<T>): ValueOf<T> {
    void groupId;
    return this.empty(schema);
  }
}

/* -------------------------------------------------------------- handlers -- */

class TitleHandler extends PropertyTypeHandler<"title"> {
  readonly type = "title" as const;
  readonly label = "Title";
  readonly icon = "Type";

  empty(): ValueOf<"title"> {
    return { type: "title", title: "" };
  }

  toPlainText(value: ValueOf<"title"> | undefined): string {
    return value?.title ?? "";
  }
}

class RichTextHandler extends PropertyTypeHandler<"rich_text"> {
  readonly type = "rich_text" as const;
  readonly label = "Text";
  readonly icon = "AlignLeft";

  empty(): ValueOf<"rich_text"> {
    return { type: "rich_text", rich_text: "" };
  }

  toPlainText(value: ValueOf<"rich_text"> | undefined): string {
    return value?.rich_text ?? "";
  }
}

const NUMBER_PREFIX: Record<string, string> = { dollar: "$", euro: "€" };

class NumberHandler extends PropertyTypeHandler<"number"> {
  readonly type = "number" as const;
  readonly label = "Number";
  readonly icon = "Hash";
  readonly alignEnd = true;

  empty(): ValueOf<"number"> {
    return { type: "number", number: null };
  }

  toPlainText(value: ValueOf<"number"> | undefined, schema: SchemaOf<"number">): string {
    const n = value?.number;
    if (n === null || n === undefined) return "";
    if (schema.format === "percent") return `${n}%`;
    const prefix = NUMBER_PREFIX[schema.format] ?? "";
    return `${prefix}${n.toLocaleString()}`;
  }

  sortKey(value: ValueOf<"number"> | undefined): number | null {
    return value?.number ?? null;
  }
}

class SelectHandler extends PropertyTypeHandler<"select"> {
  readonly type = "select" as const;
  readonly label = "Select";
  readonly icon = "ChevronDownCircle";
  readonly canGroup = true;

  empty(): ValueOf<"select"> {
    return { type: "select", select: null };
  }

  toPlainText(value: ValueOf<"select"> | undefined, schema: SchemaOf<"select">): string {
    return schema.options.find((o) => o.id === value?.select)?.name ?? "";
  }

  groupKey(value: ValueOf<"select"> | undefined): string | null {
    return value?.select ?? null;
  }

  groupOptions(schema: SchemaOf<"select">): SelectOption[] {
    return schema.options;
  }

  valueForGroup(groupId: string | null): ValueOf<"select"> {
    return { type: "select", select: groupId };
  }
}

class MultiSelectHandler extends PropertyTypeHandler<"multi_select"> {
  readonly type = "multi_select" as const;
  readonly label = "Multi-select";
  readonly icon = "List";

  empty(): ValueOf<"multi_select"> {
    return { type: "multi_select", multi_select: [] };
  }

  toPlainText(
    value: ValueOf<"multi_select"> | undefined,
    schema: SchemaOf<"multi_select">,
  ): string {
    const byId = new Map(schema.options.map((o) => [o.id, o.name]));
    return (value?.multi_select ?? []).map((id) => byId.get(id) ?? "").filter(Boolean).join(", ");
  }
}

class StatusHandler extends PropertyTypeHandler<"status"> {
  readonly type = "status" as const;
  readonly label = "Status";
  readonly icon = "LoaderCircle";
  readonly canGroup = true;

  empty(schema: SchemaOf<"status">): ValueOf<"status"> {
    // Notion defaults a new row to the first "to-do" option.
    const first = schema.options.find((o) => o.group === "to-do") ?? schema.options[0];
    return { type: "status", status: first?.id ?? null };
  }

  toPlainText(value: ValueOf<"status"> | undefined, schema: SchemaOf<"status">): string {
    return schema.options.find((o) => o.id === value?.status)?.name ?? "";
  }

  groupKey(value: ValueOf<"status"> | undefined): string | null {
    return value?.status ?? null;
  }

  groupOptions(schema: SchemaOf<"status">): StatusOption[] {
    return schema.options;
  }

  valueForGroup(groupId: string | null): ValueOf<"status"> {
    return { type: "status", status: groupId };
  }
}

class PeopleHandler extends PropertyTypeHandler<"people"> {
  readonly type = "people" as const;
  readonly label = "Person";
  readonly icon = "Users";
  readonly canGroup = true;

  empty(): ValueOf<"people"> {
    return { type: "people", people: [] };
  }

  toPlainText(
    value: ValueOf<"people"> | undefined,
    _schema: SchemaOf<"people">,
    ctx: PropertyContext,
  ): string {
    return (value?.people ?? [])
      .map((id) => ctx.users[id]?.name ?? "")
      .filter(Boolean)
      .join(", ");
  }

  /** Board grouping by person uses the first assignee, as Notion does. */
  groupKey(value: ValueOf<"people"> | undefined): string | null {
    return value?.people?.[0] ?? null;
  }

  valueForGroup(groupId: string | null): ValueOf<"people"> {
    return { type: "people", people: groupId ? [groupId] : [] };
  }
}

class DateHandler extends PropertyTypeHandler<"date"> {
  readonly type = "date" as const;
  readonly label = "Date";
  readonly icon = "Calendar";

  empty(): ValueOf<"date"> {
    return { type: "date", date: null };
  }

  toPlainText(value: ValueOf<"date"> | undefined): string {
    const d = value?.date;
    if (!d) return "";
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    return d.end ? `${fmt(d.start)} → ${fmt(d.end)}` : fmt(d.start);
  }

  sortKey(value: ValueOf<"date"> | undefined): number | null {
    return value?.date ? new Date(value.date.start).getTime() : null;
  }
}

class CheckboxHandler extends PropertyTypeHandler<"checkbox"> {
  readonly type = "checkbox" as const;
  readonly label = "Checkbox";
  readonly icon = "SquareCheck";

  empty(): ValueOf<"checkbox"> {
    return { type: "checkbox", checkbox: false };
  }

  toPlainText(value: ValueOf<"checkbox"> | undefined): string {
    return value?.checkbox ? "Yes" : "No";
  }

  /** A checkbox is never "empty" — false is a real value. */
  isEmpty(): boolean {
    return false;
  }

  sortKey(value: ValueOf<"checkbox"> | undefined): number {
    return value?.checkbox ? 1 : 0;
  }
}

class UrlHandler extends PropertyTypeHandler<"url"> {
  readonly type = "url" as const;
  readonly label = "URL";
  readonly icon = "Link";

  empty(): ValueOf<"url"> {
    return { type: "url", url: "" };
  }

  toPlainText(value: ValueOf<"url"> | undefined): string {
    return value?.url ?? "";
  }
}

class EmailHandler extends PropertyTypeHandler<"email"> {
  readonly type = "email" as const;
  readonly label = "Email";
  readonly icon = "AtSign";

  empty(): ValueOf<"email"> {
    return { type: "email", email: "" };
  }

  toPlainText(value: ValueOf<"email"> | undefined): string {
    return value?.email ?? "";
  }
}

/** Shared behaviour for the two derived timestamp columns. */
abstract class TimestampHandler<
  T extends "created_time" | "last_edited_time",
> extends PropertyTypeHandler<T> {
  readonly isEditable = false;
  readonly icon = "Clock";

  protected abstract read(value: ValueOf<T> | undefined): string | undefined;

  toPlainText(value: ValueOf<T> | undefined): string {
    const iso = this.read(value);
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  sortKey(value: ValueOf<T> | undefined): number | null {
    const iso = this.read(value);
    return iso ? new Date(iso).getTime() : null;
  }
}

class CreatedTimeHandler extends TimestampHandler<"created_time"> {
  readonly type = "created_time" as const;
  readonly label = "Created time";

  empty(): ValueOf<"created_time"> {
    return { type: "created_time", created_time: new Date().toISOString() };
  }

  protected read(value: ValueOf<"created_time"> | undefined) {
    return value?.created_time;
  }
}

class LastEditedTimeHandler extends TimestampHandler<"last_edited_time"> {
  readonly type = "last_edited_time" as const;
  readonly label = "Last edited time";

  empty(): ValueOf<"last_edited_time"> {
    return { type: "last_edited_time", last_edited_time: new Date().toISOString() };
  }

  protected read(value: ValueOf<"last_edited_time"> | undefined) {
    return value?.last_edited_time;
  }
}

/* -------------------------------------------------------------- registry -- */

const HANDLERS = [
  new TitleHandler(),
  new RichTextHandler(),
  new NumberHandler(),
  new SelectHandler(),
  new MultiSelectHandler(),
  new StatusHandler(),
  new PeopleHandler(),
  new DateHandler(),
  new CheckboxHandler(),
  new UrlHandler(),
  new EmailHandler(),
  new CreatedTimeHandler(),
  new LastEditedTimeHandler(),
] as const;

const REGISTRY = new Map<PropertyType, PropertyTypeHandler>(
  HANDLERS.map((h) => [h.type, h as unknown as PropertyTypeHandler]),
);

/** Looks up the handler for a column type. Throws on an unregistered type. */
export function getPropertyHandler<T extends PropertyType>(
  type: T,
): PropertyTypeHandler<T> {
  const handler = REGISTRY.get(type);
  if (!handler) throw new Error(`No handler registered for property type "${type}"`);
  // The map is keyed by the handler's own `type`, so this narrowing is sound;
  // TypeScript cannot express "the value whose discriminant equals the key".
  return handler as unknown as PropertyTypeHandler<T>;
}

/** Every registered handler, in the order the "add a property" menu shows them. */
export function listPropertyHandlers(): readonly PropertyTypeHandler[] {
  return HANDLERS as unknown as readonly PropertyTypeHandler[];
}

/** Convenience: plain text for any value without narrowing the union by hand. */
export function propertyToPlainText(
  schema: PropertySchema,
  value: PropertyValue | undefined,
  ctx: PropertyContext,
): string {
  const handler = getPropertyHandler(schema.type);
  return handler.toPlainText(
    value as never,
    schema as never,
    ctx,
  );
}

/** The colour a value should paint with, when the type carries one. */
export function propertyColor(
  schema: PropertySchema,
  value: PropertyValue | undefined,
): NotionColor | null {
  if (schema.type === "select" && value?.type === "select") {
    return schema.options.find((o) => o.id === value.select)?.color ?? null;
  }
  if (schema.type === "status" && value?.type === "status") {
    return schema.options.find((o) => o.id === value.status)?.color ?? null;
  }
  return null;
}
