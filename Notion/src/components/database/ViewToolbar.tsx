"use client";

/**
 * The right-hand toolbar.
 *
 * Icon order is Notion's and is deliberate — filter, sort, automations,
 * search, expand, view options, then the blue New split button. Users navigate
 * this row by position, so it is not sorted by importance or alphabetically.
 */

import { useRef, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ListFilter,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { getPropertyHandler } from "@/lib/model/property-types";
import type {
  Database,
  FilterOperator,
  FilterRule,
  Id,
  PropertySchema,
  SortRule,
  View,
} from "@/lib/model/types";
import { IconButton } from "@/components/primitives/Button";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuLabel, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { newId } from "@/lib/utils/id";
import { useDatabaseActions } from "./hooks";
import { FALLBACK_PROPERTY_ICON, PROPERTY_ICONS } from "./property-icons";
import {
  Dropdown,
  SettingRow,
  TextField,
  Toggle,
  useNestedPopoverGuard,
  type DropdownOption,
} from "./controls";

/** Operators, labelled the way Notion labels them. */
const OPERATORS: DropdownOption<FilterOperator>[] = [
  { value: "contains", label: "Contains" },
  { value: "does_not_contain", label: "Does not contain" },
  { value: "equals", label: "Is" },
  { value: "does_not_equal", label: "Is not" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
];

/** These two operators take no operand, so the value box is suppressed. */
const UNARY_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty"];

export interface ViewToolbarProps {
  database: Database;
  view: View;
  query: string;
  onQueryChange: (query: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Creates a row and opens its peek panel. */
  onNewRow: (position: "start" | "end") => void;
}

export function ViewToolbar({
  database,
  view,
  query,
  onQueryChange,
  expanded,
  onExpandedChange,
  onNewRow,
}: ViewToolbarProps) {
  const { updateView } = useDatabaseActions();

  const filterAnchor = useRef<HTMLButtonElement>(null);
  const sortAnchor = useRef<HTMLButtonElement>(null);
  const automationAnchor = useRef<HTMLButtonElement>(null);
  const optionsAnchor = useRef<HTMLButtonElement>(null);
  const newAnchor = useRef<HTMLButtonElement>(null);

  const [openPanel, setOpenPanel] = useState<
    "filter" | "sort" | "automation" | "options" | "new" | null
  >(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const close = () => setOpenPanel(null);

  // The filter, sort and options panels all host dropdowns, which portal their
  // menus outside the panel. Without this guard, picking an option in one of
  // them would dismiss the panel it belongs to.
  const { onNestedOpenChange, guardClose } = useNestedPopoverGuard();
  const closeGuarded = guardClose(close);

  const propertyOptions: DropdownOption<Id>[] = database.properties.map((schema) => {
    const Icon = (PROPERTY_ICONS[getPropertyHandler(schema.type).icon] ?? FALLBACK_PROPERTY_ICON);
    return { value: schema.id, label: schema.name, icon: <Icon size={13} /> };
  });

  /* ------------------------------------------------------------- filters -- */

  const setFilters = (filters: FilterRule[]) => updateView(view.id, { filters });

  const addFilter = () => {
    const first = database.properties[0];
    if (!first) return;
    setFilters([
      ...view.filters,
      { id: newId("filter"), propertyId: first.id, operator: "contains", value: "" },
    ]);
  };

  const patchFilter = (id: Id, patch: Partial<FilterRule>) =>
    setFilters(view.filters.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  /* --------------------------------------------------------------- sorts -- */

  const setSorts = (sorts: SortRule[]) => updateView(view.id, { sorts });

  const addSort = () => {
    // Offer a column that is not already sorted, so a second click is useful.
    const used = new Set(view.sorts.map((s) => s.propertyId));
    const next = database.properties.find((p) => !used.has(p.id)) ?? database.properties[0];
    if (!next) return;
    setSorts([...view.sorts, { id: newId("sort"), propertyId: next.id, direction: "ascending" }]);
  };

  const patchSort = (id: Id, patch: Partial<SortRule>) =>
    setSorts(view.sorts.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));

  /* ------------------------------------------------------------- options -- */

  const toggleProperty = (schema: PropertySchema) => {
    const visible = view.visiblePropertyIds.includes(schema.id);
    updateView(view.id, {
      visiblePropertyIds: visible
        ? view.visiblePropertyIds.filter((id) => id !== schema.id)
        : [...view.visiblePropertyIds, schema.id],
    });
  };

  // Only handlers that declare `canGroup` may drive a board's columns.
  const groupableOptions: DropdownOption<string>[] = [
    { value: "", label: "None" },
    ...database.properties
      .filter((schema) => getPropertyHandler(schema.type).canGroup)
      .map((schema) => ({ value: schema.id, label: schema.name })),
  ];

  const activeFilterCount = view.filters.length;
  const activeSortCount = view.sorts.length;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* -- filter -- */}
      <IconButton
        ref={filterAnchor}
        label="Filter"
        size={26}
        onClick={() => setOpenPanel(openPanel === "filter" ? null : "filter")}
      >
        {/* Tint lives on the glyph, not on the button: `IconButton` spreads
            `style` last and would lose its own width/height if we set it. */}
        <ListFilter size={15} color={activeFilterCount ? "var(--accent-text)" : undefined} />
      </IconButton>

      <Popover
        open={openPanel === "filter"}
        onOpenChange={closeGuarded}
        anchor={filterAnchor}
        align="end"
        width={420}
      >
        <div className="p-2">
          {view.filters.length === 0 ? (
            <div className="px-1 py-2 text-sm" style={{ color: "var(--tex-ter)" }}>
              No filters yet.
            </div>
          ) : (
            view.filters.map((rule) => (
              <div key={rule.id} className="mb-1 flex items-center gap-1">
                <Dropdown
                  onOpenChange={onNestedOpenChange}
                  className="w-[130px]"
                  value={rule.propertyId}
                  options={propertyOptions}
                  onChange={(propertyId) => patchFilter(rule.id, { propertyId })}
                />
                <Dropdown
                  onOpenChange={onNestedOpenChange}
                  className="w-[120px]"
                  value={rule.operator}
                  options={OPERATORS}
                  onChange={(operator) => patchFilter(rule.id, { operator })}
                />
                {UNARY_OPERATORS.includes(rule.operator) ? (
                  <span className="flex-1" />
                ) : (
                  <span className="flex-1">
                    <TextField
                      value={String(rule.value ?? "")}
                      onChange={(value) => patchFilter(rule.id, { value })}
                      placeholder="Value"
                    />
                  </span>
                )}
                <IconButton
                  label="Remove filter"
                  size={24}
                  onClick={() => setFilters(view.filters.filter((f) => f.id !== rule.id))}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))
          )}
        </div>
        <MenuSeparator />
        <MenuList>
          <MenuItem icon={<Plus size={14} />} onSelect={addFilter}>
            Add filter
          </MenuItem>
        </MenuList>
      </Popover>

      {/* -- sort -- */}
      <IconButton
        ref={sortAnchor}
        label="Sort"
        size={26}
        onClick={() => setOpenPanel(openPanel === "sort" ? null : "sort")}
      >
        <ArrowUpDown size={15} color={activeSortCount ? "var(--accent-text)" : undefined} />
      </IconButton>

      <Popover
        open={openPanel === "sort"}
        onOpenChange={closeGuarded}
        anchor={sortAnchor}
        align="end"
        width={360}
      >
        <div className="p-2">
          {view.sorts.length === 0 ? (
            <div className="px-1 py-2 text-sm" style={{ color: "var(--tex-ter)" }}>
              No sorts yet.
            </div>
          ) : (
            view.sorts.map((rule) => (
              <div key={rule.id} className="mb-1 flex items-center gap-1">
                <Dropdown
                  onOpenChange={onNestedOpenChange}
                  className="flex-1"
                  value={rule.propertyId}
                  options={propertyOptions}
                  onChange={(propertyId) => patchSort(rule.id, { propertyId })}
                />
                <Dropdown
                  onOpenChange={onNestedOpenChange}
                  className="w-[120px]"
                  value={rule.direction}
                  options={[
                    { value: "ascending", label: "Ascending" },
                    { value: "descending", label: "Descending" },
                  ]}
                  onChange={(direction) => patchSort(rule.id, { direction })}
                />
                <IconButton
                  label="Remove sort"
                  size={24}
                  onClick={() => setSorts(view.sorts.filter((s) => s.id !== rule.id))}
                >
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))
          )}
        </div>
        <MenuSeparator />
        <MenuList>
          <MenuItem icon={<Plus size={14} />} onSelect={addSort}>
            Add sort
          </MenuItem>
        </MenuList>
      </Popover>

      {/* -- automations -- */}
      <IconButton
        ref={automationAnchor}
        label="Automations"
        size={26}
        onClick={() => setOpenPanel(openPanel === "automation" ? null : "automation")}
      >
        <Zap size={15} />
      </IconButton>

      <Popover
        open={openPanel === "automation"}
        onOpenChange={close}
        anchor={automationAnchor}
        align="end"
        width={280}
      >
        <MenuList>
          <MenuLabel>Automations</MenuLabel>
          <div className="px-3 pb-2 text-sm" style={{ color: "var(--tex-ter)" }}>
            No automations on this database yet.
          </div>
          <MenuSeparator />
          <MenuItem icon={<Plus size={14} />} disabled>
            New automation
          </MenuItem>
        </MenuList>
      </Popover>

      {/* -- search -- */}
      {searchOpen ? (
        <div
          className="flex h-[26px] items-center gap-1 rounded-[4px] px-1.5"
          style={{ background: "var(--bac-int)" }}
        >
          <Search size={13} style={{ color: "var(--ico-sec)" }} />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onQueryChange("");
                setSearchOpen(false);
              }
            }}
            placeholder="Type to search…"
            className="w-[150px] bg-transparent text-sm outline-hidden placeholder:text-[var(--tex-ter)]"
            style={{ color: "var(--tex-pri)" }}
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              onQueryChange("");
              setSearchOpen(false);
            }}
            style={{ color: "var(--ico-sec)" }}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <IconButton label="Search" size={26} onClick={() => setSearchOpen(true)}>
          <Search size={15} />
        </IconButton>
      )}

      {/* -- expand -- */}
      <IconButton
        label={expanded ? "Collapse" : "Expand"}
        size={26}
        onClick={() => onExpandedChange(!expanded)}
      >
        {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </IconButton>

      {/* -- view options -- */}
      <IconButton
        ref={optionsAnchor}
        label="View options"
        size={26}
        onClick={() => setOpenPanel(openPanel === "options" ? null : "options")}
      >
        <SlidersHorizontal size={15} />
      </IconButton>

      <Popover
        open={openPanel === "options"}
        onOpenChange={closeGuarded}
        anchor={optionsAnchor}
        align="end"
        width={280}
      >
        <div className="p-2">
          <TextField
            value={view.name}
            onChange={(name) => updateView(view.id, { name })}
            onSubmit={close}
            placeholder="View name"
          />
        </div>

        <MenuSeparator />

        {/* Grouping only offers columns whose handler says it can group. */}
        <MenuLabel>Group by</MenuLabel>
        <div className="px-2 pb-1">
          <Dropdown
                  onOpenChange={onNestedOpenChange}
            className="w-full"
            value={view.groupByPropertyId ?? ""}
            options={groupableOptions}
            onChange={(propertyId) =>
              updateView(view.id, { groupByPropertyId: propertyId || undefined })
            }
          />
        </div>

        <SettingRow label="Hide empty groups">
          <Toggle
            label="Hide empty groups"
            checked={view.hideEmptyGroups ?? false}
            onChange={(hideEmptyGroups) => updateView(view.id, { hideEmptyGroups })}
          />
        </SettingRow>

        <MenuSeparator />

        <MenuLabel>Properties</MenuLabel>
        <div className="max-h-64 overflow-y-auto pb-1">
          {database.properties
            // The title column is structural and is always shown.
            .filter((schema) => schema.type !== "title")
            .map((schema) => {
              const Icon = (PROPERTY_ICONS[getPropertyHandler(schema.type).icon] ?? FALLBACK_PROPERTY_ICON);
              return (
                <SettingRow key={schema.id} label={schema.name} icon={<Icon size={14} />}>
                  <Toggle
                    label={schema.name}
                    checked={view.visiblePropertyIds.includes(schema.id)}
                    onChange={() => toggleProperty(schema)}
                  />
                </SettingRow>
              );
            })}
        </div>
      </Popover>

      {/* -- new (split button) -- */}
      <div className="ml-1 flex items-stretch overflow-hidden rounded-[4px]">
        <button
          type="button"
          onClick={() => onNewRow("end")}
          style={{ background: "var(--accent)" }}
          className="flex h-[26px] items-center px-2.5 text-sm font-medium text-white transition-[filter] hover:brightness-95"
        >
          New
        </button>
        <span className="w-px" style={{ background: "rgba(255,255,255,0.28)" }} />
        <button
          ref={newAnchor}
          type="button"
          aria-label="New page options"
          onClick={() => setOpenPanel(openPanel === "new" ? null : "new")}
          style={{ background: "var(--accent)" }}
          className="flex h-[26px] items-center px-1 text-white transition-[filter] hover:brightness-95"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      <Popover
        open={openPanel === "new"}
        onOpenChange={close}
        anchor={newAnchor}
        align="end"
        width={220}
      >
        <MenuList>
          <MenuLabel>New page</MenuLabel>
          <MenuItem
            onSelect={() => {
              onNewRow("end");
              close();
            }}
          >
            At the bottom
          </MenuItem>
          <MenuItem
            onSelect={() => {
              onNewRow("start");
              close();
            }}
          >
            At the top
          </MenuItem>
        </MenuList>
      </Popover>
    </div>
  );
}
