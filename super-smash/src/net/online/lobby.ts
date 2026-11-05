/**
 * What the players (two to four) say to each other before a match, through the room.
 *
 * The host is authoritative: it picks the stage, resolves every Random, draws
 * the seed and sends one `start` carrying the whole match. Both peers then
 * build the identical initial state from that config — which is what rollback
 * requires, since a single differing byte at frame 0 is a desync forever.
 *
 * Validated hard, because a `start` that names a fighter this build does not
 * have would throw inside `createInitialState` on the other machine. The
 * payload is an opaque record off the network (the room only checks its `kind`
 * and its size), so every field is read by name and checked for type and range
 * against this build's roster and stages, and the result is built fresh from
 * those reads. Nothing is spread or assigned from the payload, so extra keys
 * (a `__proto__` among them) never reach what the lobby holds.
 *
 * Two builds that differ can still talk here (Plan 2 Task 27). Each side says
 * its build in a `hello`, and a start carries the host's; both are read
 * before anything else, so another build's start is told apart even when the
 * rest of it names what this build lacks. Kinds this build does not know are
 * dropped, as older builds drop the ones added since.
 */

import { CONTROL_BITS, type MatchRules } from "@/engine/types";
import { getFighter } from "@/fighters";
import {
  MAX_STOCKS,
  MAX_TIME_FRAMES,
  MIN_STOCKS,
  RANDOM_FIGHTER,
  RANDOM_STAGE,
  STAGE_FORMS,
  type StageForm,
} from "@/lib/matchConfig";
import { getStage } from "@/stages";
import { isRecord } from "../signalProtocol";

/**
 * Which build a peer runs, as far as playing each other goes (Plan 2 Task 27).
 * Two builds that differ here are two different games, so nothing starts
 * between them: each side says its own in a `hello` as its channel opens.
 */
export interface BuildStamp {
  /**
   * The deploy: the commit it was built from, marked when the tree had
   * uncommitted changes (next.config.ts), or "dev". Any change to the
   * simulation is another game, and most change nothing else here.
   */
  readonly build: string;
  /** The wire format (`PROTOCOL_VERSION`, net/packet.ts). A peer on another cannot read this one's packets. */
  readonly protocol: number;
  /**
   * The engine fingerprint (`engineFingerprint`: the bone table, Plan 2 Task
   * 27, and the rules version and running scripts, Plan 3 Task 20). Another
   * table puts hitboxes elsewhere, and other rules play another game. The
   * name is Plan 2's.
   */
  readonly bones: string;
  /**
   * The rules' half of `bones` on its own (`rulesFingerprint`), so a refusal
   * can say which half differs. A peer from before it says none, which is a
   * stamp this build cannot read, and is refused as a build from before the
   * handshake is.
   */
  readonly engineRules: string;
}

/**
 * How many players an online match seats: the local bounds (`MIN_PLAYERS` and
 * `MAX_PLAYERS`, lib/matchConfig). They are said again here so this parser
 * takes no new import from that store; a test (game/onlineConfig.test.ts)
 * holds the two pairs equal.
 */
export const ONLINE_MIN_PLAYERS = 2;
export const ONLINE_MAX_PLAYERS = 4;

/** The host's `BuildStamp` rides with it: a guest on another build refuses the start (`refuse`). */
export interface OnlineMatchConfig extends BuildStamp {
  /** A 32-bit integer: `buildStartConfig` truncates the host's draw to one. */
  readonly seed: number;
  /** A concrete base stage id; Random is resolved by the host. */
  readonly stageId: string;
  readonly stageForm: StageForm;
  readonly rules: MatchRules;
  /**
   * Concrete fighter ids, one per port from port 0: `ONLINE_MIN_PLAYERS` to
   * `ONLINE_MAX_PLAYERS` of them, and `costumes` and `controls` are as long.
   */
  readonly fighters: readonly string[];
  readonly costumes: readonly number[];
  /**
   * Each port's control options (`CONTROL_*` bits, Plan 5): the sim reads them
   * on both peers. Required (ruling P5-R24): a start without them is from a
   * build before Plan 5, on other rules, and is read as one this build cannot
   * play, its stamp intact, so the guest refuses it by name.
   */
  readonly controls: readonly number[];
}

