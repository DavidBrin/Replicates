/**
 * The Neon Postgres `Store`.
 *
 * The schema is in `schema.sql` and is applied out of band — see the header
 * there. This adapter never issues DDL, because a serverless function that
 * migrates on first request migrates once per cold start, from however many
 * instances happen to be warming at the time.
 *
 * Two structural choices carry most of the correctness:
 *
 * - **`blocks` has `PRIMARY KEY (page_id, bx, by)`.** Claiming inserts the
 *   whole rect with `ON CONFLICT DO NOTHING` and compares the row count to the
 *   rect's size, so a double claim is impossible rather than improbable
 *   (`research/persistence-and-vercel.md` §6).
 * - **`reserveBlocks` takes a transaction-scoped advisory lock on the page.**
 *   Holds are stored one row per order, so `ON CONFLICT` cannot arbitrate
 *   between two orders reserving overlapping rectangles — under READ COMMITTED
 *   both would see a clear rect and both would insert their own row. The lock
 *   is the plain, obviously-correct way to serialise that; it is held only for
 *   the reservation and only per page.
 *
 * `@neondatabase/serverless` is an optional dependency and is imported
 * dynamically, so nothing loads a driver — or fails for want of one — when
 * `STORE_DRIVER` is `memory`.
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

interface PgResult {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

interface PgQueryable {
  query(text: string, params?: readonly unknown[]): Promise<PgResult>;
}

interface PgClient extends PgQueryable {
  release(): void;
}

interface PgPool extends PgQueryable {
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

interface NeonDriver {
  readonly Pool: new (config: { connectionString: string }) => PgPool;
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
 * `int8` and `numeric` come back from the driver as strings, because they can
 * hold values a JS number cannot. Every one we read is bounded well inside
 * `Number.MAX_SAFE_INTEGER` — the largest is 16,000,000 cents — so parsing is
 * safe here and only here.
 */
function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new TypeError(`expected a number in column ${column}, got ${typeof value}`);
}

/** Entities carry ISO strings; `timestamptz` arrives as a `Date`. */
function iso(row: Row, column: string): string {
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new TypeError(`expected a timestamp in column ${column}, got ${typeof value}`);
}

function isoOrNull(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : iso(row, column);
}

