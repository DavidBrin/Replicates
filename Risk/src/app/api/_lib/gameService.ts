import "server-only";

import { getDb } from "@/adapters/db";
import type { SqlExecutor } from "@/adapters/db/driver";
import { ActionsRepository } from "@/adapters/db/repositories/actions";
import { ChatRepository } from "@/adapters/db/repositories/chat";
import {
  GamesRepository,
  type GameSeatInput,
  type GameSecretRow,
} from "@/adapters/db/repositories/games";
import { newGameId, newSeed } from "@/adapters/db/repositories/ids";
import { config } from "@/config/env";
import type {
  Action,
  BotTier,
  Card,
  GameConfig,
  GameState,
  MapDef,
  RuleErrorCode,
  Rules,
  Seat,
  SeatConfig,
} from "@/engine/types";
import type { ChatLine, LoggedAction, PresenceRow } from "@/ports/sync";

import { loadMapDef, oddsFor, serverEngine, type ServerEngine } from "./engine";
import {
  autoSkipAction,
  AWAY_SECONDS,
  COMPACTION_THRESHOLD,
  currentSeatOf,
  DEFAULT_TURN_SECONDS,
  foldActions,
  grudgeFor,
  MAX_TICK_ACTIONS,
  MISSED_TURNS_TO_BOT,
  nextBotAction,
  storeGrudge,
  TICK_LEASE_SECONDS,
  turnSecondsFor,
} from "./gameState";
import { asAction, asIntent, type ActionPost } from "./schemas";

/**
 * The authoritative game: creation, the append path, the lazy tick and the
 * poll's body (SPEC §5.5–§5.8, §6).
 *
 * Every function here returns a **result object**, never a `Response`. The
 * routes map those onto status codes, which keeps §6's status table readable
 * in one place and lets the route tests assert on the logic rather than on
 * parsed JSON.
 */

/* ----------------------------------------------------------------- types -- */

export type SubmitResult =
  | { readonly kind: "ok"; readonly seq: number; readonly actions: LoggedAction[] }
  | { readonly kind: "notFound" }
  | { readonly kind: "notSeated" }
  | { readonly kind: "notYourTurn" }
  | { readonly kind: "finished" }
  | { readonly kind: "illegalAction" }
  | { readonly kind: "ruleError"; readonly code: RuleErrorCode };

/** POLL 3's body (§6). `games.seed` is absent, because it is a column (D5). */
export interface GameSync {
  seq: number;
  fromSeq?: number;
  snapshot?: GameState;
  snapshotSeq?: number;
  actions: LoggedAction[];
  presence: PresenceRow[];
  turnDeadline: string | null;
  chat: ChatLine[];
  you: { seat: number | null; cards: Card[] };
  status: "playing" | "finished" | "abandoned";
}

export type PollResult =
  | { readonly kind: "unchanged"; readonly seq: number }
  | { readonly kind: "body"; readonly seq: number; readonly body: GameSync }
  | { readonly kind: "notFound" }
  | { readonly kind: "notSeated" };

/** Thrown out of the append transaction when the idempotency index fires. */
class DuplicateSubmission extends Error {
  constructor(readonly logged: LoggedAction) {
    super("duplicate submission");
    this.name = "DuplicateSubmission";
  }
}

/* ------------------------------------------------------------- the fold -- */

interface Authoritative {
  readonly row: GameSecretRow;
  readonly map: MapDef;
  readonly state: GameState;
}

/**
 * The lagging snapshot folded forward over the log.
 *
 * **The map is loaded before any fold** (§5.1, F44) and memoised per slug per
 * process, so a cold start pays for it once rather than every request.
 */
async function withFold(
  db: SqlExecutor,
  engine: ServerEngine,
  row: GameSecretRow,
): Promise<Authoritative> {
  const map = await loadMapDef(row.mapSlug);
  const log = await new ActionsRepository(db).between(row.id, row.snapshotSeq, row.seq);
  return { row, map, state: foldActions(engine, row.snapshot, map, log) };
}