export type LobbyMessage =
  /** `stickJump` (Plan 5) is said only when it is off (ruling P5-R25): absent is on. */
  | { readonly kind: "pick"; readonly fighterId: string | null; readonly costume: number; readonly stickJump?: boolean }
  /** `rules` are the host's, for the guest to see before it starts; the start carries the ones played. */
  | { readonly kind: "stage"; readonly stageId: string; readonly form: StageForm; readonly rules?: MatchRules }
  | { readonly kind: "start"; readonly config: OnlineMatchConfig }
  | { readonly kind: "away"; readonly away: boolean }
  /** This side's `BuildStamp`, said each time its channel opens. Nothing starts until the other side's matches. */
  | { readonly kind: "hello"; readonly build: string; readonly protocol: number; readonly bones: string; readonly engineRules: string }
  /**
   * The guest cannot play the host's start: the host runs another build
   * ("engine-mismatch"), or sent one this build cannot read though its stamp
   * is this build's ("unreadable-start"), which no build that checks what it
   * sends does (`OnlineSession.sendLobby`). From the host to one guest, in
   * the lobby (Plan 7, Phase B): the host will not play that guest's build
   * ("engine-mismatch"), or that guest never answered through the room
   * ("link-failed": its tab most likely could not run), and the guest leaves.
   */
  | { readonly kind: "refuse"; readonly reason: RefuseReason }
  /**
   * The host's Start (Plan 7, Phase B): who plays, and at which match port.
   * The host is port 0 and the others follow in seat order, compacted to
   * `1..n-1`, so a player can play on another port than the room seated them
   * at. Sent again, with a vacated port filled, whenever a newcomer arrives
   * after it; a newcomer it does not list has no place in the room, and leaves.
   */
  | { readonly kind: "begin"; readonly seats: readonly BeginSeat[] };

/** One player of a begun room: the room's id for them, and the port they play. */
export interface BeginSeat {
  readonly id: string;
  readonly port: number;
}

export type RefuseReason = "engine-mismatch" | "unreadable-start" | "link-failed";

/**
 * A start this build cannot play as sent. `build` is the stamp it carries,
 * read before anything else, or null when it has none this build can read (a
 * build from before the stamp): the guest refuses an unreadable start, of
 * another build or of its own, rather than drop it, which would leave the
 * host playing alone and the guest waiting on a match that never comes. Only
 * `parseLobbyMessage` makes one; nothing sends it.
 */
export interface UnreadableStart {
  readonly kind: "unreadable-start";
  readonly build: BuildStamp | null;
}

/** A lobby message as it arrives: one that can be sent, or a start this build cannot read. */
export type ReceivedLobbyMessage = LobbyMessage | UnreadableStart;

/** A sanity bound, not a roster fact: the renderer falls back to the default colours past a fighter's alts. */
const MAX_COSTUME = 15;
const MIN_SEED = -0x8000_0000;
const MAX_SEED = 0x7fff_ffff;
/**
 * A commit id as git abbreviates it, optionally with `-` and 8 hex digits of
 * the uncommitted changes it was built with (or `-dirty-unknown`, for changes
 * `next dev` could not read), or "dev" for a build git could not name.
 * next.config.ts checks the same form.
 */
const BUILD_ID = /^([0-9a-f]{7,40}(-([0-9a-f]{8}|dirty-unknown))?|dev)$/;
/** The packet header carries the protocol version in one byte (net/packet.ts). */
const MAX_PROTOCOL = 0xff;
/** `BoneTable.fingerprint`, `engineFingerprint` and `rulesFingerprint`: 8 lowercase hex digits. */
const FINGERPRINT = /^[0-9a-f]{8}$/;

