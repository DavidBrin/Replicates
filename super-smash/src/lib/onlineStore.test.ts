import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { localBuild } from "@/game/onlineConfig";
import { NEGOTIATION_TIMEOUT_MS } from "@/net/adapters/doSignal";
import { STUN_ONLY } from "@/net/iceConfig";
import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
import { GUEST_REOFFER_WAIT_MS, OnlineSession, REOFFER_DELAYS_MS, getActiveSession, setActiveSession } from "@/net/online/session";
import { fakeSession } from "@/net/online/testing";
import { PROTOCOL_VERSION } from "@/net/packet";
import type { Role } from "@/net/signalProtocol";
import { OpenableChannel, inertPeer } from "@/net/testing/fakePeer";
import { FakeSignalling } from "@/net/testing/fakeSignalling";
import { useMatchConfig } from "./matchConfig";
import {
  HELLO_TIMEOUT_MS,
  PEER_LEFT_NOTICE,
  bindSession,
  leaveOnline,
  roomErrorMessage,
  sendLobby,
  useOnlineStore,
  type OnlineErrorReason,
} from "./onlineStore";

const CONFIG: OnlineMatchConfig = {
  seed: 1,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};

/** This build's hello: what each side says as its channel opens, and the other side's when it runs the same build. */
const HELLO: LobbyMessage = { kind: "hello", ...localBuild() };

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

  it("goes from waiting to linking to connected, once the other side says it runs this build", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "lobby", message: HELLO });
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

  it("shows the guest the host's rules with its stage, without taking them as its own", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    const own = useMatchConfig.getState().rules;
    const hosts = { ...CONFIG.rules, mode: "time" } as const;
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega", rules: hosts } });
    expect(useOnlineStore.getState().hostStage).toEqual({ stageId: "smashville", form: "omega", rules: hosts });
    expect(useMatchConfig.getState().rules).toBe(own);
  });

  /** Only the host picks the stage, as only the host sends a start. */
  it("takes no stage from the guest", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    useMatchConfig.getState().setStage("battlefield");
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" } });
    expect(useOnlineStore.getState().hostStage).toBeNull();
    expect(useMatchConfig.getState()).toMatchObject({ stageId: "battlefield", stageForm: "normal" });
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

  it("says so when the opponent leaves the lobby, without calling it an error", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    useMatchConfig.getState().setFighter(0, "mario");
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 3 } });
    emit({ type: "lobby", message: { kind: "away", away: true } });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "waiting",
      notice: "The other player left the room.",
      error: null,
      errorReason: null,
      remoteAway: false,
    });
    // Whoever takes the seat next starts from an empty panel; this side's own pick stays.
    const [own, theirs] = useMatchConfig.getState().players;
    expect(own.fighterId).toBe("mario");
    expect(theirs).toMatchObject({ fighterId: null, costume: 1 });
  });

  it("forgets the stage a departed host chose", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" } });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 } });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().hostStage).toBeNull();
    expect(useMatchConfig.getState().players[0]).toMatchObject({ fighterId: null, costume: 0 });
  });

  it("pairs again when somebody takes the empty seat", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    emit({ type: "peer", present: false });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().notice).toBe(PEER_LEFT_NOTICE);

    // The same friend, back from a refresh with the same code: a reload, so
    // they say which build they now run before anything can start.
    emit({ type: "peer", present: true });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null, error: null });
  });

  /** The channel lost with both players still in the room: the session is getting it back, and nobody left. */
  it("says it is connecting again, not that the other player left, and keeps the panels", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 3 } });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    expect(useMatchConfig.getState().players[1]).toMatchObject({ fighterId: "fox", costume: 3 });
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
    expect(useMatchConfig.getState().players[1].fighterId).toBe("fox");
  });

  /** "The other player left" means they left: a real departure says so, whatever the channel is doing. */
  it.each(["connected", "linking"] as const)("says the other player left, and empties their seat, when they leave the room while %s", (status) => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" } });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 } });
    if (status === "linking") emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().status).toBe(status);

    emit({ type: "peer", present: false });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", notice: PEER_LEFT_NOTICE, hostStage: null, error: null });
    expect(useMatchConfig.getState().players[0]).toMatchObject({ fighterId: null, costume: 0 });
  });

  /**
   * The host's side of the channel died alone and it offered again: the
   * guest's channel is replaced without ever reporting a loss. Passing through
   * linking makes the next open a way into connected, so the guest repeats its
   * pick; nothing else changes, since nobody left.
   */
  it("passes a replaced channel through linking, keeping the panels and the host's stage", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" } });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 } });
    emit({ type: "link", status: "negotiating" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null, hostStage: { stageId: "smashville", form: "omega" } });
    expect(useMatchConfig.getState().players[0]).toMatchObject({ fighterId: "fox", costume: 2 });
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it("clears the notice once the channel opens again", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().notice).toBe(PEER_LEFT_NOTICE);
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    // Whoever the seat holds now says its build too.
    emit({ type: "lobby", message: HELLO });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
  });

  it("records the opponent switching tabs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "lobby", message: { kind: "away", away: true } });
    expect(useOnlineStore.getState().remoteAway).toBe(true);
  });
});

