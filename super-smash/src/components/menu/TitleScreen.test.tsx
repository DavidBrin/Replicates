import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { TitleScreen } from "./TitleScreen";

beforeEach(() => {
  routerMock.push.mockClear();
});

describe("TitleScreen", () => {
  it("advances to the main menu on any key", () => {
    render(<TitleScreen />);

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });

    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });

  it("advances on a pointer too, so the screen is not keyboard-only", () => {
    render(<TitleScreen />);

    fireEvent.click(screen.getByRole("button", { name: /press any button/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });

  /** Mashing at the title screen is normal; two transitions is a visible bug. */
  it("only navigates once however many keys are pressed", () => {
    render(<TitleScreen />);

    fireEvent.keyDown(window, { key: "a", code: "KeyA" });
    fireEvent.keyDown(window, { key: "b", code: "KeyB" });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });

    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it("ignores a bare modifier, which is a player reaching for a shortcut", () => {
    render(<TitleScreen />);

    fireEvent.keyDown(window, { key: "Shift", code: "ShiftLeft" });

    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("shows the prompt", () => {
    render(<TitleScreen />);
    expect(screen.getByText(/press any button/i)).toBeInTheDocument();
  });
});
