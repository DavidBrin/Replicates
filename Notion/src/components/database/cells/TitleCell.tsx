"use client";

import { useDatabaseActions } from "../hooks";
import { BareInput, type CellProps } from "./shared";

/**
 * The title column.
 *
 * Writing here goes through `setPropertyValue`, which the store special-cases:
 * a `title` value also renames the underlying page, so the sidebar, the peek
 * header and the card all stay in step from one call.
 */
export function TitleCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const { setPropertyValue } = useDatabaseActions();
  const text = value?.type === "title" ? value.title : "";

  return (
    <BareInput
      variant={variant}
      value={text}
      placeholder="Untitled"
      onChange={(next) => setPropertyValue(rowId, schema.id, { type: "title", title: next })}
    />
  );
}