/**
 * The store and a real session together. One machine per test: the stores
 * belong to the page, so the other machine is played through the room.
 */
describe("with a real session, when the lobby channel is lost", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function seated(role: Role) {
    vi.useFakeTimers();
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
    if (role === "host") {
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    } else {
      signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest" }, peer: { id: "h1", role: "host" } });
      signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o" } });
    }
    await vi.advanceTimersByTimeAsync(0);
    channels[0].open();
    signalling.deliver({ t: "lobby", from: role === "host" ? "g1" : "h1", payload: HELLO });
    expect(useOnlineStore.getState().status).toBe("connected");
    const notices: (string | null)[] = [];
    useOnlineStore.subscribe((now) => notices.push(now.notice));
    return { session, signalling, channels, notices };
  }

  it("keeps the host's panels through a re-offer, and never says the guest left", async () => {
    const h = await seated("host");
    useMatchConfig.getState().setFighter(0, "mario");
    h.signalling.deliver({ t: "lobby", from: "g1", payload: { kind: "pick", fighterId: "fox", costume: 1 } });

    h.channels[0].drop();
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    await vi.advanceTimersByTimeAsync(REOFFER_DELAYS_MS[0]);
    h.channels[1].open();

    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
    // The fresh connection says this build again, through the room.
    expect(h.signalling.sent.filter((m) => m.t === "lobby" && m.payload.kind === "hello")).toEqual([
      { t: "lobby", payload: HELLO },
      { t: "lobby", payload: HELLO },
    ]);
    expect(useMatchConfig.getState().players.map((p) => p.fighterId)).toEqual(["mario", "fox"]);
    expect(h.notices.every((notice) => notice === null)).toBe(true);
  });

  it("keeps the guest's panels and the host's stage while it asks for a fresh connection", async () => {
    const g = await seated("guest");
    g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "stage", stageId: "smashville", form: "normal" } });
    g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "pick", fighterId: "mario", costume: 0 } });

    g.channels[0].drop();
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null, hostStage: { stageId: "smashville", form: "normal" } });
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
    await vi.advanceTimersByTimeAsync(0);
    g.channels[1].open();

    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null, hostStage: { stageId: "smashville", form: "normal" } });
    expect(useMatchConfig.getState().players[0].fighterId).toBe("mario");
    expect(g.notices.every((notice) => notice === null)).toBe(true);
  });

  /**
   * The host's re-offers run out: its room-lost closes its room socket, and
   * the room tells the guest it left. The guest must say so, not wait in
   * silence for an offer that will never come.
   */
  it("tells the guest its host left once the host's retries run out and it leaves the room", async () => {
    const g = await seated("guest");
    g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "stage", stageId: "smashville", form: "normal" } });
    g.signalling.deliver({ t: "lobby", from: "h1", payload: { kind: "pick", fighterId: "mario", costume: 0 } });

    g.channels[0].drop();
    // The host's re-offer, which never opens.
    g.signalling.deliver({ t: "signal", from: "h1", payload: { kind: "offer", sdp: "o2" } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(NEGOTIATION_TIMEOUT_MS);
    // The host gave up (room-lost) and its session left the room.
    g.signalling.deliver({ t: "peer-left", peerId: "h1" });
    await vi.advanceTimersByTimeAsync(GUEST_REOFFER_WAIT_MS * 6);

    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", notice: PEER_LEFT_NOTICE, error: null, hostStage: null });
    expect(useMatchConfig.getState().players[0].fighterId).toBeNull();
    // The code stays joinable: the room is still this guest's.
    expect(g.signalling.closed).toBe(false);
  });
});