export function parseLobbyMessage(payload: unknown): ReceivedLobbyMessage | null {
  if (!isRecord(payload)) return null;
  switch (payload.kind) {
    case "pick": {
      const raw = payload.fighterId;
      // `null` clears the pick and Random is a token; anything else must be on this build's roster.
      const fighterId = raw === null || raw === RANDOM_FIGHTER ? raw : isFighterId(raw) ? raw : undefined;
      const costume = payload.costume;
      if (fighterId === undefined || !isCostume(costume)) return null;
      // Plan 5: the player's Stick Jump rides on its pick; absent is the default, on.
      const stickJump = payload.stickJump;
      if (stickJump !== undefined && typeof stickJump !== "boolean") return null;
      return stickJump === undefined ? { kind: "pick", fighterId, costume } : { kind: "pick", fighterId, costume, stickJump };
    }
    case "stage": {
      const stageId = payload.stageId;
      const form = payload.form;
      // The host may leave the stage on Random until it starts the match.
      if (!(stageId === RANDOM_STAGE || isStageId(stageId)) || !isStageForm(form)) return null;
      // Only shown, never played, so rules this side cannot read are left
      // out rather than costing the stage they came with.
      const rules = parseRules(payload.rules);
      return rules ? { kind: "stage", stageId, form, rules } : { kind: "stage", stageId, form };
    }
    case "start": {
      const raw = payload.config;
      if (!isRecord(raw)) return null;
      // The build before anything else: another build's start may name a
      // fighter or a stage this one lacks, and must still be told apart.
      const stamp = parseBuild(raw);
      const config = stamp && parseConfig(raw, stamp);
      return config ? { kind: "start", config } : { kind: "unreadable-start", build: stamp };
    }
    case "away": {
      const away = payload.away;
      return typeof away === "boolean" ? { kind: "away", away } : null;
    }
    case "hello": {
      const stamp = parseBuild(payload);
      return stamp
        ? { kind: "hello", build: stamp.build, protocol: stamp.protocol, bones: stamp.bones, engineRules: stamp.engineRules }
        : null;
    }
    case "refuse": {
      const reason = payload.reason;
      return reason === "engine-mismatch" || reason === "unreadable-start" || reason === "link-failed" ? { kind: "refuse", reason } : null;
    }
    case "begin": {
      const seats = parseBeginSeats(payload.seats);
      return seats ? { kind: "begin", seats } : null;
    }
    default:
      return null;
  }
}

/** A peer id as the room makes them (`crypto.randomUUID().slice(0, 8)`), with room to spare. */
const MAX_PEER_ID_LENGTH = 16;

/**
 * A begin's players: `ONLINE_MIN_PLAYERS` to `ONLINE_MAX_PLAYERS` of them,
 * each a distinct id of 1 to 16 characters, on the ports `0..n-1`, each port
 * once. Anything else would seat two players on one port, or leave a port of
 * the match with nobody to play it.
 */
function parseBeginSeats(value: unknown): BeginSeat[] | null {
  if (!Array.isArray(value) || value.length < ONLINE_MIN_PLAYERS || value.length > ONLINE_MAX_PLAYERS) return null;
  const seats: BeginSeat[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry: unknown = value[i];
    if (!isRecord(entry)) return null;
    const { id, port } = entry;
    if (typeof id !== "string" || id.length < 1 || id.length > MAX_PEER_ID_LENGTH) return null;
    if (!isInRange(port, 0, value.length - 1)) return null;
    if (seats.some((seat) => seat.id === id || seat.port === port)) return null;
    seats.push({ id, port });
  }
  return seats;
}