async function authoritative(
  db: SqlExecutor,
  engine: ServerEngine,
  gameId: string,
): Promise<Authoritative | null> {
  const row = await new GamesRepository(db).secret(gameId);
  return row ? withFold(db, engine, row) : null;
}

/**
 * Write the head columns back after an append.
 *
 * `snapshot`, `snapshot_seq` and `state_hash` move **together or not at
 * all**, so §6.2's invariant
 * `games.snapshot = fold(apply, initialState, actions[1..snapshot_seq])`
 * always holds; they advance only once the fold has drifted past
 * {@link COMPACTION_THRESHOLD}. See that constant for why the snapshot has to
 * lag rather than track `seq`.
 */
async function commitState(
  db: SqlExecutor,
  engine: ServerEngine,
  row: GameSecretRow,
  state: GameState,
  seq: number,
  botMemory: Record<string, { grudge: number[] }>,
): Promise<void> {
  const seat = currentSeatOf(state);
  const seatIsBot = state.seats[seat]?.kind === "bot";
  const seconds = turnSecondsFor(state.rules) ?? DEFAULT_TURN_SECONDS;
  const compact = seq - row.snapshotSeq > COMPACTION_THRESHOLD;

  await new GamesRepository(db).commit(row.id, {
    seq,
    snapshot: compact ? state : row.snapshot,
    snapshotSeq: compact ? seq : row.snapshotSeq,
    stateHash: compact ? engine.hashState(state) : row.stateHash,
    currentSeat: seat,
    phase: state.phase,
    // A bot's turn carries no deadline: there is nobody to time out.
    turnSeconds: state.outcome !== null || seatIsBot ? null : seconds,
    status: state.outcome !== null ? "finished" : row.status,
    winnerSeat: state.outcome?.winner ?? row.winnerSeat,
    botMemory,
  });
}

/* --------------------------------------------------------- game creation -- */

/**
 * Create the game a lobby's `BATTLE` button starts.
 *
 * The opening is one action — `GAME_STARTED` at `seq = 1` — carrying the
 * whole deal, the modifier placement, the turn order and every seat's
 * persona, all resolved here from `games.seed`. The seed stays on the row
 * (D5): `GameState` has no field for it, so the response serialiser cannot
 * reach it and there is nothing to strip.
 */
export async function createGame(input: {
  lobbyId: string | null;
  mapSlug: string;
  rules: Rules;
  seats: readonly GameSeatInput[];
}): Promise<string> {
  const engine = serverEngine();
  const map = await loadMapDef(input.mapSlug);
  const seed = config().online.fixedSeed ?? newSeed();
  const gameId = newGameId();

  const seatConfigs: SeatConfig[] = input.seats.map((seat) => ({
    kind: seat.kind,
    name: seat.displayName,
    colour: seat.colour,
    tier: seat.kind === "bot" ? (seat.tier ?? input.rules.aiDifficulty) : null,
    ...(seat.playerId === null ? {} : { playerId: seat.playerId }),
  }));

  const gameConfig: GameConfig = {
    mapSlug: input.mapSlug,
    rules: input.rules,
    seats: seatConfigs,
    seed,
  };

  const personas = engine.drawPersonas(
    seatConfigs.map((seat) => seat.tier),
    engine.rngFor(seed, "personaAssign", 0),
    engine.rngFor(seed, "personaJitter", 0),
  );

  const started = engine.dealTerritories(map, gameConfig, personas, {
    deal: engine.rngFor(seed, "deal", 0),
    turnOrder: engine.rngFor(seed, "turnOrder", 0),
    modifierPlace: engine.rngFor(seed, "modifierPlace", 0),
  });

  const state = engine.createInitialState(map, started);
  const hash = engine.hashState(state);
  const seat = currentSeatOf(state);
  const seatIsBot = state.seats[seat]?.kind === "bot";

  await getDb().transaction(async (tx) => {
    await new GamesRepository(tx).create({
      id: gameId,
      lobbyId: input.lobbyId,
      mapSlug: input.mapSlug,
      rules: input.rules,
      seed,
      // The snapshot IS the state after `GAME_STARTED`, so `snapshot_seq` is
      // 1 and not 0: `createInitialState` folds that action into an empty
      // board and there is no representable state before it.
      snapshot: state,
      snapshotSeq: 1,
      seq: 1,
      stateHash: hash,
      currentSeat: seat,
      phase: state.phase,
      turnSeconds: seatIsBot ? null : (turnSecondsFor(input.rules) ?? DEFAULT_TURN_SECONDS),
      seats: input.seats,
    });
    await new ActionsRepository(tx).append({
      gameId,
      seq: 1,
      action: started,
      actor: "server",
      clientActionId: null,
      stateHash: hash,
    });
  });

  return gameId;
}

