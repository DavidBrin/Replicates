import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import { controlsOf, useMatchConfig } from "@/lib/matchConfig";
import { PlayerOptions } from "./PlayerOptions";

beforeEach(() => {
  useMatchConfig.getState().reset();
});

describe("PlayerOptions (Plan 5)", () => {
  it("turns a human's stick jump off, and the match gets the option", () => {
    render(<PlayerOptions />);
    const toggle = screen.getByRole("switch", { name: "P1 stick jump" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    const p1 = useMatchConfig.getState().players[0];
    expect(p1.stickJump).toBe(false);
    expect(controlsOf(p1)).toBe(CONTROL_STICK_JUMP_OFF);
  });

  it("offers nothing for a CPU, which always plays the default", () => {
    render(<PlayerOptions />);
    expect(screen.queryByRole("switch", { name: "P2 stick jump" })).toBeNull();
    expect(controlsOf({ kind: "cpu", stickJump: false })).toBe(0);
  });
});
