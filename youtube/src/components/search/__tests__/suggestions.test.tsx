import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";

import { SearchSuggestions, type SuggestionFetcher } from "../suggestions";

/**
 * The type-ahead.
 *
 * Three of these tests are about races rather than about rendering, and they
 * are the reason this file is long. A per-keystroke fetch that is merely
 * debounced still ships the bug: `abort()` is best-effort, so a response
 * already on the wire resolves anyway, and two live requests finish in
 * whichever order the network decides. The list then shows the answer to a
 * prefix the field no longer contains — which looks like a broken index and is
 * a lost race.
 *
 * The fetcher is injected, because that race cannot be provoked through
 * `fetch`: the point is to resolve an *older* request *later*, deliberately.
 */

const DEBOUNCE = 20;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A field and a popup, wired the way the masthead would wire them.
 *
 * The component does not own the input — the masthead's is measured chrome
 * this slice must not duplicate — so the harness supplies one and hands over
 * its ref. That is the integration under test as much as the keyboard is.
 */
function Harness({
  fetchSuggestions,
  onSelect,
}: {
  fetchSuggestions: SuggestionFetcher;
  onSelect?: (suggestion: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      <input
        aria-label="Search"
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <SearchSuggestions
        query={query}
        inputRef={inputRef}
        onSelect={(suggestion) => {
          onSelect?.(suggestion);
          setQuery(suggestion);
        }}
        onPreview={setQuery}
        fetchSuggestions={fetchSuggestions}
        debounceMs={DEBOUNCE}
      />
    </div>
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText("Search") as HTMLInputElement;
}

function focusField(): void {
  act(() => {
    field().focus();
  });
}

function type(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

/** Run out the debounce and let any resolved promise land. */
async function settle(ms = DEBOUNCE): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

function options(): HTMLElement[] {
  return screen.queryAllByRole("option");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------- debounce -- */

describe("debounce", () => {
  it("issues one request for a burst of keystrokes", async () => {
    const fetcher = vi.fn<SuggestionFetcher>(async () => ["rust"]);
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();

    type("r");
    type("ru");
    type("rus");
    expect(fetcher).not.toHaveBeenCalled();

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("rus");
  });

  it("asks again once the typing stops and starts", async () => {
    const fetcher = vi.fn<SuggestionFetcher>(async () => ["rust"]);
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();

    type("ru");
    await settle();
    type("rust");
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears the list without asking anything when the field empties", async () => {
    const fetcher = vi.fn<SuggestionFetcher>(async () => ["rust"]);
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();

    type("rust");
    await settle();
    expect(options()).toHaveLength(1);

    type("");
    await settle();
    expect(options()).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------- races -- */

describe("in-flight requests", () => {
  it("aborts the previous one", async () => {
    const signals: AbortSignal[] = [];
    const fetcher: SuggestionFetcher = async (_prefix, _limit, signal) => {
      signals.push(signal);
      return deferred<readonly string[]>().promise;
    };

    render(<Harness fetchSuggestions={fetcher} />);
    focusField();

    type("ru");
    await settle();
    type("rust");
    await settle();

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  /**
   * The test this component exists for.
   *
   * Both requests are live; the *older* one resolves *last*. Nothing about
   * aborting saves this — an aborted request's promise can still settle, and
   * under HTTP/2 two overlapping requests routinely finish out of order. Only
   * the sequence number does.
   */
  it("ignores a stale response that arrives after a fresh one", async () => {
    const pending: Deferred<readonly string[]>[] = [];
    const fetcher: SuggestionFetcher = () => {
      const next = deferred<readonly string[]>();
      pending.push(next);
      return next.promise;
    };

    render(<Harness fetchSuggestions={fetcher} />);
    focusField();

    type("ru");
    await settle();
    type("rust");
    await settle();
    expect(pending).toHaveLength(2);

    // The second query answers first.
    pending[1]?.resolve(["rust book"]);
    await act(async () => {});
    expect(options().map((option) => option.textContent)).toEqual(["rust book"]);

    // …and then the first one lands. It must change nothing.
    pending[0]?.resolve(["rutabaga", "ruby"]);
    await act(async () => {});
    expect(options().map((option) => option.textContent)).toEqual(["rust book"]);
  });

  it("keeps the last good list when a request fails", async () => {
    let attempt = 0;
    const fetcher: SuggestionFetcher = async () => {
      attempt += 1;
      if (attempt === 1) return ["rust"];
      throw new Error("network");
    };

    render(<Harness fetchSuggestions={fetcher} />);
    focusField();

    type("rus");
    await settle();
    expect(options()).toHaveLength(1);

    type("rust");
    await settle();
    // Not an error state: the field still works and the form still submits.
    expect(options()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------- keyboard -- */

describe("keyboard", () => {
  const three: SuggestionFetcher = async () => [
    "rust",
    "rust book",
    "rust game",
  ];

  async function openWithThree(
    onSelect?: (suggestion: string) => void,
  ): Promise<void> {
    render(<Harness fetchSuggestions={three} onSelect={onSelect} />);
    focusField();
    type("rus");
    await settle();
  }

  it("moves down through the rows and back to the typed text", async () => {
    await openWithThree();
    const input = field();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    // The field follows the highlight, which is what the product does.
    expect(input.value).toBe("rust");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options()[2]).toHaveAttribute("aria-selected", "true");

    // Past the last row is back in the field, not stuck and not wrapped to the
    // top — the only way to undo an arrow press without Escape.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options().some((o) => o.getAttribute("aria-selected") === "true")).toBe(
      false,
    );
    expect(input.value).toBe("rus");
  });

  it("moves up from the field to the last row", async () => {
    await openWithThree();

    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(options()[2]).toHaveAttribute("aria-selected", "true");
  });

  it("does not refetch while arrowing rewrites the field", async () => {
    const fetcher = vi.fn<SuggestionFetcher>(three);
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();
    type("rus");
    await settle();

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(options()).toHaveLength(3);
  });

  it("takes the highlighted row on Enter", async () => {
    const onSelect = vi.fn();
    await openWithThree(onSelect);

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("rust book");
    expect(options()).toHaveLength(0);
  });

  it("does not reopen the popup on top of the search it just ran", async () => {
    await openWithThree();

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(options()).toHaveLength(0);
  });

  it("leaves Enter alone when nothing is highlighted, so the form submits", async () => {
    const onSelect = vi.fn();
    await openWithThree(onSelect);

    const event = createKeyDown("Enter");
    act(() => {
      field().dispatchEvent(event);
    });

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("abandons the highlight on Escape and restores what was typed", async () => {
    await openWithThree();

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field().value).toBe("rust");

    fireEvent.keyDown(field(), { key: "Escape" });
    expect(options()).toHaveLength(0);
    // Escape abandons the highlight; it does not clear the field.
    expect(field().value).toBe("rus");
  });

  it("reopens a dismissed list with ArrowDown rather than needing a refetch", async () => {
    const fetcher = vi.fn<SuggestionFetcher>(three);
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();
    type("rus");
    await settle();

    fireEvent.keyDown(field(), { key: "Escape" });
    expect(options()).toHaveLength(0);

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(options()).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("abandons rather than commits on Tab", async () => {
    const onSelect = vi.fn();
    await openWithThree(onSelect);

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Tab" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
    // Leaving the previewed text in the field would be committing it.
    expect(field().value).toBe("rus");
  });

  it("prevents the caret jump ArrowUp would otherwise cause", async () => {
    await openWithThree();

    const event = createKeyDown("ArrowUp");
    act(() => {
      field().dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});

/* --------------------------------------------------------------- pointer -- */

describe("pointer", () => {
  const one: SuggestionFetcher = async () => ["rust book"];

  it("selects a row that is clicked", async () => {
    const onSelect = vi.fn();
    render(<Harness fetchSuggestions={one} onSelect={onSelect} />);
    focusField();
    type("rus");
    await settle();

    const option = options()[0];
    // `mousedown` is suppressed so the field keeps focus; without that the
    // blur would close the popup before the click landed.
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      option?.dispatchEvent(mouseDown);
    });
    expect(mouseDown.defaultPrevented).toBe(true);

    fireEvent.click(option as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("rust book");
  });

  it("closes when the field loses focus", async () => {
    render(<Harness fetchSuggestions={one} />);
    focusField();
    type("rus");
    await settle();
    expect(options()).toHaveLength(1);

    act(() => {
      field().blur();
    });
    expect(options()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ aria -- */

describe("combobox semantics", () => {
  const two: SuggestionFetcher = async () => ["rust", "rust book"];

  it("writes the combobox attributes onto the field it was given", async () => {
    render(<Harness fetchSuggestions={two} />);
    const input = field();

    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");

    focusField();
    type("rus");
    await settle();

    expect(input).toHaveAttribute("aria-expanded", "true");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
  });

  it("points `aria-activedescendant` at the highlighted row", async () => {
    render(<Harness fetchSuggestions={two} />);
    focusField();
    type("rus");
    await settle();

    const input = field();
    expect(input).not.toHaveAttribute("aria-activedescendant");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0]?.id);
  });
});

/* ------------------------------------------------------------- rendering -- */

describe("the row", () => {
  it("bolds the completion and not the typed prefix", async () => {
    const fetcher: SuggestionFetcher = async () => ["how it's made chocolate"];
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();
    type("how it");
    await settle();

    const completion = document.querySelector("[data-suggestion-completion]");
    // Read off `screenshots/07-search-suggestions-1920.png`: `how it` regular,
    // `'s made chocolate` bold. The instinct is the other way round.
    expect(completion?.textContent).toBe("'s made chocolate");
  });

  it("leaves a suggestion that does not start with the query unsplit", async () => {
    const fetcher: SuggestionFetcher = async () => ["making rust"];
    render(<Harness fetchSuggestions={fetcher} />);
    focusField();
    type("rust");
    await settle();

    expect(document.querySelector("[data-suggestion-completion]")).toBeNull();
    expect(options()[0]?.textContent).toBe("making rust");
  });
});

/** A cancelable `keydown` whose `defaultPrevented` can be inspected. */
function createKeyDown(key: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
}
