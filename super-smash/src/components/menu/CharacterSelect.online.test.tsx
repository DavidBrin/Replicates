import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { localBuild } from "@/game/onlineConfig";
import { resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { PEER_LEFT_NOTICE, bindSession, leaveOnline, roomErrorMessage, useOnlineStore } from "@/lib/onlineStore";
import { STUN_ONLY } from "@/net/iceConfig";
import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
import { OnlineSession, REOFFER_DELAYS_MS, getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import { ROLE_PORT, type Role } from "@/net/signalProtocol";
import { OpenableChannel, inertPeer } from "@/net/testing/fakePeer";
import { FakeSignalling } from "@/net/testing/fakeSignalling";
import { CharacterSelect } from "./CharacterSelect";

// The 3D world's module (three.js), stood in for: the lobby only asks it to start downloads.
const world = vi.hoisted(() => ({ preloadModels: vi.fn<(ids: readonly string[]) => Promise<void>>(async () => {}) }));
vi.mock("@/game/world3d", () => world);

const portraits = () => screen.getAllByRole("button", { name: /, number \d/i });
const readyButton = () => screen.getByRole("button", { name: /ready to fight/i });

const CONFIG: OnlineMatchConfig = {
  seed: 9,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
  ...localBuild(),
};

/** This build's hello, which the other side says too when it runs the same build. */
const HELLO: LobbyMessage = { kind: "hello", ...localBuild() };

/** Both players in the room, as the lobby hands it to the select screens: seated, bound and connected. */
function goOnline(role: Role): FakeSession {
  const fake = fakeSession(role);
  setActiveSession(fake.session);
  bindSession(fake.session);
  useMatchConfig.getState().configureOnline();
  useOnlineStore.getState().patch({ role, status: "connected", roomCode: "ABCD" });
  return fake;
}

async function renderSelect() {
  render(<CharacterSelect />);
  await act(async () => {});
}

beforeEach(() => {
  useMatchConfig.getState().reset();
  resetRosterCache();
  routerMock.push.mockClear();
});

// Here rather than at the end of a test, so a failing test cannot leave its room to the next.
afterEach(() => {
  act(() => leaveOnline());
});

describe("CharacterSelect, online", () => {
  it("lets a peer fill only its own panel, and tells the other side", async () => {
    const { sent } = goOnline("guest");
    await renderSelect();
    fireEvent.click(portraits()[0]);
    const [p0, p1] = useMatchConfig.getState().players;
    expect(p0.fighterId).toBeNull();
    expect(p1.fighterId).not.toBeNull();
    expect(sent).toEqual([{ kind: "pick", fighterId: p1.fighterId, costume: 1 }]);
  });

  it("tells the other side when a peer clears its pick", async () => {
    const { sent } = goOnline("guest");
    await renderSelect();
    fireEvent.click(portraits()[0]);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(useMatchConfig.getState().players[1].fighterId).toBeNull();
    expect(sent.at(-1)).toEqual({ kind: "pick", fighterId: null, costume: 1 });
  });

  /** Every pick goes out the same way, so a cleared one keeps the costume like any other. */
  it("sends this side's own costume with every pick, a cleared one included", async () => {
    const { sent } = goOnline("guest");
    useMatchConfig.getState().setCostume(1, 4);
    await renderSelect();
    fireEvent.click(portraits()[0]);
    fireEvent.keyDown(window, { key: "Backspace" });
    expect(sent.map((m) => m.kind === "pick" && m.costume)).toEqual([4, 4]);
  });

  it("ignores the keys and panels that switch ports in a local match", async () => {
    goOnline("host");
    await renderSelect();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(screen.getByRole("button", { name: "Choose for P2" }));
    fireEvent.click(portraits()[0]);
    expect(useMatchConfig.getState().players[0].fighterId).not.toBeNull();
    expect(useMatchConfig.getState().players[1].fighterId).toBeNull();
  });

  it("switches off the panels' port buttons, which choose nothing online", async () => {
    goOnline("guest");
    await renderSelect();
    expect(screen.getByRole("button", { name: "Choose for P1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose for P2" })).toBeDisabled();
  });

  it("says it is connecting while a newcomer's channel opens, and stops once it has", async () => {
    goOnline("host");
    await renderSelect();
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    act(() => useOnlineStore.getState().patch({ status: "linking" }));
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Connecting to the other player…");
    act(() => useOnlineStore.getState().patch({ status: "connected" }));
    expect(status).toBeEmptyDOMElement();
  });

  /** The banner tag is hidden below `sm` for everyone else; the guest's is the one place it learns the stage. */
  it("shows the guest the host's stage at every width", async () => {
    goOnline("guest");
    useOnlineStore.getState().patch({ hostStage: { stageId: "battlefield", form: "normal" } });
    await renderSelect();
    expect(screen.getByText("Stage: Battlefield").closest(".hidden")).toBeNull();
  });

  it("makes the host's back button leave the room once the room cannot go on", async () => {
    const fake = goOnline("host");
    await renderSelect();
    expect(screen.getByRole("button", { name: "Back to stage select" })).toBeInTheDocument();
    act(() => fake.emit({ type: "error", reason: "bad-start" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave the room" }));
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });

  it("hides adding and removing players", async () => {
    goOnline("host");
    await renderSelect();
    expect(screen.queryByRole("button", { name: "Add a player" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove a player" })).toBeNull();
    fireEvent.keyDown(window, { key: "+" });
    expect(useMatchConfig.getState().players).toHaveLength(2);
    expect(screen.queryByText(/switches port/i)).toBeNull();
  });

  it("marks the panels as yours and the opponent's, with no CPU switch", async () => {
    goOnline("guest");
    await renderSelect();
    expect(screen.getByText("Opponent")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByText("Human")).toBeNull();
    expect(screen.queryByRole("button", { name: "CPU for P1" })).toBeNull();
    expect(screen.queryByRole("button", { name: "CPU for P2" })).toBeNull();
  });

  it("lets the host start the match for both", async () => {
    const { sent } = goOnline("host");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    fireEvent.click(readyButton());
    const start = sent.find((m) => m.kind === "start");
    expect(start).toMatchObject({ kind: "start", config: { fighters: ["mario", "fox"], stageId: "battlefield" } });
    expect(useOnlineStore.getState().config).toEqual(start && start.kind === "start" ? start.config : null);
    expect(routerMock.push).toHaveBeenCalledWith("/play");
  });

  it("keeps the host here when the start could not be sent, and says why", async () => {
    const fake = goOnline("host");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    // As the real session does with a start the guest would read differently: refuses it, and says so.
    fake.session.sendLobby.mockImplementationOnce(() => {
      fake.emit({ type: "error", reason: "bad-start" });
      return false;
    });
    await renderSelect();
    fireEvent.click(readyButton());
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(useOnlineStore.getState().config).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(roomErrorMessage("bad-start", "ABCD"));
    expect(readyButton()).toBeDisabled();
  });

  it("holds Ready shut, saying it is connecting, until the guest says it runs this build", async () => {
    const fake = fakeSession();
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => {
      fake.emit({ type: "joined", role: "host" });
      fake.emit({ type: "peer", present: true });
      fake.emit({ type: "link", status: "open" });
    });
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    expect(readyButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting to the other player…");
    act(() => fake.emit({ type: "lobby", message: HELLO }));
    expect(readyButton()).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says the two versions differ, holds Ready shut and leaves, when the guest runs another build", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = fakeSession();
    setActiveSession(fake.session);
    bindSession(fake.session);
    act(() => {
      fake.emit({ type: "joined", role: "host" });
      fake.emit({ type: "peer", present: true });
      fake.emit({ type: "link", status: "open" });
    });
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    await act(async () => fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("The other player is running a different version. Both reload the page.");
    expect(readyButton()).toBeDisabled();
    expect(fake.session.close).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Leave the room" })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("holds Ready shut once the room is lost, picks and all", async () => {
    const fake = goOnline("host");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    expect(readyButton()).toBeEnabled();
    act(() => fake.emit({ type: "error", reason: "room-lost" }));
    expect(readyButton()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(roomErrorMessage("room-lost", "ABCD"));
  });

  /**
   * The guest's room socket alone dropped (an idle timeout) while the direct
   * channel stayed up: the room says the guest left, and a start would go to
   * nobody. The screen says so and holds Ready shut; the session's own guard
   * (session.test.ts) is the backstop. A real session.
   */
  it("tells the host the guest left, and sends no start, when the room no longer has the guest but the channel does", async () => {
    const signalling = new FakeSignalling();
    const channel = new OpenableChannel();
    const session = await OnlineSession.open("ABCD", "create", {
      fetchIce: async () => STUN_ONLY,
      openSignalling: () => signalling,
      createPeerConnection: () => ({ ...inertPeer(), createDataChannel: () => channel }),
    });
    setActiveSession(session);
    bindSession(session);
    act(() => {
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
      channel.open();
      signalling.deliver({ t: "lobby", from: "g1", payload: HELLO });
    });
    expect(useOnlineStore.getState().status).toBe("connected");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();

    act(() => signalling.deliver({ t: "peer-left", peerId: "g1" }));
    expect(screen.getByRole("alert")).toHaveTextContent(PEER_LEFT_NOTICE);
    expect(readyButton()).toBeDisabled();
    fireEvent.click(readyButton());

    expect(signalling.sent.some((m) => m.t === "lobby" && m.payload.kind === "start")).toBe(false);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it("holds Ready shut until the channel is back, and tells the host the guest left", async () => {
    const { sent } = goOnline("host");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    // The status alone: both panels stay filled.
    act(() => useOnlineStore.getState().patch({ status: "waiting", notice: PEER_LEFT_NOTICE }));
    expect(screen.getByRole("alert")).toHaveTextContent(PEER_LEFT_NOTICE);
    expect(readyButton()).toBeDisabled();
    fireEvent.click(readyButton());
    expect(sent.some((m) => m.kind === "start")).toBe(false);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("keeps the guest's button off, and follows the host into the match", async () => {
    goOnline("guest");
    useMatchConfig.getState().setFighter(0, "mario");
    useMatchConfig.getState().setFighter(1, "fox");
    await renderSelect();
    expect(screen.getByRole("button", { name: /waiting for host/i })).toBeDisabled();
    act(() => useOnlineStore.getState().patch({ config: CONFIG }));
    expect(routerMock.push).toHaveBeenCalledWith("/play");
  });

  it("shows the guest which stage the host picked", async () => {
    goOnline("guest");
    useOnlineStore.getState().patch({ hostStage: { stageId: "battlefield", form: "normal" } });
    await renderSelect();
    expect(screen.getByText(/stage: battlefield/i)).toBeInTheDocument();
  });

  /** The guest's own stage id is Battlefield from the start: only the host's word says it chose. */
  it("tells the guest the host is still picking until the host's stage arrives", async () => {
    const fake = goOnline("guest");
    await renderSelect();
    expect(useMatchConfig.getState().stageId).toBe("battlefield");
    expect(screen.getByText("The host is picking the stage")).toBeInTheDocument();
    act(() => fake.emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "normal" } }));
    expect(screen.getByText("Stage: Smashville")).toBeInTheDocument();
  });

  it("shows the guest the host's rules beside its stage, in the words the results use", async () => {
    const fake = goOnline("guest");
    await renderSelect();
    const rules = { mode: "stock", stocks: 2, timeLimit: 9000, smashBall: false, oneOnOne: true } as const;
    act(() => fake.emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "normal", rules } }));
    expect(screen.getByText("Stage: Smashville · 2-stock match · 1v1 damage 1.2× · Smash Ball off")).toBeInTheDocument();
  });

  it("tells the guest the host left, and forgets the host's stage", async () => {
    const fake = goOnline("guest");
    await renderSelect();
    act(() => fake.emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "normal" } }));
    act(() => fake.emit({ type: "link", status: "waiting" }));
    expect(screen.getByRole("alert")).toHaveTextContent(PEER_LEFT_NOTICE);
    expect(screen.getByText("The host is picking the stage")).toBeInTheDocument();
  });

  it("makes the guest's back button leave the room", async () => {
    goOnline("guest");
    await renderSelect();
    fireEvent.click(screen.getByRole("button", { name: "Leave the room" }));
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });

  /**
   * Only the host's side of the lobby channel closes. Nobody left, so the host
   * keeps the guest's panel and offers again; the guest's channel is replaced
   * without ever reporting a loss. Each screen is driven by a real session over a fake
   * room, one machine per test (the stores are one per page).
   */
  describe("when only the host's side of the channel closed", () => {
    async function realSession(role: Role) {
      const signalling = new FakeSignalling();
      const channels: OpenableChannel[] = [];
      const session = await OnlineSession.open("ABCD", role === "host" ? "create" : "join", {
        fetchIce: async () => STUN_ONLY,
        openSignalling: () => signalling,
        createPeerConnection: () => {
          const channel = new OpenableChannel();
          channels.push(channel);
          return { ...inertPeer(), createDataChannel: () => channel };
        },
      });
      setActiveSession(session);
      bindSession(session);
      const lobby = () => signalling.sent.flatMap((m) => (m.t === "lobby" ? [m.payload] : []));
      return { session, signalling, channels, lobby };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("has the guest, its channel replaced, repeat its pick and keep the host's stage", async () => {
      vi.useFakeTimers();
      const g = await realSession("guest");
      await act(async () => {
        g.signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
        g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
        await vi.advanceTimersByTimeAsync(0);
        g.channels[0].open();
        g.signalling.deliver({ t: "lobby", from: "h1", payload: HELLO });
        g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "stage", stageId: "smashville", form: "normal" } });
      });
      render(<CharacterSelect />);
      await act(async () => {});
      fireEvent.click(portraits()[0]);
      const mine = useMatchConfig.getState().players[ROLE_PORT.guest];
      expect(g.lobby()).toEqual([HELLO, { kind: "pick", fighterId: mine.fighterId, costume: mine.costume }]);

      // The host's side died; it offers again, and this side's channel is replaced.
      await act(async () => {
        g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
      expect(screen.getByText("Stage: Smashville")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      act(() => g.channels[1].open());

      expect(useOnlineStore.getState().status).toBe("connected");
      // The replaced channel says this build again, then the pick.
      expect(g.lobby()).toEqual([
        HELLO,
        { kind: "pick", fighterId: mine.fighterId, costume: mine.costume },
        HELLO,
        { kind: "pick", fighterId: mine.fighterId, costume: mine.costume },
      ]);
    });

    it("has the host offer again, repeat its pick and stage, take the guest's repeated pick, and start", async () => {
      vi.useFakeTimers();
      const h = await realSession("host");
      await act(async () => {
        h.signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
        await vi.advanceTimersByTimeAsync(0);
        h.channels[0].open();
        h.signalling.deliver({ t: "lobby", from: "g1", payload: HELLO });
      });
      useMatchConfig.getState().setFighter(0, "mario");
      render(<CharacterSelect />);
      await act(async () => {});
      act(() => h.signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 1 } }));
      expect(readyButton()).toBeEnabled();

      // Only the host's side of the channel closes. Nobody left: the guest's
      // panel stays, nothing says they left, and Ready waits for the channel.
      act(() => h.channels[0].drop());
      expect(useMatchConfig.getState().players[1].fighterId).toBe("fox");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(readyButton()).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
      });
      expect(useOnlineStore.getState().status).toBe("linking");
      act(() => h.channels[1].open());
      expect(h.lobby()).toEqual(
        expect.arrayContaining([
          { kind: "pick", fighterId: "mario", costume: 0 },
          { kind: "stage", stageId: "battlefield", form: "normal", rules: useMatchConfig.getState().rules },
        ]),
      );

      // The guest's store passed through linking too, so it repeats its pick.
      act(() => h.signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 1 } }));
      expect(useMatchConfig.getState().players.map((p) => p.fighterId)).toEqual(["mario", "fox"]);
      expect(readyButton()).toBeEnabled();
      fireEvent.click(readyButton());
      expect(h.lobby().some((m) => m.kind === "start")).toBe(true);
      expect(routerMock.push).toHaveBeenCalledWith("/play");
    });
  });

  describe("when somebody takes the empty seat", () => {
    /** The opponent leaves, a newcomer takes the seat, the channel opens again, and the newcomer says it runs this build. */
    function rejoin(fake: FakeSession) {
      act(() => fake.emit({ type: "link", status: "waiting" }));
      act(() => fake.emit({ type: "peer", present: true }));
      act(() => fake.emit({ type: "link", status: "open" }));
      act(() => fake.emit({ type: "lobby", message: HELLO }));
    }

    it("has the host repeat its pick and its stage, since the newcomer's page starts empty", async () => {
      const fake = goOnline("host");
      useMatchConfig.getState().setStage("smashville");
      useMatchConfig.getState().setStageForm("omega");
      await renderSelect();
      fireEvent.click(portraits()[0]);
      const mine = useMatchConfig.getState().players[ROLE_PORT.host];
      // Arriving said nothing; the room opened in the lobby, before anything was picked.
      expect(fake.sent).toEqual([{ kind: "pick", fighterId: mine.fighterId, costume: mine.costume }]);
      fake.sent.length = 0;

      rejoin(fake);

      expect(fake.sent).toEqual([
        HELLO,
        { kind: "pick", fighterId: mine.fighterId, costume: mine.costume },
        { kind: "stage", stageId: "smashville", form: "omega", rules: useMatchConfig.getState().rules },
      ]);
    });

    it("has the guest repeat its pick", async () => {
      const fake = goOnline("guest");
      await renderSelect();
      fireEvent.click(portraits()[0]);
      const mine = useMatchConfig.getState().players[ROLE_PORT.guest];
      fake.sent.length = 0;

      rejoin(fake);

      expect(fake.sent).toEqual([HELLO, { kind: "pick", fighterId: mine.fighterId, costume: mine.costume }]);
    });
  });
});

