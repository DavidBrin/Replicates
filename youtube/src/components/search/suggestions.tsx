"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";

import { SearchIcon } from "@/components/icons";

/**
 * The masthead's type-ahead.
 *
 * ## Measured chrome (R8 §9, `extracted/search-and-breakpoints.json`)
 *
 * | Part | Value |
 * |---|---|
 * | Popup | 570×647 at x=610, y=52 — the focused field is 568 at the same x, and the popup hangs **4px below it** |
 * | Popup chrome | `border-radius: 12px`, `padding: 8px 0`, `box-shadow: rgba(0,0,0,.2) 0 2px 4px 0`, `z-index: 2010`, `overflow: auto` |
 * | Popup border | `1px solid rgb(204,204,204)` on left/right/bottom, **none on top** |
 * | Row | 552×**44**, `margin: 0 8px`, `border-radius: 8px`, `padding: 0 28px 0 16px`, 16px/400 |
 * | Row count | 14 for a six-character query — server-chosen, not a setting |
 *
 * Two things about the row are read off `screenshots/07-search-suggestions-1920.png`
 * rather than the dump, because both live in a shadow root the extraction pass
 * reported as `missing`: each row opens with a magnifier glyph, and **the typed
 * prefix is regular weight while the completion is bold**. The second is the
 * detail that makes a type-ahead look right, and it is the opposite of the
 * instinct to bold the match.
 *
 * The popup is positioned `absolute` against its offset parent, so the caller
 * must place it inside a `position: relative` box that spans the field.
 *
 * ## Why this attaches to an input it does not own
 *
 * The masthead's field is `src/components/layout/masthead.tsx`, which this
 * slice does not own and must not change. Rendering a second field here would
 * mean two copies of a measured control that must stay identical. So the
 * component takes the existing input by ref, listens on it, and writes the
 * combobox ARIA onto it — the wiring in `Masthead` is then one prop, added by
 * whoever owns that file.
 *
 * ## The three things a per-keystroke fetch gets wrong
 *
 * 1. **Firing on every keystroke.** Debounced by {@link DEFAULT_DEBOUNCE_MS}.
 * 2. **Leaving requests in flight.** Each new request aborts the previous one,
 *    so a fast typist has one open request rather than eight.
 * 3. **Trusting the order responses arrive in.** This is the one that survives
 *    the other two fixes: `abort()` is best-effort — a response already on the
 *    wire can still resolve, and under HTTP/2 multiplexing two overlapping
 *    requests routinely finish out of order. The guard is therefore a
 *    monotonic sequence number, and a response whose sequence is not greater
 *    than the last applied one is dropped. Without it, `ru` → `rust` can end
 *    up showing the suggestions for `ru` under the word `rust`, which looks
 *    like a broken index rather than a race.
 */

/* --------------------------------------------------------------- tuning -- */

/**
 * **Assumed.** Nothing in the capture records a debounce — it is not
 * observable from a DOM dump. 150ms is under the ~200ms at which a suggestion
 * list starts to feel detached from the keyboard, and above the ~50ms at which
 * it stops saving any requests at all.
 */
export const DEFAULT_DEBOUNCE_MS = 150;

/**
 * How many rows to ask for.
 *
 * **Ours.** The capture dumped 12 rows and R8 §9 records 14 for a
 * six-character query, so the real count is server-chosen and varies per
 * query. Ten is what fits without the popup becoming a scrolling column, and it
 * is well under the adapter's `MAX_SUGGESTIONS` ceiling of 20.
 */
export const DEFAULT_SUGGESTION_LIMIT = 10;

/* ---------------------------------------------------------------- types -- */

/**
 * How suggestions are fetched.
 *
 * Injectable for two reasons: a test must be able to resolve two requests in
 * the wrong order deliberately, and a caller that already has the index in
 * process (a Storybook, an e2e fixture) should not have to stand up a route.
 */
export type SuggestionFetcher = (
  prefix: string,
  limit: number,
  signal: AbortSignal,
) => Promise<readonly string[]>;

/** What gets attached to the caller's input. */
interface InputHandlers {
  onKeyDown(event: KeyboardEvent): void;
  onFocus(): void;
  onBlur(): void;
}

