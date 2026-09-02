/**
 * Bulk-load the flagship wall over Neon's HTTP API.
 *
 * The runtime seeder goes through reserve-then-claim one rectangle at a time
 * on a WebSocket pool. Nine hundred of those round trips hold the socket open
 * long enough that Neon drops it. HTTP queries do not have that problem, and
 * inserting claims then expanding them into `blocks` with generate_series is
 * one statement instead of thousands.
 *
 * Idempotent: a wall that already has claims is left alone.
 *
 *   set -a && source .env.local && set +a
 *   node --experimental-strip-types scripts/seed-flagship.ts
 */

import { neon } from "@neondatabase/serverless";
import { blocksIn, eachBlock, gridForSize, type BlockRect } from "../src/domain/geometry.ts";

const SEED_USER_ID = "usr_seed";
const SEED_PAGE_ID = "pag_wall";
const SEED_EPOCH = "2026-01-01T00:00:00.000Z";
const SEED_CLAIMS = 675;
const FLAGSHIP_SLUG = "the-wall";

const TENANTS: readonly { caption: string; colour: string }[] = [
  { caption: "Harbour Lights Coffee", colour: "#6b3f2a" },
  { caption: "Third Avenue Bicycles", colour: "#1f9d2f" },
  { caption: "The Paper Lantern", colour: "#c0182b" },
  { caption: "Molehill Records", colour: "#1b1b1b" },
  { caption: "Cold Spring Swim Club", colour: "#0a7cff" },
  { caption: "Ferris & Daughters, Ironmongers", colour: "#7a7a7a" },
  { caption: "Quiet Hours Bookshop", colour: "#7b2d8b" },
  { caption: "Ninepin Bowling", colour: "#d9ab22" },
  { caption: "Saltmarsh Kayak Hire", colour: "#0f766e" },
  { caption: "The Long Way Round Travel", colour: "#e2761b" },
  { caption: "Pewter Street Barbers", colour: "#000099" },
  { caption: "Greenhouse Gardening", colour: "#4d7c0f" },
  { caption: "Anvil Fitness", colour: "#57534e" },
  { caption: "Marigold Flowers", colour: "#eab308" },
  { caption: "Bell & Whistle Hardware", colour: "#b91c1c" },
  { caption: "Little Owl Nursery", colour: "#a16207" },
  { caption: "Chapter House Print", colour: "#334155" },
  { caption: "Nightjar Brewing", colour: "#7c2d12" },
  { caption: "Two Rivers Fishing", colour: "#0369a1" },
  { caption: "Copper Kettle Kitchens", colour: "#a45309" },
];

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function planClaims(
  dims: { wBlocks: number; hBlocks: number },
  count: number,
): { rect: BlockRect; tenant: (typeof TENANTS)[number] }[] {
  const rand = lcg(0x9e3779b9);
  const taken = new Set<number>();
  const out: { rect: BlockRect; tenant: (typeof TENANTS)[number] }[] = [];
  const pick = (n: number) => Math.floor(rand() * n);
  const sizes: [number, number][] = [
    [4, 4], [4, 4], [6, 4], [8, 6], [10, 6],
    [12, 8], [6, 6], [5, 3], [16, 10], [20, 12],
    [3, 3], [8, 8], [14, 6], [7, 5], [24, 16],
  ];

  let attempts = 0;
  while (out.length < count && attempts < count * 60) {
    attempts++;
    const [bw, bh] = sizes[pick(sizes.length)];
    const bx = pick(dims.wBlocks - bw);
    const by = pick(dims.hBlocks - bh);
    const rect: BlockRect = { bx, by, bw, bh };
    let clash = false;
    for (const { bx: x, by: y } of eachBlock(rect)) {
      if (taken.has(y * dims.wBlocks + x)) {
        clash = true;
        break;
      }
    }
    if (clash) continue;
    for (const { bx: x, by: y } of eachBlock(rect)) {
      taken.add(y * dims.wBlocks + x);
    }
    out.push({ rect, tenant: TENANTS[out.length % TENANTS.length] });
  }
  return out;
}

type Sql = ReturnType<typeof neon>;

