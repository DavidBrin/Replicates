"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { TERRAIN_GRID } from "./palette";
import { drawMap } from "./MapThumbnail";
import { useEditorStore } from "./editorStore";

/**
 * The paintable grid. One canvas, redrawn whenever the draft changes;
 * pointer events (mouse, pen and touch share one path) translate to a tile
 * index and a brush stroke. `touch-action: none` keeps a finger drag from
 * scrolling the page instead of painting.
 */
export function EditorCanvas() {
  const draft = useEditorStore((s) => s.draft);
  const beginStroke = useEditorStore((s) => s.beginStroke);
  const paintAt = useEditorStore((s) => s.paintAt);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(28);
  const lastIndex = useRef<number | null>(null);
  const painting = useRef(false);

  // Fit the grid to its container, between 14 and 40 px per tile.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const available = wrap.clientWidth - 8;
      const size = Math.floor(available / draft.width);
      setCell(Math.max(14, Math.min(40, size)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draft.width]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawMap(ctx, draft, cell, { grid: true, glyphs: true });
  }, [draft, cell]);

  const indexAt = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): number | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) / cell);
      const y = Math.floor((event.clientY - rect.top) / cell);
      if (x < 0 || y < 0 || x >= draft.width || y >= draft.height) return null;
      return y * draft.width + x;
    },
    [cell, draft.width, draft.height],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = indexAt(event);
    if (index === null) return;
    painting.current = true;
    lastIndex.current = index;
    beginStroke();
    paintAt(index);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!painting.current) return;
    const index = indexAt(event);
    if (index === null || index === lastIndex.current) return;
    lastIndex.current = index;
    paintAt(index);
  };

  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    painting.current = false;
    lastIndex.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div ref={wrapRef} className="w-full overflow-auto" data-testid="editor-canvas-wrap">
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        width={draft.width * cell}
        height={draft.height * cell}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={(event) => {
          if (painting.current && !event.currentTarget.hasPointerCapture(event.pointerId)) end(event);
        }}
        onContextMenu={(event) => event.preventDefault()}
        style={{
          width: draft.width * cell,
          height: draft.height * cell,
          touchAction: "none",
          imageRendering: "pixelated",
          cursor: "crosshair",
          border: `3px solid ${TERRAIN_GRID[draft.biome]}`,
          background: "#1A1010",
        }}
        aria-label="Map editor grid"
      />
    </div>
  );
}