/**
 * Two builds that differ are two different games (Plan 2 Task 27): another
 * wire format cannot read this one's packets, and another bone table puts
 * hitboxes elsewhere, so the match would desync on the first hit. Each side
 * says its build as the channel opens; nothing starts until the other's
 * matches, and a mismatch is said in the lobby, for good, before anyone plays.
 */
describe("the build handshake", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Both players in the room, and this side's channel open: the moment it says hello. */
  function opened(role: Role) {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role });
    fake.emit({ type: "peer", present: true });
    fake.emit({ type: "link", status: "open" });
    return fake;
  }

  /** What a mismatch leaves: the sentence, for good, and the room left once the delivery is over. */
  async function expectRefused(fake: ReturnType<typeof fakeSession>) {
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "engine-mismatch",
      error: "The other player is running a different version. Both reload the page.",
      notice: null,
      config: null,
    });
    expect(fake.session.close).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  }

  it("says this build's hello as the channel opens, and is connected only once the other side's matching one is in", () => {
    const { sent, emit } = opened("host");
    expect(sent).toEqual([HELLO]);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", error: null });
    emit({ type: "lobby", message: HELLO });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", error: null });
  });

  it("is connected as its channel opens when the other side's hello came first", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true });
    emit({ type: "lobby", message: HELLO });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it.each([
    ["wire format", { ...HELLO, protocol: PROTOCOL_VERSION + 1 }],
    ["bone table", { ...HELLO, bones: "0badf00d" }],
  ] as const)("refuses a peer on another %s, for good, and leaves the room", async (_, theirs) => {
    const fake = opened("guest");
    fake.emit({ type: "lobby", message: theirs });
    await expectRefused(fake);
    // Nothing the session reports afterwards undoes it.
    fake.emit({ type: "lobby", message: HELLO });
    fake.emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "engine-mismatch" });
  });

  it("says its own hello on the way out, so the other side refuses too, even before its channel opened", async () => {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "peer", present: true });
    fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" } });
    expect(fake.sent).toEqual([HELLO]);
    await expectRefused(fake);
  });

  it("refuses a build that never says hello, five seconds after the channel opens", async () => {
    vi.useFakeTimers();
    const fake = opened("host");
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", error: null });
    vi.advanceTimersByTime(1);
    await expectRefused(fake);
  });

  it("stops waiting for a hello once the other side's matching one is in", () => {
    vi.useFakeTimers();
    const { emit } = opened("guest");
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    emit({ type: "lobby", message: HELLO });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", error: null });
  });

  it("waits for a hello only while the channel is open, and afresh each time it opens", () => {
    vi.useFakeTimers();
    const { emit } = opened("host");
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    emit({ type: "link", status: "waiting" });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState().error).toBeNull();
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", error: null });
    vi.advanceTimersByTime(1);
    expect(useOnlineStore.getState().errorReason).toBe("engine-mismatch");
  });

  it("stops waiting for a hello on leaving", () => {
    vi.useFakeTimers();
    const fake = opened("host");
    leaveOnline();
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "idle", error: null });
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("says hello again on every reconnect, and takes the same player back without a new one", () => {
    const fake = opened("guest");
    fake.emit({ type: "lobby", message: HELLO });
    // The channel lost with the host still in the room: the session is getting it back.
    fake.emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().status).toBe("linking");
    fake.emit({ type: "link", status: "negotiating" });
    fake.emit({ type: "link", status: "open" });
    expect(fake.sent).toEqual([HELLO, HELLO]);
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  /** The hello rides the room: with the room gone the lobby cannot go on, and that is what it says. */
  it("says the room is lost, not the version, when the channel opens after the room dropped", async () => {
    vi.useFakeTimers();
    const signalling = new FakeSignalling();
    const channel = new OpenableChannel();
    const session = await OnlineSession.open("ABCD", "create", {
      fetchIce: async () => STUN_ONLY,
      openSignalling: () => signalling,
      createPeerConnection: () => ({ ...inertPeer(), createDataChannel: () => channel }),
    });
    setActiveSession(session);
    bindSession(session);
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host" }, peer: { id: "g1", role: "guest" } });
    // A Worker deploy drops the room mid-negotiation, and the channel opens within the session's grace.
    signalling.deliver({ t: "closed", code: 1006, reason: "" });
    channel.open();
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "room-lost" });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState().errorReason).toBe("room-lost");
  });

  it("has whoever takes the empty seat say its build before anything can start, and refuses another one", async () => {
    const fake = opened("host");
    fake.emit({ type: "lobby", message: HELLO });
    fake.emit({ type: "peer", present: false });
    fake.emit({ type: "link", status: "waiting" });
    fake.emit({ type: "peer", present: true });
    fake.emit({ type: "link", status: "negotiating" });
    fake.emit({ type: "link", status: "open" });
    expect(fake.sent).toEqual([HELLO, HELLO]);
    expect(useOnlineStore.getState().status).toBe("linking");
    // The newcomer runs another build.
    fake.emit({ type: "lobby", message: { ...HELLO, protocol: PROTOCOL_VERSION + 1 } });
    await expectRefused(fake);
  });
});

