"use client";

/**
 * Rendering a chat row's `lineId` as text.
 *
 * The 42-line roster is **content**, and content lives in
 * `src/content/dialog.ts`, which is S4's file (§12). The wire deliberately
 * carries an *index* and never a string (§5.9), so a chat row has to be
 * resolved against that roster at render time — and until S4's file lands
 * there is nothing to resolve against.
 *
 * Rather than keep a second copy of 42 verbatim strings — which would be a
 * second source of truth for text that must stay word-for-word — this module
 * loads the roster if it is there and falls back to the index otherwise. The
 * lobby and game chat columns then light up the moment S4's file arrives,
 * with no change here.
 */

const DIALOG_SPECIFIER = "@/content/dialog";

type Roster = readonly string[] | readonly { readonly id: number; readonly text: string }[];

let loaded: Promise<Roster | null> | null = null;

function rosterOf(mod: Record<string, unknown>): Roster | null {
  // S4 has not published the export name yet, so the plausible shapes are
  // probed rather than guessed at: an array of strings or of `{ id, text }`.
  for (const key of ["DIALOG_LINES", "DIALOG", "LINES", "dialogLines", "default"]) {
    const value = mod[key];
    if (Array.isArray(value) && value.length > 0) return value as Roster;
  }
  return null;
}

function loadRoster(): Promise<Roster | null> {
  loaded ??= (async () => {
    try {
      const mod = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ DIALOG_SPECIFIER
      )) as Record<string, unknown>;
      return rosterOf(mod);
    } catch {
      return null;
    }
  })();
  return loaded;
}

let cached: Roster | null = null;

/** Kick off the (optional) load. Safe to call from an effect on every mount. */
export async function primeDialogRoster(): Promise<void> {
  cached = await loadRoster();
}

/** The roster's text for `lineId`, or a readable stand-in for it. */
export function lineText(lineId: number): string {
  const roster = cached;
  if (!roster) return `Line ${lineId}`;
  const entry = roster[lineId - 1];
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && "text" in entry) return entry.text;
  return `Line ${lineId}`;
}
