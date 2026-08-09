"use client";

/**
 * The two-pane application frame: a resizable sidebar beside a scrolling
 * content column with its own top bar.
 *
 * Sidebar visibility is UI state, not document state, so it lives here in
 * React rather than in the persisted workspace store.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { keyboard, layout } from "@/config/app.config";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { CommandPalette } from "@/components/search/CommandPalette";
import { useTheme } from "@/lib/theme/theme-provider";

interface ShellContextValue {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** Lets the top bar and sidebar coordinate without prop-drilling. */
export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside WorkspaceShell");
  return context;
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(layout.sidebar.defaultWidth);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { toggle: toggleTheme } = useTheme();

  const toggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), []);

  // Global shortcuts. Bound once here rather than in each consumer so the
  // key map stays in `app.config` and cannot drift between components.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();

      if (key === keyboard.commandPalette) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === keyboard.toggleSidebar) {
        event.preventDefault();
        toggleSidebar();
      } else if (key === keyboard.toggleTheme && event.shiftKey) {
        event.preventDefault();
        toggleTheme();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar, toggleTheme]);

  const value = useMemo(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      sidebarWidth,
      setSidebarWidth,
      paletteOpen,
      setPaletteOpen,
    }),
    [paletteOpen, sidebarCollapsed, sidebarWidth, toggleSidebar],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--bac-pri)" }}>
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">{children}</main>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </ShellContext.Provider>
  );
}
