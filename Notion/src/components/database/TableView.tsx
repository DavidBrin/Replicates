"use client";

/**
 * Table view.
 *
 * Built from flex rows rather than a real `<table>`: a table element cannot
 * express a sticky first column together with per-column pixel widths that the
 * user drags, without fighting the browser's own column algorithm the whole
 * way. Each row is a flex line whose cells carry explicit widths, so the header
 * and the body stay aligned by construction.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Maximize2,
  Plus,
  Trash2,
  EyeOff,
} from "lucide-react";
import { layout } from "@/config/app.config";
import {
  getPropertyHandler,
  listPropertyHandlers,
} from "@/lib/model/property-types";
import type {
  Id,
  Page,
  PropertySchema,
  PropertyType,
  PropertyValue,
} from "@/lib/model/types";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuLabel, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { newId } from "@/lib/utils/id";
import { cn } from "@/lib/utils/cn";
import { useDatabaseUi } from "./context";
import { useDatabaseActions, useVisibleProperties } from "./hooks";
import { PropertyCell } from "./cells/PropertyCell";
import { FALLBACK_PROPERTY_ICON, PROPERTY_ICONS } from "./property-icons";
import { TextField } from "./controls";
import type { ViewComponentProps } from "./view-props";

/* --------------------------------------------------------------- helpers -- */

/** Fresh schema for a newly added or retyped column. */
function blankSchema(id: Id, name: string, type: PropertyType): PropertySchema {
  switch (type) {
    case "number":
      return { id, name, type, format: "number" };
    case "select":
    case "multi_select":
      return { id, name, type, options: [] };
    case "status":
      return { id, name, type, options: [] };
    default:
      // Every remaining variant is just `{ id, name, type }`.
      return { id, name, type } as PropertySchema;
  }
}

/* ---------------------------------------------------------- header cell -- */

interface HeaderCellProps {
  schema: PropertySchema;
  width: number;
  sticky?: boolean;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onRename: (name: string) => void;
  onChangeType: (type: PropertyType) => void;
  onSort: (direction: "ascending" | "descending") => void;
  onHide: () => void;
  onDelete: () => void;
}

