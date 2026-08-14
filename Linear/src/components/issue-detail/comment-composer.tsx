"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

/**
 * The comment box.
 *
 * The one rule that separates it from the description editor: **a comment
 * requires an explicit submit** (`research/02-features.md` §12.1). The
 * description autosaves on blur; a half-written comment must survive losing
 * focus, because the usual reason focus leaves is that you went to re-read the
 * thing you are replying to.
 *
 * So: `Cmd/Ctrl+Enter` or the button. Bare `Enter` inserts a newline — Linear
 * makes that a preference, and the default it ships is the one that does not
 * post a comment when you meant to start a paragraph.
 *
 * `Escape` is handled and stopped here rather than left to bubble, for the same
 * reason it is in the title editor: one press should undo one thing, and while
 * a composer is focused the thing to undo is the composer.
 */

export interface CommentComposerProps {
  onSubmit: (body: string) => void | Promise<void>;
  /** Present on an edit form; `Escape` calls it too. */
  onCancel?: () => void;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  /** The composer's own id — `comment-composer` for the issue-level one. */
  testId: string;
  submitTestId: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Compact padding for a reply or an edit form nested inside a thread. */
  compact?: boolean;
}

export function CommentComposer({
  onSubmit,
  onCancel,
  initialValue = "",
  placeholder = "Leave a comment…",
  submitLabel = "Comment",
  testId,
  submitTestId,
  autoFocus = false,
  disabled = false,
  compact = false,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const empty = body.trim() === "";

  const submit = async (): Promise<void> => {
    if (empty || submitting || disabled) return;
    setSubmitting(true);
    try {
      await onSubmit(body.trim());
      // Only clear on success. A composer that empties itself and *then*
      // discovers the request failed has thrown away the text it was holding.
      setBody("");
    } finally {
      setSubmitting(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel?.();
    }
  };

  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-default bg-panel",
        compact ? "p-1.5" : "p-2",
      )}
    >
      <Textarea
        ref={ref}
        data-testid={testId}
        aria-label={placeholder}
        value={body}
        rows={compact ? 1 : 2}
        variant="prose"
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        className="border-transparent px-1 py-1"
      />
      <div className="mt-1 flex items-center justify-end gap-2">
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid={`${testId}-cancel`}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="primary"
          data-testid={submitTestId}
          disabled={empty || submitting || disabled}
          onClick={() => void submit()}
          trailing={
            compact ? null : (
              <Kbd>
                <span aria-hidden>⌘↵</span>
              </Kbd>
            )
          }
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
