"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { Textarea } from "@/components/ui/textarea";

import { Markdown } from "./markdown";

/**
 * The description: rendered markdown that becomes a textarea when you click it.
 *
 * Two modes, one `data-testid`. The e2e contract names `issue-description` as
 * "the description" rather than "the rendered description", and a test that has
 * to know which mode the pane is in to find the element is a test that breaks
 * the first time the default changes.
 *
 * ## Why not a rich-text editor
 *
 * Because the field is stored as markdown and read by {@link Markdown}, which
 * renders it as React elements from a closed grammar. A WYSIWYG surface stores
 * HTML, and storing HTML means the safety of every description depends on a
 * sanitiser rather than on the renderer having no way to emit markup. The trade
 * is real — you type `**bold**` rather than pressing ⌘B — and it is the right
 * one for the piece of this application most exposed to untrusted input.
 *
 * ## Commit rules
 *
 * Blur and `Cmd/Ctrl+Enter` commit; `Escape` reverts and exits. Unlike a
 * comment, a description **autosaves** — `research/02-features.md` §12.1 is
 * explicit that the description saves itself and a comment does not — so
 * leaving the field is a save, not a discard.
 */

export interface DescriptionEditorProps {
  value: string;
  onCommit: (next: string) => void;
  mentions?: Readonly<Record<string, string>>;
  issueHref?: (identifier: string) => string | null;
  readOnly?: boolean;
}

export function DescriptionEditor({
  value,
  onCommit,
  mentions,
  issueHref,
  readOnly = false,
}: DescriptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Follow an external change, but never while someone is typing into the
  // field — an autosave from another tab must not overwrite the paragraph in
  // front of them. Adjusted during render rather than in an effect, so the
  // stale text is never painted.
  if (value !== lastValue) {
    setLastValue(value);
    if (!editing) setDraft(value);
  }

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      setDraft(value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <Textarea
        ref={ref}
        data-testid="issue-description"
        aria-label="Issue description"
        value={draft}
        rows={4}
        variant="prose"
        placeholder="Add a description…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="-mx-3 border-transparent"
      />
    );
  }

  if (value.trim() === "") {
    return (
      <button
        type="button"
        data-testid="issue-description"
        disabled={readOnly}
        onClick={() => setEditing(true)}
        className={cn(
          "block w-full rounded-[var(--radius-lg)] py-1 text-left",
          "text-regular text-quaternary [line-height:1.6]",
          !readOnly && "hover:text-tertiary",
        )}
      >
        Add a description…
      </button>
    );
  }

  return (
    <div
      // A click target rather than a button: the rendered description contains
      // links, and a link inside a button is invalid and unreachable by
      // keyboard. `role="textbox"` says what activating it does; Tab reaches it
      // through `tabIndex`, and the links inside stay individually focusable.
      role={readOnly ? undefined : "textbox"}
      aria-readonly={readOnly || undefined}
      aria-label="Issue description"
      tabIndex={readOnly ? undefined : 0}
      data-testid="issue-description"
      onClick={readOnly ? undefined : () => setEditing(true)}
      onKeyDown={
        readOnly
          ? undefined
          : (event) => {
              if (event.key === "Enter" && event.target === event.currentTarget) {
                event.preventDefault();
                setEditing(true);
              }
            }
      }
      className={cn(
        "rounded-[var(--radius-lg)] py-1",
        !readOnly && "cursor-text",
      )}
    >
      <Markdown source={value} mentions={mentions} issueHref={issueHref} />
    </div>
  );
}
