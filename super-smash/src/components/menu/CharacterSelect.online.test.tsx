import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { PEER_LEFT_NOTICE, bindSession, leaveOnline, roomErrorMessage, useOnlineStore } from "@/lib/onlineStore";
import type { OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import { ROLE_PORT, type Role } from "@/net/signalProtocol";
import { CharacterSelect } from "./CharacterSelect";

const portraits = () => screen.getAllByRole("button", { name: /, number \d/i });
const readyButton = () => screen.getByRole("button", { name: /ready to fight/i });

const CONFIG: OnlineMatchConfig = {
  seed: 9,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

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

  it("ignores the keys and panels that switch ports in a local match", async () => {
    goOnline("host");
    await renderSelect();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.click(screen.getByRole("button", { name: "Choose for P2" }));
    fireEvent.click(portraits()[0]);
    expect(useMatchConfig.getState().players[0].fighterId).not.toBeNull();
    expect(useMatchConfig.getState().players[1].fighterId).toBeNull();
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

  describe("when somebody takes the empty seat", () => {
    /** The opponent leaves, a newcomer takes the seat, and the channel opens again. */
    function rejoin(fake: FakeSession) {
      act(() => fake.emit({ type: "link", status: "waiting" }));
      act(() => fake.emit({ type: "peer", present: true }));
      act(() => fake.emit({ type: "link", status: "open" }));
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

      expect(fake.sent).toEqual([{ kind: "pick", fighterId: mine.fighterId, costume: mine.costume }]);
    });
  });
});
