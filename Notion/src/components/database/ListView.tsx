"use client";

/**
 * List view — Notion's densest layout: one line per row, icon and title on the
 * left, the visible properties trailing on the right.
 */

import { FileText, Plus } from "lucide-react";
import { useDatabaseUi } from "./context";
import { useDatabaseActions, useUsers, useVisibleProperties } from "./hooks";
import { PropertyValueDisplay, isValueBlank } from "./cells/PropertyValueDisplay";
import type { ViewComponentProps } from "./view-props";

export function ListView({ database, view, rows }: ViewComponentProps) {
  const users = useUsers();
  const { openRow } = useDatabaseUi();
  const { createRow } = useDatabaseActions();
  const properties = useVisibleProperties(database, view).filter((p) => p.type !== "title");

  return (
    <div className="w-full">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => openRow(row.id)}
          className="group flex w-full items-center gap-2 border-b px-2 py-[7px] text-left transition-colors duration-75 hover:bg-[var(--bac-int)]"
          style={{ borderColor: "var(--bor-pri)" }}
        >
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[15px]">
            {row.icon.type === "emoji" ? (
              row.icon.emoji
            ) : (
              <FileText size={15} style={{ color: "var(--ico-ter)" }} />
            )}
          </span>

          <span
            className="min-w-0 flex-1 truncate text-sm"
            style={{ color: "var(--tex-pri)" }}
          >
            {row.title || "Untitled"}
          </span>

          {/* Trailing property strip. Blank values are omitted rather than
              padded, which is what keeps the right edge from looking ragged. */}
          <span className="flex shrink-0 items-center gap-2 overflow-hidden">
            {properties.map((schema) => {
              const value = row.properties?.[schema.id];
              if (isValueBlank(schema, value, users)) return null;
              return (
                <span key={schema.id} className="flex min-w-0 items-center">
                  <PropertyValueDisplay schema={schema} value={value} users={users} />
                </span>
              );
            })}
          </span>
        </button>
      ))}

      <button
        type="button"
        onClick={() => createRow(database.id)}
        className="flex w-full items-center gap-1.5 px-2 py-[7px] text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
        style={{ color: "var(--tex-ter)" }}
      >
        <Plus size={14} />
        New page
      </button>
    </div>
  );
}
