import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { sessionConfigStore } from "@/game/sessionConfig";
import { routerMock } from "../../../vitest.setup";

import NewGamePage from "./page";

beforeEach(() => {
  sessionConfigStore.getState().reset();
  routerMock.push.mockClear();
});

describe("/new (Select a game type)", () => {
  it("heads the screen `Select a game type`", () => {
    render(<NewGamePage />);
    expect(screen.getByRole("heading", { name: "Select a game type" })).toBeInTheDocument();
  });

  it("offers exactly the three in-scope cards with their verbatim descriptions", () => {
    render(<NewGamePage />);
    expect(screen.getByTestId("game-type-solo")).toHaveTextContent("Battle the AI");
    expect(screen.getByTestId("game-type-pass-and-play")).toHaveTextContent("Local, one shared device");
    expect(screen.getByTestId("game-type-online")).toHaveTextContent("Casual games with other players");
    // RGD's `Basic Training` and `Ranked 1v1` are out of scope
    expect(screen.getByTestId("new-game-screen").textContent).not.toMatch(/Basic Training|Ranked/);
  });

  it("writes the picked mode into sessionConfigStore", () => {
    render(<NewGamePage />);
    fireEvent.click(screen.getByTestId("game-type-pass-and-play"));
    expect(sessionConfigStore.getState().mode).toBe("pass-and-play");
    expect(screen.getByTestId("game-type-pass-and-play")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("game-type-solo")).toHaveAttribute("data-selected", "false");
  });

  it("writes the FFA | 1v1 format and drops to two seats for 1v1", () => {
    render(<NewGamePage />);
    expect(screen.getByTestId("format-toggle-ffa")).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByTestId("format-toggle-1v1"));
    expect(sessionConfigStore.getState().format).toBe("1v1");
    expect(sessionConfigStore.getState().seats).toHaveLength(2);
  });

  it("routes Online straight to the lobby browser (D115)", () => {
    sessionConfigStore.getState().setMode("online");
    render(<NewGamePage />);
    fireEvent.click(screen.getByTestId("new-battle"));
    expect(routerMock.push).toHaveBeenCalledWith("/lobby");
  });

  it("routes to /new/map from the green BATTLE pill", () => {
    render(<NewGamePage />);
    expect(screen.getByTestId("new-battle")).toHaveTextContent("BATTLE");
    fireEvent.click(screen.getByTestId("new-battle"));
    expect(routerMock.push).toHaveBeenCalledWith("/new/map");
  });
});
