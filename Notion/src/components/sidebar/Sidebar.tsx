"use client";

/**
 * The left rail.
 *
 * Order matters here: switcher → search → home → inbox → sections → pinned
 * footer is modern Notion's exact arrangement, and moving any of it makes the
 * clone read as "a sidebar" rather than "Notion's sidebar".
 *
 * Width and collapse are UI state and live in `WorkspaceShell` (so the top
 * bar's expand button and ⌘\ stay in sync); the hover-to-peek overlay is
 * purely local because nothing outside this component can observe it.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsUpDown,
  CircleQuestionMark,
  Download,
  House,
  Inbox,
  LayoutTemplate,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SquarePen,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { useShell } from "@/components/app-shell/WorkspaceShell";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuList, MenuSeparator } from "@/components/primitives/Menu";
import { MembersSettings } from "@/components/sharing/MembersSettings";
import { layout, routes, timing } from "@/config/app.config";
import { cn } from "@/lib/utils/cn";
import type { SidebarSection, SidebarSectionKind } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import {
  exportWorkspaceFile,
  importWorkspaceFile,
  resetWorkspace,
} from "@/lib/store/hydration";
import { PageTree } from "./PageTree";
import { SidebarRow } from "./SidebarRow";
import { TrashPanel } from "./TrashPanel";

/** Notion's fixed section order, whatever order the store happens to hold. */
const SECTION_ORDER: SidebarSectionKind[] = ["favorites", "shared", "private", "teamspace"];

/** Static, because this clone has no notification pipeline to count. */
const INBOX_UNREAD = 3;

