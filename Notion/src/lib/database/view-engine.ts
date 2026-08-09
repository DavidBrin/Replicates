/**
 * View semantics: filtering, sorting and grouping.
 *
 * Pure functions over plain data — no React, no store, no DOM. Every view
 * component renders the output of `resolveView`, which means board, table,
 * list and calendar all agree on which rows they are showing and in what
 * order, and the tricky logic is testable without mounting anything.
 */

import type {
  Database,
  FilterRule,
  Id,
  NotionColor,
  Page,
  PropertySchema,
  PropertyValue,
  SelectOption,
  SortRule,
  User,
  View,
} from "../model/types";
import { getPropertyHandler, type PropertyContext } from "../model/property-types";

export interface ResolveInput {
  database: Database;
  view: View;
  pages: Record<Id, Page>;
  users: Record<Id, User>;
}

/** One board/calendar column. */
export interface RowGroup {
  /** Option id, or `null` for the "No <property>" bucket. */
  id: Id | null;
  name: string;
  color: NotionColor;
  rows: Page[];
}

export interface ResolvedView {
  rows: Page[];
  groups: RowGroup[];
  groupBy: PropertySchema | null;
}

/* --------------------------------------------------------------- filters -- */

export function evaluateFilter(
  rule: FilterRule,
  page: Page,
  schema: PropertySchema | undefined,
  ctx: PropertyContext,
): boolean {
  // A filter on a deleted column is inert rather than fatal.
  if (!schema) return true;

  const handler = getPropertyHandler(schema.type);
  const value = page.properties?.[rule.propertyId] as never;
  const text = handler.toPlainText(value, schema as never, ctx).toLowerCase();
  const target = String(rule.value ?? "").toLowerCase();

  switch (rule.operator) {
    case "equals":
      return text === target;
    case "does_not_equal":
      return text !== target;
    case "contains":
      return text.includes(target);
    case "does_not_contain":
      return !text.includes(target);
    case "is_empty":
      return handler.isEmpty(value, schema as never, ctx);
    case "is_not_empty":
      return !handler.isEmpty(value, schema as never, ctx);
    default:
      return true;
  }
}

/* ----------------------------------------------------------------- sorts -- */

export function compareRows(
  a: Page,
  b: Page,
  sorts: SortRule[],
  schemas: Map<Id, PropertySchema>,
  ctx: PropertyContext,
): number {
  for (const sort of sorts) {
    const schema = schemas.get(sort.propertyId);
    if (!schema) continue;

    const handler = getPropertyHandler(schema.type);
    const left = handler.sortKey(a.properties?.[sort.propertyId] as never, schema as never, ctx);
    const right = handler.sortKey(b.properties?.[sort.propertyId] as never, schema as never, ctx);

    // Blanks always sink, in both directions — matching Notion, and avoiding
    // the surprise of an empty column jumping to the top on a descending sort.
    if (left === null && right === null) continue;
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) continue;

    const order = left < right ? -1 : 1;
    return sort.direction === "ascending" ? order : -order;
  }
  return 0;
}

/* ---------------------------------------------------------------- groups -- */

const NO_VALUE_COLOR: NotionColor = "default";

function buildGroups(
  rows: Page[],
  schema: PropertySchema,
  users: Record<Id, User>,
  hideEmpty: boolean,
): RowGroup[] {
  const handler = getPropertyHandler(schema.type);

  // People grouping has no fixed option list — the columns are the members
  // who actually appear, so it is derived from the rows.
  const options: SelectOption[] =
    schema.type === "people"
      ? uniquePeople(rows, schema.id, users)
      : (handler.groupOptions(schema as never) as SelectOption[]);

  const byGroup = new Map<string | null, Page[]>();
  byGroup.set(null, []);
  options.forEach((option) => byGroup.set(option.id, []));

  for (const row of rows) {
    const key = handler.groupKey(row.properties?.[schema.id] as never);
    const bucket = byGroup.get(key ?? null);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }

  const groups: RowGroup[] = options.map((option) => ({
    id: option.id,
    name: option.name,
    color: option.color,
    rows: byGroup.get(option.id) ?? [],
  }));

  // Notion shows the "No <property>" column last, and only when non-empty.
  const ungrouped = byGroup.get(null) ?? [];
  if (ungrouped.length > 0) {
    groups.push({
      id: null,
      name: `No ${schema.name}`,
      color: NO_VALUE_COLOR,
      rows: ungrouped,
    });
  }

  return hideEmpty ? groups.filter((g) => g.rows.length > 0) : groups;
}

function uniquePeople(
  rows: Page[],
  propertyId: Id,
  users: Record<Id, User>,
): SelectOption[] {
  const seen = new Set<Id>();
  for (const row of rows) {
    const value = row.properties?.[propertyId];
    if (value?.type !== "people") continue;
    value.people.forEach((id) => seen.add(id));
  }
  return [...seen]
    .map((id) => users[id])
    .filter((user): user is User => Boolean(user))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((user) => ({ id: user.id, name: user.name, color: user.color }));
}

/* --------------------------------------------------------------- resolve -- */

/** Applies a view's filters, sorts and grouping to its database's rows. */
export function resolveView({ database, view, pages, users }: ResolveInput): ResolvedView {
  const ctx: PropertyContext = { users };
  const schemas = new Map(database.properties.map((p) => [p.id, p]));

  const rows = database.rowIds
    .map((id) => pages[id])
    .filter((page): page is Page => Boolean(page) && !page.inTrash)
    .filter((page) =>
      view.filters.every((rule) =>
        evaluateFilter(rule, page, schemas.get(rule.propertyId), ctx),
      ),
    );

  // Only sort when asked; the unsorted order is the user's manual row order,
  // which is meaningful and must be preserved.
  if (view.sorts.length > 0) {
    rows.sort((a, b) => compareRows(a, b, view.sorts, schemas, ctx));
  }

  const groupBy = view.groupByPropertyId ? (schemas.get(view.groupByPropertyId) ?? null) : null;
  const groups = groupBy
    ? buildGroups(rows, groupBy, users, view.hideEmptyGroups ?? false)
    : [];

  return { rows, groups, groupBy };
}

/** Plain-text search across every visible column — powers the view search box. */
export function matchesQuery(
  page: Page,
  database: Database,
  query: string,
  users: Record<Id, User>,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const ctx: PropertyContext = { users };
  return database.properties.some((schema) => {
    const handler = getPropertyHandler(schema.type);
    const value = page.properties?.[schema.id] as PropertyValue | undefined;
    return handler
      .toPlainText(value as never, schema as never, ctx)
      .toLowerCase()
      .includes(needle);
  });
}
