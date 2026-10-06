import { z } from "zod";

import { MAP_SLUGS } from "@/content/maps";
import { EMOJI_IDS } from "@/net/emojiIds";
import type { Action, AttackIntent, Rules } from "@/engine/types";
import { TURN_SECONDS } from "@/engine/types";

import { NAME_MAX, NAME_MIN, NAME_PATTERN } from "./names";

export { EMOJI_IDS };

/**
 * Every request body, validated at the boundary (SPEC §6).
 *
 * Two deliberate shapes:
 *
 * - **Colour is a NAME, never a hex** (F8). The schema is the nine-member
 *   union, matching `PlayerColour` and the database `check`; every hex lives
 *   in `globals.css`'s `--p-<name>` tokens and nowhere else, so re-tuning a
 *   palette value cannot invalidate a stored row or a response.
 * - **Only the actions a client may actually submit are accepted.**
 *   `GAME_STARTED`, `CARD_DRAWN`, `AUTO_DEPLOY`, `SEAT_TO_BOT`,
 *   `SEAT_TO_HUMAN` and `PORTALS_MOVED` are server-resolved — a client body
 *   carrying one is not a rule violation, it is not a request at all, and the
 *   schema refuses it with `400` rather than letting a handler decide.
 *   `ATTACK` is the one exception: it parses, so the handler can answer the
 *   `422 { code: "illegalAction" }` §5.5 specifies, because dice are the
 *   authority's to roll.
 */

export const ColourSchema = z.enum([
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "pink",
  "black",
  "white",
  "purple",
]);

export const BotTierSchema = z.enum(["beginner", "easy", "medium", "hard", "expert"]);

export const DisplayNameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .refine((value) => value.length >= NAME_MIN && value.length <= NAME_MAX, {
    message: `must be ${NAME_MIN}–${NAME_MAX} characters`,
  })
  .refine((value) => NAME_PATTERN.test(value), {
    message: "may contain letters, digits, spaces, dots, underscores and hyphens",
  });

/* ----------------------------------------------------------------- rules -- */

export const RulesSchema: z.ZodType<Rules> = z.object({
  winCondition: z.enum(["world", "percentage", "capitals"]),
  dominationThreshold: z.number().min(0.5).max(0.9),
  cardBonus: z.enum(["fixed", "progressive"]),
  diceMode: z.enum(["balancedBlitz", "trueRandom"]),
  fogOfWar: z.boolean(),
  capitals: z.boolean(),
  capitalDraftBonus: z.boolean(),
  blizzards: z.boolean(),
  portals: z.enum(["off", "stable", "unstable"]),
  manualPlacement: z.boolean(),
  maxRounds: z.number().int().positive().max(100).nullable(),
  roundDelayMs: z.number().int().min(0).max(10_000),
  // Online only, and only the five offered values (R79).
  turnSeconds: z
    .union([z.literal(TURN_SECONDS[0]), z.literal(TURN_SECONDS[1]), z.literal(TURN_SECONDS[2]), z.literal(TURN_SECONDS[3]), z.literal(TURN_SECONDS[4])])
    .nullable(),
  alliances: z.boolean(),
  aiDifficulty: BotTierSchema,
  // D106 — opt-in; a lobby row written before the field existed reads as "off".
  neutralHolding: z.boolean().default(false),
});

/* ------------------------------------------------------------- /api/session -- */

export const SessionPostSchema = z.object({
  displayName: DisplayNameSchema,
  colour: ColourSchema.optional(),
});

export const SessionPatchSchema = z
  .object({
    colour: ColourSchema.optional(),
    displayName: DisplayNameSchema.optional(),
  })
  .refine((value) => value.colour !== undefined || value.displayName !== undefined, {
    message: "nothing to change",
  });

/* ------------------------------------------------------------- /api/lobbies -- */

export const LobbyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/, "a four-letter lobby code");

/**
 * A slug the catalogue actually has.
 *
 * `loadMapFile` rejects an unknown slug, which would otherwise surface as a
 * `500` from `start` long after the lobby was created — so the lobby refuses
 * it at the boundary instead. The four fixtures stay allowed: they are not in
 * the player-facing picker (D39), but the e2e suite plays `tiny4` on purpose.
 */
export const MapSlugSchema = z
  .string()
  .trim()
  .refine((value) => MAP_SLUGS.includes(value), { message: "unknown map" });

export const LobbyCreateSchema = z.object({
  title: z.string().trim().min(1).max(40),
  mapSlug: MapSlugSchema,
  rules: RulesSchema,
  maxSeats: z.number().int().min(2).max(6),
});

