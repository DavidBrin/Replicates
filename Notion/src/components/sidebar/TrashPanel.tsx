"use client";

/**
 * Trash popover.
 *
 * Notion's trash is a soft delete: a trashed page keeps its blocks and its
 * place in the parent's `childPageIds`, it is only dropped from the sidebar
 * sections. So this panel restores from, or empties, that same set.
 */

import { useMemo, useState, type RefObject } from "react";
import { FileText, Search, Trash2, Undo2 } from "lucide-react";
import { Popover } from "@/components/primitives/Popover";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { useShallow } from "zustand/react/shallow";

export interface TrashPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
}

export function TrashPanel({ open, onOpenChange, anchor }: TrashPanelProps) {
  const [query, setQuery] = useState("");

  // Shallow-compared: the filter allocates a fresh array on every store write.
  // The elements must be the store's own `Page` objects — mapping them to
  // fresh literals here would defeat the shallow compare and make every
  // snapshot look new, which React 19 rejects outright.
  const trashed = useWorkspaceStore(
    useShallow((s) =>
      Object.values(s.pages)
        .filter((page) => page.inTrash)
        // Only show the roots of a trashed subtree — children came along for
        // the ride and restoring the root restores them too.
        .filter((page) => !page.parentId || !s.pages[page.parentId]?.inTrash),
    ),
  );

  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const deletePagePermanently = useWorkspaceStore((s) => s.deletePagePermanently);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return trashed;
    return trashed.filter((page) => (page.title || "Untitled").toLowerCase().includes(needle));
  }, [query, trashed]);

  return (
    <Popover open={open} onOpenChange={onOpenChange} anchor={anchor} align="start" width={320}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--bor-pri)" }}>
        <Search size={14} style={{ color: "var(--ico-ter)" }} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages in Trash"
          className="w-full bg-transparent text-sm outline-hidden"
          style={{ color: "var(--tex-pri)" }}
        />
      </div>

      <div className="notion-scroller max-h-[320px] overflow-y-auto py-1">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs" style={{ color: "var(--tex-ter)" }}>
            {query ? "No matching pages." : "Pages you move to Trash appear here."}
          </p>
        ) : (
          results.map((page) => (
            <div
              key={page.id}
              className="group flex items-center gap-2 px-3 py-[6px] transition-colors duration-100 hover:bg-[var(--bac-int)]"
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none"
                style={{ color: "var(--ico-sec)" }}
              >
                {page.icon.type === "emoji" ? page.icon.emoji : <FileText size={14} strokeWidth={1.8} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--tex-pri)" }}>
                {page.title || "Untitled"}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Restore ${page.title || "Untitled"}`}
                  title="Restore"
                  onClick={() => restorePage(page.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int-strong)]"
                  style={{ color: "var(--ico-sec)" }}
                >
                  <Undo2 size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${page.title || "Untitled"} permanently`}
                  title="Delete permanently"
                  onClick={() => deletePagePermanently(page.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int-strong)]"
                  style={{ color: "var(--tag-red-fg)" }}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
