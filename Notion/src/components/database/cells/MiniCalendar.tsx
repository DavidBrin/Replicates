"use client";

/**
 * The small month picker inside a date cell's popover.
 *
 * Kept separate from `CalendarView` on purpose: this one picks a day, that one
 * lays out rows across a month. Sharing a component would force both to carry
 * the other's props.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  addMonths,
  dayKey,
  formatMonthTitle,
  isSameMonth,
  monthGrid,
  parseIso,
  startOfMonth,
  WEEKDAY_LABELS,
} from "../date-utils";

export function MiniCalendar({
  /** Currently selected day, ISO. */
  selected,
  /** Optional range end, ISO — rendered as a highlighted band. */
  rangeEnd,
  onPick,
}: {
  selected?: string;
  rangeEnd?: string;
  onPick: (iso: string) => void;
}) {
  const [cursor, setCursor] = useState(() =>
    startOfMonth(selected ? parseIso(selected) : new Date()),
  );

  const selectedKey = selected ? dayKey(parseIso(selected)) : null;
  const endKey = rangeEnd ? dayKey(parseIso(rangeEnd)) : null;
  const days = monthGrid(cursor);

  return (
    <div className="w-[260px] p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-sm font-medium" style={{ color: "var(--tex-pri)" }}>
          {formatMonthTitle(cursor)}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setCursor((c) => addMonths(c, -1))}
            className="rounded-[4px] p-1 hover:bg-[var(--bac-int)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="rounded-[4px] p-1 hover:bg-[var(--bac-int)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <ChevronRight size={14} />
          </button>
        </span>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="pb-1 text-center text-[10px] font-medium"
            style={{ color: "var(--tex-ter)" }}
          >
            {label[0]}
          </div>
        ))}

        {days.map((day) => {
          const key = dayKey(day);
          const isSelected = key === selectedKey;
          const isEnd = key === endKey;
          const inRange =
            selectedKey && endKey ? key > selectedKey && key < endKey : false;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={cn(
                "h-7 text-[13px] transition-colors duration-75",
                isSelected || isEnd ? "rounded-[4px] font-medium" : "rounded-[4px]",
                !isSelected && !isEnd && "hover:bg-[var(--bac-int)]",
              )}
              style={{
                background: isSelected || isEnd
                  ? "var(--accent)"
                  : inRange
                    ? "var(--accent-soft)"
                    : "transparent",
                color: isSelected || isEnd
                  ? "#fff"
                  : isSameMonth(day, cursor)
                    ? "var(--tex-pri)"
                    : "var(--tex-ter)",
              }}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
