/**
 * The SQLite `Store` — the local and demo adapter.
 *
 * It exists to answer one complaint the memory adapter cannot: a demo that
 * forgets every purchase when the dev server restarts. A file on disk survives
 * that, and survives nothing on Vercel, which is why this is the local driver
 * and Postgres is still the deployed one (DECISIONS D13,
 * `research/persistence-and-vercel.md` §3).
 *
 * `node:sqlite`, not `better-sqlite3`: it ships with Node 26, so there is no
 * dependency to install, no native module to rebuild against the local ABI, and
 * nothing for a fresh clone to get wrong. It is imported dynamically, through a
 * variable specifier so no bundler tries to follow it, for the same reason the
 * Postgres adapter imports its driver dynamically — selecting one driver must
 * never load the other.
 *
 * The SQL mirrors `postgres.ts` statement for statement, including the two
 * structural choices that carry the correctness:
 *
 * - **`blocks` has `PRIMARY KEY (page_id, bx, by)`.** Claiming inserts the
 *   whole rect with `ON CONFLICT DO NOTHING` and compares the row count to the
 *   rect's size, so a double claim is impossible rather than improbable.
 * - **`reserveBlocks` is all-or-nothing inside one transaction.** Postgres
 *   needs an advisory lock there because two connections can interleave under
 *   READ COMMITTED. `node:sqlite` is synchronous and this adapter holds a
 *   single database handle, so the whole reservation runs to completion between
 *   two event-loop turns — but only because there is no `await` anywhere
 *   between the availability check and the write. Adding one would silently
 *   reintroduce the race the advisory lock exists to prevent, exactly as it
 *   would in `memory.ts`.
 *
 * One honest limitation follows from that single handle: a write made on the
 * root store while a `transact` is in flight joins that transaction instead of
 * standing alone, and is rolled back with it. Postgres would take a second
 * pooled connection and keep the two apart. Nothing in the app does that — the
 * services take a `tx` and use it — and joining is the safe reading of the two.
 */

import type {
  Claim,
  Hold,
  LedgerEntry,
  Order,
  OrderKind,
  OrderPayload,
  OrderStatus,
  Page,
  PageKind,
  ProcessedEvent,
  User,
  LedgerKind,
} from "@/domain/entities";
import {
  ORDER_KINDS,
  ORDER_STATUSES,
  LEDGER_KINDS,
  isPageKind,
} from "@/domain/entities";
import {
  blocksIn,
  isPageSize,
  rectWithin,
  type BlockRect,
  type PageSize,
} from "@/domain/geometry";
import type { Cents } from "@/domain/money";
import type { Store } from "@/ports";

/* ---------------------------------------------------------------- driver -- */

type Row = Record<string, unknown>;

/** Everything this adapter binds. Blobs and bigints never reach a statement. */
type Params = Readonly<Record<string, string | number | null>>;

interface RunResult {
  /** `bigint` once a table passes 2^53 rows, which is not a shape we plan for. */
  readonly changes: number | bigint;
}

