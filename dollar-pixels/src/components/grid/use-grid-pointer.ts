"use client";

/**
 * Pointer, drag and keyboard selection over the grid.
 *
 * The hook owns *interaction* only. It never touches a canvas and never looks at
 * claims: it converts input into block coordinates via `hitTest`, normalises the
 * rectangle through `rectFromCorners`, and reports what it produced. Whether a
 * rectangle is buyable is the caller's question, asked through `isAvailable`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_SELECTION_BLOCKS,
  ZOOM_LEVELS,
  blocksIn,
  eachBlock,
  rectFromCorners,
  type BlockRect,
  type GridDims,
  type ZoomLevel,
} from "@/domain/geometry";
import { hitTest, type BlockPoint } from "@/components/grid/paint";

export interface GridPointerOptions {
  readonly dims: GridDims;
  readonly zoom: ZoomLevel;
  /** Bounding rect of the element events land on. Null once unmounted. */
  readonly rectOf: () => DOMRect | null;
  /** Free-to-buy predicate, evaluated at interaction time so holds expire live. */
  readonly isAvailable: (bx: number, by: number) => boolean;
  readonly onSelect: (rect: BlockRect | null) => void;
  /**
   * A single block was activated rather than selected — a click or Enter on a
   * block that is already owned or held, or any click in read-only mode.
   */
  readonly onActivateBlock?: (bx: number, by: number) => void;
  readonly onZoomStep?: (delta: 1 | -1) => void;
  readonly readOnly?: boolean;
}

export interface GridPointer {
  /** Block under the pointer, or null when the pointer is off the grid. */
  readonly hover: BlockPoint | null;
  /** Keyboard cursor. Survives the pointer leaving. */
  readonly cursor: BlockPoint | null;
  /** Live drag rectangle. Null when not dragging — the committed rect is the caller's. */
  readonly draft: BlockRect | null;
  readonly dragging: boolean;
  /** The rectangle was shrunk to fit MAX_SELECTION_BLOCKS. */
  readonly clamped: boolean;
  /** The rectangle covers at least one block that is not available. */
  readonly blocked: boolean;
  readonly onPointerDown: (event: PointerLike) => void;
  readonly onPointerMove: (event: PointerLike) => void;
  readonly onPointerUp: (event: PointerLike) => void;
  readonly onPointerLeave: () => void;
  readonly onKeyDown: (event: KeyLike) => void;
}

/**
 * Only the fields used, so tests can call the handlers with plain objects.
 * A React synthetic event is assignable to these.
 */
export interface PointerLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly shiftKey: boolean;
}

