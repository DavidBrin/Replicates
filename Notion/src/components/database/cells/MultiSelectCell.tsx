"use client";

import { useRef, useState } from "react";
import { Popover } from "@/components/primitives/Popover";
import { Pill } from "@/components/primitives/Pill";
import { newId } from "@/lib/utils/id";
import type { SelectOption } from "@/lib/model/types";
import { useDatabaseActions } from "../hooks";
import { OptionPicker, nextOptionColor } from "./OptionPicker";
import { CellTrigger, EmptyHint, type CellProps } from "./shared";

export function MultiSelectCell({
  databaseId,
  rowId,
  schema,
  value,
  variant = "table",
}: CellProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { setPropertyValue, updateProperty } = useDatabaseActions();

  if (schema.type !== "multi_select") return null;

  const selectedIds = value?.type === "multi_select" ? value.multi_select : [];
  const selected = schema.options.filter((o) => selectedIds.includes(o.id));

  const assign = (ids: string[]) =>
    setPropertyValue(rowId, schema.id, { type: "multi_select", multi_select: ids });

  const createOption = (name: string) => {
    const option: SelectOption = {
      id: newId("option"),
      name,
      color: nextOptionColor(schema.options.length),
    };
    updateProperty(databaseId, { ...schema, options: [...schema.options, option] });
    assign([...selectedIds, option.id]);
    // Multi-select stays open so several tags can be added in one pass.
  };

  return (
    <>
      <CellTrigger ref={anchor} variant={variant} onClick={() => setOpen(true)}>
        {selected.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {selected.map((option) => (
              <Pill key={option.id} color={option.color} size="sm">
                {option.name}
              </Pill>
            ))}
          </span>
        ) : (
          <EmptyHint />
        )}
      </CellTrigger>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor}>
        <OptionPicker
          multiple
          options={schema.options}
          selectedIds={selectedIds}
          onToggle={(optionId) =>
            assign(
              selectedIds.includes(optionId)
                ? selectedIds.filter((id) => id !== optionId)
                : [...selectedIds, optionId],
            )
          }
          onClear={() => assign([])}
          onCreate={createOption}
        />
      </Popover>
    </>
  );
}
