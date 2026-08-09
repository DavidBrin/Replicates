"use client";

/**
 * Cell dispatch.
 *
 * A registry object, not a `switch` in JSX: adding a column type means adding
 * one entry here and one handler in `property-types.ts`, and nothing else in
 * the view layer changes. It also means the exhaustiveness of the mapping is
 * checked by the compiler — `Record<PropertyType, …>` will not compile with a
 * type missing.
 *
 * This is the one place allowed to branch on `schema.type`, and only to choose
 * an *editor*. Formatting, sorting, grouping and emptiness all stay in the
 * handlers.
 */

import type { ComponentType } from "react";
import type { PropertyType } from "@/lib/model/types";
import { CheckboxCell } from "./CheckboxCell";
import { DateCell } from "./DateCell";
import { EmailCell } from "./EmailCell";
import { MultiSelectCell } from "./MultiSelectCell";
import { NumberCell } from "./NumberCell";
import { PeopleCell } from "./PeopleCell";
import { SelectCell } from "./SelectCell";
import { StatusCell } from "./StatusCell";
import { TextCell } from "./TextCell";
import { TimestampCell } from "./TimestampCell";
import { TitleCell } from "./TitleCell";
import { UrlCell } from "./UrlCell";
import type { CellProps } from "./shared";

const CELL_REGISTRY: Record<PropertyType, ComponentType<CellProps>> = {
  title: TitleCell,
  rich_text: TextCell,
  number: NumberCell,
  select: SelectCell,
  multi_select: MultiSelectCell,
  status: StatusCell,
  people: PeopleCell,
  date: DateCell,
  checkbox: CheckboxCell,
  url: UrlCell,
  email: EmailCell,
  created_time: TimestampCell,
  last_edited_time: TimestampCell,
};

export function PropertyCell(props: CellProps) {
  const Cell = CELL_REGISTRY[props.schema.type];
  return <Cell {...props} />;
}

export type { CellProps };