/**
 * Plan 4: once both picks are known, both machines start fetching the two
 * fighters' models, so the match starts with them rather than stand-ins.
 * Through `import()`, keeping three.js out of this screen's chunk.
 */
describe("CharacterSelect, online, the models", () => {
  beforeEach(() => world.preloadModels.mockClear());

  it("starts both fighters' downloads once both have picked, and again for a new pair", async () => {
    const fake = goOnline("guest");
    await renderSelect();
    fireEvent.click(portraits()[0]);
    await act(async () => {});
    expect(world.preloadModels).not.toHaveBeenCalled();
    const mine = useMatchConfig.getState().players[1].fighterId!;
    act(() => fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 0 } }));
    await vi.waitFor(() => expect(world.preloadModels).toHaveBeenCalledWith(["fox", mine]));
    act(() => fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "marth", costume: 0 } }));
    await vi.waitFor(() => expect(world.preloadModels).toHaveBeenLastCalledWith(["marth", mine]));
    expect(world.preloadModels).toHaveBeenCalledTimes(2);
  });

  it("fetches nothing for Random, which only the host's start decides", async () => {
    const fake = goOnline("host");
    await renderSelect();
    act(() => fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "random", costume: 1 } }));
    fireEvent.click(portraits()[2]);
    const mine = useMatchConfig.getState().players[0].fighterId!;
    await vi.waitFor(() => expect(world.preloadModels).toHaveBeenCalledWith([mine]));
  });

  it("fetches nothing offline", async () => {
    await renderSelect();
    fireEvent.click(portraits()[0]);
    fireEvent.click(portraits()[1]);
    await act(async () => {});
    expect(world.preloadModels).not.toHaveBeenCalled();
  });
});
