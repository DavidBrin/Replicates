import { useRef } from "react";

import { TICKS_PER_BAR, type Pattern, type PatternClip } from "@/domain/types";
import { ClipMiniature } from "./ClipMiniature";
import { ticksToPx } from "./geometry";

export interface ClipViewProps {
  clip: PatternClip;
  pattern: Pattern;
  pxPerBar: number;
  selected: boolean;
  /** Left-click: select + make the clip's pattern active (SPEC.md §1.1). */
  onSelect: (clipId: string) => void;
  /** Double-click: open the pattern in the Piano Roll (SPEC.md §1.1, TODO(wire)). */
  onOpen: (clip: PatternClip) => void;
  /** Right-click: delete (SPEC.md §4.4's universal "right-click = delete"). */
  onDelete: (clipId: string) => void;
  /** Drag-to-move, committed once on pointer-up (SPEC.md §2.1 drag coalescing). */
  onDragCommit: (clipId: string, deltaTicks: number) => void;
}

const DRAG_THRESHOLD_PX = 3;

/**
 * One placed pattern clip (SPEC.md §4.3, lane 1 §4.2): a header strip
 * (pattern colour + name) over a live miniature of the pattern's notes.
 * Clips are always exactly one bar wide — `PATTERN_LENGTH_TICKS` is a fixed
 * constant (SPEC.md §2) — so there is no edge-resize handle here, only move.
 */
export function ClipView({
  clip,
  pattern,
  pxPerBar,
  selected,
  onSelect,
  onOpen,
  onDelete,
  onDragCommit,
}: ClipViewProps) {
  const dragState = useRef<{ startClientX: number; dragging: boolean } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // jsdom (component tests) has no Pointer Events capture implementation.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragState.current = { startClientX: event.clientX, dragging: false };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (drag === null) return;
    if (Math.abs(event.clientX - drag.startClientX) > DRAG_THRESHOLD_PX) {
      drag.dragging = true;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    dragState.current = null;
    if (drag === null) return;
    const deltaPx = event.clientX - drag.startClientX;
    if (drag.dragging && Math.abs(deltaPx) > 0) {
      const deltaTicks = (deltaPx / pxPerBar) * TICKS_PER_BAR; // snapped to a bar by the caller
      onDragCommit(clip.id, deltaTicks);
    } else {
      onSelect(clip.id);
    }
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    onDelete(clip.id);
  }

  return (
    <div
      className="fl-clip"
      data-testid={`clip-${clip.id}`}
      data-selected={selected}
      style={{ left: ticksToPx(clip.startTick, pxPerBar), width: pxPerBar, borderColor: pattern.color }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => onOpen(clip)}
      onContextMenu={handleContextMenu}
    >
      <div className="fl-clip__header" style={{ background: pattern.color }}>
        {pattern.name}
      </div>
      <div className="fl-clip__body">
        <ClipMiniature pattern={pattern} />
      </div>
    </div>
  );
}
