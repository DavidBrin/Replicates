"use client";

import { useRef } from "react";

import { cn } from "@/lib/cn";
import {
  INVERSE_RELATION,
  type IssueRelationType,
  type StateType,
} from "@/domain/entities";
import { CloseIcon } from "@/components/ui/icons";
import { StatusIcon } from "@/components/ui/icons/status-icon";

import { PropertyPicker, type PropertyPickerOption } from "./property-picker";
import type { DetailIssueRef, DetailRelation } from "./types";

/**
 * Issue relations, grouped by kind.
 *
 * ## The inverse is derived, never stored
 *
 * `A blocks B` is one row. The repository's `listRelations` reads it from both
 * ends and flips the type through `INVERSE_RELATION` on the way out, so this
 * component receives relations already oriented from *this* issue's point of
 * view and does nothing but group them. Storing both halves would let the two
 * rows disagree, and there would be no way to tell which one was right.
 *
 * `INVERSE_RELATION` is imported here anyway — not to compute anything, but
 * because `duplicate` is only user-settable in one direction
 * (`research/02-features.md` §1.5: "you mark *the issue you're on* as a
 * duplicate of another"), so the picker offers `duplicate_of` and the inverse
 * is what shows up on the other issue.
 *
 * ## One display rule that is not a data rule
 *
 * §1.5, verbatim: "Once the blocking issue has been resolved, the relationship
 * moves under Related." That is a *rendering* decision. Writing it into the
 * data would destroy the record of what blocked what — and would have to be
 * undone if the blocker reopened. {@link displayRelationType} applies it on
 * read; the stored type never changes.
 */

const GROUP_ORDER: readonly IssueRelationType[] = [
  "blocked_by",
  "blocks",
  "duplicate_of",
  "duplicate",
  "related",
];

const GROUP_TITLES: Readonly<Record<IssueRelationType, string>> = Object.freeze({
  blocked_by: "Blocked by",
  blocks: "Blocking",
  duplicate_of: "Duplicate of",
  duplicate: "Duplicated by",
  related: "Related",
});

/** The flag colours §1.5 records: orange under *Blocked by*, red under *Blocks*. */
const GROUP_COLORS: Readonly<Record<IssueRelationType, string>> = Object.freeze({
  blocked_by: "var(--priority-urgent-bg)",
  blocks: "var(--danger)",
  duplicate_of: "var(--text-tertiary)",
  duplicate: "var(--text-tertiary)",
  related: "var(--text-tertiary)",
});

/** The kinds a user may create from this issue. `blocked_by` is one of them; */
/** its inverse `blocks` appears on the other issue without a second row. */
export const CREATABLE_RELATIONS: readonly IssueRelationType[] = [
  "blocks",
  "blocked_by",
  "related",
  "duplicate_of",
];

/**
 * The group a relation renders under.
 *
 * A resolved blocker demotes to *Related* — the stored type is untouched, and
 * reopening the blocker restores the original grouping on the next read.
 */
export function displayRelationType(relation: {
  readonly type: IssueRelationType;
  readonly relatedStateType: StateType;
}): IssueRelationType {
  const resolved =
    relation.relatedStateType === "completed" || relation.relatedStateType === "canceled";
  if (resolved && (relation.type === "blocked_by" || relation.type === "blocks")) {
    return "related";
  }
  return relation.type;
}

export interface RelationsSectionProps {
  relations: readonly DetailRelation[];
  candidates: readonly DetailIssueRef[];
  workspaceUrlKey: string;
  canEdit: boolean;
  /** Which relation picker is open, if any. Owned by the pane's `M` chord. */
  openRelationPicker: IssueRelationType | null;
  onOpenRelationPicker: (type: IssueRelationType | null) => void;
  onAdd: (relatedIssueId: string, type: IssueRelationType) => void;
  onRemove: (relationId: string) => void;
}

export function RelationsSection({
  relations,
  candidates,
  workspaceUrlKey,
  canEdit,
  openRelationPicker,
  onOpenRelationPicker,
  onAdd,
  onRemove,
}: RelationsSectionProps) {
  const anchor = useRef<HTMLDivElement | null>(null);

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    entries: relations.filter((relation) => displayRelationType(relation) === type),
  })).filter((group) => group.entries.length > 0);

  const options: PropertyPickerOption[] = candidates.map((issue) => ({
    value: issue.id,
    label: issue.title,
    description: issue.identifier,
    keywords: issue.identifier,
    glyph: (
      <StatusIcon
        type={issue.stateType}
        color={issue.stateColor}
        size={14}
        decorative
      />
    ),
  }));

  return (
    <section data-testid="issue-relations" ref={anchor} className="mt-4">
      {grouped.map((group) => (
        <div key={group.type} className="mb-2">
          <h3
            data-testid={`relation-group-${group.type}`}
            className="mb-0.5 text-mini text-tertiary"
          >
            {GROUP_TITLES[group.type]}
          </h3>
          <ul>
            {group.entries.map((relation) => (
              <li
                key={relation.id}
                data-testid={`relation-${relation.id}`}
                data-relation-type={relation.type}
                className={cn(
                  "group flex h-8 items-center gap-2 rounded-[var(--radius-md)] px-1",
                  "text-small hover:bg-[var(--bg-hover)]",
                )}
              >
                <FlagIcon color={GROUP_COLORS[group.type]} />
                <a
                  href={`/${workspaceUrlKey}/issue/${relation.relatedIdentifier}`}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <span className="shrink-0 font-mono text-micro text-tertiary">
                    {relation.relatedIdentifier}
                  </span>
                  <span className="min-w-0 truncate text-primary">
                    {relation.relatedTitle}
                  </span>
                </a>
                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Remove relation to ${relation.relatedIdentifier}`}
                    data-testid={`relation-remove-${relation.id}`}
                    onClick={() => onRemove(relation.id)}
                    className="text-tertiary opacity-0 hover:text-primary group-hover:opacity-100 focus:opacity-100"
                  >
                    <CloseIcon size={12} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {CREATABLE_RELATIONS.map((type) => (
        <PropertyPicker
          key={type}
          testId="relation-picker"
          label={`Add ${GROUP_TITLES[type]} relation`}
          open={openRelationPicker === type}
          onOpenChange={(open) => onOpenRelationPicker(open ? type : null)}
          anchor={anchor}
          options={options}
          width={320}
          placeholder="Search issues…"
          emptyMessage="No matching issue"
          onSelect={(issueId) => {
            onAdd(issueId, type);
            onOpenRelationPicker(null);
          }}
        />
      ))}

      {/*
        The inverse of what the picker creates is what lands on the other issue.
        Stated here so the mapping is visible at the call site rather than only
        in `entities.ts`.
      */}
      <span className="sr-only" data-testid="relation-inverse-note">
        {`Adding "blocks" shows as "${GROUP_TITLES[INVERSE_RELATION.blocks]}" on the other issue.`}
      </span>
    </section>
  );
}

function FlagIcon({ color }: { color: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden focusable="false">
      <path
        d="M4 2v12"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      <path d="M4.75 2.75h7.5l-2 2.75 2 2.75h-7.5Z" fill={color} />
    </svg>
  );
}
