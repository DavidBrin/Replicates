"use client";

import { Check } from "lucide-react";
import { useDatabaseActions } from "../hooks";
import { cellClass, type CellProps } from "./shared";

export function CheckboxCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const { setPropertyValue } = useDatabaseActions();
  const checked = value?.type === "checkbox" ? value.checkbox : false;

  return (
    <label className={`${cellClass(variant)} cursor-pointer`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) =>
          setPropertyValue(rowId, schema.id, { type: "checkbox", checkbox: event.target.checked })
        }
        className="sr-only"
      />
      <span
        aria-hidden
        className="flex h-[14px] w-[14px] items-center justify-center rounded-[3px] border transition-colors duration-100"
        style={{
          background: checked ? "var(--accent)" : "transparent",
          borderColor: checked ? "var(--accent)" : "var(--bor-str)",
        }}
      >
        {checked ? <Check size={11} strokeWidth={3} color="#fff" /> : null}
      </span>
    </label>
  );
}
