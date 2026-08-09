"use client";

/**
 * Database entry point.
 *
 * Owns three things and delegates everything else:
 *   1. which view is active (local state — a tab choice is per-reader, not
 *      part of the document, so it must not be persisted to the store);
 *   2. the single `resolveView` pass whose output every renderer shares;
 *   3. the row peek, exposed to nested renderers through `DatabaseUiProvider`.
 *
 * The view renderers themselves are chosen from a registry, so adding a
 * gallery view is one entry here plus one component.
 */

import { useCallback, useMemo, useState, type ComponentType } from "react";
import { matchesQuery } from "@/lib/database/view-engine";
import type { Id, Page, ViewType } from "@/lib/model/types";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import { RowPeek } from "./RowPeek";
import { ViewTabBar } from "./ViewTabBar";
import { ViewToolbar } from "./ViewToolbar";
import { DatabaseUiProvider } from "./context";
import {
  useDatabase,
  useDatabaseActions,
  useDatabaseViews,
  useResolvedView,
  useUsers,
  useView,
} from "./hooks";
import type { ViewComponentProps } from "./view-props";

/**
 * Gallery is not implemented yet; it renders as a board so the tab is never a
 * dead end. Swapping in a real GalleryView is a one-line change.
 */
const VIEW_RENDERERS: Record<ViewType, ComponentType<ViewComponentProps>> = {
  board: BoardView,
  table: TableView,
  list: ListView,
  calendar: CalendarView,
  gallery: BoardView,
};

export function DatabaseView({ databaseId }: { databaseId: string }) {
  const database = useDatabase(databaseId);
  const users = useUsers();
  const { renameDatabase, createRow } = useDatabaseActions();

  const [requestedViewId, setRequestedViewId] = useState<Id | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [peekRowId, setPeekRowId] = useState<Id | null>(null);

  // Fall back to the first tab when the requested view has been deleted, so a
  // stale local id can never blank the whole database.
  const activeViewId =
    requestedViewId && database?.viewIds.includes(requestedViewId)
      ? requestedViewId
      : database?.viewIds[0];

  const views = useDatabaseViews(database?.viewIds ?? []);
  const view = useView(activeViewId);
  const resolved = useResolvedView(database, view);

  const openRow = useCallback((rowId: Id) => setPeekRowId(rowId), []);
  const closeRow = useCallback(() => setPeekRowId(null), []);

  /**
   * Search narrows what is already resolved rather than re-running the engine:
   * filters and sorts are the view's semantics, search is a transient overlay
   * on top of them, and the board's groups must stay in place while it applies.
   */
  const searched = useMemo(() => {
    if (!database || !query.trim()) return resolved;
    const keep = (page: Page) => matchesQuery(page, database, query, users);
    return {
      rows: resolved.rows.filter(keep),
      groups: resolved.groups.map((group) => ({ ...group, rows: group.rows.filter(keep) })),
      groupBy: resolved.groupBy,
    };
  }, [database, query, resolved, users]);

  const ui = useMemo(
    () => ({ databaseId, openRow, peekRowId }),
    [databaseId, openRow, peekRowId],
  );

  if (!database) {
    return (
      <div className="px-2 py-8 text-sm" style={{ color: "var(--tex-ter)" }}>
        This database no longer exists.
      </div>
    );
  }

  const Renderer = view ? VIEW_RENDERERS[view.type] : null;

  const newRow = (position: "start" | "end") => {
    const rowId = createRow(databaseId, undefined, position === "start" ? 0 : undefined);
    openRow(rowId);
  };

  return (
    <DatabaseUiProvider value={ui}>
      <div
        className={
          expanded
            ? "fixed inset-0 z-30 overflow-y-auto px-8 py-6"
            : "w-full"
        }
        style={expanded ? { background: "var(--bac-pri)" } : undefined}
      >
        {/* -- title -- */}
        <div className="mb-1 flex items-center gap-2">
          {database.icon.type === "emoji" ? (
            <span className="text-[20px] leading-none">{database.icon.emoji}</span>
          ) : null}
          <input
            value={database.title}
            onChange={(event) => renameDatabase(databaseId, event.target.value)}
            placeholder="Untitled"
            className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold leading-tight outline-hidden placeholder:text-[var(--tex-ter)]"
            style={{ color: "var(--tex-pri)" }}
          />
        </div>

        {/* -- tabs + toolbar share one line, and one bottom border -- */}
        <div
          className="mb-2 flex items-center justify-between gap-3 border-b"
          style={{ borderColor: "var(--bor-pri)" }}
        >
          <div className="notion-scroller min-w-0 overflow-x-auto">
            <ViewTabBar
              databaseId={databaseId}
              views={views}
              activeViewId={activeViewId}
              onSelect={setRequestedViewId}
            />
          </div>

          {view ? (
            <ViewToolbar
              database={database}
              view={view}
              query={query}
              onQueryChange={setQuery}
              expanded={expanded}
              onExpandedChange={setExpanded}
              onNewRow={newRow}
            />
          ) : null}
        </div>

        {/* -- the active view -- */}
        {view && Renderer ? (
          <Renderer
            database={database}
            view={view}
            rows={searched.rows}
            groups={searched.groups}
            groupBy={searched.groupBy}
          />
        ) : null}
      </div>

      <RowPeek database={database} rowId={peekRowId} onClose={closeRow} />
    </DatabaseUiProvider>
  );
}
