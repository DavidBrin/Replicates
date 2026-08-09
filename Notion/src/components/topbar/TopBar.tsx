"use client";

/**
 * The page top bar: breadcrumb on the left, page-level actions on the right.
 *
 * It is the single piece of chrome a page route mounts — the guest strip
 * renders beneath it from in here, so a route never has to remember to add it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  CornerUpRight,
  Download,
  Ellipsis,
  FileText,
  Link as LinkIcon,
  MessageSquare,
  PanelLeftOpen,
  Pencil,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { useShell } from "@/components/app-shell/WorkspaceShell";
import { AvatarStack } from "@/components/primitives/Avatar";
import { MenuItem, MenuLabel, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { Popover } from "@/components/primitives/Popover";
import { SharePopover } from "@/components/sharing/SharePopover";
import { layout, routes } from "@/config/app.config";
import { cn } from "@/lib/utils/cn";
import type { Id, Page } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { exportWorkspaceFile, importWorkspaceFile } from "@/lib/store/hydration";
import { GuestBanner } from "./GuestBanner";
import { Switch } from "./Switch";

/* --------------------------------------------------------------- helpers -- */

/** "Edited just now" / "Edited 20m ago" / "Edited Feb 19". */
export function formatEdited(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Edited just now";

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours}h ago`;

  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `Edited ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}

type PageStyle = "default" | "serif" | "mono";

/* ---------------------------------------------------------------- top bar -- */

