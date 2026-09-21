import "server-only";

import { nanoid } from "nanoid";

import type { MapDefinition, MapSummary } from "@/engine/types";
import type { MapsRepository } from "@/ports/maps";

import { getDb } from "./index";
import type { SqlExecutor } from "./driver";

/**
 * The `maps` table (SPEC §6), behind the `MapsRepository` port.
 *
 * The whole `MapDefinition` lives in one `jsonb` column; the scalar columns
 * beside it (`name`, `author`, `width`, `height`, `players`, `biome`) exist so
 * a listing and the weekly-challenge pool never have to decode a 40×40 tile
 * array per row. They are written from the definition, never edited apart
 * from it, and the definition is the truth on read.
 *
 * ## Cursor
 *
 * `list` pages newest-first with a keyset cursor over `(created_at, id)` —
 * an offset would skip or repeat a row whenever a map is saved between two
 * pages. The cursor is the last row's `created_at` and `id`, base64url-encoded
 * so it survives a query string unescaped; an unparseable cursor is a 400 at
 * the route, not a silent restart from the top.
 */

type MapRow = {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  players: number;
  biome: string;
  created_at: string | Date;
};

type DefinitionRow = {
  definition: unknown;
};

const SUMMARY_COLUMNS =
  "id, name, author, width, height, players, biome, created_at";

/** 12 characters of nanoid's default alphabet: ~71 bits, URL-safe. */
const ID_LENGTH = 12;

function isoOf(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSummary(row: MapRow): MapSummary {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    width: Number(row.width),
    height: Number(row.height),
    biome: row.biome as MapSummary["biome"],
    players: Number(row.players),
    createdAt: isoOf(row.created_at),
  };
}

export interface ListCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** `null` when the string is not a cursor this module produced. */
export function decodeCursor(raw: string): ListCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as ListCursor).createdAt === "string" &&
      typeof (parsed as ListCursor).id === "string" &&
      Number.isFinite(Date.parse((parsed as ListCursor).createdAt))
    ) {
      return { createdAt: (parsed as ListCursor).createdAt, id: (parsed as ListCursor).id };
    }
    return null;
  } catch {
    return null;
  }
}

export class InvalidCursorError extends Error {
  constructor() {
    super("cursor is not valid");
    this.name = "InvalidCursorError";
  }
}

export class DbMapsRepository implements MapsRepository {
  constructor(private readonly db: SqlExecutor = getDb()) {}

  async create(map: Omit<MapDefinition, "id">): Promise<{ id: string }> {
    const id = nanoid(ID_LENGTH);
    const definition: MapDefinition = { ...map, id };
    await this.db.execute(
      `insert into maps (id, name, author, definition, players, width, height, biome)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        id,
        map.name,
        map.author,
        JSON.stringify(definition),
        map.players.length,
        map.width,
        map.height,
        map.biome,
      ],
    );
    return { id };
  }

  async get(id: string): Promise<MapDefinition | null> {
    const rows = await this.db.query<DefinitionRow>(
      "select definition from maps where id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    // PGlite hands jsonb back decoded; Neon over HTTP does too, but a driver
    // that returned the text form would still round-trip here.
    const raw = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;
    return { ...(raw as MapDefinition), id };
  }

  async list(opts: { cursor?: string; limit: number }): Promise<{
    maps: MapSummary[];
    nextCursor: string | null;
  }> {
    const limit = Math.max(1, Math.min(100, Math.floor(opts.limit)));
    let rows: MapRow[];
    if (opts.cursor) {
      const cursor = decodeCursor(opts.cursor);
      if (!cursor) throw new InvalidCursorError();
      rows = await this.db.query<MapRow>(
        `select ${SUMMARY_COLUMNS} from maps
          where (created_at, id) < ($1::timestamptz, $2)
          order by created_at desc, id desc
          limit $3`,
        [cursor.createdAt, cursor.id, limit + 1],
      );
    } else {
      rows = await this.db.query<MapRow>(
        `select ${SUMMARY_COLUMNS} from maps
          order by created_at desc, id desc
          limit $1`,
        [limit + 1],
      );
    }
    const page = rows.slice(0, limit).map(toSummary);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
    return { maps: page, nextCursor };
  }

  async listAll(): Promise<MapSummary[]> {
    const rows = await this.db.query<MapRow>(
      `select ${SUMMARY_COLUMNS} from maps order by created_at asc, id asc`,
    );
    return rows.map(toSummary);
  }
}

/** The repository over the process's database. */
export function mapsRepository(): MapsRepository {
  return new DbMapsRepository(getDb());
}
