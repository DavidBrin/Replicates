"use client";

/**
 * Calendar view — a month grid driven by `view.datePropertyId`.
 *
 * The grid is always 6×7 so switching months never resizes the page, and rows
 * are bucketed by *civil day key* rather than by `Date`, which is what keeps a
 * task due "the 4th" on the 4th regardless of the reader's timezone.
 */

import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { propertyColor } from "@/lib/model/property-types";
import type { NotionColor, Page, PropertySchema } from "@/lib/model/types";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuLabel, MenuList } from "@/components/primitives/Menu";
import { tagStyle, dotColor } from "@/lib/utils/colors";
import { cn } from "@/lib/utils/cn";
import { useDatabaseUi } from "./context";
import { useDatabaseActions, useTodayKey } from "./hooks";
import {
  addMonths,
  dayKey,
  daysBetween,
  formatMonthTitle,
  isSameMonth,
  monthGrid,
  startOfMonth,
  WEEKDAY_LABELS,
} from "./date-utils";
import type { ViewComponentProps } from "./view-props";

/** Max event pills before the cell collapses the rest into "+N more". */
const MAX_EVENTS_PER_DAY = 3;

export function CalendarView({ database, view, rows }: ViewComponentProps) {
  const { openRow } = useDatabaseUi();
  const { createRow, updateView } = useDatabaseActions();

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const pickerAnchor = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  /** `null` until hydration finishes — see `useTodayKey` for why. */
  const todayKey = useTodayKey();

  const dateProperties = useMemo(
    () => database.properties.filter((p) => p.type === "date"),
    [database.properties],
  );

  const dateProperty: PropertySchema | undefined = useMemo(
    () =>
      database.properties.find((p) => p.id === view.datePropertyId && p.type === "date") ??
      dateProperties[0],
    [database.properties, view.datePropertyId, dateProperties],
  );

  /** The status column, used only to tint the event pills. */
  const colorProperty = useMemo(
    () => database.properties.find((p) => p.type === "status" || p.type === "select"),
    [database.properties],
  );

  /** dayKey → rows falling on that day, spans included. */
  const byDay = useMemo(() => {
    const map = new Map<string, Page[]>();
    if (!dateProperty) return map;
    for (const row of rows) {
      const value = row.properties?.[dateProperty.id];
      if (value?.type !== "date" || !value.date) continue;
      for (const key of daysBetween(value.date.start, value.date.end)) {
        const bucket = map.get(key);
        if (bucket) bucket.push(row);
        else map.set(key, [row]);
      }
    }
    return map;
  }, [rows, dateProperty]);

  const days = useMemo(() => monthGrid(cursor), [cursor]);

  if (!dateProperty) {
    return (
      <div className="px-2 py-8 text-sm" style={{ color: "var(--tex-ter)" }}>
        This database has no date property, so there is nothing for a calendar to lay out.
      </div>
    );
  }

  const eventColor = (row: Page): NotionColor => {
    if (!colorProperty) return "default";
    return propertyColor(colorProperty, row.properties?.[colorProperty.id]) ?? "default";
  };

  const createOn = (key: string) =>
    createRow(database.id, {
      [dateProperty.id]: { type: "date", date: { start: key } },
    });

  return (
    <div className="w-full">
      {/* -- month header -- */}
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-base font-semibold" style={{ color: "var(--tex-pri)" }}>
          {formatMonthTitle(cursor)}
        </h3>
        <span className="flex-1" />

        {dateProperties.length > 1 ? (
          <>
            <button
              ref={pickerAnchor}
              type="button"
              onClick={() => setPickerOpen(true)}
              className="rounded-[4px] px-2 py-1 text-xs transition-colors duration-75 hover:bg-[var(--bac-int)]"
              style={{ color: "var(--tex-sec)" }}
            >
              {dateProperty.name}
            </button>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen} anchor={pickerAnchor} align="end">
              <MenuList className="w-[200px]">
                <MenuLabel>Calendar by</MenuLabel>
                {dateProperties.map((property) => (
                  <MenuItem
                    key={property.id}
                    selected={property.id === dateProperty.id}
                    onSelect={() => {
                      updateView(view.id, { datePropertyId: property.id });
                      setPickerOpen(false);
                    }}
                  >
                    {property.name}
                  </MenuItem>
                ))}
              </MenuList>
            </Popover>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setCursor(startOfMonth(new Date()))}
          className="rounded-[4px] px-2 py-1 text-xs transition-colors duration-75 hover:bg-[var(--bac-int)]"
          style={{ color: "var(--tex-sec)" }}
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="rounded-[4px] p-1 transition-colors duration-75 hover:bg-[var(--bac-int)]"
          style={{ color: "var(--ico-sec)" }}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="rounded-[4px] p-1 transition-colors duration-75 hover:bg-[var(--bac-int)]"
          style={{ color: "var(--ico-sec)" }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* -- weekday header -- */}
      <div className="grid grid-cols-7 border-t" style={{ borderColor: "var(--bor-pri)" }}>
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-r px-2 py-1 text-right text-[11px] font-medium last:border-r-0"
            style={{ borderColor: "var(--bor-pri)", color: "var(--tex-ter)" }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* -- day grid -- */}
      <div
        className="grid grid-cols-7 border-l border-t"
        style={{ borderColor: "var(--bor-pri)" }}
      >
        {days.map((day) => {
          const key = dayKey(day);
          const events = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const outside = !isSameMonth(day, cursor);
          const showAll = expandedDay === key;
          const shown = showAll ? events : events.slice(0, MAX_EVENTS_PER_DAY);

          return (
            <div
              key={key}
              className="group/day relative flex min-h-[104px] flex-col gap-1 border-b border-r p-1"
              style={{
                borderColor: "var(--bor-pri)",
                background: outside ? "var(--bac-sec)" : "transparent",
              }}
            >
              <div className="flex items-center justify-between">
                {/* The "+" only exists on hover, matching Notion's quiet grid. */}
                <button
                  type="button"
                  aria-label={`New page on ${key}`}
                  onClick={() => openRow(createOn(key))}
                  className="rounded-[4px] p-0.5 opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-[var(--bac-int)]"
                  style={{ color: "var(--ico-sec)" }}
                >
                  <Plus size={12} />
                </button>

                <span
                  className={cn(
                    "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px]",
                    isToday && "font-semibold",
                  )}
                  style={
                    isToday
                      ? { background: "var(--accent)", color: "#fff" }
                      : { color: outside ? "var(--tex-ter)" : "var(--tex-sec)" }
                  }
                >
                  {day.getDate()}
                </span>
              </div>

              {shown.map((row) => {
                const color = eventColor(row);
                return (
                  <button
                    key={`${key}-${row.id}`}
                    type="button"
                    onClick={() => openRow(row.id)}
                    className="flex items-center gap-1 truncate rounded-[3px] px-1 py-[2px] text-left text-[11px] transition-opacity hover:opacity-80"
                    style={tagStyle(color)}
                  >
                    <span
                      className="h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ background: dotColor(color) }}
                    />
                    <span className="truncate">{row.title || "Untitled"}</span>
                  </button>
                );
              })}

              {events.length > MAX_EVENTS_PER_DAY ? (
                <button
                  type="button"
                  onClick={() => setExpandedDay(showAll ? null : key)}
                  className="px-1 text-left text-[11px]"
                  style={{ color: "var(--tex-ter)" }}
                >
                  {showAll ? "Show less" : `+${events.length - MAX_EVENTS_PER_DAY} more`}
                </button>
              ) : null}

              {/* Clicking the empty remainder of a cell creates a page there. */}
              <button
                type="button"
                aria-label={`New page on ${key}`}
                tabIndex={-1}
                onClick={() => openRow(createOn(key))}
                className="min-h-[8px] flex-1 cursor-default"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
