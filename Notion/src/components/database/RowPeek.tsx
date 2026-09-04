"use client";

/**
 * The row side-peek.
 *
 * A database row *is* a page, so this panel is a page editor with the row's
 * properties bolted on top: the `Name | Value` list, then the row's own blocks
 * rendered by the shared block editor. Nothing here duplicates the editor —
 * `BlockList` is imported from the editor module and owns the body entirely.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Maximize2, Trash2, X } from "lucide-react";
import { getPropertyHandler } from "@/lib/model/property-types";
import { routes } from "@/config/app.config";
import type { Database, Id } from "@/lib/model/types";
import { IconButton } from "@/components/primitives/Button";
import { BlockList } from "@/components/editor/BlockList";
import { useDatabaseActions, useMounted, useRow } from "./hooks";
import { PropertyCell } from "./cells/PropertyCell";
import { FALLBACK_PROPERTY_ICON, PROPERTY_ICONS } from "./property-icons";

const PANEL_WIDTH = 480;

const PEEK_KEYFRAMES = `
@keyframes row-peek-in {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}`;

export function RowPeek({
  database,
  rowId,
  onClose,
}: {
  database: Database;
  rowId: Id | null;
  onClose: () => void;
}) {
  const row = useRow(rowId ?? undefined);
  const { renamePage, deleteRow } = useDatabaseActions();
  const router = useRouter();

  /** A portal needs a DOM target, which does not exist during the server pass. */
  const mounted = useMounted();

  // Escape closes the peek from anywhere, including a focused cell.
  useEffect(() => {
    if (!rowId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rowId, onClose]);

  if (!rowId || !row || !mounted) return null;

  // Portalled to the body so the panel is never clipped by the board's
  // horizontal scroller or the table's overflow container.
  return createPortal(
    <>
      {/* The slide-in keyframe is scoped to this component rather than added
          to the global sheet: it is the only thing in the product that enters
          from the right edge. `overlay-in` is already global, so it is reused. */}
      <style>{PEEK_KEYFRAMES}</style>

      <div
        role="presentation"
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{
          background: "var(--bac-overlay)",
          animation: "overlay-in 150ms var(--ease-notion)",
        }}
      />

      <aside
        role="dialog"
        aria-label={row.title || "Untitled"}
        className="notion-scroller fixed inset-y-0 right-0 z-50 overflow-y-auto"
        style={{
          width: PANEL_WIDTH,
          maxWidth: "100vw",
          background: "var(--bac-pri)",
          boxShadow: "var(--shadow-menu)",
          animation: "row-peek-in 200ms var(--ease-notion)",
        }}
      >
        {/* -- panel chrome -- */}
        <div
          className="sticky top-0 z-10 flex items-center gap-1 px-3 py-2"
          style={{ background: "var(--bac-pri)" }}
        >
          <IconButton label="Close" size={26} onClick={onClose}>
            <X size={16} />
          </IconButton>
          <IconButton
            label="Open as full page"
            size={26}
            onClick={() => {
              router.push(routes.page(row.id));
              onClose();
            }}
          >
            <Maximize2 size={14} />
          </IconButton>
          <span className="flex-1" />
          <IconButton
            label="Delete row"
            size={26}
            onClick={() => {
              deleteRow(database.id, row.id);
              onClose();
            }}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>

        {/* -- title -- */}
        <div className="flex items-start gap-2 px-12 pb-4 pt-2">
          {row.icon.type === "emoji" ? (
            <span className="text-[32px] leading-none">{row.icon.emoji}</span>
          ) : null}
          <input
            value={row.title}
            onChange={(event) => renamePage(row.id, event.target.value)}
            placeholder="Untitled"
            className="w-full bg-transparent text-[30px] font-bold leading-tight outline-hidden placeholder:text-[var(--tex-ter)]"
            style={{ color: "var(--tex-pri)" }}
          />
        </div>

        {/* -- properties -- */}
        <div className="px-12 pb-4">
          {database.properties
            // The title already renders as the panel heading above.
            .filter((schema) => schema.type !== "title")
            .map((schema) => {
              const handler = getPropertyHandler(schema.type);
              const Icon = (PROPERTY_ICONS[handler.icon] ?? FALLBACK_PROPERTY_ICON);
              return (
                <div key={schema.id} className="flex items-start gap-2 py-[3px]">
                  <div
                    className="flex h-7 w-[160px] shrink-0 items-center gap-1.5 rounded-[4px] px-1.5 text-sm"
                    style={{ color: "var(--tex-sec)" }}
                  >
                    <Icon size={14} style={{ color: "var(--ico-sec)" }} />
                    <span className="truncate">{schema.name}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <PropertyCell
                      variant="peek"
                      databaseId={database.id}
                      rowId={row.id}
                      schema={schema}
                      value={row.properties?.[schema.id]}
                    />
                  </div>
                </div>
              );
            })}
        </div>

        <div className="mx-12 mb-3 h-px" style={{ background: "var(--bor-pri)" }} />

        {/* -- page body -- */}
        <div className="px-12 pb-24">
          <BlockList parentId={row.id} blockIds={row.blockIds} />
        </div>
      </aside>
    </>,
    document.body,
  );
}
