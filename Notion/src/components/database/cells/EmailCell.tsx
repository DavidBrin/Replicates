"use client";

import { useState } from "react";
import { useDatabaseActions } from "../hooks";
import { BareInput, cellClass, type CellProps } from "./shared";

export function EmailCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const { setPropertyValue } = useDatabaseActions();
  const email = value?.type === "email" ? value.email : "";
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div
        className={cellClass(variant)}
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") setEditing(true);
        }}
      >
        {email ? (
          <a
            href={`mailto:${email}`}
            onClick={(event) => event.stopPropagation()}
            className="truncate underline decoration-[var(--bor-str)] underline-offset-2"
            style={{ color: "var(--tex-pri)" }}
          >
            {email}
          </a>
        ) : (
          <span style={{ color: "var(--tex-ter)" }}>Empty</span>
        )}
      </div>
    );
  }

  return (
    <BareInput
      autoFocus
      variant={variant}
      inputMode="email"
      value={email}
      placeholder="name@example.com"
      onChange={(next) => setPropertyValue(rowId, schema.id, { type: "email", email: next })}
      onBlur={() => setEditing(false)}
    />
  );
}