export function TopBar({ pageId }: { pageId: string }) {
  const { sidebarCollapsed, setSidebarCollapsed } = useShell();
  const router = useRouter();

  // The whole page map: the breadcrumb walks ancestors, so it genuinely does
  // depend on more than one page. The reference is stable between writes.
  const pages = useWorkspaceStore((s) => s.pages);
  const users = useWorkspaceStore((s) => s.users);
  const workspaceMembers = useWorkspaceStore((s) => s.workspace.members);
  const renamePage = useWorkspaceStore((s) => s.renamePage);
  const duplicatePage = useWorkspaceStore((s) => s.duplicatePage);
  const togglePageFavorite = useWorkspaceStore((s) => s.togglePageFavorite);
  const movePageToTrash = useWorkspaceStore((s) => s.movePageToTrash);
  const movePageInSidebar = useWorkspaceStore((s) => s.movePageInSidebar);
  const setPageFullWidth = useWorkspaceStore((s) => s.setPageFullWidth);
  const setPageSmallText = useWorkspaceStore((s) => s.setPageSmallText);
  const sections = useWorkspaceStore((s) => s.workspace.sections);

  const page = pages[pageId];

  const shareAnchor = useRef<HTMLButtonElement>(null);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<"root" | "move">("root");
  const [pageStyle, setPageStyle] = useState<PageStyle>("default");
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  // Relative time is computed from `Date.now()`, which differs between the
  // server pass and hydration. Rendering it only after mount keeps the two
  // HTML trees identical; the interval then keeps it honest.
  const [edited, setEdited] = useState("");
  useEffect(() => {
    if (!page) return;
    const update = () => setEdited(formatEdited(page.lastEditedAt));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [page]);

  const crumbs = useMemo(() => {
    const chain: Page[] = [];
    let cursor: Id | null | undefined = pageId;
    // Guard against a cycle in `parentId`; a corrupt import must not hang the
    // top bar.
    const seen = new Set<Id>();
    while (cursor && pages[cursor] && !seen.has(cursor)) {
      seen.add(cursor);
      chain.unshift(pages[cursor]);
      cursor = pages[cursor].parentId;
    }
    return chain;
  }, [pageId, pages]);

  const memberUsers = useMemo(() => {
    const memberships = page?.members?.length ? page.members : workspaceMembers;
    return memberships.map((member) => users[member.userId]);
  }, [page, users, workspaceMembers]);

  if (!page) return null;

  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const commitRename = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== page.title) renamePage(pageId, next);
  };

  return (
    <>
      <header
        className="flex shrink-0 items-center gap-2 px-3"
        style={{ height: layout.topBar.height, background: "var(--bac-pri)" }}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            aria-label="Open sidebar"
            title="Open sidebar"
            onClick={() => setSidebarCollapsed(false)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int)]"
            style={{ color: "var(--ico-sec)" }}
          >
            <PanelLeftOpen size={18} />
          </button>
        ) : null}

        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                {index > 0 ? (
                  <span className="shrink-0 px-0.5" style={{ color: "var(--tex-ter)" }}>
                    /
                  </span>
                ) : null}

                {isLast && renaming ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename();
                      if (event.key === "Escape") setRenaming(false);
                    }}
                    className="min-w-0 rounded-[4px] px-1.5 py-0.5 text-sm outline-hidden"
                    style={{
                      background: "var(--bac-int)",
                      color: "var(--tex-pri)",
                      boxShadow: "0 0 0 1px var(--accent-ring)",
                    }}
                  />
                ) : isLast ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(crumb.title);
                      setRenaming(true);
                    }}
                    title="Rename"
                    className="flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)]"
                    style={{ color: "var(--tex-pri)" }}
                  >
                    <CrumbIcon page={crumb} />
                    <span className="truncate">{crumb.title || "Untitled"}</span>
                  </button>
                ) : (
                  <Link
                    href={routes.page(crumb.id)}
                    className="flex min-w-0 items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)]"
                    style={{ color: "var(--tex-sec)" }}
                  >
                    <CrumbIcon page={crumb} />
                    <span className="truncate">{crumb.title || "Untitled"}</span>
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden px-1 text-xs sm:inline" style={{ color: "var(--tex-ter)" }}>
            {edited}
          </span>

          <AvatarStack users={memberUsers} size={22} max={3} className="mr-1" />

          <button
            ref={shareAnchor}
            type="button"
            onClick={() => setShareOpen((open) => !open)}
            className="rounded-[4px] px-2 py-1 text-sm transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)]"
            style={{ color: "var(--tex-sec)" }}
          >
            Share
          </button>

          <BarIcon label="Comments">
            <MessageSquare size={18} />
          </BarIcon>

          <BarIcon label={copied ? "Copied" : "Copy link"} onClick={copyLink}>
            {copied ? (
              <Check size={18} style={{ color: "var(--tag-green-fg)" }} />
            ) : (
              <LinkIcon size={18} />
            )}
          </BarIcon>

          <BarIcon
            label={page.favorite ? "Remove from Favorites" : "Add to Favorites"}
            onClick={() => togglePageFavorite(pageId)}
          >
            <Star
              size={18}
              // Amber + filled is the only state change; Notion does not move
              // or resize the star.
              style={{ color: page.favorite ? "var(--tag-yellow-dot)" : undefined }}
              fill={page.favorite ? "var(--tag-yellow-dot)" : "none"}
            />
          </BarIcon>

          <BarIcon
            label="More options"
            ref={menuAnchor}
            onClick={() => {
              setMenuView("root");
              setMenuOpen((open) => !open);
            }}
          >
            <Ellipsis size={18} />
          </BarIcon>
        </div>
      </header>

      <GuestBanner />

      <SharePopover
        open={shareOpen}
        onOpenChange={setShareOpen}
        anchor={shareAnchor}
        pageId={pageId}
      />

      <Popover open={menuOpen} onOpenChange={setMenuOpen} anchor={menuAnchor} align="end" width={268}>
        {menuView === "move" ? (
          <MenuList>
            <MenuLabel>Move to</MenuLabel>
            {sections.map((section) => (
              <MenuItem
                key={section.id}
                onSelect={() => {
                  movePageInSidebar(pageId, section.id, section.pageIds.length);
                  setMenuOpen(false);
                }}
              >
                {section.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => setMenuView("root")}>Back</MenuItem>
          </MenuList>
        ) : (
          <>
            {/* Style: visual-only, so it stays local state rather than
                widening the persisted page model for a demo affordance. */}
            <div className="px-3 py-2">
              <p className="pb-1.5 text-[11px] font-medium" style={{ color: "var(--tex-ter)" }}>
                Style
              </p>
              <div
                className="flex gap-1 rounded-[6px] p-0.5"
                style={{ background: "var(--bac-int)" }}
              >
                {(["default", "serif", "mono"] as PageStyle[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPageStyle(option)}
                    className={cn(
                      "flex-1 rounded-[4px] py-1 text-xs capitalize transition-colors duration-100 outline-hidden",
                      option === "serif" && "font-serif",
                      option === "mono" && "font-mono",
                    )}
                    style={
                      pageStyle === option
                        ? { background: "var(--bac-ele)", color: "var(--tex-pri)", boxShadow: "var(--shadow-sm)" }
                        : { color: "var(--tex-sec)" }
                    }
                  >
                    {option === "default" ? "Default" : option === "serif" ? "Serif" : "Mono"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between px-3 py-1.5 text-sm" style={{ color: "var(--tex-pri)" }}>
              Small text
              <Switch
                label="Small text"
                checked={Boolean(page.smallText)}
                onChange={(next) => setPageSmallText(pageId, next)}
              />
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 pb-2 text-sm" style={{ color: "var(--tex-pri)" }}>
              Full width
              <Switch
                label="Full width"
                checked={Boolean(page.fullWidth)}
                onChange={(next) => setPageFullWidth(pageId, next)}
              />
            </div>

            <MenuSeparator />

            <MenuList>
              <MenuItem
                icon={copied ? <Check size={14} /> : <LinkIcon size={14} />}
                onSelect={() => {
                  copyLink();
                  setMenuOpen(false);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </MenuItem>
              <MenuItem
                icon={<Copy size={14} />}
                onSelect={() => {
                  const copyId = duplicatePage(pageId);
                  setMenuOpen(false);
                  router.push(routes.page(copyId));
                }}
              >
                Duplicate
              </MenuItem>
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
              <MenuItem icon={<CornerUpRight size={14} />} onSelect={() => setMenuView("move")}>
                Move to
              </MenuItem>
              <MenuItem
                icon={<Trash2 size={14} />}
                danger
                onSelect={() => {
                  movePageToTrash(pageId);
                  setMenuOpen(false);
                  router.push(routes.workspace);
                }}
              >
                Move to Trash
              </MenuItem>
            </MenuList>

            <MenuSeparator />

            <MenuList>
              <MenuItem
                icon={<Download size={14} />}
                onSelect={() => {
                  exportWorkspaceFile();
                  setMenuOpen(false);
                }}
              >
                Export
              </MenuItem>
              <MenuItem
                icon={<Upload size={14} />}
                onSelect={() => {
                  fileInput.current?.click();
                  setMenuOpen(false);
                }}
              >
                Import
              </MenuItem>
            </MenuList>

            <MenuSeparator />

            <div className="px-3 pb-2 pt-1 text-[11px]" style={{ color: "var(--tex-ter)" }}>
              <div>Last edited by {users[page.lastEditedBy]?.name ?? "someone"}</div>
              <div>{new Date(page.lastEditedAt).toLocaleString()}</div>
            </div>
          </>
        )}
      </Popover>

      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importWorkspaceFile(file);
        }}
      />
    </>
  );
}

/* --------------------------------------------------------------- fragments -- */

function CrumbIcon({ page }: { page: Page }) {
  if (page.icon.type === "emoji") {
    return <span className="shrink-0 text-[14px] leading-none">{page.icon.emoji}</span>;
  }
  return <FileText size={14} strokeWidth={1.8} className="shrink-0" style={{ color: "var(--ico-ter)" }} />;
}

const BarIcon = function BarIcon({
  label,
  onClick,
  children,
  ref,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-[4px] transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)]"
      style={{ color: "var(--ico-sec)" }}
    >
      {children}
    </button>
  );
};
