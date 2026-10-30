import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { routerMock } from "../../../vitest.setup";
import { localBuild } from "@/game/onlineConfig";
import { useMatchConfig } from "@/lib/matchConfig";
import { PEER_LEFT_NOTICE, leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { getActiveSession } from "@/net/online/session";
import { NO_WEBGL, webglCheck } from "@/render3d/webgl";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import type { Role, RoomIntent } from "@/net/signalProtocol";
import { OnlineLobby, type OpenSession } from "./OnlineLobby";

/**
 * The bake, stood in for (Plan 4, ruling R2): the lobby installs it before it
 * opens a room. By default it is in at once; a test can hold it back or fail it.
 */
const bake = vi.hoisted(() => ({ next: null as Promise<unknown> | null, calls: 0 }));
vi.mock("@/game/bake", () => ({
  ensureBakeInstalled: () => {
    bake.calls += 1;
    return bake.next ?? Promise.resolve({});
  },
}));

type Opened = FakeSession & { readonly code: string; readonly intent: RoomIntent };

function harness() {
  const opened: Opened[] = [];
  const openSession = vi.fn<OpenSession>(async (code, intent) => {
    const fake = Object.assign(fakeSession(), { code, intent });
    opened.push(fake);
    return fake.session;
  });
  // A WebGL check of its own, as a fresh page has: the real probe, on the stubbed `getContext` below.
  const { unmount } = render(<OnlineLobby openSession={openSession} canDrawWorld={webglCheck()} />);
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

/**
 * WebGL, stood in for: the lobby asks a scratch canvas for a WebGL 2 context
 * before it opens a room (jsdom has none). By default there is one; a test can
 * take it away.
 */
let getContext: MockInstance;
const WEBGL2 = { getExtension: () => ({ loseContext: () => {} }) };

beforeEach(() => {
  leaveOnline();
  routerMock.push.mockClear();
  bake.next = null;
  bake.calls = 0;
  getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => (kind === "webgl2" ? WEBGL2 : null)) as never);
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
  getContext.mockRestore();
});