interface SqliteStatement {
  get(params?: Params): Row | undefined;
  all(params?: Params): Row[];
  run(params?: Params): RunResult;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteDriver {
  readonly DatabaseSync: new (path: string) => SqliteDatabase;
}

/**
 * Held in a variable rather than written inline so TypeScript types the import
 * as unknown and no bundler tries to resolve `node:sqlite` at build time.
 * `@types/node` is still on v20 here and does not declare the module at all; a
 * literal specifier fails `tsc` outright.
 */
const SQLITE_MODULE = "node:sqlite";

/**
 * Read from the working directory, not from `import.meta.url`.
 *
 * Next bundles server code into `.next/server`, where a URL-relative lookup
 * would resolve to a chunk directory this file was never copied into. The
 * working directory is the project root under `next dev`, `next start` and
 * vitest alike — and this driver only ever runs in one of those, which is the
 * same fact that makes shipping DDL with the adapter safe here and reckless in
 * `postgres.ts`.
 */
const SCHEMA_PATH = "src/adapters/store/schema.sqlite.sql";

/** Where the demo database lives when nothing says otherwise. */
export const DEFAULT_SQLITE_PATH = ".data/dollar-pixels.db";

export function sqlitePath(): string {
  return process.env.SQLITE_PATH || DEFAULT_SQLITE_PATH;
}

/* ------------------------------------------------------------ connection -- */

/**
 * The one database handle, plus the transaction bookkeeping SQLite will not do
 * for us. Shared by reference between the root store and the view `transact`
 * hands its callback, so both agree on whether a transaction is open.
 */
interface Connection {
  readonly db: SqliteDatabase;
  /** True between `begin` and its `commit`/`rollback`. SQLite refuses to nest. */
  open: boolean;
  savepointSeq: number;
}

async function openConnection(path: string): Promise<Connection> {
  const [{ DatabaseSync }, fs, nodePath] = await Promise.all([
    import(/* webpackIgnore: true */ SQLITE_MODULE) as Promise<SqliteDriver>,
    import("node:fs"),
    import("node:path"),
  ]);

  // `.data/` will not exist on a fresh clone, and SQLite reports a missing
  // parent directory as an unhelpful "unable to open database file".
  const directory = nodePath.dirname(nodePath.resolve(path));
  fs.mkdirSync(directory, { recursive: true });

  const db = new DatabaseSync(path);
  // WAL so a reader never blocks on the writer; `foreign_keys` because SQLite
  // ignores every REFERENCES clause in the schema unless it is on, which would
  // quietly make this adapter looser than the Postgres one it is checked
  // against by the same contract suite.
  db.exec("pragma journal_mode = wal");
  db.exec("pragma foreign_keys = on");
  db.exec(fs.readFileSync(nodePath.resolve(SCHEMA_PATH), "utf8"));
  return { db, open: false, savepointSeq: 0 };
}

/* ------------------------------------------------------------ row -> entity -- */

function str(row: Row, column: string): string {
  const value = row[column];
  if (typeof value === "string") return value;
  throw new TypeError(`expected text in column ${column}, got ${typeof value}`);
}

function strOrNull(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new TypeError(`expected text or null in column ${column}, got ${typeof value}`);
}

/**
 * `count(*)` and `sum(...)` come back as `bigint` once they exceed 2^53; every
 * value read here is bounded far below that — the largest is 16,000,000 cents —
 * so the widening is safe at this one seam and nowhere else.
 */
function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError(`expected a number in column ${column}, got ${typeof value}`);
}

/**
 * Timestamps are stored already normalised (see `isoText`), so reading one is a
 * text read. Re-parsing here would only hide a write path that skipped it.
 */
const iso = str;
const isoOrNull = strOrNull;

function oneOf<T extends string>(row: Row, column: string, allowed: readonly T[]): T {
  const value = str(row, column);
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new TypeError(`unexpected ${column}: ${value}`);
}

function pageKind(row: Row): PageKind {
  const value = str(row, "kind");
  if (isPageKind(value)) return value;
  throw new TypeError(`unexpected page kind: ${value}`);
}

function pageSize(row: Row): PageSize {
  const value = str(row, "size");
  if (isPageSize(value)) return value;
  throw new TypeError(`unexpected page size: ${value}`);
}

/**
 * The payload is text here where Postgres has `jsonb`, so it is parsed rather
 * than handed over parsed — and then checked identically, because a `jsonb`
 * column cannot vouch for its own shape either. Parsing per read also means
 * every caller gets its own object graph, which is the defensive copy the port
 * requires.
 */
function orderPayload(row: Row): OrderPayload {
  const parsed: unknown = JSON.parse(str(row, "payload"));
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const kind = (parsed as Record<string, unknown>)["kind"];
    if (kind === "blocks" || kind === "page") return parsed as OrderPayload;
  }
  throw new TypeError("order payload is not a BlocksPayload or a PagePayload");
}

