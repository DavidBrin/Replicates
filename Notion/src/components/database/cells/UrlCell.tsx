"use client";

import { useState } from "react";
import { useDatabaseActions } from "../hooks";
import { BareInput, cellClass, type CellProps } from "./shared";

/**
 * URL cell. Reads as a link until focused, then becomes a plain input — a
 * permanently-live anchor would swallow the click that starts an edit.
 */
export function UrlCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const { setPropertyValue } = useDatabaseActions();
  const url = value?.type === "url" ? value.url : "";
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
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="truncate underline decoration-[var(--bor-str)] underline-offset-2"
            style={{ color: "var(--tex-pri)" }}
          >
            {url}
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
      inputMode="url"
      value={url}
      placeholder="https://"
      onChange={(next) => setPropertyValue(rowId, schema.id, { type: "url", url: next })}
      onBlur={() => setEditing(false)}
    />
  );
}
