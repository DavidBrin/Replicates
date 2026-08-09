"use client";

import { useRef, useState } from "react";
import { getPropertyHandler } from "@/lib/model/property-types";
import { Popover } from "@/components/primitives/Popover";
import { MenuSeparator } from "@/components/primitives/Menu";
import { SettingRow, Toggle } from "../controls";
import { useDatabaseActions } from "../hooks";
import { MiniCalendar } from "./MiniCalendar";
import { CellTrigger, EmptyHint, type CellProps } from "./shared";

/**
 * Date cell with an optional end date.
 *
 * Dates are stored as bare `YYYY-MM-DD` keys rather than full instants: the
 * property is a *civil* date ("due Thursday"), and storing an instant would
 * make the rendered day depend on the reader's timezone.
 *
 * The closed-cell text comes from the handler, so a range renders with the
 * same `→` separator everywhere in the product.
 */
export function DateCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** Which end of the range the next click on the grid sets. */
  const [editingEnd, setEditingEnd] = useState(false);
  const { setPropertyValue } = useDatabaseActions();

  const date = value?.type === "date" ? value.date : null;
  const handler = getPropertyHandler(schema.type);
  const text = handler.toPlainText(value as never, schema as never, { users: {} });

  const write = (next: { start: string; end?: string } | null) =>
    setPropertyValue(rowId, schema.id, { type: "date", date: next });

  return (
    <>
      <CellTrigger ref={anchor} variant={variant} onClick={() => setOpen(true)}>
        {text ? (
          <span className="truncate" style={{ color: "var(--tex-pri)" }}>
            {text}
          </span>
        ) : (
          <EmptyHint />
        )}
      </CellTrigger>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor}>
        <MiniCalendar
          selected={date?.start}
          rangeEnd={date?.end}
          onPick={(iso) => {
            if (editingEnd && date) {
              // Picking an end before the start swaps them rather than
              // producing an inverted range the calendar cannot draw.
              const [start, end] = iso < date.start ? [iso, date.start] : [date.start, iso];
              write({ start, end });
            } else {
              write({ start: iso, end: date?.end && iso <= date.end ? date.end : undefined });
            }
          }}
        />

        <MenuSeparator />

        <SettingRow label="End date">
          <Toggle
            label="End date"
            checked={Boolean(date?.end)}
            onChange={(next) => {
              if (!date) return;
              write(next ? { start: date.start, end: date.start } : { start: date.start });
              setEditingEnd(next);
            }}
          />
        </SettingRow>

        {date ? (
          <SettingRow
            label="Clear"
            onClick={() => {
              write(null);
              setEditingEnd(false);
              setOpen(false);
            }}
          />
        ) : null}
      </Popover>
    </>
  );
}