export function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed, sidebarWidth, setSidebarWidth, setPaletteOpen } =
    useShell();

  const pathname = usePathname();
  const router = useRouter();

  const workspace = useWorkspaceStore((s) => s.workspace);
  const createPage = useWorkspaceStore((s) => s.createPage);

  const asideRef = useRef<HTMLElement>(null);
  const trashAnchor = useRef<HTMLDivElement>(null);

  const [peeking, setPeeking] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  // React's "adjust state during render" pattern. An expand that happens
  // elsewhere (⌘\, the top bar's button) has to drop the peek, or a later
  // collapse would float the rail open with nobody hovering it. Doing it in
  // an effect would render the wrong frame first.
  const [wasCollapsed, setWasCollapsed] = useState(sidebarCollapsed);
  if (wasCollapsed !== sidebarCollapsed) {
    setWasCollapsed(sidebarCollapsed);
    if (!sidebarCollapsed && peeking) setPeeking(false);
  }

  const newPage = (sectionId?: string) => {
    const id = createPage(sectionId ? { sectionId, title: "" } : { title: "" });
    router.push(routes.page(id));
  };

  /* ------------------------------------------------------------- resizing */

  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };

  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    // Measure against the rail's own left edge rather than the viewport, so
    // dragging still tracks the pointer while the peek overlay is inset.
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    const raw = event.clientX - left;

    if (raw < layout.sidebar.collapseThreshold) {
      setSidebarCollapsed(true);
      setResizing(false);
      return;
    }
    setSidebarWidth(
      Math.min(layout.sidebar.maxWidth, Math.max(layout.sidebar.minWidth, Math.round(raw))),
    );
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizing(false);
  };

  /* --------------------------------------------------------------- render */

  const hidden = sidebarCollapsed && !peeking;
  const sections = [...workspace.sections].sort(
    (a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind),
  );

  return (
    <>
      {/* Invisible strip that floats the rail back over the content. */}
      {hidden ? (
        <div
          aria-hidden
          className="fixed inset-y-0 left-0 z-30"
          style={{ width: layout.sidebar.peekTriggerWidth }}
          onMouseEnter={() => {
            peekTimer.current = window.setTimeout(
              () => setPeeking(true),
              timing.sidebarPeekDelayMs,
            );
          }}
          onMouseLeave={() => window.clearTimeout(peekTimer.current)}
        />
      ) : null}

      <aside
        ref={asideRef}
        aria-label="Sidebar"
        onMouseLeave={() => {
          if (peeking && !resizing) setPeeking(false);
        }}
        // Branch rather than append: `hidden`/`flex` and `fixed`/`relative`
        // are the same CSS property, and without tailwind-merge the loser is
        // decided by stylesheet order rather than by intent.
        className={cn(
          "flex-col",
          hidden ? "hidden" : "flex",
          peeking ? "fixed inset-y-2 left-2 z-40 rounded-lg" : "relative shrink-0",
        )}
        style={{
          width: sidebarWidth,
          background: "var(--bac-sec)",
          boxShadow: peeking ? "var(--shadow-menu)" : undefined,
          // Suppress the width transition mid-drag or the rail lags the cursor.
          transition: resizing ? undefined : "width 120ms var(--ease-notion)",
        }}
      >
        <WorkspaceSwitcher
          onCollapse={() => setSidebarCollapsed(true)}
          onPin={() => {
            setPeeking(false);
            setSidebarCollapsed(false);
          }}
          collapsed={sidebarCollapsed}
          onNewPage={() => newPage()}
        />

        <div className="notion-scroller flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          <SidebarRow
            icon={<Search size={16} strokeWidth={1.9} />}
            label="Search"
            onClick={() => setPaletteOpen(true)}
            trailing={
              <span className="text-xs" style={{ color: "var(--tex-ter)" }}>
                ⌘K
              </span>
            }
          />
          <SidebarRow
            icon={<House size={16} strokeWidth={1.9} />}
            label="Home"
            href={routes.workspace}
            active={pathname === routes.workspace}
          />
          <SidebarRow
            icon={<Inbox size={16} strokeWidth={1.9} />}
            label="Inbox"
            trailing={
              <span
                className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium"
                style={{ background: "var(--tag-red-dot)", color: "#fff" }}
              >
                {INBOX_UNREAD}
              </span>
            }
          />

          <div className="h-4" />

          {sections.map((section) => (
            <SectionGroup key={section.id} section={section} onAddPage={() => newPage(section.id)} />
          ))}
        </div>

        {/* Pinned footer */}
        <div className="shrink-0 px-2 pb-2" ref={trashAnchor}>
          <SidebarRow icon={<LayoutTemplate size={16} strokeWidth={1.9} />} label="Templates" />
          <SidebarRow
            icon={<Trash2 size={16} strokeWidth={1.9} />}
            label="Trash"
            onClick={() => setTrashOpen((open) => !open)}
          />
          <SidebarRow
            icon={<CircleQuestionMark size={16} strokeWidth={1.9} />}
            label="Help"
          />
          <button
            type="button"
            onClick={() => newPage()}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-sm font-medium transition-colors duration-100 outline-hidden hover:brightness-95"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <Plus size={15} />
            New page
          </button>
        </div>

        <TrashPanel open={trashOpen} onOpenChange={setTrashOpen} anchor={trashAnchor} />

        {/* Drag-to-resize edge. 4px wide, invisible until hovered. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className="absolute inset-y-0 -right-[2px] z-20 w-[5px] cursor-col-resize"
        >
          <div
            className={cn(
              "h-full w-[2px] transition-opacity duration-100",
              resizing ? "opacity-100" : "opacity-0 hover:opacity-100",
            )}
            style={{ background: "var(--accent-ring)", marginLeft: 2 }}
          />
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------ workspace switcher -- */

function WorkspaceSwitcher({
  onCollapse,
  onPin,
  collapsed,
  onNewPage,
}: {
  onCollapse: () => void;
  onPin: () => void;
  collapsed: boolean;
  onNewPage: () => void;
}) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const currentUser = useWorkspaceStore((s) => s.users[s.currentUserId]);

  const anchor = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [focusInvite, setFocusInvite] = useState(false);

  return (
    <div className="group/switch flex items-center gap-1 px-2 pt-2 pb-1">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-[4px] px-1.5 text-left transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int)]"
      >
        <span
          className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[4px] text-[13px] leading-none"
          style={{ background: "var(--bac-int-strong)" }}
        >
          {workspace.icon.type === "emoji"
            ? workspace.icon.emoji
            : workspace.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: "var(--tex-pri)" }}>
          {workspace.name}
        </span>
        <span
          className="shrink-0 rounded-[3px] px-1 text-[10px] font-medium uppercase tracking-wide"
          style={{ background: "var(--bac-int-strong)", color: "var(--tex-ter)" }}
        >
          {workspace.plan}
        </span>
        <ChevronsUpDown size={13} className="shrink-0" style={{ color: "var(--ico-ter)" }} />
      </button>

      {/* Hover-only rail controls, exactly as Notion reveals them. */}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/switch:opacity-100">
        <button
          type="button"
          aria-label={collapsed ? "Keep sidebar open" : "Close sidebar"}
          title={collapsed ? "Keep sidebar open" : "Close sidebar"}
          onClick={collapsed ? onPin : onCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int)]"
          style={{ color: "var(--ico-sec)" }}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <ChevronsLeft size={16} />}
        </button>
        <button
          type="button"
          aria-label="New page"
          title="New page"
          onClick={onNewPage}
          className="flex h-7 w-7 items-center justify-center rounded-[4px] outline-hidden hover:bg-[var(--bac-int)]"
          style={{ color: "var(--ico-sec)" }}
        >
          <SquarePen size={16} />
        </button>
      </span>

      <Popover open={open} onOpenChange={setOpen} anchor={anchor} align="start" width={272}>
        <div className="px-3 py-2">
          <p className="truncate text-xs" style={{ color: "var(--tex-ter)" }}>
            {currentUser?.email}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] text-[13px] leading-none"
              style={{ background: "var(--bac-int-strong)" }}
            >
              {workspace.icon.type === "emoji"
                ? workspace.icon.emoji
                : workspace.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" style={{ color: "var(--tex-pri)" }}>
                {workspace.name}
              </span>
              <span className="block text-[11px]" style={{ color: "var(--tex-ter)" }}>
                {workspace.plan} plan · {workspace.members.length} member
                {workspace.members.length === 1 ? "" : "s"}
              </span>
            </span>
          </div>
        </div>

        <MenuSeparator />

        <MenuList>
          <MenuItem
            icon={<Settings size={14} />}
            onSelect={() => {
              setFocusInvite(false);
              setMembersOpen(true);
              setOpen(false);
            }}
          >
            Settings
          </MenuItem>
          <MenuItem
            icon={<UserPlus size={14} />}
            onSelect={() => {
              setFocusInvite(true);
              setMembersOpen(true);
              setOpen(false);
            }}
          >
            Invite members
          </MenuItem>
        </MenuList>

        <MenuSeparator />

        <MenuList>
          <MenuItem
            icon={<Download size={14} />}
            onSelect={() => {
              exportWorkspaceFile();
              setOpen(false);
            }}
          >
            Export JSON
          </MenuItem>
          <MenuItem
            icon={<Upload size={14} />}
            onSelect={() => {
              fileInput.current?.click();
              setOpen(false);
            }}
          >
            Import JSON
          </MenuItem>
          <MenuItem
            icon={<RotateCcw size={14} />}
            danger
            onSelect={() => {
              void resetWorkspace();
              setOpen(false);
            }}
          >
            Reset demo workspace
          </MenuItem>
        </MenuList>
      </Popover>

      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset the input so re-importing the same file fires `change` again.
          event.target.value = "";
          if (file) void importWorkspaceFile(file);
        }}
      />

      <MembersSettings
        open={membersOpen}
        onOpenChange={setMembersOpen}
        autoFocusInvite={focusInvite}
      />
    </div>
  );
}