/* ------------------------------------------------------------ the append -- */

interface ChainStep {
  readonly action: Action;
  readonly actor: "human" | "bot" | "server";
  readonly clientActionId?: string | null;
}

/**
 * Apply and append a run of actions, each at the next `seq`, each stamped
 * with the hash of the state **after** it (§6.2's fourth invariant).
 *
 * One helper for the submit path, the resign path and the reclaim, so the
 * three can never disagree about `seq` or about which hash goes on which row.
 */
async function appendChain(
  tx: SqlExecutor,
  engine: ServerEngine,
  row: GameSecretRow,
  from: GameState,
  map: MapDef,
  steps: readonly ChainStep[],
): Promise<{ state: GameState; seq: number; logged: LoggedAction[] }> {
  const actions = new ActionsRepository(tx);
  let state = from;
  let seq = row.seq;
  const logged: LoggedAction[] = [];

  for (const step of steps) {
    const result = engine.apply(state, map, step.action);
    if (result.error) {
      throw new Error(`the authority refused its own ${step.action.type}: ${result.error.code}`);
    }
    state = result.state;
    seq += 1;
    const appended = await actions.append({
      gameId: row.id,
      seq,
      action: step.action,
      actor: step.actor,
      clientActionId: step.clientActionId ?? null,
      stateHash: engine.hashState(state),
    });
    if (appended.kind === "duplicate") throw new DuplicateSubmission(appended.logged);
    logged.push(appended.logged);
  }

  return { state, seq, logged };
}

/**
 * `POST /api/games/:id/actions` — one transaction, `select … for update`.
 *
 * The lock is the fence that stops a double-clicked Attack racing two inserts
 * for `seq + 1`: the second submitter blocks, re-reads, and finds the first
 * action already there (§5.5). With the row held, the idempotency pre-check
 * below cannot be raced either; the `23505` catch underneath it is belt and
 * braces rather than the mechanism.
 */
