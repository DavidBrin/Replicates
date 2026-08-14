"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon, SearchIcon } from "@/components/ui/icons";
import { Shortcut } from "@/components/ui/kbd";
import { useIsClient } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  useEscapeLayer,
  useKeyboardScope,
  useShortcut,
  type ShortcutSpec,
} from "@/lib/keyboard";

/**
 * The `?` overlay: every shortcut this app ships, searchable.
 *
 * ## It is generated, not written
 *
 * Every row here comes from `lib/keyboard/registry.ts` — the same list the
 * dispatcher binds and the palette draws its hints from. That is the whole
 * reason the registry is data: a hand-maintained shortcuts sheet documents the
 * app as it was on the day someone wrote it, and confidently wrong shortcut
 * documentation is worse than none, because the user stops trusting the ones
 * that *are* right.
 *
 * Linear's own modal is searchable and this one is too. Search covers the
 * label, the group, the key expression itself (typing `shift` finds every
 * shifted binding) and the keywords, because the thing a user is looking for is
 * as often "what was the key for status" as "what does S do".
 *
 * ## The notes are the point
 *
 * Several rows carry a `note`, and they are the rows a reimplementation gets
 * wrong: `Cmd+B` is the layout toggle and not the sidebar, due date is
 * `Shift+D` and not `D`, `M` is only ever a prefix, and bare digits belong to
 * Triage. Showing the correction next to the binding is cheaper than answering
 * the question twice.
 */

export interface ShortcutsOverlayProps {
  /** Controlled open state. Omit and the overlay owns it, opening on `?`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ShortcutsOverlay({
  open: controlledOpen,
  onOpenChange,
}: ShortcutsOverlayProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;

  const setOpen = (next: boolean): void => {
    setUncontrolled(next);
    onOpenChange?.(next);
  };

  useShortcut("app.help", () => setOpen(!open), { scope: "global" });

  return open ? <OverlayPanel onClose={() => setOpen(false)} /> : null;
}

function OverlayPanel({ onClose }: { onClose: () => void }) {
  const mounted = useIsClient();
  const [query, setQuery] = useState("");

  useEscapeLayer(
    "shortcuts-overlay",
    () => {
      onClose();
      return true;
    },
    true,
  );
  // Blocking, like any dialog: `s` while the sheet is open must not change a
  // status behind it.
  useKeyboardScope("modal", []);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (entry: ShortcutSpec): boolean =>
      needle === "" ||
      `${entry.label} ${entry.group} ${entry.keys} ${entry.keywords ?? ""} ${entry.note ?? ""}`
        .toLowerCase()
        .includes(needle);

    return SHORTCUT_GROUPS.map((group) => ({
      group,
      entries: SHORTCUTS.filter(
        (entry) => entry.group === group && matches(entry),
      ),
    })).filter((section) => section.entries.length > 0);
  }, [query]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[10vh]"
      style={{ zIndex: "var(--z-modal)" }}
    >
      <div
        className="absolute inset-0 [background:color-mix(in_oklab,var(--bg-sidebar)_72%,transparent)]"
        onMouseDown={onClose}
        aria-hidden="true"
      />

      <div
        data-testid="shortcuts-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        className={cn(
          "relative flex max-h-[76vh] w-full max-w-[720px] flex-col overflow-hidden",
          "rounded-[var(--radius-xl)] border border-default bg-[var(--bg-overlay)]",
          "shadow-[var(--shadow-high)]",
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-subtle px-4">
          <h2
            id="shortcuts-help-title"
            className="text-small text-primary [font-weight:var(--weight-title)]"
          >
            Keyboard shortcuts
          </h2>

          <div className="ml-auto flex items-center gap-2 text-tertiary">
            <SearchIcon size={14} />
            <input
              data-testid="shortcuts-help-search"
              // Searchable, and opened by a keystroke; landing anywhere but the
              // field would waste the next one.
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search shortcuts…"
              aria-label="Search shortcuts"
              className={cn(
                "w-40 bg-transparent text-small text-primary outline-none",
                "placeholder:text-quaternary",
              )}
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[var(--radius-md)] p-1 text-tertiary hover:bg-[var(--bg-hover)] hover:text-primary"
          >
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="overflow-y-auto p-4">
          <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {groups.map((section) => (
              <section key={section.group}>
                <h3
                  className={cn(
                    "mb-1 text-micro uppercase tracking-[0.06em] text-quaternary",
                    "[font-weight:var(--weight-medium)]",
                  )}
                >
                  {section.group}
                </h3>
                <dl className="flex flex-col">
                  {section.entries.map((entry) => (
                    <div
                      key={entry.id}
                      data-testid={`shortcut-${entry.id}`}
                      className="flex items-baseline gap-3 py-1"
                    >
                      <dt className="min-w-0 flex-1">
                        <span className="block truncate text-small text-secondary">
                          {entry.label}
                        </span>
                        {entry.note !== undefined ? (
                          <span className="block text-micro text-quaternary">
                            {entry.note}
                          </span>
                        ) : null}
                      </dt>
                      <dd className="shrink-0">
                        <Shortcut keys={entry.keys} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          {groups.length === 0 ? (
            <p className="py-8 text-center text-small text-tertiary">
              No shortcut matches “{query}”.
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
