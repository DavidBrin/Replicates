"use client";

import { useState } from "react";
import { getPropertyHandler } from "@/lib/model/property-types";
import { useDatabaseActions } from "../hooks";
import { BareInput, cellClass, type CellProps } from "./shared";

/**
 * Number editor.
 *
 * A local draft is essential here: `"-"`, `"1."` and `"1e"` are all legal
 * *keystrokes* but parse to `NaN`, so writing straight through would delete
 * the character the user just typed. The draft holds the raw text while the
 * store holds only committed numbers.
 *
 * The formatted (currency / percent) rendering comes from the handler, never
 * from a local switch on `schema.format`.
 */
export function NumberCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const { setPropertyValue } = useDatabaseActions();
  const committed = value?.type === "number" ? value.number : null;

  /**
   * `null` means "not editing". Seeding the draft at the moment editing starts
   * — rather than mirroring the store in an effect — means there is no second
   * copy of the value to keep in sync, and no cascading render.
   */
  const [draft, setDraft] = useState<string | null>(null);

  const startEditing = () => setDraft(committed === null ? "" : String(committed));

  if (draft === null) {
    const handler = getPropertyHandler(schema.type);
    const text = handler.toPlainText(value as never, schema as never, { users: {} });
    return (
      <div
        className={`${cellClass(variant)} justify-end tabular-nums`}
        style={{ color: text ? "var(--tex-pri)" : "var(--tex-ter)" }}
        onClick={startEditing}
        role="button"
        tabIndex={0}
        onFocus={startEditing}
        onKeyDown={(event) => {
          if (event.key === "Enter") startEditing();
        }}
      >
        <span className="truncate">{text}</span>
      </div>
    );
  }

  return (
    <BareInput
      autoFocus
      variant={variant}
      alignEnd
      inputMode="decimal"
      value={draft}
      placeholder="Empty"
      onChange={(next) => {
        setDraft(next);
        const parsed = next.trim() === "" ? null : Number(next);
        if (parsed === null || Number.isFinite(parsed)) {
          setPropertyValue(rowId, schema.id, { type: "number", number: parsed });
        }
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
