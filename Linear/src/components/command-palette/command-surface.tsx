"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { SearchDialog } from "@/components/search/search-dialog";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { useChordHint } from "@/lib/keyboard";

import { CommandPalette } from "./command-palette";
import { ShortcutsOverlay } from "./shortcuts-overlay";
import { EMPTY_CONTEXT, type Command, type CommandEffect, type PaletteContext } from "./commands";

/**
 * One component the app shell mounts to get the whole keyboard surface.
 *
 * The palette, global search, the `?` sheet and the chord affordance are four
 * overlays that all key off the same dispatcher and all want to be portalled at
 * the top of the tree. Mounting them individually works and means four things
 * for the shell to remember; this is the composition, and the shell's job
 * reduces to supplying context and handling effects.
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
 *   context={paletteContext}
 *   onCommand={handleCommand}
 * />
 * ```
 *
 * Until that line exists, `Cmd+K` does nothing inside the application and the
 * `command-palette` id the e2e suite addresses is never rendered — the
 * component is complete and simply not on screen. Everything else in this slice
 * works without it.
 *
 * The shell currently drives its own `[` binding through
 * `components/issues/keyboard.ts`, a second dispatcher built in parallel by the
 * issue slice. Two `keydown` listeners on `document` coexist safely only while
 * their binding sets stay disjoint — which they are today — so consolidating on
 * `lib/keyboard` is worth doing before either grows.
 *
 * ## What this handles and what it hands back
 *
 * `navigate` is handled here, because a router push is the only behaviour a
 * palette can perform without knowing anything about the application. Everything
 * else — mutations, theme, sign-out, the pickers — goes to `onCommand`, which
 * belongs to whoever owns the optimistic store. A palette that reached into
 * that store would couple the app's most central surface to every slice at once.
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
  /** Workspace URL key for search. Search is disabled when it is absent. */
  workspaceKey?: string;
  /** The team in view, so a bare issue number resolves in search. */
  teamKey?: string | null;
}

export function CommandSurface({
  context = EMPTY_CONTEXT,
  onCommand,
  workspaceKey,
  teamKey = null,
}: CommandSurfaceProps) {
  const router = useRouter();

  const handle = useCallback(
    (effect: CommandEffect, command: Command) => {
      if (effect.kind === "navigate") {
        router.push(effect.href);
        return;
      }
      onCommand?.(effect, command);
    },
    [router, onCommand],
  );

  return (
    <>
      <CommandPalette context={context} onCommand={handle} />
      {workspaceKey === undefined ? null : (
        <SearchDialog workspaceKey={workspaceKey} teamKey={teamKey} />
      )}
      <ShortcutsOverlay />
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
