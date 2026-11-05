import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi, type MockInstance } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import { DEFAULT_PAD_SETTINGS, rebind } from "@/input/gamepad";
import { buildStartConfig, localBuild } from "@/game/onlineConfig";
import { GAME_SIM_CONTEXT, engineFingerprint, rulesFingerprint } from "@/game/simContext";
import { NEGOTIATION_TIMEOUT_MS } from "@/net/adapters/doSignal";
import { STUN_ONLY } from "@/net/iceConfig";
import {
  parseLobbyMessage,
  type BuildStamp,
  type LobbyMessage,
  type OnlineMatchConfig,
  type ReceivedLobbyMessage,
} from "@/net/online/lobby";
import { GUEST_REOFFER_WAIT_MS, OnlineSession, REOFFER_DELAYS_MS, getActiveSession, setActiveSession } from "@/net/online/session";
import { GUEST_PEER, HOST_PEER, fakeSession, otherPeer } from "@/net/online/testing";
import { PROTOCOL_VERSION } from "@/net/packet";
import type { PeerInfo, Role } from "@/net/signalProtocol";
import { OpenableChannel, inertPeer } from "@/net/testing/fakePeer";
import { FakeSignalling } from "@/net/testing/fakeSignalling";
import { useMatchConfig } from "./matchConfig";
import {
  HELLO_TIMEOUT_MS,
  beginRoom,
  bindSession,
  leaveOnline,
  roomErrorMessage,
  seatLeftNotice,
  seatMismatchNotice,
  seatNoAnswerNotice,
  sendLobby,
  sendOwnPick,
  setOwnPad,
  setOwnStickJump,
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
  controls: [0, 0],
  ...localBuild(),
};

/** This build's hello: what each side says as its channel opens, and the other side's when it runs the same build. */
const HELLO: LobbyMessage = { kind: "hello", ...localBuild() };

/** The third and fourth seats of a room of four (Plan 7, Phase B): each guest takes the lowest free port. */
const SECOND_GUEST: PeerInfo = { id: "g2", role: "guest", port: 2 };
const THIRD_GUEST: PeerInfo = { id: "g3", role: "guest", port: 3 };

/** The refusal a host sends the one guest whose build it will not play. */
const REFUSE: LobbyMessage = { kind: "refuse", reason: "engine-mismatch" };

/** The refusal a host sends the one guest that never answered through the room (Plan 7, Phase B). */
const REFUSE_SILENT: LobbyMessage = { kind: "refuse", reason: "link-failed" };

/** What both players read when a start from this very build cannot be read: no "different version", the stamps agree. */
const UNREADABLE_START_SENTENCE = "The match settings could not be read, so leave the room and start again.";

/**
 * What a developer reads when a peer is refused goes to the console. The tests
 * that refuse one read it here rather than print it.
 */
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  leaveOnline();
  useMatchConfig.getState().reset();
});

afterEach(() => {
  warn.mockRestore();
});

/** `stamp` as a build from before the rules' part of the stamp sent it: without it. */
function withoutRules(stamp: BuildStamp): Record<string, unknown> {
  return Object.fromEntries(Object.entries(stamp).filter(([key]) => key !== "engineRules"));
}

/** A lobby message as the other side's room delivers it: through JSON and this build's parser. */
function overTheWire(message: LobbyMessage): ReceivedLobbyMessage {
  const received = parseLobbyMessage(JSON.parse(JSON.stringify(message)));
  if (received === null) throw new Error(`the lobby cannot read ${message.kind}`);
  return received;
}

/**
 * The stamp of a build on this very commit whose combat rules are another
 * version's (Plan 3 Task 20): the deploy and the bone table are this build's,
 * and only the rules, in the engine fingerprint and on their own, differ.
 */
