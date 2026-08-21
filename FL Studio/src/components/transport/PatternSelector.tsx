"use client";

import type { PatternSummary } from "@/components/shell/wiring";

export interface PatternSelectorProps {
  activePatternId: string;
  patternOrder: string[];
  patterns: Record<string, PatternSummary>;
  onSelectPrev: () => void;
  onSelectNext: () => void;
  onAdd: () => void;
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
}: PatternSelectorProps) {
  const active = patterns[activePatternId];
  const multiple = patternOrder.length > 1;

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
      <span className="fl-pattern-selector__name" title={active?.name}>
        {active?.name ?? "—"}
      </span>
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
