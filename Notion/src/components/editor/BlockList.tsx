"use client";

/**
 * An ordered list of sibling blocks, reorderable by dragging the ⠿ handle.
 *
 * One `DndContext` per sibling list, including the nested ones a `BlockRow`
 * renders for its children. Each context therefore only ever sorts within a
 * single `childIds`/`blockIds` array, which is exactly the guarantee
 * `moveBlock(id, parentId, index)` needs — no cross-parent index arithmetic,
 * and dragging can never smear a block into someone else's subtree.
 */

import { useCallback, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import type { Id } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";

import { BlockRow } from "./BlockRow";
import { useMounted } from "./use-mounted";

export interface BlockListProps {
  /** Page id or parent block id that owns `blockIds`. */
  parentId: Id;
  blockIds: Id[];
  depth?: number;
}

export function BlockList({ parentId, blockIds, depth = 0 }: BlockListProps) {
  const [activeId, setActiveId] = useState<Id | null>(null);

  // `DragOverlay` renders into a portal and measures the viewport, neither of
  // which exists during the server pass — mounting it before hydration is a
  // guaranteed markup mismatch.
  const mounted = useMounted();

  const sensors = useSensors(
    // Without a distance threshold the handle's pointerdown starts a drag
    // immediately and the click that opens the block menu never lands.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const newIndex = blockIds.indexOf(String(over.id));
      if (newIndex === -1) return;
      // `moveBlock` detaches before it inserts, so the over-index is already
      // the post-removal index — the same semantics as `arrayMove`.
      useWorkspaceStore.getState().moveBlock(String(active.id), parentId, newIndex);
    },
    [blockIds, parentId],
  );

  if (blockIds.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
        <div>
          {blockIds.map((blockId) => (
            <BlockRow
              key={blockId}
              blockId={blockId}
              parentId={parentId}
              depth={depth}
            />
          ))}
        </div>
      </SortableContext>

      {mounted ? (
        <DragOverlay dropAnimation={null}>
          {activeId ? <DragPreview blockId={activeId} /> : null}
        </DragOverlay>
      ) : null}
    </DndContext>
  );
}

/**
 * A flat preview, never the real block.
 *
 * Rendering `BlockRenderer` here would mount a second `Editable` for the same
 * block id, and the focus registry is keyed by id — the clone would evict the
 * original and every caret operation would target a node inside the overlay.
 */
function DragPreview({ blockId }: { blockId: Id }) {
  const text = useWorkspaceStore((state) => state.blocks[blockId]?.text ?? "");
  const type = useWorkspaceStore((state) => state.blocks[blockId]?.type);

  return (
    <div
      className="max-w-full truncate rounded-[3px] px-2 py-[3px]"
      style={{
        background: "var(--accent-soft)",
        color: "var(--tex-pri)",
        fontSize: "var(--editor-text, 16px)",
        lineHeight: 1.5,
        boxShadow: "var(--shadow-card)",
        cursor: "grabbing",
      }}
    >
      {text || (type ? type.replace(/_/g, " ") : "")}
    </div>
  );
}
