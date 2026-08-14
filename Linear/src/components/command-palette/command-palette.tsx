"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import { CheckIcon, ChevronRightIcon, SearchIcon } from "@/components/ui/icons";
import { StatusIcon } from "@/components/ui/icons/status-icon";
import { Shortcut } from "@/components/ui/kbd";
import { useIsClient } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { useEscapeLayer, useKeyboardScope, useShortcut } from "@/lib/keyboard";
import type { StateType } from "@/domain/entities";

import {
  buildCommands,
  buildSubmenu,
  EMPTY_CONTEXT,
  rankCommands,
  SUBMENU_TITLES,
  type Command,
  type CommandEffect,
  type CommandSection,
  type PaletteContext,
  type Submenu,
} from "./commands";

/**
 * The command palette. `Cmd/Ctrl + K`.
 *
 * `research/04-interaction.md` §2.1 calls it "the single most important
 * interaction in the app… the discovery surface, the accessibility surface, and
 * the power-user surface at once". The parts that make it that, rather than a
 * modal with a filter in it:
 *
 * ## It is a stack, not a list
 *
 * "Change status…" does not execute. It **pushes a page**: the input clears,
 * the placeholder becomes `Change status to…`, a breadcrumb pill appears left
 * of the field, and the rows become the team's workflow states. `Backspace` on
 * an empty input pops — the cmdk idiom — and so does `Escape`, one level at a
 * time, closing only at the root (§2.3). Without the stack, a two-step command
 * either needs its own dialog or silently applies the wrong value.
 *
 * ## Focus never leaves the input
 *
 * Navigation is `aria-activedescendant`, not roving `tabindex` (§9.3). That is
 * what lets you arrow to a row and keep typing to narrow it; with roving focus
 * the next keystroke would go to a `<li>` and vanish. The ARIA combobox pattern
 * is the accessible expression of the same thing, so the two requirements agree
 * rather than trade off.
 *
 * ## Matching is synchronous and local
 *
 * §2.1: "Linear's palette searches the local in-memory object pool — no server
 * queries, instant results… If your palette does a network round trip per
 * keystroke, you have not built a Linear palette." Nothing here is debounced,
 * awaited or suspended. Entity search — issues and projects, which the client
 * does not and must not hold — is a separate surface on `/`.
 *
 * ## The effect seam
 *
 * Choosing a command calls `onCommand` with a {@link CommandEffect} and closes.
 * The palette performs nothing itself: navigation, mutations and theme changes
 * belong to slices this one does not own, and a palette that imported them
 * would be coupled to all of them.
 */

