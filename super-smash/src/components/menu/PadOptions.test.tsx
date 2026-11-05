import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAD_SETTINGS, PAD_BUTTON_LIMIT, rebind } from "@/input/gamepad";
import { useMatchConfig } from "@/lib/matchConfig";
import { bindSession, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { setActiveSession } from "@/net/online/session";
import { fakeSession } from "@/net/online/testing";
import type { Role } from "@/net/signalProtocol";
import { PadOptions } from "./PadOptions";

/** Pads the test presses buttons on, behind `navigator.getGamepads`. */
let pressed = new Set<number>();
let pressedOnSecond = new Set<number>();
let pressedOnThird = new Set<number>();
function fakePad(index = 0): Gamepad {
  const down = [pressed, pressedOnSecond, pressedOnThird][index] ?? new Set<number>();
  return {
    index,
    connected: true,
    axes: [0, 0, 0, 0],
    // More buttons than the standard mapping's 17: a non-standard pad can expose them (R-T21b).
    buttons: Array.from({ length: 40 }, (_, i) => ({ pressed: down.has(i), touched: false, value: down.has(i) ? 1 : 0 })),
  } as unknown as Gamepad;
}

/** What `navigator.getGamepads()` answers: the browser's slots, with holes. */
let slots: () => (Gamepad | null)[] = () => [fakePad(0), fakePad(1)];

beforeEach(() => {
  useMatchConfig.getState().reset();
  pressed = new Set();
  pressedOnSecond = new Set();
  pressedOnThird = new Set();
  slots = () => [fakePad(0), fakePad(1)];
  vi.useFakeTimers();
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => slots() });
});

afterEach(() => {
  act(() => leaveOnline());
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "getGamepads");
});