describe("OnlineLobby, WebGL before a room (part 1 re-review)", () => {
  // A browser that cannot draw the match must not open a room: the other player would wait on a match that never
  // starts until their link monitor gives up (about 10 s). It is refused here, in the match's own sentence.
  it("refuses to create a room in a browser that cannot draw the 3D world, before the bake or a room is asked for", async () => {
    getContext.mockReturnValue(null);
    const { openSession } = harness();
    await act(async () => {});
    const asked = bake.calls;
    await create();
    expect(screen.getByRole("alert")).toHaveTextContent(NO_WEBGL);
    expect(openSession).not.toHaveBeenCalled();
    expect(bake.calls).toBe(asked);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(useOnlineStore.getState().status).toBe("error");
    expect(screen.getByRole("button", { name: /create room/i })).toBeInTheDocument();
  });

  it("refuses to join one too", async () => {
    getContext.mockReturnValue(null);
    const { openSession } = harness();
    await join("QRST");
    expect(screen.getByRole("alert")).toHaveTextContent(NO_WEBGL);
    expect(openSession).not.toHaveBeenCalled();
  });

  // codex confirm pass, P3: each check used to make a WebGL context, and without WEBGL_lose_context none was
  // given back, so repeated clicks used up the page's few. The page asks once and keeps the answer.
  it("asks the browser once for the page, however many times Create and Join are pressed", async () => {
    getContext.mockReturnValue(null);
    const { openSession } = harness();
    await create();
    await create();
    await join("QRST");
    expect(screen.getByRole("alert")).toHaveTextContent(NO_WEBGL);
    expect(openSession).not.toHaveBeenCalled();
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("opens a room on every try once the page's one check said yes, without asking again", async () => {
    const { openSession } = harness();
    await create();
    // Back out of the room (the lobby stays on screen here), then make another.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /back to the main menu/i }));
    });
    await create();
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("asks the page's own check when none is given", async () => {
    // The only render here without `canDrawWorld`: the module's check, which then keeps its answer for the file.
    getContext.mockReturnValue(null);
    render(<OnlineLobby openSession={vi.fn<OpenSession>()} />);
    await create();
    expect(screen.getByRole("alert")).toHaveTextContent(NO_WEBGL);
  });
});

describe("OnlineLobby, the bake first (Plan 4)", () => {
  it("starts loading the bake as the screen opens", async () => {
    harness();
    await act(async () => {});
    expect(bake.calls).toBeGreaterThan(0);
  });

  /**
   * Installing the bake changes this build's engine fingerprint. The first
   * `hello` a session says must carry the bake's, or the other side refuses
   * this build for good, so no room opens until it is in.
   */
  it("opens the room only once the bake is installed, showing it is connecting meanwhile", async () => {
    let install!: () => void;
    bake.next = new Promise<void>((resolve) => (install = resolve));
    const { openSession } = harness();
    await create();
    expect(useOnlineStore.getState().status).toBe("connecting");
    expect(screen.getByRole("status")).toHaveTextContent(/Connecting to room/);
    expect(openSession).not.toHaveBeenCalled();
    await act(async () => install());
    expect(openSession).toHaveBeenCalledOnce();
  });

  it("says the bake's own sentence when it cannot load, and opens no room", async () => {
    const sentence = "The fighters' animation data does not match this version of the game. Reload the page.";
    bake.next = Promise.reject(new Error(sentence));
    const { openSession } = harness();
    await join("ABCD");
    expect(openSession).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(useOnlineStore.getState().status).toBe("error");
    // The player can try again.
    expect(screen.getByRole("button", { name: /join room/i })).toBeInTheDocument();
  });

  /**
   * codex P1-1: a bake that stalls or crawls is given up on (`BAKE_IDLE_TIMEOUT_MS`,
   * `BAKE_TOTAL_TIMEOUT_MS`) in a sentence that says trying again may help, and
   * trying again works: the next connect asks for the bake afresh, and opens the
   * room once it is in.
   */
  it("says the bake stalled or was too slow, and a second try opens the room once it is in", async () => {
    const sentence = "The fighters' animation data stalled, or was too slow to finish downloading. Check your connection and try again.";
    bake.next = Promise.reject(new Error(sentence));
    const { openSession } = harness();
    await create();
    expect(openSession).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(sentence);
    expect(useOnlineStore.getState().status).toBe("error");
    const asked = bake.calls;

    bake.next = null;
    await create();
    expect(bake.calls).toBe(asked + 1);
    expect(openSession).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens nothing for a player who left while the bake loaded", async () => {
    let install!: () => void;
    bake.next = new Promise<void>((resolve) => (install = resolve));
    const { openSession } = harness();
    await create();
    fireEvent.click(screen.getByRole("button", { name: "Back to the main menu" }));
    await act(async () => install());
    expect(openSession).not.toHaveBeenCalled();
  });
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

  it("sends the host to the stage select once the direct link is open and the guest runs this build", async () => {
    const { opened } = harness();
    await create();
    act(() => {
      opened[0].emit({ type: "joined", role: "host" });
      opened[0].emit({ type: "peer", present: true });
      opened[0].emit({ type: "link", status: "open" });
    });
    expect(routerMock.push).not.toHaveBeenCalled();
    act(() => opened[0].emit({ type: "lobby", message: { kind: "hello", ...localBuild() } }));
    expect(routerMock.push).toHaveBeenCalledWith("/stage");
  });

  it("sends the guest to the character select once the direct link is open and the host runs this build", async () => {
    const { opened } = harness();
    await join("ABCD");
    act(() => {
      opened[0].emit({ type: "joined", role: "guest" });
      opened[0].emit({ type: "lobby", message: { kind: "hello", ...localBuild() } });
      opened[0].emit({ type: "link", status: "open" });
    });
    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
  });

  it("stays in the lobby, and says the versions differ, when the other player runs another build", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { opened } = harness();
    await join("ABCD");
    await act(async () => {
      opened[0].emit({ type: "joined", role: "guest" });
      opened[0].emit({ type: "link", status: "open" });
      opened[0].emit({ type: "lobby", message: { kind: "hello", ...localBuild(), bones: "0badf00d" } });
    });
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("The other player is running a different version. Both reload the page.");
    expect(opened[0].session.close).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
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
    render(<OnlineLobby openSession={openSession} canDrawWorld={webglCheck()} />);
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
    render(<OnlineLobby openSession={openSession} canDrawWorld={webglCheck()} />);
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
    render(<OnlineLobby openSession={openSession} canDrawWorld={webglCheck()} />);
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
        opened[0].emit({ type: "lobby", message: { kind: "hello", ...localBuild() } });
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
      const { unmount } = render(<OnlineLobby openSession={openSession} canDrawWorld={webglCheck()} />);
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

    /**
     * A double-click selects the whole block it lands in. With the spelling in
     * that block, the copy is "QRSTQ R S T", and pasted into Join it is no code.
     */
    it("keeps the spelling out of the block that shows the code, so copying it copies just the code", async () => {
      const { opened } = harness();
      await create();
      act(() => opened[0].emit({ type: "joined", role: "host" }));

      const code = opened[0].code;
      const shown = screen.getByTestId("room-code").closest("p");
      const spelled = screen.getByText(code.split("").join(" "));
      expect(shown?.textContent).toBe(code);
      expect(shown).not.toContainElement(spelled);
      expect(screen.getByTestId("room-code-panel")).toContainElement(spelled);
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

    it.each([
      ["full", "Room ABCD already has two players."],
      ["not-found", "There is no room ABCD. Check the code with the host."],
    ] as const)("does the same when the room turns the code away as %s", async (reason, said) => {
      const { opened } = harness();
      await join("ABCD");
      act(() => opened[0].emit({ type: "error", reason }));

      const input = screen.getByLabelText("Room code");
      expect(input).toHaveFocus();
      expect(input).toBeInvalid();
      expect(input).toHaveAccessibleDescription(said);
    });

    it("does not call a code wrong when the room could not be reached, and puts the player back on Join", async () => {
      const { opened } = harness();
      await join("ABCD");
      act(() => opened[0].emit({ type: "error", reason: "unreachable" }));

      const input = screen.getByLabelText("Room code");
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(input).not.toHaveFocus();
      expect(input).not.toBeInvalid();
      expect(input).not.toHaveAccessibleDescription();
      expect(screen.getByRole("button", { name: /join room/i })).toHaveFocus();
    });

    it("does not call the code wrong when a room it made could not open, and puts the player back on Create", async () => {
      const { opened } = harness();
      await create();
      act(() => opened[0].emit({ type: "error", reason: "unreachable" }));

      const input = screen.getByLabelText("Room code");
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(input).not.toHaveFocus();
      expect(input).not.toBeInvalid();
      expect(screen.getByRole("button", { name: /create room/i })).toHaveFocus();
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

/**
 * Ruling R2 end to end, with the real bake installed by the lobby's own
 * `connect`: the first `hello` the room hears already carries the bake's
 * engine fingerprint, not the legacy one a page has before the bake is in.
 * Last in the file: it leaves the bake installed for the module's lifetime.
 */
describe("OnlineLobby, the first hello", () => {
  it("carries the bake's fingerprint, not the one the page started with", async () => {
    const legacy = localBuild();
    const real = await vi.importActual<typeof import("@/game/bake")>("@/game/bake");
    const { readBakeFromDisk } = await import("@/game/bakeNode");
    bake.next = Promise.resolve().then(() => real.installBake(readBakeFromDisk()));
    const { opened } = harness();
    await create();
    act(() => {
      opened[0].emit({ type: "joined", role: "host" });
      opened[0].emit({ type: "peer", present: true });
      opened[0].emit({ type: "link", status: "open" });
    });
    const hello = opened[0].sent.find((m) => m.kind === "hello");
    expect(hello).toEqual({ kind: "hello", ...localBuild() });
    expect(hello).not.toMatchObject({ bones: legacy.bones });
    expect(hello).not.toMatchObject({ engineRules: legacy.engineRules });
  });
});
