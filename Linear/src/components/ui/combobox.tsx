"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "@/lib/cn";
import { CheckIcon, SearchIcon } from "@/components/ui/icons";
import { Popover, type PopoverPlacement } from "@/components/ui/popover";

/**
 * The property picker.
 *
 * Linear's signature control, and the single most-used interaction in the
 * product: status, assignee, priority, label, project and milestone are all
 * this component. `research/04-interaction.md` §3 opens with the instruction
 * "**Build it once**", which is what this is.
 *
 * ## The rules that make it feel right
 *
 * - **It applies immediately.** There is no Save, no OK, no Cancel, and no
 *   dirty state. Selecting fires the mutation; the chip behind the popover
 *   updates *before* the popover finishes closing. This is why `Escape` is safe
 *   — it closes the picker, it does not revert what was already applied.
 * - **It opens on the current value**, not on row 0. Opening a status picker
 *   with "Backlog" highlighted when the issue is In Progress means every
 *   keyboard user's first two keystrokes are corrections.
 * - **Printable characters always go to the input.** Never type-ahead
 *   selection. The input keeps focus for the picker's whole life, which is why
 *   navigation is `aria-activedescendant` and *not* roving `tabindex`: with
 *   roving focus, typing after arrowing would move focus out of the field and
 *   the query would go nowhere.
 * - **`Shift` keeps it open.** On a multi-select picker (labels) every
 *   selection keeps it open; on a single-select picker, holding `Shift`
 *   does — the accelerator that lets you rip through a set of issues without
 *   reopening the menu each time. One derived prop:
 *   `closeOnSelect = !(multiple || shiftKey)`.
 * - **The active row resets to 0 when the query changes**, and snaps back to
 *   the applied value when the query is cleared.
 *
 * ## Filtering
 *
 * Subsequence matching, not `includes`. "ip" should find "In Progress" and
 * "bkl" should find "Backlog"; substring matching finds neither, and a picker
 * that fails on the abbreviation the user has in their head is a picker they
 * stop typing into. Matched characters are returned as indices so the row can
 * embolden them — feedback that the match was understood, which is what makes
 * a fuzzy matcher trustworthy rather than mysterious.
 *
 * Ranking prefers a prefix match, then an earlier first match, then a more
 * contiguous one. `keywords` lets a caller make an option findable by a word
 * that is not in its label ("done" finding "Completed").
 */

export interface ComboboxOption {
  /** Stable identity. Also seeds the option's DOM id for `aria-activedescendant`. */
  value: string;
  label: string;
  /** A status glyph, a priority glyph, an avatar. Rendered at the row's left. */
  icon?: ReactNode;
  /** Right-aligned: an ordinal accelerator, a count, a shortcut hint. */
  hint?: ReactNode;
  /** Extra search terms that are not in the label. */
  keywords?: string;
  /** Secondary line — an email under a name, a team key under a project. */
  description?: string;
  disabled?: boolean;
}

interface Match {
  option: ComboboxOption;
  indices: readonly number[];
  score: number;
}

/**
 * Subsequence match with a positional score.
 *
 * Returns `null` for no match. Lower scores rank higher. The score is built
 * from the first match position (an early match is a better match) and the
 * number of gaps (a contiguous run is a better match), which is enough to put
 * "In Progress" above "In Review" for the query "in p" without a full
 * Smith-Waterman.
 */
export function matchOption(
  option: ComboboxOption,
  query: string,
): Match | null {
  if (query === "") return { option, indices: [], score: 0 };

  const needle = query.toLowerCase();
  const haystack = option.label.toLowerCase();
  const indices: number[] = [];
  let cursor = 0;
  let gaps = 0;
  let previous = -1;

  for (const char of needle) {
    if (char === " ") continue;
    const found = haystack.indexOf(char, cursor);
    if (found === -1) {
      // Fall back to the keyword field. Keywords never highlight — they are not
      // on screen — so a keyword hit scores worse than any label hit.
      const keywords = option.keywords?.toLowerCase() ?? "";
      return keywords.includes(needle)
        ? { option, indices: [], score: 1_000 }
        : null;
    }
    if (previous !== -1 && found !== previous + 1) gaps += 1;
    indices.push(found);
    previous = found;
    cursor = found + 1;
  }

  const first = indices[0] ?? 0;
  return { option, indices, score: first * 10 + gaps };
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** Single-select: the applied value, or null. */
  value?: string | null;
  /** Multi-select: the applied values. Supplying it does not imply `multiple`. */
  values?: readonly string[];
  /**
   * Inherent multi-select, as labels are.
   *
   * Rows become checkboxes, `Enter` toggles, and the picker never closes on
   * selection — you are expected to add several.
   */
  multiple?: boolean;
  /**
   * Called on every selection.
   *
   * `close` is the derived `!(multiple || shiftKey)` — apply the change and,
   * if it is true, close the picker. The component never closes itself; the
   * owner of the open state does.
   */
  onSelect: (value: string, meta: { close: boolean }) => void;
  /** `Escape`, or `Enter` on a picker that should close. */
  onRequestClose?: () => void;
  placeholder?: string;
  emptyMessage?: string;
  /**
   * Offer `Create "<query>"` when nothing matches.
   *
   * The label picker's no-match state. Omit it and a no-match state is a dead
   * end.
   */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  /** Cap the panel height. 320px is Linear's, ~9 rows. */
  maxHeight?: number;
  autoFocus?: boolean;
  className?: string;
  /** Accessible name for the listbox. */
  label?: string;
}

