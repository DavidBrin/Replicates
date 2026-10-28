import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../../vitest.setup";
import { localBuild } from "@/game/onlineConfig";
import { RANDOM_STAGE, resetRosterCache, useMatchConfig } from "@/lib/matchConfig";
import { PEER_LEFT_NOTICE, bindSession, leaveOnline, roomErrorMessage, useOnlineStore } from "@/lib/onlineStore";
import { getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession, type FakeSession } from "@/net/online/testing";
import { StageSelect } from "./StageSelect";

async function renderStages() {
  render(<StageSelect />);
  await act(async () => {});
}

const formButton = () => screen.getByRole("button", { name: /^form:/i });

beforeEach(() => {
  useMatchConfig.getState().reset();
  resetRosterCache();
  routerMock.push.mockClear();
});

describe("StageSelect", () => {
  it("lists the six legal stages and a random slot", async () => {
    await renderStages();

    expect(screen.getByRole("button", { name: "Battlefield" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  /**
   * The real game cycles the form on press rather than opening a picker, so
   * this is the behaviour to hold onto: three presses return you to where you
   * started.
   */
  it("cycles Normal → Battlefield → Ω → Normal on press", async () => {
    await renderStages();

    expect(formButton()).toHaveAccessibleName(/normal/i);

    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("battlefield");
    expect(formButton()).toHaveAccessibleName(/battlefield/i);

    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("omega");
    expect(formButton()).toHaveAccessibleName(/Ω/);

    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("normal");
    expect(formButton()).toHaveAccessibleName(/normal/i);
  });

  it("selects a stage and reports it in the preview", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: "Smashville" }));

    expect(useMatchConfig.getState().stageId).toBe("smashville");
    expect(screen.getByRole("heading", { name: /smashville/i })).toBeInTheDocument();
  });

  /**
   * Random is a token, not a stage. The match start is what turns it into one
   * of the six — storing a real id here would make the tile look unselected
   * after the player had just pressed it.
   */
  it("stores Random as a token rather than a stage id", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: "Random" }));

    expect(useMatchConfig.getState().stageId).toBe(RANDOM_STAGE);
    expect(screen.getByRole("heading", { name: "Random" })).toBeInTheDocument();
  });

  /** Ω is flat by definition — a stage with soft platforms must lose them. */
  it("reports no soft platforms once the form is Ω", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: "Battlefield" }));
    expect(screen.getByText("Platforms").nextElementSibling).toHaveTextContent("3");

    fireEvent.click(formButton());
    fireEvent.click(formButton());
    expect(useMatchConfig.getState().stageForm).toBe("omega");
    expect(screen.getByText("Platforms").nextElementSibling).toHaveTextContent("0");
  });

  it("continues to the character select", async () => {
    await renderStages();

    fireEvent.click(screen.getByRole("button", { name: /choose fighters/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
  });
});

describe("StageSelect, hosting online", () => {
  /** The host as the lobby hands it on: seated, bound and connected, the guest already in. */
  function host(): FakeSession {
    const fake = fakeSession("host");
    setActiveSession(fake.session);
    bindSession(fake.session);
    useMatchConfig.getState().configureOnline();
    useOnlineStore.getState().patch({ role: "host", status: "connected", roomCode: "ABCD" });
    return fake;
  }

  const chooseFighters = () => screen.getByRole("button", { name: /choose fighters/i });

  // Here rather than at the end of a test, so a failing test cannot leave its room to the next.
  afterEach(() => {
    act(() => leaveOnline());
  });

  it("tells the guest the stage, and the rules it will play, on the way to fighters", async () => {
    const { sent } = host();
    useMatchConfig.getState().setMode("time");
    await renderStages();
    fireEvent.click(chooseFighters());
    expect(sent).toEqual([{ kind: "stage", stageId: "battlefield", form: "normal", rules: useMatchConfig.getState().rules }]);
    expect(useMatchConfig.getState().rules.mode).toBe("time");
    expect(routerMock.push).toHaveBeenCalledWith("/fighters");
  });

  it("leaves the room instead of going back to the rules", async () => {
    host();
    await renderStages();
    fireEvent.click(screen.getByRole("button", { name: "Leave the room" }));
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(routerMock.push).toHaveBeenCalledWith("/online");
  });

  it("holds the way on to fighters while the seat is empty, and says why", async () => {
    const { sent } = host();
    await renderStages();
    act(() => useOnlineStore.getState().patch({ status: "waiting", notice: PEER_LEFT_NOTICE }));
    expect(screen.getByRole("alert")).toHaveTextContent(PEER_LEFT_NOTICE);
    expect(chooseFighters()).toBeDisabled();
    fireEvent.click(chooseFighters());
    expect(sent).toEqual([]);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("stays here when the stage could not be sent, and says why", async () => {
    const fake = host();
    // As the real session does once the room is gone: refuses the send, and says so.
    fake.session.sendLobby.mockImplementationOnce(() => {
      fake.emit({ type: "error", reason: "room-lost" });
      return false;
    });
    await renderStages();
    fireEvent.click(chooseFighters());
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(roomErrorMessage("room-lost", "ABCD"));
    expect(chooseFighters()).toBeDisabled();
  });

  it("says it is connecting while a newcomer's channel opens", async () => {
    host();
    await renderStages();
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    act(() => useOnlineStore.getState().patch({ status: "linking" }));
    expect(status).toHaveTextContent("Connecting to the other player…");
    expect(chooseFighters()).toBeDisabled();
  });

  /** Back here from fighters to change the stage, with a pick made: a newcomer's page starts empty. */
  it("repeats the host's pick when somebody takes the empty seat", async () => {
    const fake = host();
    useMatchConfig.getState().setFighter(0, "mario");
    await renderStages();
    act(() => fake.emit({ type: "link", status: "waiting" }));
    act(() => fake.emit({ type: "peer", present: true }));
    act(() => fake.emit({ type: "link", status: "open" }));
    // The newcomer says it runs this build, as this side did on opening.
    act(() => fake.emit({ type: "lobby", message: { kind: "hello", ...localBuild() } }));
    // The stage is still being chosen; it goes with Choose Fighters, as the first time.
    expect(fake.sent).toEqual([
      { kind: "hello", ...localBuild() },
      { kind: "pick", fighterId: "mario", costume: 0 },
    ]);
  });
});
