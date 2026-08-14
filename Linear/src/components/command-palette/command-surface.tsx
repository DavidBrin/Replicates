"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { SearchDialog } from "@/components/search/search-dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { useChordHint, useKeyboardScope, type BindingInput } from "@/lib/keyboard";

import { CommandPalette } from "./command-palette";
import { ShortcutsOverlay } from "./shortcuts-overlay";
import { EMPTY_CONTEXT, type Command, type CommandEffect, type PaletteContext } from "./commands";

/**
 * One component the app shell mounts to get the whole keyboard surface.
 *
 * The palette, global search, the `?` sheet, the `G …` chords and the chord
 * affordance are five things that all key off the same dispatcher and all want
 * to be portalled at the top of the tree. Mounting them individually works and
 * means five things for the shell to remember; this is the composition, and the
 * shell's job reduces to supplying context and handling effects.
 *
 * ## Mounting it — the one line this slice cannot write for itself
 *
 * `components/app-shell/app-shell.tsx` belongs to another slice, so the mount
 * has to happen there:
 *
 * ```tsx
 * import { CommandSurface } from "@/components/command-palette";
 *
 * // …once, at the top level of AppShell's returned tree:
 * <CommandSurface
 *   workspaceKey={data.workspace.urlKey}
 *   teamKey={teamInView}
 *   context={paletteContext}
 *   onCommand={handleCommand}
 * />
 * ```
 *
 * **`context` and `onCommand` are not optional in an application.** Mounted
 * with neither, the palette is a menu whose rows all close it and do nothing:
 * its navigation hrefs are built from an empty workspace key, and "New issue",
 * "Toggle theme" and "Sign out" are inert. The shell supplies them from the
 * registry in `palette-registry.tsx`, which is how the screen in view publishes
 * its selection and its handler upward.
 *
 * ## The `G` chords live here
 *
 * `registry.ts` advertises `G` `I`, `G` `M`, `G` `B`, `G` `P`, `G` `A` and
 * `G` `S` in the `?` sheet and the palette. Advertised is not bound: nothing
 * registers a `nav.*` binding anywhere else in the app, and an advertised chord
 * that arms and then does nothing is worse than an absent one — the user
 * concludes the keyboard model is unreliable and stops using all of it. They are
 * registered here because this is where the router and the workspace key are
 * both in scope, and because every destination is a route rather than a
 * behaviour any slice owns.
 *
 * ## What this handles and what it hands back
 *
 * `navigate` is handled here, because a router push is the only behaviour a
 * palette can perform without knowing anything about the application. `app.help`
 * is too, because the `?` sheet is this component's own child and nobody else
 * can open it. Everything else — mutations, theme, sign-out, the pickers — goes
 * to `onCommand`, which belongs to whoever owns the state it touches. A palette
 * that reached into the optimistic store would couple the app's most central
 * surface to every slice at once.
 */

export interface CommandSurfaceProps {
  context?: PaletteContext;
  /**
   * Perform a non-navigation command.
   *
   * Omitted on surfaces that have no mutations to offer — the sign-in screen,
   * the marketing page — where the palette is navigation only.
   */
  onCommand?: (effect: CommandEffect, command: Command) => void;
  /** Workspace URL key for search and the `G` chords. Both off when absent. */
  workspaceKey?: string;
  /**
   * The team in view, so a bare issue number resolves in search and so
   * `G` `B` / `G` `A` have a backlog and an active list to go to.
   */
  teamKey?: string | null;
}

export function CommandSurface({
  context = EMPTY_CONTEXT,
  onCommand,
  workspaceKey,
  teamKey = null,
}: CommandSurfaceProps) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  const handle = useCallback(
    (effect: CommandEffect, command: Command) => {
      if (effect.kind === "navigate") {
        router.push(effect.href);
        return;
      }
      if (effect.kind === "run" && effect.action === "app.help") {
        setHelpOpen(true);
        return;
      }
      onCommand?.(effect, command);
    },
    [router, onCommand],
  );

  /**
   * The navigation chords.
   *
   * `global` scope, so they work from a list, a board or the issue detail pane;
   * blocked by a modal, like everything else at that level, because `G` `I`
   * while the create-issue dialog is open would navigate away from a half-typed
   * issue.
   *
   * Registered as one layer whose membership does not change, so the hook's
   * signature check does not re-register on every render. `when` is what turns
   * a destination off, not a shorter array — a chord that silently resolves to
   * nothing is exactly the defect this fixes, so `G` `B` with no team in view
   * declines the key and lets it fall through rather than consuming it.
   */
  const navigationBindings = useMemo<BindingInput[]>(() => {
    const base = workspaceKey === undefined ? null : `/${workspaceKey}`;
    const go = (id: string, path: () => string | null): BindingInput => ({
      id,
      when: () => path() !== null,
      run: () => {
        const href = path();
        if (href !== null) router.push(href);
      },
    });
    const team = (view: string) => (): string | null =>
      base === null || teamKey === null ? null : `${base}/team/${teamKey}/${view}`;

    return [
      go("nav.inbox", () => (base === null ? null : `${base}/inbox`)),
      go("nav.myIssues", () => (base === null ? null : `${base}/my-issues`)),
      go("nav.projects", () => (base === null ? null : `${base}/projects`)),
      go("nav.settings", () =>
        base === null ? null : `${base}/settings/members`,
      ),
      go("nav.backlog", team("backlog")),
      go("nav.active", team("active")),
    ];
  }, [router, workspaceKey, teamKey]);

  useKeyboardScope("global", navigationBindings);

  return (
    <>
      <CommandPalette context={context} onCommand={handle} />
      {workspaceKey === undefined ? null : (
        <SearchDialog workspaceKey={workspaceKey} teamKey={teamKey} />
      )}
      <ShortcutsOverlay open={helpOpen} onOpenChange={setHelpOpen} />
      <ChordHint />
    </>
  );
}

/**
 * The `G …` affordance.
 *
 * Linear shows a subtle hint while a chord prefix is armed
 * (`research/04-interaction.md` §1.11), and the reason is not decoration: an
 * armed prefix is invisible modal state. Without the hint, a user who presses
 * `G` and then gets distracted finds their next keystroke doing something they
 * did not ask for, with no way to know why.
 */
export function ChordHint() {
  const chord = useChordHint();
  if (chord.length === 0) return null;

  return (
    <div
      data-testid="chord-hint"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2",
        "flex items-center gap-1.5 rounded-[var(--radius-lg)]",
        "border border-default bg-[var(--bg-elevated)] px-2 py-1",
        "text-micro text-tertiary shadow-[var(--shadow-medium)]",
      )}
      style={{ zIndex: "var(--z-toast)" }}
    >
      {chord.map((token) => (
        <Kbd key={token}>{token.toUpperCase()}</Kbd>
      ))}
      <span aria-hidden="true">…</span>
      <span className="sr-only">Waiting for the second key of a shortcut</span>
    </div>
  );
}
