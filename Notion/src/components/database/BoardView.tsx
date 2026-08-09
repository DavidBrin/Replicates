"use client";

/**
 * Board view.
 *
 * Columns come straight from `resolveView(...).groups` — this file never
 * decides which rows belong where. What it owns is the drag-and-drop, which is
 * the one place a view *writes* grouping: dropping a card in another column
 * assigns `handler.valueForGroup(targetGroupId, schema)` and, separately,
 * re-orders `database.rowIds` so the manual order survives.
 */

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { layout } from "@/config/app.config";
import { getPropertyHandler } from "@/lib/model/property-types";
import type {
  Id,
  Page,
  PropertySchema,
  PropertyValue,
  SelectOption,
  StatusOption,
  User,
} from "@/lib/model/types";
import type { RowGroup } from "@/lib/database/view-engine";
import { Pill } from "@/components/primitives/Pill";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { washColor } from "@/lib/utils/colors";
import { cn } from "@/lib/utils/cn";
import { newId } from "@/lib/utils/id";
import { useDatabaseUi } from "./context";
import { useDatabaseActions, useUsers, useVisibleProperties } from "./hooks";
import { nextOptionColor } from "./cells/OptionPicker";
import { PropertyValueDisplay, isValueBlank } from "./cells/PropertyValueDisplay";
import { TextField } from "./controls";
import type { ViewComponentProps } from "./view-props";

/* ------------------------------------------------------------- drop ids -- */

/**
 * A column needs its own droppable id so an *empty* column still accepts a
 * card. Prefixing keeps it unambiguous against row ids.
 */
const COLUMN_PREFIX = "board-column:";
const NO_GROUP = "__none__";

const columnDropId = (groupId: Id | null) => `${COLUMN_PREFIX}${groupId ?? NO_GROUP}`;
const isColumnDropId = (id: string) => id.startsWith(COLUMN_PREFIX);
const groupIdFromDropId = (id: string): Id | null => {
  const raw = id.slice(COLUMN_PREFIX.length);
  return raw === NO_GROUP ? null : raw;
};

/* ------------------------------------------------------------------ card -- */

interface CardProps {
  row: Page;
  properties: PropertySchema[];
  users: Record<Id, User>;
  onOpen?: () => void;
}

