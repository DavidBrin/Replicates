"use client";

/**
 * The workspace frame: a 244px rail with an inset content card floating over
 * it.
 *
 * ## The inset is the whole trick
 *
 * `margin: 8px; margin-left: var(--sidebar-width); border-radius: 12px` — from
 * Linear's own source (`research/01-visual-design.md` §6.1). The content pane
 * is a card on a darker ground, and **there is no border between the sidebar
 * and the content**: the separation is a lightness step. Drawing a 1px vertical
 * divider instead is named in the research as the single most common structural
 * tell in clones, and it is the kind of mistake that survives every other detail
 * being right.
 *
 * ## `data-app-shell`
 *
 * `globals.css` locks body scrolling on `body[data-app-shell="true"]`, because
 * this is a fixed three-pane layout in which only the panes scroll. The root
 * layout renders `"false"` — it also wraps the marketing page and the auth
 * screens, which are ordinary scrolling documents — so **the flag is this
 * component's to set and to put back**. Restoring the previous value rather
 * than deleting the attribute matters: a client-side navigation from here to
 * `/signin` unmounts this and must leave the document scrollable again.
 *
 * ## `[` collapses the rail, and `Cmd+B` does not
 *
 * The obvious guess is wrong and the research says so twice: Linear's changelog
 * binds `[` to the sidebar, and two Linear docs pages bind `Cmd+B` to the
 * list⇄board switch (§1.10). Shipping the guess costs a user their layout every
 * time they reach for bold.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";
import { useShortcuts, type Binding } from "@/components/issues/keyboard";
import { CommandSurface } from "@/components/command-palette";
import { Sidebar } from "@/components/app-shell/sidebar";
import {
  WorkspaceProvider,
  type ShellData,
} from "@/components/app-shell/workspace-context";

/** Where the rail's disclosure state is remembered between sessions. */
const LAYOUT_STORAGE_KEY = "linear:shell";

interface ShellLayout {
  readonly collapsed: boolean;
  readonly teams: readonly string[];
  readonly sections: readonly string[];
}

const DEFAULT_LAYOUT: ShellLayout = {
  collapsed: false,
  teams: [],
  sections: ["workspace", "teams"],
};

function parseLayout(raw: string | null): ShellLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_LAYOUT;
    const record = parsed as Partial<Record<keyof ShellLayout, unknown>>;
    return {
      collapsed: record.collapsed === true,
      teams: Array.isArray(record.teams)
        ? record.teams.filter((entry): entry is string => typeof entry === "string")
        : DEFAULT_LAYOUT.teams,
      sections: Array.isArray(record.sections)
        ? record.sections.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : DEFAULT_LAYOUT.sections,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * The rail's disclosure state, as an external store.
 *
 * It is a browser fact — it lives in `localStorage`, it is absent on the
 * server, and it can be changed from two places (`[` and the chevrons). That is
 * exactly what `useSyncExternalStore` models, and modelling it as `useState`
 * seeded in an effect instead would cost a cascading render on every mount and
 * hand every shell its own private copy.
 *
 * The snapshot is **cached**, because `useSyncExternalStore` compares snapshots
 * with `Object.is`: parsing the JSON afresh on every call would return a new
 * object every time and re-render forever.
 */
let cachedLayout: ShellLayout | null = null;
const layoutListeners = new Set<() => void>();

function subscribeToLayout(onChange: () => void): () => void {
  layoutListeners.add(onChange);
  return () => layoutListeners.delete(onChange);
}

function layoutSnapshot(): ShellLayout {
  if (cachedLayout) return cachedLayout;
  try {
    cachedLayout = parseLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    // Private mode and some enterprise policies throw on access rather than
    // returning null. A remembered sidebar is not worth an unhandled error.
    cachedLayout = DEFAULT_LAYOUT;
  }
  return cachedLayout;
}

function layoutServerSnapshot(): ShellLayout {
  return DEFAULT_LAYOUT;
}

function writeLayout(next: ShellLayout): void {
  cachedLayout = next;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Losing persistence is acceptable; losing the interaction is not.
  }
  for (const listener of layoutListeners) listener();
}

function updateLayout(update: (current: ShellLayout) => ShellLayout): void {
  writeLayout(update(layoutSnapshot()));
}

export interface AppShellProps {
  readonly data: ShellData;
  readonly children: ReactNode;
}

export function AppShell({ data, children }: AppShellProps) {
  const pathname = usePathname();
  const layout = useSyncExternalStore(
    subscribeToLayout,
    layoutSnapshot,
    layoutServerSnapshot,
  );

  useEffect(() => {
    const previous = document.body.dataset.appShell;
    document.body.dataset.appShell = "true";
    return () => {
      if (previous === undefined) delete document.body.dataset.appShell;
      else document.body.dataset.appShell = previous;
    };
  }, []);

  const bindings: readonly Binding[] = [
    {
      id: "shell.toggleSidebar",
      keys: "[",
      run: () =>
        updateLayout((current) => ({
          ...current,
          collapsed: !current.collapsed,
        })),
    },
  ];
  useShortcuts(bindings);

  const toggleTeam = (key: string): void => {
    updateLayout((current) => ({
      ...current,
      teams: current.teams.includes(key)
        ? current.teams.filter((entry) => entry !== key)
        : [...current.teams, key],
    }));
  };

  const toggleSection = (id: string): void => {
    updateLayout((current) => ({
      ...current,
      sections: current.sections.includes(id)
        ? current.sections.filter((entry) => entry !== id)
        : [...current.sections, id],
    }));
  };

  return (
    <WorkspaceProvider value={data}>
      {/*
        The keyboard surface: palette, search, the `?` sheet and the chord hint.
        Mounted here because these are portalled overlays that must exist on
        every workspace screen, and because neither slice could write this line
        for itself — the palette lives in one and the shell in another.

        No `onCommand`: the palette's navigation commands are handled inside
        `CommandSurface` (a router push needs nothing from the app), and its
        mutation commands belong to whoever owns the optimistic store, which is
        the issue view rather than the frame. A palette that reached into that
        store from here would couple the app's most central surface to every
        slice at once.
      */}
      <CommandSurface workspaceKey={data.workspace.urlKey} />
      <div className="flex h-dvh w-full overflow-hidden bg-[var(--bg-sidebar)]">
        <div
          data-collapsed={layout.collapsed}
          className={cn(
            "h-full shrink-0 overflow-hidden",
            "[transition:width_var(--speed-regular)_var(--ease-quad)]",
          )}
          style={{ width: layout.collapsed ? 0 : "var(--sidebar-width)" }}
        >
          <Sidebar
            pathname={pathname}
            expandedTeams={new Set(layout.teams)}
            onToggleTeam={toggleTeam}
            expandedSections={new Set(layout.sections)}
            onToggleSection={toggleSection}
          />
        </div>

        {/* 8px on three sides and flush against the rail, which is what makes
            the card read as floating in front of the sidebar rather than
            sitting beside it. */}
        <main
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden",
            "my-[var(--shell-inset)] mr-[var(--shell-inset)]",
            "rounded-[var(--shell-radius)] border border-subtle bg-[var(--bg-panel)]",
          )}
        >
          {children}
        </main>
      </div>
    </WorkspaceProvider>
  );
}
