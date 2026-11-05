import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { localBuild } from "@/game/onlineConfig";
import { useMatchConfig } from "@/lib/matchConfig";
import { beginRoom, bindSession, leaveOnline, seatLeftNotice, useOnlineStore } from "@/lib/onlineStore";
import { setActiveSession } from "@/net/online/session";
import { GUEST_PEER, fakeSession, type FakeSession } from "@/net/online/testing";
import type { PeerInfo, Role } from "@/net/signalProtocol";
import { useRejoinResend } from "./useRejoinResend";

/**
 * Seated and connected as `role` at match port `localPort` (the host's 0 and the guest's 1 in a room of
 * two), with Mario in the host's panel and Fox in the guest's.
 */
function seat(role: Role, localPort = role === "host" ? 0 : 1): FakeSession {
  const fake = fakeSession(role);
  setActiveSession(fake.session);
  const match = useMatchConfig.getState();
  match.configureOnline();
  match.setFighter(0, "mario");
  match.setFighter(1, "fox");
  match.setCostume(1, 4);
  match.setStage("smashville");
  match.setStageForm("omega");
  useOnlineStore.getState().patch({ role, status: "connected", roomCode: "ABCD", localPort });
  return fake;
}

/** The opponent leaves and somebody takes the seat: the store's status path back to `connected`. */
function rejoin() {
  act(() => useOnlineStore.getState().patch({ status: "waiting", notice: seatLeftNotice(1) }));
  act(() => useOnlineStore.getState().patch({ status: "linking", notice: null }));
  act(() => useOnlineStore.getState().patch({ status: "connected" }));
}

beforeEach(() => {
  useMatchConfig.getState().reset();
});

afterEach(() => {
  act(() => leaveOnline());
});

describe("useRejoinResend", () => {
  it("says nothing on arrival: the room opened before anything was picked", () => {
    const { sent } = seat("host");
    renderHook(() => useRejoinResend({ stage: true }));
    expect(sent).toEqual([]);
  });

  it("has the host repeat its pick and its stage, with its rules, when the channel opens again", () => {
    const { sent } = seat("host");
    renderHook(() => useRejoinResend({ stage: true }));
    rejoin();
    expect(sent).toEqual([
      { kind: "pick", fighterId: "mario", costume: 0 },
      { kind: "stage", stageId: "smashville", form: "omega", rules: useMatchConfig.getState().rules },
    ]);
  });

  it("leaves the host's stage out while it is still being chosen", () => {
    const { sent } = seat("host");
    renderHook(() => useRejoinResend({ stage: false }));
    rejoin();
    expect(sent).toEqual([{ kind: "pick", fighterId: "mario", costume: 0 }]);
  });

  it("has the guest repeat only its own pick, from its own port", () => {
    const { sent } = seat("guest");
    renderHook(() => useRejoinResend({ stage: true }));
    rejoin();
    expect(sent).toEqual([{ kind: "pick", fighterId: "fox", costume: 4 }]);
  });

  /** Plan 7, Phase B: a match of up to four seats four ports, and the machine plays the one the room gave it. */
  it("repeats the pick for this machine's own port", () => {
    const { sent } = seat("guest", 3);
    const match = useMatchConfig.getState();
    match.configureOnline(4);
    match.setFighter(1, "marth");
    match.setFighter(3, "kirby");
    match.setCostume(3, 6);
    renderHook(() => useRejoinResend({ stage: true }));
    rejoin();
    expect(sent).toEqual([{ kind: "pick", fighterId: "kirby", costume: 6 }]);
  });

  it("repeats an empty pick as empty", () => {
    const { sent } = seat("guest");
    useMatchConfig.getState().setFighter(1, null);
    renderHook(() => useRejoinResend({ stage: true }));
    rejoin();
    expect(sent).toEqual([{ kind: "pick", fighterId: null, costume: 4 }]);
  });

  it("counts only the way into connected, not changes while connected", () => {
    const { sent } = seat("host");
    renderHook(() => useRejoinResend({ stage: true }));
    act(() => useOnlineStore.getState().patch({ remoteAway: true }));
    act(() => useOnlineStore.getState().patch({ status: "waiting" }));
    expect(sent).toEqual([]);
  });

  it("counts a leave and a rejoin that land between two renders", () => {
    const { sent } = seat("host");
    renderHook(() => useRejoinResend({ stage: false }));
    act(() => {
      useOnlineStore.getState().patch({ status: "waiting" });
      useOnlineStore.getState().patch({ status: "connected" });
    });
    expect(sent).toEqual([{ kind: "pick", fighterId: "mario", costume: 0 }]);
  });

  it("stops listening once the screen is gone", () => {
    const { sent } = seat("host");
    const { unmount } = renderHook(() => useRejoinResend({ stage: true }));
    unmount();
    rejoin();
    expect(sent).toEqual([]);
  });

  it("does nothing offline", () => {
    const { session } = fakeSession("host");
    setActiveSession(session);
    renderHook(() => useRejoinResend({ stage: true }));
    act(() => useOnlineStore.getState().patch({ status: "waiting" }));
    act(() => useOnlineStore.getState().patch({ status: "connected" }));
    expect(session.sendLobby).not.toHaveBeenCalled();
  });
});

