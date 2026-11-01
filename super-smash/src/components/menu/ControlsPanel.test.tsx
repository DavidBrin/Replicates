import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_BINDINGS, useMatchConfig } from "@/lib/matchConfig";
import { ControlsPanel } from "./ControlsPanel";

/** Two humans, on the two presets that collide. */
function seatTwoHumans() {
  useMatchConfig.getState().setPlayerKind(1, "human");
  useMatchConfig.getState().setScheme(1, "mirrored");
}

beforeEach(() => {
  useMatchConfig.getState().reset();
});

describe("ControlsPanel", () => {
  /**
   * Plan 5, Task 20 (item 7, and the fix round's M2): the player options are on the screen, and the Up rule says Stick Jump turns off.
   * Task 21 (item 10): for each person playing on this machine, which is every human offline and only this machine's player online (R-T20a).
   */
  it("offers each human's Stick Jump, and says that it can be turned off", () => {
    render(<ControlsPanel />);
    expect(screen.getByRole("switch", { name: "P1 stick jump" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: /up jumps, like the stick/i }).parentElement).toHaveTextContent(
      /stick jump can be turned off below for each person playing on this machine/i,
    );
  });

  /** Plan 5, Task 21: each human's gamepad buttons and right stick. */
  it("offers each human's gamepad options", () => {
    render(<ControlsPanel />);
    expect(screen.getByRole("region", { name: "Gamepad" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "P1 right stick" })).toHaveValue("smash");
  });

  /** Plan 5, Task 21b (ruling P5-R27): the Tilt key, in the list, on the diagram, and explained. */
  it("lists the Tilt key, marks it on the diagram, and says what holding it does", () => {
    const { container } = render(<ControlsPanel />);
    expect(screen.getByRole("button", { name: "Rebind Tilt, currently V" })).toBeInTheDocument();
    expect(container.querySelector('[data-key="KeyV"]')).toHaveAttribute("data-bound", "tilt");
    const panel = screen.getByRole("heading", { name: /hold tilt to walk/i }).parentElement!;
    expect(panel).toHaveTextContent(/hold tilt \(v on config 1\)/i);
    // Fix round 1 (review Minors 1-2): what the code does. A run still dash-attacks, and the walk is half speed.
    expect(panel).toHaveTextContent(/walks, at half speed/i);
    expect(panel).toHaveTextContent(/attack with a direction is never a smash \(from a standstill or a walk it is a tilt\)/i);
    expect(panel).not.toHaveTextContent(/attack is a tilt/i);
    expect(panel).toHaveTextContent(/up never jumps/i);

    fireEvent.click(screen.getByRole("tab", { name: "Config 2" }));
    expect(screen.getByRole("button", { name: "Rebind Tilt, currently C" })).toBeInTheDocument();
    expect(panel).toHaveTextContent(/hold tilt \(c on config 2\)/i);
  });

  it("rebinds the Tilt key by pressing it", () => {
    render(<ControlsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /rebind tilt/i }));
    fireEvent.keyDown(window, { code: "KeyB", key: "b" });

    expect(useMatchConfig.getState().bindings.arrows.tilt).toBe("KeyB");
    expect(screen.getByRole("status")).toHaveTextContent(/tilt is now b/i);
    expect(screen.getByRole("button", { name: "Rebind Tilt, currently B" })).toBeInTheDocument();
  });

  it("states the mirror-image problem in the numbers, not in prose alone", () => {
    render(<ControlsPanel />);
    expect(screen.getByText(/6 physical keys carry opposite meanings/i)).toBeInTheDocument();
  });

  it("highlights a bound key on the diagram", () => {
    const { container } = render(<ControlsPanel />);

    expect(container.querySelector('[data-key="ArrowLeft"]')).toHaveAttribute("data-bound", "left");
    expect(container.querySelector('[data-key="KeyW"]')).toHaveAttribute("data-bound", "jump");
    expect(container.querySelector('[data-key="KeyZ"]')).not.toHaveAttribute("data-bound");
  });

  /**
   * The rule from SPEC §6: a `keydown` does not say whose finger caused it, so
   * one key cannot mean two things to two people at the same keyboard.
   */
  it("refuses a key another active player already holds", () => {
    seatTwoHumans();
    render(<ControlsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /rebind jump/i }));
    fireEvent.keyDown(window, { code: "ArrowUp", key: "ArrowUp" });

    expect(screen.getByRole("status")).toHaveTextContent(/already P2's Jump/i);
    expect(useMatchConfig.getState().bindings.arrows.jump).toBe(DEFAULT_BINDINGS.arrows.jump);
  });

  it("accepts a key nobody is holding", () => {
    seatTwoHumans();
    render(<ControlsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /rebind grab/i }));
    fireEvent.keyDown(window, { code: "KeyZ", key: "z" });

    expect(useMatchConfig.getState().bindings.arrows.grab).toBe("KeyZ");
    expect(screen.getByRole("status")).toHaveTextContent(/grab is now z/i);
  });

  it("cancels a capture on Escape without changing anything", () => {
    render(<ControlsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /rebind shield/i }));
    fireEvent.keyDown(window, { code: "Escape", key: "Escape" });

    expect(useMatchConfig.getState().bindings.arrows.shield).toBe(DEFAULT_BINDINGS.arrows.shield);
    expect(screen.getByRole("status")).toHaveTextContent(/cancelled/i);
  });

  it("stops a second human claiming a preset that is already taken", () => {
    seatTwoHumans();
    render(<ControlsPanel />);

    // P1 holds Config 1, so P2 must not be offered it.
    const p2Row = screen.getByText("P2").closest("div")!;
    const config1 = screen.getAllByRole("button", { name: "Config 1" });
    const inP2Row = config1.filter((button) => p2Row.parentElement?.contains(button));

    expect(inP2Row.length).toBeGreaterThan(0);
    for (const button of inP2Row) expect(button).toBeDisabled();
  });

  it("shows a different scheme when its tab is chosen", () => {
    render(<ControlsPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "Config 3" }));

    expect(screen.getByRole("button", { name: /rebind jump, currently p/i })).toBeInTheDocument();
  });

  it("puts a preset back the way it started", () => {
    render(<ControlsPanel />);

    fireEvent.click(screen.getByRole("button", { name: /rebind grab/i }));
    fireEvent.keyDown(window, { code: "KeyZ", key: "z" });
    expect(useMatchConfig.getState().bindings.arrows.grab).toBe("KeyZ");

    fireEvent.click(screen.getByRole("button", { name: /reset config 1/i }));
    expect(useMatchConfig.getState().bindings.arrows).toEqual(DEFAULT_BINDINGS.arrows);
  });
});