export interface CommandPaletteProps {
  context?: PaletteContext;
  /**
   * Run a chosen command.
   *
   * `navigate` effects are handled here — a router push is the one behaviour
   * the palette can perform without knowing anything about the app — unless the
   * owner returns `true` to say it took the effect itself.
   */
  onCommand: (effect: CommandEffect, command: Command) => void;
  /** Controlled open state. Omit and the palette owns it, opening on Cmd+K. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommandPalette({
  context = EMPTY_CONTEXT,
  onCommand,
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  // `Cmd+K` is registered at the global scope and is on the modal passthrough
  // list, so it opens the palette from inside a dialog and from inside a text
  // field — which is where a user most often wants it.
  useShortcut("app.palette", () => setOpen(!open), { scope: "global" });

  return open ? (
    <PalettePanel
      context={context}
      onCommand={onCommand}
      onClose={() => setOpen(false)}
    />
  ) : null;
}

/* ================================================================= panel = */

interface PalettePanelProps {
  context: PaletteContext;
  onCommand: (effect: CommandEffect, command: Command) => void;
  onClose: () => void;
}

interface Page {
  readonly submenu: Submenu | null;
  readonly commands: readonly Command[];
}

function PalettePanel({ context, onCommand, onClose }: PalettePanelProps) {
  const mounted = useIsClient();
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const root = useMemo<Page>(
    () => ({ submenu: null, commands: buildCommands(context) }),
    [context],
  );
  // Only the *pushed* pages are state. The root is derived from the context on
  // every render, so a selection made while the palette is open immediately
  // changes what it offers — with the root in state instead, the count in the
  // group heading would go on describing the selection the palette opened with.
  const [stack, setStack] = useState<Page[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const page = stack[stack.length - 1] ?? root;
  const sections = useMemo(
    () => rankCommands(page.commands, query, context),
    [page, query, context],
  );
  const flat = useMemo(
    () => sections.flatMap((section) => section.commands),
    [sections],
  );

  const pop = useCallback((): boolean => {
    if (stack.length === 0) return false;
    setStack((current) => current.slice(0, -1));
    setQuery("");
    setActive(0);
    return true;
  }, [stack.length]);

  // The Escape ladder's palette rung. Popping a sub-page is a *level*, so
  // `Escape` inside "Change status to…" returns to the root rather than
  // discarding everything the user typed to get there (§1.11, §2.3).
  useEscapeLayer(
    "command-palette",
    () => {
      if (pop()) return true;
      onClose();
      return true;
    },
    true,
  );

  // The palette is a blocking scope: nothing beneath it may claim a key while
  // it is open, except the small passthrough list in the registry.
  useKeyboardScope("modal", []);

  const choose = useCallback(
    (command: Command) => {
      if (command.effect.kind === "submenu") {
        // §2.3: a sub-menu pushes rather than executes, and the input clears so
        // the query that found "Change status…" does not also filter the
        // statuses.
        const submenu = command.effect.submenu;
        setStack((current) => [
          ...current,
          { submenu, commands: buildSubmenu(submenu, context) },
        ]);
        setQuery("");
        setActive(0);
        inputRef.current?.focus();
        return;
      }
      // §2.5: "Selecting a row that isn't a sub-menu executes and closes
      // immediately. No confirm step."
      onCommand(command.effect, command);
      onClose();
    },
    [context, onCommand, onClose],
  );

  const move = useCallback(
    (delta: number) => {
      setActive((current) => {
        if (flat.length === 0) return 0;
        return (current + delta + flat.length) % flat.length;
      });
    },
    [flat.length],
  );

  // Keep the active row in view. jsdom has no layout engine; the test setup
  // stubs `scrollIntoView` rather than this guarding for it.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, sections]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Home":
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        event.preventDefault();
        setActive(Math.max(0, flat.length - 1));
        return;
      case "Enter": {
        event.preventDefault();
        const command = flat[active];
        if (command !== undefined) choose(command);
        return;
      }
      case "Backspace": {
        // The cmdk idiom: only on an *empty* input, so backspacing over a typo
        // never throws away the page you are on.
        if (query !== "") return;
        if (stack.length > 0) {
          event.preventDefault();
          pop();
        }
        return;
      }
      default:
    }
  };

  const activeCommand = flat[active];
  const submenu = page.submenu;

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-start justify-center px-4 pt-[16vh]"
      style={{ zIndex: "var(--z-palette)" }}
    >
      {/* Dismiss on outside click. A separate element rather than a handler on
          the positioner, so a click that starts inside the panel and ends
          outside it does not close — the classic text-selection annoyance. */}
      <div
        // Mixed from the sidebar token rather than a literal black: the scrim
        // has to sit behind an overlay in both themes, and a fixed rgba() is
        // either invisible in light mode or a hole in dark.
        className="absolute inset-0 [background:color-mix(in_oklab,var(--bg-sidebar)_72%,transparent)]"
        onMouseDown={onClose}
        aria-hidden="true"
      />

      <div
        data-testid="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={cn(
          "relative flex w-full max-w-[640px] flex-col overflow-hidden",
          "rounded-[var(--radius-xl)] border border-default bg-[var(--bg-overlay)]",
          "shadow-[var(--shadow-high)]",
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-subtle px-3">
          <SearchIcon size={16} className="shrink-0 text-tertiary" />

          {submenu !== null ? (
            // The breadcrumb pill. §2.5 puts it inline to the left of the
            // input, which is what makes a pushed page feel like a place rather
            // than a replaced list.
            <span
              data-testid="command-palette-breadcrumb"
              className={cn(
                "shrink-0 rounded-[var(--radius-sm)] bg-[var(--bg-translucent)]",
                "px-1.5 py-0.5 text-mini text-secondary",
              )}
            >
              {SUBMENU_TITLES[submenu].replace(/…$/, "")}
            </span>
          ) : null}