export async function submitAction(
  gameId: string,
  playerId: string,
  post: ActionPost,
): Promise<SubmitResult> {
  const engine = serverEngine();

  // The slug is read outside the transaction so a cold map load is not
  // holding a row lock. It is immutable for a game's lifetime.
  const head = await new GamesRepository(getDb()).head(gameId);
  if (!head) return { kind: "notFound" };
  await loadMapDef(head.mapSlug);

  try {
    return await getDb().transaction(async (tx): Promise<SubmitResult> => {
      const games = new GamesRepository(tx);
      const actions = new ActionsRepository(tx);

      const row = await games.secretForUpdate(gameId);
      if (!row) return { kind: "notFound" };

      const seat = await games.seatOf(gameId, playerId);
      if (seat === null) return { kind: "notSeated" };

      // Idempotency first: a retry must be indistinguishable from a slow
      // success, and must not re-run any of the work below (D15).
      const already = await actions.byClientActionId(gameId, post.clientActionId);
      if (already) return { kind: "ok", seq: row.seq, actions: [already] };

      if (row.status !== "playing") return { kind: "finished" };

      // Dice are the authority's to roll, so a `kind: "action"` body carrying
      // an ATTACK is refused outright (§5.5, F11).
      if (post.kind === "action" && post.action.type === "ATTACK") {
        return { kind: "illegalAction" };
      }

      const { map, state } = await withFold(tx, engine, row);
      if (currentSeatOf(state) !== seat) return { kind: "notYourTurn" };

      // The authenticated seat wins over the body's claim: the cookie is the
      // only thing that was verified.
      const action: Action =
        post.kind === "intent"
          ? {
              ...engine.rollAttack(
                state,
                map,
                asIntent(post.intent),
                engine.rngFor(row.seed, "battle", state.turn),
                oddsFor(state.rules.diceMode),
                state.rules.diceMode,
              ),
              seat,
            }
          : { ...asAction(post.action), seat };

      const error = engine.validate(state, map, action);
      if (error) return { kind: "ruleError", code: error.code };

      const appended = await appendChain(tx, engine, row, state, map, [
        { action, actor: "human", clientActionId: post.clientActionId },
      ]);

      await games.setMissedTurns(gameId, seat, 0);
      await commitState(tx, engine, row, appended.state, appended.seq, row.botMemory);
      return { kind: "ok", seq: appended.seq, actions: appended.logged };
    });
  } catch (error) {
    if (error instanceof DuplicateSubmission) {
      const seq = (await new GamesRepository(getDb()).head(gameId))?.seq ?? error.logged.seq;
      return { kind: "ok", seq, actions: [error.logged] };
    }
    throw error;
  }
}

/* ---------------------------------------------------------------- resign -- */

/**
 * `POST /api/games/:id/resign` — `SEAT_TO_BOT { reason: "resigned" }` (D76).
 *
 * Not a separate elimination path: the seat keeps its territories and cards
 * and a bot plays it from then on. The one thing that distinguishes it from
 * the away and timeout takeovers is that it is **never reclaimable** (R82),
 * which {@link reclaimSeat} enforces by only ever flipping `standing='away'`.
 */
export async function resignSeat(gameId: string, playerId: string): Promise<SubmitResult> {
  const engine = serverEngine();
  const head = await new GamesRepository(getDb()).head(gameId);
  if (!head) return { kind: "notFound" };
  await loadMapDef(head.mapSlug);

  return getDb().transaction(async (tx): Promise<SubmitResult> => {
    const games = new GamesRepository(tx);
    const row = await games.secretForUpdate(gameId);
    if (!row) return { kind: "notFound" };

    const seat = await games.seatOf(gameId, playerId);
    if (seat === null) return { kind: "notSeated" };
    if (row.status !== "playing") return { kind: "finished" };

    const { map, state } = await withFold(tx, engine, row);
    const action = seatToBot(engine, row.seed, state, seat, "resigned");

    const error = engine.validate(state, map, action);
    if (error) return { kind: "ruleError", code: error.code };

    const appended = await appendChain(tx, engine, row, state, map, [
      { action, actor: "server" },
    ]);
    await games.setSeatKind(gameId, seat, "bot", "resigned", state.rules.aiDifficulty);
    await commitState(tx, engine, row, appended.state, appended.seq, row.botMemory);
    return { kind: "ok", seq: appended.seq, actions: appended.logged };
  });
}

/* --------------------------------------------------------------- reclaim -- */

/**
 * Flip a bot-held seat back to its human on their next poll (§5.6).
 *
 * `standing = 'away'` only: a resigned seat is never reclaimable (R82) and an
 * eliminated one has nothing to reclaim. The flip is a `SEAT_TO_HUMAN` row in
 * the log like everything else, so a client renders "Napoleon is back"
 * exactly as it renders a dice roll (D14).
 */
