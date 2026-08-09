"use client";

import { useRef, useState } from "react";
import { Popover } from "@/components/primitives/Popover";
import { Pill } from "@/components/primitives/Pill";
import { newId } from "@/lib/utils/id";
import type { StatusOption } from "@/lib/model/types";
import { useDatabaseActions } from "../hooks";
import { OptionPicker, nextOptionColor } from "./OptionPicker";
import { CellTrigger, EmptyHint, type CellProps } from "./shared";

/** Human labels for the three fixed status groups. */
const GROUP_LABELS: Record<string, string> = {
  "to-do": "To-do",
  "in-progress": "In progress",
  complete: "Complete",
};

/**
 * Status cell — a select whose options are clustered by group and whose pills
 * carry the leading dot. That clustering is the whole difference between
 * `status` and `select` in Notion, so it is the only thing this file adds.
 */
export function StatusCell({ databaseId, rowId, schema, value, variant = "table" }: CellProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { setPropertyValue, updateProperty } = useDatabaseActions();

  if (schema.type !== "status") return null;

  const selectedId = value?.type === "status" ? value.status : null;
  const selected = schema.options.find((o) => o.id === selectedId);

  const assign = (optionId: string | null) =>
    setPropertyValue(rowId, schema.id, { type: "status", status: optionId });

  const createOption = (name: string) => {
    // New statuses land in "to-do"; Notion asks later where they belong.
    const option: StatusOption = {
      id: newId("option"),
      name,
      color: nextOptionColor(schema.options.length),
      group: "to-do",
    };
    updateProperty(databaseId, { ...schema, options: [...schema.options, option] });
    assign(option.id);
    setOpen(false);
  };

  return (
    <>
      <CellTrigger ref={anchor} variant={variant} onClick={() => setOpen(true)}>
        {selected ? (
          <Pill color={selected.color} dot size="sm">
            {selected.name}
          </Pill>
        ) : (
          <EmptyHint />
        )}
      </CellTrigger>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor}>
        <OptionPicker
          dot
          options={schema.options}
          selectedIds={selectedId ? [selectedId] : []}
          groupOf={(option) => {
            const match = schema.options.find((o) => o.id === option.id);
            return GROUP_LABELS[match?.group ?? "to-do"] ?? "To-do";
          }}
          onToggle={(optionId) => {
            assign(optionId);
            setOpen(false);
          }}
          onClear={() => assign(null)}
          onCreate={createOption}
        />
      </Popover>
    </>
  );
}
