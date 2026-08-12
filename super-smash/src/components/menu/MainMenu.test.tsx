import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { MainMenu } from "./MainMenu";

async function renderMenu() {
  render(<MainMenu />);
  // The roster loads on mount; flushing it here keeps the medallion's state
  // update inside act rather than arriving mid-assertion.
  await act(async () => {});
}

beforeEach(() => {
  routerMock.push.mockClear();
});

describe("MainMenu", () => {
  it("starts the flow at the rules screen, which is the order Ultimate uses", async () => {
    await renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /^smash/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/rules");
  });

  it("shows every mode, and disables the four that are out of scope", async () => {
    await renderMenu();

    for (const label of ["Spirits", "Games & More", "Vault", "Online"]) {
      const tile = screen.getByRole("button", { name: new RegExp(label, "i") });
      expect(tile).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByRole("button", { name: /^smash/i })).not.toHaveAttribute("aria-disabled");
  });

  it("does not navigate from a disabled tile", async () => {
    await renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /spirits/i }));

    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("says why a dimmed mode is dimmed rather than leaving it a mystery", async () => {
    await renderMenu();

    expect(screen.getAllByRole("tooltip")[0]).toHaveTextContent(/out of scope/i);
  });

  /** One tab stop, arrows to move: the console's model, not five tab stops. */
  it("moves the menu cursor with the arrow keys", async () => {
    await renderMenu();

    const smash = screen.getByRole("button", { name: /^smash/i });
    smash.focus();
    fireEvent.keyDown(smash, { key: "ArrowRight" });

    expect(screen.getByRole("button", { name: /spirits/i })).toHaveFocus();
  });

  it("wraps the cursor from the first tile to the last", async () => {
    await renderMenu();

    const smash = screen.getByRole("button", { name: /^smash/i });
    smash.focus();
    fireEvent.keyDown(smash, { key: "ArrowLeft" });

    expect(screen.getByRole("button", { name: /online/i })).toHaveFocus();
  });
});
