import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import { DEFAULT_PAD_SETTINGS } from "@/input/gamepad";
import { controlsOf, useMatchConfig } from "@/lib/matchConfig";
import { bindSession, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { setActiveSession } from "@/net/online/session";
import { fakeSession } from "@/net/online/testing";
import type { Role } from "@/net/signalProtocol";
import { PlayerOptions } from "./PlayerOptions";

beforeEach(() => {
  useMatchConfig.getState().reset();
});

afterEach(() => {
  act(() => leaveOnline());
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

  it("offers a switch for every human port offline", () => {
    const config = useMatchConfig.getState();
    config.addPlayer();
    config.setPlayerKind(1, "human");
    config.setPlayerKind(2, "human");
    render(<PlayerOptions />);
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual(["P1 stick jump", "P2 stick jump", "P3 stick jump"]);
    fireEvent.click(screen.getByRole("switch", { name: "P3 stick jump" }));
    expect(useMatchConfig.getState().players.map((p) => p.stickJump)).toEqual([true, true, false]);
  });
});

/**
 * Plan 5, Task 20 fix round 1 (ruling R-T20a): online, each machine owns one
 * port's Stick Jump, the one the room gave it (a room of two: the host P1, the
 * guest P2). The other ports' are the other peers', set by their picks, so they
 * have no switch here.
 */
describe("PlayerOptions online (R-T20a)", () => {
  function seated(role: Role, seatPort?: number) {
    const fake = fakeSession();
    fake.seatPort = seatPort;
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => fake.emit({ type: "joined", role }));
    return fake;
  }

  it.each([
    ["host", "P1", 0],
    ["guest", "P2", 1],
  ] as const)("shows the %s only its own port's switch, and a change to it goes out in its pick", (role, tag, own) => {
    const fake = seated(role);
    render(<PlayerOptions />);
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual([`${tag} stick jump`]);
    fireEvent.click(screen.getByRole("switch", { name: `${tag} stick jump` }));
    expect(useMatchConfig.getState().players[own].stickJump).toBe(false);
    expect(useMatchConfig.getState().players[1 - own].stickJump).toBe(true);
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: false, pad: DEFAULT_PAD_SETTINGS });
    expect(fake.sent).toEqual([{ kind: "pick", fighterId: null, costume: own, stickJump: false }]);
  });

  /**
   * Plan 7, Phase B: a match of four seats four ports, and the Start says which is this machine's:
   * its match port, which can differ from its room seat's (here room port 3, match port 2).
   */
  it("shows only this machine's own seat, at its match port rather than its room seat's", () => {
    const fake = seated("guest", 3);
    act(() => {
      useMatchConfig.getState().configureOnline(4);
      useOnlineStore.getState().patch({ localPort: 2 });
    });
    expect(fake.session.seatPort).toBe(3);
    render(<PlayerOptions />);
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual(["P3 stick jump"]);
    fireEvent.click(screen.getByRole("switch", { name: "P3 stick jump" }));
    expect(useMatchConfig.getState().players.map((p) => p.stickJump)).toEqual([true, true, false, true]);
    expect(fake.sent).toEqual([{ kind: "pick", fighterId: null, costume: 2, stickJump: false }]);
  });
});