const OTHER_RULES = { version: ENGINE_RULES_VERSION + 1, activeSlots: ACTIVE_SCRIPT_SLOTS };
const RULES_STAMP = {
  ...localBuild(),
  bones: engineFingerprint(GAME_SIM_CONTEXT, OTHER_RULES),
  engineRules: rulesFingerprint(OTHER_RULES),
};

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
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it("mirrors the route: null before a link, direct on a direct open, relay once the session moves", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    expect(useOnlineStore.getState().route).toBeNull();
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    emit({ type: "link", status: "negotiating" });
    expect(useOnlineStore.getState().route).toBeNull();
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().route).toBe("direct");
    // The match moves to the room: the relay's own open is not a direct one, and a lost room's re-open is not either.
    emit({ type: "route", route: "relay" });
    expect(useOnlineStore.getState().route).toBe("relay");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().route).toBe("relay");
    leaveOnline();
    expect(useOnlineStore.getState().route).toBeNull();
  });

  /**
   * A host whose browser has no WebRTC fails its offer inside the transport's own welcome, so
   * the session reports the move, the relay's open, and only then the room's seating.
   */
  it("comes out right when the route and the link open arrive before the room's welcome and the peer", () => {
    const { session, emit, sent } = fakeSession();
    bindSession(session);
    emit({ type: "route", route: "relay" });
    emit({ type: "link", status: "open" });
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({ route: "relay", role: "host", status: "linking", error: null });
    // Said as the link opened, and again to the guest the room then seats (an open link brings it
    // no opening of its own); the other side's hello still settles the lobby.
    expect(sent).toEqual([HELLO, HELLO]);
    expect(session.sendLobby.mock.calls.at(-1)).toEqual([HELLO, GUEST_PEER.id]);
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ route: "relay", status: "connected" });
  });

  it("fills the opponent's panel from their pick, and only theirs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true, peer: HOST_PEER });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: HOST_PEER.id });
    const [p0, p1] = useMatchConfig.getState().players;
    expect(p0).toMatchObject({ fighterId: "fox", costume: 2 });
    expect(p1.fighterId).toBeNull();
  });

  it("shows the guest the host's stage", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true, peer: HOST_PEER });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" }, from: HOST_PEER.id });
    expect(useOnlineStore.getState().hostStage).toEqual({ stageId: "smashville", form: "omega" });
    expect(useMatchConfig.getState()).toMatchObject({ stageId: "smashville", stageForm: "omega" });
  });

  it("shows the guest the host's rules with its stage, without taking them as its own", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true, peer: HOST_PEER });
    const own = useMatchConfig.getState().rules;
    const hosts = { ...CONFIG.rules, mode: "time" } as const;
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega", rules: hosts }, from: HOST_PEER.id });
    expect(useOnlineStore.getState().hostStage).toEqual({ stageId: "smashville", form: "omega", rules: hosts });
    expect(useMatchConfig.getState().rules).toBe(own);
  });

  /** Only the host picks the stage, as only the host sends a start. */
  it("takes no stage from the guest", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    useMatchConfig.getState().setStage("battlefield");
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState().hostStage).toBeNull();
    expect(useMatchConfig.getState()).toMatchObject({ stageId: "battlefield", stageForm: "normal" });
  });

  it("takes the start config from the host, and only on the guest", () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    expect(useOnlineStore.getState().config).toEqual(CONFIG);

    leaveOnline();
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    host.emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState().config).toBeNull();
  });

  it.each([
    ["deploy", { ...CONFIG, build: "fedcba987654" }],
    ["bone table", { ...CONFIG, bones: "0badf00d" }],
    ["wire format", { ...CONFIG, protocol: PROTOCOL_VERSION + 1 }],
    ["rules, on the same deploy", { ...CONFIG, ...RULES_STAMP }],
  ] as const)("refuses a start from a peer on another %s: tells the host, says why, and leaves", async (_, config) => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "start", config }, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "engine-mismatch" });
    expect(useOnlineStore.getState().error).toBe("The other player is running a different version. Both reload the page.");
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
    await Promise.resolve();
    expect(guest.session.close).toHaveBeenCalledTimes(1);
  });

  it("refuses a start with no build in it, as from a build before the handshake", async () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "unreadable-start", build: null }, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "engine-mismatch" });
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
    await Promise.resolve();
    expect(guest.session.close).toHaveBeenCalledTimes(1);
  });

  it("refuses a start from another build that it cannot read at all", () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "unreadable-start", build: { ...localBuild(), protocol: PROTOCOL_VERSION + 1 } }, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, errorReason: "engine-mismatch" });
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
  });

  /**
   * This build's own start, unreadable here, is not another version, so it is
   * not said to be (the stamps agree). It is still a start no match can come
   * of, and the host has sent it and is waiting: dropped, the guest would sit
   * connected with no match for good (codex P2-2). It is refused like any
   * other, in its own words, and the room is left.
   */
  it("refuses an unreadable start that says it is this build: told to the host, in its own words, and leaves", async () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "unreadable-start", build: localBuild() }, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "unreadable-start" });
    expect(useOnlineStore.getState().error).toBe(UNREADABLE_START_SENTENCE);
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "unreadable-start" }]);
    await Promise.resolve();
    expect(guest.session.close).toHaveBeenCalledTimes(1);
  });

  it("shows the host the same reason when the guest refuses its start, withdraws the start, and leaves", async () => {
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    useOnlineStore.getState().patch({ config: CONFIG });
    host.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "engine-mismatch" });
    expect(useOnlineStore.getState().error).toBe("The other player is running a different version. Both reload the page.");
    expect(host.sent).toEqual([]);
    await Promise.resolve();
    expect(host.session.close).toHaveBeenCalledTimes(1);
  });

  it("shows the host the guest's own reason when the guest could not read its start, withdraws the start, and leaves", async () => {
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    useOnlineStore.getState().patch({ config: CONFIG });
    host.emit({ type: "lobby", message: { kind: "refuse", reason: "unreadable-start" }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "unreadable-start" });
    expect(useOnlineStore.getState().error).toBe(UNREADABLE_START_SENTENCE);
    expect(host.sent).toEqual([]);
    await Promise.resolve();
    expect(host.session.close).toHaveBeenCalledTimes(1);
  });

  /**
   * A refusal answers a start. With none out, or with the one that went out
   * withdrawn because its guest left the room, it is a wrong-time packet
   * (codex P2): it must not end a room that is fine.
   */
  it("takes a refusal on the host only while a start is out to the player in the seat", async () => {
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    host.emit({ type: "peer", present: true, peer: GUEST_PEER });
    host.emit({ type: "link", status: "open" });
    host.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    host.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", errorReason: null, error: null });

    // A start out to a guest who then left: the next guest never saw it.
    useOnlineStore.getState().patch({ config: CONFIG });
    host.emit({ type: "peer", present: false, peer: GUEST_PEER });
    host.emit({ type: "peer", present: true, peer: GUEST_PEER });
    host.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState().errorReason).toBeNull();
    await Promise.resolve();
    expect(host.session.close).not.toHaveBeenCalled();

    // A new start, to the guest now seated, can be refused again.
    useOnlineStore.getState().patch({ config: { ...CONFIG, seed: 2 } });
    host.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "engine-mismatch", config: null });
  });

  /** Only a host sends a start, so only a host can be refused one; and only a guest refuses. */
  it("takes a refusal on the host only, and judges a start's build on the guest only", () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" }, from: HOST_PEER.id });
    expect(useOnlineStore.getState().errorReason).toBeNull();

    leaveOnline();
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    host.emit({ type: "lobby", message: { kind: "start", config: { ...CONFIG, bones: "0badf00d" } }, from: GUEST_PEER.id });
    host.emit({ type: "lobby", message: { kind: "unreadable-start", build: null }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, errorReason: null });
    expect(host.sent).toEqual([]);
  });

  it("explains a full room in words", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "error", reason: "full" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "full", error: "Room ABCD already has four players." });
  });

  it("says so when the opponent leaves the lobby, without calling it an error", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    useMatchConfig.getState().setFighter(0, "mario");
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 3 }, from: GUEST_PEER.id });
    emit({ type: "lobby", message: { kind: "away", away: true }, from: GUEST_PEER.id });
    // As the real session reports it: the transport's channel goes first, then the room's leave.
    emit({ type: "link", status: "waiting" });
    emit({ type: "peer", present: false, peer: GUEST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "waiting",
      notice: "P2 left the room.",
      error: null,
      errorReason: null,
      remoteAway: false,
    });
    // Whoever takes the seat next starts from an empty panel; this side's own pick stays.
    const [own, theirs] = useMatchConfig.getState().players;
    expect(own.fighterId).toBe("mario");
    expect(theirs).toMatchObject({ fighterId: null, costume: 1 });
  });

  /** With a start out, the lobby's seats are as good as empty once the channel goes; the room's word on who is seated stays. */
  it("forgets the host's stage and pick when the channel goes with a start out", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true, peer: HOST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" }, from: HOST_PEER.id });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: HOST_PEER.id });
    emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "waiting",
      config: null,
      hostStage: null,
      notice: seatLeftNotice(0),
      seats: [{ peerId: HOST_PEER.id, port: 0, build: "pending" }],
    });
    expect(useMatchConfig.getState().players[0]).toMatchObject({ fighterId: null, costume: 0 });
  });

  it("pairs again when somebody takes the empty seat", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    emit({ type: "peer", present: false, peer: GUEST_PEER });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().notice).toBe(seatLeftNotice(1));

    // The same friend, back from a refresh with the same code: a reload, so
    // they say which build they now run before anything can start.
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null, error: null });
  });

  /** The channel lost with both players still in the room: the session is getting it back, and nobody left. */
  it("says it is connecting again, not that the other player left, and keeps the panels", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 3 }, from: GUEST_PEER.id });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    expect(useMatchConfig.getState().players[1]).toMatchObject({ fighterId: "fox", costume: 3 });
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
    expect(useMatchConfig.getState().players[1].fighterId).toBe("fox");
  });

  /** "P2 left the room" means they left: a real departure says so, whatever the channel is doing. */
  it.each(["connected", "linking"] as const)("says the other player left, and empties their seat, when they leave the room while %s", (status) => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: GUEST_PEER.id });
    if (status === "linking") emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().status).toBe(status);

    emit({ type: "peer", present: false, peer: GUEST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", notice: seatLeftNotice(1), seats: [], error: null });
    expect(useMatchConfig.getState().players[1]).toMatchObject({ fighterId: null, costume: 1 });
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
    emit({ type: "peer", present: true, peer: HOST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" }, from: HOST_PEER.id });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: HOST_PEER.id });
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
    emit({ type: "peer", present: true, peer: HOST_PEER });
    emit({ type: "link", status: "open" });
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    // A start out, so the channel going empties the seats as far as the lobby goes.
    emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState().notice).toBe(seatLeftNotice(0));
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    // Whoever the seat holds now says its build too.
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
  });

  it("records the opponent switching tabs", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    emit({ type: "lobby", message: { kind: "away", away: true }, from: GUEST_PEER.id });
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
      signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
    } else {
      signalling.deliver({ t: "welcome", self: { id: "g1", role: "guest", port: 1 }, peers: [{ id: "h1", role: "host", port: 0 }] });
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
   * The old guest's room socket left while its channel was still open (codex
   * P1). The host must let that channel go and pair the newcomer, not sit in
   * "linking" with Start disabled.
   */
  it("pairs the host with a newcomer whose predecessor's socket left before its channel closed", async () => {
    const h = await seated("host");
    h.signalling.deliver({ t: "peer-left", peerId: "g1" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", notice: seatLeftNotice(1) });

    h.signalling.deliver({ t: "peer-joined", peer: { id: "g2", role: "guest", port: 1 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.channels).toHaveLength(2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: null });
    h.channels[1].open();
    h.signalling.deliver({ t: "lobby", from: "g2", payload: HELLO });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", error: null });
  });

  /**
   * The host's re-offers run out: its room-lost closes its room socket, and
   * the room tells the guest it left. The guest must say so, not wait in
   * silence for an offer that will never come; and a guest's room is its
   * host's, so it closes (Plan 7, Phase B: `host-left`).
   */
  it("tells the guest its host left, and closes its room, once the host's retries run out and it leaves the room", async () => {
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

    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "host-left", notice: null });
    expect(g.signalling.closed).toBe(true);
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
    fake.emit({ type: "peer", present: true, peer: otherPeer(role) });
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
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", error: null });
  });

  it("is connected as its channel opens when the other side's hello came first", () => {
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "guest" });
    emit({ type: "peer", present: true, peer: HOST_PEER });
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it.each([
    ["deploy", { ...HELLO, build: "fedcba987654" }],
    ["wire format", { ...HELLO, protocol: PROTOCOL_VERSION + 1 }],
    ["bone table", { ...HELLO, bones: "0badf00d" }],
    ["rules, on the same deploy", { ...HELLO, ...RULES_STAMP }],
  ] as const)("refuses a peer on another %s, for good, and leaves the room", async (_, theirs) => {
    const fake = opened("guest");
    fake.emit({ type: "lobby", message: theirs, from: HOST_PEER.id });
    await expectRefused(fake);
    // Nothing the session reports afterwards undoes it.
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    fake.emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "engine-mismatch" });
  });

  /**
   * The case this check was extended for (Plan 3 Task 20): the same deploy
   * (a dev build, or any two builds sharing an id), another version of the
   * combat rules. Everything else about the two stamps agrees.
   */
  it("refuses a peer on this very build whose rules differ: the same sentence, and the console says the rules", async () => {
    expect(RULES_STAMP.build).toBe(HELLO.build);
    expect(RULES_STAMP.protocol).toBe(HELLO.protocol);
    const fake = opened("guest");
    fake.emit({ type: "lobby", message: overTheWire({ kind: "hello", ...RULES_STAMP }), from: HOST_PEER.id });
    await expectRefused(fake);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain(`its engine rules are ${RULES_STAMP.engineRules}, this build's are ${localBuild().engineRules}`);
  });

  it("refuses the start of a host on this very build whose rules differ: told to the host, the same sentence, the console says the rules", async () => {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "guest" });
    fake.emit({ type: "lobby", message: overTheWire({ kind: "start", config: { ...CONFIG, ...RULES_STAMP } }), from: HOST_PEER.id });
    expect(fake.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
    await expectRefused(fake);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain("its engine rules are");
  });

  it.each([
    ["deploy", { ...HELLO, build: "fedcba987654" }, "it is build fedcba987654"],
    ["wire format", { ...HELLO, protocol: PROTOCOL_VERSION + 1 }, `its wire format is ${PROTOCOL_VERSION + 1}`],
    ["bone table", { ...HELLO, bones: "0badf00d" }, "its engine is 0badf00d"],
    ["rules", { ...HELLO, ...RULES_STAMP }, "its engine rules are"],
  ] as const)("says to the console which part differs when the %s does, and to the player only the one sentence", (_, theirs, fragment) => {
    const fake = opened("guest");
    fake.emit({ type: "lobby", message: theirs, from: HOST_PEER.id });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("David-Smash: not playing the other player's build:");
    expect(warn.mock.calls[0][1]).toContain(fragment);
    expect(useOnlineStore.getState().error).toBe("The other player is running a different version. Both reload the page.");
  });

  /**
   * The Plan 2 build, the one live before this stamp: it says `{ build, protocol,
   * bones }` with its bone table's fingerprint, and nothing about rules. This
   * build's parser reads no stamp without the rules' part, so the hello never
   * reaches the store. That peer reads THIS build's hello fine (it ignores a
   * field it does not know), finds another bones fingerprint (this one's holds
   * the rules too) and another deploy, refuses, and leaves the room. So this
   * side is never told a version: it hears the other player leave, which is
   * true, and it is the stale tab that is told to reload.
   */
  it("hears a Plan 2 peer only leave: its hello has no rules' part, so it is not read, and it refuses this build's and goes", () => {
    vi.useFakeTimers();
    const planTwoHello = { kind: "hello", build: "0123456789ab", protocol: PROTOCOL_VERSION, bones: LEGACY_BONE_TABLE.fingerprint };
    expect(parseLobbyMessage(JSON.parse(JSON.stringify(planTwoHello)))).toBeNull();
    const fake = opened("host");
    expect(fake.sent).toEqual([HELLO]);
    fake.emit({ type: "peer", present: false, peer: GUEST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "waiting",
      error: null,
      errorReason: null,
      notice: seatLeftNotice(1),
    });
    // The wait for its hello went with it: nothing is refused later.
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", errorReason: null });
    expect(warn).not.toHaveBeenCalled();
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  /** The same, from the guest's seat, and a Plan 2 host whose start is already out when this side hears it. */
  it("refuses at once a start from a build before the rules' part of the stamp, which the parser reads as a start from an unknown build", async () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    const planTwoStart = parseLobbyMessage(
      JSON.parse(JSON.stringify({ kind: "start", config: { ...withoutRules(CONFIG), bones: LEGACY_BONE_TABLE.fingerprint } })),
    );
    expect(planTwoStart).toEqual({ kind: "unreadable-start", build: null });
    guest.emit({ type: "lobby", message: planTwoStart!, from: HOST_PEER.id });
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
    await expectRefused(guest);
    expect(warn.mock.calls[0].join(" ")).toContain("no build stamp this build can read");
  });

  /**
   * Codex P2-2, through the parser a guest really has: the same build says hello
   * and then sends a start whose seed is not a number. The stamp is the guest's
   * own, so it is not another version; it is a start nothing can play, and the
   * host has sent it. It must end cleanly, not leave the guest connected with
   * no match and no word, for good.
   */
  it("refuses a start from this very build that its parser cannot read, rather than wait on it for good", async () => {
    vi.useFakeTimers();
    const guest = opened("guest");
    guest.emit({ type: "lobby", message: overTheWire(HELLO), from: HOST_PEER.id });
    expect(useOnlineStore.getState().status).toBe("connected");
    guest.sent.length = 0;

    const start = parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config: { ...CONFIG, seed: "bad" } })));
    expect(start).toEqual({ kind: "unreadable-start", build: localBuild() });
    guest.emit({ type: "lobby", message: start!, from: HOST_PEER.id });

    expect(guest.sent).toEqual([{ kind: "refuse", reason: "unreadable-start" }]);
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "unreadable-start",
      error: UNREADABLE_START_SENTENCE,
      notice: null,
      config: null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(" ")).toContain("cannot read");
    expect(guest.session.close).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(guest.session.close).toHaveBeenCalledTimes(1);
    // Nothing that follows undoes it, or starts a wait of its own.
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    guest.emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "unreadable-start", config: null });
  });

  it("says its own hello on the way out, so the host refuses too, even before its channel opened", async () => {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "guest" });
    fake.emit({ type: "peer", present: true, peer: HOST_PEER });
    fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" }, from: HOST_PEER.id });
    expect(fake.sent).toEqual([HELLO]);
    await expectRefused(fake);
  });

  it("refuses a build that never says hello, five seconds after the channel opens", async () => {
    vi.useFakeTimers();
    const fake = opened("guest");
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", error: null });
    vi.advanceTimersByTime(1);
    await expectRefused(fake);
    expect(warn.mock.calls[0].join(" ")).toContain("no hello within");
  });

  /**
   * Relayed, the transport opens the link before the session reports the peer
   * (`Route`), so the peer's arrival finds the channel open already.
   */
  function relayedOpenThenSeated() {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "route", route: "relay" });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    return fake;
  }

  /**
   * Relayed, a seat that has said nothing at all since the relay opened is not
   * another version: the other tab most likely cannot run (a phone switched
   * to another app), which may be why the direct link failed too. It is a
   * failed link, said for good, and the room is left (Phase A fix, M-4).
   */
  it("calls a relayed seat that says nothing at all a failed link, not another version, five seconds after the room seats it", async () => {
    vi.useFakeTimers();
    const fake = relayedOpenThenSeated();
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", error: null });
    vi.advanceTimersByTime(1);
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "link-failed",
      error: "The connection to the other player failed. Leave the room and try again.",
      notice: null,
      config: null,
    });
    expect(fake.session.close).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  /** Plan 7, Phase B: the host turns that seat away alone, and keeps its room. */
  it("refuses a relayed seat that talks in the lobby but never says hello as another build, alone", async () => {
    vi.useFakeTimers();
    const fake = relayedOpenThenSeated();
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: GUEST_PEER.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState()).toMatchObject({
      status: "linking",
      errorReason: null,
      notice: seatMismatchNotice(1),
      seats: [{ peerId: GUEST_PEER.id, port: 1, build: "mismatch" }],
    });
    expect(fake.session.sendLobby.mock.calls.at(-1)).toEqual([REFUSE, GUEST_PEER.id]);
    expect(warn.mock.calls[0].join(" ")).toContain("no hello within");
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  /**
   * The newcomer's silence is its own: what the last seat said is forgotten, so
   * it is not taken for a talker on another build. The last seat's word did
   * show the relay works (fix round 1, M3), so the newcomer is refused alone,
   * as not answering.
   */
  it("forgets what the last seat said when somebody new takes it on the relay", () => {
    vi.useFakeTimers();
    const fake = relayedOpenThenSeated();
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: GUEST_PEER.id });
    fake.emit({ type: "peer", present: false, peer: GUEST_PEER });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState()).toMatchObject({ errorReason: null, notice: seatNoAnswerNotice(1) });
    expect(fake.session.sendLobby.mock.calls.at(-1)).toEqual([REFUSE_SILENT, GUEST_PEER.id]);
  });

  it("stops waiting for a relayed peer's hello once its matching one is in", () => {
    vi.useFakeTimers();
    const fake = relayedOpenThenSeated();
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", error: null });
  });

  it("stops waiting for a hello once the other side's matching one is in", () => {
    vi.useFakeTimers();
    const { emit } = opened("guest");
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", error: null });
  });

  it("waits for a hello only while the channel is open, and afresh each time it opens", () => {
    vi.useFakeTimers();
    const { emit } = opened("guest");
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

  it("stops waiting for a hello when the other player leaves the room", () => {
    vi.useFakeTimers();
    const { emit } = opened("host");
    emit({ type: "peer", present: false, peer: GUEST_PEER });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", notice: seatLeftNotice(1), error: null });
  });

  it("stops waiting for a hello when somebody new takes the seat, until their own channel opens", () => {
    vi.useFakeTimers();
    const { emit } = opened("host");
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", error: null, seats: [{ peerId: GUEST_PEER.id, build: "pending" }] });
    emit({ type: "link", status: "negotiating" });
    emit({ type: "link", status: "open" });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    // The host turns that seat away alone (Plan 7, Phase B).
    expect(useOnlineStore.getState()).toMatchObject({ errorReason: null, seats: [{ peerId: GUEST_PEER.id, build: "mismatch" }] });
  });

  /** The build was settled before the start; from then on the channel is the match's. */
  it("never ends a start already out for want of a hello", async () => {
    vi.useFakeTimers();
    const fake = opened("guest");
    fake.emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    await Promise.resolve();
    expect(useOnlineStore.getState()).toMatchObject({ config: CONFIG, error: null });
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("says no hello and starts no wait when the channel reports open once a start is out", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "guest" });
    fake.emit({ type: "peer", present: true, peer: HOST_PEER });
    fake.emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    fake.emit({ type: "link", status: "open" });
    expect(fake.sent).toEqual([]);
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS * 2);
    await Promise.resolve();
    expect(useOnlineStore.getState()).toMatchObject({ config: CONFIG, error: null });
    expect(fake.session.close).not.toHaveBeenCalled();
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
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
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
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [{ id: "g1", role: "guest", port: 1 }] });
    // A Worker deploy drops the room mid-negotiation, and the channel opens within the session's grace.
    signalling.deliver({ t: "closed", code: 1006, reason: "" });
    channel.open();
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "room-lost" });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState().errorReason).toBe("room-lost");
  });

  it("has whoever takes the empty seat say its build before anything can start, and refuses another one alone", async () => {
    const fake = opened("host");
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    fake.emit({ type: "peer", present: false, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "waiting" });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "negotiating" });
    fake.emit({ type: "link", status: "open" });
    expect(fake.sent).toEqual([HELLO, HELLO]);
    expect(useOnlineStore.getState().status).toBe("linking");
    // The newcomer runs another build: the host turns it away, and keeps its room (Plan 7, Phase B).
    fake.emit({ type: "lobby", message: { ...HELLO, protocol: PROTOCOL_VERSION + 1 }, from: GUEST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", errorReason: null, notice: seatMismatchNotice(1) });
    expect(fake.sent.at(-1)).toEqual(REFUSE);
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
  });
});