describe("an error, once recorded", () => {
  function connectedHost() {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "peer", present: true });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO });
    return fake;
  }

  it("outlasts the opponent leaving, which adds no notice under it", () => {
    const { emit } = connectedHost();
    emit({ type: "error", reason: "room-lost" });
    emit({ type: "peer", present: false });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "room-lost", notice: null });
  });

  it("takes the place of a notice already showing", () => {
    const { emit } = connectedHost();
    emit({ type: "peer", present: false });
    expect(useOnlineStore.getState().notice).toBe(PEER_LEFT_NOTICE);
    emit({ type: "error", reason: "room-lost" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "room-lost", notice: null });
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

  it("seats nobody when the room answers after it", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "error", reason: "full" });
    const players = useMatchConfig.getState().players;
    emit({ type: "joined", role: "guest" });
    expect(useOnlineStore.getState().role).toBeNull();
    expect(useMatchConfig.getState().players).toBe(players);
  });

  it("turns away a start that arrives after it", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "link", status: "open" });
    emit({ type: "link", status: "failed" });
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
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(getActiveSession()).toBeNull();
    expect(useOnlineStore.getState().status).toBe("idle");
    expect(useMatchConfig.getState().players.map((p) => p.kind)).toEqual(["human", "cpu"]);
    emit({ type: "joined", role: "guest" });
    expect(useOnlineStore.getState().role).toBeNull();
    leaveOnline();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("listens to the latest session only", () => {
    const first = fakeSession();
    const second = fakeSession();
    bindSession(first.session);
    bindSession(second.session);
    first.emit({ type: "joined", role: "host" });
    expect(useOnlineStore.getState().role).toBeNull();
    second.emit({ type: "joined", role: "guest" });
    expect(useOnlineStore.getState().role).toBe("guest");
  });

  it("hears nothing more once left, even from an event already being delivered", () => {
    const { session, emit } = fakeSession();
    setActiveSession(session);
    // A listener ahead of the store's leaves on hearing the room answer.
    session.on((event) => {
      if (event.type === "joined") leaveOnline();
    });
    bindSession(session);
    emit({ type: "joined", role: "host" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "idle", role: null });
    expect(useMatchConfig.getState()).toMatchObject({ online: false });
    expect(useMatchConfig.getState().players.map((p) => p.kind)).toEqual(["human", "cpu"]);
  });

  it("leaves a local setup alone when no room was ever opened", () => {
    useMatchConfig.getState().addPlayer();
    useMatchConfig.getState().setFighter(2, "fox");
    leaveOnline();
    const { players } = useMatchConfig.getState();
    expect(players.map((p) => p.kind)).toEqual(["human", "cpu", "cpu"]);
    expect(players[2].fighterId).toBe("fox");
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
      "engine-mismatch",
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
