"use client";

/**
 * A group header in the list, and the shared glyph the board column reuses.
 *
 * 36px tall on the elevated background at 8px radius
 * (`research/01-visual-design.md` §6.2). It carries a disclosure chevron, the
 * group's glyph, its name, a count, and a `+` that files a new issue **already
 * carrying this group's value** — which is the affordance that makes a grouped
 * board usable with the mouse.
 *
 * The header is a `<button>` rather than a div with a click handler, so `Enter`
 * and `Space` collapse the group without any keyboard code of ours, and the
 * expanded state is announced through `aria-expanded` instead of by reading the
 * chevron's rotation.
 */

import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { CountPill } from "@/components/ui/badge";
import { ChevronDownIcon, PlusIcon } from "@/components/ui/icons";
import { PriorityIcon } from "@/components/ui/icons/priority-icon";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import type { GroupGlyph } from "@/components/issues/grouping";

export interface GroupGlyphIconProps {
  readonly glyph: GroupGlyph;
  readonly size?: number;
}

/** The single place a {@link GroupGlyph} becomes pixels. */
export function GroupGlyphIcon({ glyph, size = 14 }: GroupGlyphIconProps) {
  switch (glyph.kind) {
    case "status":
      return (
        <StatusIcon
          type={glyph.type}
          color={glyph.color}
          progress={glyph.progress}
          size={size}
          decorative
        />
      );
    case "priority":
      return <PriorityIcon priority={glyph.priority} size={size + 2} decorative />;
    case "user":
      return glyph.user ? (
        <Avatar
          id={glyph.user.id}
          name={glyph.user.name}
          src={glyph.user.avatarUrl}
          color={glyph.user.avatarColor}
          size={16}
          decorative
        />
      ) : (
        <span className="size-4 rounded-full border border-dashed border-strong" />
      );
    case "swatch":
      return (
        <span
          aria-hidden="true"
          className={cn(
            "size-2.5 rounded-[3px]",
            glyph.color === null && "border border-strong",
          )}
          style={glyph.color === null ? undefined : { background: glyph.color }}
        />
      );
    case "none":
      return null;
  }
}

export interface IssueGroupHeaderProps {
  readonly name: string;
  readonly glyph: GroupGlyph;
  readonly count: number;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onCreate: () => void;
}

export function IssueGroupHeader({
  name,
  glyph,
  count,
  collapsed,
  onToggle,
  onCreate,
}: IssueGroupHeaderProps) {
  return (
    <div
      data-testid={`issue-group-${name}`}
      className={cn(
        "sticky top-0 z-[1] mx-2 flex h-[var(--group-header-height)] items-center gap-2",
        "rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] px-2",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <ChevronDownIcon
          size={12}
          className={cn(
            "text-tertiary [transition:transform_var(--speed-quick)_var(--ease-quad)]",
            collapsed && "-rotate-90",
          )}
        />
        <GroupGlyphIcon glyph={glyph} />
        <span className="truncate text-small text-primary [font-weight:var(--weight-medium)]">
          {name}
        </span>
        <CountPill count={count} label={`${count} issues`} />
      </button>

      <button
        type="button"
        aria-label={`New issue in ${name}`}
        onClick={onCreate}
        className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-tertiary hover:bg-[var(--bg-translucent)] hover:text-primary"
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
