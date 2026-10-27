import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { routerMock } from "../../../vitest.setup";
import { useMatchConfig } from "@/lib/matchConfig";
import { PEER_LEFT_NOTICE, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { getActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import type { Role, RoomIntent } from "@/net/signalProtocol";
import { OnlineLobby, type OpenSession } from "./OnlineLobby";

type Opened = FakeSession & { readonly code: string; readonly intent: RoomIntent };

function harness() {
  const opened: Opened[] = [];
  const openSession = vi.fn<OpenSession>(async (code, intent) => {
    const fake = Object.assign(fakeSession(), { code, intent });
    opened.push(fake);
    return fake.session;
  });
  const { unmount } = render(<OnlineLobby openSession={openSession} />);
  return { opened, openSession, unmount };
}

/** Every `role="alert"` that ever gets drawn, including one that is gone by the time a test looks. */
function watchAlerts() {
  const seen: string[] = [];
  const note = (node: Node) => {
    if (!(node instanceof Element)) return;
    for (const alert of [node, ...node.querySelectorAll("*")]) {
      if (alert.getAttribute("role") === "alert") seen.push(alert.textContent ?? "");
    }
  };
  const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(note)));
  observer.observe(document.body, { childList: true, subtree: true });
  return { seen, stop: () => observer.disconnect() };
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
    expect(screen.getByRole("alert")).toHaveTextContent("Could not find a free room code. Try again.");
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

  it("joins a code typed with spaces between the letters, as read out", async () => {
    const { opened } = harness();
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Room code"), "A B C D");
      await userEvent.click(screen.getByRole("button", { name: /join room/i }));
    });
    expect(opened[0]).toMatchObject({ code: "ABCD", intent: "join" });
  });

  it("keeps all of a pasted line and explains it, rather than joining a cut-off code", async () => {
    const { openSession } = harness();
    await act(async () => {
      await userEvent.click(screen.getByLabelText("Room code"));
      await userEvent.paste("Room: ABCD");
      await userEvent.click(screen.getByRole("button", { name: /join room/i }));
    });
    expect(screen.getByLabelText("Room code")).toHaveValue("Room: ABCD");
    expect(screen.getByRole("alert")).toHaveTextContent("A room code is 4 letters.");
    expect(openSession).not.toHaveBeenCalled();
  });

  describe("leaving", () => {
    const starts: ReadonlyArray<readonly [Role, () => Promise<void>]> = [
      ["host", create],
      ["guest", () => join("ABCD")],
    ];

    it.each(starts)("abandons the room of a %s who leaves by browser back or a swipe", async (role, start) => {
      const { opened, unmount } = harness();
      await start();
      act(() => opened[0].emit({ type: "joined", role }));
      expect(useMatchConfig.getState().online).toBe(true);

      unmount();

      expect(opened[0].session.close).toHaveBeenCalled();
      expect(getActiveSession()).toBeNull();
      expect(useOnlineStore.getState().status).toBe("idle");
      expect(useMatchConfig.getState().online).toBe(false);
    });

    it("abandons a host whose guest was already on the way in", async () => {
      const { opened, unmount } = harness();
      await create();
      act(() => {
        opened[0].emit({ type: "joined", role: "host" });
        opened[0].emit({ type: "peer", present: true });
      });
      expect(useOnlineStore.getState().status).toBe("linking");

      unmount();

      expect(opened[0].session.close).toHaveBeenCalled();
      expect(useOnlineStore.getState().status).toBe("idle");
    });

    it.each(starts)("keeps the room of a %s once the select screens have it", async (role, start) => {
      const { opened, unmount } = harness();
      await start();
      act(() => {
        opened[0].emit({ type: "joined", role });
        opened[0].emit({ type: "link", status: "open" });
      });
      expect(routerMock.push).toHaveBeenCalledWith(role === "host" ? "/stage" : "/fighters");

      unmount();

      expect(opened[0].session.close).not.toHaveBeenCalled();
      expect(getActiveSession()).toBe(opened[0].session);
      expect(useOnlineStore.getState().status).toBe("connected");
      expect(useMatchConfig.getState().online).toBe(true);
    });

    it("closes a room that opens after the page was left", async () => {
      const late = fakeSession();
      let opens!: (session: typeof late.session) => void;
      const openSession = vi.fn<OpenSession>(
        () =>
          new Promise((resolve) => {
            opens = resolve;
          }),
      );
      const { unmount } = render(<OnlineLobby openSession={openSession} />);
      await create();
      unmount();

      await act(async () => {
        opens(late.session);
      });

      expect(late.session.close).toHaveBeenCalled();
      expect(getActiveSession()).toBeNull();
    });
  });

  describe("what a screen reader is told", () => {
    it("announces each step in one status region that is there from the start", async () => {
      const { opened } = harness();
      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toBeEmptyDOMElement();

      await create();
      expect(status).toHaveTextContent(`Connecting to room ${opened[0].code}…`);

      act(() => opened[0].emit({ type: "joined", role: "host" }));
      expect(status).toHaveTextContent("Read it to the other player. Waiting for them to join…");

      act(() => opened[0].emit({ type: "peer", present: true }));
      expect(status).toHaveTextContent("They are in. Opening a direct connection…");
      expect(screen.getByRole("status")).toBe(status);
    });

    it("tells a guest the direct connection is opening, without saying someone is in", async () => {
      const { opened } = harness();
      await join("ABCD");
      act(() => {
        opened[0].emit({ type: "joined", role: "guest" });
        opened[0].emit({ type: "peer", present: true });
      });
      expect(screen.getByRole("status")).toHaveTextContent(/^Opening a direct connection…$/);
    });

    it("moves focus to the room code once there is one, and spells it out", async () => {
      const { opened } = harness();
      await create();
      act(() => opened[0].emit({ type: "joined", role: "host" }));

      expect(screen.getByTestId("room-code-panel")).toHaveFocus();
      expect(screen.getByTestId("room-code")).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByText(opened[0].code.split("").join(" "))).toBeInTheDocument();
    });

    it("puts the cursor back in the box, marked invalid and tied to the reason, after a code that will not do", async () => {
      const { openSession } = harness();
      await join("abod");

      const input = screen.getByLabelText("Room code");
      expect(input).toHaveFocus();
      expect(input).toBeInvalid();
      expect(input).toHaveAccessibleDescription(/never use I, O, 1 or 0/);
      expect(openSession).not.toHaveBeenCalled();
    });

    it("does the same when the room turns the code away", async () => {
      const { opened } = harness();
      await join("ABCD");
      act(() => opened[0].emit({ type: "error", reason: "full" }));

      const input = screen.getByLabelText("Room code");
      expect(input).toHaveFocus();
      expect(input).toBeInvalid();
      expect(input).toHaveAccessibleDescription("Room ABCD already has two players.");
    });

    it("does not call the code wrong when a room it made could not open", async () => {
      const { opened } = harness();
      await create();
      act(() => opened[0].emit({ type: "error", reason: "unreachable" }));

      const input = screen.getByLabelText("Room code");
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(input).not.toHaveFocus();
      expect(input).not.toBeInvalid();
    });
  });

  describe("errors that are not the player's to see", () => {
    it("does not draw an error left over from an earlier visit, even for the first frame", async () => {
      useOnlineStore.getState().patch({ status: "error", errorReason: "full", error: "Room ABCD already has two players." });
      // The mount effect resets the store; this looks at the screen at that moment, before React redraws it.
      let drawnAtReset: string | null = null;
      const unsubscribe = useOnlineStore.subscribe(() => {
        drawnAtReset ??= screen.queryByRole("alert")?.textContent ?? "";
      });
      harness();
      unsubscribe();

      expect(drawnAtReset).toBe("");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("does not draw the refusal while it quietly makes another code", async () => {
      const alerts = watchAlerts();
      const { opened } = harness();
      await create();
      await act(async () => {
        opened[0].emit({ type: "error", reason: "taken" });
      });
      await act(async () => {
        opened[1].emit({ type: "error", reason: "taken" });
      });
      alerts.stop();

      expect(opened).toHaveLength(3);
      expect(alerts.seen).toEqual([]);
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("says what the host sees once the guest is in, in the status line", async () => {
    const { opened } = harness();
    await create();
    act(() => {
      opened[0].emit({ type: "joined", role: "host" });
      opened[0].emit({ type: "peer", present: true });
    });
    expect(screen.getByTestId("room-code")).toHaveTextContent(opened[0].code);
    expect(screen.getByRole("status")).toHaveTextContent("They are in. Opening a direct connection…");
  });
});
