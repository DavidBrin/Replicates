import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { useMatchConfig } from "@/lib/matchConfig";
import { RulesPanel } from "./RulesPanel";

beforeEach(() => {
  useMatchConfig.getState().reset();
  routerMock.push.mockClear();
});

describe("RulesPanel", () => {
  it("opens on Ultimate's defaults: 3 stocks, 2:30, Smash Ball on", () => {
    render(<RulesPanel />);

    expect(screen.getByLabelText("Stock count")).toHaveTextContent("3");
    expect(screen.getByLabelText("Time limit")).toHaveTextContent("2:30");
    expect(screen.getByRole("switch", { name: /smash ball/i })).toBeChecked();
  });

  it("switches between stock and time", () => {
    render(<RulesPanel />);

    fireEvent.click(screen.getByRole("radio", { name: /time/i }));

    expect(useMatchConfig.getState().rules.mode).toBe("time");
  });

  it("steps the clock in half minutes and stops at 1:00", () => {
    render(<RulesPanel />);

    fireEvent.click(screen.getByRole("button", { name: /decrease time limit/i }));
    expect(screen.getByLabelText("Time limit")).toHaveTextContent("2:00");

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: /decrease time limit/i }));
    }
    expect(screen.getByLabelText("Time limit")).toHaveTextContent("1:00");
    expect(screen.getByRole("button", { name: /decrease time limit/i })).toBeDisabled();
  });

  /** The bonus reports the player count; it is not something to switch on. */
  it("reports the 1v1 damage bonus rather than offering it as a setting", () => {
    render(<RulesPanel />);
    expect(screen.getByText("1.2×")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /1v1/i })).not.toBeInTheDocument();
  });

  it("continues to the stage select, which Ultimate puts before fighters", () => {
    render(<RulesPanel />);

    fireEvent.click(screen.getByRole("button", { name: /choose stage/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/stage");
  });
});
