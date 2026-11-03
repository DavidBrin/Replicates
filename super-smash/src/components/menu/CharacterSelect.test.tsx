import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // What lets `/play` start it (Plan 6, Task 29).
    expect(useMatchConfig.getState().armed).toBe(true);
  });

  /**
   * Press-to-join (Plan 6, Task 30; ruling R-P6-11, and the fix round's ruling: only a pad
   * that drives no seat yet joins). The pads are polled once an animation frame; the frames
   * are stepped inside act(). `held[i]` is pad i's buttons down, read on every poll.
   */
  describe("press-to-join", () => {
    let held: number[][] = [];
    const frame = () =>
      act(async () => {
        vi.advanceTimersByTime(16);
      });
    const seats = () => useMatchConfig.getState().players.map((p) => [p.kind, p.joinedPad]);
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
      held = [];
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () =>
          held.map((pressed, index) => ({
            index,
            connected: true,
            buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
          })),
      });
    });
    afterEach(() => {
      delete (navigator as { getGamepads?: unknown }).getGamepads;
      vi.useRealTimers();
    });

    it("leaves the seats alone when a lone pad, which plays P1 by connection order, presses A or Start, however often", async () => {
      held = [[]];
      await renderSelect();
      await frame();
      for (const button of [0, 9, 0]) {
        held[0] = [button];
        await frame();
        held[0] = [];
        await frame();
      }
      // The solo player keeps the CPU opponent, and the pad joined nothing, so it still plays P1.
      expect(seats()).toEqual([
        ["human", null],
        ["cpu", null],
      ]);
      expect(screen.queryByText("Pad")).not.toBeInTheDocument();
    });

    it("seats a second pad that presses A on the CPU's seat, never the keyboard player's, and says so on its panel", async () => {
      held = [[], []];
      await renderSelect();
      await frame();
      held[1] = [0];
      await frame();
      expect(seats()).toEqual([
        ["human", null],
        ["human", 1],
      ]);
      expect(within(document.querySelector<HTMLElement>("[data-port='1']")!).getByText("Pad")).toBeInTheDocument();
      expect(document.querySelector("[data-port='0']")).not.toHaveTextContent("Pad");
    });

    it("seats two pads that press on the same frame: the CPU's seat, then a new one", async () => {
      held = [[], [], []];
      await renderSelect();
      await frame();
      held[1] = [0];
      held[2] = [9];
      await frame();
      expect(seats()).toEqual([
        ["human", null],
        ["human", 1],
        ["human", 2],
      ]);
    });

    it("fills the fourth seat from the select screen, and a fifth pad finds none", async () => {
      held = [[], [], [], [], []];
      await renderSelect();
      await frame();
      held = [[], [0], [0], [0], [0]];
      await frame();
      expect(seats()).toEqual([
        ["human", null],
        ["human", 1],
        ["human", 2],
        ["human", 3],
      ]);
      expect(within(document.querySelector<HTMLElement>("[data-port='3']")!).getByText("Pad")).toBeInTheDocument();
    });
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
