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

import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import { useShortcut } from "@/lib/keyboard";
import {
  nextThemePreference,
  readStoredPreference,
  setThemePreference,
} from "@/lib/theme";
import { toast } from "@/components/ui/toast-provider";
import { CommandSurface } from "@/components/command-palette";
import {
  PaletteRegistryProvider,
  usePublishedContribution,
} from "@/components/command-palette/palette-registry";
import type {
  Command,
  CommandEffect,
  PaletteContext,
} from "@/components/command-palette/commands";
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
  return (
    <WorkspaceProvider value={data}>
      {/*
        The registry sits above both halves on purpose: `CommandSurface` is a
        sibling of `children`, so the screen in view can only reach the palette
        by publishing upward. See `command-palette/palette-registry.tsx`.
      */}
      <PaletteRegistryProvider>
        <ShellFrame data={data}>{children}</ShellFrame>
      </PaletteRegistryProvider>
    </WorkspaceProvider>
  );
}

function ShellFrame({ data, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
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

  const toggleSidebar = useCallback(() => {
    updateLayout((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  // `[`, not `Cmd+B`. Registered on the one dispatcher the whole application
  // shares, at the global scope the registry names — a second `document`
  // listener would have no way to know a modal was open above it.
  useShortcut("app.sidebar", toggleSidebar);

  /* --- the command palette's context and effects ---------------------- */

  const contribution = usePublishedContribution();
  const teamKey = teamKeyFromPath(pathname);

  /**
   * What the palette knows.
   *
   * The shell owns the two facts that are true on every screen — the workspace
   * the hrefs are built from, and the teams that are navigation destinations —
   * and the screen in view contributes the rest. Mounted without this, the
   * palette builds `/undefined/inbox` style hrefs off an empty workspace key and
   * offers no issue actions at all, because it has no selection to offer them
   * for.
   */
  const paletteContext = useMemo<PaletteContext>(
    () => ({
      workspaceKey: data.workspace.urlKey,
      surface: contribution?.surface ?? "other",
      selection: contribution?.selection ?? [],
      statuses: contribution?.statuses ?? [],
      people: contribution?.people ?? [],
      labels: contribution?.labels ?? [],
      teams: data.teams.map((team) => ({ key: team.key, name: team.name })),
    }),
    [data.workspace.urlKey, data.teams, contribution],
  );

  /**
   * Route a chosen command to whoever owns it.
   *
   * The screen in view gets first refusal, because every issue action is a
   * mutation against *its* optimistic store. What is left is the handful of
   * things that belong to the frame itself — the rail, the theme, the session —
   * and anything nobody claims is reported rather than swallowed: a palette row
   * that closes and does nothing is the defect this exists to prevent, and a
   * silent `default:` branch is how it comes back.
   */
  const handleCommand = useCallback(
    (effect: CommandEffect, command: Command) => {
      if (effect.kind !== "run") return;
      if (contribution?.run?.(effect, command) === true) return;

      switch (effect.action) {
        case "app.sidebar":
          toggleSidebar();
          return;
        case "app.theme":
          setThemePreference(nextThemePreference(readStoredPreference()));
          return;
        case "app.signout":
          void fetch("/api/auth/signout", { method: "POST" })
            .catch(() => undefined)
            // `push`, not `replace`: the session is gone either way, and a
            // refresh is what clears the router cache of the pages it held.
            .finally(() => {
              router.push("/signin");
              router.refresh();
            });
          return;
        default:
          toast({
            title: `${command.label} is not available on this screen.`,
            description: "Open a team's issues and try again.",
          });
      }
    },
    [contribution, router, toggleSidebar],
  );

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
    <>
      {/*
        The keyboard surface: palette, search, the `?` sheet, the `G` chords and
        the chord hint. Mounted here because these are portalled overlays that
        must exist on every workspace screen, and because neither slice could
        write this line for itself — the palette lives in one and the shell in
        another.

        `context` and `onCommand` are the point: navigation stays inside
        `CommandSurface` (a router push needs nothing from the app), the screen
        in view answers for its own mutations through the registry, and what is
        left is the frame's — the rail, the theme and the session. Nothing here
        reaches into the optimistic store, which belongs to the issue view.
      */}
      <CommandSurface
        workspaceKey={data.workspace.urlKey}
        teamKey={teamKey}
        context={paletteContext}
        onCommand={handleCommand}
      />
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
    </>
  );
}

/**
 * The team the URL is inside, or null.
 *
 * `G` `B` and `G` `A` are *a team's* backlog and active list — there is no
 * workspace-wide one — so the chord needs a team, and the only live answer is
 * the one in the address bar. Read from the path rather than threaded down from
 * the page, because the pages that have a team are server components in three
 * different route groups and none of them knows the shell exists.
 */
function teamKeyFromPath(pathname: string): string | null {
  const match = /^\/[^/]+\/team\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}
