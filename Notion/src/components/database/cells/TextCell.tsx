"use client";

import { useDatabaseActions } from "../hooks";
import { BareInput, type CellProps } from "./shared";

export function TextCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const { setPropertyValue } = useDatabaseActions();
  const text = value?.type === "rich_text" ? value.rich_text : "";

  return (
    <BareInput
      variant={variant}
      value={text}
      placeholder="Empty"
      onChange={(next) =>
        setPropertyValue(rowId, schema.id, { type: "rich_text", rich_text: next })
      }
    />
  );
}
