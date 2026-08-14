"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { PlusIcon } from "@/components/ui/icons";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { ProgressDonut } from "@/components/ui/progress-donut";

import type { DetailIssueRef } from "./types";

/**
 * Sub-issues: the `+ Add sub-issues` affordance and the rows it produces.
 *
 * Below the description and above the activity feed, which is where
 * `research/02-features.md` §1.6 puts them and where the reference capture
 * shows them.
 *
 * ## The editor reopens itself
 *
 * §1.4: "Saving a sub-issue immediately reopens the editor for the next one;
 * `Esc` exits." Sub-issues are almost always created in a burst — you are
 * breaking a task down, not filing one thing — so the field clears and keeps
 * focus rather than closing. That one behaviour is the difference between
 * typing five sub-issues and clicking "Add" five times.
 *
 * Progress is the shared {@link ProgressDonut} rather than a bar or a
 * percentage, so the parent's completion reads identically here and in a list
 * row: same arithmetic, same glyph.
 */

export interface SubIssuesSectionProps {
  subIssues: readonly DetailIssueRef[];
  workspaceUrlKey: string;
  canEdit: boolean;
  /** Resolves when the sub-issue exists; the field clears and stays focused. */
  onCreate: (title: string) => void | Promise<void>;
}

export function SubIssuesSection({
  subIssues,
  workspaceUrlKey,
  canEdit,
  onCreate,
}: SubIssuesSectionProps) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const completed = subIssues.filter((issue) => issue.stateType === "completed").length;

  const submit = async (): Promise<void> => {
    const next = title.trim();
    if (next === "" || busy) return;
    setBusy(true);
    try {
      await onCreate(next);
      setTitle("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      setTitle("");
      setAdding(false);
    }
  };

  return (
    <section data-testid="sub-issues" className="mt-4">
      {subIssues.length > 0 ? (
        <div className="mb-1 flex items-center gap-2 text-mini text-tertiary">
          <ProgressDonut completed={completed} total={subIssues.length} size={14} />
          <span data-testid="sub-issue-progress">
            {completed}/{subIssues.length}
          </span>
          <span>Sub-issues</span>
        </div>
      ) : null}

      <ul className="mb-1">
        {subIssues.map((issue) => (
          <li key={issue.id}>
            <a
              href={`/${workspaceUrlKey}/issue/${issue.identifier}`}
              data-testid={`sub-issue-${issue.identifier}`}
              className={cn(
                "flex h-8 items-center gap-2 rounded-[var(--radius-md)] px-1",
                "text-small hover:bg-[var(--bg-hover)]",
              )}
            >
              <StatusIcon
                type={issue.stateType}
                color={issue.stateColor}
                size={14}
                label={issue.stateName}
              />
              <span className="shrink-0 font-mono text-micro text-tertiary">
                {issue.identifier}
              </span>
              <span className="min-w-0 flex-1 truncate text-primary">{issue.title}</span>
              {issue.assignee ? (
                <Avatar
                  id={issue.assignee.id}
                  name={issue.assignee.name}
                  src={issue.assignee.avatarUrl}
                  color={issue.assignee.avatarColor}
                  size={16}
                />
              ) : null}
            </a>
          </li>
        ))}
      </ul>

      {adding ? (
        <input
          ref={inputRef}
          autoFocus
          data-testid="sub-issue-title"
          aria-label="Sub-issue title"
          value={title}
          disabled={busy}
          placeholder="Sub-issue title…"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (title.trim() === "") setAdding(false);
          }}
          className={cn(
            "h-8 w-full rounded-[var(--radius-md)] border border-default bg-transparent px-2",
            "text-small text-primary outline-none placeholder:text-quaternary",
            "focus:border-[var(--accent)]",
          )}
        />
      ) : (
        <button
          type="button"
          data-testid="add-sub-issue"
          disabled={!canEdit}
          onClick={() => setAdding(true)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] px-1",
            "text-small text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <PlusIcon size={14} />
          Add sub-issues
        </button>
      )}
    </section>
  );
}
