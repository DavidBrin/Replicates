"use client";

/**
 * The view tab strip.
 *
 * Tabs are the database's `viewIds` in order — the store owns that order, so
 * nothing is duplicated here. The active tab doubles as its own menu trigger,
 * which is how Notion exposes rename/duplicate/delete without a second control
 * cluttering every tab.
 */

import { useRef, useState } from "react";
import { Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuLabel, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { VIEW_TYPES, type Id, type View, type ViewType } from "@/lib/model/types";
import { cn } from "@/lib/utils/cn";
import { useDatabaseActions } from "./hooks";
import { VIEW_TYPE_ICONS, VIEW_TYPE_LABELS } from "./property-icons";
import { TextField } from "./controls";

export interface ViewTabBarProps {
  databaseId: Id;
  views: View[];
  activeViewId: Id | undefined;
  onSelect: (viewId: Id) => void;
}

export function ViewTabBar({ databaseId, views, activeViewId, onSelect }: ViewTabBarProps) {
  const { createView, updateView, deleteView } = useDatabaseActions();

  const menuAnchor = useRef<HTMLDivElement>(null);
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [menuViewId, setMenuViewId] = useState<Id | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const menuView = views.find((v) => v.id === menuViewId);

  /** Opens the tab menu, anchored on the tab the user acted on. */
  const openMenu = (view: View, element: HTMLElement) => {
    menuAnchor.current = element as HTMLDivElement;
    setRenaming(false);
    setMenuViewId(view.id);
  };

  const addView = (type: ViewType) => {
    const id = createView(databaseId, {
      name: VIEW_TYPE_LABELS[type],
      type,
      filters: [],
      sorts: [],
      // A new view starts showing nothing but the title, as Notion's does;
      // the view-options popover is where columns get switched back on.
      visiblePropertyIds: [],
    });
    setAddOpen(false);
    onSelect(id);
  };

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {views.map((view) => {
        const Icon = VIEW_TYPE_ICONS[view.type];
        const active = view.id === activeViewId;

        return (
          <div
            key={view.id}
            className="group/tab relative flex shrink-0 items-center"
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(view, event.currentTarget);
            }}
          >
            <button
              type="button"
              onClick={() => onSelect(view.id)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-sm",
                "transition-colors duration-75",
                !active && "hover:bg-[var(--bac-int)]",
              )}
              style={{
                color: active ? "var(--tex-pri)" : "var(--tex-sec)",
                fontWeight: active ? 500 : 400,
              }}
            >
              <Icon size={14} style={{ color: active ? "var(--ico-pri)" : "var(--ico-sec)" }} />
              <span className="max-w-[160px] truncate">{view.name}</span>
            </button>

            {/* The "..." only exists on the active tab — matching Notion, and
                keeping the strip quiet while scanning. */}
            {active ? (
              <button
                type="button"
                aria-label="View options"
                onClick={(event) => openMenu(view, event.currentTarget.parentElement!)}
                className="mr-1 rounded-[4px] p-0.5 opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-[var(--bac-int)]"
                style={{ color: "var(--ico-sec)" }}
              >
                <MoreHorizontal size={13} />
              </button>
            ) : null}

            {/* 2px underline is the active indicator; it sits flush with the
                toolbar's bottom border. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -bottom-[1px] h-[2px]"
              style={{ background: active ? "var(--tex-pri)" : "transparent" }}
            />
          </div>
        );
      })}

      {/* -- add a view -- */}
      <button
        ref={addAnchor}
        type="button"
        aria-label="Add a view"
        onClick={() => setAddOpen(true)}
        className="flex h-8 w-7 shrink-0 items-center justify-center rounded-[4px] transition-colors duration-75 hover:bg-[var(--bac-int)]"
        style={{ color: "var(--ico-sec)" }}
      >
        <Plus size={15} />
      </button>

      <Popover open={addOpen} onOpenChange={setAddOpen} anchor={addAnchor} width={200}>
        <MenuList>
          <MenuLabel>Add a view</MenuLabel>
          {VIEW_TYPES.map((type) => {
            const Icon = VIEW_TYPE_ICONS[type];
            return (
              <MenuItem key={type} icon={<Icon size={14} />} onSelect={() => addView(type)}>
                {VIEW_TYPE_LABELS[type]}
              </MenuItem>
            );
          })}
        </MenuList>
      </Popover>

      {/* -- per-view menu -- */}
      <Popover
        open={Boolean(menuView)}
        onOpenChange={(open) => {
          if (!open) setMenuViewId(null);
        }}
        anchor={menuAnchor}
        width={200}
      >
        {menuView ? (
          renaming ? (
            <div className="p-2">
              <TextField
                autoFocus
                value={menuView.name}
                onChange={(name) => updateView(menuView.id, { name })}
                placeholder="View name"
                onSubmit={() => setMenuViewId(null)}
              />
            </div>
          ) : (
            <MenuList>
              <MenuItem onSelect={() => setRenaming(true)}>Rename</MenuItem>
              <MenuItem
                icon={<Copy size={14} />}
                onSelect={() => {
                  // `createView` mints the id and owns `databaseId`, so the
                  // copy carries only the view's *configuration*.
                  const copyId = createView(databaseId, {
                    name: `${menuView.name} copy`,
                    type: menuView.type,
                    groupByPropertyId: menuView.groupByPropertyId,
                    datePropertyId: menuView.datePropertyId,
                    filters: menuView.filters,
                    sorts: menuView.sorts,
                    visiblePropertyIds: menuView.visiblePropertyIds,
                    columnWidths: menuView.columnWidths,
                    collapsedGroupIds: menuView.collapsedGroupIds,
                    hideEmptyGroups: menuView.hideEmptyGroups,
                  });
                  setMenuViewId(null);
                  onSelect(copyId);
                }}
              >
                Duplicate view
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2 size={14} />}
                // The store refuses to delete the last view; reflect that here
                // rather than offering an action that silently does nothing.
                disabled={views.length <= 1}
                onSelect={() => {
                  deleteView(menuView.id);
                  setMenuViewId(null);
                  const fallback = views.find((v) => v.id !== menuView.id);
                  if (fallback) onSelect(fallback.id);
                }}
              >
                Delete view
              </MenuItem>
            </MenuList>
          )
        ) : null}
      </Popover>
    </div>
  );
}
