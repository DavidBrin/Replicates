"use client";

/**
 * Compact read-only rendering of a property value — board cards, list rows and
 * calendar events.
 *
 * Editing is not always appropriate: a board card that opened a picker on every
 * click would be undraggable. So the display path is separate from the editor
 * path, and like the editors it dispatches through a registry rather than a
 * switch. Everything that is *not* a pill, avatar or checkbox falls through to
 * the handler's `toPlainText`, which is why adding a column type needs no entry
 * here at all.
 */

import type { ComponentType } from "react";
import { Check } from "lucide-react";
import { getPropertyHandler } from "@/lib/model/property-types";
import { AvatarStack } from "@/components/primitives/Avatar";
import { Pill } from "@/components/primitives/Pill";
import type { Id, PropertySchema, PropertyType, PropertyValue, User } from "@/lib/model/types";

export interface DisplayProps {
  schema: PropertySchema;
  value: PropertyValue | undefined;
  users: Record<Id, User>;
}

/** Muted plain text — the fallback for every scalar column type. */
function TextDisplay({ schema, value, users }: DisplayProps) {
  const handler = getPropertyHandler(schema.type);
  const text = handler.toPlainText(value as never, schema as never, { users });
  if (!text) return null;
  return (
    <span className="truncate text-xs" style={{ color: "var(--tex-sec)" }}>
      {text}
    </span>
  );
}

function SelectDisplay({ schema, value }: DisplayProps) {
  if (schema.type !== "select" || value?.type !== "select") return null;
  const option = schema.options.find((o) => o.id === value.select);
  if (!option) return null;
  return (
    <Pill color={option.color} size="sm">
      {option.name}
    </Pill>
  );
}

function StatusDisplay({ schema, value }: DisplayProps) {
  if (schema.type !== "status" || value?.type !== "status") return null;
  const option = schema.options.find((o) => o.id === value.status);
  if (!option) return null;
  return (
    <Pill color={option.color} dot size="sm">
      {option.name}
    </Pill>
  );
}

function MultiSelectDisplay({ schema, value }: DisplayProps) {
  if (schema.type !== "multi_select" || value?.type !== "multi_select") return null;
  const options = schema.options.filter((o) => value.multi_select.includes(o.id));
  if (options.length === 0) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {options.map((option) => (
        <Pill key={option.id} color={option.color} size="sm">
          {option.name}
        </Pill>
      ))}
    </span>
  );
}

function PeopleDisplay({ value, users }: DisplayProps) {
  if (value?.type !== "people" || value.people.length === 0) return null;
  const people = value.people.map((id) => users[id]).filter(Boolean);
  if (people.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <AvatarStack users={people} size={18} max={3} />
      <span className="truncate text-xs" style={{ color: "var(--tex-sec)" }}>
        {people.map((u) => u?.name).join(", ")}
      </span>
    </span>
  );
}

function CheckboxDisplay({ value }: DisplayProps) {
  const checked = value?.type === "checkbox" ? value.checkbox : false;
  return (
    <span
      className="flex h-[13px] w-[13px] items-center justify-center rounded-[3px] border"
      style={{
        background: checked ? "var(--accent)" : "transparent",
        borderColor: checked ? "var(--accent)" : "var(--bor-str)",
      }}
    >
      {checked ? <Check size={10} strokeWidth={3} color="#fff" /> : null}
    </span>
  );
}

/** Only the types whose display is *not* plain text need an entry. */
const DISPLAY_REGISTRY: Partial<Record<PropertyType, ComponentType<DisplayProps>>> = {
  select: SelectDisplay,
  status: StatusDisplay,
  multi_select: MultiSelectDisplay,
  people: PeopleDisplay,
  checkbox: CheckboxDisplay,
};

export function PropertyValueDisplay(props: DisplayProps) {
  const Display = DISPLAY_REGISTRY[props.schema.type] ?? TextDisplay;
  return <Display {...props} />;
}

/** True when there is nothing worth painting — lets callers skip the row. */
export function isValueBlank(
  schema: PropertySchema,
  value: PropertyValue | undefined,
  users: Record<Id, User>,
): boolean {
  const handler = getPropertyHandler(schema.type);
  return handler.isEmpty(value as never, schema as never, { users });
}
