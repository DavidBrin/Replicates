import "server-only";

import type { ChatLine } from "@/ports/sync";

import type { SqlExecutor } from "../driver";
import { getDb } from "../index";

/**
 * The `chat_messages` table (SPEC §5.9, §6.2).
 *
 * Preset-only and never an action: a row carries **either** a `line_id` into
 * the 42-line roster **or** one of the eight emoji glyph ids, and the table
 * has no `body` column at all. There is therefore no free-text path anywhere
 * in the app, by construction rather than by validation (D41) — the database
 * `check ((line_id is not null) <> (emoji is not null))` is the fence.
 *
 * Reads always ride one of the three polls; this module has no route of its
 * own beyond the single `POST /api/chat` write.
 */

export type ChatScope = ChatLine["scope"];

export class ChatRepository {
  constructor(private readonly db: SqlExecutor) {}

  async post(input: {
    scope: ChatScope;
    scopeId: string | null;
    playerId: string;
    displayName: string;
    lineId: number | null;
    emoji: string | null;
  }): Promise<number> {
    const rows = await this.db.query<{ id: string | number }>(
      `insert into chat_messages (scope, scope_id, player_id, display_name, line_id, emoji)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        input.scope,
        input.scopeId,
        input.playerId,
        input.displayName,
        input.lineId,
        input.emoji,
      ],
    );
    return Number(rows[0]?.id ?? 0);
  }

  /**
   * Lines with `id > since`, oldest first so a client can append them.
   *
   * The `limit` is applied to the NEWEST rows and the result re-ordered, so a
   * client that has been away does not get stuck replaying an old window.
   */
  async since(
    scope: ChatScope,
    scopeId: string | null,
    since: number,
    limit = 50,
  ): Promise<ChatLine[]> {
    const rows = await this.db.query<{
      id: string | number;
      scope: string;
      display_name: string;
      line_id: number | null;
      emoji: string | null;
      created_at: string | Date;
    }>(
      `select * from (
         select id, scope, display_name, line_id, emoji, created_at
           from chat_messages
          where scope = $1
            and (($2::text is null and scope_id is null) or scope_id = $2)
            and id > $3
          order by id desc limit $4
       ) recent order by id asc`,
      [scope, scopeId, since, limit],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      scope: row.scope as ChatScope,
      displayName: row.display_name,
      lineId: row.line_id === null ? null : Number(row.line_id),
      emoji: row.emoji,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
    }));
  }
}

export function chatRepository(db: SqlExecutor = getDb()): ChatRepository {
  return new ChatRepository(db);
}