function rectOf(row: Row): BlockRect {
  return { bx: num(row, "bx"), by: num(row, "by"), bw: num(row, "bw"), bh: num(row, "bh") };
}

function toUser(row: Row): User {
  return {
    id: str(row, "id"),
    handle: str(row, "handle"),
    displayName: str(row, "display_name"),
    createdAt: iso(row, "created_at"),
  };
}

function toPage(row: Row): Page {
  return {
    id: str(row, "id"),
    slug: str(row, "slug"),
    title: str(row, "title"),
    kind: pageKind(row),
    size: pageSize(row),
    ownerId: strOrNull(row, "owner_id"),
    allowanceTotal: num(row, "allowance_total"),
    allowanceUsed: num(row, "allowance_used"),
    createdAt: iso(row, "created_at"),
  };
}

function toClaim(row: Row): Claim {
  return {
    id: str(row, "id"),
    pageId: str(row, "page_id"),
    ownerId: str(row, "owner_id"),
    rect: rectOf(row),
    caption: str(row, "caption"),
    colour: str(row, "colour"),
    tile: strOrNull(row, "tile"),
    orderId: str(row, "order_id"),
    createdAt: iso(row, "created_at"),
  };
}

function toHold(row: Row): Hold {
  return {
    orderId: str(row, "order_id"),
    pageId: str(row, "page_id"),
    rect: rectOf(row),
    expiresAt: iso(row, "expires_at"),
  };
}

function toOrder(row: Row): Order {
  return {
    id: str(row, "id"),
    kind: oneOf<OrderKind>(row, "kind", ORDER_KINDS),
    pageId: strOrNull(row, "page_id"),
    buyerId: str(row, "buyer_id"),
    amountCents: num(row, "amount_cents"),
    status: oneOf<OrderStatus>(row, "status", ORDER_STATUSES),
    provider: str(row, "provider"),
    providerRef: strOrNull(row, "provider_ref"),
    payload: orderPayload(row),
    createdAt: iso(row, "created_at"),
    settledAt: isoOrNull(row, "settled_at"),
  };
}

function toLedgerEntry(row: Row): LedgerEntry {
  return {
    id: str(row, "id"),
    orderId: str(row, "order_id"),
    pageId: strOrNull(row, "page_id"),
    recipientId: strOrNull(row, "recipient_id"),
    amountCents: num(row, "amount_cents"),
    kind: oneOf<LedgerKind>(row, "kind", LEDGER_KINDS),
    createdAt: iso(row, "created_at"),
  };
}

const ORDER_COLUMNS =
  "id, kind, page_id, buyer_id, amount_cents, status, provider, provider_ref, payload, created_at, settled_at";

/* --------------------------------------------------------- entity -> row -- */

/**
 * Every timestamp reaching a column goes through here.
 *
 * `Date#toISOString()` is fixed width, always UTC and always millisecond
 * precision, which is the entire reason a `text` column can stand in for
 * `timestamptz`: `expires_at > ?` and `order by created_at` then compare
 * lexicographically and mean chronologically. A stored timestamp in any other
 * shape would compare wrong rather than fail, so the normalisation happens on
 * the way in, once, where a bad value still throws.
 */
function isoText(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`not a timestamp: ${String(value)}`);
  }
  return date.toISOString();
}

function isoTextOrNull(value: string | null): string | null {
  return value === null ? null : isoText(value);
}

function affected(result: RunResult): number {
  return Number(result.changes);
}

/**
 * Thrown to unwind an `atomic` block that has decided to fail. A sentinel, not
 * an error condition: `claimBlocks` returns `false` rather than throwing, but
 * it has already written a claim row by the time it knows, and a rollback is
 * the only way to un-write it.
 */
class Rollback extends Error {
  constructor() {
    super("rollback");
    this.name = "Rollback";
  }
}

/* ----------------------------------------------------------------- store -- */

