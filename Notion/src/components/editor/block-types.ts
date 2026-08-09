/**
 * Block-type metadata and the one function that changes a block's type.
 *
 * Everything that offers the user a list of block types — the slash menu, the
 * "Turn into" submenu, the markdown shortcuts — reads from here, so adding a
 * type is a single entry rather than a change in three places.
 */

import {
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  MessageSquareQuote,
  Table2,
  Text,
  SquareChevronRight,
  type LucideIcon,
} from "lucide-react";

import type { BlockType, Id } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { focusBlock } from "./focus-registry";

export interface BlockTypeMeta {
  type: BlockType;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Extra terms the slash menu matches on ("h1", "todo", "```"). */
  keywords: string[];
}

export const BLOCK_TYPE_META: Record<BlockType, BlockTypeMeta> = {
  paragraph: {
    type: "paragraph",
    label: "Text",
    description: "Just start writing with plain text.",
    icon: Text,
    keywords: ["text", "paragraph", "plain"],
  },
  heading_1: {
    type: "heading_1",
    label: "Heading 1",
    description: "Big section heading.",
    icon: Heading1,
    keywords: ["h1", "title", "#"],
  },
  heading_2: {
    type: "heading_2",
    label: "Heading 2",
    description: "Medium section heading.",
    icon: Heading2,
    keywords: ["h2", "subtitle", "##"],
  },
  heading_3: {
    type: "heading_3",
    label: "Heading 3",
    description: "Small section heading.",
    icon: Heading3,
    keywords: ["h3", "###"],
  },
  to_do: {
    type: "to_do",
    label: "To-do list",
    description: "Track tasks with a checkbox.",
    icon: ListTodo,
    keywords: ["todo", "task", "checkbox", "check"],
  },
  bulleted_list_item: {
    type: "bulleted_list_item",
    label: "Bulleted list",
    description: "Create a simple bulleted list.",
    icon: List,
    keywords: ["bullet", "unordered", "ul", "-"],
  },
  numbered_list_item: {
    type: "numbered_list_item",
    label: "Numbered list",
    description: "Create a list with numbering.",
    icon: ListOrdered,
    keywords: ["number", "ordered", "ol", "1."],
  },
  toggle: {
    type: "toggle",
    label: "Toggle list",
    description: "Toggles can hide and show content.",
    icon: SquareChevronRight,
    keywords: ["toggle", "collapse", "details", "accordion"],
  },
  quote: {
    type: "quote",
    label: "Quote",
    description: "Capture a quote.",
    icon: MessageSquareQuote,
    keywords: ["quote", "blockquote", "citation"],
  },
  divider: {
    type: "divider",
    label: "Divider",
    description: "Visually divide blocks.",
    icon: Minus,
    keywords: ["divider", "line", "hr", "---"],
  },
  callout: {
    type: "callout",
    label: "Callout",
    description: "Make writing stand out.",
    icon: MessageSquareQuote,
    keywords: ["callout", "note", "info", "aside"],
  },
  code: {
    type: "code",
    label: "Code",
    description: "Capture a code snippet.",
    icon: Code,
    keywords: ["code", "snippet", "```"],
  },
  child_page: {
    type: "child_page",
    label: "Page",
    description: "Embed a sub-page inside this page.",
    icon: FileText,
    keywords: ["page", "subpage", "document"],
  },
  image: {
    type: "image",
    label: "Image",
    description: "Upload or embed with a link.",
    icon: ImageIcon,
    keywords: ["image", "picture", "photo", "img"],
  },
  child_database: {
    type: "child_database",
    label: "Database",
    description: "A table, board, list, calendar or gallery.",
    icon: Table2,
    keywords: ["database", "table", "board", "collection"],
  },
};

/** Slash-menu order, matching Notion's "Basic blocks" group. */
export const SLASH_COMMAND_TYPES: BlockType[] = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "to_do",
  "bulleted_list_item",
  "numbered_list_item",
  "toggle",
  "quote",
  "divider",
  "callout",
  "code",
  "child_page",
];

/** Types a text block can be converted into from the block menu. */
export const TURN_INTO_TYPES: BlockType[] = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "to_do",
  "bulleted_list_item",
  "numbered_list_item",
  "toggle",
  "quote",
  "callout",
  "code",
];

const LIST_ITEM_TYPES = new Set<BlockType>([
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
]);

const VOID_TYPES = new Set<BlockType>([
  "divider",
  "image",
  "child_page",
  "child_database",
]);

/** Types whose Enter creates another item of the same kind. */
export function isListItem(type: BlockType): boolean {
  return LIST_ITEM_TYPES.has(type);
}

/** Types that carry an editable text surface. */
export function isTextBlock(type: BlockType): boolean {
  return !VOID_TYPES.has(type);
}

/** Walks up the parent chain to the page that ultimately owns a block. */
export function owningPageId(blockId: Id): Id | null {
  const state = useWorkspaceStore.getState();
  let cursor: Id | undefined = state.blocks[blockId]?.parentId;
  while (cursor) {
    if (state.pages[cursor]) return cursor;
    cursor = state.blocks[cursor]?.parentId;
  }
  return null;
}

/**
 * Converts a block, handling the two types that are not a plain type swap:
 * a divider has no caret so the user needs a fresh line after it, and a page
 * block has to mint the page it points at.
 */
export function applyBlockType(blockId: Id, type: BlockType): void {
  const store = useWorkspaceStore.getState();
  const block = store.blocks[blockId];
  if (!block) return;

  if (type === "divider") {
    store.updateBlockText(blockId, "");
    store.convertBlock(blockId, "divider");
    const next = store.insertBlock({ parentId: block.parentId, afterBlockId: blockId });
    focusBlock(next, "start");
    return;
  }

  if (type === "child_page") {
    const title = block.text.trim();
    const pageId = store.createPage({ parentId: owningPageId(blockId), title });
    store.convertBlock(blockId, "child_page");
    store.patchBlock(blockId, { targetId: pageId, text: "" });
    return;
  }

  store.convertBlock(blockId, type);
  if (isTextBlock(type)) focusBlock(blockId, "end");
}

/** Markdown prefixes that convert a block when followed by a space. */
export const MARKDOWN_SHORTCUTS: { pattern: RegExp; type: BlockType }[] = [
  { pattern: /^#$/, type: "heading_1" },
  { pattern: /^##$/, type: "heading_2" },
  { pattern: /^###$/, type: "heading_3" },
  { pattern: /^[-*]$/, type: "bulleted_list_item" },
  { pattern: /^\d+\.$/, type: "numbered_list_item" },
  { pattern: /^\[\s?\]$/, type: "to_do" },
  { pattern: /^>$/, type: "quote" },
  { pattern: /^```$/, type: "code" },
  { pattern: /^-{3}$/, type: "divider" },
];
