"use client";

/**
 * One page line in the sidebar tree.
 *
 * The signature Notion detail here is the disclosure swap: at rest the row
 * shows the page's icon, and hovering that icon replaces it in place with a
 * chevron. It reads as a single control that changes meaning under the
 * pointer, which is why both live in the same 20px slot rather than sitting
 * side by side.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Copy,
  Ellipsis,
  FileText,
  Link as LinkIcon,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { routes } from "@/config/app.config";
import { cn } from "@/lib/utils/cn";
import type { Id } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import {
  SIDEBAR_BASE_PADDING,
  SIDEBAR_INDENT_PER_DEPTH,
  SIDEBAR_ROW_HEIGHT,
} from "./SidebarRow";

export interface SidebarPageRowProps {
  pageId: Id;
  depth: number;
  active: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onToggleExpanded: () => void;
  /** Called after a child page is created so the parent can reveal it. */
  onCreatedChild?: (childId: Id) => void;
}

export function SidebarPageRow({
  pageId,
  depth,
  active,
  expanded,
  onToggleExpanded,
  hasChildren,
  onCreatedChild,
}: SidebarPageRowProps) {
  // One entity per selector: typing in a page re-renders that page's row only.
  const page = useWorkspaceStore((s) => s.pages[pageId]);
  const renamePage = useWorkspaceStore((s) => s.renamePage);
  const duplicatePage = useWorkspaceStore((s) => s.duplicatePage);
  const togglePageFavorite = useWorkspaceStore((s) => s.togglePageFavorite);
  const movePageToTrash = useWorkspaceStore((s) => s.movePageToTrash);
  const createPage = useWorkspaceStore((s) => s.createPage);

  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (!page) return null;

  const title = page.title || "Untitled";

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== page.title) renamePage(pageId, next);
  };

  const addChild = () => {
    const childId = createPage({ parentId: pageId, title: "" });
    onCreatedChild?.(childId);
  };

  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${routes.page(pageId)}`);
  };

  return (
    // The hover wash lives on this container rather than on an underlay: a
    // sibling behind the content never matches `:hover`, since hit-testing
    // only walks the topmost element's ancestors.
    <div
      className="group/pagerow relative flex items-center rounded-[4px] transition-colors duration-100 hover:bg-[var(--bac-int)]"
      style={{
        height: SIDEBAR_ROW_HEIGHT,
        background: active ? "var(--bac-int-strong)" : undefined,
      }}
    >
      <div
        className="flex w-full min-w-0 items-center gap-1"
        style={{
          paddingLeft: SIDEBAR_BASE_PADDING + depth * SIDEBAR_INDENT_PER_DEPTH,
          paddingRight: 6,
        }}
      >
        {/* Icon / chevron swap slot. */}
        <span className="group/disc relative flex h-5 w-5 shrink-0 items-center justify-center">
          <span
            className="text-[14px] leading-none transition-opacity duration-100 group-hover/disc:opacity-0"
            style={{ color: "var(--ico-sec)" }}
          >
            {page.icon.type === "emoji" ? (
              page.icon.emoji
            ) : (
              <FileText size={16} strokeWidth={1.8} />
            )}
          </span>
          <button
            type="button"
            aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={expanded}
            onClick={(event) => {
              event.preventDefault();
              // Childless rows still show the affordance (Notion does), but
              // toggling would open an empty well, so it is inert.
              if (hasChildren) onToggleExpanded();
            }}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-[3px]",
              "opacity-0 transition-opacity duration-100 outline-hidden",
              "group-hover/disc:opacity-100 hover:bg-[var(--bac-int-strong)]",
            )}
            style={{ color: "var(--ico-sec)" }}
          >
            <ChevronRight
              size={14}
              className="transition-transform duration-100"
              style={{ transform: expanded ? "rotate(90deg)" : undefined }}
            />
          </button>
        </span>

        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(false);
              event.stopPropagation();
            }}
            autoFocus
            className="min-w-0 flex-1 rounded-[3px] px-1 text-sm outline-hidden"
            style={{
              background: "var(--bac-ele)",
              color: "var(--tex-pri)",
              boxShadow: "0 0 0 1px var(--accent-ring)",
            }}
          />
        ) : (
          <Link
            href={routes.page(pageId)}
            draggable={false}
            title={title}
            className="min-w-0 flex-1 truncate text-sm outline-hidden"
            style={{
              color: active ? "var(--tex-pri)" : "var(--tex-sec)",
              fontWeight: active ? 500 : 400,
            }}
          >
            {title}
          </Link>
        )}

        {/* Hover controls. Kept mounted so the fade has something to animate. */}
        <span
          className={cn(
            "ml-auto flex shrink-0 items-center gap-0.5",
            "opacity-0 transition-opacity duration-100",
            "group-hover/pagerow:opacity-100 focus-within:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          <button
            ref={menuAnchor}
            type="button"
            aria-label={`More options for ${title}`}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-5 w-5 items-center justify-center rounded-[3px] outline-hidden hover:bg-[var(--bac-int-strong)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <Ellipsis size={15} />
          </button>
          <button
            type="button"
            aria-label={`Add a page inside ${title}`}
            onClick={addChild}
            className="flex h-5 w-5 items-center justify-center rounded-[3px] outline-hidden hover:bg-[var(--bac-int-strong)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <Plus size={15} />
          </button>
        </span>
      </div>

      <Popover open={menuOpen} onOpenChange={setMenuOpen} anchor={menuAnchor} align="start" width={220}>
        <MenuList>
          <MenuItem
            icon={<Pencil size={14} />}
            onSelect={() => {
              setDraft(page.title);
              setRenaming(true);
              setMenuOpen(false);
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            icon={<Copy size={14} />}
            onSelect={() => {
              duplicatePage(pageId);
              setMenuOpen(false);
            }}
          >
            Duplicate
          </MenuItem>
          <MenuItem
            icon={<LinkIcon size={14} />}
            onSelect={() => {
              copyLink();
              setMenuOpen(false);
            }}
          >
            Copy link
          </MenuItem>
          <MenuItem
            icon={page.favorite ? <StarOff size={14} /> : <Star size={14} />}
            onSelect={() => {
              togglePageFavorite(pageId);
              setMenuOpen(false);
            }}
          >
            {page.favorite ? "Remove from Favorites" : "Add to Favorites"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 size={14} />}
            danger
            onSelect={() => {
              movePageToTrash(pageId);
              setMenuOpen(false);
            }}
          >
            Move to Trash
          </MenuItem>
        </MenuList>
      </Popover>
    </div>
  );
}
