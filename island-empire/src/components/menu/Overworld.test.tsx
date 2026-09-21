import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localProgress } from "@/adapters/localStorage/progress";
import { LEVEL_IDS } from "@/content/levels/index";
import { routerMock } from "../../../vitest.setup";

import { installMemoryLocalStorage } from "@/components/ui/localStorage.test-support";

import { Overworld } from "./Overworld";

installMemoryLocalStorage();

/** Finish any walk in a single frame so tests need not wait on real time. */
function instantFrames() {
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    const id = window.setTimeout(() => cb(performance.now() + 10_000), 0);
    return id as unknown as number;
  });
  const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id));
  return () => {
    raf.mockRestore();
    caf.mockRestore();
  };
}

describe("Overworld", () => {
  let restore: () => void;
  beforeEach(() => {
    window.localStorage.clear();
    localProgress.reset();
    routerMock.push.mockClear();
    restore = instantFrames();
  });
  afterEach(() => restore());

  it("renders twelve nodes; only level 01 is unlocked on a fresh device", async () => {
    render(<Overworld />);
    for (const id of LEVEL_IDS) expect(screen.getByTestId(`node-${id}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("node-01")).toHaveAttribute("data-unlocked", "true"));
    expect(screen.getByTestId("node-02")).toHaveAttribute("data-unlocked", "false");
    expect(screen.getByTestId("node-02")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("total-stars")).toHaveTextContent("0/36");
    expect(screen.getByRole("link", { name: "Back to menu" })).toHaveAttribute("href", "/");
  });

  it("shows stars per node and unlocks the level after a starred one", async () => {
    localProgress.recordLevelWin("01", "easy", 6);
    localProgress.recordLevelWin("01", "normal", 8);
    localProgress.recordLevelWin("02", "easy", 6);
    render(<Overworld />);
    await waitFor(() => expect(screen.getByTestId("node-03")).toHaveAttribute("data-unlocked", "true"));
    expect(screen.getByTestId("node-01")).toHaveAttribute("data-stars", "2");
    expect(screen.getByTestId("node-02")).toHaveAttribute("data-stars", "1");
    expect(screen.getByTestId("node-03")).toHaveAttribute("data-stars", "0");
    expect(screen.getByTestId("node-04")).toHaveAttribute("data-unlocked", "false");
    expect(screen.getByTestId("total-stars")).toHaveTextContent("3/36");
    expect(screen.getByRole("button", { name: /Level 03: The Wall, 0 of 3 stars/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Level 04: Green Fields \(locked\)/ })).toBeInTheDocument();
  });

  it("tap-to-jump: tapping an unlocked node walks there and opens its intro", async () => {
    localProgress.recordLevelWin("01", "easy", 6);
    localProgress.recordLevelWin("02", "easy", 6);
    render(<Overworld />);
    await waitFor(() => expect(screen.getByTestId("node-03")).toHaveAttribute("data-unlocked", "true"));

    // Jump straight back to level 01, skipping 02 — the original could not.
    await act(async () => {
      await userEvent.click(screen.getByTestId("node-01"));
    });
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/campaign/01/intro"));
    expect(JSON.parse(window.localStorage.getItem("island-empire:overworld:v1")!)).toEqual({ at: "01" });
  });

  it("tapping a locked node shows a hint and does not navigate", async () => {
    render(<Overworld />);
    await waitFor(() => expect(screen.getByTestId("node-01")).toHaveAttribute("data-unlocked", "true"));
    await userEvent.click(screen.getByTestId("node-05"));
    expect(await screen.findByRole("status")).toHaveTextContent("WIN LEVEL 04 FIRST");
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("sequential advance: the avatar walks from where it stood to the newly unlocked level", async () => {
    window.localStorage.setItem("island-empire:overworld:v1", JSON.stringify({ at: "01" }));
    localProgress.recordLevelWin("01", "easy", 6);
    render(<Overworld />);
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem("island-empire:overworld:v1")!)).toEqual({ at: "02" }),
    );
    expect(screen.getByTestId("overworld-avatar")).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("keyboard: Enter on a node activates it", async () => {
    render(<Overworld />);
    await waitFor(() => expect(screen.getByTestId("node-01")).toHaveAttribute("data-unlocked", "true"));
    screen.getByTestId("node-01").focus();
    await act(async () => {
      await userEvent.keyboard("{Enter}");
    });
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/campaign/01/intro"));
  });
});
