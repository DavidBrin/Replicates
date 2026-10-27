import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { PEER_LEFT_NOTICE, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { getActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import type { RoomIntent } from "@/net/signalProtocol";
import { OnlineLobby, type OpenSession } from "./OnlineLobby";

type Opened = FakeSession & { readonly code: string; readonly intent: RoomIntent };

function harness() {
  const opened: Opened[] = [];
  const openSession = vi.fn<OpenSession>(async (code, intent) => {
    const fake = Object.assign(fakeSession(), { code, intent });
    opened.push(fake);
    return fake.session;
  });
  render(<OnlineLobby openSession={openSession} />);
  return { opened, openSession };
}

async function create() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /create room/i }));
  });
}

async function join(code: string) {
  fireEvent.change(screen.getByLabelText("Room code"), { target: { value: code } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /join room/i }));
  });
}

beforeEach(() => {
  leaveOnline();
  routerMock.push.mockClear();
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("OnlineLobby", () => {
  it("creates a room and shows its code once the room makes us host", async () => {
    const { opened } = harness();
    await create();
    expect(opened[0].intent).toBe("create");
    act(() => opened[0].emit({ type: "joined", role: "host" }));
    expect(screen.getByTestId("room-code")).toHaveTextContent(opened[0].code);
  });

  it("joins a code typed in lowercase with a dash", async () => {
    const { opened } = harness();
    await join("qr-st");
    expect(opened[0]).toMatchObject({ code: "QRST", intent: "join" });
  });

  it("explains a code with an O instead of joining another room", async () => {
    const { openSession } = harness();
    await join("abod");
    expect(screen.getByRole("alert")).toHaveTextContent(/never use I, O, 1 or 0/);
    expect(openSession).not.toHaveBeenCalled();
  });

  it("tells a third player the room is full, and lets them try another code", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => opened[0].emit({ type: "error", reason: "full" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Room ABCD already has two players.");
    expect(screen.getByRole("button", { name: /join room/i })).toBeInTheDocument();
  });

  it("makes a new code when the first one is already taken", async () => {
    const { opened } = harness();
    await create();
    await act(async () => {
      opened[0].emit({ type: "error", reason: "taken" });
    });
    expect(opened).toHaveLength(2);
    expect(opened[1].intent).toBe("create");
    expect(opened[0].session.close).toHaveBeenCalled();
  });

  it("stops making codes when three in a row are taken, and says so", async () => {
    const { opened } = harness();
    await create();
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        opened[i]?.emit({ type: "error", reason: "taken" });
      });
    }
    expect(opened).toHaveLength(3);
    expect(screen.getByRole("alert")).toHaveTextContent(/already in use/);
    expect(screen.getByRole("button", { name: /create room/i })).toBeInTheDocument();
  });

  it("sends the host to the stage select once the direct link is open", async () => {
    const { opened } = harness();
    await create();
    act(() => {
      opened[0].emit({ type: "joined", role: "host" });
      opened[0].emit({ type: "peer", present: true });
      opened[0].emit({ type: "link", status: "open" });
    });
    expect(routerMock.push).toHaveBeenCalledWith("/stage");
  });

  it("sends the guest to the character select once the direct link is open", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => {
      opened[0].emit({ type: "joined", role: "guest" });
      opened[0].emit({ type: "link", status: "open" });
    });
    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
  });

  it("does not bounce back into a room left open earlier", async () => {
    useOnlineStore.getState().patch({ status: "connected", role: "host", roomCode: "ABCD" });
    harness();
    await act(async () => {});
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(screen.getByRole("button", { name: /create room/i })).toBeInTheDocument();
  });

  it("does not make a room on arrival because of an old taken error", async () => {
    useOnlineStore.getState().patch({ status: "error", errorReason: "taken", error: "Room ABCD is already in use." });
    const { openSession } = harness();
    await act(async () => {});
    expect(openSession).not.toHaveBeenCalled();
    expect(useOnlineStore.getState().status).toBe("idle");
  });

  it("says when there is no Worker to talk to", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => opened[0].emit({ type: "error", reason: "unreachable" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/pnpm preview/);
  });

  it("says so when the session cannot even be opened", async () => {
    const openSession = vi.fn<OpenSession>(async () => {
      throw new Error("offline");
    });
    render(<OnlineLobby openSession={openSession} />);
    await join("ABCD");
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not reach the online service/);
    expect(useOnlineStore.getState().errorReason).toBe("unreachable");
  });

  it("leaves the room from the back button", async () => {
    const { opened } = harness();
    await join("ABCD");
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));
    expect(opened[0].session.close).toHaveBeenCalled();
    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });

  it.each([
    ["create", create],
    ["join", () => join("ABCD")],
  ])("starts a new room clean when it is a %s: no notice, nobody away", async (_intent, start) => {
    harness();
    useOnlineStore.getState().patch({ notice: PEER_LEFT_NOTICE, remoteAway: true });
    await start();
    expect(useOnlineStore.getState()).toMatchObject({ status: "connecting", notice: null, remoteAway: false });
  });

  it.each([
    ["/online", false],
    ["/online?ice=relay", true],
  ])("opening a room from %s asks for the TURN relay: %s", async (url, forceRelay) => {
    window.history.replaceState({}, "", url);
    const { openSession } = harness();
    await create();
    expect(openSession).toHaveBeenCalledWith(expect.any(String), "create", { forceRelay });
  });

  it("closes a room that opens after the player has already left, instead of adopting it", async () => {
    const late = fakeSession();
    let opens!: (session: typeof late.session) => void;
    const openSession = vi.fn<OpenSession>(
      () =>
        new Promise((resolve) => {
          opens = resolve;
        }),
    );
    render(<OnlineLobby openSession={openSession} />);
    await create();
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));

    await act(async () => {
      opens(late.session);
    });

    expect(late.session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
  });

  it("does not report a failure for a room the player has already left", async () => {
    let fails!: (reason: Error) => void;
    const openSession = vi.fn<OpenSession>(
      () =>
        new Promise((_resolve, reject) => {
          fails = reject;
        }),
    );
    render(<OnlineLobby openSession={openSession} />);
    await create();
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));

    await act(async () => {
      fails(new Error("offline"));
    });

    expect(useOnlineStore.getState()).toMatchObject({ status: "idle", error: null });
  });
});