export async function reclaimSeat(gameId: string, playerId: string): Promise<boolean> {
  const engine = serverEngine();
  const db = getDb();
  const games = new GamesRepository(db);

  const seats = await games.players(gameId);
  const mine = seats.find((row) => row.playerId === playerId);
  if (!mine || mine.kind !== "bot" || mine.standing !== "away") return false;

  const head = await games.head(gameId);
  if (!head || head.status !== "playing") return false;
  await loadMapDef(head.mapSlug);

  return db.transaction(async (tx) => {
    const txGames = new GamesRepository(tx);
    const row = await txGames.secretForUpdate(gameId);
    if (!row) return false;

    const { map, state } = await withFold(tx, engine, row);
    const action: Action = { type: "SEAT_TO_HUMAN", seat: mine.seat };
    if (engine.validate(state, map, action) !== null) return false;

    const appended = await appendChain(tx, engine, row, state, map, [
      { action, actor: "server" },
    ]);
    await txGames.setSeatKind(gameId, mine.seat, "human", "active", null);
    await txGames.setMissedTurns(gameId, mine.seat, 0);
    await commitState(tx, engine, row, appended.state, appended.seq, row.botMemory);
    return true;
  });
}

/* ------------------------------------------------------------- the tick -- */

export interface TickReport {
  readonly ticked: boolean;
  readonly appended: number;
  readonly capped: boolean;
}

const NO_TICK: TickReport = { ticked: false, appended: 0, capped: false };

/**
 * The lazy tick (§5.6): bot turns, turn-timer expiry and seat takeovers, run
 * inside whichever poll arrives next.
 *
 * Hobby cron fires once per day, so nothing periodic may depend on it — and
 * nothing needs to, because there is always at least one client polling
 * whenever the outcome would matter to anybody (D13).
 *
 * A **lease**, not a row lock: a poll that loses the race answers immediately
 * from the log and the next poll 2 s later picks the work up, where blocking
 * on `for update` would make every client wait out one bot's turn.
 *
 * Every step is a row in the action log, never a side effect (D14) — a
 * timeout, a takeover and a reconnect are all learned by folding the log,
 * exactly like a dice roll.
 */
