"use client";

/**
 * ⌘K search.
 *
 * Controlled by `WorkspaceShell`, which owns the global shortcut so the key
 * map stays in one place. This component only handles what it can see: the
 * query, the highlighted row, Enter, and Escape.
 *
 * The dialog body is a separate component that mounts only while open. That
 * is what resets the query and the cursor between openings — a `useEffect`
 * watching `open` would do the same thing one render later and for more code.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Download, FileText, Moon, Search, SquarePen } from "lucide-react";
import { routes } from "@/config/app.config";
import type { Page } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { exportWorkspaceFile } from "@/lib/store/hydration";
import { useTheme } from "@/lib/theme/theme-provider";

const MAX_PAGE_RESULTS = 8;

interface Action {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  // The palette can only be opened by a user gesture, so it never renders
  // during the server pass and needs no `mounted` guard beyond this.
  if (!open || typeof document === "undefined") return null;
  return createPortal(<PaletteDialog onOpenChange={onOpenChange} />, document.body);
}

/* ---------------------------------------------------------------- dialog -- */

function PaletteDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { toggle: toggleTheme } = useTheme();

  const pages = useWorkspaceStore((s) => s.pages);
  const createPage = useWorkspaceStore((s) => s.createPage);

  const [query, setQuery] = useState("");
  const [rawCursor, setRawCursor] = useState(0);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (
      Object.values(pages)
        // Database rows are pages too, but they belong to their table, not to
        // a page-level search.
        .filter((page) => !page.inTrash && !page.databaseId)
        .filter((page) =>
          needle ? (page.title || "Untitled").toLowerCase().includes(needle) : true,
        )
        // Most recently touched first: with no query this is a "recents" list,
        // which is what Notion shows on an empty palette.
        .sort((a, b) => b.lastEditedAt.localeCompare(a.lastEditedAt))
        .slice(0, MAX_PAGE_RESULTS)
    );
  }, [pages, query]);

  const actions = useMemo<Action[]>(() => {
    const all: Action[] = [
      {
        id: "new-page",
        label: "New page",
        icon: <SquarePen size={15} />,
        run: () => router.push(routes.page(createPage({ title: "" }))),
      },
      {
        id: "toggle-theme",
        label: "Toggle dark mode",
        icon: <Moon size={15} />,
        run: toggleTheme,
      },
      {
        id: "export",
        label: "Export workspace",
        icon: <Download size={15} />,
        run: exportWorkspaceFile,
      },
    ];
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((action) => action.label.toLowerCase().includes(needle)) : all;
  }, [createPage, query, router, toggleTheme]);

  /** Flat selection order — arrows walk this, not the visual groups. */
  const items = useMemo(
    () => [
      ...results.map((page) => ({ kind: "page" as const, page })),
      ...actions.map((action) => ({ kind: "action" as const, action })),
    ],
    [actions, results],
  );

  // Clamped during render rather than corrected in an effect: narrowing the
  // query can shorten the list under a cursor that is already past the end.
  const cursor = Math.min(rawCursor, Math.max(0, items.length - 1));

  const run = (index: number) => {
    const item = items[index];
    if (!item) return;
    onOpenChange(false);
    if (item.kind === "page") router.push(routes.page(item.page.id));
    else item.action.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setRawCursor(items.length ? (cursor + 1) % items.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setRawCursor(items.length ? (cursor - 1 + items.length) % items.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(cursor);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]"
      style={{ background: "rgba(15, 15, 15, 0.4)" }}
      onPointerDown={(event) => {
        // Only a press that starts and ends on the scrim dismisses.
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={onKeyDown}
        className="flex max-h-[60vh] w-full max-w-[600px] flex-col overflow-hidden rounded-lg"
        style={{ background: "var(--bac-ele)", boxShadow: "var(--shadow-menu)" }}
      >
        <div
          className="flex shrink-0 items-center gap-2 border-b px-4"
          style={{ height: 48, borderColor: "var(--bor-pri)" }}
        >
          <Search size={16} style={{ color: "var(--ico-ter)" }} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setRawCursor(0);
            }}
            placeholder="Search or ask a question…"
            className="w-full bg-transparent text-[15px] outline-hidden"
            style={{ color: "var(--tex-pri)" }}
          />
          <kbd
            className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px]"
            style={{ background: "var(--bac-int)", color: "var(--tex-ter)" }}
          >
            esc
          </kbd>
        </div>

        <div className="notion-scroller flex-1 overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--tex-ter)" }}>
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : null}

          {results.length ? <GroupLabel>Pages</GroupLabel> : null}
          {results.map((page, index) => (
            <ResultRow
              key={page.id}
              selected={cursor === index}
              onHover={() => setRawCursor(index)}
              onSelect={() => run(index)}
              icon={<PageGlyph page={page} />}
              label={page.title || "Untitled"}
            />
          ))}

          {actions.length ? <GroupLabel>Actions</GroupLabel> : null}
          {actions.map((action, index) => {
            const flatIndex = results.length + index;
            return (
              <ResultRow
                key={action.id}
                selected={cursor === flatIndex}
                onHover={() => setRawCursor(flatIndex)}
                onSelect={() => run(flatIndex)}
                icon={action.icon}
                label={action.label}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- fragments -- */

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-2 text-[11px] font-medium" style={{ color: "var(--tex-ter)" }}>
      {children}
    </div>
  );
}

function PageGlyph({ page }: { page: Page }) {
  if (page.icon.type === "emoji") {
    return <span className="text-[15px] leading-none">{page.icon.emoji}</span>;
  }
  return <FileText size={15} strokeWidth={1.8} />;
}

function ResultRow({
  selected,
  onHover,
  onSelect,
  icon,
  label,
}: {
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Keep the keyboard cursor in view when it walks past the fold.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      // `mousemove` rather than `mouseenter`: the row under a stationary
      // pointer must not steal the highlight while arrowing through the list.
      onMouseMove={onHover}
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm outline-hidden"
      style={{
        background: selected ? "var(--bac-int)" : undefined,
        color: "var(--tex-pri)",
      }}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: "var(--ico-sec)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