export const SeatPatchSchema = z.union([
  z.object({ seat: z.number().int().min(0).max(5), kind: z.literal("open") }),
  z.object({
    seat: z.number().int().min(0).max(5),
    kind: z.literal("bot"),
    tier: BotTierSchema,
  }),
]);

export const LobbyPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(40).optional(),
    mapSlug: MapSlugSchema.optional(),
    rules: RulesSchema.optional(),
    seats: z.array(SeatPatchSchema).max(6).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.mapSlug !== undefined ||
      value.rules !== undefined ||
      value.seats !== undefined,
    { message: "nothing to change" },
  );

export const LobbyJoinSchema = z.object({
  seat: z.number().int().min(0).max(5).optional(),
});

export const LobbyReadySchema = z.object({ ready: z.boolean() });

/* ---------------------------------------------------------------- actions -- */

const seat = z.number().int().min(-2).max(5);
const territory = z.number().int().min(0).max(1023);
const cardId = z.string().min(1).max(64);

/**
 * The actions a client may submit, as a discriminated union on `type`.
 *
 * `ATTACK` is here only so the handler can distinguish "you sent dice" from
 * "you sent nonsense"; both payload shapes are accepted loosely because the
 * handler refuses the action outright.
 */
export const SubmittableActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CLAIM"),
    seat,
    territory,
    forNeutral: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("TRADE_CARDS"),
    seat,
    cards: z.tuple([cardId, cardId, cardId]),
    bonusTerritory: territory.nullable(),
  }),
  z.object({
    type: z.literal("DRAFT"),
    seat,
    territory,
    count: z.number().int().min(1).max(1000),
  }),
  z.object({ type: z.literal("ATTACK"), seat }).loose(),
  z.object({
    type: z.literal("MOVE_IN"),
    seat,
    count: z.number().int().min(0).max(1000),
  }),
  z.object({
    type: z.literal("FORTIFY"),
    seat,
    from: territory,
    to: territory,
    count: z.number().int().min(1).max(1000),
  }),
  z.object({ type: z.literal("END_PHASE"), seat }),
  z.object({ type: z.literal("END_TURN"), seat }),
  z.object({ type: z.literal("ALLIANCE_PROPOSE"), seat, to: seat }),
  z.object({ type: z.literal("ALLIANCE_ACCEPT"), seat, from: seat }),
  z.object({ type: z.literal("ALLIANCE_BREAK"), seat, with: seat }),
]);

export const AttackIntentSchema = z.union([
  z.object({
    from: territory,
    to: territory,
    mode: z.literal("manual"),
    attackerDice: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({
    from: territory,
    to: territory,
    mode: z.literal("blitz"),
    stopUntil: z.number().int().min(0).max(1000).optional(),
  }),
]);

/**
 * `ActionPost` (§5.5, F11): a discriminated union of the two things a client
 * can send. `kind: "action"` is every non-dice action, already applied
 * optimistically; `kind: "intent"` is an attack, never applied optimistically,
 * because the client must not predict dice.
 */
export const ActionPostSchema = z.discriminatedUnion("kind", [
  z.object({
    clientActionId: z.string().min(8).max(64),
    kind: z.literal("action"),
    action: SubmittableActionSchema,
  }),
  z.object({
    clientActionId: z.string().min(8).max(64),
    kind: z.literal("intent"),
    intent: AttackIntentSchema,
  }),
]);

export type ActionPost = z.infer<typeof ActionPostSchema>;

/** Narrow the parsed body back to the engine's own `Action` union. */
export function asAction(parsed: z.infer<typeof SubmittableActionSchema>): Action {
  return parsed as unknown as Action;
}

export function asIntent(parsed: z.infer<typeof AttackIntentSchema>): AttackIntent {
  return parsed as AttackIntent;
}

/* ------------------------------------------------------------------- chat -- */

export const ChatPostSchema = z
  .object({
    scope: z.enum(["global", "lobby", "game"]),
    scopeId: z.string().min(1).max(64).nullish(),
    lineId: z.number().int().min(1).max(42).optional(),
    emoji: z.enum(EMOJI_IDS).optional(),
  })
  // `ChatSend` is `{ lineId }` XOR `{ emoji }` — the same constraint the
  // `chat_messages` table carries as a `check`.
  .refine((value) => (value.lineId === undefined) !== (value.emoji === undefined), {
    message: "exactly one of lineId or emoji",
  })
  .refine((value) => value.scope === "global" || (value.scopeId ?? null) !== null, {
    message: "a lobby or game scope needs a scopeId",
  });
