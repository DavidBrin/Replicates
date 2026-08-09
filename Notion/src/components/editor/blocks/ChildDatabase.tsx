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
    <div contentEditable={false} className="my-2">
      <DatabaseView databaseId={block.targetId} />
    </div>
  );
}
