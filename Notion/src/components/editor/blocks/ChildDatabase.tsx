"use client";

/**
 * An inline database embedded in a page.
 *
 * `DatabaseView` is owned by the database module; the editor only knows that a
 * `child_database` block points at a database id and hands rendering over.
 */

import { DatabaseView } from "@/components/database/DatabaseView";
import type { BlockComponentProps } from "./shared";

export function ChildDatabase({ block }: BlockComponentProps) {
  if (!block.targetId) return null;
  return (
    // `notion-breakout` (globals.css) widens the block past the page's text
    // measure — a board with five columns should not be squeezed into the
    // 708px column the prose uses.
    <div contentEditable={false} className="notion-breakout my-2">
      <DatabaseView databaseId={block.targetId} />
    </div>
  );
}