function parseConfig(value: Record<string, unknown>, stamp: BuildStamp): OnlineMatchConfig | null {
  const { seed, stageId, stageForm, rules, fighters, costumes, controls } = value;
  if (!isInRange(seed, MIN_SEED, MAX_SEED)) return null;
  if (!isStageId(stageId) || !isStageForm(stageForm)) return null;
  const parsedRules = parseRules(rules);
  if (!parsedRules) return null;
  const parsedFighters = readPerPort(fighters, isFighterId);
  const parsedCostumes = readPerPort(costumes, isCostume);
  const parsedControls = readPerPort(controls, isControls);
  if (!parsedFighters || !parsedCostumes || !parsedControls) return null;
  if (parsedCostumes.length !== parsedFighters.length || parsedControls.length !== parsedFighters.length) return null;
  return {
    seed,
    stageId,
    stageForm,
    rules: parsedRules,
    fighters: parsedFighters,
    costumes: parsedCostumes,
    controls: parsedControls,
    build: stamp.build,
    protocol: stamp.protocol,
    bones: stamp.bones,
    engineRules: stamp.engineRules,
  };
}

/**
 * One entry per port: an array of `ONLINE_MIN_PLAYERS` to `ONLINE_MAX_PLAYERS`
 * entries that each pass `isEntry`, copied out by index into a fresh array. A
 * gap in a sparse array reads as `undefined` and fails the check.
 */
function readPerPort<T>(value: unknown, isEntry: (entry: unknown) => entry is T): T[] | null {
  if (!Array.isArray(value) || value.length < ONLINE_MIN_PLAYERS || value.length > ONLINE_MAX_PLAYERS) return null;
  const entries: T[] = [];
  for (let port = 0; port < value.length; port++) {
    const entry: unknown = value[port];
    if (!isEntry(entry)) return null;
    entries.push(entry);
  }
  return entries;
}

function parseBuild(value: Record<string, unknown>): BuildStamp | null {
  const { build, protocol, bones, engineRules } = value;
  if (typeof build !== "string" || !BUILD_ID.test(build)) return null;
  if (!isInRange(protocol, 0, MAX_PROTOCOL)) return null;
  if (typeof bones !== "string" || !FINGERPRINT.test(bones)) return null;
  if (typeof engineRules !== "string" || !FINGERPRINT.test(engineRules)) return null;
  return { build, protocol, bones, engineRules };
}

function parseRules(value: unknown): MatchRules | null {
  if (!isRecord(value)) return null;
  const { mode, stocks, timeLimit, smashBall, oneOnOne } = value;
  if (mode !== "stock" && mode !== "time") return null;
  if (!isInRange(stocks, MIN_STOCKS, MAX_STOCKS)) return null;
  if (!isInRange(timeLimit, 0, MAX_TIME_FRAMES)) return null;
  if (typeof smashBall !== "boolean" || typeof oneOnOne !== "boolean") return null;
  return { mode, stocks, timeLimit, smashBall, oneOnOne };
}

/** A concrete roster entry: Random is not one, and neither is anything this build lacks. */
function isFighterId(value: unknown): value is string {
  return typeof value === "string" && getFighter(value) !== undefined;
}

/** A base stage. `getStage` does not know the Ω and Battlefield form ids; the form travels separately. */
function isStageId(value: unknown): value is string {
  return typeof value === "string" && getStage(value) !== undefined;
}

function isCostume(value: unknown): value is number {
  return isInRange(value, 0, MAX_COSTUME);
}

/** A set of control option bits (Plan 5, `CONTROL_BITS`), and nothing else. */
function isControls(value: unknown): value is number {
  return isInRange(value, 0, CONTROL_BITS) && (value & ~CONTROL_BITS) === 0;
}

function isStageForm(value: unknown): value is StageForm {
  return typeof value === "string" && (STAGE_FORMS as readonly string[]).includes(value);
}

/** An integer in `[min, max]`; `NaN`, the infinities and fractions all fail. */
function isInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
