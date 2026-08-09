"use client";

/**
 * One block: hover gutter, content, nested children.
 *
 * The gutter is absolutely positioned outside the text column (`right-full`),
 * which is why the page reserves 96px of horizontal padding — the `+` and ⠿
 * affordances live in that margin and never reflow the prose when they appear.
 */

import { useCallback, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus } from "lucide-react";

import { IconButton } from "@/components/primitives/Button";
import type { BlockType, Id } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { cn } from "@/lib/utils/cn";

import { BlockList } from "./BlockList";
import { BlockMenu } from "./BlockMenu";
import { BlockRenderer } from "./BlockRenderer";
import { focusBlock } from "./focus-registry";

/** Notion indents nested content by exactly one marker column. */
export const CHILD_INDENT = 24;

/**
 * How far down the gutter has to sit to line up with the block's first line of
 * text. Headings carry a large top margin, so a fixed offset would leave their
 * handle floating in the whitespace above.
 */
const GUTTER_OFFSET: Partial<Record<BlockType, number>> = {
  heading_1: 34,
  heading_2: 26,
  heading_3: 20,
  callout: 14,
  code: 30,
  quote: 8,
};

export interface BlockRowProps {
  blockId: Id;
  /** Page id or parent block id — whichever list this row belongs to. */
  parentId: Id;
  depth: number;
}

export function BlockRow({ blockId, parentId, depth }: BlockRowProps) {
  const block = useWorkspaceStore((state) => state.blocks[blockId]);
  const [menuOpen, setMenuOpen] = useState(false);
  const handleRef = useRef<HTMLButtonElement | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockId });

  // The handle is both the drag activator and the menu's popover anchor.
  const attachHandle = useCallback(
    (node: HTMLButtonElement | null) => {
      setActivatorNodeRef(node);
      handleRef.current = node;
    },
    [setActivatorNodeRef],
  );

  const insertBelow = useCallback(() => {
    const createdId = useWorkspaceStore
      .getState()
      .insertBlock({ parentId, afterBlockId: blockId });
    focusBlock(createdId, "start");
  }, [blockId, parentId]);

  const addFirstChild = useCallback(() => {
    const createdId = useWorkspaceStore.getState().insertBlock({ parentId: blockId });
    focusBlock(createdId, "start");
  }, [blockId]);

  if (!block) return null;

  const collapsed = block.type === "toggle" && block.expanded === false;
  const showChildren = block.childIds.length > 0 && !collapsed;
  const showEmptyToggleHint =
    block.type === "toggle" && !collapsed && block.childIds.length === 0;

  return (
    <div
      ref={setNodeRef}
      data-block-row={blockId}
      className={cn("group/row relative", isDragging && "opacity-40")}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
    >
      <div
        contentEditable={false}
        className={cn(
          "absolute right-full top-0 z-10 flex items-start gap-px pr-1",
          // Hover affordances fade rather than pop; `focus-within` keeps them
          // reachable from the keyboard.
          "opacity-0 transition-opacity duration-100",
          "group-hover/row:opacity-100 focus-within:opacity-100",
          menuOpen && "opacity-100",
        )}
        style={{ paddingTop: GUTTER_OFFSET[block.type] ?? 2 }}
      >
        <IconButton label="Add a block below" size={22} onClick={insertBelow}>
          <Plus size={16} />
        </IconButton>
        <IconButton
          ref={attachHandle}
          label="Drag to move, click to open menu"
          size={22}
          className="cursor-grab active:cursor-grabbing"
          onClick={() => setMenuOpen((open) => !open)}
          {...attributes}
          {...(listeners ?? {})}
        >
          <GripVertical size={16} />
        </IconButton>
      </div>

      <BlockRenderer block={block} depth={depth} />

      {showChildren ? (
        <div style={{ marginLeft: CHILD_INDENT }}>
          <BlockList parentId={blockId} blockIds={block.childIds} depth={depth + 1} />
        </div>
      ) : null}

      {showEmptyToggleHint ? (
        <button
          type="button"
          onClick={addFirstChild}
          className="block w-full py-[3px] text-left"
          style={{
            marginLeft: CHILD_INDENT,
            color: "var(--tex-ter)",
            fontSize: "var(--editor-text, 16px)",
          }}
        >
          Empty toggle. Click to add a block.
        </button>
      ) : null}

      <BlockMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchor={handleRef}
        blockId={blockId}
      />
    </div>
  );
}