export interface KeyLike {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

export interface ClampedSelection {
  readonly rect: BlockRect;
  readonly clamped: boolean;
}

/**
 * Normalise two corners into a rect no larger than MAX_SELECTION_BLOCKS.
 *
 * Clamping beats refusing: a drag across half the grid is a legitimate gesture
 * with an illegitimate result, and snapping back to nothing at some invisible
 * threshold reads as a broken canvas. The rect keeps its aspect ratio and stays
 * pinned to the anchor, so the corner the user pressed on never moves.
 */
export function clampSelection(anchor: BlockPoint, moving: BlockPoint): ClampedSelection {
  const rect = rectFromCorners(anchor.bx, anchor.by, moving.bx, moving.by);
  if (blocksIn(rect) <= MAX_SELECTION_BLOCKS) return { rect, clamped: false };

  const k = Math.sqrt(MAX_SELECTION_BLOCKS / blocksIn(rect));
  const bw = Math.max(1, Math.min(rect.bw, Math.floor(rect.bw * k)));
  const bh = Math.max(1, Math.min(rect.bh, Math.floor(MAX_SELECTION_BLOCKS / bw)));
  return {
    rect: {
      bx: moving.bx >= anchor.bx ? anchor.bx : anchor.bx - bw + 1,
      by: moving.by >= anchor.by ? anchor.by : anchor.by - bh + 1,
      bw,
      bh,
    },
    clamped: true,
  };
}

/** True when any block in the rect is owned or held. */
export function rectIsBlocked(
  rect: BlockRect,
  isAvailable: (bx: number, by: number) => boolean,
): boolean {
  for (const { bx, by } of eachBlock(rect)) {
    if (!isAvailable(bx, by)) return true;
  }
  return false;
}

const ARROWS: Readonly<Record<string, BlockPoint | undefined>> = {
  ArrowLeft: { bx: -1, by: 0 },
  ArrowRight: { bx: 1, by: 0 },
  ArrowUp: { bx: 0, by: -1 },
  ArrowDown: { bx: 0, by: 1 },
};

export function useGridPointer(options: GridPointerOptions): GridPointer {
  const { dims, zoom, rectOf, isAvailable, onSelect, onActivateBlock, onZoomStep } =
    options;
  const readOnly = options.readOnly ?? false;

  const [hover, setHover] = useState<BlockPoint | null>(null);
  const [cursor, setCursor] = useState<BlockPoint | null>(null);
  const [draft, setDraft] = useState<BlockRect | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // Drag bookkeeping lives in refs: a pointermove must read the anchor that was
  // set microseconds earlier, before React has re-rendered.
  const anchorRef = useRef<BlockPoint | null>(null);
  const draftRef = useRef<BlockRect | null>(null);
  const keyAnchorRef = useRef<BlockPoint | null>(null);

  // Latest-callback ref, so the window pointerup listener and the memoised
  // handlers never commit against a stale selection handler. Written in an
  // effect rather than during render: every reader is an event, and events
  // cannot fire before the effects of the render that created them.
  const latest = useRef({ isAvailable, onSelect, onActivateBlock, readOnly });
  useEffect(() => {
    latest.current = { isAvailable, onSelect, onActivateBlock, readOnly };
  });

  const locate = useCallback(
    (event: PointerLike): BlockPoint | null => {
      const rect = rectOf();
      if (!rect) return null;
      return hitTest(event.clientX, event.clientY, rect, dims, zoom);
    },
    [rectOf, dims, zoom],
  );

  const applyRect = useCallback((next: ClampedSelection) => {
    setDraft(next.rect);
    draftRef.current = next.rect;
    setClamped(next.clamped);
    setBlocked(rectIsBlocked(next.rect, latest.current.isAvailable));
  }, []);

  const reset = useCallback(() => {
    anchorRef.current = null;
    draftRef.current = null;
    setDragging(false);
    setDraft(null);
  }, []);

  /** Turn a finished gesture into either a selection or an activation. */
  const commit = useCallback(
    (rect: BlockRect | null) => {
      const { isAvailable: available, onSelect: select, onActivateBlock: activate } =
        latest.current;
      if (!rect) {
        reset();
        return;
      }
      const single = rect.bw === 1 && rect.bh === 1;
      if (single && (latest.current.readOnly || !available(rect.bx, rect.by))) {
        // Clicking someone else's block asks about it; it never selects it.
        activate?.(rect.bx, rect.by);
        select(null);
        setClamped(false);
        setBlocked(false);
      } else if (!latest.current.readOnly) {
        select(rect);
      }
      reset();
    },
    [reset],
  );

  const onPointerDown = useCallback(
    (event: PointerLike) => {
      if (event.button !== 0) return;
      const point = locate(event);
      if (!point) return;
      setCursor(point);
      setHover(point);
      keyAnchorRef.current = null;
      anchorRef.current = point;
      setDragging(true);
      const next = clampSelection(point, point);
      applyRect(next);
      if (!latest.current.readOnly) latest.current.onSelect(next.rect);
    },
    [locate, applyRect],
  );

  const onPointerMove = useCallback(
    (event: PointerLike) => {
      const point = locate(event);
      setHover(point);
      const anchor = anchorRef.current;
      if (!anchor || !point) return;
      const next = clampSelection(anchor, point);
      applyRect(next);
      if (!latest.current.readOnly) latest.current.onSelect(next.rect);
    },
    [locate, applyRect],
  );

  const onPointerUp = useCallback(
    (event: PointerLike) => {
      if (!anchorRef.current) return;
      const point = locate(event);
      const rect = point
        ? clampSelection(anchorRef.current, point).rect
        : draftRef.current;
      commit(rect);
    },
    [locate, commit],
  );

  const onPointerLeave = useCallback(() => {
    setHover(null);
  }, []);

  // A drag that ends outside the canvas is still a drag. Without this, releasing
  // over the buy panel would leave the grid stuck in a permanent drag.
  useEffect(() => {
    if (!dragging) return;
    const finish = () => {
      if (anchorRef.current) commit(draftRef.current);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [dragging, commit]);

  const onKeyDown = useCallback(
    (event: KeyLike) => {
      const step = ARROWS[event.key];
      if (step) {
        event.preventDefault();
        const from = cursor ?? { bx: 0, by: 0 };
        const to: BlockPoint = {
          bx: clamp(from.bx + step.bx, dims.wBlocks),
          by: clamp(from.by + step.by, dims.hBlocks),
        };
        setCursor(to);
        if (event.shiftKey && !readOnly) {
          keyAnchorRef.current ??= from;
          const next = clampSelection(keyAnchorRef.current, to);
          applyRect(next);
          onSelect(next.rect);
        } else {
          keyAnchorRef.current = null;
        }
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const at = cursor;
        if (!at) return;
        const anchor = keyAnchorRef.current ?? at;
        keyAnchorRef.current = null;
        commit(clampSelection(anchor, at).rect);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        keyAnchorRef.current = null;
        setClamped(false);
        setBlocked(false);
        reset();
        onSelect(null);
        return;
      }

      // "=" and "_" are the unshifted faces of + and - on a US layout; requiring
      // the shift would make the shortcut unreachable on half of keyboards.
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        onZoomStep?.(1);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        onZoomStep?.(-1);
      }
    },
    [cursor, dims, readOnly, applyRect, onSelect, commit, reset, onZoomStep],
  );

  return {
    hover,
    cursor,
    draft,
    dragging,
    clamped,
    blocked,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onKeyDown,
  };
}

function clamp(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, value));
}

/** Next zoom level in `delta` direction, saturating at the ends of ZOOM_LEVELS. */
export function stepZoom(zoom: ZoomLevel, delta: 1 | -1): ZoomLevel {
  const i = ZOOM_LEVELS.indexOf(zoom);
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + delta));
  return ZOOM_LEVELS[next];
}
