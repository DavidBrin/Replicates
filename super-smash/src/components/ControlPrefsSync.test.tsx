import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { schemeForMenuId } from "@/game/bootstrap";
import { DEFAULT_PAD_SETTINGS, PAD_BUTTON_LIMIT, rebind } from "@/input/gamepad";
import { CONTROL_PREFS_KEY } from "@/lib/controlPrefs";
import { CONTROL_SCHEMES, DEFAULT_BINDINGS, useMatchConfig } from "@/lib/matchConfig";
import { bindSession, leaveOnline, setOwnPad, setOwnStickJump } from "@/lib/onlineStore";
import { memoryStorage } from "@/lib/testing/memoryStorage";
import { setActiveSession } from "@/net/online/session";
import { HOST_PEER, fakeSession, otherPeer } from "@/net/online/testing";
import type { Role } from "@/net/signalProtocol";
import { ControlPrefsSync } from "./ControlPrefsSync";

let localStorage: Storage;
beforeEach(() => {
  localStorage = memoryStorage();
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });
  useMatchConfig.getState().reset();
});
afterEach(() => {
  act(() => leaveOnline());
  Reflect.deleteProperty(window, "localStorage");
});

describe("ControlPrefsSync (Plan 5)", () => {
  it("brings back a saved Stick Jump and pad, and saves a change", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad } }));
    render(<ControlPrefsSync />);
    expect(useMatchConfig.getState().players[0].stickJump).toBe(false);
    expect(useMatchConfig.getState().players[0].pad).toEqual(pad);
    act(() => useMatchConfig.getState().setStickJump(0, true));
    expect(JSON.parse(localStorage.getItem(CONTROL_PREFS_KEY)!)[0].stickJump).toBe(true);
  });

  it("carries this machine's pad and Stick Jump into an online match", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "jump", 0);
    useMatchConfig.getState().setPad(0, pad);
    useMatchConfig.getState().setStickJump(0, false);
    useMatchConfig.getState().configureOnline();
    const [p0, p1] = useMatchConfig.getState().players;
    expect([p0.pad, p0.stickJump]).toEqual([pad, false]);
    expect([p1.pad, p1.stickJump]).toEqual([pad, false]);
  });

  /** R-T21b: a bad pad takes the default pad, and the port keeps its Stick Jump. */
  it("keeps a saved Stick Jump when the pad saved beside it is bad", () => {
    const bad = { ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, grab: [PAD_BUTTON_LIMIT + 3] } };
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad: bad } }));
    render(<ControlPrefsSync />);
    expect(useMatchConfig.getState().players[0].stickJump).toBe(false);
    expect(useMatchConfig.getState().players[0].pad).toEqual(DEFAULT_PAD_SETTINGS);
  });

  /**
   * Plan 5, Task 21b (item 6): what was saved before the Tilt key existed. The
   * keyboard's keys are never saved, only Stick Jump and the pad, so such
   * prefs name no key at all: they load as before, and every preset has its
   * default Tilt key, never an empty one. Keys stored beside them by any build
   * are not read.
   */
  it("loads prefs saved before the Tilt key, and every preset keeps its default Tilt key", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    const stray = { arrows: { ...DEFAULT_BINDINGS.arrows, tilt: "" }, tilt: "" };
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad, bindings: stray }, 1: { stickJump: false } }));
    render(<ControlPrefsSync />);
    const { players, bindings } = useMatchConfig.getState();
    expect(players.map((p) => [p.stickJump, p.pad])).toEqual([
      [false, pad],
      [false, DEFAULT_PAD_SETTINGS],
    ]);
    expect(CONTROL_SCHEMES.map((id) => bindings[id].tilt)).toEqual(["KeyV", "KeyC", "KeyN"]);
    expect(bindings).toEqual(DEFAULT_BINDINGS);
    // And the match P1 starts plays it.
    expect(schemeForMenuId(players[0].scheme, bindings[players[0].scheme]).bindings.tilt).toBe("KeyV");
  });

  it("starts from the defaults when nothing valid is saved", () => {
    localStorage.setItem(CONTROL_PREFS_KEY, "garbage");
    render(<ControlPrefsSync />);
    expect(useMatchConfig.getState().players[0].pad).toEqual(DEFAULT_PAD_SETTINGS);
    expect(useMatchConfig.getState().players[0].stickJump).toBe(true);
  });
});