/**
 * Plan 7, Phase B: the store keeps every seat the room has, by port, with its
 * build check. A room of three or four is relayed, so most of these play the
 * relay: the link is the room's, open before the seats arrive.
 */
describe("every seat (Plan 7, Phase B)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A host on the relay, its link open, as the room seats `peers`; the match config seats four. */
  function relayedHost(...peers: PeerInfo[]) {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    useMatchConfig.getState().configureOnline(4);
    fake.emit({ type: "route", route: "relay" });
    fake.emit({ type: "link", status: "open" });
    for (const peer of peers) fake.emit({ type: "peer", present: true, peer });
    return fake;
  }

  /** A guest at `port`, welcomed into a room seating `peers`, then moved to the relay, whose link opens. */
  function relayedGuest(port: number, ...peers: PeerInfo[]) {
    const fake = fakeSession();
    fake.seatPort = port;
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "guest" });
    useMatchConfig.getState().configureOnline(4);
    for (const peer of peers) fake.emit({ type: "peer", present: true, peer });
    fake.emit({ type: "route", route: "relay" });
    fake.emit({ type: "link", status: "open" });
    return fake;
  }

  it("lists each seated player by port, with their build pending until their hello", () => {
    const { emit } = relayedHost(SECOND_GUEST, GUEST_PEER);
    expect(useOnlineStore.getState()).toMatchObject({
      localPort: 0,
      seats: [
        { peerId: "g1", port: 1, build: "pending" },
        { peerId: "g2", port: 2, build: "pending" },
      ],
    });
    emit({ type: "lobby", message: HELLO, from: SECOND_GUEST.id });
    expect(useOnlineStore.getState().seats).toEqual([
      { peerId: "g1", port: 1, build: "pending" },
      { peerId: "g2", port: 2, build: "ok" },
    ]);
  });

  it("is connected for the host only when every seated player's build matches", () => {
    const { emit } = relayedHost(GUEST_PEER, SECOND_GUEST, THIRD_GUEST);
    emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    emit({ type: "lobby", message: HELLO, from: THIRD_GUEST.id });
    expect(useOnlineStore.getState().status).toBe("linking");
    emit({ type: "lobby", message: HELLO, from: SECOND_GUEST.id });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  it("keeps the host in the room when one guest runs another build: refuses that guest alone and says so", async () => {
    const fake = relayedHost(GUEST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" }, from: SECOND_GUEST.id });
    expect(fake.session.sendLobby.mock.calls).toContainEqual([REFUSE, SECOND_GUEST.id]);
    expect(seatMismatchNotice(2)).toBe("P3 is running a different version, so they can't play in this room.");
    expect(useOnlineStore.getState()).toMatchObject({
      status: "linking",
      notice: seatMismatchNotice(2),
      errorReason: null,
      error: null,
      seats: [
        { peerId: "g1", port: 1, build: "ok" },
        { peerId: "g2", port: 2, build: "mismatch" },
      ],
    });
    expect(warn).toHaveBeenCalledWith("David-Smash: not playing the other player's build:", expect.stringContaining("its engine is 0badf00d"));
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("files each pick under its sender's port, and drops one from a peer with no seat", () => {
    const { emit } = relayedHost(GUEST_PEER, SECOND_GUEST);
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: SECOND_GUEST.id });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "mario", costume: 1 }, from: GUEST_PEER.id });
    emit({ type: "lobby", message: { kind: "pick", fighterId: "link", costume: 3 }, from: "x9" });
    expect(useMatchConfig.getState().players.map((p) => [p.fighterId, p.costume])).toEqual([
      [null, 0],
      ["mario", 1],
      ["fox", 2],
      [null, 3],
    ]);
  });

  it("takes the stage only from the host's seat", () => {
    const { emit } = relayedGuest(1, HOST_PEER, SECOND_GUEST);
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" }, from: SECOND_GUEST.id });
    expect(useOnlineStore.getState().hostStage).toBeNull();
    expect(useMatchConfig.getState().stageId).not.toBe("smashville");
    emit({ type: "lobby", message: { kind: "stage", stageId: "smashville", form: "omega" }, from: HOST_PEER.id });
    expect(useOnlineStore.getState().hostStage).toEqual({ stageId: "smashville", form: "omega" });
  });

  it("clears only the leaving player's panel, and names their port", () => {
    const { emit } = relayedHost(GUEST_PEER, SECOND_GUEST, THIRD_GUEST);
    for (const [peer, fighterId] of [[GUEST_PEER, "mario"], [SECOND_GUEST, "fox"], [THIRD_GUEST, "link"]] as const) {
      emit({ type: "lobby", message: HELLO, from: peer.id });
      emit({ type: "lobby", message: { kind: "pick", fighterId, costume: 5 }, from: peer.id });
    }
    emit({ type: "peer", present: false, peer: SECOND_GUEST });
    expect(seatLeftNotice(2)).toBe("P3 left the room.");
    expect(useOnlineStore.getState()).toMatchObject({ notice: "P3 left the room.", error: null, status: "connected" });
    expect(useOnlineStore.getState().seats.map((seat) => seat.port)).toEqual([1, 3]);
    expect(useMatchConfig.getState().players.map((p) => [p.fighterId, p.costume])).toEqual([
      [null, 0],
      ["mario", 5],
      [null, 2],
      ["link", 5],
    ]);
  });

  it("closes a guest's room when the host leaves, with its own sentence", async () => {
    const fake = relayedGuest(1, HOST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    fake.emit({ type: "peer", present: false, peer: HOST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "host-left",
      error: "The host left, so the room has closed. Create or join another.",
      notice: null,
    });
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });

  it("leaves a running match alone when the host's room socket drops: no host-left, no panel cleared", async () => {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "guest" });
    fake.emit({ type: "peer", present: true, peer: HOST_PEER });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: HOST_PEER.id });
    fake.emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
    // A direct link outlives the host's room socket (D54): the match goes on.
    fake.emit({ type: "peer", present: false, peer: HOST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", config: CONFIG, errorReason: null, notice: null });
    expect(useMatchConfig.getState().players[0]).toMatchObject({ fighterId: "fox", costume: 2 });
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("says hello to a newcomer joining an open room, addressed to them", () => {
    const fake = relayedHost(GUEST_PEER);
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    expect(useOnlineStore.getState().status).toBe("connected");
    // The relay is the room's and stays open: the newcomer brings no new `link: open`.
    fake.emit({ type: "peer", present: true, peer: SECOND_GUEST });
    expect(fake.session.sendLobby.mock.calls).toContainEqual([HELLO, SECOND_GUEST.id]);
    expect(useOnlineStore.getState().status).toBe("linking");
  });

  it("reaches connected as a newcomer to an open relayed room, from the host's addressed hello", () => {
    const { emit } = relayedGuest(2, HOST_PEER, GUEST_PEER);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", localPort: 2 });
    emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  /**
   * Fix round 1 (I-2): relayed, a seat that has said nothing at all is not
   * another build; with another seat heard the relay works, so it is that
   * player's tab that does not answer. Refused alone, in those words.
   */
  it("refuses only the seat whose hello never comes, after HELLO_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    const fake = relayedHost(GUEST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    expect(useOnlineStore.getState().seats[1]).toMatchObject({ peerId: "g2", build: "pending" });
    vi.advanceTimersByTime(1);
    expect(seatNoAnswerNotice(2)).toBe("P3 didn't answer, so they can't play in this room.");
    expect(useOnlineStore.getState()).toMatchObject({
      status: "linking",
      errorReason: null,
      notice: seatNoAnswerNotice(2),
      seats: [
        { peerId: "g1", port: 1, build: "ok" },
        { peerId: "g2", port: 2, build: "mismatch" },
      ],
    });
    expect(fake.session.sendLobby.mock.calls).toContainEqual([REFUSE_SILENT, SECOND_GUEST.id]);
    expect(warn).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
    // The notice outlives the seat, as a build refusal's does.
    fake.emit({ type: "peer", present: false, peer: SECOND_GUEST });
    expect(useOnlineStore.getState().notice).toBe(seatNoAnswerNotice(2));
  });

  it("refuses alone, as another build, a relayed seat that talks in the lobby but never says hello", async () => {
    vi.useFakeTimers();
    const fake = relayedHost(GUEST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: SECOND_GUEST.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState()).toMatchObject({ errorReason: null, notice: seatMismatchNotice(2) });
    expect(useOnlineStore.getState().seats[1]).toMatchObject({ peerId: "g2", build: "mismatch" });
    expect(fake.session.sendLobby.mock.calls).toContainEqual([REFUSE, SECOND_GUEST.id]);
    expect(warn.mock.calls[0].join(" ")).toContain("no hello within");
  });

  /**
   * Fix round 1 (I-1): a third joiner moves an open direct room to the relay.
   * The session reports the seat first and the move after it, and the relay's
   * open brings no new `link: open`, so the move itself starts the waits.
   */
  it("times every waiting seat once an open room turns to the relay", () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    useMatchConfig.getState().configureOnline(4);
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    fake.emit({ type: "peer", present: true, peer: SECOND_GUEST });
    fake.emit({ type: "route", route: "relay" });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState()).toMatchObject({ errorReason: null, notice: seatNoAnswerNotice(2) });
    expect(useOnlineStore.getState().seats[1]).toMatchObject({ peerId: "g2", build: "mismatch" });
    expect(fake.session.sendLobby.mock.calls).toContainEqual([REFUSE_SILENT, SECOND_GUEST.id]);
  });

  it("calls the link failed when no relayed seat at all has answered", async () => {
    vi.useFakeTimers();
    const fake = relayedHost(GUEST_PEER, SECOND_GUEST);
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "link-failed" });
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  /** Fix round 1 (M3): a seat that answered and then left still shows the relay works. */
  it("counts a seat that answered and left as the relay working: the silent one is refused alone", async () => {
    vi.useFakeTimers();
    const fake = relayedHost(GUEST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    fake.emit({ type: "peer", present: false, peer: GUEST_PEER });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS);
    expect(useOnlineStore.getState()).toMatchObject({ errorReason: null, notice: seatNoAnswerNotice(2) });
    expect(fake.session.sendLobby.mock.calls).toContainEqual([REFUSE_SILENT, SECOND_GUEST.id]);
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  it("calls a guest's relayed link failed when its host never answers", async () => {
    vi.useFakeTimers();
    const fake = relayedGuest(2, HOST_PEER, GUEST_PEER);
    // Another guest's word says nothing about the host's tab.
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    vi.advanceTimersByTime(HELLO_TIMEOUT_MS - 1);
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", errorReason: null });
    vi.advanceTimersByTime(1);
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "link-failed",
      error: "The connection to the other player failed. Leave the room and try again.",
    });
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });

  it("leaves with the link-failed sentence when the host says this guest never answered", async () => {
    const fake = relayedGuest(1, HOST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: REFUSE_SILENT, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "link-failed",
      error: "The connection to the other player failed. Leave the room and try again.",
    });
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a guest connected when another guest leaves: only that panel clears, and it names their port", async () => {
    const fake = relayedGuest(1, HOST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "mario", costume: 4 }, from: HOST_PEER.id });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 5 }, from: SECOND_GUEST.id });
    fake.emit({ type: "peer", present: false, peer: SECOND_GUEST });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", errorReason: null, notice: seatLeftNotice(2), seats: [{ peerId: "h1", port: 0, build: "ok" }] });
    expect(useMatchConfig.getState().players.map((p) => [p.fighterId, p.costume])).toEqual([
      ["mario", 4],
      [null, 1],
      [null, 2],
      [null, 3],
    ]);
    await Promise.resolve();
    expect(fake.session.close).not.toHaveBeenCalled();
  });

  /** Fix round 1 (M4): only the host refuses, so only the host's screen names a refused build. */
  it("says on a guest only that another guest on another build left, not why", () => {
    const fake = relayedGuest(1, HOST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" }, from: SECOND_GUEST.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
    fake.emit({ type: "peer", present: false, peer: SECOND_GUEST });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: seatLeftNotice(2) });
  });

  /** B-1 through a real session: the hello reaches the room addressed to the newcomer alone. */
  it("greets a newcomer to an open relayed room through the room, addressed to them alone", async () => {
    vi.useFakeTimers();
    const signalling = new FakeSignalling();
    const session = await OnlineSession.open("ABCD", "create", {
      fetchIce: async () => STUN_ONLY,
      openSignalling: () => signalling,
      createPeerConnection: () => inertPeer(),
    });
    setActiveSession(session);
    bindSession(session);
    // Three seated: the room is relayed from the welcome, and its link opens there.
    signalling.deliver({ t: "welcome", self: { id: "h1", role: "host", port: 0 }, peers: [GUEST_PEER, SECOND_GUEST] });
    expect(useOnlineStore.getState()).toMatchObject({ route: "relay", status: "linking" });
    signalling.sent.length = 0;
    signalling.deliver({ t: "peer-joined", peer: THIRD_GUEST });
    expect(signalling.sent).toContainEqual({ t: "lobby", to: THIRD_GUEST.id, payload: HELLO });
  });

  it("keeps the mismatch notice when the refused seat leaves, and says why in the console", () => {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: overTheWire({ kind: "hello", ...RULES_STAMP }), from: GUEST_PEER.id });
    expect(warn).toHaveBeenCalledWith("David-Smash: not playing the other player's build:", expect.stringContaining("its engine rules are"));
    expect(useOnlineStore.getState().notice).toBe(seatMismatchNotice(1));
    // The refused guest leaves: the host is told why it went, not only that it did.
    fake.emit({ type: "peer", present: false, peer: GUEST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", notice: seatMismatchNotice(1), errorReason: null, seats: [] });
  });

  it("leaves when the host refuses its build, with the one sentence; a refusal from another guest changes nothing", async () => {
    const fake = relayedGuest(1, HOST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    fake.emit({ type: "lobby", message: REFUSE, from: SECOND_GUEST.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", errorReason: null });
    fake.emit({ type: "lobby", message: REFUSE, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "engine-mismatch",
      error: "The other player is running a different version. Both reload the page.",
    });
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });
});

describe("the waiting room and the host's Start (Plan 7, Phase B)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A newcomer the room seats at port 1, which the Start had left behind. */
  const NEWCOMER: PeerInfo = { id: "n1", role: "guest", port: 1 };

  const begin = (...seats: readonly (readonly [string, number])[]): LobbyMessage => ({
    kind: "begin",
    seats: seats.map(([id, port]) => ({ id, port })),
  });

  /** The begins `fake` sent, each with its address (undefined: to everyone). */
  const begins = (fake: ReturnType<typeof fakeSession>) =>
    fake.session.sendLobby.mock.calls.filter(([message]) => message.kind === "begin").map(([message, to]) => [message, to]);

  /** A host on the relay, its link open, as the room seats `peers`, each of whom has said this build. */
  function readyHost(...peers: PeerInfo[]) {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "route", route: "relay" });
    fake.emit({ type: "link", status: "open" });
    for (const peer of peers) fake.emit({ type: "peer", present: true, peer });
    for (const peer of peers) fake.emit({ type: "lobby", message: HELLO, from: peer.id });
    return fake;
  }

  /** Another machine, mid-test: its stores start as a fresh page's do. */
  function anotherMachine() {
    useOnlineStore.getState().reset();
    useMatchConfig.getState().reset();
  }

  /** `self`, a guest welcomed into a room seating `peers`, relayed, and connected by its host's hello: on a machine of its own. */
  function readyGuest(self: PeerInfo, ...peers: PeerInfo[]) {
    anotherMachine();
    const fake = fakeSession();
    fake.seatPort = self.port;
    fake.selfId = self.id;
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "guest" });
    for (const peer of peers) fake.emit({ type: "peer", present: true, peer });
    fake.emit({ type: "route", route: "relay" });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    return fake;
  }

  it("begins a room the host can start: compacts the seats to match ports and seats that many players", () => {
    // Seated at room ports 0, 2 and 3: port 1's player left before the Start.
    const fake = readyHost(SECOND_GUEST, THIRD_GUEST);
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", begun: false, localPort: 0 });
    expect(useMatchConfig.getState().players).toHaveLength(2);

    expect(beginRoom()).toBe(true);
    expect(begins(fake)).toEqual([[begin(["h1", 0], ["g2", 1], ["g3", 2]), undefined]]);
    expect(useOnlineStore.getState()).toMatchObject({
      begun: true,
      localPort: 0,
      status: "connected",
      seats: [
        { peerId: "g2", port: 1, build: "ok" },
        { peerId: "g3", port: 2, build: "ok" },
      ],
    });
    const { players, rules } = useMatchConfig.getState();
    expect(players.map((p) => p.port)).toEqual([0, 1, 2]);
    expect(rules.oneOnOne).toBe(false);
    expect(fake.session.lockRoster).toHaveBeenCalledWith(["g2", "g3"]);

    // The Start goes out once: a second press sends nothing and seats nobody again, so the picks stay.
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 1 }, from: SECOND_GUEST.id });
    expect(beginRoom()).toBe(false);
    expect(begins(fake)).toHaveLength(1);
    expect(fake.session.lockRoster).toHaveBeenCalledTimes(1);
    expect(useMatchConfig.getState().players[1].fighterId).toBe("fox");
  });

  it("refuses to begin before everyone is connected, or with nobody in", () => {
    // No room at all.
    expect(beginRoom()).toBe(false);

    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    expect(useOnlineStore.getState().status).toBe("waiting");
    expect(beginRoom()).toBe(false);
    // One seated, their build still to say.
    fake.emit({ type: "route", route: "relay" });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    expect(useOnlineStore.getState().status).toBe("linking");
    expect(beginRoom()).toBe(false);
    // One ready and one refused, still seated.
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    fake.emit({ type: "peer", present: true, peer: SECOND_GUEST });
    fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" }, from: SECOND_GUEST.id });
    expect(useOnlineStore.getState().status).toBe("linking");
    expect(beginRoom()).toBe(false);
    expect(begins(fake)).toEqual([]);
    expect(fake.session.lockRoster).not.toHaveBeenCalled();
    expect(useOnlineStore.getState()).toMatchObject({ begun: false, localPort: 0 });
    expect(useMatchConfig.getState().players).toHaveLength(2);

    // A room the begin cannot reach changes nothing either.
    const lost = readyHost(GUEST_PEER);
    lost.accepts = false;
    expect(beginRoom()).toBe(false);
    expect(useOnlineStore.getState().begun).toBe(false);
    expect(lost.session.lockRoster).not.toHaveBeenCalled();

    // A guest never begins, connected or not.
    const guest = readyGuest(GUEST_PEER, HOST_PEER);
    expect(useOnlineStore.getState().status).toBe("connected");
    expect(beginRoom()).toBe(false);
    expect(begins(guest)).toEqual([]);
  });

  it("follows the host's begin onto its own match port", () => {
    // At room port 3, port 1's player having left: it plays at port 2.
    const fake = readyGuest(THIRD_GUEST, HOST_PEER, SECOND_GUEST);
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", localPort: 3, begun: false });
    // Only the host begins a room.
    fake.emit({ type: "lobby", message: begin(["g2", 0], ["h1", 1], ["g3", 2]), from: SECOND_GUEST.id });
    expect(useOnlineStore.getState()).toMatchObject({ localPort: 3, begun: false });
    // Review Focus 3, this side: a fourth the room seated just before the host's begin, which does not list them.
    const late: PeerInfo = { id: "f1", role: "guest", port: 1 };
    fake.emit({ type: "peer", present: true, peer: late });
    fake.emit({ type: "lobby", message: { kind: "away", away: true }, from: late.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", remoteAway: true });

    fake.emit({ type: "lobby", message: begin(["h1", 0], ["g2", 1], ["g3", 2]), from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({
      begun: true,
      localPort: 2,
      status: "connected",
      seats: [
        { peerId: "h1", port: 0, build: "ok" },
        { peerId: "g2", port: 1, build: "pending" },
      ],
    });
    expect(useMatchConfig.getState().players.map((p) => p.port)).toEqual([0, 1, 2]);
    expect(fake.session.lockRoster).toHaveBeenCalledWith(["h1", "g2"]);
    // The unlisted fourth is gone, and with it their away.
    expect(useOnlineStore.getState().remoteAway).toBe(false);
    // Its picks go by match port from here.
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 4 }, from: SECOND_GUEST.id });
    expect(useMatchConfig.getState().players[1]).toMatchObject({ fighterId: "fox", costume: 4 });

    // A stranger the room seats after the begin is in nobody's list until a begin names them.
    const stranger: PeerInfo = { id: "x1", role: "guest", port: 1 };
    fake.emit({ type: "peer", present: true, peer: stranger });
    fake.emit({ type: "lobby", message: HELLO, from: stranger.id });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "mario", costume: 7 }, from: stranger.id });
    fake.emit({ type: "lobby", message: { kind: "away", away: true }, from: stranger.id });
    expect(useOnlineStore.getState().seats.map((seat) => seat.peerId)).toEqual(["h1", "g2"]);
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", remoteAway: false });
    expect(useMatchConfig.getState().players.map((p) => p.fighterId)).toEqual([null, "fox", null]);

    // g2 leaves: its match port waits for the next joiner, and this side for the host's word.
    fake.emit({ type: "peer", present: false, peer: SECOND_GUEST });
    expect(useOnlineStore.getState()).toMatchObject({ status: "linking", notice: seatLeftNotice(1) });
    expect(useMatchConfig.getState().players[1].fighterId).toBeNull();
    // The host's re-sent begin seats the stranger there: the hello it said first counts now, and this side greets it.
    fake.emit({ type: "lobby", message: begin(["h1", 0], ["x1", 1], ["g3", 2]), from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "connected",
      localPort: 2,
      seats: [
        { peerId: "h1", port: 0, build: "ok" },
        { peerId: "x1", port: 1, build: "ok" },
      ],
    });
    expect(fake.session.sendLobby.mock.calls.at(-1)).toEqual([HELLO, stranger.id]);
    expect(fake.session.lockRoster).toHaveBeenLastCalledWith(["h1", "x1"]);
    expect(useMatchConfig.getState().players.map((p) => p.port)).toEqual([0, 1, 2]);
  });

  it("Review Focus: a joiner whose hello is pending holds the Start, and one seated after the begin with no seat free is told and leaves", async () => {
    const fake = readyHost(GUEST_PEER);
    fake.emit({ type: "peer", present: true, peer: SECOND_GUEST });
    expect(beginRoom()).toBe(false);
    fake.emit({ type: "lobby", message: HELLO, from: SECOND_GUEST.id });
    expect(beginRoom()).toBe(true);
    const begun = begin(["h1", 0], ["g1", 1], ["g2", 2]);
    expect(begins(fake)).toEqual([[begun, undefined]]);

    // A fourth arrives just after the Start: every match port is seated, so the begin goes to them unchanged.
    fake.emit({ type: "peer", present: true, peer: THIRD_GUEST });
    expect(begins(fake)).toEqual([
      [begun, undefined],
      [begun, THIRD_GUEST.id],
    ]);
    fake.emit({ type: "lobby", message: HELLO, from: THIRD_GUEST.id });
    expect(useOnlineStore.getState()).toMatchObject({ status: "connected", notice: null });
    expect(useOnlineStore.getState().seats.map((seat) => seat.peerId)).toEqual(["g1", "g2"]);

    // On the newcomer's own screen, that begin, which does not list it, is the room gone.
    const newcomer = readyGuest(THIRD_GUEST, HOST_PEER, GUEST_PEER, SECOND_GUEST);
    newcomer.emit({ type: "lobby", message: overTheWire(begun), from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({
      status: "error",
      errorReason: "room-begun",
      error: "That room has already started its match. Ask the host for a new room.",
      begun: false,
    });
    await Promise.resolve();
    expect(newcomer.session.close).toHaveBeenCalledTimes(1);
  });

  it("Review Focus: a seat emptied after the begin goes to the next joiner, on the same port, with an empty panel", async () => {
    // Room ports 2 and 3 begin as match ports 1 and 2.
    const fake = readyHost(SECOND_GUEST, THIRD_GUEST);
    expect(beginRoom()).toBe(true);
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 6 }, from: THIRD_GUEST.id });
    expect(useMatchConfig.getState().players[2].fighterId).toBe("fox");

    fake.emit({ type: "peer", present: false, peer: THIRD_GUEST });
    expect(useOnlineStore.getState()).toMatchObject({ notice: "P3 left the room.", status: "linking", errorReason: null });
    expect(useMatchConfig.getState().players[2]).toMatchObject({ fighterId: null, costume: 2 });

    // The next joiner, whom the room seats at port 1, takes match port 2.
    fake.emit({ type: "peer", present: true, peer: NEWCOMER });
    const refilled = begin(["h1", 0], ["g2", 1], ["n1", 2]);
    expect(begins(fake).at(-1)).toEqual([refilled, undefined]);
    expect(fake.session.sendLobby.mock.calls.at(-1)).toEqual([HELLO, NEWCOMER.id]);
    expect(useOnlineStore.getState()).toMatchObject({
      status: "linking",
      notice: null,
      seats: [
        { peerId: "g2", port: 1, build: "ok" },
        { peerId: "n1", port: 2, build: "pending" },
      ],
    });
    expect(useMatchConfig.getState().players).toHaveLength(3);
    expect(useMatchConfig.getState().players[2].fighterId).toBeNull();
    fake.emit({ type: "lobby", message: HELLO, from: NEWCOMER.id });
    expect(useOnlineStore.getState().status).toBe("connected");

    // On the newcomer's own screen: the re-sent begin, then the host's hello addressed to it.
    anotherMachine();
    const own = fakeSession();
    own.seatPort = NEWCOMER.port;
    own.selfId = NEWCOMER.id;
    bindSession(own.session);
    own.emit({ type: "joined", role: "guest" });
    own.emit({ type: "peer", present: true, peer: HOST_PEER });
    own.emit({ type: "peer", present: true, peer: SECOND_GUEST });
    own.emit({ type: "route", route: "relay" });
    own.emit({ type: "link", status: "open" });
    expect(useOnlineStore.getState()).toMatchObject({ localPort: 1, status: "linking", begun: false });
    own.emit({ type: "lobby", message: overTheWire(refilled), from: HOST_PEER.id });
    own.emit({ type: "lobby", message: HELLO, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ localPort: 2, status: "connected", begun: true });
    expect(useMatchConfig.getState().players).toHaveLength(3);
    expect(own.session.lockRoster).toHaveBeenCalledWith(["h1", "g2"]);
    expect(fake.session.lockRoster).toHaveBeenLastCalledWith(["g2", "n1"]);
  });

  /**
   * Fix round 1 (review Minors 1 and 4): a seat kept through a leave with a
   * start out is the match's; once the start is withdrawn, the next joiner
   * takes that port, and the stale seat goes. A begin the room never gets
   * changes nothing.
   */
  it("gives the port of a seat kept through a leave to the next joiner once the start is withdrawn", () => {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    expect(beginRoom()).toBe(true);
    useOnlineStore.getState().patch({ config: CONFIG });
    // The guest leaves before the match took hold: its seat stays the match's, then the channel goes.
    fake.emit({ type: "peer", present: false, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", config: null, seats: [{ peerId: "g1", port: 1, build: "pending" }] });

    // A begin that cannot reach the room seats nobody.
    fake.accepts = false;
    fake.emit({ type: "peer", present: true, peer: NEWCOMER });
    expect(useOnlineStore.getState().seats).toEqual([{ peerId: "g1", port: 1, build: "pending" }]);
    expect(fake.session.lockRoster).toHaveBeenCalledTimes(1);
    fake.emit({ type: "peer", present: false, peer: NEWCOMER });

    fake.accepts = true;
    fake.emit({ type: "peer", present: true, peer: NEWCOMER });
    expect(begins(fake).at(-1)).toEqual([begin(["h1", 0], ["n1", 1]), undefined]);
    expect(useOnlineStore.getState()).toMatchObject({ errorReason: null, seats: [{ peerId: "n1", port: 1, build: "pending" }] });
    expect(fake.session.lockRoster).toHaveBeenLastCalledWith(["n1"]);
    fake.emit({ type: "link", status: "negotiating" });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO, from: NEWCOMER.id });
    expect(useOnlineStore.getState().status).toBe("connected");
  });

  /** Carried from Task 13: a channel that goes with a start out takes every seat with it, and says so. */
  it("names every seat the channel took when it goes with a start out", () => {
    const fake = readyHost(GUEST_PEER, SECOND_GUEST, THIRD_GUEST);
    expect(beginRoom()).toBe(true);
    useOnlineStore.getState().patch({ config: { ...CONFIG, fighters: ["mario", "fox", "mario", "fox"], costumes: [0, 1, 2, 3], controls: [0, 0, 0, 0] } });
    fake.emit({ type: "link", status: "waiting" });
    expect(seatLeftNotice(1, 2, 3)).toBe("P2, P3 and P4 left the room.");
    expect(seatLeftNotice(1, 3)).toBe("P2 and P4 left the room.");
    expect(useOnlineStore.getState()).toMatchObject({ status: "waiting", config: null, notice: "P2, P3 and P4 left the room." });
  });

  /** Carried from Task 13: mid-match the seats are the match's; a newcomer at a departed player's room port takes nothing. */
  it("never seats a newcomer over a seat mid-match", () => {
    const fake = readyHost(GUEST_PEER, SECOND_GUEST);
    expect(beginRoom()).toBe(true);
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: SECOND_GUEST.id });
    useOnlineStore.getState().patch({ config: { ...CONFIG, fighters: ["mario", "fox", "fox"], costumes: [0, 1, 2], controls: [0, 0, 0] } });
    fake.emit({ type: "peer", present: false, peer: SECOND_GUEST });
    const stranger: PeerInfo = { id: "x1", role: "guest", port: 2 };
    fake.emit({ type: "peer", present: true, peer: stranger });
    expect(useOnlineStore.getState().seats).toEqual([
      { peerId: "g1", port: 1, build: "ok" },
      { peerId: "g2", port: 2, build: "ok" },
    ]);
    expect(begins(fake).at(-1)).toEqual([begin(["h1", 0], ["g1", 1], ["g2", 2]), stranger.id]);
    expect(useMatchConfig.getState().players[2].fighterId).toBe("fox");
  });

  /** Carried from Task 13: each player's away is their own, and only a seated player's counts. */
  it("keeps each seat's away apart, hears it only from a seat, and clears only the seat that empties", () => {
    const fake = readyHost(GUEST_PEER, SECOND_GUEST);
    const away = (from: string, isAway: boolean) => fake.emit({ type: "lobby", message: { kind: "away", away: isAway }, from });
    away("x9", true);
    expect(useOnlineStore.getState().remoteAway).toBe(false);
    away(GUEST_PEER.id, true);
    away(SECOND_GUEST.id, true);
    away(GUEST_PEER.id, false);
    expect(useOnlineStore.getState().remoteAway).toBe(true);
    away(GUEST_PEER.id, true);
    fake.emit({ type: "peer", present: false, peer: SECOND_GUEST });
    expect(useOnlineStore.getState().remoteAway).toBe(true);
    away(GUEST_PEER.id, false);
    expect(useOnlineStore.getState().remoteAway).toBe(false);
  });

  /** Carried from Task 13: a refused player's pick is not the room's to show. */
  it("fills no panel from the pick of a seat it refused", () => {
    const fake = readyHost(GUEST_PEER);
    fake.emit({ type: "peer", present: true, peer: SECOND_GUEST });
    fake.emit({ type: "lobby", message: { ...HELLO, bones: "0badf00d" }, from: SECOND_GUEST.id });
    useMatchConfig.getState().configureOnline(3);
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 5 }, from: SECOND_GUEST.id });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "mario", costume: 4 }, from: GUEST_PEER.id });
    expect(useMatchConfig.getState().players.map((p) => p.fighterId)).toEqual([null, "mario", null]);
  });

  /**
   * Carried from Task 12 (its review's Minor 4): a relayed guest is never left
   * seated in the lobby without a host. Its host leaving the lobby, before the
   * Start or after it, closes its room (`host-left`).
   */
  it("closes a begun relayed guest's room when its host leaves the lobby", async () => {
    const fake = readyGuest(GUEST_PEER, HOST_PEER, SECOND_GUEST);
    fake.emit({ type: "lobby", message: begin(["h1", 0], ["g1", 1], ["g2", 2]), from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ begun: true, status: "connected" });
    fake.emit({ type: "peer", present: false, peer: HOST_PEER });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "host-left" });
    await Promise.resolve();
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });
});

