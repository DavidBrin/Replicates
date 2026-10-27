import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useMatchConfig } from "@/lib/matchConfig";
import { PEER_LEFT_NOTICE, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { setActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import type { Role } from "@/net/signalProtocol";
import { useRejoinResend } from "./useRejoinResend";

/** Seated and connected as `role`, with Mario in the host's panel and Fox in the guest's. */
function seat(role: Role): FakeSession {
  const fake = fakeSession(role);
  setActiveSession(fake.session);
  const match = useMatchConfig.getState();
  match.configureOnline();
  match.setFighter(0, "mario");
  match.setFighter(1, "fox");
  match.setCostume(1, 4);
  match.setStage("smashville");
  match.setStageForm("omega");
  useOnlineStore.getState().patch({ role, status: "connected", roomCode: "ABCD" });
  return fake;
}

/** The opponent leaves and somebody takes the seat: the store's status path back to `connected`. */
function rejoin() {
  act(() => useOnlineStore.getState().patch({ status: "waiting", notice: PEER_LEFT_NOTICE }));
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

  it("has the host repeat its pick and its stage when the channel opens again", () => {
    const { sent } = seat("host");
    renderHook(() => useRejoinResend({ stage: true }));
    rejoin();
    expect(sent).toEqual([
      { kind: "pick", fighterId: "mario", costume: 0 },
      { kind: "stage", stageId: "smashville", form: "omega" },
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