export async function runLazyTick(gameId: string): Promise<TickReport> {
  const engine = serverEngine();
  const db = getDb();
  const games = new GamesRepository(db);

  const head = await games.head(gameId);
  if (!head || head.status !== "playing") return NO_TICK;

  const seats = await games.players(gameId);
  const current = seats.find((row) => row.seat === head.currentSeat);
  const deadlinePassed =
    head.turnDeadline !== null && Date.parse(head.turnDeadline) <= Date.now();
  const away = current?.kind === "human" && isUnseen(current.lastSeenAt);

  if (current?.kind !== "bot" && !deadlinePassed && !away) return NO_TICK;

  const lease = await games.takeTickLease(gameId, TICK_LEASE_SECONDS);
  if (lease === null) return NO_TICK;

  await loadMapDef(head.mapSlug);

  try {
    return await db.transaction(async (tx): Promise<TickReport> => {
      const txGames = new GamesRepository(tx);
      const actions = new ActionsRepository(tx);
      const row = await txGames.secretForUpdate(gameId);
      if (!row) return NO_TICK;

      const folded = await withFold(tx, engine, row);
      const map = folded.map;
      let state = folded.state;
      let memory = row.botMemory;
      let seq = row.seq;
      let appended = 0;
      let capped = false;
      let timedOut = deadlinePassed;

      const missed = new Map<Seat, number>(seats.map((seat) => [seat.seat, seat.missedTurns]));
      const lastSeen = new Map<Seat, string | null>(
        seats.map((seat) => [seat.seat, seat.lastSeenAt]),
      );
      const kinds = new Map<Seat, "human" | "bot">(seats.map((seat) => [seat.seat, seat.kind]));

      while (appended < MAX_TICK_ACTIONS) {
        if (state.outcome !== null) break;
        const seat = currentSeatOf(state);
        const isBot = state.seats[seat]?.kind === "bot" || kinds.get(seat) === "bot";

        let step: ChainStep | null = null;

        if (isBot) {
          const persona = state.seats[seat]?.persona ?? null;
          if (persona) {
            const grudge = grudgeFor(memory, seat, state.seats.length);
            const action = nextBotAction(engine, state, map, seat, {
              persona,
              grudge,
              odds: oddsFor(state.rules.diceMode),
              seed: row.seed,
            });
            memory = storeGrudge(memory, seat, grudge);
            if (action) step = { action, actor: "bot" };
          }
          if (!step) {
            const fallback = autoSkipAction(engine, state, map, seat);
            if (fallback) step = { action: fallback, actor: "server" };
          }
        } else if (isUnseen(lastSeen.get(seat) ?? null)) {
          // "They are gone, whatever their turn count" (§5.6).
          step = { action: seatToBot(engine, row.seed, state, seat, "away"), actor: "server" };
        } else if (timedOut) {
          if ((missed.get(seat) ?? 0) >= MISSED_TURNS_TO_BOT) {
            // "They are still polling — just not playing."
            step = {
              action: seatToBot(engine, row.seed, state, seat, "timeout"),
              actor: "server",
            };
          } else {
            const fallback = autoSkipAction(engine, state, map, seat);
            if (fallback) {
              step = { action: fallback, actor: "server" };
              if (fallback.type === "END_TURN") missed.set(seat, (missed.get(seat) ?? 0) + 1);
            }
          }
        } else {
          // A live human inside their deadline: the tick's work is done and
          // the poll answers from the log.
          break;
        }

        if (!step) break;

        const result = engine.apply(state, map, step.action);
        if (result.error) break;
        state = result.state;
        seq += 1;
        appended += 1;
        await actions.append({
          gameId,
          seq,
          action: step.action,
          actor: step.actor,
          clientActionId: null,
          stateHash: engine.hashState(state),
        });

        if (step.action.type === "SEAT_TO_BOT") {
          const standing = step.action.reason === "resigned" ? "resigned" : "away";
          kinds.set(step.action.seat, "bot");
          await txGames.setSeatKind(gameId, step.action.seat, "bot", standing, step.action.tier);
        }

        // The deadline is renewed the moment the seat changes hands.
        if (currentSeatOf(state) !== seat) timedOut = false;
        if (appended >= MAX_TICK_ACTIONS) capped = true;
      }

      if (appended === 0) {
        await txGames.releaseTickLease(gameId);
        return { ticked: true, appended: 0, capped: false };
      }

      for (const [seat, count] of missed) {
        const before = seats.find((candidate) => candidate.seat === seat)?.missedTurns ?? 0;
        if (count !== before) await txGames.setMissedTurns(gameId, seat, count);
      }

      await commitState(tx, engine, row, state, seq, memory);
      return { ticked: true, appended, capped };
    });
  } catch (error) {
    // A failed tick must not leave the lease held for ten seconds: every
    // client would then poll past a game that is wedged.
    await games.releaseTickLease(gameId).catch(() => undefined);
    throw error;
  }
}

function isUnseen(lastSeenAt: string | null): boolean {
  if (lastSeenAt === null) return true;
  return Date.parse(lastSeenAt) < Date.now() - AWAY_SECONDS * 1000;
}

/** Mint the persona a `SEAT_TO_BOT` row has to carry (§4.8). */
function seatToBot(
  engine: ServerEngine,
  seed: string,
  state: GameState,
  seat: Seat,
  reason: "away" | "timeout" | "resigned",
): Extract<Action, { type: "SEAT_TO_BOT" }> {
  const tier: BotTier = state.rules.aiDifficulty;
  const persona = engine.drawPersonas(
    [tier],
    engine.rngFor(seed, "personaAssign", state.turn),
    engine.rngFor(seed, "personaJitter", state.turn),
  )[0];
  if (!persona) throw new Error("drawPersonas returned no persona for a seat takeover");
  return { type: "SEAT_TO_BOT", seat, reason, tier, persona };
}

/* ------------------------------------------------------------- the poll -- */

