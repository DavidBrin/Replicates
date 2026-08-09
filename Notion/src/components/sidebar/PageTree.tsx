"use client";

/**
 * The recursive page tree under one sidebar section.
 *
 * Reordering is only meaningful at the top level of a section — that is the
 * only ordering the store models (`SidebarSection.pageIds`), so the sortable
 * context wraps depth 0 and nested levels render as plain rows. A nested
 * node is deliberately *inside* its parent's sortable wrapper so that
 * dragging a page carries its subtree with it, as Notion does.
 */

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useShallow } from "zustand/react/shallow";
import { routes } from "@/config/app.config";
import type { Id, SidebarSection } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { SidebarPageRow } from "./SidebarPageRow";
import { SIDEBAR_BASE_PADDING, SIDEBAR_INDENT_PER_DEPTH } from "./SidebarRow";

export function PageTree({ section }: { section: SidebarSection }) {
  const movePageInSidebar = useWorkspaceStore((s) => s.movePageInSidebar);

  // A small distance threshold keeps a plain click on the row a click, not a
  // zero-pixel drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      // `movePageInSidebar` removes then inserts, which matches the index
      // semantics of dnd-kit's `arrayMove` target index exactly.
      const index = section.pageIds.indexOf(String(over.id));
      if (index < 0) return;
      movePageInSidebar(String(active.id), section.id, index);
    },
    [movePageInSidebar, section.id, section.pageIds],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={section.pageIds} strategy={verticalListSortingStrategy}>
        {section.pageIds.map((pageId) => (
          <SortablePageNode key={pageId} pageId={pageId} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

/* ------------------------------------------------------------------ nodes -- */

function SortablePageNode({ pageId }: { pageId: Id }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pageId,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {/* Listeners sit on the row only, never on the children container, so
          dragging a nested page does not pick up its ancestor. */}
      <PageNode pageId={pageId} depth={0} dragProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

interface PageNodeProps {
  pageId: Id;
  depth: number;
  dragProps?: Record<string, unknown>;
}

function PageNode({ pageId, depth, dragProps }: PageNodeProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  // Trashed children stay in `childPageIds` (the trash is a soft delete), so
  // they are filtered here. `useShallow` is required: the selector builds a
  // new array on every store change and React 19 rejects an uncached snapshot.
  const childIds = useWorkspaceStore(
    useShallow((s) =>
      (s.pages[pageId]?.childPageIds ?? []).filter((id) => s.pages[id] && !s.pages[id].inTrash),
    ),
  );
  const exists = useWorkspaceStore((s) => Boolean(s.pages[pageId] && !s.pages[pageId].inTrash));

  if (!exists) return null;

  return (
    <>
      <div {...dragProps}>
        <SidebarPageRow
          pageId={pageId}
          depth={depth}
          active={pathname === routes.page(pageId)}
          expanded={expanded}
          hasChildren={childIds.length > 0}
          onToggleExpanded={() => setExpanded((open) => !open)}
          onCreatedChild={() => setExpanded(true)}
        />
      </div>

      {expanded
        ? childIds.map((childId) => (
            <PageNode key={childId} pageId={childId} depth={depth + 1} />
          ))
        : null}

      {expanded && childIds.length === 0 ? (
        <div
          className="truncate text-sm"
          style={{
            height: 27,
            lineHeight: "23px",
            paddingLeft: SIDEBAR_BASE_PADDING + (depth + 1) * SIDEBAR_INDENT_PER_DEPTH + 24,
            color: "var(--tex-ter)",
          }}
        >
          No pages inside
        </div>
      ) : null}
    </>
  );
}