/**
 * Plan 7, Phase B, Review Focus 4 (the store's half is in onlineStore.test.ts): a guest of a
 * begun room leaves and somebody takes its match port. The host drops out of `connected` with
 * the seat, and the newcomer's hello is the move back, so the host repeats its pick and its stage
 * for a page that starts empty, each time a seat is refilled, through the room's own events.
 */
describe("useRejoinResend, a begun room's seat emptied and refilled", () => {
  const SECOND_GUEST: PeerInfo = { id: "g2", role: "guest", port: 2 };
  const hello = { kind: "hello", ...localBuild() } as const;

  /** A host on the relay that has pressed Start for itself, the guest at room port 1 and another at port 2. */
  function begunHost(): FakeSession {
    const fake = fakeSession();
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => {
      fake.emit({ type: "joined", role: "host" });
      fake.emit({ type: "route", route: "relay" });
      fake.emit({ type: "link", status: "open" });
      for (const peer of [GUEST_PEER, SECOND_GUEST]) fake.emit({ type: "peer", present: true, peer });
      for (const peer of [GUEST_PEER, SECOND_GUEST]) fake.emit({ type: "lobby", message: hello, from: peer.id });
    });
    expect(useOnlineStore.getState().status).toBe("connected");
    act(() => void beginRoom());
    expect(useOnlineStore.getState()).toMatchObject({ begun: true, status: "connected" });
    const match = useMatchConfig.getState();
    match.setFighter(0, "mario");
    match.setStage("smashville");
    match.setStageForm("omega");
    return fake;
  }

  it("has the host repeat its pick and its stage each time a seat is refilled, and only once the newcomer has said its build", () => {
    const fake = begunHost();
    renderHook(() => useRejoinResend({ stage: true }));
    const repeats = () => fake.sent.filter((m) => m.kind === "pick" || m.kind === "stage");
    const pick = { kind: "pick", fighterId: "mario", costume: 0 };
    const stage = { kind: "stage", stageId: "smashville", form: "omega", rules: useMatchConfig.getState().rules };
    expect(repeats()).toEqual([]);

    /** `leaver`'s port, port 1, goes to `newcomer`. */
    const refill = (leaver: PeerInfo, newcomer: PeerInfo) => {
      act(() => fake.emit({ type: "peer", present: false, peer: leaver }));
      expect(useOnlineStore.getState().status).toBe("linking");
      act(() => fake.emit({ type: "peer", present: true, peer: newcomer }));
      act(() => fake.emit({ type: "lobby", message: hello, from: newcomer.id }));
      expect(useOnlineStore.getState().status).toBe("connected");
    };

    const first: PeerInfo = { id: "n1", role: "guest", port: 1 };
    act(() => fake.emit({ type: "peer", present: false, peer: GUEST_PEER }));
    act(() => fake.emit({ type: "peer", present: true, peer: first }));
    // In, but not yet known to run this build: nothing is repeated to it.
    expect(repeats()).toEqual([]);
    act(() => fake.emit({ type: "lobby", message: hello, from: first.id }));
    expect(useOnlineStore.getState().status).toBe("connected");
    expect(repeats()).toEqual([pick, stage]);

    // The next one gets them too: every move into connected, not only the first.
    refill(first, { id: "n2", role: "guest", port: 1 });
    expect(repeats()).toEqual([pick, stage, pick, stage]);
  });
});
