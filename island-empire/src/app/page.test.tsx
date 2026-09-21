import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { localSettings } from "@/adapters/localStorage/settings";

import { installMemoryLocalStorage } from "@/components/ui/localStorage.test-support";

import Home from "./page";
import CampaignPage from "./campaign/page";

installMemoryLocalStorage();

describe("/ title menu", () => {
  it("shows the logo and links to every mode", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Island\s*Empire/);
    const nav = screen.getByRole("navigation", { name: "Main menu" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Campaign", "/campaign"],
      ["Random Map", "/random"],
      ["Hot-seat", "/hotseat"],
      ["Weekly Challenges", "/challenges"],
      ["Map Editor", "/editor"],
    ]);
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("Settings opens the dialog and toggles persist through the settings port", async () => {
    window.localStorage.clear();
    render(<Home />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toBeInTheDocument();
    const oneClick = screen.getByRole("switch", { name: "One-click move" });
    expect(oneClick).toHaveAttribute("aria-checked", "false");
    await userEvent.click(oneClick);
    expect(oneClick).toHaveAttribute("aria-checked", "true");
    expect(localSettings.read().oneClickMove).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("/campaign", () => {
  it("renders the overworld", () => {
    render(<CampaignPage />);
    expect(screen.getByTestId("overworld")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Campaign island" })).toBeInTheDocument();
  });
});
