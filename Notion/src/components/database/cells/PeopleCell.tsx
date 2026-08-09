"use client";

import { useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Popover } from "@/components/primitives/Popover";
import { Avatar, AvatarStack } from "@/components/primitives/Avatar";
import { useDatabaseActions, useUsers } from "../hooks";
import { CellTrigger, EmptyHint, type CellProps } from "./shared";

/**
 * People cell — a member search over the workspace's users.
 *
 * The searchable set is every known user rather than the workspace membership
 * list, because a row can legitimately reference someone whose membership was
 * revoked and we must still be able to show and clear them.
 */
export function PeopleCell({ rowId, schema, value, variant = "table" }: CellProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const users = useUsers();
  const { setPropertyValue } = useDatabaseActions();

  const selectedIds = value?.type === "people" ? value.people : [];

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.values(users)
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, query]);

  if (schema.type !== "people") return null;

  const assign = (ids: string[]) =>
    setPropertyValue(rowId, schema.id, { type: "people", people: ids });

  const selected = selectedIds.map((id) => users[id]).filter(Boolean);

  return (
    <>
      <CellTrigger ref={anchor} variant={variant} onClick={() => setOpen(true)}>
        {selected.length > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <AvatarStack users={selected} size={18} max={3} />
            <span className="truncate" style={{ color: "var(--tex-pri)" }}>
              {selected.map((u) => u?.name).join(", ")}
            </span>
          </span>
        ) : (
          <EmptyHint />
        )}
      </CellTrigger>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor} width={260}>
        <div className="flex flex-wrap items-center gap-1 p-2" style={{ background: "var(--bac-sec)" }}>
          {selected.map((user) => (
            <span
              key={user!.id}
              className="inline-flex items-center gap-1 rounded-[3px] px-1 py-0.5 text-xs"
              style={{ background: "var(--bac-ter)", color: "var(--tex-pri)" }}
            >
              <Avatar user={user} size={14} />
              {user!.name}
              <button
                type="button"
                aria-label={`Remove ${user!.name}`}
                onClick={() => assign(selectedIds.filter((id) => id !== user!.id))}
                className="opacity-50 hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={selected.length ? "" : "Search for a person…"}
            className="min-w-[80px] flex-1 bg-transparent text-sm outline-hidden placeholder:text-[var(--tex-ter)]"
            style={{ color: "var(--tex-pri)" }}
          />
        </div>

        <div className="max-h-64 overflow-y-auto py-1">
          {candidates.map((user) => {
            const isSelected = selectedIds.includes(user.id);
            return (
              <button
                key={user.id}
                type="button"
                onClick={() =>
                  assign(
                    isSelected
                      ? selectedIds.filter((id) => id !== user.id)
                      : [...selectedIds, user.id],
                  )
                }
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-75 hover:bg-[var(--bac-int)]"
              >
                <Avatar user={user} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" style={{ color: "var(--tex-pri)" }}>
                    {user.name}
                  </span>
                  <span className="block truncate text-xs" style={{ color: "var(--tex-ter)" }}>
                    {user.email}
                  </span>
                </span>
                {isSelected ? <Check size={14} style={{ color: "var(--ico-sec)" }} /> : null}
              </button>
            );
          })}
          {candidates.length === 0 ? (
            <div className="px-3 py-2 text-sm" style={{ color: "var(--tex-ter)" }}>
              No matching people
            </div>
          ) : null}
        </div>
      </Popover>
    </>
  );
}