export interface SearchSuggestionsProps {
  /** The field's current value. This component never owns it. */
  query: string;
  /** The field to listen on and to describe. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** A suggestion was chosen: put it in the field and run the search. */
  onSelect: (suggestion: string) => void;
  /**
   * The field's text should now read `text`.
   *
   * Called as the active row moves, which is what the product does — arrowing
   * down rewrites the field. Wiring it is optional; without it the field stays
   * put and only `aria-activedescendant` moves, which is still a usable
   * combobox.
   */
  onPreview?: (text: string) => void;
  fetchSuggestions?: SuggestionFetcher;
  debounceMs?: number;
  limit?: number;
  className?: string;
}

/* ------------------------------------------------------------ the widget -- */

export function SearchSuggestions({
  query,
  inputRef,
  onSelect,
  onPreview,
  fetchSuggestions,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  limit = DEFAULT_SUGGESTION_LIMIT,
  className,
}: SearchSuggestionsProps) {
  const listboxId = useId();

  const [items, setItems] = useState<readonly string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  /**
   * What the user last typed, as opposed to what arrowing put in the field.
   *
   * Both live in `query`, and telling them apart is what stops two bugs:
   * arrowing down would otherwise fire a fetch for the suggestion it just
   * highlighted (and replace the list underneath the cursor), and Escape would
   * have nothing to restore the field to.
   *
   * It is held twice on purpose. The ref is what the keyboard handler reads —
   * it must see the current value from inside a native listener registered
   * once. The state is what the *rows* read, to decide where the bold
   * completion starts; reading a ref during render is exactly the "the screen
   * does not update" bug the rule against it exists to catch, and here it
   * would show the previous query's split.
   */
  const typedRef = useRef(query);
  const [typedText, setTypedText] = useState(query);
  const previewedRef = useRef<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Issued sequence, and the highest one whose response has been applied. */
  const issuedRef = useRef(0);
  const appliedRef = useRef(0);

  const fetcherRef = useRef<SuggestionFetcher>(defaultFetcher);
  const onSelectRef = useRef(onSelect);
  const onPreviewRef = useRef(onPreview);
  useEffect(() => {
    fetcherRef.current = fetchSuggestions ?? defaultFetcher;
    onSelectRef.current = onSelect;
    onPreviewRef.current = onPreview;
  });

  const open = focused && !dismissed && items.length > 0;

  /* ------------------------------------------------------------- fetching -- */

  useEffect(() => {
    // Arrowing rewrote the field, or a selection did. That is not a new query,
    // and treating it as one would refetch on every press of Down and reopen
    // the popup the moment a suggestion was chosen. Absorbed exactly once, so
    // that a later edit back to the same text is still a real query.
    if (previewedRef.current !== null && query === previewedRef.current) {
      previewedRef.current = null;
      return;
    }

    previewedRef.current = null;
    typedRef.current = query;
    setTypedText(query);
    setDismissed(false);
    setActiveIndex(-1);

    const prefix = query.trim();
    if (prefix === "") {
      controllerRef.current?.abort();
      controllerRef.current = null;
      // Bump the applied watermark so a request issued for the previous
      // keystroke cannot land after the field was cleared.
      appliedRef.current = issuedRef.current;
      // `react-hooks/set-state-in-effect` objects to this line, and the
      // alternative is worse. Deriving the visible list — "empty whenever the
      // field is" — would also make it empty for the debounce window after
      // *any* keystroke, so the popup would blink closed on every character.
      // Clearing here empties it for a cleared field only, and leaves the last
      // good list up while the next one is in flight, which is the behaviour
      // the failure path already relies on.
      setItems([]);
      return;
    }

    const timer = setTimeout(() => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const sequence = ++issuedRef.current;
      void fetcherRef
        .current(prefix, limit, controller.signal)
        .then((result) => {
          // The whole point of the sequence number: an aborted request can
          // still resolve, and two live requests can finish in either order.
          if (sequence <= appliedRef.current) return;
          appliedRef.current = sequence;
          setItems(result);
          setActiveIndex(-1);
        })
        .catch(() => {
          // A failed or aborted suggestion request is not an error state. The
          // field still works, the form still submits, and the last list stays
          // on screen rather than blinking out on a dropped packet.
        });
    }, debounceMs);

    timerRef.current = timer;
    return () => clearTimeout(timer);
  }, [query, debounceMs, limit]);

  // Unmount: stop the clock and the wire. Separate from the effect above
  // because that one re-runs per keystroke and must *not* abort on every one —
  // its cleanup only clears the pending timer.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      controllerRef.current?.abort();
    },
    [],
  );

  /* ------------------------------------------------------------- keyboard -- */

  const preview = useCallback((text: string) => {
    previewedRef.current = text;
    onPreviewRef.current?.(text);
  }, []);

  const choose = useCallback((suggestion: string) => {
    // The caller will put this in the field. Marking it as previewed absorbs
    // that change, so the popup does not reopen on top of the search it just
    // ran.
    previewedRef.current = suggestion;
    typedRef.current = suggestion;
    setTypedText(suggestion);
    setDismissed(true);
    setActiveIndex(-1);
    onSelectRef.current(suggestion);
  }, []);

  /**
   * Move through the rows, with the typed text as a real position.
   *
   * `-1` is "back in the field", and Down past the last row returns to it
   * rather than sticking or wrapping to the top. That is the combobox pattern
   * and it is also the only way to undo an arrow press without Escape.
   */
  const move = useCallback(
    (delta: number, count: number) => {
      setActiveIndex((current) => {
        const slots = count + 1;
        const next = (((current + 1 + delta) % slots) + slots) % slots - 1;
        preview(next === -1 ? typedRef.current : (items[next] ?? typedRef.current));
        return next;
      });
    },
    [items, preview],
  );

  // The handlers close over state, so they are refreshed every commit and the
  // listener below is registered once. Re-registering per render would drop
  // and re-add three listeners on every keystroke.
  const handlersRef = useRef<InputHandlers>({
    onKeyDown: () => {},
    onFocus: () => {},
    onBlur: () => {},
  });

  useEffect(() => {
    handlersRef.current = {
      onKeyDown: (event: KeyboardEvent) => {
        if (!open) {
          // Down re-opens a list the user dismissed with Escape, without
          // needing another keystroke to refetch it.
          if (event.key === "ArrowDown" && dismissed && items.length > 0) {
            event.preventDefault();
            setDismissed(false);
          }
          return;
        }

        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            move(1, items.length);
            break;
          case "ArrowUp":
            // Without this the caret jumps to the start of the field, which is
            // the browser's default for Up in a text input.
            event.preventDefault();
            move(-1, items.length);
            break;
          case "Enter": {
            const suggestion = activeIndex >= 0 ? items[activeIndex] : undefined;
            if (suggestion === undefined) break;
            // Only when a row is active. With nothing highlighted, Enter is the
            // form's submit and searching for what was typed is correct.
            event.preventDefault();
            choose(suggestion);
            break;
          }
          case "Escape":
            event.preventDefault();
            setDismissed(true);
            setActiveIndex(-1);
            // Put back what was typed. Escape in a combobox abandons the
            // highlight; it does not clear the field.
            //
            // The condition is `activeIndex`, not `previewedRef`: the preview
            // has already been absorbed by the fetch effect by the time this
            // runs, so the ref is back to `null` while the field is still
            // showing a suggestion. A highlighted row is the thing that means
            // "the field is not showing what was typed".
            if (activeIndex >= 0) preview(typedRef.current);
            break;
          case "Tab":
            // Tab leaves the field. The list goes with it, and the highlight is
            // abandoned rather than committed — leaving the previewed text
            // behind would be committing it, which is how people end up
            // searching for something they only skimmed past.
            setDismissed(true);
            setActiveIndex(-1);
            if (activeIndex >= 0) preview(typedRef.current);
            break;
          default:
            break;
        }
      },
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    };
  });

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const onKeyDown = (event: KeyboardEvent): void =>
      handlersRef.current.onKeyDown(event);
    const onFocus = (): void => handlersRef.current.onFocus();
    const onBlur = (): void => handlersRef.current.onBlur();

    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("focus", onFocus);
    input.addEventListener("blur", onBlur);
    // The field may already hold focus by the time this mounts — the masthead
    // renders before this does.
    if (document.activeElement === input) setFocused(true);

    return () => {
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
    };
  }, [inputRef]);

  /* ----------------------------------------------------------------- aria -- */

  /**
   * The combobox attributes go onto an input this component does not render,
   * so they are written imperatively. They are removed on unmount, because a
   * field left claiming `aria-expanded` for a listbox that no longer exists is
   * worse than one with no combobox semantics at all.
   */
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-haspopup", "listbox");
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      input.setAttribute("aria-controls", listboxId);
    } else {
      input.removeAttribute("aria-controls");
    }
    if (open && activeIndex >= 0) {
      input.setAttribute("aria-activedescendant", optionId(listboxId, activeIndex));
    } else {
      input.removeAttribute("aria-activedescendant");
    }

    return () => {
      input.removeAttribute("aria-expanded");
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    };
  }, [inputRef, listboxId, open, activeIndex]);

  /* ---------------------------------------------------------------- render -- */

  if (!open) return null;

  const typed = typedText.trim();

  return (
    <div
      data-search-suggestions=""
      className={clsx(
        // 4px below the field, measured; full width of the field rather than
        // the measured 570-vs-568, whose 2px is a border-box artefact of a
        // fixed-width capture and would be wrong at any other field width.
        "absolute top-full right-0 left-0 mt-1",
        "z-[var(--yt-z-suggestions)] max-h-[70vh] overflow-auto",
        // `border-radius: 12px`, `padding: 8px 0`, and a border on three sides
        // — the top edge is deliberately open, which is what makes the popup
        // read as hanging off the field rather than floating beside it.
        "rounded-cozy border-x border-b border-[var(--yt-search-border)] py-2",
        // Measured `rgb(255,255,255)`; `menu-background` is the token that is
        // white in the light theme and has a dark value to pair with it.
        "bg-menu",
        "shadow-[0_2px_4px_0_rgba(0,0,0,0.2)]",
        className,
      )}
    >
      <ul id={listboxId} role="listbox" aria-label="Search suggestions" className="m-0 list-none p-0">
        {items.map((suggestion, index) => (
          <li
            key={suggestion}
            id={optionId(listboxId, index)}
            role="option"
            aria-selected={index === activeIndex}
            // Measured: 44px tall, 8px side margins, 8px radius, `0 28px 0 16px`.
            className={clsx(
              "mx-2 flex h-11 cursor-pointer items-center rounded-compact",
              "pr-7 pl-4 text-title text-primary",
              index === activeIndex && "bg-additive",
            )}
            // `mousedown` would blur the field before the click landed, which
            // closes the popup and cancels the selection. Suppressing the
            // default keeps focus where it is; the `click` below still fires.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(suggestion)}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <SearchIcon size={20} className="mr-3 shrink-0 text-primary" />
            <SuggestionText suggestion={suggestion} typed={typed} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The typed prefix regular, the completion bold.
 *
 * Read off `screenshots/07-search-suggestions-1920.png`: for the typed text
 * `how it`, the row `how it's made chocolate` renders `how it` at regular
 * weight and `'s made chocolate` bold. Weight 500 rather than 700 — the row is
 * 16px/400 and the emphasised run is visibly heavier without being black.
 *
 * The comparison is case-insensitive and the *suggestion's* characters are the
 * ones rendered, so typing `HOW` against `how it's made` still bolds only the
 * completion and still shows the suggestion's own casing.
 */
function SuggestionText({
  suggestion,
  typed,
}: {
  suggestion: string;
  typed: string;
}) {
  const matches =
    typed !== "" &&
    suggestion.slice(0, typed.length).toLowerCase() === typed.toLowerCase();

  if (!matches) {
    return <span className="truncate">{suggestion}</span>;
  }

  return (
    <span className="truncate">
      {suggestion.slice(0, typed.length)}
      <span
        data-suggestion-completion=""
        className="font-[var(--yt-weight-medium)]"
      >
        {suggestion.slice(typed.length)}
      </span>
    </span>
  );
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

/**
 * The default fetcher: `GET /api/search/suggest`.
 *
 * A non-200 answers with an empty list rather than throwing. Type-ahead is an
 * accelerator; a 500 behind it must cost the user nothing more than the
 * accelerator.
 */
const defaultFetcher: SuggestionFetcher = async (prefix, limit, signal) => {
  const response = await fetch(
    `/api/search/suggest?q=${encodeURIComponent(prefix)}&limit=${limit}`,
    { signal },
  );
  if (!response.ok) return [];

  const body: unknown = await response.json();
  const suggestions =
    typeof body === "object" && body !== null && "suggestions" in body
      ? (body as { suggestions: unknown }).suggestions
      : null;

  return Array.isArray(suggestions)
    ? suggestions.filter((entry): entry is string => typeof entry === "string")
    : [];
};