/** Let the capture loop poll a few times. */
function poll(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

const padOf = (port: number) => useMatchConfig.getState().players[port].pad;

describe("PadOptions (Plan 5)", () => {
  it("rebinds P1's attack to the next button pressed", () => {
    render(<PadOptions />);
    expect(screen.getByRole("button", { name: "P1 attack: A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    expect(screen.getByText("Press a button on your gamepad…")).toBeInTheDocument();
    pressed = new Set([3]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.attack).toEqual([3]);
    // Y left jump, so jump is X alone.
    expect(useMatchConfig.getState().players[0].pad.buttons.jump).toEqual([2]);
    expect(screen.getByRole("button", { name: "P1 attack: Y" })).toBeInTheDocument();
  });

  it("ignores a button already held when the capture starts", () => {
    pressed = new Set([5]);
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 special: B" }));
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.special).toEqual([1]);
    pressed = new Set([5, 2]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.special).toEqual([2]);
  });

  it("listens only to the port's own pad: player 2 pressing a button does not rebind player 1", () => {
    useMatchConfig.getState().setPlayerKind(1, "human");
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    pressedOnSecond = new Set([3]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.attack).toEqual([0]);
    pressed = new Set([2]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.attack).toEqual([2]);
  });

  it("sets the right stick, and resets to the defaults", () => {
    render(<PadOptions />);
    fireEvent.change(screen.getByRole("combobox", { name: "P1 right stick" }), { target: { value: "special" } });
    expect(useMatchConfig.getState().players[0].pad.rightStick).toBe("special");
    fireEvent.click(screen.getByRole("button", { name: "P1 reset gamepad" }));
    expect(useMatchConfig.getState().players[0].pad).toEqual(DEFAULT_PAD_SETTINGS);
  });

  it("says so when the browser has no gamepad API", () => {
    Reflect.deleteProperty(navigator, "getGamepads");
    render(<PadOptions />);
    expect(screen.getByText(/no gamepad support/i)).toBeInTheDocument();
  });

  /** R-T21b: the capture never makes settings the reload would refuse. */
  it("refuses a button numbered past what the settings may hold, and takes the next one in range", () => {
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    pressed = new Set([PAD_BUTTON_LIMIT]);
    poll();
    pressed = new Set([PAD_BUTTON_LIMIT, PAD_BUTTON_LIMIT + 7]);
    poll();
    expect(padOf(0).buttons.attack).toEqual([0]);
    pressed = new Set([PAD_BUTTON_LIMIT, PAD_BUTTON_LIMIT + 7, PAD_BUTTON_LIMIT - 1]);
    poll();
    expect(padOf(0).buttons.attack).toEqual([PAD_BUTTON_LIMIT - 1]);
  });

  /** Review Minor 4: the screen seats up to four humans. */
  it("says which pad plays whom for every human, not two", () => {
    render(<PadOptions />);
    expect(screen.getByText(/the first pad connected plays as the first human, and each next pad as the next human/i)).toBeInTheDocument();
  });

  it("offers nothing for a CPU", () => {
    render(<PadOptions />);
    expect(screen.queryByRole("button", { name: /^P2 / })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "P2 right stick" })).toBeNull();
  });
});

/**
 * Item 3 (drift note): the match seats pads by their place in connection
 * order, the connected pads sorted by `Gamepad.index` (`padPortMap`), never by
 * the browser's slot number, so the capture listens the same way.
 */
describe("PadOptions listens by connection order", () => {
  it("hears a lone pad in the browser's second slot as P1's", () => {
    slots = () => [null, fakePad(1)];
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    pressedOnSecond = new Set([3]);
    poll();
    expect(padOf(0).buttons.attack).toEqual([3]);
  });

  it("hears the second connected pad as the second human's", () => {
    useMatchConfig.getState().setPlayerKind(1, "human");
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P2 attack: A" }));
    pressed = new Set([3]);
    poll();
    expect(padOf(1).buttons.attack).toEqual([0]);
    pressedOnSecond = new Set([2]);
    poll();
    expect(padOf(1).buttons.attack).toEqual([2]);
    expect(padOf(0)).toEqual(DEFAULT_PAD_SETTINGS);
  });

  it("skips a disconnected pad when counting", () => {
    slots = () => [{ ...fakePad(0), connected: false } as Gamepad, fakePad(1)];
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    pressedOnSecond = new Set([3]);
    poll();
    expect(padOf(0).buttons.attack).toEqual([3]);
  });
});

/**
 * The final wave (seam review I-1): the capture hears the pad that drives the seat in the
 * match (`padIndexForSeat`), a pad that pressed to join included, not the seat's place
 * among the humans.
 */
describe("PadOptions listens to the pad that drives the seat", () => {
  it("hears a joined pad for its seat, and the next unjoined pad for the human after it", () => {
    // P1 and P3 human, P2 a CPU, pads 0-2: pads 0 and 1 drive P1 and P3 by connection
    // order, so pad 2 presses A on the select screen and takes P2.
    slots = () => [fakePad(0), fakePad(1), fakePad(2)];
    const config = useMatchConfig.getState();
    config.addPlayer();
    config.setPlayerKind(1, "cpu");
    config.setPlayerKind(2, "human");
    config.seatPad(2);
    expect(useMatchConfig.getState().players.map((p) => [p.kind, p.joinedPad])).toEqual([
      ["human", null],
      ["human", 2],
      ["human", null],
    ]);
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P2 attack: A" }));
    pressedOnSecond = new Set([3]);
    poll();
    expect(padOf(1).buttons.attack).toEqual([0]);
    pressedOnThird = new Set([2]);
    poll();
    expect(padOf(1).buttons.attack).toEqual([2]);

    pressedOnSecond = new Set();
    pressedOnThird = new Set();
    fireEvent.click(screen.getByRole("button", { name: "P3 attack: A" }));
    pressedOnThird = new Set([3]);
    poll();
    expect(padOf(2).buttons.attack).toEqual([0]);
    pressedOnSecond = new Set([1]);
    poll();
    expect(padOf(2).buttons.attack).toEqual([1]);
    expect(padOf(0)).toEqual(DEFAULT_PAD_SETTINGS);
  });
});

/**
 * Online (ruling R-T20a), this machine owns one port, the one the room gave it
 * (a room of two: the host P1, the guest P2), and only that one has pad options. Every pad on this machine
 * drives it (`/play` maps every pad to the local port), so the capture hears
 * any of them. The change is kept for after the session (`localOptions`), and
 * nothing is sent: the pad is read here, and only the packed frame travels.
 */
describe("PadOptions online (R-T20a)", () => {
  function seated(role: Role, seatPort?: number) {
    const fake = fakeSession();
    fake.seatPort = seatPort;
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => fake.emit({ type: "joined", role }));
    return fake;
  }

  it.each([
    // The host's P1 is pad 0 offline; the guest's P2 would be pad 1. Each presses on the other.
    ["host", "P1", 0, () => (pressedOnSecond = new Set([3]))],
    ["guest", "P2", 1, () => (pressed = new Set([3]))],
  ] as const)("shows the %s only its own port, hears every pad, keeps the change and sends nothing", (role, tag, own, press) => {
    const fake = seated(role);
    render(<PadOptions />);
    expect(screen.getAllByRole("combobox").map((s) => s.getAttribute("aria-label"))).toEqual([`${tag} right stick`]);
    fireEvent.click(screen.getByRole("button", { name: `${tag} attack: A` }));
    press();
    poll();
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    expect(padOf(own)).toEqual(pad);
    expect(padOf(1 - own)).toEqual(DEFAULT_PAD_SETTINGS);
    expect(useMatchConfig.getState().localOptions.pad).toEqual(pad);
    fireEvent.change(screen.getByRole("combobox", { name: `${tag} right stick` }), { target: { value: "off" } });
    expect(padOf(own)).toEqual({ ...pad, rightStick: "off" });
    expect(useMatchConfig.getState().localOptions.pad).toEqual({ ...pad, rightStick: "off" });
    expect(fake.sent).toEqual([]);
    act(() => leaveOnline());
    expect(padOf(0)).toEqual({ ...pad, rightStick: "off" });
  });

  it("resets this machine's own options too", () => {
    seated("guest");
    render(<PadOptions />);
    fireEvent.change(screen.getByRole("combobox", { name: "P2 right stick" }), { target: { value: "special" } });
    expect(useMatchConfig.getState().localOptions.pad.rightStick).toBe("special");
    fireEvent.click(screen.getByRole("button", { name: "P2 reset gamepad" }));
    expect(padOf(1)).toEqual(DEFAULT_PAD_SETTINGS);
    expect(useMatchConfig.getState().localOptions.pad).toEqual(DEFAULT_PAD_SETTINGS);
  });

  /** Plan 7, Phase B: as for the Stick Jump, this machine's port is its match port (here room port 3, match port 2). */
  it("shows only this machine's own seat, at its match port rather than its room seat's", () => {
    const fake = seated("guest", 3);
    act(() => {
      useMatchConfig.getState().configureOnline(4);
      useOnlineStore.getState().patch({ localPort: 2 });
    });
    expect(fake.session.seatPort).toBe(3);
    render(<PadOptions />);
    expect(screen.getAllByRole("combobox").map((s) => s.getAttribute("aria-label"))).toEqual(["P3 right stick"]);
    fireEvent.change(screen.getByRole("combobox", { name: "P3 right stick" }), { target: { value: "off" } });
    expect(useMatchConfig.getState().players.map((p) => p.pad.rightStick)).toEqual([
      DEFAULT_PAD_SETTINGS.rightStick,
      DEFAULT_PAD_SETTINGS.rightStick,
      "off",
      DEFAULT_PAD_SETTINGS.rightStick,
    ]);
    expect(useMatchConfig.getState().localOptions.pad.rightStick).toBe("off");
    expect(fake.sent).toEqual([]);
  });
});
