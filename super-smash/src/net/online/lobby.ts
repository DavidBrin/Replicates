/**
 * What the two players say to each other before a match, through the room.
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
 */

import type { MatchRules } from "@/engine/types";
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
  /** The wire format (`PROTOCOL_VERSION`, net/packet.ts). A peer on another cannot read this one's packets. */
  readonly protocol: number;
  /** The bone-table fingerprint (`engineFingerprint`): another table puts hitboxes elsewhere. */
  readonly bones: string;
}

export interface OnlineMatchConfig {
  /** A 32-bit integer: `buildStartConfig` truncates the host's draw to one. */
  readonly seed: number;
  /** A concrete base stage id; Random is resolved by the host. */
  readonly stageId: string;
  readonly stageForm: StageForm;
  readonly rules: MatchRules;
  /** Concrete fighter ids for ports 0 and 1. */
  readonly fighters: readonly [string, string];
  readonly costumes: readonly [number, number];
}

export type LobbyMessage =
  | { readonly kind: "pick"; readonly fighterId: string | null; readonly costume: number }
  /** `rules` are the host's, for the guest to see before it starts; the start carries the ones played. */
  | { readonly kind: "stage"; readonly stageId: string; readonly form: StageForm; readonly rules?: MatchRules }
  | { readonly kind: "start"; readonly config: OnlineMatchConfig }
  | { readonly kind: "away"; readonly away: boolean }
  /** This side's `BuildStamp`, said each time its channel opens. Nothing starts until the other side's matches. */
  | { readonly kind: "hello"; readonly protocol: number; readonly bones: string };

/** A sanity bound, not a roster fact: the renderer falls back to the default colours past a fighter's alts. */
const MAX_COSTUME = 15;
const MIN_SEED = -0x8000_0000;
const MAX_SEED = 0x7fff_ffff;
/** The packet header carries the protocol version in one byte (net/packet.ts). */
const MAX_PROTOCOL = 0xff;
/** `BoneTable.fingerprint`: 8 lowercase hex digits. */
const FINGERPRINT = /^[0-9a-f]{8}$/;

export function parseLobbyMessage(payload: unknown): LobbyMessage | null {
  if (!isRecord(payload)) return null;
  switch (payload.kind) {
    case "pick": {
      const raw = payload.fighterId;
      // `null` clears the pick and Random is a token; anything else must be on this build's roster.
      const fighterId = raw === null || raw === RANDOM_FIGHTER ? raw : isFighterId(raw) ? raw : undefined;
      const costume = payload.costume;
      if (fighterId === undefined || !isCostume(costume)) return null;
      return { kind: "pick", fighterId, costume };
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
      const config = parseConfig(payload.config);
      return config ? { kind: "start", config } : null;
    }
    case "away": {
      const away = payload.away;
      return typeof away === "boolean" ? { kind: "away", away } : null;
    }
    case "hello": {
      const build = parseBuild(payload);
      return build ? { kind: "hello", protocol: build.protocol, bones: build.bones } : null;
    }
    default:
      return null;
  }
}

function parseConfig(value: unknown): OnlineMatchConfig | null {
  if (!isRecord(value)) return null;
  const { seed, stageId, stageForm, rules, fighters, costumes } = value;
  if (!isInRange(seed, MIN_SEED, MAX_SEED)) return null;
  if (!isStageId(stageId) || !isStageForm(stageForm)) return null;
  const parsedRules = parseRules(rules);
  if (!parsedRules) return null;
  if (!Array.isArray(fighters) || fighters.length !== 2) return null;
  const [f0, f1] = fighters as unknown[];
  if (!isFighterId(f0) || !isFighterId(f1)) return null;
  if (!Array.isArray(costumes) || costumes.length !== 2) return null;
  const [c0, c1] = costumes as unknown[];
  if (!isCostume(c0) || !isCostume(c1)) return null;
  return { seed, stageId, stageForm, rules: parsedRules, fighters: [f0, f1], costumes: [c0, c1] };
}

function parseBuild(value: Record<string, unknown>): BuildStamp | null {
  const { protocol, bones } = value;
  if (!isInRange(protocol, 0, MAX_PROTOCOL)) return null;
  if (typeof bones !== "string" || !FINGERPRINT.test(bones)) return null;
  return { protocol, bones };
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

function isStageForm(value: unknown): value is StageForm {
  return typeof value === "string" && (STAGE_FORMS as readonly string[]).includes(value);
}

/** An integer in `[min, max]`; `NaN`, the infinities and fractions all fail. */
function isInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
