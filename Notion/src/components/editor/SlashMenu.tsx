"use client";

/**
 * The `/` command palette.
 *
 * Anchored at the caret rather than at an element, because the trigger is a
 * character inside a text run and has no box of its own.
 *
 * Key handling lives on a capture-phase `document` listener instead of on the
 * editable's own `onKeyDown`: React attaches its handlers at the root
 * container, so a capture listener on `document` runs first and can swallow
 * Arrow/Enter/Escape before the editor ever interprets them. That keeps the
 * highlighted-row state in one place instead of mirroring it into `Editable`.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { BlockType } from "@/lib/model/types";
import { cn } from "@/lib/utils/cn";
import { BLOCK_TYPE_META, SLASH_COMMAND_TYPES, type BlockTypeMeta } from "./block-types";
import { useMounted } from "./use-mounted";

export interface SlashMenuProps {
  /** Text typed after the `/`, already stripped of the slash itself. */
  query: string;
  /** Viewport rect of the caret that opened the menu. */
  anchorRect: DOMRect;
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}

const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 340;
const VIEWPORT_MARGIN = 8;

function matches(meta: BlockTypeMeta, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    meta.label.toLowerCase().includes(needle) ||
    meta.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  );
}

export function SlashMenu({ query, anchorRect, onSelect, onClose }: SlashMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number }>();

  // Portals need a DOM target, which does not exist on the server pass.
  const mounted = useMounted();

  const items = useMemo(
    () =>
      SLASH_COMMAND_TYPES.map((type) => BLOCK_TYPE_META[type]).filter((meta) =>
        matches(meta, query),
      ),
    [query],
  );

  // A new query means a new list; keeping the old index would highlight an
  // unrelated row. Adjusted during render (React's documented pattern for
  // state derived from a prop) rather than in an effect, which would paint the
  // stale highlight for a frame first.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setActive(0);
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const height = Math.min(panel.scrollHeight, PANEL_MAX_HEIGHT);

    let top = anchorRect.bottom + 6;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, anchorRect.top - height - 6);
    }
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchorRect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
    );
    setPosition({ top, left });
  }, [anchorRect, items.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + delta + items.length) % items.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[active];
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(item.type);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, items, onClose, onSelect]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-label="Slash commands"
      className="fixed z-50 overflow-y-auto rounded-md py-1"
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: PANEL_WIDTH,
        maxHeight: PANEL_MAX_HEIGHT,
        background: "var(--bac-ele)",
        boxShadow: "var(--shadow-menu)",
        visibility: position ? "visible" : "hidden",
      }}
      // The editable must keep focus: a blur here would tear down the caret
      // the command is about to act on.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-sm" style={{ color: "var(--tex-ter)" }}>
          No results
        </div>
      ) : (
        <>
          <div
            className="px-3 pb-1 pt-2 text-[11px] font-medium"
            style={{ color: "var(--tex-ter)" }}
          >
            Basic blocks
          </div>
          {items.map((meta, index) => {
            const Icon = meta.icon;
            return (
              <button
                key={meta.type}
                type="button"
                role="option"
                aria-selected={index === active}
                data-index={index}
                onMouseEnter={() => setActive(index)}
                onClick={() => onSelect(meta.type)}
                className={cn(
                  "flex w-full items-center gap-3 px-2 py-1 text-left",
                  "transition-colors duration-75",
                )}
                style={{ background: index === active ? "var(--bac-int)" : "transparent" }}
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border"
                  style={{ borderColor: "var(--bor-pri)", color: "var(--ico-pri)" }}
                >
                  <Icon size={20} strokeWidth={1.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-medium"
                    style={{ color: "var(--tex-pri)" }}
                  >
                    {meta.label}
                  </span>
                  <span
                    className="block truncate text-xs"
                    style={{ color: "var(--tex-ter)" }}
                  >
                    {meta.description}
                  </span>
                </span>
              </button>
            );
          })}
        </>
      )}
    </div>,
    document.body,
  );
}
