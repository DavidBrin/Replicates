"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { ProjectsIcon, SearchIcon } from "@/components/ui/icons";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { useIsClient } from "@/components/ui/popover";
import type { StateType } from "@/domain/entities";
import { cn } from "@/lib/cn";
import { useEscapeLayer, useKeyboardScope, useShortcut } from "@/lib/keyboard";

import {
  MIN_QUERY_LENGTH,
  parseQuery,
  type SearchGroup,
  type SearchResult,
} from "./query";

/**
 * Global search. `/`.
 *
 * ## Why this is not the command palette
 *
 * They look alike and they are not the same surface. The palette searches a
 * fixed list of commands held in memory and must never touch the network
 * (`research/04-interaction.md` §2.1). This searches every issue and project in
 * the workspace — a set the client does not hold, and must not be given, because
 * a guest's browser caching the issue table so that search feels instant is the
 * same permission leak as rendering it. So: server-side, scoped by `can()` in
 * `/api/search`, and the only thing this component knows about permissions is
 * that it never sees what it may not see.
 *
 * ## The three query shapes
 *
 * `ENG-12` and `eng12` resolve an identifier; a bare `12` resolves within the
 * team in view; anything else is free text over titles and project names. The
 * parse is shared with the route (`./query.ts`) so the client's affordances and
 * the server's lookup cannot disagree.
 *
 * ## Race handling
 *
 * Every request carries a sequence number and a late response for a superseded
 * query is dropped. `AbortController` alone is not enough: aborting is
 * best-effort and a response already in flight still resolves, which is how a
 * fast typist ends up looking at results for the third character of a
 * seven-character query.
 */

/** Keystroke-to-request delay. Long enough to skip a word, short enough to feel live. */
const DEBOUNCE_MS = 140;

/** Module-scoped so "no results" is one stable identity, not a new array. */
const EMPTY_GROUPS: readonly SearchGroup[] = [];

