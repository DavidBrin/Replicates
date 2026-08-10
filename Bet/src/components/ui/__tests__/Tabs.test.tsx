import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs } from "../Tabs";

const tabs = [
  { id: "markets", label: "Markets" },
  { id: "members", label: "Members" },
  { id: "leaderboard", label: "Leaderboard" },
];

describe("Tabs", () => {
  it("defaults the first tab to active and marks it aria-selected", () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByRole("tab", { name: "Markets" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches the active tab on click and calls onChange (uncontrolled)", async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} onChange={onChange} />);

    await userEvent.click(screen.getByRole("tab", { name: "Members" }));

    expect(onChange).toHaveBeenCalledWith("members");
    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Markets" })).toHaveAttribute("aria-selected", "false");
  });

  it("in controlled mode, the active tab follows `value` rather than internal state", async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="leaderboard" onChange={onChange} />);

    expect(screen.getByRole("tab", { name: "Leaderboard" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.click(screen.getByRole("tab", { name: "Markets" }));
    expect(onChange).toHaveBeenCalledWith("markets");
    // Still leaderboard — the parent didn't update `value`.
    expect(screen.getByRole("tab", { name: "Leaderboard" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
