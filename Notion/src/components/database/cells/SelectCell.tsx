"use client";

import { useRef, useState } from "react";
import { Popover } from "@/components/primitives/Popover";
import { Pill } from "@/components/primitives/Pill";
import { newId } from "@/lib/utils/id";
import type { SelectOption } from "@/lib/model/types";
import { useDatabaseActions } from "../hooks";
import { OptionPicker, nextOptionColor } from "./OptionPicker";
import { CellTrigger, EmptyHint, type CellProps } from "./shared";

/**
 * Single-select cell.
 *
 * Creating an option mutates the *schema*, not the row — hence `updateProperty`
 * with a rebuilt options array, followed by `setPropertyValue` to assign it.
 * Doing it in that order means the row never points at an option the schema
 * has not seen yet.
 */
export function SelectCell({ databaseId, rowId, schema, value, variant = "table" }: CellProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { setPropertyValue, updateProperty } = useDatabaseActions();

  // Hooks first, narrowing second — the registry guarantees the pairing, but
  // TypeScript needs the guard and the rules of hooks need it to come last.
  if (schema.type !== "select") return null;

  const selectedId = value?.type === "select" ? value.select : null;
  const selected = schema.options.find((o) => o.id === selectedId);

  const assign = (optionId: string | null) =>
    setPropertyValue(rowId, schema.id, { type: "select", select: optionId });

  const createOption = (name: string) => {
    const option: SelectOption = {
      id: newId("option"),
      name,
      color: nextOptionColor(schema.options.length),
    };
    updateProperty(databaseId, { ...schema, options: [...schema.options, option] });
    assign(option.id);
    setOpen(false);
  };

  return (
    <>
      <CellTrigger ref={anchor} variant={variant} onClick={() => setOpen(true)}>
        {selected ? (
          <Pill color={selected.color} size="sm">
            {selected.name}
          </Pill>
        ) : (
          <EmptyHint />
        )}
      </CellTrigger>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor}>
        <OptionPicker
          options={schema.options}
          selectedIds={selectedId ? [selectedId] : []}
          onToggle={(optionId) => {
            // Clicking the current value clears it, as Notion does.
            assign(optionId === selectedId ? null : optionId);
            setOpen(false);
          }}
          onClear={() => assign(null)}
          onCreate={createOption}
        />
      </Popover>
    </>
  );
}