function HeaderCell({
  schema,
  width,
  sticky,
  onResize,
  onResizeEnd,
  onRename,
  onChangeType,
  onSort,
  onHide,
  onDelete,
}: HeaderCellProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [typeMenu, setTypeMenu] = useState(false);

  const handler = getPropertyHandler(schema.type);
  const Icon = (PROPERTY_ICONS[handler.icon] ?? FALLBACK_PROPERTY_ICON);
  // The title column is structural: Notion will not let you retype or delete
  // it, and neither will the store.
  const isTitle = schema.type === "title";

  /**
   * Resizing is driven off raw pointer events on the 5px seam rather than a
   * drag library: it is one axis, one element, and no drop target.
   */
  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;

    const move = (e: PointerEvent) => {
      onResize(Math.max(layout.table.minColumnWidth, startWidth + e.clientX - startX));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(Math.max(layout.table.minColumnWidth, startWidth + e.clientX - startX));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className={cn("relative shrink-0 border-r", sticky && "sticky left-0 z-20")}
      style={{ width, borderColor: "var(--bor-pri)", background: "var(--bac-pri)" }}
    >
      <button
        ref={anchor}
        type="button"
        onClick={() => {
          setTypeMenu(false);
          setOpen(true);
        }}
        className="flex h-8 w-full items-center gap-1.5 px-2 text-left transition-colors duration-75 hover:bg-[var(--bac-int)]"
        style={{ color: "var(--tex-sec)" }}
      >
        <Icon size={13} style={{ color: "var(--ico-sec)" }} />
        <span className="truncate text-xs">{schema.name}</span>
      </button>

      {/* Resize seam. Sits on the border so the cursor change reads as the
          column edge itself being grabbed. */}
      <div
        onPointerDown={startResize}
        className="absolute inset-y-0 -right-[2px] z-10 w-[5px] cursor-col-resize hover:bg-[var(--accent)]"
      />

      <Popover open={open} onOpenChange={setOpen} anchor={anchor} width={220}>
        {typeMenu ? (
          <MenuList className="max-h-80 overflow-y-auto">
            <MenuLabel>Property type</MenuLabel>
            {listPropertyHandlers()
              .filter((h) => h.type !== "title")
              .map((h) => {
                const TypeIcon = (PROPERTY_ICONS[h.icon] ?? FALLBACK_PROPERTY_ICON);
                return (
                  <MenuItem
                    key={h.type}
                    icon={<TypeIcon size={14} />}
                    selected={h.type === schema.type}
                    onSelect={() => {
                      onChangeType(h.type);
                      setOpen(false);
                    }}
                  >
                    {h.label}
                  </MenuItem>
                );
              })}
          </MenuList>
        ) : (
          <>
            <div className="p-2">
              {/* Writes through on every keystroke rather than on Enter:
                  dismissing the popover is the natural way to finish, and a
                  draft would silently discard the edit. */}
              <TextField
                autoFocus
                value={schema.name}
                onChange={onRename}
                placeholder="Property name"
                onSubmit={() => setOpen(false)}
              />
            </div>
            <MenuList>
              {!isTitle ? (
                <MenuItem
                  icon={<Icon size={14} />}
                  hint={handler.label}
                  onSelect={() => setTypeMenu(true)}
                >
                  Type
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem icon={<ArrowUp size={14} />} onSelect={() => { onSort("ascending"); setOpen(false); }}>
                Sort ascending
              </MenuItem>
              <MenuItem icon={<ArrowDown size={14} />} onSelect={() => { onSort("descending"); setOpen(false); }}>
                Sort descending
              </MenuItem>
              {!isTitle ? (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<EyeOff size={14} />} onSelect={() => { onHide(); setOpen(false); }}>
                    Hide in view
                  </MenuItem>
                  <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => { onDelete(); setOpen(false); }}>
                    Delete property
                  </MenuItem>
                </>
              ) : null}
            </MenuList>
          </>
        )}
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------- body row -- */

interface BodyRowProps {
  row: Page;
  databaseId: Id;
  columns: PropertySchema[];
  widthOf: (schema: PropertySchema) => number;
  onOpen: () => void;
}

function BodyRow({ row, databaseId, columns, widthOf, onOpen }: BodyRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });

  const [titleColumn, ...rest] = columns;
  // Defensive: a database with no columns at all has nothing to lay out, and
  // the sticky-title branch below would dereference `undefined`.
  if (!titleColumn) return null;

  return (
    <div
      ref={setNodeRef}
      className="group/row relative flex border-b"
      style={{
        height: layout.table.rowHeight,
        borderColor: "var(--bor-pri)",
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        // A dragging row must float above the sticky title column.
        zIndex: isDragging ? 30 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      {/* Title cell: sticky, and the only one with row affordances. */}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center border-r bg-[var(--bac-pri)]"
        style={{ width: widthOf(titleColumn), borderColor: "var(--bor-pri)" }}
      >
        {/* Hover wash painted as its own layer so the sticky cell composites
            identically to the transparent cells scrolling behind it. */}
        <span className="pointer-events-none absolute inset-0 group-hover/row:bg-[var(--bac-int)]" />

        <button
          type="button"
          aria-label="Reorder row"
          className="relative z-10 flex h-full w-4 shrink-0 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover/row:opacity-100"
          style={{ color: "var(--ico-ter)" }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={12} />
        </button>

        <span className="relative z-10 min-w-0 flex-1">
          <PropertyCell
            databaseId={databaseId}
            rowId={row.id}
            schema={titleColumn}
            value={row.properties?.[titleColumn.id]}
          />
        </span>

        <button
          type="button"
          onClick={onOpen}
          className="relative z-10 mr-1 flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium tracking-wide opacity-0 transition-opacity group-hover/row:opacity-100"
          style={{ background: "var(--bac-int-strong)", color: "var(--tex-sec)" }}
        >
          <Maximize2 size={10} />
          OPEN
        </button>
      </div>

      {rest.map((schema) => (
        <div
          key={schema.id}
          className="relative flex shrink-0 items-center border-r group-hover/row:bg-[var(--bac-int)]"
          style={{ width: widthOf(schema), borderColor: "var(--bor-pri)" }}
        >
          <PropertyCell
            databaseId={databaseId}
            rowId={row.id}
            schema={schema}
            value={row.properties?.[schema.id]}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ view -- */

export function TableView({ database, view, rows }: ViewComponentProps) {
  const { openRow } = useDatabaseUi();
  const {
    createRow,
    moveRow,
    addProperty,
    updateProperty,
    removeProperty,
    setPropertyValue,
    updateView,
  } = useDatabaseActions();

  /** Widths mid-drag, before they are committed to the view. */
  const [liveWidths, setLiveWidths] = useState<Record<Id, number>>({});
  const addAnchor = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const visible = useVisibleProperties(database, view);

  // The title column always leads and is always shown — it is what names a row.
  const columns = useMemo(() => {
    const title = database.properties.find((p) => p.type === "title");
    const others = visible.filter((p) => p.type !== "title");
    return title ? [title, ...others] : others;
  }, [database.properties, visible]);

  const widthOf = useCallback(
    (schema: PropertySchema) =>
      liveWidths[schema.id] ??
      view.columnWidths?.[schema.id] ??
      (schema.type === "title" ? layout.table.titleColumnWidth : layout.table.defaultColumnWidth),
    [liveWidths, view.columnWidths],
  );

  // +36 for the trailing "add a property" button, so the header never clips.
  const totalWidth = columns.reduce((sum, schema) => sum + widthOf(schema), 36);

  /* -- column operations -- */

  /**
   * Persists the dragged width and drops the live override in the same batch,
   * so the committed value takes over without a frame showing the old number.
   */
  const commitWidth = (schema: PropertySchema, width: number) => {
    updateView(view.id, { columnWidths: { ...(view.columnWidths ?? {}), [schema.id]: width } });
    setLiveWidths((current) => {
      const next = { ...current };
      delete next[schema.id];
      return next;
    });
  };

  const renameColumn = (schema: PropertySchema, name: string) =>
    updateProperty(database.id, { ...schema, name });

  const changeColumnType = (schema: PropertySchema, type: PropertyType) => {
    if (type === schema.type) return;
    const next = blankSchema(schema.id, schema.name, type);
    updateProperty(database.id, next);
    // Values of the old type would be unreadable under the new one, so every
    // cell is reset to the new type's empty value rather than left mismatched.
    const handler = getPropertyHandler(type);
    for (const rowId of database.rowIds) {
      setPropertyValue(rowId, schema.id, handler.empty(next as never) as PropertyValue);
    }
  };

  const sortByColumn = (schema: PropertySchema, direction: "ascending" | "descending") =>
    updateView(view.id, {
      sorts: [{ id: newId("sort"), propertyId: schema.id, direction }],
    });

  const hideColumn = (schema: PropertySchema) =>
    updateView(view.id, {
      visiblePropertyIds: view.visiblePropertyIds.filter((id) => id !== schema.id),
    });

  const addColumn = (type: PropertyType) => {
    const handler = getPropertyHandler(type);
    addProperty(database.id, blankSchema(newId("prop"), handler.label, type));
    setAddOpen(false);
  };

  /* -- row reordering -- */

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const rowId = String(active.id);
    const overId = String(over.id);
    // `moveRow` deletes before it inserts, so index against the list without it.
    const without = database.rowIds.filter((id) => id !== rowId);
    const index = without.indexOf(overId);
    if (index >= 0) moveRow(database.id, rowId, index);
  };

  return (
    <div className="notion-scroller w-full overflow-x-auto">
      <div style={{ minWidth: totalWidth }}>
        {/* -- header -- */}
        <div className="flex border-y" style={{ borderColor: "var(--bor-pri)" }}>
          {columns.map((schema, index) => (
            <HeaderCell
              key={schema.id}
              schema={schema}
              sticky={index === 0}
              width={widthOf(schema)}
              onResize={(width) => setLiveWidths((w) => ({ ...w, [schema.id]: width }))}
              onResizeEnd={(width) => commitWidth(schema, width)}
              onRename={(name) => renameColumn(schema, name)}
              onChangeType={(type) => changeColumnType(schema, type)}
              onSort={(direction) => sortByColumn(schema, direction)}
              onHide={() => hideColumn(schema)}
              onDelete={() => removeProperty(database.id, schema.id)}
            />
          ))}

          <button
            ref={addAnchor}
            type="button"
            aria-label="Add a property"
            onClick={() => setAddOpen(true)}
            className="flex h-8 w-9 shrink-0 items-center justify-center transition-colors duration-75 hover:bg-[var(--bac-int)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <Plus size={14} />
          </button>

          <Popover open={addOpen} onOpenChange={setAddOpen} anchor={addAnchor} align="end" width={220}>
            <MenuList className="max-h-80 overflow-y-auto">
              <MenuLabel>New property</MenuLabel>
              {listPropertyHandlers()
                .filter((h) => h.type !== "title")
                .map((h) => {
                  const TypeIcon = (PROPERTY_ICONS[h.icon] ?? FALLBACK_PROPERTY_ICON);
                  return (
                    <MenuItem key={h.type} icon={<TypeIcon size={14} />} onSelect={() => addColumn(h.type)}>
                      {h.label}
                    </MenuItem>
                  );
                })}
            </MenuList>
          </Popover>
        </div>

        {/* -- body -- */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {rows.map((row) => (
              <BodyRow
                key={row.id}
                row={row}
                databaseId={database.id}
                columns={columns}
                widthOf={widthOf}
                onOpen={() => openRow(row.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* -- new row -- */}
        <button
          type="button"
          onClick={() => createRow(database.id)}
          className="flex w-full items-center gap-1.5 border-b px-2 text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
          style={{
            height: layout.table.rowHeight,
            borderColor: "var(--bor-pri)",
            color: "var(--tex-ter)",
          }}
        >
          <Plus size={14} />
          New
        </button>

        {/* -- summary -- */}
        <div className="flex" style={{ height: 32 }}>
          <div
            className="flex shrink-0 items-center justify-end px-2 text-xs"
            style={{ width: columns[0] ? widthOf(columns[0]) : 0, color: "var(--tex-ter)" }}
          >
            COUNT&nbsp;
            <span style={{ color: "var(--tex-sec)" }}>{rows.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