/**
 * Ruling P5-R26: what is saved is what a player chose on `/controls`, so only
 * its setters save. Every other change to the seats (an online session's,
 * the other player's, adding or dropping a player) leaves the stored options
 * exactly as they were.
 */
describe("only /controls saves (P5-R26)", () => {
  /** Every port's saved options differ from the defaults, so any write of a seat shows. */
  const SAVED = {
    0: { stickJump: false, pad: rebind(DEFAULT_PAD_SETTINGS, "attack", 3) },
    1: { stickJump: false, pad: { ...DEFAULT_PAD_SETTINGS, rightStick: "special" as const } },
    2: { stickJump: false, pad: rebind(DEFAULT_PAD_SETTINGS, "grab", 7) },
    3: { stickJump: false, pad: { ...DEFAULT_PAD_SETTINGS, rightStick: "off" as const } },
  };
  const STORED = JSON.stringify(SAVED);

  let writes: MockInstance<Storage["setItem"]>;
  beforeEach(() => {
    localStorage.setItem(CONTROL_PREFS_KEY, STORED);
    writes = vi.spyOn(localStorage, "setItem");
    render(<ControlPrefsSync />);
  });

  function expectUntouched(): void {
    expect(writes).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONTROL_PREFS_KEY)).toBe(STORED);
  }

  const stored = () => JSON.parse(localStorage.getItem(CONTROL_PREFS_KEY)!) as Record<string, unknown>;

  /** A session seated as `role` and bound, as the lobby leaves it. */
  function seated(role: Role) {
    const fake = fakeSession();
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => {
      fake.emit({ type: "joined", role });
      fake.emit({ type: "peer", present: true, peer: otherPeer(role) });
    });
    return fake;
  }

  it("loads every seat, and this machine's own options, without saving", () => {
    expect(useMatchConfig.getState().players.map((p) => ({ stickJump: p.stickJump, pad: p.pad }))).toEqual([SAVED[0], SAVED[1]]);
    expect(useMatchConfig.getState().localOptions).toEqual(SAVED[0]);
    expectUntouched();
  });

  it("never saves addPlayer's seat, which takes that port's own saved options", () => {
    act(() => useMatchConfig.getState().addPlayer());
    act(() => useMatchConfig.getState().addPlayer());
    expect(useMatchConfig.getState().players.map((p) => p.pad)).toEqual([SAVED[0].pad, SAVED[1].pad, SAVED[2].pad, SAVED[3].pad]);
    expectUntouched();
  });

  it("never saves removePlayer's drop: the dropped port's options stay saved", () => {
    act(() => useMatchConfig.getState().addPlayer());
    act(() => useMatchConfig.getState().removePlayer());
    expect(useMatchConfig.getState().players).toHaveLength(2);
    expectUntouched();
    // And they come back with the seat.
    act(() => useMatchConfig.getState().addPlayer());
    expect(useMatchConfig.getState().players[2].pad).toEqual(SAVED[2].pad);
  });

  it("never saves configureOnline's copy of this machine's options onto both seats", () => {
    seated("host");
    expect(useMatchConfig.getState().players.map((p) => p.pad)).toEqual([SAVED[0].pad, SAVED[0].pad]);
    expectUntouched();
  });

  it.each(["host", "guest"] as const)("never saves the other player's pick, as the %s", (role) => {
    const fake = seated(role);
    const theirs = role === "host" ? 1 : 0;
    // Theirs is on (a pick without `stickJump`); every saved port says off.
    act(() => fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: otherPeer(role).id }));
    expect(useMatchConfig.getState().players[theirs].stickJump).toBe(true);
    expectUntouched();
  });

  it("never saves leaveOnline's reset, which seats this machine's options and the next port's saved ones", () => {
    const fake = seated("guest");
    act(() => fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: HOST_PEER.id }));
    act(() => leaveOnline());
    expect(useMatchConfig.getState().online).toBe(false);
    expect(useMatchConfig.getState().players.map((p) => ({ stickJump: p.stickJump, pad: p.pad }))).toEqual([SAVED[0], SAVED[1]]);
    expectUntouched();
  });

  it("saves an offline change to its own port alone, keeping the ports with no seat", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "special", 4);
    act(() => useMatchConfig.getState().setPad(1, pad));
    expect(stored()).toEqual({ ...SAVED, 1: { stickJump: false, pad } });
    act(() => useMatchConfig.getState().setStickJump(0, true));
    expect(stored()).toEqual({ ...SAVED, 0: { stickJump: true, pad: SAVED[0].pad }, 1: { stickJump: false, pad } });
  });

  /**
   * R-T20a: online, `/controls` edits this machine's own port. The edit is
   * kept under port 0, where leaving the session seats this machine's
   * options again, so a reload brings back what leaving did.
   */
  it.each(["host", "guest"] as const)("saves this machine's own edits during a session, as the %s, under port 0", (role) => {
    seated(role);
    act(() => void setOwnStickJump(true));
    act(() => void setOwnPad(DEFAULT_PAD_SETTINGS));
    expect(stored()).toEqual({ ...SAVED, 0: { stickJump: true, pad: DEFAULT_PAD_SETTINGS } });
    act(() => leaveOnline());
    expect(useMatchConfig.getState().players[0]).toMatchObject({ stickJump: true, pad: DEFAULT_PAD_SETTINGS });
  });
});

