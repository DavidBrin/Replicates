# Persistence: what survives on Vercel, and what silently does not

Research lane 4. Fetched live against `vercel.com/docs`, `neon.com`, `upstash.com` in
August 2026.

Confidence tags as in `original-site.md`.

---

## 1. The constraint that decides everything

Vercel Functions run on a **read-only filesystem** with a writable `/tmp` scratch space of
about 500 MB. **HIGH** — stated on the runtimes page.

Two consequences, and the second is the dangerous one:

1. Writing anywhere in the project directory at runtime throws `EROFS: read-only file
   system`. Loud, immediate, easy to debug. **HIGH**
2. **`/tmp` is not shared and not persistent across invocations.** Each invocation may land
   on a different microVM; concurrent requests may hit different instances entirely.
   Functions are also archived when idle. So a store that writes to `/tmp` *works in
   testing*, then loses data intermittently in production with **no error at all**. **HIGH**

That second failure mode is why a JSON-file store is not an acceptable "simple" choice here.
It works perfectly in `next dev` — one long-lived process, one real writable disk — and then
fails silently once deployed. A pixel marketplace whose ownership ledger sometimes forgets
purchases is worse than one that refuses to start.

## 2. What Vercel offers now

Vercel's own managed KV and Postgres products are **gone**, folded into a marketplace model.
**HIGH**

| Old | Now | Package |
|---|---|---|
| Vercel KV | Upstash Redis, via the Marketplace | `@upstash/redis` |
| Vercel Postgres | Neon (also Supabase, Aurora, Prisma Postgres), via the Marketplace | `@neondatabase/serverless` |
| Vercel Blob | **still first-party**, not moved | `@vercel/blob` |

`@vercel/postgres` and `@vercel/kv` still exist on npm but are legacy shims; new code should
target the provider directly.

Free tiers, current: **HIGH**

- **Neon** — 0.5 GB storage per project, 100 compute-hours/month, no card required.
- **Upstash Redis** — 256 MB, 500K commands/month, 10 GB bandwidth, one database.
- **Vercel Blob (Hobby)** — 1 GB storage, 10 GB transfer.

Vercel Global Config exists but is for feature flags and redirects — writes take *seconds*
and it is positioned for data that changes rarely. Wrong tool for an order ledger. **HIGH**

## 3. SQLite

- **`better-sqlite3` on Vercel: no.** Native binary, incompatible with the Edge runtime, and
  any file it writes hits either the read-only project directory or ephemeral `/tmp`.
  Perfectly fine as a *local-dev* store; never as the deployed one. **HIGH**
- **libsql / Turso** is the "SQLite that works on Vercel" answer — same SQL, but reached over
  HTTP/WebSocket so a stateless function can talk to it. The client API becomes async. **HIGH**
- **Prisma + SQLite on serverless** inherits the same file problem. Prisma's own serverless
  answer is Postgres, not file-based SQLite. **MED**

## 4. The architecture that runs both ways

A repository interface, two implementations, selected by one environment variable:

```ts
export function getStore(): Store {
  if (process.env.STORE_DRIVER === "postgres") return new PostgresStore();
  return getMemoryStore();
}
```

### The module-level state trap, and the fix

A naive `const rows = new Map()` at module scope breaks twice: **HIGH**

1. Next's Fast Refresh re-evaluates modules on file change, re-running top-level code and
   wiping the map.
2. Multiple workers in dev — and multiple function instances in production — each get their
   own copy. "In memory" only ever means "in memory for this one instance".

The idiomatic workaround is the same `globalThis` singleton used for Prisma clients:

```ts
const g = globalThis as unknown as { __store?: MemoryStore };
export function getMemoryStore(): MemoryStore {
  g.__store ??= new MemoryStore();
  return g.__store;
}
```

`globalThis` survives module re-evaluation because Node resets the module cache but not the
global object. It does **not** survive across separate processes or function instances —
which is exactly why this is a dev-only convenience and never a production store. **HIGH**

Our sibling project `bet` has already hit a sharper version of this: in Next 16 a Server
Component's module graph and a Route Handler's module graph are bundled as separate layers,
so even a plain module-level singleton is constructed *twice*. Its container therefore keys
the memoised instance off `Symbol.for(...)` on `globalThis`. We inherit that fix rather than
rediscover it.

## 5. Images for block artwork

Three options for user-uploaded tile art:

- **`@vercel/blob`** — right answer for large, few files. Bills per operation, and for
  thousands of sub-kilobyte tiles you pay request overhead wildly disproportionate to the
  payload. **HIGH**
- **base64 in the database** — a small PNG is typically a couple of kilobytes; base64 adds a
  flat 33% overhead. One query returns ownership *and* artwork with no extra round trip, and
  Neon's 0.5 GB free tier holds many thousands of tiles comfortably. **HIGH**
- **data URLs inline in the grid payload** — no per-tile network request at all when the
  canvas draws hundreds of tiles at once. **HIGH**

For tiny fixed-size tiles, base64-beside-the-row wins on every axis that matters here.
Blob storage stays the right answer if we ever add large assets. See `DECISIONS.md` D11.

## 6. Preventing two buyers claiming the same block

**Postgres**, which is also where the orders and ledger want to live:

```sql
PRIMARY KEY (page_id, bx, by)          -- double-claim is structurally impossible

INSERT INTO blocks (...) VALUES (...)
ON CONFLICT (page_id, bx, by) DO NOTHING;   -- check rowCount to know if you won
```

`ON CONFLICT` is concurrency-safe under concurrent writers in a way check-then-insert is not.
Wrap claim + order row + ledger entry in one transaction so they land together. **HIGH**

**Redis**, if used as a front lock: `SET key value NX` is atomic and is the standard
first-writer-wins primitive. **HIGH**

Postgres is the right system of record here because orders and a creator-earnings ledger are
inherently relational and transactional; Redis would handle them awkwardly.

## Citations

- `https://vercel.com/docs/functions/runtimes` — read-only filesystem, `/tmp` 500 MB, archiving
- `https://vercel.com/docs/storage` — current product lineup
- `https://vercel.com/docs/marketplace-storage` — Neon/Upstash/Supabase provisioning
- `https://vercel.com/docs/vercel-blob/usage-and-pricing` — Blob free tier and per-operation pricing
- `https://neon.com/pricing` — Neon free tier
- `https://upstash.com/pricing` — Upstash free tier
- `https://vercel.com/marketplace/tursocloud` — Turso/libsql listing
- `https://github.com/vercel/community/discussions/314` — real-world `EROFS` report
