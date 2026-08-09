"use client";

/**
 * Store bindings shared by every database view.
 *
 * Zustand v5 hands the selector result straight to `useSyncExternalStore`, so a
 * selector that *builds* a value on each call re-renders forever ("The result
 * of getSnapshot should be cached"). Two rules follow, and every hook here
 * obeys one of them:
 *   1. select a single entity by id, or a whole map that the store replaces by
 *      reference — the identity is already stable; or
 *   2. wrap the selector in `useShallow` when it must build a new object.
 * Derived data (resolveView) is computed in a `useMemo` outside the selector.
 */

import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { dayKey } from "./date-utils";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { resolveView, type ResolvedView } from "@/lib/database/view-engine";
import type { Database, Id, Page, PropertySchema, User, View } from "@/lib/model/types";

/* ---------------------------------------------------------------- entities */

export function useDatabase(databaseId: Id): Database | undefined {
  return useWorkspaceStore((s) => s.databases[databaseId]);
}

export function useView(viewId: Id | undefined): View | undefined {
  return useWorkspaceStore((s) => (viewId ? s.views[viewId] : undefined));
}

export function useRow(rowId: Id | undefined): Page | undefined {
  return useWorkspaceStore((s) => (rowId ? s.pages[rowId] : undefined));
}

/** The whole users map — replaced wholesale by the store, so already stable. */
export function useUsers(): Record<Id, User> {
  return useWorkspaceStore((s) => s.users);
}

/** The whole pages map. Same stability argument as `useUsers`. */
export function usePages(): Record<Id, Page> {
  return useWorkspaceStore((s) => s.pages);
}

/** Views belonging to one database, in the database's own tab order. */
export function useDatabaseViews(viewIds: Id[]): View[] {
  return useWorkspaceStore(
    useShallow((s) => viewIds.map((id) => s.views[id]).filter((v): v is View => Boolean(v))),
  );
}

/* ----------------------------------------------------------------- actions */

/**
 * Every mutation a view can perform, in one object.
 *
 * The action identities never change, so `useShallow` makes this a permanently
 * stable reference — one subscription instead of a dozen.
 */
export function useDatabaseActions() {
  return useWorkspaceStore(
    useShallow((s) => ({
      createRow: s.createRow,
      deleteRow: s.deleteRow,
      moveRow: s.moveRow,
      setPropertyValue: s.setPropertyValue,
      addProperty: s.addProperty,
      updateProperty: s.updateProperty,
      removeProperty: s.removeProperty,
      renameDatabase: s.renameDatabase,
      renamePage: s.renamePage,
      setPageIcon: s.setPageIcon,
      duplicatePage: s.duplicatePage,
      createView: s.createView,
      updateView: s.updateView,
      deleteView: s.deleteView,
    })),
  );
}

/* ----------------------------------------------------------------- derived */

/**
 * Filters, sorts and groups a view's rows.
 *
 * Memoised on the four inputs `resolveView` actually reads; anything else
 * changing in the store leaves the previous result in place.
 */
export function useResolvedView(
  database: Database | undefined,
  view: View | undefined,
): ResolvedView {
  const pages = usePages();
  const users = useUsers();

  return useMemo<ResolvedView>(() => {
    if (!database || !view) return { rows: [], groups: [], groupBy: null };
    return resolveView({ database, view, pages, users });
  }, [database, view, pages, users]);
}

/** The visible columns of a view, in the view's order, skipping deleted ones. */
export function useVisibleProperties(
  database: Database | undefined,
  view: View | undefined,
): PropertySchema[] {
  return useMemo(() => {
    if (!database || !view) return [];
    const byId = new Map(database.properties.map((p) => [p.id, p]));
    return view.visiblePropertyIds
      .map((id) => byId.get(id))
      .filter((p): p is PropertySchema => Boolean(p));
  }, [database, view]);
}

/* -------------------------------------------------- client-only readings -- */

/** A store that never changes — the subscription exists only to satisfy the API. */
const noSubscribe = () => () => {};

/**
 * `false` during the server pass and the hydrating render, `true` afterwards.
 *
 * `useSyncExternalStore` is the sanctioned way to say "this differs between
 * server and client": React renders the server snapshot while hydrating and
 * swaps in the client one immediately after, with no `setState` in an effect
 * and no hydration mismatch.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Today's local `YYYY-MM-DD`, or `null` until hydration finishes.
 *
 * Reading the clock during render would let a server rendered either side of
 * midnight disagree with the browser, which React reports as a hydration
 * error. The snapshot is a string, so repeated calls compare equal and the
 * store is stable for the rest of the day.
 */
export function useTodayKey(): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => dayKey(new Date()),
    () => null,
  );
}