/** The card's visuals, shared by the in-column card and the drag overlay. */
function CardBody({ row, properties, users, onOpen }: CardProps) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        "flex flex-col gap-2 px-[10px] py-2",
        onOpen && "cursor-pointer",
      )}
    >
      <div className="flex items-start gap-1.5">
        {row.icon.type === "emoji" ? (
          <span className="shrink-0 text-[14px] leading-tight">{row.icon.emoji}</span>
        ) : null}
        <span
          className="min-w-0 flex-1 text-sm font-medium leading-snug"
          style={{ color: "var(--tex-pri)" }}
        >
          {row.title || "Untitled"}
        </span>
      </div>

      {properties.map((schema) => {
        const value = row.properties?.[schema.id];
        if (isValueBlank(schema, value, users)) return null;
        return (
          <div key={schema.id} className="flex min-w-0 items-center">
            <PropertyValueDisplay schema={schema} value={value} users={users} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Card wrapper providing the white surface and card shadow.
 *
 * `ref` is taken as a plain prop — React 19 no longer needs `forwardRef`, and
 * dnd-kit's `setNodeRef` attaches through it unchanged.
 */
function CardSurface({
  children,
  dragging,
  tilted,
  style,
  ref,
  ...rest
}: React.ComponentPropsWithRef<"div"> & { dragging?: boolean; tilted?: boolean }) {
  return (
    <div
      ref={ref}
      style={{
        background: "var(--bac-ele)",
        boxShadow: "var(--shadow-card)",
        borderRadius: 4,
        // The overlay copy is tilted; the source card is only faded, so the
        // column keeps its shape while the card is in flight.
        transform: tilted ? "rotate(3deg)" : undefined,
        opacity: dragging ? 0.35 : 1,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function SortableCard(props: CardProps & { groupId: Id | null }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.row.id,
    data: { groupId: props.groupId },
  });

  return (
    <CardSurface
      ref={setNodeRef}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <CardBody {...props} />
    </CardSurface>
  );
}

/* ---------------------------------------------------------------- column -- */

interface ColumnProps {
  group: RowGroup;
  groupBy: PropertySchema;
  properties: PropertySchema[];
  users: Record<Id, User>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAddRow: () => void;
  onRenameGroup: (name: string) => void;
  onDeleteGroup: () => void;
}

function BoardColumn({
  group,
  groupBy,
  properties,
  users,
  collapsed,
  onToggleCollapsed,
  onAddRow,
  onRenameGroup,
  onDeleteGroup,
}: ColumnProps) {
  const { openRow } = useDatabaseUi();
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(group.id) });
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  // Only real options can be renamed or deleted; the "No <property>" bucket
  // is synthesised by the view engine and has no schema entry.
  const isRealGroup = group.id !== null;
  const dot = groupBy.type === "status";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex h-full shrink-0 flex-col items-center gap-2 rounded-md py-2"
        style={{ width: 40, background: washColor(group.color) }}
        title={`Expand ${group.name}`}
      >
        <ChevronRight size={14} style={{ color: "var(--ico-sec)" }} />
        <span
          className="whitespace-nowrap text-xs"
          style={{ writingMode: "vertical-rl", color: "var(--tex-sec)" }}
        >
          {group.name}
        </span>
        <span className="text-xs" style={{ color: "var(--tex-ter)" }}>
          {group.rows.length}
        </span>
      </button>
    );
  }

  return (
    <div
      className="flex shrink-0 flex-col rounded-md"
      style={{
        width: layout.board.columnWidth,
        background: washColor(group.color),
        // A subtle ring while a card hovers makes the drop target obvious
        // without moving anything.
        outline: isOver ? "2px solid var(--accent-ring)" : undefined,
        outlineOffset: -2,
      }}
    >
      {/* -- header -- */}
      <div className="group/header flex items-center gap-1 px-2 py-2">
        <button type="button" onClick={onToggleCollapsed} className="min-w-0">
          <Pill color={group.color} dot={dot} size="sm">
            {group.name}
          </Pill>
        </button>
        <span className="shrink-0 text-xs" style={{ color: "var(--tex-ter)" }}>
          {group.rows.length}
        </span>
        <span className="flex-1" />
        <button
          ref={menuAnchor}
          type="button"
          aria-label="Group options"
          onClick={() => setMenuOpen(true)}
          className="rounded-[4px] p-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 hover:bg-[var(--bac-int-strong)]"
          style={{ color: "var(--ico-sec)" }}
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          type="button"
          aria-label="New page in group"
          onClick={onAddRow}
          className="rounded-[4px] p-0.5 opacity-0 transition-opacity group-hover/header:opacity-100 hover:bg-[var(--bac-int-strong)]"
          style={{ color: "var(--ico-sec)" }}
        >
          <Plus size={14} />
        </button>

        <Popover open={menuOpen} onOpenChange={setMenuOpen} anchor={menuAnchor} align="end">
          {renaming ? (
            <div className="w-[200px] p-2">
              <TextField
                autoFocus
                value={group.name}
                onChange={onRenameGroup}
                placeholder="Group name"
                onSubmit={() => {
                  setRenaming(false);
                  setMenuOpen(false);
                }}
              />
            </div>
          ) : (
            <MenuList className="w-[180px]">
              {isRealGroup ? (
                <MenuItem
                  onSelect={() => setRenaming(true)}
                >
                  Rename
                </MenuItem>
              ) : null}
              <MenuItem
                onSelect={() => {
                  onToggleCollapsed();
                  setMenuOpen(false);
                }}
              >
                Collapse group
              </MenuItem>
              {isRealGroup ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    danger
                    onSelect={() => {
                      onDeleteGroup();
                      setMenuOpen(false);
                    }}
                  >
                    Delete option
                  </MenuItem>
                </>
              ) : null}
            </MenuList>
          )}
        </Popover>
      </div>

      {/* -- cards -- */}
      <div
        ref={setNodeRef}
        className="notion-scroller flex min-h-[40px] flex-1 flex-col overflow-y-auto px-2"
        style={{ gap: layout.board.cardGap }}
      >
        <SortableContext
          items={group.rows.map((row) => row.id)}
          strategy={verticalListSortingStrategy}
        >
          {group.rows.map((row) => (
            <SortableCard
              key={row.id}
              row={row}
              groupId={group.id}
              properties={properties}
              users={users}
              onOpen={() => openRow(row.id)}
            />
          ))}
        </SortableContext>
      </div>

      {/* -- footer -- */}
      <button
        type="button"
        onClick={onAddRow}
        className="mt-2 flex items-center gap-1.5 rounded-b-md px-3 py-2 text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
        style={{ color: "var(--tex-ter)" }}
      >
        <Plus size={14} />
        New page
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ new column -- */

/** Trailing column stub that appends an option to a select/status schema. */
function AddGroupColumn({ onCreate }: { onCreate: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
        style={{ width: layout.board.columnWidth, color: "var(--tex-ter)" }}
      >
        <Plus size={14} />
        Add a group
      </button>
    );
  }

  return (
    <div className="shrink-0 p-1" style={{ width: layout.board.columnWidth }}>
      <TextField
        autoFocus
        value={name}
        onChange={setName}
        placeholder="Group name"
        onSubmit={() => {
          const trimmed = name.trim();
          if (trimmed) onCreate(trimmed);
          setName("");
          setAdding(false);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ view -- */

export function BoardView({ database, view, groups, groupBy }: ViewComponentProps) {
  const users = useUsers();
  const { createRow, moveRow, setPropertyValue, updateProperty, updateView } =
    useDatabaseActions();
  const [activeRowId, setActiveRowId] = useState<Id | null>(null);

  // 4px of travel before a drag starts, so a click still opens the row.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useVisibleProperties(database, view);
  // The group-by column is redundant on the card — the column already says it.
  const cardProperties = useMemo(
    () => visible.filter((p) => p.type !== "title" && p.id !== groupBy?.id),
    [visible, groupBy],
  );

  const rowGroupIndex = useMemo(() => {
    const map = new Map<Id, Id | null>();
    for (const group of groups) for (const row of group.rows) map.set(row.id, group.id);
    return map;
  }, [groups]);

  const activeRow = useMemo(
    () => (activeRowId ? groups.flatMap((g) => g.rows).find((r) => r.id === activeRowId) : undefined),
    [activeRowId, groups],
  );

  const collapsed = view.collapsedGroupIds ?? [];

  if (!groupBy) {
    return (
      <div className="px-2 py-8 text-sm" style={{ color: "var(--tex-ter)" }}>
        This board has no group-by property. Pick one from the view options menu.
      </div>
    );
  }

  const handler = getPropertyHandler(groupBy.type);

  /** Assigns a row to a group and drops it at `index` in the manual order. */
  const commitDrop = (rowId: Id, targetGroupId: Id | null, overId: string) => {
    const sourceGroupId = rowGroupIndex.get(rowId) ?? null;

    if (targetGroupId !== sourceGroupId) {
      setPropertyValue(
        rowId,
        groupBy.id,
        handler.valueForGroup(targetGroupId, groupBy as never) as PropertyValue,
      );
    }

    // `moveRow` removes the row first and *then* inserts, so the index must be
    // computed against the list without it.
    const without = database.rowIds.filter((id) => id !== rowId);
    const targetRows =
      groups.find((g) => g.id === targetGroupId)?.rows.filter((r) => r.id !== rowId) ?? [];

    const anchorId = isColumnDropId(overId) ? undefined : overId;
    const anchorIndex = anchorId ? targetRows.findIndex((r) => r.id === anchorId) : -1;

    let index: number;
    if (anchorIndex >= 0) {
      index = without.indexOf(targetRows[anchorIndex].id);
    } else {
      const last = targetRows[targetRows.length - 1];
      index = last ? without.indexOf(last.id) + 1 : without.length;
    }

    moveRow(database.id, rowId, index);
  };

  const onDragStart = (event: DragStartEvent) => setActiveRowId(String(event.active.id));

  const onDragEnd = (event: DragEndEvent) => {
    setActiveRowId(null);
    const { active, over } = event;
    if (!over) return;

    const rowId = String(active.id);
    const overId = String(over.id);
    if (overId === rowId) return;

    const targetGroupId = isColumnDropId(overId)
      ? groupIdFromDropId(overId)
      : (rowGroupIndex.get(overId) ?? null);

    commitDrop(rowId, targetGroupId, overId);
  };

  /** Appends an option to the group-by schema — the "add a group" column. */
  const createGroupOption = (name: string) => {
    if (groupBy.type === "select") {
      const option: SelectOption = {
        id: newId("option"),
        name,
        color: nextOptionColor(groupBy.options.length),
      };
      updateProperty(database.id, { ...groupBy, options: [...groupBy.options, option] });
    } else if (groupBy.type === "status") {
      const option: StatusOption = {
        id: newId("option"),
        name,
        color: nextOptionColor(groupBy.options.length),
        group: "to-do",
      };
      updateProperty(database.id, { ...groupBy, options: [...groupBy.options, option] });
    }
  };

  // The select and status branches are written out rather than unified: their
  // option arrays are different types, and `Array.map` over a union of array
  // types is not callable in TypeScript.
  const renameGroupOption = (groupId: Id, name: string) => {
    if (groupBy.type === "select") {
      updateProperty(database.id, {
        ...groupBy,
        options: groupBy.options.map((o) => (o.id === groupId ? { ...o, name } : o)),
      });
    } else if (groupBy.type === "status") {
      updateProperty(database.id, {
        ...groupBy,
        options: groupBy.options.map((o) => (o.id === groupId ? { ...o, name } : o)),
      });
    }
  };

  const deleteGroupOption = (groupId: Id) => {
    if (groupBy.type === "select") {
      updateProperty(database.id, {
        ...groupBy,
        options: groupBy.options.filter((o) => o.id !== groupId),
      });
    } else if (groupBy.type === "status") {
      updateProperty(database.id, {
        ...groupBy,
        options: groupBy.options.filter((o) => o.id !== groupId),
      });
    }
  };

  const toggleCollapsed = (groupId: Id | null) => {
    const key = groupId ?? NO_GROUP;
    updateView(view.id, {
      collapsedGroupIds: collapsed.includes(key)
        ? collapsed.filter((id) => id !== key)
        : [...collapsed, key],
    });
  };

  const canAddGroups = groupBy.type === "select" || groupBy.type === "status";

  return (
    <DndContext
      sensors={sensors}
      // closestCorners beats closestCenter across multiple columns: a card
      // dragged to the top of a tall neighbour still resolves to that column.
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveRowId(null)}
    >
      <div
        className="notion-scroller flex items-stretch overflow-x-auto pb-4"
        style={{ gap: layout.board.columnGap }}
      >
        {groups.map((group) => (
          <BoardColumn
            key={group.id ?? NO_GROUP}
            group={group}
            groupBy={groupBy}
            properties={cardProperties}
            users={users}
            collapsed={collapsed.includes(group.id ?? NO_GROUP)}
            onToggleCollapsed={() => toggleCollapsed(group.id)}
            onAddRow={() =>
              createRow(database.id, {
                [groupBy.id]: handler.valueForGroup(group.id, groupBy as never) as PropertyValue,
              })
            }
            onRenameGroup={(name) => group.id && renameGroupOption(group.id, name)}
            onDeleteGroup={() => group.id && deleteGroupOption(group.id)}
          />
        ))}

        {canAddGroups ? <AddGroupColumn onCreate={createGroupOption} /> : null}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeRow ? (
          <CardSurface tilted style={{ width: layout.board.columnWidth - 16 }}>
            <CardBody row={activeRow} properties={cardProperties} users={users} />
          </CardSurface>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
