import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Combobox, matchOption, type ComboboxOption } from "@/components/ui/combobox";

/**
 * The picker's keyboard model.
 *
 * This is the component the rest of the app is built on top of, and every rule
 * asserted here comes from `research/04-interaction.md` §3. They are asserted
 * individually rather than as one "it works" test because each of them is a
 * behaviour a reimplementation would plausibly get wrong on its own.
 */

const STATES: ComboboxOption[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in-progress", label: "In Progress" },
  { value: "in-review", label: "In Review" },
  { value: "done", label: "Done", keywords: "completed finished" },
];

function activeOptionName(): string {
  const input = screen.getByRole("combobox");
  const id = input.getAttribute("aria-activedescendant");
  if (!id) throw new Error("no active descendant");
  const option = document.getElementById(id);
  if (!option) throw new Error(`no option with id ${id}`);
  return option.textContent ?? "";
}

describe("Combobox — keyboard model", () => {
  it("keeps focus in the input and tracks the active row with aria-activedescendant", async () => {
    // Not roving tabindex: focus must stay in the field so that typing after
    // arrowing goes to the query rather than nowhere.
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);

    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();
    expect(activeOptionName()).toBe("Backlog");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveFocus();
    expect(activeOptionName()).toBe("Todo");
  });

  it("opens on the applied value rather than on row 0", async () => {
    // Otherwise a keyboard user's first two presses are always corrections.
    render(<Combobox options={STATES} value="in-review" onSelect={vi.fn()} />);
    expect(activeOptionName()).toContain("In Review");
  });

  it("wraps at both ends", async () => {
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);

    await user.keyboard("{ArrowUp}");
    expect(activeOptionName()).toBe("Done");
    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Backlog");
  });

  it("moves to the ends with Home and End", async () => {
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);

    await user.keyboard("{End}");
    expect(activeOptionName()).toBe("Done");
    await user.keyboard("{Home}");
    expect(activeOptionName()).toBe("Backlog");
  });

  it("filters as a subsequence, not a substring", async () => {
    // "ip" must find "In Progress"; `includes` finds nothing.
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);

    await user.type(screen.getByRole("combobox"), "ip");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("In Progress");
  });

  it("finds an option by a keyword that is not in its label", async () => {
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);

    await user.type(screen.getByRole("combobox"), "completed");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Done");
  });

  it("resets to the best match while typing and snaps back to the applied value when cleared", async () => {
    const user = userEvent.setup();
    render(<Combobox options={STATES} value="done" onSelect={vi.fn()} />);
    expect(activeOptionName()).toContain("Done");

    await user.type(screen.getByRole("combobox"), "in");
    expect(activeOptionName()).toContain("In Progress");

    await user.clear(screen.getByRole("combobox"));
    expect(activeOptionName()).toContain("Done");
  });

  it("applies on Enter and asks to close", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <Combobox
        options={STATES}
        onSelect={onSelect}
        onRequestClose={onRequestClose}
      />,
    );

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("todo", { close: true });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("holds the menu open when Enter is pressed with Shift", async () => {
    // The accelerator that lets you rip through a selection without reopening.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <Combobox
        options={STATES}
        onSelect={onSelect}
        onRequestClose={onRequestClose}
      />,
    );

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSelect).toHaveBeenCalledWith("backlog", { close: false });
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("never closes on selection in multi-select mode", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <Combobox
        options={STATES}
        multiple
        values={["todo"]}
        onSelect={onSelect}
        onRequestClose={onRequestClose}
      />,
    );

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.any(String), { close: false });
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("clears the query after a multi-select toggle so the next label can be typed straight away", async () => {
    const user = userEvent.setup();
    render(
      <Combobox options={STATES} multiple values={[]} onSelect={vi.fn()} />,
    );

    const input = screen.getByRole("combobox");
    await user.type(input, "done");
    await user.keyboard("{Enter}");
    expect(input).toHaveValue("");
  });

  it("exits multi-select with Cmd+Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <Combobox
        options={STATES}
        multiple
        values={[]}
        onSelect={onSelect}
        onRequestClose={onRequestClose}
      />,
    );

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSelect).toHaveBeenCalledWith("backlog", { close: true });
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without applying anything", async () => {
    // Escape is safe because selection already applied — there is nothing to
    // revert, and reverting would be the wrong behaviour if there were.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onRequestClose = vi.fn();
    render(
      <Combobox
        options={STATES}
        onSelect={onSelect}
        onRequestClose={onRequestClose}
      />,
    );

    await user.keyboard("{ArrowDown}{Escape}");
    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies and closes on Tab", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Combobox options={STATES} onSelect={onSelect} />);

    await user.keyboard("{ArrowDown}{ArrowDown}{Tab}");
    expect(onSelect).toHaveBeenCalledWith("in-progress", { close: true });
  });

  it("routes printable characters to the query, never to type-ahead", async () => {
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);

    await user.keyboard("{ArrowDown}");
    await user.keyboard("d");
    expect(screen.getByRole("combobox")).toHaveValue("d");
  });

  it("skips a disabled option when arrowing", async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Bravo", disabled: true },
          { value: "c", label: "Charlie" },
        ]}
        onSelect={vi.fn()}
      />,
    );

    await user.keyboard("{ArrowDown}");
    expect(activeOptionName()).toBe("Charlie");
  });
});

describe("Combobox — mouse and selection state", () => {
  it("applies on click and keeps it open when Shift is held", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Combobox options={STATES} onSelect={onSelect} />);

    await user.click(screen.getByRole("option", { name: "Todo" }));
    expect(onSelect).toHaveBeenLastCalledWith("todo", { close: true });

    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("option", { name: "Done" }));
    await user.keyboard("{/Shift}");
    expect(onSelect).toHaveBeenLastCalledWith("done", { close: false });
  });

  it("marks every applied value selected in multi-select", () => {
    render(
      <Combobox
        options={STATES}
        multiple
        values={["todo", "done"]}
        onSelect={vi.fn()}
      />,
    );
    const selected = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(2);
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-multiselectable",
      "true",
    );
  });

  it("offers to create when nothing matches, and only then", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<Combobox options={STATES} onSelect={vi.fn()} onCreate={onCreate} />);

    await user.type(screen.getByRole("combobox"), "todo");
    expect(screen.queryByText(/^Create/)).not.toBeInTheDocument();

    await user.clear(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "Regression");
    await user.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Regression");
  });

  it("says so when there is nothing to show and no way to create", async () => {
    const user = userEvent.setup();
    render(<Combobox options={STATES} onSelect={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});

describe("matchOption", () => {
  it("returns the matched indices so the row can embolden them", () => {
    const match = matchOption({ value: "x", label: "In Progress" }, "ip");
    expect(match?.indices).toEqual([0, 3]);
  });

  it("ranks an earlier, more contiguous match higher", () => {
    const early = matchOption({ value: "a", label: "Done" }, "do");
    const late = matchOption({ value: "b", label: "Backlog Done" }, "do");
    expect(early?.score).toBeLessThan(late?.score ?? Infinity);
  });

  it("matches everything on an empty query, in the caller's order", () => {
    const match = matchOption({ value: "a", label: "Anything" }, "");
    expect(match).not.toBeNull();
    expect(match?.indices).toEqual([]);
  });

  it("returns null when neither the label nor the keywords match", () => {
    expect(
      matchOption({ value: "a", label: "Done", keywords: "finished" }, "zzz"),
    ).toBeNull();
  });
});
