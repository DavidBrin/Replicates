import type { Pattern, PatternId } from "@/domain/types";

export interface PatternPickerProps {
  patterns: Pattern[];
  /** The pattern a lane left-click will paint (SPEC.md §1.1: "selects the clip to paint"). */
  armedPatternId: PatternId;
  onArm: (id: PatternId) => void;
}

/**
 * Picker panel (SPEC.md §1.1 Playlist, lane 1 §4.1): lists patterns by
 * name/color; the armed row is what a lane left-click paints.
 */
export function PatternPicker({ patterns, armedPatternId, onArm }: PatternPickerProps) {
  return (
    <div className="fl-playlist-picker" role="listbox" aria-label="Pattern picker">
      {patterns.map((pattern) => (
        <button
          key={pattern.id}
          type="button"
          role="option"
          aria-selected={pattern.id === armedPatternId}
          data-armed={pattern.id === armedPatternId}
          className="fl-playlist-picker__row"
          onClick={() => onArm(pattern.id)}
        >
          <span className="fl-playlist-picker__swatch" style={{ backgroundColor: pattern.color }} />
          <span className="fl-playlist-picker__name">{pattern.name}</span>
        </button>
      ))}
    </div>
  );
}
