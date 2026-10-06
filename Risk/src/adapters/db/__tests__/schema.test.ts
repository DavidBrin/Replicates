// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { splitStatements } from "../driver";
import { PgliteDatabase } from "../pglite";
import { SCHEMA_SQL } from "../schema";
import { toModule } from "../../../../scripts/build-schema.mjs";

/**
 * The schema (SPEC §6.2): the drift guard, "does it apply", idempotency, and
 * the `check` constraints that are doing real work rather than documenting
 * intent.
 */

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "schema.sql");
const tsPath = join(here, "..", "schema.ts");

describe("the generated module", () => {
  it("matches schema.sql", () => {
    const expected = toModule(readFileSync(sqlPath, "utf8"));
    const actual = readFileSync(tsPath, "utf8");
    expect(actual, "schema.ts is stale — run `pnpm run build:schema`").toBe(expected);
  });

  it("round-trips the SQL through template-literal escaping", () => {
    expect(SCHEMA_SQL).toContain("create table if not exists players");
    expect(SCHEMA_SQL).not.toContain("\\`");
  });

  it("no longer carries the scaffold's placeholder table", () => {
    expect(SCHEMA_SQL).not.toContain("schema_meta");
  });
});

describe("applying the schema", () => {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);

  afterAll(async () => {
    await db.close();
  });

  it("creates exactly the seven tables of §6.2", async () => {
    await db.migrate();
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    expect(tables.map((row) => row.table_name)).toEqual([
      "chat_messages",
      "game_actions",
      "game_players",
      "games",
      "lobbies",
      "lobby_seats",
      "players",
    ]);
  });

  it("is idempotent", async () => {
    await expect(db.migrate()).resolves.toBeUndefined();
    await expect(db.migrate()).resolves.toBeUndefined();
  });

  it("splits into one statement per DDL line", () => {
    const statements = splitStatements(SCHEMA_SQL);
    expect(statements.length).toBeGreaterThan(15);
    expect(statements.some((statement) => /create table if not exists games/.test(statement))).toBe(
      true,
    );
  });

  it("gives games the columns the repositories write, including bot_memory", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'games' order by column_name`,
    );
    const names = columns.map((row) => row.column_name);
    for (const expected of [
      "bot_memory",
      "current_seat",
      "lobby_id",
      "map_id",
      "phase",
      "rules",
      "seed",
      "seq",
      "snapshot",
      "snapshot_seq",
      "state_hash",
      "status",
      "tick_lease",
      "turn_deadline",
      "winner_seat",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("defaults bot_memory to an empty object rather than null", async () => {
    await db.execute(
      `insert into games (id, map_id, rules, seed, snapshot, state_hash, phase)
       values ('g1', 'ring', '{}'::jsonb, 's', '{}'::jsonb, 'h', 'draft')`,
    );
    const rows = await db.query<{ bot_memory: unknown }>(
      "select bot_memory from games where id = 'g1'",
    );
    expect(rows[0]?.bot_memory).toEqual({});
  });
});

describe("the check constraints", () => {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);

  afterAll(async () => {
    await db.close();
  });

  async function insertPlayer(
    id: string,
    displayName: string,
    colour: string,
  ): Promise<void> {
    await db.execute(
      `insert into players (id, display_name, name_key, secret_hash, color)
       values ($1, $2, lower($2), 'h', $3)`,
      [id, displayName, colour],
    );
  }

  it("applies once for this suite", async () => {
    await db.migrate();
    await insertPlayer("p1", "Alpha", "red");
    const rows = await db.query("select id from players");
    expect(rows).toHaveLength(1);
  });

  it("refuses a hex colour — the wire and the column carry a NAME (F8)", async () => {
    await expect(insertPlayer("p2", "Bravo", "#ff0000")).rejects.toThrow();
  });

  it("refuses a name outside 2–20 characters", async () => {
    await expect(insertPlayer("p3", "A", "red")).rejects.toThrow();
    await expect(insertPlayer("p4", "A".repeat(21), "red")).rejects.toThrow();
  });

  it("refuses a name whose first character is punctuation", async () => {
    await expect(insertPlayer("p5", ".leading", "red")).rejects.toThrow();
  });

  it("holds one name per name_key", async () => {
    await insertPlayer("p6", "Charlie", "blue");
    await expect(insertPlayer("p7", "charlie", "blue")).rejects.toThrow();
  });

  it("refuses a lobby seat whose kind and columns disagree", async () => {
    await db.execute(
      `insert into lobbies (id, host_id, title) values ('ABCD', 'p1', 'Lobby')`,
    );
    // kind='bot' with a player_id is exactly the shape the constraint exists
    // to stop: a seat that is both a robot and a person.
    await expect(
      db.execute(
        `insert into lobby_seats (lobby_id, seat, kind, player_id, bot_level)
         values ('ABCD', 0, 'bot', 'p1', 'medium')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(`insert into lobby_seats (lobby_id, seat, kind) values ('ABCD', 1, 'human')`),
    ).rejects.toThrow();
  });

  it("allows one seat per player per lobby and refuses a second", async () => {
    await db.execute(
      `insert into lobby_seats (lobby_id, seat, kind, player_id) values ('ABCD', 2, 'human', 'p1')`,
    );
    await expect(
      db.execute(
        `insert into lobby_seats (lobby_id, seat, kind, player_id) values ('ABCD', 3, 'human', 'p1')`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a seat outside 0..5", async () => {
    await expect(
      db.execute(`insert into lobby_seats (lobby_id, seat, kind) values ('ABCD', 6, 'open')`),
    ).rejects.toThrow();
  });

  it("allows an action row naming the neutral holding (seat -2)", async () => {
    await db.execute(
      `insert into games (id, map_id, rules, seed, snapshot, state_hash, phase)
       values ('g2', 'ring', '{}'::jsonb, 's', '{}'::jsonb, 'h', 'claim')`,
    );
    await db.execute(
      `insert into game_actions (game_id, seq, seat, type, payload, actor, state_hash)
       values ('g2', 1, -2, 'CLAIM', '{}'::jsonb, 'server', 'h1')`,
    );
    await expect(
      db.execute(
        `insert into game_actions (game_id, seq, seat, type, payload, actor, state_hash)
         values ('g2', 2, -3, 'CLAIM', '{}'::jsonb, 'server', 'h2')`,
      ),
    ).rejects.toThrow();
  });

  it("refuses seq 0 — the log is contiguous FROM 1", async () => {
    await expect(
      db.execute(
        `insert into game_actions (game_id, seq, seat, type, payload, actor, state_hash)
         values ('g2', 0, 0, 'CLAIM', '{}'::jsonb, 'server', 'h')`,
      ),
    ).rejects.toThrow();
  });

  it("is the idempotency fence for a repeated client_action_id", async () => {
    await db.execute(
      `insert into game_actions (game_id, seq, seat, type, payload, actor, client_action_id, state_hash)
       values ('g2', 3, 0, 'DRAFT', '{}'::jsonb, 'human', 'cid-1', 'h3')`,
    );
    await expect(
      db.execute(
        `insert into game_actions (game_id, seq, seat, type, payload, actor, client_action_id, state_hash)
         values ('g2', 4, 0, 'DRAFT', '{}'::jsonb, 'human', 'cid-1', 'h4')`,
      ),
    ).rejects.toThrow();
  });

  it("leaves two null client_action_ids alone — the index is partial", async () => {
    await db.execute(
      `insert into game_actions (game_id, seq, seat, type, payload, actor, state_hash)
       values ('g2', 4, 0, 'END_TURN', '{}'::jsonb, 'bot', 'h5')`,
    );
    await db.execute(
      `insert into game_actions (game_id, seq, seat, type, payload, actor, state_hash)
       values ('g2', 5, 0, 'END_TURN', '{}'::jsonb, 'bot', 'h6')`,
    );
    // seqs 1, 3, 4 and 5: the seat -3 row and the duplicate `cid-1` row were
    // both refused above, which is the point of the two tests before this one.
    const rows = await db.query<{ seq: string | number }>(
      "select seq from game_actions where game_id = 'g2' order by seq",
    );
    expect(rows.map((row) => Number(row.seq))).toEqual([1, 3, 4, 5]);
  });

  it("has no body column, and takes a line_id XOR an emoji", async () => {
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'chat_messages'`,
    );
    expect(columns.map((row) => row.column_name)).not.toContain("body");

    await db.execute(
      `insert into chat_messages (scope, scope_id, display_name, line_id)
       values ('global', null, 'Alpha', 1)`,
    );
    await db.execute(
      `insert into chat_messages (scope, scope_id, display_name, emoji)
       values ('global', null, 'Alpha', 'swords')`,
    );
    await expect(
      db.execute(
        `insert into chat_messages (scope, scope_id, display_name, line_id, emoji)
         values ('global', null, 'Alpha', 1, 'swords')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        `insert into chat_messages (scope, scope_id, display_name) values ('global', null, 'Alpha')`,
      ),
    ).rejects.toThrow();
  });

  it("refuses a line_id outside the 42-line roster", async () => {
    await expect(
      db.execute(
        `insert into chat_messages (scope, scope_id, display_name, line_id)
         values ('global', null, 'Alpha', 43)`,
      ),
    ).rejects.toThrow();
  });

  it("cascades the action log when a game is deleted", async () => {
    await db.execute("delete from games where id = 'g2'");
    const rows = await db.query("select seq from game_actions where game_id = 'g2'");
    expect(rows).toHaveLength(0);
  });
});