/* ---------------------------------------------------------- section group -- */

function SectionGroup({
  section,
  onAddPage,
}: {
  section: SidebarSection;
  onAddPage: () => void;
}) {
  const toggleSectionCollapsed = useWorkspaceStore((s) => s.toggleSectionCollapsed);

  // Private always shows, even when empty, so there is somewhere to put a
  // first page. Every other section hides rather than render a bare label.
  if (section.pageIds.length === 0 && section.kind !== "private") return null;

  return (
    <div className="pb-1">
      <div className="group/section flex h-[27px] items-center rounded-[4px] pr-1 transition-colors duration-100 hover:bg-[var(--bac-int)]">
        <button
          type="button"
          onClick={() => toggleSectionCollapsed(section.id)}
          aria-expanded={!section.collapsed}
          className="flex min-w-0 flex-1 items-center gap-1 px-2 text-left outline-hidden"
        >
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--tex-ter)" }}>
            {section.label}
          </span>
          <span
            className="opacity-0 transition-opacity duration-100 group-hover/section:opacity-100"
            style={{ color: "var(--ico-ter)" }}
          >
            {section.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
        </button>
        <button
          type="button"
          aria-label={`New page in ${section.label}`}
          title={`New page in ${section.label}`}
          onClick={onAddPage}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] opacity-0 transition-opacity duration-100 outline-hidden group-hover/section:opacity-100 hover:bg-[var(--bac-int-strong)]"
          style={{ color: "var(--ico-sec)" }}
        >
          <Plus size={14} />
        </button>
      </div>

      {section.collapsed ? null : section.pageIds.length === 0 ? (
        <p className="px-2 py-1 text-[13px]" style={{ color: "var(--tex-ter)" }}>
          No pages inside
        </p>
      ) : (
        <PageTree section={section} />
      )}
    </div>
  );
}