export interface SearchDialogProps {
  /** Workspace URL key. Scopes every request; search is never cross-workspace. */
  workspaceKey: string;
  /** The team in view, so a bare issue number resolves. */
  teamKey?: string | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SearchDialog({
  workspaceKey,
  teamKey = null,
  open: controlledOpen,
  onOpenChange,
}: SearchDialogProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolled(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  useShortcut("app.search", () => setOpen(true), { scope: "global" });

  return open ? (
    <SearchPanel
      workspaceKey={workspaceKey}
      teamKey={teamKey}
      onClose={() => setOpen(false)}
    />
  ) : null;
}

/* ================================================================= panel = */

function SearchPanel({
  workspaceKey,
  teamKey,
  onClose,
}: {
  workspaceKey: string;
  teamKey: string | null;
  onClose: () => void;
}) {
  const mounted = useIsClient();
  const router = useRouter();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");
  /**
   * The last response, *tagged with the query it answered*.
   *
   * Storing the tag rather than clearing the groups when the query changes is
   * what keeps this out of an effect: "results for a query I am no longer
   * asking" is a derivation, not a state transition, and expressing it as one
   * removes the cascading render that clearing would cost on every keystroke.
   */
  const [results, setResults] = useState<{
    query: string;
    groups: readonly SearchGroup[];
  }>({ query: "", groups: [] });
  const [active, setActive] = useState(0);

  // Monotonic request id. Compared on arrival, so a slow response for an old
  // query cannot overwrite a fast one for the current query.
  const sequence = useRef(0);

  useEscapeLayer(
    "search-dialog",
    () => {
      onClose();
      return true;
    },
    true,
  );
  useKeyboardScope("modal", []);

  const parsed = parseQuery(query);
  const fresh = results.query === parsed.text;
  const pending = parsed.valid && !fresh;
  // Memoised so the scroll effect below does not see a new array identity on
  // every render and re-run for a list that has not changed.
  const groups = useMemo(
    () => (parsed.valid && fresh ? results.groups : EMPTY_GROUPS),
    [parsed.valid, fresh, results.groups],
  );

  useEffect(() => {
    if (!parsed.valid) return;

    const id = (sequence.current += 1);
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const params = new URLSearchParams({ workspace: workspaceKey, q: parsed.text });
      if (teamKey !== null && teamKey !== "") params.set("team", teamKey);

      void fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      })
        .then((response) => (response.ok ? response.json() : { groups: [] }))
        .then((payload: { groups?: readonly SearchGroup[] }) => {
          if (id !== sequence.current) return;
          setResults({ query: parsed.text, groups: payload.groups ?? [] });
          setActive(0);
        })
        .catch(() => {
          if (id !== sequence.current) return;
          // A failed search shows nothing rather than an error banner: the user
          // is mid-keystroke, and the next one will retry anyway.
          setResults({ query: parsed.text, groups: [] });
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [parsed.valid, parsed.text, workspaceKey, teamKey]);

  const flat = groups.flatMap((group) => group.results);

  const open = useCallback(
    (result: SearchResult) => {
      router.push(result.href);
      onClose();
    },
    [router, onClose],
  );

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, groups]);

  if (!mounted) return null;

  const activeResult = flat[active];

  return createPortal(
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[16vh]"
      style={{ zIndex: "var(--z-palette)" }}
    >
      <div
        className="absolute inset-0 [background:color-mix(in_oklab,var(--bg-sidebar)_72%,transparent)]"
        onMouseDown={onClose}
        aria-hidden="true"
      />

      <div
        data-testid="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className={cn(
          "relative flex w-full max-w-[640px] flex-col overflow-hidden",
          "rounded-[var(--radius-xl)] border border-default bg-[var(--bg-overlay)]",
          "shadow-[var(--shadow-high)]",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-subtle px-3">
          <SearchIcon size={16} className="shrink-0 text-tertiary" />
          <input
            data-testid="search-input"
            // Opened by a keystroke, to be typed into immediately.
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={`${baseId}-list`}
            aria-autocomplete="list"
            aria-label="Search issues and projects"
            aria-activedescendant={
              activeResult === undefined
                ? undefined
                : `${baseId}-opt-${activeResult.id}`
            }
            autoComplete="off"
            spellCheck={false}
            placeholder="Search issues and projects…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) =>
                  flat.length === 0 ? 0 : (current + 1) % flat.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) =>
                  flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const result = flat[active];
                if (result !== undefined) open(result);
              }
            }}
            className={cn(
              "w-full min-w-0 bg-transparent text-regular text-primary outline-none",
              "placeholder:text-quaternary",
            )}
          />
          {/* A live region rather than a spinner. §8.2: this app does not show
              spinners for sub-second work, and the count is what a screen-reader
              user needs anyway. */}
          <span
            aria-live="polite"
            className="shrink-0 text-micro text-quaternary tabular-nums"
          >
            {pending ? "…" : flat.length > 0 ? `${flat.length}` : ""}
          </span>
        </div>

        <div
          ref={listRef}
          id={`${baseId}-list`}
          role="listbox"
          aria-label="Search results"
          className="max-h-[440px] overflow-y-auto overscroll-contain p-1"
          onMouseDown={(event) => event.preventDefault()}
        >
          {groups.map((group) => (
            <div key={group.type} role="group" aria-label={group.label}>
              <div
                className={cn(
                  "sticky top-0 z-10 bg-[var(--bg-overlay)] px-2 pt-2 pb-1",
                  "text-micro uppercase tracking-[0.06em] text-quaternary",
                  "[font-weight:var(--weight-medium)]",
                )}
              >
                {group.label}
              </div>

              {group.results.map((result) => {
                const isActive = result.id === activeResult?.id;
                return (
                  <div
                    key={result.id}
                    id={`${baseId}-opt-${result.id}`}
                    data-testid={`search-result-${result.identifier ?? result.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onClick={() => open(result)}
                    onMouseEnter={() =>
                      setActive(flat.findIndex((entry) => entry.id === result.id))
                    }
                    className={cn(
                      "flex h-8 cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2",
                      "text-small text-primary",
                      isActive && "bg-[var(--bg-hover)]",
                    )}
                  >
                    {result.type === "issue" ? (
                      <StatusIcon
                        type={(result.stateType ?? "backlog") as StateType}
                        {...(result.stateColor === null || result.stateColor === ""
                          ? {}
                          : { color: result.stateColor })}
                        size={14}
                        className="shrink-0"
                      />
                    ) : (
                      <ProjectsIcon size={14} className="shrink-0 text-tertiary" />
                    )}

                    {result.identifier !== null ? (
                      <span className="shrink-0 text-mini text-quaternary tabular-nums">
                        {result.identifier}
                      </span>
                    ) : null}

                    <span className="min-w-0 flex-1 truncate">{result.title}</span>

                    {result.subtitle !== null ? (
                      <span className="hidden shrink-0 text-mini text-quaternary sm:block">
                        {result.subtitle}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}

          {flat.length === 0 ? (
            <p
              data-testid="search-empty"
              className="px-3 py-6 text-center text-small text-tertiary"
            >
              {query.trim().length < MIN_QUERY_LENGTH
                ? "Search by issue identifier, title or project name."
                : pending
                  ? "Searching…"
                  : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