describe("an error, once recorded", () => {
  function connectedHost() {
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role: "host" });
    fake.emit({ type: "peer", present: true, peer: GUEST_PEER });
    fake.emit({ type: "link", status: "open" });
    fake.emit({ type: "lobby", message: HELLO, from: GUEST_PEER.id });
    return fake;
  }

  it("outlasts the opponent leaving, which adds no notice under it", () => {
    const { emit } = connectedHost();
    emit({ type: "error", reason: "room-lost" });
    emit({ type: "peer", present: false, peer: GUEST_PEER });
    emit({ type: "link", status: "waiting" });
    expect(useOnlineStore.getState()).toMatchObject({ status: "error", errorReason: "room-lost", notice: null });
  });

  it("takes the place of a notice already showing", () => {
    const { emit } = connectedHost();
    emit({ type: "peer", present: false, peer: GUEST_PEER });
    expect(useOnlineStore.getState().notice).toBe(seatLeftNotice(1));
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
    emit({ type: "peer", present: true, peer: GUEST_PEER });
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
    emit({ type: "lobby", message: { kind: "start", config: CONFIG }, from: HOST_PEER.id });
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
      "unreadable-start",
      "host-left",
      "room-begun",
    ] as const;
    // The list is hand-written; tsc fails here when a reason is added without it.
    expectTypeOf<Exclude<OnlineErrorReason, (typeof reasons)[number]>>().toBeNever();
    for (const reason of reasons) {
      expect(roomErrorMessage(reason, "QRST").length).toBeGreaterThan(10);
    }
    expect(roomErrorMessage("not-found", "QRST")).toMatch(/QRST/);
    expect(roomErrorMessage("room-lost", "QRST")).toBe("Lost the room — create or join again.");
    // Plan 7 (D60): a direct link that cannot open moves to the room relay, so TURN advice no longer helps.
    expect(roomErrorMessage("link-failed", "QRST")).toBe("The connection to the other player failed. Leave the room and try again.");
    expect(roomErrorMessage("host-left", "QRST")).toBe("The host left, so the room has closed. Create or join another.");
    expect(roomErrorMessage("room-begun", "QRST")).toBe("That room has already started its match. Ask the host for a new room.");
    expect(roomErrorMessage("full", "QRST")).toBe("Room QRST already has four players.");
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

describe("control options online (Plan 5)", () => {
  const stickJumps = () => useMatchConfig.getState().players.map((p) => p.stickJump);

  it("takes the other player's Stick Jump from their pick, onto their port only; a pick without one is on", () => {
    useMatchConfig.getState().setStickJump(0, false);
    const { session, emit } = fakeSession();
    bindSession(session);
    emit({ type: "joined", role: "host" });
    emit({ type: "peer", present: true, peer: GUEST_PEER });
    expect(stickJumps()).toEqual([false, false]);
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2 }, from: GUEST_PEER.id });
    expect(stickJumps()).toEqual([false, true]);
    emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2, stickJump: false }, from: GUEST_PEER.id });
    expect(stickJumps()).toEqual([false, false]);
  });

  it("says its own Stick Jump in its pick only when it is off (P5-R25: absent is on)", () => {
    const guest = fakeSession();
    setActiveSession(guest.session);
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    useMatchConfig.getState().setFighter(1, "fox");
    expect(sendOwnPick(1)).toBe(true);
    useMatchConfig.getState().setStickJump(1, false);
    expect(sendOwnPick(1)).toBe(true);
    expect(guest.sent).toEqual([
      { kind: "pick", fighterId: "fox", costume: 1 },
      { kind: "pick", fighterId: "fox", costume: 1, stickJump: false },
    ]);
  });

  /**
   * P5-R26: an online session seats both ports with this machine's options,
   * and the other player's pick writes theirs over one of them. Leaving puts
   * this machine's back on its one human, whichever port was its own.
   */
  it.each([
    ["host", false, true],
    ["host", true, false],
    ["guest", false, true],
    ["guest", true, false],
  ] as const)("puts this machine's Stick Jump back on leaving, as the %s, whatever the other player's (mine %s, theirs %s)", (role, mine, theirs) => {
    useMatchConfig.getState().setStickJump(0, mine);
    const fake = fakeSession();
    bindSession(fake.session);
    fake.emit({ type: "joined", role });
    fake.emit({ type: "peer", present: true, peer: otherPeer(role) });
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "fox", costume: 2, ...(theirs ? {} : { stickJump: false }) }, from: otherPeer(role).id });
    const own = role === "host" ? 0 : 1;
    expect(useMatchConfig.getState().players[own].stickJump).toBe(mine);
    expect(useMatchConfig.getState().players[1 - own].stickJump).toBe(theirs);
    leaveOnline();
    expect(useMatchConfig.getState().online).toBe(false);
    expect(useMatchConfig.getState().players.map((p) => [p.kind, p.stickJump])).toEqual([
      ["human", mine],
      ["cpu", true],
    ]);
  });

  /**
   * P5-R24 (R20-1): a start without control options is a host on the rules
   * before Plan 5. This build reads it as a start it cannot play, carrying the
   * host's stamp, so the guest refuses it by name (its rules differ), tells the
   * host, and leaves, rather than wait for a match that never comes.
   */
  it("refuses, by name, a start from a host on the rules before Plan 5, which sends no control options", async () => {
    const older = { version: ENGINE_RULES_VERSION - 1, activeSlots: ACTIVE_SCRIPT_SLOTS };
    const { controls: _drop, ...rest } = CONFIG;
    void _drop;
    const wire = { ...rest, bones: engineFingerprint(GAME_SIM_CONTEXT, older), engineRules: rulesFingerprint(older) };
    const received = parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config: wire })));
    expect(received?.kind).toBe("unreadable-start");
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: received!, from: HOST_PEER.id });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "engine-mismatch" });
    expect(useOnlineStore.getState().error).toBe("The other player is running a different version. Both reload the page.");
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
    expect(warn.mock.calls[0].join(" ")).toContain(`its engine rules are ${rulesFingerprint(older)}, this build's are ${localBuild().engineRules}`);
    await Promise.resolve();
    expect(guest.session.close).toHaveBeenCalledTimes(1);
  });
});