async function insertBatch(
  sql: Sql,
  planned: { rect: BlockRect; tenant: (typeof TENANTS)[number] }[],
  offset: number,
): Promise<void> {
  const orderIds: string[] = [];
  const amounts: number[] = [];
  const payloads: string[] = [];
  const claimIds: string[] = [];
  const bxs: number[] = [];
  const bys: number[] = [];
  const bws: number[] = [];
  const bhs: number[] = [];
  const captions: string[] = [];
  const colours: string[] = [];

  const ns: number[] = [];
  planned.forEach((item, i) => {
    const n = offset + i + 1;
    ns.push(n);
    const orderId = `ord_seed_${n}`;
    orderIds.push(orderId);
    amounts.push(blocksIn(item.rect) * 100);
    payloads.push(
      JSON.stringify({
        kind: "blocks",
        pageId: SEED_PAGE_ID,
        rect: item.rect,
        caption: item.tenant.caption,
        colour: item.tenant.colour,
        tile: null,
      }),
    );
    claimIds.push(`clm_seed_${n}`);
    bxs.push(item.rect.bx);
    bys.push(item.rect.by);
    bws.push(item.rect.bw);
    bhs.push(item.rect.bh);
    captions.push(item.tenant.caption);
    colours.push(item.tenant.colour);
  });

  await sql`
    insert into orders (
      id, kind, page_id, buyer_id, amount_cents, status, provider,
      provider_ref, payload, created_at, settled_at
    )
    select
      id, 'blocks', ${SEED_PAGE_ID}, ${SEED_USER_ID}, amount, 'paid', 'seed',
      'seed_' || n::text, payload::jsonb, ${SEED_EPOCH}::timestamptz,
      ${SEED_EPOCH}::timestamptz
    from unnest(
      ${orderIds}::text[],
      ${amounts}::int[],
      ${payloads}::text[],
      ${ns}::int[]
    ) as t(id, amount, payload, n)
    on conflict (id) do nothing
  `;

  await sql`
    insert into claims (
      id, page_id, owner_id, bx, "by", bw, bh, caption, colour, tile, order_id, created_at
    )
    select
      claim_id, ${SEED_PAGE_ID}, ${SEED_USER_ID}, bx, by, bw, bh,
      caption, colour, null, order_id, ${SEED_EPOCH}::timestamptz
    from unnest(
      ${claimIds}::text[],
      ${bxs}::int[],
      ${bys}::int[],
      ${bws}::int[],
      ${bhs}::int[],
      ${captions}::text[],
      ${colours}::text[],
      ${orderIds}::text[]
    ) as t(claim_id, bx, by, bw, bh, caption, colour, order_id)
    on conflict (id) do nothing
  `;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("seed-flagship requires DATABASE_URL");

  const sql = neon(url);
  const existing = await sql`select count(*)::int as n from claims where page_id = ${SEED_PAGE_ID}`;
  const claimCount = existing[0]?.n ?? 0;
  if (claimCount > 0) {
    process.stdout.write(`Wall already has ${claimCount} claims; leaving it.\n`);
    return;
  }

  process.stdout.write("Bulk-seeding the flagship wall over HTTP…\n");
  const started = Date.now();

  await sql`
    insert into users (id, handle, display_name, created_at)
    values (${SEED_USER_ID}, 'the-wall', 'Early tenants', ${SEED_EPOCH}::timestamptz)
    on conflict (id) do nothing
  `;
  await sql`
    insert into pages (
      id, slug, title, kind, size, owner_id, allowance_total, allowance_used, created_at
    )
    values (
      ${SEED_PAGE_ID}, ${FLAGSHIP_SLUG}, 'The Wall', 'flagship', 'full',
      null, 0, 0, ${SEED_EPOCH}::timestamptz
    )
    on conflict (id) do nothing
  `;

  const planned = planClaims(gridForSize("full"), SEED_CLAIMS);
  const batchSize = 100;
  for (let i = 0; i < planned.length; i += batchSize) {
    await insertBatch(sql, planned.slice(i, i + batchSize), i);
    process.stdout.write(`  claims ${Math.min(i + batchSize, planned.length)}/${planned.length}\n`);
  }

  await sql`
    insert into blocks (page_id, bx, "by", claim_id)
    select ${SEED_PAGE_ID}, gx, gy, c.id
      from claims c
      cross join lateral generate_series(c.bx, c.bx + c.bw - 1) as gx
      cross join lateral generate_series(c."by", c."by" + c.bh - 1) as gy
     where c.page_id = ${SEED_PAGE_ID}
    on conflict (page_id, bx, "by") do nothing
  `;

  const counts = await sql`
    select
      (select count(*)::int from claims where page_id = ${SEED_PAGE_ID}) as claims,
      (select count(*)::int from blocks where page_id = ${SEED_PAGE_ID}) as blocks
  `;
  process.stdout.write(
    `Seed finished in ${Date.now() - started}ms (${counts[0]?.claims} claims, ${counts[0]?.blocks} blocks).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