/**
 * R-T21c (accepted, and pinned here): online, this machine's options are port
 * 0's, the seat it comes back to. With its first human on port 1 offline (port
 * 0 a CPU) and no online edit, leaving seats port 1's options on port 0, while
 * a reload seats port 0's own saved entry. Neither writes anything.
 */
describe("leaving versus reloading, with the first human off port 0 (R-T21c)", () => {
  const SAVED = {
    0: { stickJump: false, pad: rebind(DEFAULT_PAD_SETTINGS, "attack", 3) },
    1: { stickJump: false, pad: { ...DEFAULT_PAD_SETTINGS, rightStick: "special" as const } },
  };
  const STORED = JSON.stringify(SAVED);
  const seat = (port: number) => {
    const p = useMatchConfig.getState().players[port];
    return { stickJump: p.stickJump, pad: p.pad };
  };

  it("seats port 1's options on port 0 on leaving, and port 0's own on a reload, writing neither", () => {
    localStorage.setItem(CONTROL_PREFS_KEY, STORED);
    const writes = vi.spyOn(localStorage, "setItem");
    render(<ControlPrefsSync />);
    act(() => useMatchConfig.getState().setPlayerKind(0, "cpu"));
    act(() => useMatchConfig.getState().setPlayerKind(1, "human"));
    const fake = fakeSession();
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => fake.emit({ type: "joined", role: "guest" }));
    act(() => leaveOnline());
    expect(useMatchConfig.getState().players[0].kind).toBe("human");
    expect(seat(0)).toEqual(SAVED[1]);
    // A reload: a fresh store, loaded from what is saved.
    cleanup();
    useMatchConfig.getState().reset();
    render(<ControlPrefsSync />);
    expect(seat(0)).toEqual(SAVED[0]);
    expect(writes).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONTROL_PREFS_KEY)).toBe(STORED);
  });
});

describe("loading during a session", () => {
  it("leaves the session's seats alone: this machine's options wait for leaving", () => {
    useMatchConfig.getState().configureOnline();
    useMatchConfig.getState().setPeerStickJump(1, false);
    const seats = useMatchConfig.getState().players;
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    useMatchConfig.getState().applyControlPrefs({ 0: { stickJump: false, pad }, 1: { stickJump: true, pad } });
    expect(useMatchConfig.getState().players).toBe(seats);
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: false, pad });
    useMatchConfig.getState().leaveOnline();
    expect(useMatchConfig.getState().players.map((p) => ({ stickJump: p.stickJump, pad: p.pad }))).toEqual([
      { stickJump: false, pad },
      { stickJump: true, pad },
    ]);
  });
});
