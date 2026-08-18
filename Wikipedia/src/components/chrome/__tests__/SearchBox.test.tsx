import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBox } from "../SearchBox";
import { routerMock } from "../../../../vitest.setup";

describe("SearchBox", () => {
  it("shows no suggestions before typing", () => {
    render(<SearchBox />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("suggests matching titles as the user types", async () => {
    const user = userEvent.setup();
    render(<SearchBox />);

    const input = screen.getByRole("combobox");
    await user.type(input, "linea");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Linear (replica)")).toBeInTheDocument();
  });

  it("shows no dropdown for a query that matches nothing", async () => {
    const user = userEvent.setup();
    render(<SearchBox />);

    const input = screen.getByRole("combobox");
    await user.type(input, "zzzznonexistentzzzz");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates via keyboard: ArrowDown then Enter", async () => {
    const user = userEvent.setup();
    routerMock.push.mockClear();
    render(<SearchBox />);

    const input = screen.getByRole("combobox");
    await user.type(input, "linea");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(routerMock.push).toHaveBeenCalledWith("/wiki/Linear_(replica)");
  });

  it("navigates on suggestion click", async () => {
    const user = userEvent.setup();
    routerMock.push.mockClear();
    render(<SearchBox />);

    const input = screen.getByRole("combobox");
    await user.type(input, "linea");
    await user.click(screen.getByText("Linear (replica)"));

    expect(routerMock.push).toHaveBeenCalledWith("/wiki/Linear_(replica)");
  });

  it("sets aria-activedescendant to the highlighted option's id, per the ARIA combobox pattern", async () => {
    const user = userEvent.setup();
    render(<SearchBox />);

    const input = screen.getByRole("combobox");
    await user.type(input, "replica");
    expect(input).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    const active = options[0];
    expect(active).toHaveAttribute("id");
    expect(input).toHaveAttribute("aria-activedescendant", active.id);
    expect(active).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("closes the dropdown on Escape", async () => {
    const user = userEvent.setup();
    render(<SearchBox />);

    const input = screen.getByRole("combobox");
    await user.type(input, "linea");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