export class SqliteStore implements Store {
  private readonly path: string;
  /** Non-null exactly when this instance is a view onto an open transaction. */
  private readonly tx: Connection | null;
  /** The promise, not the connection: two concurrent first requests must not
   *  each open the file and leave the loser's handle dangling. */
  private opening: Promise<Connection> | null = null;
  private mutex: Promise<unknown> = Promise.resolve();

  constructor(path: string = sqlitePath(), tx: Connection | null = null) {
    if (!path) throw new Error("SqliteStore needs a file path (SQLITE_PATH)");
    this.path = path;
    this.tx = tx;
  }

  private async handle(): Promise<Connection> {
    if (this.tx) return this.tx;
    this.opening ??= openConnection(this.path);
    return this.opening;
  }

  /** Closes the file. Nothing on the request path calls this. */
  async close(): Promise<void> {
    const opening = this.opening;
    this.opening = null;
    if (opening) (await opening).db.close();
  }

  /* ---------------------------------------------------------- transact -- */

  async transact<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    // Nested: join the transaction already open on the one handle. SQLite
    // refuses a `begin` inside a `begin` outright, and a savepoint here would
    // let an inner failure survive an outer one — the contract wants the
    // opposite.
    if (this.tx) return fn(this);

    const conn = await this.handle();
    const run = async (): Promise<T> => {
      // Reached with the mutex held, so `open` is true only if a bare call on
      // this store opened a transaction and is still inside it.
      if (conn.open) return fn(new SqliteStore(this.path, conn));

      // IMMEDIATE takes the write lock up front. A deferred transaction takes
      // it at the first write and can fail there with SQLITE_BUSY after the
      // callback has already made decisions on what it read.
      conn.db.exec("begin immediate");
      conn.open = true;
      try {
        const result = await fn(new SqliteStore(this.path, conn));
        conn.db.exec("commit");
        return result;
      } catch (error) {
        conn.db.exec("rollback");
        throw error;
      } finally {
        conn.open = false;
      }
    };