          <input
            ref={inputRef}
            data-testid="command-palette-input"
            // The palette exists to be typed into the instant it opens; moving
            // focus in an effect instead costs a frame the user notices.
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={`${baseId}-list`}
            aria-autocomplete="list"
            aria-label={submenu === null ? "Type a command" : SUBMENU_TITLES[submenu]}
            aria-activedescendant={
              activeCommand === undefined
                ? undefined
                : `${baseId}-opt-${activeCommand.id}`
            }
            autoComplete="off"
            spellCheck={false}
            placeholder={
              submenu === null ? "Type a command or search…" : SUBMENU_TITLES[submenu]
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              "w-full min-w-0 bg-transparent text-regular text-primary outline-none",
              "placeholder:text-quaternary",
            )}
          />
        </div>

        <div
          ref={listRef}
          id={`${baseId}-list`}
          role="listbox"
          aria-label="Commands"
          className="max-h-[440px] overflow-y-auto overscroll-contain p-1"
          // A click must not blur the input: `aria-activedescendant` navigation
          // depends on it keeping focus, and a blur mid-selection breaks every
          // subsequent arrow key.
          onMouseDown={(event) => event.preventDefault()}
        >
          {sections.map((section) => (
            <Section
              key={section.group}
              section={section}
              baseId={baseId}
              activeId={activeCommand?.id}
              onChoose={choose}
              onHover={(command) =>
                setActive(flat.findIndex((entry) => entry.id === command.id))
              }
            />
          ))}

          {flat.length === 0 ? (
            <p
              data-testid="command-palette-empty"
              className="px-3 py-6 text-center text-small text-tertiary"
            >
              No matching commands
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* =============================================================== section = */

interface SectionProps {
  section: CommandSection;
  baseId: string;
  activeId: string | undefined;
  onChoose: (command: Command) => void;
  onHover: (command: Command) => void;
}

function Section({ section, baseId, activeId, onChoose, onHover }: SectionProps) {
  const headingId = `${baseId}-grp-${section.group}`;
  return (
    <div role="group" aria-labelledby={headingId}>
      {/* Sticky, per §2.5 — scrolling a long Navigation group should never
          leave you unsure which group you are inside. */}
      <div
        id={headingId}
        className={cn(
          "sticky top-0 z-10 bg-[var(--bg-overlay)] px-2 pt-2 pb-1",
          "text-micro uppercase tracking-[0.06em] text-quaternary",
          "[font-weight:var(--weight-medium)]",
        )}
      >
        {section.label}
      </div>

      {section.commands.map((command) => {
        const isActive = command.id === activeId;
        return (
          <div
            key={command.id}
            id={`${baseId}-opt-${command.id}`}
            data-testid={`command-${command.id}`}
            role="option"
            aria-selected={isActive}
            data-active={isActive}
            onClick={() => onChoose(command)}
            onMouseEnter={() => onHover(command)}
            className={cn(
              "flex h-8 cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2",
              "text-small text-primary",
              // The highlight follows the *active* row, not `:hover` — a mouse
              // resting over the list must not contradict where the keyboard
              // thinks it is.
              isActive && "bg-[var(--bg-hover)]",
            )}
          >
            <CommandGlyph command={command} />

            <span className="min-w-0 flex-1 truncate">{command.label}</span>

            {command.effect.kind === "submenu" ? (
              <ChevronRightIcon size={14} className="shrink-0 text-quaternary" />
            ) : null}

            {command.shortcut !== undefined ? (
              // Right-aligned caps, one per key, chords as separate caps with a
              // gap — `G` `M`, never `GM` (§2.5). `Shortcut` reads the same
              // expression string the dispatcher binds, so a hint cannot be
              // wrong about the key it names.
              <Shortcut keys={command.shortcut} className="shrink-0" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The row's left glyph.
 *
 * §2.5: "Icons on the left of every row — *Icons further help find what you're
 * looking for*." A status row gets the real workflow glyph rather than a dot,
 * because that glyph is the same one the issue list draws and recognising it is
 * faster than reading the label.
 */
function CommandGlyph({ command }: { command: Command }) {
  if (command.stateType !== undefined) {
    return (
      <StatusIcon
        type={command.stateType as StateType}
        color={command.color}
        size={14}
        className="shrink-0"
      />
    );
  }
  if (command.color !== undefined) {
    return (
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: command.color }}
      />
    );
  }
  if (command.effect.kind === "navigate") {
    return <ChevronRightIcon size={14} className="shrink-0 text-quaternary" />;
  }
  return <CheckIcon size={14} className="shrink-0 opacity-0" aria-hidden="true" />;
}
