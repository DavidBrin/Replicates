import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession } from "@/net/online/testing";
import { useMatchConfig } from "./matchConfig";
import { bindSession, leaveOnline, roomErrorMessage, sendLobby, useOnlineStore, type OnlineErrorReason } from "./onlineStore";

const CONFIG: OnlineMatchConfig = {
  seed: 1,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

beforeEach(() => {
  leaveOnline();
  useMatchConfig.getState().reset();
});

describe("binding a session to the stores", () => {
  it("seats the players and records the role once the room answers", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    expect(useOnlineStore.getState()).toMatchObject({ role: "host", status: "waiting" });
    expect(useMatchConfig.getState().players.every((p) => p.kind === "human")).toBe(true);
  });

  it("goes from waiting to linking to connected", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it("fills the opponent's panel from their pick, and only theirs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 } });
    const [p0, p1] = useMatchConfig.getState().players;
    expect(p0).toMatchObject({ fighterId: "fox", costume: 2 });
    expect(p1.fighterId).toBeNull();
  });

  it("shows the guest the host's stage", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" } });
    expect(useOnlineStore.getState().hostStage).toEqual({ stageId: "smashville", form: "omega" });
    expect(useMatchConfig.getState()).toMatchObject({ stageId: "smashville", stageForm: "omega" });
  });

  it("takes the start config from the host, and only on the guest", () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "start", config: CONFIG } });
    expect(useOnlineStore.getState().config).toEqual(CONFIG);

    leaveOnline();
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    host.emit({ type: "lobby", message: { kind: "start", config: CONFIG } });
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it("explains a full room in words", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "error", reason: "full" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "full", error: "Room ABCD already has two players." });
  });

  it("says so when the opponent leaves the lobby", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "link", status: "open" });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", errorReason: "peer-left" });
  });

  it("records the opponent switching tabs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "lobby", message: { kind: "away", away: true } });
    expect(useOnlineStore.getState().remoteAway).toBe(true);
  });
});

describe("an error, once recorded", () => {
  function connectedHost() {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "peer", present: true });
    fake.emit({ type: "link", status: "open" });
    return fake;
  }

  it("keeps the opponent having left on screen, and the match unstartable, while they come and go", () => {
    const { emit } = connectedHost();
    emit({ type: "peer", present: false });
    emit({ type: "link", status: "waiting" });
    const left = { status: "waiting", errorReason: "peer-left", error: "The other player left the room." };
    expect(useOnlineStore.getState()).toMatchObject(left);

    // Somebody takes the empty seat and the channel opens again: the screens
    // still say who left, and nothing reads as connected until the player leaves.
    emit({ type: "peer", present: true });
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject(left);
  });

  it("is not cleared, or covered by a connection, by a later link status", () => {
    const { emit } = connectedHost();
    emit({ type: "error", reason: "room-lost" });
    const lost = { status: "error", errorReason: "room-lost", error: roomErrorMessage("room-lost", "ABCD") };
    expect(useOnlineStore.getState()).toMatchObject(lost);

    emit({ type: "link", status: "closed" });
    emit({ type: "link", status: "failed" });
    emit({ type: "link", status: "waiting" });
    emit({ type: "link", status: "open" });
    emit({ type: "peer", present: true });
    expect(useOnlineStore.getState()).toMatchObject(lost);
  });

  it("is replaced by the session's later verdict", () => {
    const { emit } = connectedHost();
    // The session reports the link failing, then that the room behind it is gone too.
    emit({ type: "link", status: "failed" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "link-failed" });
    emit({ type: "error", reason: "room-lost" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "room-lost" });
  });

  it("turns away a start that arrives after it", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "link", status: "open" });
    emit({ type: "link", status: "waiting" });
    emit({ type: "lobby", message: { kind: "start", config: CONFIG } });
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it("is cleared by leaving", () => {
    const { emit } = connectedHost();
    emit({ type: "error", reason: "room-lost" });
    leaveOnline();
    expect(useOnlineStore.getState()).toMatchObject({ status: "idle", error: null, errorReason: null });
  });
});

describe("sending and leaving", () => {
  it("sends lobby messages through the active session, and says whether they went", () => {
    const fake = fakeSession();
    setActiveSession(fake.session);
    expect(sendLobby({ kind: "away", away: false })).toBe(true);
    expect(fake.sent).toEqual([{ kind: "away", away: false }]);

    fake.accepts = false;
    expect(sendLobby({ kind: "pick", fighterId: "mario", costume: 0 })).toBe(false);
    expect(fake.sent).toEqual([{ kind: "away", away: false }]);
  });

  it("sends nothing without a session", () => {
    expect(getActiveSession()).toBeNull();
    expect(sendLobby({ kind: "away", away: true })).toBe(false);
  });

  it("closes the session and resets both stores on leaving", () => {
    const { session, emit } = fakeSession();
    setActiveSession(session);
    bindSession(session);
    emit({ type: "joined", role: "host" });
    leaveOnline();
    expect(session.close).toHaveBeenCalled();
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(useMatchConfig.getState().players.map((p) => p.kind)).toEqual(["human", "cpu"]);
    emit({ type: "joined", role: "guest" });
    expect(useOnlineStore.getState().role).toBeNull();
  });

  it("has a sentence for every reason", () => {
    const reasons = [
      "full",
      "taken",
      "not-found",
      "bad-message",
      "too-many-messages",
      "unreachable",
      "room-lost",
      "bad-start",
      "link-failed",
      "peer-left",
    ] as const;
    // The list is hand-written; tsc fails here when a reason is added without it.
    expectTypeOf<Exclude<OnlineErrorReason, (typeof reasons)[number]>>().toBeNever();
    for (const reason of reasons) {
      expect(roomErrorMessage(reason, "QRST").length).toBeGreaterThan(10);
    }
    expect(roomErrorMessage("not-found", "QRST")).toMatch(/QRST/);
    expect(roomErrorMessage("room-lost", "QRST")).toBe("Lost the room — create or join again.");
  });

  it("gives developers the wrangler hint on localhost only", () => {
    const player = roomErrorMessage("unreachable", "QRST", "david-smash.example.workers.dev");
    expect(player).not.toMatch(/wrangler|pnpm/);
    const local = roomErrorMessage("unreachable", "QRST", "localhost");
    expect(local.startsWith(player)).toBe(true);
    expect(local).toMatch(/wrangler dev/);
    expect(local).toMatch(/pnpm preview/);
    // Only the Worker being unreachable has a developer's cause.
    expect(roomErrorMessage("full", "QRST", "localhost")).toBe(roomErrorMessage("full", "QRST", "david-smash.example.workers.dev"));
  });

  it("reads the page's own host when none is given", () => {
    // jsdom serves the tests from localhost.
    expect(location.hostname).toBe("localhost");
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "error", reason: "unreachable" });
    expect(useOnlineStore.getState().error).toMatch(/wrangler dev/);
  });
});
