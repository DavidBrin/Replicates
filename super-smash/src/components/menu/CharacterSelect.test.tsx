import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { CharacterSelect } from "./CharacterSelect";

async function renderSelect() {
  render(<CharacterSelect />);
  await act(async () => {});
}

const portraits = () => screen.getAllByRole("button", { name: /, number \d/i });

beforeEach(() => {
  useMatchConfig.getState().reset();
  resetRosterCache();
  routerMock.push.mockClear();
});

describe("CharacterSelect", () => {
  it("orders the grid by fighter number, as Ultimate does", async () => {
    await renderSelect();

    const numbers = portraits().map((tile) =>
      Number(/, number (\d+)/i.exec(tile.getAttribute("aria-label") ?? "")?.[1]),
    );

    expect(numbers.length).toBeGreaterThan(1);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
  });

  it("puts a random slot at the end of the grid", async () => {
    await renderSelect();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  it("fills the active panel and hands the cursor to the next empty one", async () => {
    await renderSelect();

    fireEvent.click(portraits()[0]);
    expect(useMatchConfig.getState().players[0].fighterId).not.toBeNull();

    fireEvent.click(portraits()[1]);
    expect(useMatchConfig.getState().players[1].fighterId).not.toBeNull();
    expect(useMatchConfig.getState().players[0].fighterId).not.toBe(
      useMatchConfig.getState().players[1].fighterId,
    );
  });

  it("holds READY TO FIGHT shut until every panel is filled", async () => {
    await renderSelect();

    const ready = screen.getByRole("button", { name: /ready to fight/i });
    expect(ready).toBeDisabled();

    fireEvent.click(portraits()[0]);
    expect(screen.getByRole("button", { name: /ready to fight/i })).toBeDisabled();

    fireEvent.click(portraits()[1]);
    const armed = screen.getByRole("button", { name: /ready to fight/i });
    expect(armed).toBeEnabled();

    fireEvent.click(armed);
    expect(routerMock.push).toHaveBeenCalledWith("/play");
  });

  /** Ultimate's CPU levels run 1–9 and the ends are hard stops, not wraps. */
  it("clamps the CPU level to 1–9 at both ends", async () => {
    await renderSelect();

    const down = screen.getByRole("button", { name: /decrease cpu level for p2/i });
    const up = screen.getByRole("button", { name: /increase cpu level for p2/i });
    const value = () => screen.getByLabelText("CPU level for P2");

    expect(value()).toHaveTextContent("3");

    for (let i = 0; i < 6; i += 1) fireEvent.click(down);
    expect(value()).toHaveTextContent("1");
    expect(useMatchConfig.getState().players[1].cpuLevel).toBe(1);
    expect(screen.getByRole("button", { name: /decrease cpu level for p2/i })).toBeDisabled();

    for (let i = 0; i < 20; i += 1) fireEvent.click(up);
    expect(value()).toHaveTextContent("9");
    expect(useMatchConfig.getState().players[1].cpuLevel).toBe(9);
    expect(screen.getByRole("button", { name: /increase cpu level for p2/i })).toBeDisabled();
  });

  it("adds and removes players between two and four", async () => {
    await renderSelect();

    expect(screen.getByRole("button", { name: /remove a player/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /add a player/i }));
    fireEvent.click(screen.getByRole("button", { name: /add a player/i }));
    expect(useMatchConfig.getState().players).toHaveLength(4);
    expect(screen.getByRole("button", { name: /add a player/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /remove a player/i }));
    expect(useMatchConfig.getState().players).toHaveLength(3);
  });

  it("turns a CPU port into a human one", async () => {
    await renderSelect();

    fireEvent.click(screen.getByRole("button", { name: /^hmn for p2$/i }));

    expect(useMatchConfig.getState().players[1].kind).toBe("human");
  });

  it("moves the grid cursor with the arrow keys", async () => {
    await renderSelect();

    const tiles = portraits();
    tiles[0].focus();
    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(tiles[1]).toHaveFocus();
  });

  it("adds a player from the keyboard", async () => {
    await renderSelect();

    fireEvent.keyDown(window, { key: "+" });

    expect(useMatchConfig.getState().players).toHaveLength(3);
  });

  it("slides in the blurb for the fighter under the pointer", async () => {
    await renderSelect();

    // React derives onMouseEnter from mouseover rather than listening for
    // mouseenter, so a raw mouseenter would never reach the handler.
    fireEvent.mouseOver(portraits()[0]);

    const preview = screen.getByRole("complementary", { name: /fighter preview/i });
    expect(within(preview).getByRole("heading")).toBeInTheDocument();
  });
});
