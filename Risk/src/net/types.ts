import type { Card, GameState, PlayerColour, Rules, BotTier } from "@/engine/types";
import type { ChatLine, LoggedAction, PresenceRow } from "@/ports/sync";

/**
 * The three poll bodies, as the **client** sees them (SPEC §6).
 *
 * The server's own copies live in `src/app/api/_lib/*Service.ts`, which are
 * `server-only` and therefore unimportable from a component. These are the
 * same shapes declared where the browser can read them; `PresenceRow`,
 * `ChatLine` and `LoggedAction` are imported from `src/ports/sync.ts` rather
 * than restated, because they are declared once, there (F26).
 */

/** POLL 1 — `GET /api/lobby?since=<version>`. */
export interface LobbyBrowseBody {
  readonly version: number;
  readonly players: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly colour: PlayerColour;
    readonly online: boolean;
  }[];
  readonly lobbies: readonly {
    readonly code: string;
    readonly title: string;
    readonly hostName: string;
    readonly mapSlug: string;
    readonly seatsTaken: number;
    readonly maxSeats: number;
    readonly status: "open" | "starting";
  }[];
  readonly chat: readonly ChatLine[];
  readonly you: {
    readonly playerId: string;
    readonly displayName: string;
    readonly colour: PlayerColour;
  };
}

/** POLL 2 — `GET /api/lobbies/:code?since=<version>`. */
export interface LobbyRoomBody {
  readonly version: number;
  readonly code: string;
  readonly title: string;
  readonly hostId: string;
  readonly status: "open" | "starting" | "playing" | "closed";
  readonly mapSlug: string;
  readonly rules: Rules;
  readonly maxSeats: number;
  readonly gameId: string | null;
  readonly seats: readonly {
    readonly seat: number;
    readonly kind: "open" | "human" | "bot";
    readonly playerId: string | null;
    readonly displayName: string | null;
    readonly colour: PlayerColour | null;
    readonly tier: BotTier | null;
    readonly ready: boolean;
    readonly online: boolean;
  }[];
  readonly chat: readonly ChatLine[];
}

/** POLL 3 — `GET /api/games/:id?since=<seq>&chatSince=<id>`. */
export interface GameSyncBody {
  readonly seq: number;
  readonly fromSeq?: number;
  readonly snapshot?: GameState;
  readonly snapshotSeq?: number;
  readonly actions: readonly LoggedAction[];
  readonly presence: readonly PresenceRow[];
  readonly turnDeadline: string | null;
  readonly chat: readonly ChatLine[];
  readonly you: { readonly seat: number | null; readonly cards: readonly Card[] };
  readonly status: "playing" | "finished" | "abandoned";
}

/** What `POST /api/games/:id/actions` answers with. */
export interface ActionPostBody {
  readonly seq: number;
  readonly actions: readonly LoggedAction[];
}

/**
 * A route that answered with a status the caller has to act on.
 *
 * `code` is the `RuleErrorCode` from a `422`, which is the one error the UI
 * renders differently per value ("you must place all your troops" is not
 * "not your turn").
 */
export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `${status} ${code}` : `HTTP ${status}`);
    this.name = "SyncHttpError";
  }
}
