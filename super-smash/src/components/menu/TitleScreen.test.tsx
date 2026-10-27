import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

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

  /**
   * The page arrives as server HTML with the button already in it, and the
   * key listener is only attached once React has hydrated it: a press before
   * then is lost. So the button says when it is listening, and a test (or
   * anything else) can wait for that instead of guessing.
   */
  describe("says when it is listening", () => {
    it("is not marked ready before the listener is attached, as the server sends it", () => {
      const html = renderToString(<TitleScreen />);
      expect(html).toContain('aria-label="Press any button to continue"');
      expect(html).not.toContain("data-ready");
    });

    it("is marked ready once the listener is attached, and a key then advances", () => {
      render(<TitleScreen />);
      const button = screen.getByRole("button", { name: /press any button/i });
      expect(button).toHaveAttribute("data-ready", "true");
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(routerMock.push).toHaveBeenCalledWith("/menu");
    });

    it("stops saying so when it goes away, along with the listener", () => {
      const { unmount } = render(<TitleScreen />);
      const button = screen.getByRole("button", { name: /press any button/i });
      unmount();
      expect(button).not.toHaveAttribute("data-ready");
      fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
      expect(routerMock.push).not.toHaveBeenCalled();
    });
  });

  it("shows the prompt", () => {
    render(<TitleScreen />);
    expect(screen.getByText(/press any button/i)).toBeInTheDocument();
  });

  it("spells the wordmark and the emblem as David-Smash", () => {
    render(<TitleScreen />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/david\s*smash/i);
    expect(screen.getAllByRole("img", { name: "David-Smash emblem" }).length).toBeGreaterThan(0);
  });
});
