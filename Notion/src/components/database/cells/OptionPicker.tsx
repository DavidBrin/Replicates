"use client";

/**
 * The searchable option list behind select, multi-select and status cells.
 *
 * Notion uses one picker for all three; the only differences are whether the
 * selection is a set or a single value, whether pills carry a dot, and whether
 * the options are clustered by status group. Those are props, not three
 * components.
 */

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Pill } from "@/components/primitives/Pill";
import { NOTION_COLORS, type NotionColor, type SelectOption } from "@/lib/model/types";
import { cn } from "@/lib/utils/cn";

export interface OptionPickerProps {
  options: SelectOption[];
  selectedIds: string[];
  /** Multi-select keeps the panel open and accumulates; select closes on pick. */
  multiple?: boolean;
  /** Status pills carry the leading dot. */
  dot?: boolean;
  /** Optional grouping header per option id (status groups). */
  groupOf?: (option: SelectOption) => string;
  onToggle: (optionId: string) => void;
  onClear: () => void;
  onCreate: (name: string) => void;
}

/**
 * Colour for a newly created option. Cycling through the palette by option
 * count reproduces Notion's behaviour of never handing out the same colour
 * twice in a row.
 */
export function nextOptionColor(existing: number): NotionColor {
  // Skip "default" so a fresh tag is always visibly coloured.
  const palette = NOTION_COLORS.filter((c) => c !== "default");
  return palette[existing % palette.length];
}

export function OptionPicker({
  options,
  selectedIds,
  multiple = false,
  dot = false,
  groupOf,
  onToggle,
  onClear,
  onCreate,
}: OptionPickerProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () => options.filter((o) => o.name.toLowerCase().includes(needle)),
    [options, needle],
  );

  // Only offer "Create" when the typed name is genuinely new.
  const canCreate =
    needle.length > 0 && !options.some((o) => o.name.toLowerCase() === needle);

  const selected = options.filter((o) => selectedIds.includes(o.id));

  /** Renders one section of the list, with a heading when grouping is on. */
  const sections = useMemo(() => {
    if (!groupOf) return [{ label: null as string | null, items: matches }];
    const byGroup = new Map<string, SelectOption[]>();
    for (const option of matches) {
      const key = groupOf(option);
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(option);
      else byGroup.set(key, [option]);
    }
    return [...byGroup].map(([label, items]) => ({ label, items }));
  }, [groupOf, matches]);

  return (
    <div className="w-[260px]">
      {/* Selection summary doubles as the search box, exactly as Notion's does. */}
      <div
        className="flex flex-wrap items-center gap-1 p-2"
        style={{ background: "var(--bac-sec)" }}
      >
        {selected.map((option) => (
          <Pill key={option.id} color={option.color} dot={dot} size="sm" onRemove={() => onToggle(option.id)}>
            {option.name}
          </Pill>
        ))}
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (matches[0] && !canCreate) onToggle(matches[0].id);
              else if (canCreate) onCreate(query.trim());
              setQuery("");
            }
            // Backspace on an empty query peels the last tag off.
            if (event.key === "Backspace" && query === "" && selected.length > 0) {
              onToggle(selected[selected.length - 1].id);
            }
          }}
          placeholder={selected.length ? "" : "Search for an option…"}
          className="min-w-[80px] flex-1 bg-transparent text-sm outline-hidden placeholder:text-[var(--tex-ter)]"
          style={{ color: "var(--tex-pri)" }}
        />
        {selected.length > 0 ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={onClear}
            className="shrink-0 rounded-[3px] p-0.5 hover:bg-[var(--bac-int-strong)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        <div className="px-3 pb-1 pt-1 text-[11px] font-medium" style={{ color: "var(--tex-ter)" }}>
          Select an option{multiple ? "s" : ""} or create one
        </div>

        {sections.map((section) => (
          <div key={section.label ?? "all"}>
            {section.label ? (
              <div
                className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide"
                style={{ color: "var(--tex-ter)" }}
              >
                {section.label}
              </div>
            ) : null}
            {section.items.map((option) => {
              const isSelected = selectedIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onToggle(option.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1 text-left",
                    "transition-colors duration-75 hover:bg-[var(--bac-int)]",
                  )}
                >
                  <Pill color={option.color} dot={dot} size="sm">
                    {option.name}
                  </Pill>
                  <span className="flex-1" />
                  {isSelected ? <Check size={14} style={{ color: "var(--ico-sec)" }} /> : null}
                </button>
              );
            })}
          </div>
        ))}

        {canCreate ? (
          <button
            type="button"
            onClick={() => {
              onCreate(query.trim());
              setQuery("");
            }}
            className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
            style={{ color: "var(--tex-sec)" }}
          >
            <Plus size={13} />
            <span>Create</span>
            <Pill color={nextOptionColor(options.length)} dot={dot} size="sm">
              {query.trim()}
            </Pill>
          </button>
        ) : null}

        {matches.length === 0 && !canCreate ? (
          <div className="px-3 py-2 text-sm" style={{ color: "var(--tex-ter)" }}>
            No results
          </div>
        ) : null}
      </div>
    </div>
  );
}