function oneOf<T extends string>(
  row: Row,
  column: string,
  allowed: readonly T[],
): T {
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
 * `jsonb` is returned parsed, but the database cannot vouch for its shape, so
 * the discriminant is checked before the cast rather than after something
 * downstream reads a missing field.
 */
function orderPayload(row: Row): OrderPayload {
  const value = row["payload"];
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const kind = (value as Record<string, unknown>)["kind"];
    if (kind === "blocks" || kind === "page") return value as OrderPayload;
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

/** `rowCount` is nullable in the driver's types; a null means no rows moved. */
function affected(result: PgResult): number {
  return result.rowCount ?? 0;
}

function first(result: PgResult): Row | undefined {
  return result.rows[0];
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

export class PostgresStore implements Store {
  private readonly connectionString: string;
  /** Non-null exactly when this instance is a view onto an open transaction. */
  private readonly conn: PgClient | null;
  /** The promise, not the pool: two concurrent first requests must not each
   *  open one and leave the loser's connections dangling. */
  private pooling: Promise<PgPool> | null = null;
  private savepointSeq = 0;

  constructor(connectionString: string, conn: PgClient | null = null) {
    if (!connectionString) {
      throw new Error("PostgresStore needs a connection string (DATABASE_URL)");
    }
    this.connectionString = connectionString;
    this.conn = conn;
  }

  private async driver(): Promise<NeonDriver> {
    // Dynamic so the memory path never touches an optional dependency that may
    // not be installed at all.
    return (await import("@neondatabase/serverless")) as unknown as NeonDriver;
  }

  private async getPool(): Promise<PgPool> {
    this.pooling ??= this.driver().then(
      ({ Pool }) => new Pool({ connectionString: this.connectionString }),
    );
    return this.pooling;
  }

  private async query(text: string, params: readonly unknown[] = []): Promise<PgResult> {
    if (this.conn) return this.conn.query(text, params);
    const pool = await this.getPool();
    return pool.query(text, params);
  }

  /** Releases the pool. Nothing on the request path calls this. */
  async close(): Promise<void> {
    const pooling = this.pooling;
    this.pooling = null;
    if (pooling) await (await pooling).end();
  }

  /* ---------------------------------------------------------- transact -- */

  async transact<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    return this.runTransaction(fn);
  }

  private async runTransaction<T>(fn: (tx: PostgresStore) => Promise<T>): Promise<T> {
    // Nested: join the transaction already open on this connection. Opening a
    // second one would deadlock against the first's row locks.
    if (this.conn) return fn(this);

    const pool = await this.getPool();
    const conn = await pool.connect();
    const tx = new PostgresStore(this.connectionString, conn);
    try {
      await conn.query("begin");
      const result = await fn(tx);
      await conn.query("commit");
      return result;
    } catch (error) {
      // A rollback on a connection the server has already closed throws over
      // the top of the real failure, which is the one worth seeing.
      await conn.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Run `fn` such that a throw undoes exactly its writes, whether or not a
   * caller's transaction is already open. Inside one, that has to be a
   * savepoint: a plain ROLLBACK would discard the caller's work too.
   */
  private async atomic<T>(fn: (tx: PostgresStore) => Promise<T>): Promise<T> {
    const conn = this.conn;
    if (!conn) return this.runTransaction(fn);

    this.savepointSeq += 1;
    const name = `dp_sp_${this.savepointSeq}`;
    await conn.query(`savepoint ${name}`);
    try {
      const result = await fn(this);
      await conn.query(`release savepoint ${name}`);
      return result;
    } catch (error) {
      await conn.query(`rollback to savepoint ${name}`);
      await conn.query(`release savepoint ${name}`);
      throw error;
    }
  }

  /* ------------------------------------------------------------- users -- */

  async getUser(id: string): Promise<User | undefined> {
    const row = first(await this.query("select * from users where id = $1", [id]));
    return row && toUser(row);
  }

  async getUserByHandle(handle: string): Promise<User | undefined> {
    // Matches the `lower(handle)` unique index in schema.sql — a lookup that
    // was case-sensitive against a case-insensitive constraint would miss rows
    // it is supposed to find.
    const row = first(
      await this.query("select * from users where lower(handle) = lower($1)", [handle]),
    );
    return row && toUser(row);
  }

  async createUser(user: User): Promise<User> {
    await this.query(
      "insert into users (id, handle, display_name, created_at) values ($1, $2, $3, $4)",
      [user.id, user.handle, user.displayName, user.createdAt],
    );
    return user;
  }

  /* ------------------------------------------------------------- pages -- */

  async getPage(id: string): Promise<Page | undefined> {
    const row = first(await this.query("select * from pages where id = $1", [id]));
    return row && toPage(row);
  }

  async getPageBySlug(slug: string): Promise<Page | undefined> {
    const row = first(await this.query("select * from pages where slug = $1", [slug]));
    return row && toPage(row);
  }

  async listPages(opts?: { listedOnly?: boolean }): Promise<Page[]> {
    const where = opts?.listedOnly ? "where kind <> 'private'" : "";
    const result = await this.query(
      `select * from pages ${where} order by created_at, id`,
    );
    return result.rows.map(toPage);
  }

  async listPagesByOwner(ownerId: string): Promise<Page[]> {
    const result = await this.query(
      "select * from pages where owner_id = $1 order by created_at, id",
      [ownerId],
    );
    return result.rows.map(toPage);
  }

  async createPage(page: Page): Promise<Page> {
    await this.query(
      `insert into pages
         (id, slug, title, kind, size, owner_id, allowance_total, allowance_used, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        page.id,
        page.slug,
        page.title,
        page.kind,
        page.size,
        page.ownerId,
        page.allowanceTotal,
        page.allowanceUsed,
        page.createdAt,
      ],
    );
    return page;
  }

  async consumeAllowance(pageId: string, n: number): Promise<boolean> {
    if (!Number.isInteger(n) || n < 0) return false;
    // One statement, so the read and the write cannot be separated. Under a
    // concurrent update Postgres re-evaluates the WHERE against the new row
    // version, which is what stops two callers both spending the last block.
    const result = await this.query(
      `update pages set allowance_used = allowance_used + $2
        where id = $1 and allowance_used + $2 <= allowance_total`,
      [pageId, n],
    );
    return affected(result) === 1;
  }

  /* ------------------------------------------------------------ claims -- */

  async getClaim(id: string): Promise<Claim | undefined> {
    const row = first(await this.query("select * from claims where id = $1", [id]));
    return row && toClaim(row);
  }

  async listClaims(pageId: string): Promise<Claim[]> {
    const result = await this.query(
      "select * from claims where page_id = $1 order by created_at, id",
      [pageId],
    );
    return result.rows.map(toClaim);
  }

  async listClaimsByOwner(ownerId: string): Promise<Claim[]> {
    const result = await this.query(
      "select * from claims where owner_id = $1 order by created_at, id",
      [ownerId],
    );
    return result.rows.map(toClaim);
  }

  async countOwnedBlocks(pageId: string): Promise<number> {
    const row = first(
      await this.query("select count(*)::bigint as n from blocks where page_id = $1", [
        pageId,
      ]),
    );
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
    return this.atomic(async (tx) => {
      // Serialise reservations for this page. Without it two overlapping
      // rectangles both pass the checks below and both insert their own hold
      // row, and the loser never finds out. Transaction-scoped, so it is
      // released by the commit whatever happens.
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
        pageId,
      ]);

      // Opportunistic cleanup, not correctness: the filters below already
      // treat an expired hold as absent (DECISIONS D9).
      await tx.query("delete from holds where page_id = $1 and expires_at <= $2", [
        pageId,
        now,
      ]);

      const x1 = rect.bx + rect.bw;
      const y1 = rect.by + rect.bh;

      const owned = await tx.query(
        `select 1 from blocks
          where page_id = $1 and bx >= $2 and bx < $3 and "by" >= $4 and "by" < $5
          limit 1`,
        [pageId, rect.bx, x1, rect.by, y1],
      );
      if (owned.rows.length > 0) return false;

      const held = await tx.query(
        `select 1 from holds
          where page_id = $1 and order_id <> $2 and expires_at > $3
            and bx < $5 and $4 < bx + bw
            and "by" < $7 and $6 < "by" + bh
          limit 1`,
        [pageId, orderId, now, rect.bx, x1, rect.by, y1],
      );
      if (held.rows.length > 0) return false;

      // One hold per order: a retry with a different rect replaces the earlier
      // reservation instead of leaving it stranded until it expires.
      await tx.query(
        `insert into holds (order_id, page_id, bx, "by", bw, bh, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (order_id) do update
            set page_id = excluded.page_id, bx = excluded.bx, "by" = excluded."by",
                bw = excluded.bw, bh = excluded.bh, expires_at = excluded.expires_at`,
        [orderId, pageId, rect.bx, rect.by, rect.bw, rect.bh, expiresAt],
      );
      return true;
    });
  }

  async releaseHold(orderId: string): Promise<void> {
    await this.query("delete from holds where order_id = $1", [orderId]);
  }

  async getHold(orderId: string): Promise<Hold | undefined> {
    // Returned as stored, expired or not: there is no `now` here to judge it
    // against, and the caller has one (DECISIONS D9).
    const row = first(
      await this.query("select * from holds where order_id = $1", [orderId]),
    );
    return row && toHold(row);
  }

  async listHolds(pageId: string): Promise<Hold[]> {
    const result = await this.query(
      "select * from holds where page_id = $1 order by expires_at, order_id",
      [pageId],
    );
    return result.rows.map(toHold);
  }

  async claimBlocks(claim: Claim, now: Date): Promise<boolean> {
    try {
      return await this.atomic(async (tx) => {
        // FOR UPDATE, so a concurrent release or re-reservation of this hold
        // waits rather than racing the block inserts below.
        const holdRow = first(
          await tx.query("select * from holds where order_id = $1 for update", [
            claim.orderId,
          ]),
        );
        if (!holdRow) return false;
        const hold = toHold(holdRow);
        if (hold.pageId !== claim.pageId) return false;
        if (Date.parse(hold.expiresAt) <= now.getTime()) return false;
        // A claim may only take blocks its own order reserved. Without this an
        // order could hold one block and settle over a thousand.
        if (!rectWithin(claim.rect, hold.rect)) return false;

        await tx.query(
          `insert into claims
             (id, page_id, owner_id, bx, "by", bw, bh, caption, colour, tile, order_id, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            claim.id,
            claim.pageId,
            claim.ownerId,
            claim.rect.bx,
            claim.rect.by,
            claim.rect.bw,
            claim.rect.bh,
            claim.caption,
            claim.colour,
            claim.tile,
            claim.orderId,
            claim.createdAt,
          ],
        );

        // The arbiter. Any block already owned conflicts, is skipped, and the
        // row count comes back short — at which point nothing this block wrote
        // survives (research/persistence-and-vercel.md §6).
        const inserted = await tx.query(
          `insert into blocks (page_id, bx, "by", claim_id)
           select $1, gx, gy, $2
             from generate_series($3::int, $4::int) as gx,
                  generate_series($5::int, $6::int) as gy
           on conflict (page_id, bx, "by") do nothing`,
          [
            claim.pageId,
            claim.id,
            claim.rect.bx,
            claim.rect.bx + claim.rect.bw - 1,
            claim.rect.by,
            claim.rect.by + claim.rect.bh - 1,
          ],
        );
        if (affected(inserted) !== blocksIn(claim.rect)) throw new Rollback();

        await tx.query("delete from holds where order_id = $1", [claim.orderId]);
        await tx.query("delete from holds where page_id = $1 and expires_at <= $2", [
          claim.pageId,
          now,
        ]);
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
    const x1 = rect.bx + rect.bw;
    const y1 = rect.by + rect.bh;
    const row = first(
      await this.query(
        `select
           not exists (
             select 1 from blocks
              where page_id = $1 and bx >= $2 and bx < $3 and "by" >= $4 and "by" < $5
           )
           and not exists (
             select 1 from holds
              where page_id = $1 and expires_at > $6
                and ($7::text is null or order_id <> $7)
                and bx < $3 and $2 < bx + bw
                and "by" < $5 and $4 < "by" + bh
           ) as available`,
        [pageId, rect.bx, x1, rect.by, y1, now, ignoreOrderId ?? null],
      ),
    );
    return row?.["available"] === true;
  }

  /* ------------------------------------------------------------ orders -- */

  async getOrder(id: string): Promise<Order | undefined> {
    const row = first(await this.query("select * from orders where id = $1", [id]));
    return row && toOrder(row);
  }

  async listOrdersByBuyer(buyerId: string): Promise<Order[]> {
    const result = await this.query(
      "select * from orders where buyer_id = $1 order by created_at, id",
      [buyerId],
    );
    return result.rows.map(toOrder);
  }

  async createOrder(order: Order): Promise<Order> {
    await this.query(
      `insert into orders (${ORDER_COLUMNS})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        order.id,
        order.kind,
        order.pageId,
        order.buyerId,
        order.amountCents,
        order.status,
        order.provider,
        order.providerRef,
        JSON.stringify(order.payload),
        order.createdAt,
        order.settledAt,
      ],
    );
    return order;
  }

  async updateOrderStatus(
    id: string,
    status: OrderStatus,
    patch?: { providerRef?: string; settledAt?: string; pageId?: string },
  ): Promise<Order | undefined> {
    // `status = 'pending'` in the WHERE is the state machine: a terminal order
    // matches nothing, no row comes back, and the caller decides whether that
    // is an idempotent success or an error (SPEC §6, DECISIONS D17).
    const result = await this.query(
      `update orders
          set status = $2,
              provider_ref = coalesce($3, provider_ref),
              settled_at = coalesce($4::timestamptz, settled_at),
              page_id = coalesce($5, page_id)
        where id = $1 and status = 'pending'
        returning ${ORDER_COLUMNS}`,
      [id, status, patch?.providerRef ?? null, patch?.settledAt ?? null, patch?.pageId ?? null],
    );
    const row = first(result);
    return row && toOrder(row);
  }

  async setOrderProviderRef(id: string, providerRef: string): Promise<Order | undefined> {
    const result = await this.query(
      `update orders set provider_ref = $2 where id = $1 returning ${ORDER_COLUMNS}`,
      [id, providerRef],
    );
    const row = first(result);
    return row && toOrder(row);
  }

  /* ------------------------------------------------------------ ledger -- */

  async appendLedger(entries: readonly LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const params: unknown[] = [];
    const tuples = entries.map((entry) => {
      const base = params.length;
      params.push(
        entry.id,
        entry.orderId,
        entry.pageId,
        entry.recipientId,
        entry.amountCents,
        entry.kind,
        entry.createdAt,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    // One statement for the whole batch: the entries of a single settlement
    // are meaningless apart, so they land together or not at all.
    await this.query(
      `insert into ledger_entries
         (id, order_id, page_id, recipient_id, amount_cents, kind, created_at)
       values ${tuples.join(", ")}`,
      params,
    );
  }

  async listLedgerFor(recipientId: string): Promise<LedgerEntry[]> {
    const result = await this.query(
      "select * from ledger_entries where recipient_id = $1 order by created_at, id",
      [recipientId],
    );
    return result.rows.map(toLedgerEntry);
  }

  async balanceFor(recipientId: string): Promise<Cents> {
    const row = first(
      await this.query(
        `select coalesce(sum(amount_cents), 0)::bigint as balance
           from ledger_entries where recipient_id = $1`,
        [recipientId],
      ),
    );
    return row ? num(row, "balance") : 0;
  }

  /* ------------------------------------------------------------ events -- */

  async markEventProcessed(event: ProcessedEvent): Promise<boolean> {
    const result = await this.query(
      `insert into processed_events (id, provider, received_at)
       values ($1, $2, $3)
       on conflict (id) do nothing`,
      [event.id, event.provider, event.receivedAt],
    );
    return affected(result) === 1;
  }
}

