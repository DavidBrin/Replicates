"use client";

import { getPropertyHandler } from "@/lib/model/property-types";
import { useUsers } from "../hooks";
import { cellClass, type CellProps } from "./shared";

/**
 * `created_time` / `last_edited_time`.
 *
 * Read-only by construction: the handlers report `isEditable === false`, and
 * the value is maintained by the store. Formatting is the handler's, so both
 * timestamp types render identically without this file knowing which is which.
 */
export function TimestampCell({ schema, value, variant = "table" }: CellProps) {
  const users = useUsers();
  const handler = getPropertyHandler(schema.type);
  const text = handler.toPlainText(value as never, schema as never, { users });

  return (
    <div className={cellClass(variant)} style={{ color: "var(--tex-sec)" }}>
      <span className="truncate">{text}</span>
    </div>
  );
}
