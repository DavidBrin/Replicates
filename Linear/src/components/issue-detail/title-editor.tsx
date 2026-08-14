"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";

/**
 * The issue title — 24px at weight 590, editable in place.
 *
 * A `<textarea>` rather than a `contenteditable`, and rather than an `<input>`.
 * `contenteditable` accepts pasted HTML and would put markup into a field that
 * is stored as plain text; an `<input>` cannot wrap, and a long title has to
 * wrap because the column is 80ch and the title is the first thing read.
 *
 * ## Commit rules
 *
 * - **Blur commits**, because the title is a field you leave rather than submit.
 * - **`Enter` commits** and does not insert a newline: the value is a single
 *   line even though the control wraps.
 * - **`Escape` reverts** to the last committed value and gives focus back to the
 *   page, so an accidental edit is one key away from undone.
 * - An empty title is refused and reverts. `issues.title` is `not null` and a
 *   blank one makes the issue unfindable in every list that shows it.
 */

export interface TitleEditorProps {
  value: string;
  onCommit: (next: string) => void;
  readOnly?: boolean;
}

export function TitleEditor({ value, onCommit, readOnly = false }: TitleEditorProps) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // An external change — another tab, an optimistic rollback — wins over an
  // untouched draft. Adjusted **during render** rather than in an effect: an
  // effect would paint the stale value first and then correct it, and React's
  // own guidance names this pattern for exactly this case.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const fit = (element: HTMLTextAreaElement | null): void => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  const commit = (): void => {
    const next = draft.trim();
    if (next === "" || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      ref.current?.blur();
      return;
    }
    if (event.key === "Escape") {
      // Stop it here: the pane's Escape ladder would otherwise also close a
      // picker or navigate away, and one press should undo one thing.
      event.stopPropagation();
      setDraft(value);
      ref.current?.blur();
    }
  };

  return (
    <textarea
      ref={(node) => {
        ref.current = node;
        fit(node);
      }}
      data-testid="issue-title"
      aria-label="Issue title"
      rows={1}
      readOnly={readOnly}
      value={draft}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
        fit(event.currentTarget);
      }}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className={cn(
        "w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none",
        "text-title2 text-primary [font-weight:var(--weight-title)] leading-[1.3]",
        "placeholder:text-quaternary",
        readOnly && "cursor-default",
      )}
      placeholder="Issue title"
    />
  );
}
