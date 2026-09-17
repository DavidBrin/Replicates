"use client";

import { useEffect, useRef, useState } from "react";

import type { PatternSummary } from "@/components/shell/wiring";
import { usePendingCommit } from "@/lib/gestureHold";

export interface PatternSelectorProps {
  activePatternId: string;
  patternOrder: string[];
  patterns: Record<string, PatternSummary>;
  onSelectPrev: () => void;
  onSelectNext: () => void;
  onAdd: () => void;
  /**
   * `F2` arrives at the shell but the field lives here (SPEC §4.4 "rename
   * current pattern"). The parent flips this on; the input commits on
   * Enter/blur and cancels on Escape, then calls {@link onRenameEnd} either
   * way so the parent can put the flag back.
   */
  renaming?: boolean;
  onRename?: (name: string) => void;
  onRenameEnd?: () => void;
}

/**
 * Pattern selector (SPEC §1.1 rack table row, §4.1 toolbar): current
 * pattern name with prev/next + add, shared between the toolbar and the
 * Channel Rack (lane 1 §1.2 item 8).
 */
export function PatternSelector({
  activePatternId,
  patternOrder,
  patterns,
  onSelectPrev,
  onSelectNext,
  onAdd,
  renaming = false,
  onRename,
  onRenameEnd,
}: PatternSelectorProps) {
  const active = patterns[activePatternId];
  const multiple = patternOrder.length > 1;
  const [draft, setDraft] = useState(active?.name ?? "");
  // The draft is seeded when the field OPENS, not on every render: re-seeding
  // from `active.name` while typing would fight the user for the caret.
  const wasRenaming = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (renaming && !wasRenaming.current) setDraft(active?.name ?? "");
    wasRenaming.current = renaming;
  }, [renaming, active?.name]);

  function commit(): void {
    onRename?.(draft);
    onRenameEnd?.();
  }

  /*
   * A gesture that mutates on pointer-DOWN (drawing a note, a shift-clone, a
   * painted clip) dispatches before `blur` is delivered, so this rename used
   * to be filed on top of it — undo order inverted, and the drag that started
   * the dismissal unable to coalesce. The flush pulls the commit forward to
   * where the user put it (`@/lib/gestureHold`). `renameActivePattern` is a
   * no-op for an unchanged name, so the `blur` that follows adds nothing.
   */
  usePendingCommit(renaming, commit, inputRef);

  return (
    <div className="fl-pattern-selector" data-testid="pattern-selector">
      <button
        type="button"
        className="fl-icon-button"
        aria-label="Previous pattern"
        disabled={!multiple}
        onClick={onSelectPrev}
      >
        ◂
      </button>
      {renaming ? (
        <input
          autoFocus
          className="fl-pattern-selector__name fl-pattern-selector__rename"
          aria-label="Pattern name"
          data-testid="pattern-rename"
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") onRenameEnd?.();
          }}
        />
      ) : (
        <span
          className="fl-pattern-selector__name"
          title={active?.name}
          data-testid="pattern-name"
        >
          {active?.name ?? "—"}
        </span>
      )}
      <button
        type="button"
        className="fl-icon-button"
        aria-label="Next pattern"
        disabled={!multiple}
        onClick={onSelectNext}
      >
        ▸
      </button>
      <button
        type="button"
        className="fl-icon-button"
        aria-label="Add pattern"
        onClick={onAdd}
      >
        +
      </button>
    </div>
  );
}