/**
 * POLL 3's body (§6), or `unchanged` for the `204` fast path.
 *
 * The two modes and why they differ are §5.5's. A **non-fog** client folds the
 * delta and asserts `hashState` after every action, so it is handed actions
 * and only ever a snapshot when it is cold or behind the compaction horizon.
 * A **fog** client is handed its own masked view on every changed poll, at
 * `snapshotSeq === seq`, and never hash-checks anything — `hashState` asserts
 * `fogged === false`, and a masked view is a different byte string per viewer
 * (F36).
 *
 * The `204` is the cost design and the correctness design at the same time
 * (D12) and is byte-for-byte identical in both modes.
 */
export async function pollGame(input: {
  gameId: string;
  playerId: string;
  since: number;
  chatSince: number;
}): Promise<PollResult> {
  const engine = serverEngine();
  const db = getDb();
  const games = new GamesRepository(db);

  const head = await games.head(input.gameId);
  if (!head) return { kind: "notFound" };

  const seat = await games.seatOf(input.gameId, input.playerId);
  if (seat === null) return { kind: "notSeated" };

  const chat = await new ChatRepository(db).since("game", input.gameId, input.chatSince);

  // `204` when nothing changed AND there is no body to send. New chat counts
  // as a change: in-game chat rides this poll and nothing else (§5.9), so
  // answering `204` through it would make a line undeliverable until somebody
  // moved.
  if (head.seq === input.since && chat.length === 0) {
    return { kind: "unchanged", seq: head.seq };
  }

  const actions = new ActionsRepository(db);
  const body: GameSync = {
    seq: head.seq,
    actions: [],
    presence: await games.presence(input.gameId),
    turnDeadline: head.turnDeadline,
    chat,
    you: { seat, cards: [] },
    status: head.status,
  };

  if (head.rules.fogOfWar === true) {
    // View mode: always the caller's masked snapshot at `snapshotSeq === seq`,
    // plus the actions since `since` FOR ANIMATION ONLY.
    const loaded = await authoritative(db, engine, input.gameId);
    if (!loaded) return { kind: "notFound" };
    body.snapshot = engine.viewFor(loaded.state, loaded.map, seat);
    body.snapshotSeq = head.seq;
    body.actions = await actions.since(input.gameId, input.since);
    body.you.cards = [...(loaded.state.seats[seat]?.cards ?? [])];
    return { kind: "body", seq: head.seq, body };
  }

  if (input.since > 0 && input.since >= head.snapshotSeq) {
    // Delta mode, the common case: the client folds on from where it is.
    body.fromSeq = input.since;
    body.actions = await actions.since(input.gameId, input.since);
    const loaded = await authoritative(db, engine, input.gameId);
    body.you.cards = [...(loaded?.state.seats[seat]?.cards ?? [])];
    return { kind: "body", seq: head.seq, body };
  }

  // Cold (`since === 0`) or behind the compaction horizon: the authoritative
  // snapshot, `fogged: false`, because the client must hash it to keep folding
  // (F12 ∧ F36). It reveals nothing a non-fog client was not already getting,
  // since it replays the whole log including every `CARD_DRAWN`.
  const row = await games.secret(input.gameId);
  if (!row) return { kind: "notFound" };
  const map = await loadMapDef(row.mapSlug);
  body.snapshot = row.snapshot;
  body.snapshotSeq = row.snapshotSeq;
  body.actions = await actions.since(input.gameId, row.snapshotSeq);
  const folded = foldActions(engine, row.snapshot, map, body.actions);
  body.you.cards = [...(folded.seats[seat]?.cards ?? [])];
  return { kind: "body", seq: head.seq, body };
}

/**
 * The raw, UNMASKED log from `from + 1` — the determinism proof's only door
 * (§6, F37).
 *
 * POLL 3 returns the caller's fog view, which is exactly what a replay check
 * must not be given, so the proof needs a route that returns the log as
 * stored: unmasked payloads, every `state_hash`, and the `GAME_STARTED` row
 * with `games.seed` still absent from it.
 */
export async function rawLog(gameId: string, from: number): Promise<LoggedAction[]> {
  return new ActionsRepository(getDb()).since(gameId, from, 10_000);
}
