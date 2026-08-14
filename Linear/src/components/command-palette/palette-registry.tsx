"use client";

/**
 * How a view tells the palette what it is looking at.
 *
 * The palette is mounted once, by the app shell, above everything. The things
 * it needs in order to be more than a navigation menu — which issues are
 * selected, which workflow states the team in view has, who the assignable
 * people are — are all owned by whichever screen is currently rendered, and the
 * shell has no way to reach into it. Passing them down is impossible in the
 * other direction too: the screen is `children`, rendered by a server layout.
 *
 * So the flow is inverted. The shell hosts a registry; the screen publishes a
 * contribution into it for as long as it is mounted; the shell reads whatever
 * is published and hands it to the palette as context. Two consequences worth
 * stating, because they are the reason this is a registry rather than a global:
 *
 * - **The palette still performs nothing.** A contribution carries a `run`, and
 *   running it is the *contributor's* code executing in the contributor's own
 *   closure — the optimistic store stays inside the issue slice, and the palette
 *   goes on knowing only about {@link CommandEffect}.
 * - **Nothing survives the screen.** The publisher's cleanup withdraws its
 *   contribution, and withdrawal is identity-checked, so a screen unmounting
 *   after its replacement has already published cannot blank the new one.
 *
 * A single slot rather than a stack: exactly one screen is in view at a time,
 * and a stack would raise a question — which contributor's `run` gets the
 * command — that has no interesting answer.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type {
  Command,
  CommandEffect,
  PaletteIssue,
  PaletteLabel,
  PalettePerson,
  PaletteStatus,
  PaletteSurface,
} from "./commands";

export interface PaletteContribution {
  /** Which surface the palette was opened from. Drives group priority. */
  readonly surface: PaletteSurface;
  /** The issues the next issue action would apply to. */
  readonly selection?: readonly PaletteIssue[];
  readonly statuses?: readonly PaletteStatus[];
  readonly people?: readonly PalettePerson[];
  readonly labels?: readonly PaletteLabel[];
  /**
   * Perform a non-navigation command.
   *
   * Returns whether it took it. `false` hands the effect back to the shell,
   * which owns the application-wide ones (theme, sidebar, sign out) and reports
   * anything nobody claimed rather than swallowing it.
   */
  readonly run?: (effect: CommandEffect, command: Command) => boolean;
}

interface Registry {
  readonly contribution: PaletteContribution | null;
  readonly publish: (contribution: PaletteContribution) => () => void;
}

const PaletteRegistryContext = createContext<Registry | null>(null);

export function PaletteRegistryProvider({ children }: { children: ReactNode }) {
  const [contribution, setContribution] = useState<PaletteContribution | null>(
    null,
  );

  const publish = useCallback((next: PaletteContribution) => {
    setContribution(next);
    return () => {
      // Identity-checked: React mounts the next screen's effects before it runs
      // the previous screen's cleanup in some transitions, and an unconditional
      // reset would then blank a contribution that is already current.
      setContribution((current) => (current === next ? null : current));
    };
  }, []);

  return (
    <PaletteRegistryContext.Provider value={{ contribution, publish }}>
      {children}
    </PaletteRegistryContext.Provider>
  );
}

/**
 * Publish this screen's palette contribution while it is mounted.
 *
 * The argument must be memoised by the caller — it is the effect's dependency,
 * and an object rebuilt every render would re-publish on every render, which
 * re-renders the shell, which re-renders the caller.
 *
 * A no-op outside a provider, deliberately: the sign-in screen and the
 * marketing page mount neither the shell nor the palette, and a screen that
 * happens to be rendered in isolation by a test should not have to know that.
 */
export function usePaletteContribution(
  contribution: PaletteContribution,
): void {
  const registry = useContext(PaletteRegistryContext);
  const publish = registry?.publish;

  useEffect(() => {
    if (publish === undefined) return;
    return publish(contribution);
  }, [publish, contribution]);
}

/** What the current screen has published, for the shell that mounts the palette. */
export function usePublishedContribution(): PaletteContribution | null {
  return useContext(PaletteRegistryContext)?.contribution ?? null;
}