export function Combobox({
  options,
  value = null,
  values,
  multiple = false,
  onSelect,
  onRequestClose,
  placeholder = "Search…",
  emptyMessage = "No results",
  onCreate,
  createLabel = (query) => `Create "${query}"`,
  maxHeight = 320,
  autoFocus = true,
  className,
  label = "Options",
}: ComboboxProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => new Set(values ?? (value === null ? [] : [value])),
    [values, value],
  );

  const matches = useMemo(() => {
    const scored: Match[] = [];
    for (const option of options) {
      const match = matchOption(option, query);
      if (match) scored.push(match);
    }
    // Stable within equal scores: an empty query must leave the caller's order
    // untouched, because that order is meaningful (workflow position, recents).
    return query === ""
      ? scored
      : scored
          .map((match, index) => ({ match, index }))
          .sort((a, b) => a.match.score - b.match.score || a.index - b.index)
          .map((entry) => entry.match);
  }, [options, query]);

  /**
   * Where the highlight starts: on the applied value, falling back to the
   * first enabled row.
   *
   * Computed against `options` rather than `matches` because it is only ever
   * consulted when the query is empty — and with an empty query the two are the
   * same list in the same order. That distinction is what lets the reset happen
   * in the event handler instead of in an effect, which matters: an effect
   * would fire a second render after every keystroke and fight the arrow keys
   * it is supposed to be resetting.
   */
  const appliedIndex = useCallback((): number => {
    const found = options.findIndex(
      (option) => selected.has(option.value) && !option.disabled,
    );
    if (found !== -1) return found;
    const firstEnabled = options.findIndex((option) => !option.disabled);
    return firstEnabled === -1 ? 0 : firstEnabled;
  }, [options, selected]);

  const [active, setActive] = useState(appliedIndex);

  /**
   * Two different reset rules, and they are not the same rule:
   * a non-empty query highlights the best match; an emptied query snaps back to
   * the value that is actually applied.
   */
  const updateQuery = (next: string): void => {
    setQuery(next);
    setActive(next === "" ? appliedIndex() : 0);
  };

  // Keep the highlight in view. jsdom has no layout, hence the guard in the
  // test setup rather than here.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  const showCreate =
    onCreate !== undefined && query.trim() !== "" && matches.length === 0;

  const move = (delta: number): void => {
    if (matches.length === 0) return;
    let next = active;
    for (let step = 0; step < matches.length; step += 1) {
      // Wrap at both ends — Linear's pickers are short, and wrapping is faster
      // than reversing direction when you overshoot by one.
      next = (next + delta + matches.length) % matches.length;
      if (!matches[next]?.option.disabled) break;
    }
    setActive(next);
  };

  const commit = (option: ComboboxOption, keepOpen: boolean): void => {
    if (option.disabled) return;
    const close = !(multiple || keepOpen);
    onSelect(option.value, { close });
    if (close) onRequestClose?.();
    // Clearing the query after a multi-select toggle lets you type the next
    // label immediately. §3.5 says pick one behaviour and be consistent; this
    // is the one that keeps a second selection to zero extra keystrokes.
    else if (multiple) updateQuery("");
  };

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
        setActive(Math.max(0, matches.length - 1));
        return;
      case "Enter": {
        event.preventDefault();
        if (showCreate) {
          onCreate?.(query.trim());
          updateQuery("");
          return;
        }
        const match = matches[active];
        if (!match) return;
        // Cmd/Ctrl+Enter applies and closes even in multi-select — the "I am
        // done adding labels" exit that does not need a reach for Escape.
        if (event.metaKey || event.ctrlKey) {
          onSelect(match.option.value, { close: true });
          onRequestClose?.();
          return;
        }
        commit(match.option, event.shiftKey);
        return;
      }
      case "Tab": {
        // Apply, then move on. Not a focus change inside the picker — there is
        // nowhere else in it to go.
        const match = matches[active];
        if (match && !match.option.disabled) {
          event.preventDefault();
          onSelect(match.option.value, { close: true });
          onRequestClose?.();
        }
        return;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onRequestClose?.();
        return;
      default:
    }
  };

  const activeOption = matches[active]?.option;

  return (
    <div className={cn("flex w-full flex-col", className)} data-combobox="">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-default px-2.5">
        <SearchIcon size={14} className="text-tertiary" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-activedescendant={
            showCreate
              ? `${baseId}-opt-create`
              : activeOption
                ? `${baseId}-opt-${activeOption.value}`
                : undefined
          }
          value={query}
          placeholder={placeholder}
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full min-w-0 bg-transparent text-small text-primary outline-none",
            "placeholder:text-quaternary",
          )}
        />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className="overflow-y-auto p-1"
        style={{ maxHeight }}
        // A click on a row must not move focus out of the input:
        // `aria-activedescendant` navigation depends on the input keeping it,
        // and a blur mid-selection silently breaks every subsequent arrow key.
        // Scoped to the list so clicking *into* the field still focuses it.
        onMouseDown={(event: ReactMouseEvent) => event.preventDefault()}
      >
        {matches.map((match, index) => {
          const { option } = match;
          const isActive = index === active;
          const isSelected = selected.has(option.value);
          return (
            <div
              key={option.value}
              id={`${baseId}-opt-${option.value}`}
              role="option"
              aria-selected={isSelected}
              aria-disabled={option.disabled || undefined}
              data-active={isActive}
              onMouseEnter={() => setActive(index)}
              onClick={(event) => commit(option, event.shiftKey)}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2",
                "text-small text-primary",
                // Highlight follows the *active* row, not `:hover` — otherwise
                // the mouse pointer resting over the list contradicts the
                // keyboard's idea of where it is.
                isActive && "bg-[var(--bg-hover)]",
                option.disabled && "cursor-default opacity-50",
              )}
            >
              {option.icon ? (
                <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">
                  {option.icon}
                </span>
              ) : null}

              <span className="min-w-0 flex-1 truncate">
                <Highlighted text={option.label} indices={match.indices} />
                {option.description ? (
                  <span className="ml-2 text-tertiary">{option.description}</span>
                ) : null}
              </span>

              {option.hint ? (
                <span className="shrink-0 text-micro text-tertiary">
                  {option.hint}
                </span>
              ) : null}

              {isSelected ? (
                <CheckIcon size={14} className="shrink-0 text-tertiary" />
              ) : null}
            </div>
          );
        })}

        {showCreate ? (
          <div
            role="option"
            aria-selected={false}
            id={`${baseId}-opt-create`}
            data-active="true"
            onClick={() => {
              onCreate?.(query.trim());
              updateQuery("");
            }}
            className={cn(
              "flex h-7 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2",
              "bg-[var(--bg-hover)] text-small text-primary",
            )}
          >
            {createLabel(query.trim())}
          </div>
        ) : null}

        {matches.length === 0 && !showCreate ? (
          <div className="px-2 py-3 text-center text-small text-tertiary">
            {emptyMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Embolden the characters the query matched.
 *
 * Emits *runs*, not one element per character. A character-per-span rendering
 * works and is two lines shorter, but it turns a 40-character label into 40
 * DOM nodes in a list that can hold hundreds of rows, and it splits the label's
 * text nodes so `getByText` — and some screen readers' word boundaries — stop
 * seeing it as one string.
 */
function Highlighted({
  text,
  indices,
}: {
  text: string;
  indices: readonly number[];
}) {
  if (indices.length === 0) return <>{text}</>;

  const marked = new Set(indices);
  const runs: { text: string; matched: boolean }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const matched = marked.has(i);
    const last = runs[runs.length - 1];
    if (last && last.matched === matched) last.text += text[i];
    else runs.push({ text: text[i] ?? "", matched });
  }

  return (
    <>
      {runs.map((run, index) =>
        run.matched ? (
          <span key={index} className="[font-weight:var(--weight-title)]">
            {run.text}
          </span>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}

export interface ComboboxPopoverProps extends ComboboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  placement?: PopoverPlacement;
  /** Fixed panel width. Linear's pickers are 240–280px. */
  width?: number;
}

/**
 * {@link Combobox} anchored under a trigger.
 *
 * The two are separate so the same picker can be rendered as a popover, as a
 * command-palette page, or as a context-menu submenu without the keyboard model
 * being reimplemented for each.
 */
export function ComboboxPopover({
  open,
  onOpenChange,
  anchor,
  placement = "bottom-start",
  width = 240,
  ...combobox
}: ComboboxPopoverProps) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      placement={placement}
      style={{ width }}
      className="p-0"
    >
      <Combobox {...combobox} onRequestClose={() => onOpenChange(false)} />
    </Popover>
  );
}