    // Serialize root transactions, as the memory adapter does: one handle means
    // a second `begin` would throw, and two read-modify-write sequences sharing
    // one connection would otherwise interleave and lose an update.
    const scheduled = this.mutex.then(run, run);
    this.mutex = scheduled.then(
      () => undefined,
      () => undefined,
    );
    return scheduled;
  }

  /**
   * Run `fn` such that a throw undoes exactly its writes, whether or not a
   * transaction is already open. Inside one that has to be a savepoint: a plain
   * ROLLBACK would discard the caller's work too.
   *
   * Synchronous throughout — `fn` cannot await, which is what makes the whole
   * block run between two event-loop turns and gives `reserveBlocks` its
   * exactly-one-winner behaviour without a lock.
   */
  private atomic<T>(conn: Connection, fn: () => T): T {
    const { db } = conn;
    if (conn.open) {
      conn.savepointSeq += 1;
      const name = `dp_sp_${conn.savepointSeq}`;
      db.exec(`savepoint ${name}`);
      try {
        const result = fn();
        db.exec(`release ${name}`);
        return result;
      } catch (error) {
        db.exec(`rollback to ${name}`);
        db.exec(`release ${name}`);
        throw error;
      }
    }

    db.exec("begin immediate");
    conn.open = true;
    try {
      const result = fn();
      db.exec("commit");
      return result;
    } catch (error) {
      db.exec("rollback");
      throw error;
    } finally {
      conn.open = false;
    }
  }

  /* ------------------------------------------------------------- users -- */

  async getUser(id: string): Promise<User | undefined> {
    const { db } = await this.handle();
    const row = db.prepare("select * from users where id = $id").get({ id });
    return row && toUser(row);
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    // Matches the `lower(handle)` unique index in schema.sqlite.sql — a lookup
    // that was case-sensitive against a case-insensitive constraint would miss
    // rows it is supposed to find.
    const { db } = await this.handle();
    const row = db
      .prepare("select * from users where lower(handle) = lower($handle)")
      .get({ handle });
    return row && toUser(row);
  }

  async createUser(user: User): Promise<User> {
    const { db } = await this.handle();
    db.prepare(
      "insert into users (id, handle, display_name, created_at) values ($id, $handle, $displayName, $createdAt)",
    ).run({
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      createdAt: isoText(user.createdAt),
    });
    return user;
  }

  /* ------------------------------------------------------------- pages -- */

  async getPage(id: string): Promise<Page | undefined> {
    const { db } = await this.handle();
    const row = db.prepare("select * from pages where id = $id").get({ id });
    return row && toPage(row);
  }

  async getPageBySlug(slug: string): Promise<Page | undefined> {
    const { db } = await this.handle();
    const row = db.prepare("select * from pages where slug = $slug").get({ slug });
    return row && toPage(row);
  }

  async listPages(opts?: { listedOnly?: boolean }): Promise<Page[]> {
    const { db } = await this.handle();
    const where = opts?.listedOnly ? "where kind <> 'private'" : "";
    return db
      .prepare(`select * from pages ${where} order by created_at, id`)
      .all()
      .map(toPage);
  }

  async listPagesByOwner(ownerId: string): Promise<Page[]> {
    const { db } = await this.handle();
    return db
      .prepare("select * from pages where owner_id = $ownerId order by created_at, id")
      .all({ ownerId })
      .map(toPage);
  }

  async createPage(page: Page): Promise<Page> {
    const { db } = await this.handle();
    db.prepare(
      `insert into pages
         (id, slug, title, kind, size, owner_id, allowance_total, allowance_used, created_at)
       values ($id, $slug, $title, $kind, $size, $ownerId, $allowanceTotal, $allowanceUsed, $createdAt)`,
    ).run({
      id: page.id,
      slug: page.slug,
      title: page.title,
      kind: page.kind,
      size: page.size,
      ownerId: page.ownerId,
      allowanceTotal: page.allowanceTotal,
      allowanceUsed: page.allowanceUsed,
      createdAt: isoText(page.createdAt),
    });
    return page;
  }

  async consumeAllowance(pageId: string, n: number): Promise<boolean> {
    if (!Number.isInteger(n) || n < 0) return false;
    const { db } = await this.handle();
    // One statement, so the read and the write cannot be separated and no
    // second caller can spend the same last block. The `check` constraint in
    // the schema says the same thing a second time, for any path that is not
    // this one.
    const result = db
      .prepare(
        `update pages set allowance_used = allowance_used + $n
          where id = $pageId and allowance_used + $n <= allowance_total`,
      )
      .run({ pageId, n });
    return affected(result) === 1;
  }

  /* ------------------------------------------------------------ claims -- */

  async getClaim(id: string): Promise<Claim | undefined> {
    const { db } = await this.handle();
    const row = db.prepare("select * from claims where id = $id").get({ id });
    return row && toClaim(row);
  }

  async listClaims(pageId: string): Promise<Claim[]> {
    const { db } = await this.handle();
    return db
      .prepare("select * from claims where page_id = $pageId order by created_at, id")
      .all({ pageId })
      .map(toClaim);
  }

  async listClaimsByOwner(ownerId: string): Promise<Claim[]> {
    const { db } = await this.handle();
    return db
      .prepare("select * from claims where owner_id = $ownerId order by created_at, id")
      .all({ ownerId })
      .map(toClaim);
  }

  async countOwnedBlocks(pageId: string): Promise<number> {
    const { db } = await this.handle();
    const row = db
      .prepare("select count(*) as n from blocks where page_id = $pageId")
      .get({ pageId });
    return row ? num(row, "n") : 0;
  }

  /* ------------------------------------------------- holds and claiming -- */

  async reserveBlocks(
    pageId: string,
    rect: BlockRect,
    orderId: string,
    expiresAt: Date,
    now: Date,
  ): Promise<boolean> {
    const conn = await this.handle();
    const nowText = isoText(now);
    const x1 = rect.bx + rect.bw;
    const y1 = rect.by + rect.bh;

    return this.atomic(conn, () => {
      const { db } = conn;

      // Opportunistic cleanup, not correctness: the filters below already treat
      // an expired hold as absent (DECISIONS D9).
      db.prepare(
        "delete from holds where page_id = $pageId and expires_at <= $now",
      ).run({ pageId, now: nowText });

      const owned = db
        .prepare(
          `select 1 from blocks
            where page_id = $pageId and bx >= $x0 and bx < $x1 and "by" >= $y0 and "by" < $y1
            limit 1`,
        )
        .get({ pageId, x0: rect.bx, x1, y0: rect.by, y1 });
      if (owned) return false;

      const held = db
        .prepare(
          `select 1 from holds
            where page_id = $pageId and order_id <> $orderId and expires_at > $now
              and bx < $x1 and $x0 < bx + bw
              and "by" < $y1 and $y0 < "by" + bh
            limit 1`,
        )
        .get({ pageId, orderId, now: nowText, x0: rect.bx, x1, y0: rect.by, y1 });
      if (held) return false;

      // One hold per order: a retry with a different rect replaces the earlier
      // reservation instead of leaving it stranded until it expires.
      db.prepare(
        `insert into holds (order_id, page_id, bx, "by", bw, bh, expires_at)
         values ($orderId, $pageId, $bx, $by, $bw, $bh, $expiresAt)
         on conflict (order_id) do update
            set page_id = excluded.page_id, bx = excluded.bx, "by" = excluded."by",
                bw = excluded.bw, bh = excluded.bh, expires_at = excluded.expires_at`,
      ).run({
        orderId,
        pageId,
        bx: rect.bx,
        by: rect.by,
        bw: rect.bw,
        bh: rect.bh,
        expiresAt: isoText(expiresAt),
      });
      return true;
    });
  }

  async releaseHold(orderId: string): Promise<void> {
    const { db } = await this.handle();
    db.prepare("delete from holds where order_id = $orderId").run({ orderId });
  }

  async getHold(orderId: string): Promise<Hold | undefined> {
    // Returned as stored, expired or not: there is no `now` here to judge it
    // against, and the caller has one (DECISIONS D9).
    const { db } = await this.handle();
    const row = db
      .prepare("select * from holds where order_id = $orderId")
      .get({ orderId });
    return row && toHold(row);
  }

  async listHolds(pageId: string): Promise<Hold[]> {
    const { db } = await this.handle();
    return db
      .prepare("select * from holds where page_id = $pageId order by expires_at, order_id")
      .all({ pageId })
      .map(toHold);
  }

  async claimBlocks(claim: Claim, now: Date): Promise<boolean> {
    const conn = await this.handle();
    const nowText = isoText(now);

    try {
      return this.atomic(conn, () => {
        const { db } = conn;

        // No `for update` counterpart here, and none needed: SQLite serialises
        // writers, and nothing yields between this read and the inserts below.
        const holdRow = db
          .prepare("select * from holds where order_id = $orderId")
          .get({ orderId: claim.orderId });
        if (!holdRow) return false;
        const hold = toHold(holdRow);
        if (hold.pageId !== claim.pageId) return false;
        if (Date.parse(hold.expiresAt) <= now.getTime()) return false;
        // A claim may only take blocks its own order reserved. Without this an
        // order could hold one block and settle over a thousand.
        if (!rectWithin(claim.rect, hold.rect)) return false;

        db.prepare(
          `insert into claims
             (id, page_id, owner_id, bx, "by", bw, bh, caption, colour, tile, order_id, created_at)
           values ($id, $pageId, $ownerId, $bx, $by, $bw, $bh, $caption, $colour, $tile, $orderId, $createdAt)`,
        ).run({
          id: claim.id,
          pageId: claim.pageId,
          ownerId: claim.ownerId,
          bx: claim.rect.bx,
          by: claim.rect.by,
          bw: claim.rect.bw,
          bh: claim.rect.bh,
          caption: claim.caption,
          colour: claim.colour,
          tile: claim.tile,
          orderId: claim.orderId,
          createdAt: isoText(claim.createdAt),
        });

        // The arbiter. Any block already owned conflicts, is skipped, and the
        // row count comes back short — at which point nothing this block wrote
        // survives (research/persistence-and-vercel.md §6).
        //
        // The recursive CTEs stand in for Postgres' `generate_series`, and the
        // `where true` is not decoration: SQLite's parser needs it to tell the
        // `ON CONFLICT` clause of an upsert from a join constraint on the
        // SELECT, and rejects the statement outright without it.
        const inserted = db
          .prepare(
            `insert into blocks (page_id, bx, "by", claim_id)
             with recursive
               gx(v) as (select $x0 union all select v + 1 from gx where v < $x1),
               gy(v) as (select $y0 union all select v + 1 from gy where v < $y1)
             select $pageId, gx.v, gy.v, $claimId from gx, gy where true
             on conflict (page_id, bx, "by") do nothing`,
          )
          .run({
            pageId: claim.pageId,
            claimId: claim.id,
            x0: claim.rect.bx,
            x1: claim.rect.bx + claim.rect.bw - 1,
            y0: claim.rect.by,
            y1: claim.rect.by + claim.rect.bh - 1,
          });
        if (affected(inserted) !== blocksIn(claim.rect)) throw new Rollback();

        db.prepare("delete from holds where order_id = $orderId").run({
          orderId: claim.orderId,
        });
        db.prepare(
          "delete from holds where page_id = $pageId and expires_at <= $now",
        ).run({ pageId: claim.pageId, now: nowText });
        return true;
      });
    } catch (error) {
      if (error instanceof Rollback) return false;
      throw error;
    }
  }

  async isRectAvailable(
    pageId: string,
    rect: BlockRect,
    now: Date,
    ignoreOrderId?: string,
  ): Promise<boolean> {
    const { db } = await this.handle();
    const row = db
      .prepare(
        `select
           not exists (
             select 1 from blocks
              where page_id = $pageId and bx >= $x0 and bx < $x1 and "by" >= $y0 and "by" < $y1
           )
           and not exists (
             select 1 from holds
              where page_id = $pageId and expires_at > $now
                and ($ignoreOrderId is null or order_id <> $ignoreOrderId)
                and bx < $x1 and $x0 < bx + bw
                and "by" < $y1 and $y0 < "by" + bh
           ) as available`,
      )
      .get({
        pageId,
        x0: rect.bx,
        x1: rect.bx + rect.bw,
        y0: rect.by,
        y1: rect.by + rect.bh,
        now: isoText(now),
        ignoreOrderId: ignoreOrderId ?? null,
      });
    // SQLite has no boolean type; a predicate evaluates to the integer 1 or 0.
    return row?.["available"] === 1;
  }

  /* ------------------------------------------------------------ orders -- */

  async getOrder(id: string): Promise<Order | undefined> {
    const { db } = await this.handle();
    const row = db.prepare("select * from orders where id = $id").get({ id });
    return row && toOrder(row);
  }

  async listOrdersByBuyer(buyerId: string): Promise<Order[]> {
    const { db } = await this.handle();
    return db
      .prepare("select * from orders where buyer_id = $buyerId order by created_at, id")
      .all({ buyerId })
      .map(toOrder);
  }

  async createOrder(order: Order): Promise<Order> {
    const { db } = await this.handle();
    db.prepare(
      `insert into orders (${ORDER_COLUMNS})
       values ($id, $kind, $pageId, $buyerId, $amountCents, $status, $provider,
               $providerRef, $payload, $createdAt, $settledAt)`,
    ).run({
      id: order.id,
      kind: order.kind,
      pageId: order.pageId,
      buyerId: order.buyerId,
      amountCents: order.amountCents,
      status: order.status,
      provider: order.provider,
      providerRef: order.providerRef,
      payload: JSON.stringify(order.payload),
      createdAt: isoText(order.createdAt),
      settledAt: isoTextOrNull(order.settledAt),
    });
    return order;
  }

  async updateOrderStatus(
    id: string,
    status: OrderStatus,
    patch?: { providerRef?: string; settledAt?: string; pageId?: string },
  ): Promise<Order | undefined> {
    const { db } = await this.handle();
    // `status = 'pending'` in the WHERE is the state machine: a terminal order
    // matches nothing, no row comes back, and the caller decides whether that
    // is an idempotent success or an error (SPEC §6, DECISIONS D17).
    const rows = db
      .prepare(
        `update orders
            set status = $status,
                provider_ref = coalesce($providerRef, provider_ref),
                settled_at = coalesce($settledAt, settled_at),
                page_id = coalesce($pageId, page_id)
          where id = $id and status = 'pending'
          returning ${ORDER_COLUMNS}`,
      )
      .all({
        id,
        status,
        providerRef: patch?.providerRef ?? null,
        settledAt: patch?.settledAt ? isoText(patch.settledAt) : null,
        pageId: patch?.pageId ?? null,
      });
    const row = rows[0];
    return row && toOrder(row);
  }

  async setOrderProviderRef(id: string, providerRef: string): Promise<Order | undefined> {
    const { db } = await this.handle();
    const rows = db
      .prepare(
        `update orders set provider_ref = $providerRef where id = $id
         returning ${ORDER_COLUMNS}`,
      )
      .all({ id, providerRef });
    const row = rows[0];
    return row && toOrder(row);
  }

  /* ------------------------------------------------------------ ledger -- */

  async appendLedger(entries: readonly LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const conn = await this.handle();
    // One statement per entry, but one transaction for the batch: the entries
    // of a single settlement are meaningless apart, so they land together or
    // not at all. Postgres gets that from a single multi-row INSERT; here the
    // savepoint does it, and covers the duplicate-id throw as well.
    this.atomic(conn, () => {
      const insert = conn.db.prepare(
        `insert into ledger_entries
           (id, order_id, page_id, recipient_id, amount_cents, kind, created_at)
         values ($id, $orderId, $pageId, $recipientId, $amountCents, $kind, $createdAt)`,
      );
      for (const entry of entries) {
        insert.run({
          id: entry.id,
          orderId: entry.orderId,
          pageId: entry.pageId,
          recipientId: entry.recipientId,
          amountCents: entry.amountCents,
          kind: entry.kind,
          createdAt: isoText(entry.createdAt),
        });
      }
    });
  }

  async listLedgerFor(recipientId: string): Promise<LedgerEntry[]> {
    const { db } = await this.handle();
    return db
      .prepare(
        "select * from ledger_entries where recipient_id = $recipientId order by created_at, id",
      )
      .all({ recipientId })
      .map(toLedgerEntry);
  }

  async balanceFor(recipientId: string): Promise<Cents> {
    const { db } = await this.handle();
    const row = db
      .prepare(
        `select coalesce(sum(amount_cents), 0) as balance
           from ledger_entries where recipient_id = $recipientId`,
      )
      .get({ recipientId });
    return row ? num(row, "balance") : 0;
  }

  /* ------------------------------------------------------------ events -- */

  async markEventProcessed(event: ProcessedEvent): Promise<boolean> {
    const { db } = await this.handle();
    const result = db
      .prepare(
        `insert into processed_events (id, provider, received_at)
         values ($id, $provider, $receivedAt)
         on conflict (id) do nothing`,
      )
      .run({
        id: event.id,
        provider: event.provider,
        receivedAt: isoText(event.receivedAt),
      });
    return affected(result) === 1;
  }
}