/**
 * Plan 5, Task 20 fix round 1 (ruling R-T20a): during an online session, this
 * machine's Stick Jump is its own port's alone. A change to it is kept for after
 * the session and said again in this machine's pick, so the host's next start
 * carries it; the other port's is the other peer's, set only by their pick. The
 * session is bound here as the lobby binds it: `/controls` is reached mid-session
 * only through the browser's history, so it is tested at the store.
 */
describe("this machine's own Stick Jump during an online session (R-T20a)", () => {
  const START = { stageId: "battlefield", stageForm: "normal", rules: CONFIG.rules, seed: 5 } as const;

  /** A session seated as `role` and bound, as the lobby leaves it, with this machine's pick made. */
  function seated(role: Role) {
    const fake = fakeSession();
    setActiveSession(fake.session);
    bindSession(fake.session);
    fake.emit({ type: "joined", role });
    fake.emit({ type: "peer", present: true, peer: otherPeer(role) });
    const own = role === "host" ? 0 : 1;
    useMatchConfig.getState().setFighter(own, "fox");
    return { fake, own };
  }

  it.each(["host", "guest"] as const)("says a change in this machine's pick, as the %s, and only for its own port", (role) => {
    const { fake, own } = seated(role);
    expect(setOwnStickJump(false)).toBe(true);
    expect(useMatchConfig.getState().players.map((p) => p.stickJump)).toEqual(own === 0 ? [false, true] : [true, false]);
    expect(setOwnStickJump(true)).toBe(true);
    expect(fake.sent).toEqual([
      { kind: "pick", fighterId: "fox", costume: own, stickJump: false },
      { kind: "pick", fighterId: "fox", costume: own },
    ]);
  });

  it("carries the guest's mid-session change into the host's next start", () => {
    // The guest turns it off once it has picked: its pick goes out again...
    const { fake: guest } = seated("guest");
    setOwnStickJump(false);
    const said = guest.sent.at(-1)!;
    leaveOnline();
    useMatchConfig.getState().reset();
    // ...and the host, given it, starts the next match with it on port 2.
    const { fake: host } = seated("host");
    host.emit({ type: "lobby", message: overTheWire(said), from: GUEST_PEER.id });
    const start = buildStartConfig({ players: useMatchConfig.getState().players, ...START });
    expect(start.controls).toEqual([0, CONTROL_STICK_JUMP_OFF]);
  });

  it("carries the host's own mid-session change into its next start", () => {
    seated("host");
    useMatchConfig.getState().setFighter(1, "mario");
    setOwnStickJump(false);
    expect(buildStartConfig({ players: useMatchConfig.getState().players, ...START }).controls).toEqual([CONTROL_STICK_JUMP_OFF, 0]);
  });

  it("leaves a match under way as it started: it plays its start's options", () => {
    seated("guest");
    useOnlineStore.getState().patch({ config: CONFIG });
    setOwnStickJump(false);
    expect(useOnlineStore.getState().config).toBe(CONFIG);
    expect(useOnlineStore.getState().config?.controls).toEqual([0, 0]);
  });

  it.each(["host", "guest"] as const)("keeps the change on leaving, as the %s, whatever the other player's pick says after it", (role) => {
    const { fake } = seated(role);
    setOwnStickJump(false);
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: false, pad: DEFAULT_PAD_SETTINGS });
    // The other player's pick, theirs on, after the change: their port only.
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "mario", costume: 3 }, from: otherPeer(role).id });
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: false, pad: DEFAULT_PAD_SETTINGS });
    expect(useMatchConfig.getState().players[role === "host" ? 1 : 0].stickJump).toBe(true);
    leaveOnline();
    expect(useMatchConfig.getState().players.map((p) => [p.kind, p.stickJump])).toEqual([
      ["human", false],
      ["cpu", true],
    ]);
  });

  it("never lets a remote pick reach this machine's options", () => {
    const { fake } = seated("guest");
    fake.emit({ type: "lobby", message: { kind: "pick", fighterId: "mario", costume: 0, stickJump: false }, from: HOST_PEER.id });
    expect(useMatchConfig.getState().players[0].stickJump).toBe(false);
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: true, pad: DEFAULT_PAD_SETTINGS });
    leaveOnline();
    expect(useMatchConfig.getState().players[0].stickJump).toBe(true);
  });

  it("changes nothing with no session seated", () => {
    expect(setOwnStickJump(false)).toBe(false);
    expect(useMatchConfig.getState().players.map((p) => p.stickJump)).toEqual([true, true]);
    const unseated = fakeSession();
    setActiveSession(unseated.session);
    expect(setOwnStickJump(false)).toBe(false);
    expect(unseated.sent).toEqual([]);
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: true, pad: DEFAULT_PAD_SETTINGS });
  });

  /** Plan 5, Task 21: the pad is this machine's alone, read here; only the packed frame travels, so nothing is said. */
  it.each(["host", "guest"] as const)("keeps this machine's own pad on its own port, as the %s, sending nothing, and for after the session", (role) => {
    const { fake, own } = seated(role);
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    expect(setOwnPad(pad)).toBe(true);
    expect(useMatchConfig.getState().players.map((p) => p.pad)).toEqual(own === 0 ? [pad, DEFAULT_PAD_SETTINGS] : [DEFAULT_PAD_SETTINGS, pad]);
    expect(useMatchConfig.getState().localOptions).toEqual({ stickJump: true, pad });
    expect(fake.sent).toEqual([]);
    leaveOnline();
    expect(useMatchConfig.getState().players[0].pad).toEqual(pad);
  });

  it("changes no pad with no session seated", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    expect(setOwnPad(pad)).toBe(false);
    const unseated = fakeSession();
    setActiveSession(unseated.session);
    expect(setOwnPad(pad)).toBe(false);
    expect(useMatchConfig.getState().players.map((p) => p.pad)).toEqual([DEFAULT_PAD_SETTINGS, DEFAULT_PAD_SETTINGS]);
    expect(useMatchConfig.getState().localOptions.pad).toEqual(DEFAULT_PAD_SETTINGS);
  });

  /**
   * Plan 7, Phase B: the Start compacts the room's ports to the match's, so a player's room port
   * (`session.seatPort`) can differ from the port it plays, even in a room of two: here port 1's
   * player left before the Start, and the guest at room port 2 plays port 1.
   */
  describe("once the Start has moved this machine off its room seat's port", () => {
    function guestAtMatchPort1() {
      const fake = fakeSession();
      fake.seatPort = 2;
      fake.selfId = "g2";
      setActiveSession(fake.session);
      bindSession(fake.session);
      fake.emit({ type: "joined", role: "guest" });
      fake.emit({ type: "peer", present: true, peer: HOST_PEER });
      fake.emit({ type: "lobby", message: { kind: "begin", seats: [{ id: HOST_PEER.id, port: 0 }, { id: "g2", port: 1 }] }, from: HOST_PEER.id });
      expect(useOnlineStore.getState()).toMatchObject({ begun: true, localPort: 1 });
      expect(fake.session.seatPort).toBe(2);
      useMatchConfig.getState().setFighter(1, "fox");
      return fake;
    }

    it("changes Stick Jump on its match port and says it in the pick for that port", () => {
      const fake = guestAtMatchPort1();
      fake.sent.length = 0;
      expect(setOwnStickJump(false)).toBe(true);
      expect(useMatchConfig.getState().players.map((p) => p.stickJump)).toEqual([true, false]);
      // Port 1's pick, with its fighter and costume: the host applies it to this guest's panel.
      expect(fake.sent).toEqual([{ kind: "pick", fighterId: "fox", costume: 1, stickJump: false }]);
    });

    it("changes its pad on its match port", () => {
      const fake = guestAtMatchPort1();
      const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
      expect(setOwnPad(pad)).toBe(true);
      expect(useMatchConfig.getState().players.map((p) => p.pad)).toEqual([DEFAULT_PAD_SETTINGS, pad]);
      expect(useMatchConfig.getState().localOptions.pad).toEqual(pad);
      expect(fake.sent).toEqual([]);
    });
  });
});
